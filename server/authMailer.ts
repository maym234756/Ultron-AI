import nodemailer from 'nodemailer'

const DELIVERY_MODE = (process.env.AUTH_CHALLENGE_DELIVERY ?? 'auto').trim().toLowerCase()

export type AuthDeliveryMode = 'debug' | 'smtp'

export type AuthChallengeDelivery =
  | {
    mode: 'debug'
    email: string
    code: string
    expiresAt: string
  }
  | {
    mode: 'email'
    provider: 'smtp'
    email: string
    expiresAt: string
    messageId?: string
  }

export type OrganizationInviteDelivery =
  | {
    mode: 'debug'
    email: string
    inviteToken: string
    acceptUrl: string
    expiresAt: string
  }
  | {
    mode: 'email'
    provider: 'smtp'
    email: string
    expiresAt: string
    messageId?: string
  }

type AuthChallengeEmail = {
  email: string
  code: string
  expiresAt: Date
  type: 'email_verification' | 'password_reset'
  displayName?: string | null
}

type OrganizationInviteEmail = {
  email: string
  inviteToken: string
  acceptUrl: string
  expiresAt: Date
  organizationName: string
  role: 'owner' | 'member'
  invitedByDisplayName?: string | null
}

type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  user?: string
  pass?: string
  from: string
}

let transporterPromise: Promise<nodemailer.Transporter> | null = null

function smtpConfig(): SmtpConfig | null {
  const host = process.env.AUTH_SMTP_HOST?.trim()
  const port = Number(process.env.AUTH_SMTP_PORT ?? 587)
  const user = process.env.AUTH_SMTP_USER?.trim()
  const pass = process.env.AUTH_SMTP_PASS?.trim()
  const from = process.env.AUTH_MAIL_FROM?.trim()
  const secure = (process.env.AUTH_SMTP_SECURE ?? '').trim() === '1'

  if (!host && !from && !user && !pass) return null
  if (!host || !from) throw new Error('SMTP delivery requires AUTH_SMTP_HOST and AUTH_MAIL_FROM.')
  if (!Number.isFinite(port) || port <= 0) throw new Error('AUTH_SMTP_PORT must be a valid positive number.')

  return { host, port, secure, user, pass, from }
}

function resolvedDeliveryMode(): 'debug' | 'email' {
  const configured = smtpConfig()
  if (DELIVERY_MODE === 'debug') return 'debug'
  if (DELIVERY_MODE === 'smtp') {
    if (!configured) throw new Error('AUTH_CHALLENGE_DELIVERY=smtp requires SMTP configuration.')
    return 'email'
  }
  if (DELIVERY_MODE !== 'auto') throw new Error('AUTH_CHALLENGE_DELIVERY must be auto, debug, or smtp.')
  return configured ? 'email' : 'debug'
}

export function authDeliveryStatus(): {
  requestedMode: string
  resolvedMode: AuthDeliveryMode
  ok: boolean
  detail: string
  host: string | null
  port: number | null
  from: string | null
  secure: boolean
} {
  const host = process.env.AUTH_SMTP_HOST?.trim() || null
  const from = process.env.AUTH_MAIL_FROM?.trim() || null
  const secure = (process.env.AUTH_SMTP_SECURE ?? '').trim() === '1'
  const rawPort = process.env.AUTH_SMTP_PORT?.trim()
  const port = rawPort ? Number(rawPort) : null

  try {
    const mode = resolvedDeliveryMode() === 'email' ? 'smtp' : 'debug'
    const detail = mode === 'smtp'
      ? `SMTP ${host ?? 'unknown host'}:${port ?? 587} from ${from ?? 'unknown sender'}`
      : 'Debug delivery active; codes are surfaced locally.'
    return {
      requestedMode: DELIVERY_MODE,
      resolvedMode: mode,
      ok: true,
      detail,
      host,
      port,
      from,
      secure,
    }
  } catch (error) {
    return {
      requestedMode: DELIVERY_MODE,
      resolvedMode: 'debug',
      ok: false,
      detail: error instanceof Error ? error.message : 'Auth delivery configuration is invalid.',
      host,
      port,
      from,
      secure,
    }
  }
}

function deliveryPreview(email: string, code: string, expiresAt: Date): AuthChallengeDelivery {
  return {
    mode: 'debug',
    email,
    code,
    expiresAt: expiresAt.toISOString(),
  }
}

function organizationInvitePreview(input: OrganizationInviteEmail): OrganizationInviteDelivery {
  return {
    mode: 'debug',
    email: input.email,
    inviteToken: input.inviteToken,
    acceptUrl: input.acceptUrl,
    expiresAt: input.expiresAt.toISOString(),
  }
}

function mailCopy(input: AuthChallengeEmail): { subject: string; text: string; html: string } {
  const name = input.displayName?.trim() || input.email
  const action = input.type === 'email_verification' ? 'verify your Lumivex AI account' : 'reset your Lumivex AI password'
  const intro = input.type === 'email_verification'
    ? 'Use the verification code below to finish signing in to Lumivex AI.'
    : 'Use the reset code below to choose a new Lumivex AI password.'
  const expiry = input.expiresAt.toLocaleString()
  return {
    subject: input.type === 'email_verification' ? 'Verify your Lumivex AI account' : 'Reset your Lumivex AI password',
    text: [
      `Hi ${name},`,
      '',
      intro,
      '',
      `Code: ${input.code}`,
      `Expires: ${expiry}`,
      '',
      `If you did not request this, you can ignore this email and no action will be taken.`,
      '',
      `Lumivex AI`,
    ].join('\n'),
    html: [
      '<div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#111827">',
      `<p>Hi ${escapeHtml(name)},</p>`,
      `<p>${escapeHtml(intro)}</p>`,
      '<div style="margin:24px 0;padding:16px 18px;border:1px solid #d1d5db;border-radius:12px;background:#f9fafb;display:inline-block">',
      `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">${escapeHtml(action)}</div>`,
      `<div style="font-size:28px;font-weight:700;letter-spacing:.14em;margin-top:8px">${escapeHtml(input.code)}</div>`,
      `<div style="font-size:13px;color:#6b7280;margin-top:10px">Expires ${escapeHtml(expiry)}</div>`,
      '</div>',
      '<p>If you did not request this, you can ignore this email and no action will be taken.</p>',
      '<p>Lumivex AI</p>',
      '</div>',
    ].join(''),
  }
}

