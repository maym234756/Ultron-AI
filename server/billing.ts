import Stripe from 'stripe'
import { prisma } from './prisma.js'

export type BillingPlanKey = 'starter' | 'pro' | 'business'

type BillingPlan = {
  key: BillingPlanKey
  name: string
  monthlyPriceUsd: number
  includedUsageCents: number
  monthlyHardLimitCents: number | null
  stripePriceEnv: string
}

type BillingUser = {
  id: string
  email: string
  displayName: string
  organizationId: string | null
}

type UsageInput = {
  organizationId?: string | null
  userId?: string | null
  source: string
  provider: string
  model: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  requestId?: string | null
}

const PLANS: BillingPlan[] = [
  {
    key: 'starter',
    name: 'Starter',
    monthlyPriceUsd: 29,
    includedUsageCents: 500,
    monthlyHardLimitCents: 2000,
    stripePriceEnv: 'STRIPE_PRICE_STARTER',
  },
  {
    key: 'pro',
    name: 'Pro',
    monthlyPriceUsd: 99,
    includedUsageCents: 2500,
    monthlyHardLimitCents: 10000,
    stripePriceEnv: 'STRIPE_PRICE_PRO',
  },
  {
    key: 'business',
    name: 'Business',
    monthlyPriceUsd: 249,
    includedUsageCents: 7500,
    monthlyHardLimitCents: 30000,
    stripePriceEnv: 'STRIPE_PRICE_BUSINESS',
  },
]

const DEFAULT_INPUT_USD_PER_1M = 0.15
const DEFAULT_OUTPUT_USD_PER_1M = 0.60

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  return key ? new Stripe(key) : null
}

function firstAppOrigin(): string {
  const raw = process.env.STRIPE_APP_ORIGIN ?? process.env.APP_ORIGIN ?? 'http://localhost:5173'
  return raw.split(',').map(value => value.trim()).filter(Boolean)[0] ?? 'http://localhost:5173'
}

function planForKey(planKey: string | undefined): BillingPlan {
  return PLANS.find(plan => plan.key === planKey) ?? PLANS[0]
}

function planPriceId(plan: BillingPlan): string | null {
  return process.env[plan.stripePriceEnv]?.trim() || null
}

function dateFromUnix(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null
}

function decimalEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function usageCost(input: UsageInput): { providerCostMicros: number; billableCostMicros: number } {
  const inputRate = decimalEnv('OPENAI_INPUT_USD_PER_1M', DEFAULT_INPUT_USD_PER_1M)
  const outputRate = decimalEnv('OPENAI_OUTPUT_USD_PER_1M', DEFAULT_OUTPUT_USD_PER_1M)
  const markup = decimalEnv('BILLING_USAGE_MARKUP', 4)
  const promptTokens = Math.max(0, Math.floor(input.promptTokens ?? 0))
  const completionTokens = Math.max(0, Math.floor(input.completionTokens ?? 0))
  const providerCostMicros = Math.round((promptTokens * inputRate) + (completionTokens * outputRate))
  return {
    providerCostMicros,
    billableCostMicros: Math.round(providerCostMicros * markup),
  }
}

function microsToCents(micros: number): number {
  return Math.ceil(micros / 10_000)
}

export function billingConfigStatus() {
  return {
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
    webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
    plans: PLANS.map(plan => ({
      key: plan.key,
      name: plan.name,
      monthlyPriceUsd: plan.monthlyPriceUsd,
      includedUsageCents: plan.includedUsageCents,
      monthlyHardLimitCents: plan.monthlyHardLimitCents,
      priceConfigured: Boolean(planPriceId(plan)),
    })),
  }
}

export async function billingStatus(organizationId: string) {
  const account = await prisma.billingAccount.findUnique({ where: { organizationId } })
  const periodStart = account?.currentPeriodStart ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  const usage = await prisma.usageLedger.aggregate({
    where: { organizationId, createdAt: { gte: periodStart } },
    _sum: {
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      providerCostMicros: true,
      billableCostMicros: true,
    },
  })
  const plan = planForKey(account?.planKey)
  const billableCostMicros = usage._sum.billableCostMicros ?? 0
  return {
    configured: billingConfigStatus(),
    account: account ? {
      planKey: account.planKey,
      status: account.status,
      stripeCustomerReady: Boolean(account.stripeCustomerId),
      stripeSubscriptionReady: Boolean(account.stripeSubscriptionId),
      currentPeriodStart: account.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: account.cancelAtPeriodEnd,
      includedUsageCents: account.includedUsageCents,
      monthlyHardLimitCents: account.monthlyHardLimitCents,
    } : {
      planKey: plan.key,
      status: 'not_configured',
      stripeCustomerReady: false,
      stripeSubscriptionReady: false,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      includedUsageCents: plan.includedUsageCents,
      monthlyHardLimitCents: plan.monthlyHardLimitCents,
    },
    usage: {
      promptTokens: usage._sum.promptTokens ?? 0,
      completionTokens: usage._sum.completionTokens ?? 0,
      totalTokens: usage._sum.totalTokens ?? 0,
      providerCostMicros: usage._sum.providerCostMicros ?? 0,
      billableCostMicros,
      billableUsageCents: microsToCents(billableCostMicros),
    },
  }
}