function organizationInviteMailCopy(input: OrganizationInviteEmail): { subject: string; text: string; html: string } {
  const inviter = input.invitedByDisplayName?.trim() || 'A Lumivex AI workspace owner'
  const expiry = input.expiresAt.toLocaleString()
  const roleLabel = input.role === 'owner' ? 'workspace owner' : 'workspace member'
  return {
    subject: `Invitation to join ${input.organizationName} on Lumivex AI`,
    text: [
      `Hi ${input.email},`,
      '',
      `${inviter} invited you to join ${input.organizationName} on Lumivex AI as a ${roleLabel}.`,
      '',
      'Sign in to Lumivex AI with this email address, then accept the invite from the app or use the invite token below.',
      '',
      `Invite token: ${input.inviteToken}`,
      `Open Lumivex AI: ${input.acceptUrl}`,
      `Expires: ${expiry}`,
      '',
      'If you were not expecting this invite, you can ignore this email.',
      '',
      'Lumivex AI',
    ].join('\n'),
    html: [
      '<div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#111827">',
      `<p>Hi ${escapeHtml(input.email)},</p>`,
      `<p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(input.organizationName)}</strong> on Lumivex AI as a ${escapeHtml(roleLabel)}.</p>`,
      '<div style="margin:24px 0;padding:16px 18px;border:1px solid #d1d5db;border-radius:12px;background:#f9fafb">',
      '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Workspace invitation</div>',
      `<div style="font-size:24px;font-weight:700;letter-spacing:.06em;margin-top:8px">${escapeHtml(input.organizationName)}</div>`,
      `<div style="font-size:14px;color:#374151;margin-top:8px">Role: ${escapeHtml(roleLabel)}</div>`,
      `<div style="font-size:14px;color:#111827;margin-top:14px"><strong>Invite token:</strong> ${escapeHtml(input.inviteToken)}</div>`,
      `<div style="font-size:13px;color:#6b7280;margin-top:10px">Expires ${escapeHtml(expiry)}</div>`,
      '</div>',
      `<p><a href="${escapeHtml(input.acceptUrl)}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">Open Lumivex AI</a></p>`,
      '<p>Sign in with this email address and accept the invite from inside the app. If needed, you can also paste the invite token manually.</p>',
      '<p>If you were not expecting this invite, you can ignore this email.</p>',
      '<p>Lumivex AI</p>',
      '</div>',
    ].join(''),
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char))
}

function appOrigin(): string {
  const configuredOrigins = (process.env.APP_ORIGIN ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
  return configuredOrigins[0] ?? 'http://localhost:5173'
}

function inviteAcceptUrl(inviteToken: string): string {
  const base = appOrigin().replace(/\/+$/, '')
  return `${base}/?invite=${encodeURIComponent(inviteToken)}`
}

async function transporter(): Promise<nodemailer.Transporter> {
  if (!transporterPromise) {
    transporterPromise = Promise.resolve().then(() => {
      const config = smtpConfig()
      if (!config) throw new Error('SMTP transport requested without configuration.')
      return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
      })
    })
  }
  return transporterPromise
}

export async function deliverAuthChallenge(input: AuthChallengeEmail): Promise<AuthChallengeDelivery> {
  if (resolvedDeliveryMode() === 'debug') {
    return deliveryPreview(input.email, input.code, input.expiresAt)
  }

  const config = smtpConfig()
  if (!config) throw new Error('SMTP delivery requested without configuration.')
  const message = mailCopy(input)
  const info = await (await transporter()).sendMail({
    from: config.from,
    to: input.email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })

  return {
    mode: 'email',
    provider: 'smtp',
    email: input.email,
    expiresAt: input.expiresAt.toISOString(),
    messageId: info.messageId || undefined,
  }
}

export async function deliverAuthChallengeTest(email: string): Promise<AuthChallengeDelivery> {
  return deliverAuthChallenge({
    email,
    code: 'TEST00',
    expiresAt: new Date(Date.now() + 10 * 60_000),
    type: 'password_reset',
    displayName: 'Lumivex AI operator',
  })
}

export async function deliverOrganizationInvite(input: Omit<OrganizationInviteEmail, 'acceptUrl'>): Promise<OrganizationInviteDelivery> {
  const messageInput: OrganizationInviteEmail = {
    ...input,
    acceptUrl: inviteAcceptUrl(input.inviteToken),
  }

  if (resolvedDeliveryMode() === 'debug') {
    return organizationInvitePreview(messageInput)
  }

  const config = smtpConfig()
  if (!config) throw new Error('SMTP delivery requested without configuration.')
  const message = organizationInviteMailCopy(messageInput)
  const info = await (await transporter()).sendMail({
    from: config.from,
    to: input.email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })

  return {
    mode: 'email',
    provider: 'smtp',
    email: input.email,
    expiresAt: input.expiresAt.toISOString(),
    messageId: info.messageId || undefined,
  }
}