export async function createBillingCheckoutSession(user: BillingUser, planKey: string | undefined): Promise<{ url: string }> {
  if (!user.organizationId) throw new Error('Join or create a Lumivex organization before starting billing.')
  const stripe = stripeClient()
  if (!stripe) throw new Error('STRIPE_SECRET_KEY is not configured.')
  const plan = planForKey(planKey)
  const priceId = planPriceId(plan)
  if (!priceId) throw new Error(`${plan.stripePriceEnv} is not configured.`)

  const organization = await prisma.organization.findUnique({ where: { id: user.organizationId } })
  if (!organization) throw new Error('Organization not found.')
  let account = await prisma.billingAccount.findUnique({ where: { organizationId: organization.id } })
  let customerId = account?.stripeCustomerId ?? null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: organization.name,
      metadata: { organizationId: organization.id, organizationSlug: organization.slug },
    })
    customerId = customer.id
  }

  account = await prisma.billingAccount.upsert({
    where: { organizationId: organization.id },
    create: {
      organizationId: organization.id,
      stripeCustomerId: customerId,
      stripePriceId: priceId,
      planKey: plan.key,
      status: 'checkout_started',
      includedUsageCents: plan.includedUsageCents,
      monthlyHardLimitCents: plan.monthlyHardLimitCents,
    },
    update: {
      stripeCustomerId: customerId,
      stripePriceId: priceId,
      planKey: plan.key,
      includedUsageCents: plan.includedUsageCents,
      monthlyHardLimitCents: plan.monthlyHardLimitCents,
    },
  })

  const origin = firstAppOrigin()
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: account.stripeCustomerId ?? customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: process.env.STRIPE_SUCCESS_URL ?? `${origin}/?billing=success`,
    cancel_url: process.env.STRIPE_CANCEL_URL ?? `${origin}/?billing=cancelled`,
    metadata: { organizationId: organization.id, planKey: plan.key },
    subscription_data: { metadata: { organizationId: organization.id, planKey: plan.key } },
  })
  if (!session.url) throw new Error('Stripe did not return a Checkout URL.')
  return { url: session.url }
}

export async function createBillingPortalSession(user: BillingUser): Promise<{ url: string }> {
  if (!user.organizationId) throw new Error('Join or create a Lumivex organization before opening billing.')
  const stripe = stripeClient()
  if (!stripe) throw new Error('STRIPE_SECRET_KEY is not configured.')
  const account = await prisma.billingAccount.findUnique({ where: { organizationId: user.organizationId } })
  if (!account?.stripeCustomerId) throw new Error('No Stripe customer is connected to this organization yet.')
  const session = await stripe.billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: process.env.STRIPE_PORTAL_RETURN_URL ?? firstAppOrigin(),
  })
  return { url: session.url }
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
  const firstItem = subscription.items.data[0]
  const priceId = firstItem?.price.id ?? null
  const plan = PLANS.find(item => planPriceId(item) === priceId) ?? planForKey(subscription.metadata.planKey)
  const organizationId = subscription.metadata.organizationId
  const existingAccount = await prisma.billingAccount.findFirst({
    where: { OR: [{ stripeCustomerId: customerId }, { stripeSubscriptionId: subscription.id }] },
  })
  const resolvedOrganizationId = organizationId ?? existingAccount?.organizationId
  if (!resolvedOrganizationId) return
  await prisma.billingAccount.upsert({
    where: { organizationId: resolvedOrganizationId },
    create: {
      organizationId: resolvedOrganizationId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      planKey: plan.key,
      status: subscription.status,
      currentPeriodStart: dateFromUnix(firstItem?.current_period_start),
      currentPeriodEnd: dateFromUnix(firstItem?.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      includedUsageCents: plan.includedUsageCents,
      monthlyHardLimitCents: plan.monthlyHardLimitCents,
    },
    update: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      planKey: plan.key,
      status: subscription.status,
      currentPeriodStart: dateFromUnix(firstItem?.current_period_start),
      currentPeriodEnd: dateFromUnix(firstItem?.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      includedUsageCents: plan.includedUsageCents,
      monthlyHardLimitCents: plan.monthlyHardLimitCents,
    },
  })
}

export async function handleStripeWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ received: true }> {
  const stripe = stripeClient()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!stripe || !webhookSecret) throw new Error('Stripe webhook is not configured.')
  if (!signature) throw new Error('Missing Stripe signature.')

  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const organizationId = session.metadata?.organizationId
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      if (organizationId && subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        await syncSubscription(subscription)
      }
      break
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscription(event.data.object as Stripe.Subscription)
      break
  }
  return { received: true }
}

export async function recordModelUsage(input: UsageInput): Promise<void> {
  if (!input.organizationId) return
  const promptTokens = Math.max(0, Math.floor(input.promptTokens ?? 0))
  const completionTokens = Math.max(0, Math.floor(input.completionTokens ?? 0))
  const totalTokens = Math.max(0, Math.floor(input.totalTokens ?? promptTokens + completionTokens))
  if (totalTokens <= 0) return
  const costs = usageCost({ ...input, promptTokens, completionTokens, totalTokens })
  await prisma.usageLedger.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      source: input.source,
      provider: input.provider,
      model: input.model,
      promptTokens,
      completionTokens,
      totalTokens,
      providerCostMicros: costs.providerCostMicros,
      billableCostMicros: costs.billableCostMicros,
      requestId: input.requestId ?? null,
    },
  })
}