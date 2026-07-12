import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import os from 'node:os'
import { deliverAuthChallenge, deliverOrganizationInvite, type AuthChallengeDelivery, type OrganizationInviteDelivery } from './authMailer.js'
import { databaseProvider, prisma } from './prisma.js'

const scrypt = promisify(scryptCallback)
const SESSION_DAYS = 14
const EMAIL_VERIFICATION_MINUTES = Number(process.env.AUTH_EMAIL_VERIFICATION_MINUTES ?? 30)
const PASSWORD_RESET_MINUTES = Number(process.env.AUTH_PASSWORD_RESET_MINUTES ?? 30)
const ORGANIZATION_INVITE_DAYS = Number(process.env.ORGANIZATION_INVITE_DAYS ?? 7)
const EMAIL_VERIFICATION = 'email_verification'
const PASSWORD_RESET = 'password_reset'

type AuthChallengeType = typeof EMAIL_VERIFICATION | typeof PASSWORD_RESET
export type OrganizationRole = 'owner' | 'member'

export type AuthUser = {
  id: string
  email: string
  username: string
  displayName: string
  organizationId: string | null
  organizationName: string | null
  organizationSlug: string | null
  organizationRole: OrganizationRole
  isPlatformAdmin: boolean
  emailVerifiedAt: string | null
  createdAt: string
}

export type AuthSession = {
  token: string
  user: AuthUser
  expiresAt: string
}

export type AuthChallengeResponse = {
  email: string
  delivery: AuthChallengeDelivery
  expiresAt: string
}

export type LoginResult =
  | { next: 'signed_in'; session: AuthSession }
  | ({ next: 'verify_email' } & AuthChallengeResponse)

export type RegisterResult = { next: 'verify_email' } & AuthChallengeResponse

export type CredentialInput = {
  label?: string
  site?: string
  username?: string
  email?: string
  secret?: string
  notes?: string
}

export type OrganizationMemberSummary = {
  id: string
  email: string
  username: string
  displayName: string
  organizationRole: OrganizationRole
  isPlatformAdmin: boolean
  emailVerifiedAt: string | null
  createdAt: string
}

export type OrganizationInviteSummary = {
  id: string
  email: string
  role: OrganizationRole
  expiresAt: string
  createdAt: string
  invitedBy: {
    id: string
    email: string
    displayName: string
  } | null
}

export type IncomingOrganizationInviteSummary = {
  id: string
  role: OrganizationRole
  expiresAt: string
  createdAt: string
  organization: {
    id: string
    name: string
    slug: string
  }
  invitedBy: {
    id: string
    email: string
    displayName: string
  } | null
}

export type OrganizationInvitePreview = {
  email: string
  role: OrganizationRole
  expiresAt: string
  organization: {
    id: string
    name: string
    slug: string
  }
  invitedBy: {
    id: string
    email: string
    displayName: string
  } | null
  accountState: 'none' | 'existing_unverified' | 'existing_verified'
}

export type OrganizationOverview = {
  organization: {
    id: string
    name: string
    slug: string
    createdAt: string
    updatedAt: string
  }
  currentUser: {
    id: string
    organizationRole: OrganizationRole
    isPlatformAdmin: boolean
    canManageOrganization: boolean
  }
  members: OrganizationMemberSummary[]
  invites: OrganizationInviteSummary[]
}

export type CreatedOrganizationInvite = {
  id: string
  email: string
  role: OrganizationRole
  expiresAt: string
  delivery: OrganizationInviteDelivery
}

export type IdentityOverview = {
  totals: {
    userCount: number
    organizationCount: number
    platformAdminCount: number
    pendingInviteCount: number
  }
  organizations: Array<{
    id: string
    name: string
    slug: string
    createdAt: string
    updatedAt: string
    pendingInviteCount: number
    members: OrganizationMemberSummary[]
  }>
}

export type AuditLogEntry = {
  id: string
  action: string
  summary: string
  createdAt: string
  user: {
    id: string
    email: string
    displayName: string
  } | null
}

type OrganizationActor = {
  id: string
  email: string
  displayName: string
  organizationId: string
  organizationRole: string
  isPlatformAdmin: boolean
  organization: {
    id: string
    name: string
    slug: string
  }
}

function userPublic(user: {
  id: string
  email: string
  username: string
  displayName: string
  organizationRole: string
  isPlatformAdmin: boolean
  emailVerifiedAt: Date | null
  createdAt: Date
  organization: { id: string; name: string; slug: string } | null
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    organizationId: user.organization?.id ?? null,
    organizationName: user.organization?.name ?? null,
    organizationSlug: user.organization?.slug ?? null,
    organizationRole: normalizeOrganizationRole(user.organizationRole),
    isPlatformAdmin: user.isPlatformAdmin,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}

function normalizeOrganizationRole(value: string | undefined | null): OrganizationRole {
  return value === 'owner' ? 'owner' : 'member'
}

function parseOrganizationRole(value: string | undefined | null): OrganizationRole {
  const normalized = value?.trim().toLowerCase()
  if (!normalized || normalized === 'member') return 'member'
  if (normalized === 'owner') return 'owner'
  throw new Error('Organization role must be owner or member.')
}

function canManageOrganization(user: { organizationId: string | null; organizationRole: string; isPlatformAdmin: boolean }): boolean {
  return Boolean(user.organizationId) && (user.isPlatformAdmin || normalizeOrganizationRole(user.organizationRole) === 'owner')
}

function organizationName(displayName: string, username: string): string {
  const base = displayName.trim() || username
  return `${base} Workspace`
}

async function uniqueOrganizationSlug(baseValue: string): Promise<string> {
  const baseSlug = normalizeUsername(baseValue) || randomBytes(6).toString('hex')
  let candidate = baseSlug
  let counter = 2

  while (await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${baseSlug}-${counter}`
    counter += 1
  }

  return candidate
}

async function ensureUserOrganization(user: { id: string; username: string; displayName: string; organizationId: string | null; isPlatformAdmin: boolean }): Promise<void> {
  if (user.organizationId) return

  const slug = await uniqueOrganizationSlug(normalizeUsername(user.username) || user.id.toLowerCase())
  const organization = await prisma.organization.create({
    data: {
      name: organizationName(user.displayName, user.username),
      slug,
    },
  })
  const platformAdminCount = await prisma.user.count({ where: { isPlatformAdmin: true, NOT: { id: user.id } } })
  await prisma.user.update({
    where: { id: user.id },
    data: {
      organizationId: organization.id,
      organizationRole: 'owner',
      isPlatformAdmin: user.isPlatformAdmin || platformAdminCount === 0,
    },
  })
}

async function ensureUserOrganizationById(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, organizationId: true, isPlatformAdmin: true },
  })
  if (!user) return
  await ensureUserOrganization(user)

  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true },
  })
  if (!currentUser?.organizationId) return

  const ownerCount = await prisma.user.count({
    where: { organizationId: currentUser.organizationId, organizationRole: 'owner' },
  })
  if (ownerCount > 0) return

  const oldestMember = await prisma.user.findFirst({
    where: { organizationId: currentUser.organizationId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (oldestMember) {
    await prisma.user.update({ where: { id: oldestMember.id }, data: { organizationRole: 'owner' } })
  }
}

async function backfillLegacyOrganizations(): Promise<void> {
  const legacyUsers = await prisma.user.findMany({
    where: { organizationId: null },
    select: { id: true, username: true, displayName: true, organizationId: true, isPlatformAdmin: true },
  })
  for (const user of legacyUsers) {
    await ensureUserOrganization(user)
  }
}

async function backfillLegacyOrganizationRoles(): Promise<void> {
  const organizationsWithoutOwner = await prisma.organization.findMany({
    where: {
      users: { some: {} },
      NOT: { users: { some: { organizationRole: 'owner' } } },
    },
    select: { id: true },
  })

  for (const organization of organizationsWithoutOwner) {
    const oldestMember = await prisma.user.findFirst({
      where: { organizationId: organization.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (oldestMember) {
      await prisma.user.update({ where: { id: oldestMember.id }, data: { organizationRole: 'owner' } })
    }
  }
}

async function cleanupEmptyOrganization(organizationId: string | null): Promise<void> {
  if (!organizationId) return
  const remainingUsers = await prisma.user.count({ where: { organizationId } })
  if (remainingUsers === 0) {
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined)
  }
}

async function loadOrganizationActor(userId: string): Promise<OrganizationActor> {
  await ensureUserOrganizationById(userId)
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { organization: true } })
  if (!user) throw new Error('User not found.')
  if (!user.organization) throw new Error('Organization not found.')
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    organizationId: user.organizationId ?? user.organization.id,
    organizationRole: user.organizationRole,
    isPlatformAdmin: user.isPlatformAdmin,
    organization: {
      id: user.organization.id,
      name: user.organization.name,
      slug: user.organization.slug,
    },
  }
}

function memberSummary(user: {
  id: string
  email: string
  username: string
  displayName: string
  organizationRole: string
  isPlatformAdmin: boolean
  emailVerifiedAt: Date | null
  createdAt: Date
}): OrganizationMemberSummary {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    organizationRole: normalizeOrganizationRole(user.organizationRole),
    isPlatformAdmin: user.isPlatformAdmin,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  }
}

function organizationInviteSummary(invite: {
  id: string
  email: string
  role: string
  expiresAt: Date
  createdAt: Date
  invitedByUser: {
    id: string
    email: string
    displayName: string
  } | null
}): OrganizationInviteSummary {
  return {
    id: invite.id,
    email: invite.email,
    role: normalizeOrganizationRole(invite.role),
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
    invitedBy: invite.invitedByUser ? {
      id: invite.invitedByUser.id,
      email: invite.invitedByUser.email,
      displayName: invite.invitedByUser.displayName,
    } : null,
  }
}

function incomingOrganizationInviteSummary(invite: {
  id: string
  role: string
  expiresAt: Date
  createdAt: Date
  organization: {
    id: string
    name: string
    slug: string
  }
  invitedByUser: {
    id: string
    email: string
    displayName: string
  } | null
}): IncomingOrganizationInviteSummary {
  return {
    id: invite.id,
    role: normalizeOrganizationRole(invite.role),
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
    organization: {
      id: invite.organization.id,
      name: invite.organization.name,
      slug: invite.organization.slug,
    },
    invitedBy: invite.invitedByUser ? {
      id: invite.invitedByUser.id,
      email: invite.invitedByUser.email,
      displayName: invite.invitedByUser.displayName,
    } : null,
  }
}

async function assertCanLeaveCurrentOrganization(actor: OrganizationActor): Promise<void> {
  if (normalizeOrganizationRole(actor.organizationRole) !== 'owner') return

  const [memberCount, otherOwnerCount] = await Promise.all([
    prisma.user.count({ where: { organizationId: actor.organizationId } }),
    prisma.user.count({ where: { organizationId: actor.organizationId, organizationRole: 'owner', NOT: { id: actor.id } } }),
  ])

  if (memberCount > 1 && otherOwnerCount === 0) {
    throw new Error('Promote another workspace owner before leaving this organization.')
  }
}

async function completeOrganizationInviteAcceptance(actor: OrganizationActor, invite: {
  id: string
  email: string
  role: string
  organizationId: string
  expiresAt: Date
  organization: {
    name: string
  }
}): Promise<OrganizationOverview> {
  if (invite.expiresAt.getTime() < Date.now()) throw new Error('That invite is invalid or expired.')
  if (normalizeEmail(actor.email) !== normalizeEmail(invite.email)) throw new Error('That invite belongs to a different email address.')

  await assertCanLeaveCurrentOrganization(actor)

  const nextRole = normalizeOrganizationRole(invite.role)
  const previousOrganizationId = actor.organizationId
  await prisma.$transaction([
    prisma.user.update({
      where: { id: actor.id },
      data: {
        organizationId: invite.organizationId,
        organizationRole: nextRole,
      },
    }),
    prisma.organizationInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ])
  await cleanupEmptyOrganization(previousOrganizationId)
  await audit(actor.id, 'organization.invite.accept', `Joined organization ${invite.organization.name} as ${nextRole}.`)
  return organizationOverview(actor.id)
}

async function moveUserToPersonalOrganization(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      organizationId: true,
    },
  })
  if (!user) throw new Error('User not found.')

  const previousOrganizationId = user.organizationId
  await prisma.user.update({
    where: { id: userId },
    data: {
      organizationId: null,
      organizationRole: 'owner',
    },
  })
  await ensureUserOrganizationById(userId)
  await cleanupEmptyOrganization(previousOrganizationId)
}

export async function organizationOverview(userId: string): Promise<OrganizationOverview> {
  const actor = await loadOrganizationActor(userId)
  const organization = await prisma.organization.findUnique({
    where: { id: actor.organization.id },
    include: {
      users: true,
      invites: {
        where: { acceptedAt: null, expiresAt: { gt: new Date() } },
        include: { invitedByUser: { select: { id: true, email: true, displayName: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!organization) throw new Error('Organization not found.')

  const sortedMembers = [...organization.users]
    .sort((left, right) => {
      const roleDiff = Number(normalizeOrganizationRole(right.organizationRole) === 'owner') - Number(normalizeOrganizationRole(left.organizationRole) === 'owner')
      if (roleDiff !== 0) return roleDiff
      return left.createdAt.getTime() - right.createdAt.getTime()
    })
    .map(memberSummary)

  const manager = canManageOrganization(actor)
  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt.toISOString(),
      updatedAt: organization.updatedAt.toISOString(),
    },
    currentUser: {
      id: actor.id,
      organizationRole: normalizeOrganizationRole(actor.organizationRole),
      isPlatformAdmin: actor.isPlatformAdmin,
      canManageOrganization: manager,
    },
    members: sortedMembers,
    invites: manager
      ? organization.invites.map(organizationInviteSummary)
      : [],
  }
}

export async function renameOrganization(userId: string, input: { name?: string }): Promise<OrganizationOverview> {
  const actor = await loadOrganizationActor(userId)
  if (!canManageOrganization(actor)) throw new Error('Only organization owners or platform admins can manage the workspace.')
  const name = input.name?.trim() ?? ''
  if (name.length < 2) throw new Error('Organization name must be at least 2 characters.')
  if (name.length > 80) throw new Error('Organization name must be 80 characters or fewer.')
  await prisma.organization.update({ where: { id: actor.organization.id }, data: { name } })
  await audit(actor.id, 'organization.rename', `Renamed organization to ${name}.`)
  return organizationOverview(userId)
}

export async function createOrganizationInvite(userId: string, input: { email?: string; role?: string }): Promise<CreatedOrganizationInvite> {
  const actor = await loadOrganizationActor(userId)
  if (!canManageOrganization(actor)) throw new Error('Only organization owners or platform admins can invite members.')

  const email = normalizeEmail(input.email ?? '')
  if (!email || !email.includes('@')) throw new Error('A valid invite email is required.')
  if (email === normalizeEmail(actor.email)) throw new Error('You are already a member of this organization.')

  const role = parseOrganizationRole(input.role)
  const existingMember = await prisma.user.findFirst({ where: { email, organizationId: actor.organization.id } })
  if (existingMember) throw new Error('That user is already a member of this organization.')

  const inviteToken = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + ORGANIZATION_INVITE_DAYS * 24 * 60 * 60 * 1000)
  await prisma.organizationInvite.deleteMany({ where: { organizationId: actor.organization.id, email, acceptedAt: null } })
  const invite = await prisma.organizationInvite.create({
    data: {
      organizationId: actor.organization.id,
      email,
      tokenHash: tokenHash(inviteToken),
      role,
      invitedByUserId: actor.id,
      expiresAt,
    },
  })
  try {
    const delivery = await deliverOrganizationInvite({
      email,
      inviteToken,
      expiresAt,
      organizationName: actor.organization.name,
      role,
      invitedByDisplayName: actor.displayName,
    })
    await audit(actor.id, 'organization.invite.create', `Created ${role} invite for ${email} to ${actor.organization.name}.`)
    return {
      id: invite.id,
      email,
      role,
      expiresAt: invite.expiresAt.toISOString(),
      delivery,
    }
  } catch (error) {
    await prisma.organizationInvite.delete({ where: { id: invite.id } }).catch(() => undefined)
    throw error
  }
}

export async function previewOrganizationInvite(input: { token?: string }): Promise<OrganizationInvitePreview> {
  const token = input.token?.trim() ?? ''
  if (!token) throw new Error('Invite token is required.')

  const invite = await prisma.organizationInvite.findFirst({
    where: { tokenHash: tokenHash(token), acceptedAt: null },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      invitedByUser: { select: { id: true, email: true, displayName: true } },
    },
  })
  if (!invite || invite.expiresAt.getTime() < Date.now()) throw new Error('That invite is invalid or expired.')

  const account = await prisma.user.findUnique({
    where: { email: normalizeEmail(invite.email) },
    select: { emailVerifiedAt: true },
  })

  return {
    email: invite.email,
    role: normalizeOrganizationRole(invite.role),
    expiresAt: invite.expiresAt.toISOString(),
    organization: {
      id: invite.organization.id,
      name: invite.organization.name,
      slug: invite.organization.slug,
    },
    invitedBy: invite.invitedByUser ? {
      id: invite.invitedByUser.id,
      email: invite.invitedByUser.email,
      displayName: invite.invitedByUser.displayName,
    } : null,
    accountState: account
      ? account.emailVerifiedAt
        ? 'existing_verified'
        : 'existing_unverified'
      : 'none',
  }
}

export async function leaveOrganization(userId: string): Promise<OrganizationOverview> {
  const actor = await loadOrganizationActor(userId)
  const memberCount = await prisma.user.count({ where: { organizationId: actor.organizationId } })
  if (memberCount <= 1) {
    throw new Error('You are already the only member of this workspace.')
  }

  await assertCanLeaveCurrentOrganization(actor)
  await moveUserToPersonalOrganization(actor.id)
  await audit(actor.id, 'organization.leave', `Left organization ${actor.organization.name}.`)
  return organizationOverview(actor.id)
}

export async function removeOrganizationMember(actorUserId: string, targetUserId: string): Promise<OrganizationOverview> {
  const actor = await loadOrganizationActor(actorUserId)
  if (!canManageOrganization(actor)) throw new Error('Only organization owners or platform admins can remove members.')
  if (actor.id === targetUserId) throw new Error('Use the leave workspace action to remove yourself.')

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      organizationId: true,
      organizationRole: true,
    },
  })
  if (!target?.organizationId) throw new Error('Target member not found.')
  if (target.organizationId !== actor.organizationId) throw new Error('You can only remove members from your own organization.')

  if (normalizeOrganizationRole(target.organizationRole) === 'owner') {
    const otherOwnerCount = await prisma.user.count({
      where: { organizationId: target.organizationId, organizationRole: 'owner', NOT: { id: target.id } },
    })
    if (otherOwnerCount === 0) throw new Error('Transfer ownership before removing the only workspace owner.')
  }

  await moveUserToPersonalOrganization(target.id)
  await audit(actor.id, 'organization.member.remove', `Removed ${target.email} from ${actor.organization.name}.`)
  return organizationOverview(actor.id)
}

export async function transferOrganizationOwnership(actorUserId: string, targetUserId: string): Promise<OrganizationOverview> {
  const actor = await loadOrganizationActor(actorUserId)
  if (normalizeOrganizationRole(actor.organizationRole) !== 'owner') {
    throw new Error('Only a current workspace owner can transfer ownership.')
  }
  if (actor.id === targetUserId) throw new Error('Choose another member to receive ownership.')

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      organizationId: true,
      organizationRole: true,
    },
  })
  if (!target?.organizationId) throw new Error('Target member not found.')
  if (target.organizationId !== actor.organizationId) throw new Error('You can only transfer ownership within your own organization.')

  await prisma.$transaction([
    prisma.user.update({ where: { id: target.id }, data: { organizationRole: 'owner' } }),
    prisma.user.update({ where: { id: actor.id }, data: { organizationRole: 'member' } }),
  ])
  await audit(actor.id, 'organization.ownership.transfer', `Transferred ownership of ${actor.organization.name} to ${target.email}.`)
  return organizationOverview(actor.id)
}

export async function listIncomingOrganizationInvites(userId: string): Promise<IncomingOrganizationInviteSummary[]> {
  const actor = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!actor) throw new Error('User not found.')

  const invites = await prisma.organizationInvite.findMany({
    where: {
      email: normalizeEmail(actor.email),
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      invitedByUser: { select: { id: true, email: true, displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return invites.map(incomingOrganizationInviteSummary)
}

export async function cancelOrganizationInvite(userId: string, inviteId: string): Promise<OrganizationOverview> {
  const actor = await loadOrganizationActor(userId)
  if (!canManageOrganization(actor)) throw new Error('Only organization owners or platform admins can cancel invites.')

  const invite = await prisma.organizationInvite.findUnique({ where: { id: inviteId } })
  if (!invite || invite.acceptedAt) throw new Error('Invite not found.')
  if (!actor.isPlatformAdmin && invite.organizationId !== actor.organization.id) {
    throw new Error('You can only cancel invites from your own organization.')
  }

  await prisma.organizationInvite.delete({ where: { id: invite.id } })
  await audit(actor.id, 'organization.invite.cancel', `Cancelled invite for ${invite.email}.`)
  return organizationOverview(userId)
}

export async function acceptOrganizationInvite(userId: string, input: { token?: string }): Promise<OrganizationOverview> {
  const actor = await loadOrganizationActor(userId)
  const token = input.token?.trim() ?? ''
  if (!token) throw new Error('Invite token is required.')

  const invite = await prisma.organizationInvite.findFirst({
    where: { tokenHash: tokenHash(token), acceptedAt: null },
    include: { organization: true },
  })
  if (!invite) throw new Error('That invite is invalid or expired.')
  return completeOrganizationInviteAcceptance(actor, invite)
}

export async function acceptIncomingOrganizationInvite(userId: string, inviteId: string): Promise<OrganizationOverview> {
  const actor = await loadOrganizationActor(userId)
  const invite = await prisma.organizationInvite.findUnique({
    where: { id: inviteId },
    include: { organization: true },
  })
  if (!invite || invite.acceptedAt) throw new Error('That invite is invalid or expired.')
  return completeOrganizationInviteAcceptance(actor, invite)
}

export async function setOrganizationMemberRole(actorUserId: string, targetUserId: string, input: { role?: string }): Promise<OrganizationMemberSummary> {
  const actor = await loadOrganizationActor(actorUserId)
  const target = await prisma.user.findUnique({ where: { id: targetUserId } })
  if (!target || !target.organizationId) throw new Error('Target member not found.')
  const nextRole = parseOrganizationRole(input.role)

  if (!actor.isPlatformAdmin) {
    if (!canManageOrganization(actor)) throw new Error('Only organization owners or platform admins can change member roles.')
    if (actor.organizationId !== target.organizationId) throw new Error('You can only manage members in your own organization.')
  }

  if (normalizeOrganizationRole(target.organizationRole) === 'owner' && nextRole !== 'owner') {
    const otherOwnerCount = await prisma.user.count({
      where: { organizationId: target.organizationId, organizationRole: 'owner', NOT: { id: target.id } },
    })
    if (otherOwnerCount === 0) throw new Error('Each organization must keep at least one owner.')
  }

  const updated = await prisma.user.update({ where: { id: target.id }, data: { organizationRole: nextRole } })
  await audit(actor.id, 'organization.member.role', `Set ${updated.email} to ${nextRole}.`)
  return memberSummary(updated)
}

export async function setPlatformAdmin(actorUserId: string, targetUserId: string, input: { isPlatformAdmin?: boolean }): Promise<OrganizationMemberSummary> {
  const actor = await prisma.user.findUnique({ where: { id: actorUserId } })
  if (!actor?.isPlatformAdmin) throw new Error('Platform admin access is required.')
  const target = await prisma.user.findUnique({ where: { id: targetUserId } })
  if (!target) throw new Error('Target user not found.')
  const nextValue = Boolean(input.isPlatformAdmin)

  if (!nextValue && target.isPlatformAdmin) {
    const otherAdminCount = await prisma.user.count({ where: { isPlatformAdmin: true, NOT: { id: target.id } } })
    if (otherAdminCount === 0) throw new Error('Astra must keep at least one platform admin.')
  }

  const updated = await prisma.user.update({ where: { id: target.id }, data: { isPlatformAdmin: nextValue } })
  await audit(actor.id, 'platform.admin.update', `${nextValue ? 'Granted' : 'Removed'} platform admin for ${updated.email}.`)
  return memberSummary(updated)
}

export async function identityOverview(userId: string): Promise<IdentityOverview> {
  await backfillLegacyOrganizations()
  await backfillLegacyOrganizationRoles()
  const actor = await prisma.user.findUnique({ where: { id: userId } })
  if (!actor?.isPlatformAdmin) throw new Error('Platform admin access is required.')

  const now = new Date()
  const organizations = await prisma.organization.findMany({
    include: {
      users: true,
      invites: {
        where: { acceptedAt: null, expiresAt: { gt: now } },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  const [userCount, organizationCount, platformAdminCount, pendingInviteCount] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.user.count({ where: { isPlatformAdmin: true } }),
    prisma.organizationInvite.count({ where: { acceptedAt: null, expiresAt: { gt: now } } }),
  ])

  return {
    totals: {
      userCount,
      organizationCount,
      platformAdminCount,
      pendingInviteCount,
    },
    organizations: organizations.map(organization => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt.toISOString(),
      updatedAt: organization.updatedAt.toISOString(),
      pendingInviteCount: organization.invites.length,
      members: [...organization.users]
        .sort((left, right) => {
          const roleDiff = Number(normalizeOrganizationRole(right.organizationRole) === 'owner') - Number(normalizeOrganizationRole(left.organizationRole) === 'owner')
          if (roleDiff !== 0) return roleDiff
          return left.createdAt.getTime() - right.createdAt.getTime()
        })
        .map(memberSummary),
    })),
  }
}

export async function auditLogOverview(userId: string, limit = 80): Promise<AuditLogEntry[]> {
  const actor = await prisma.user.findUnique({ where: { id: userId } })
  if (!actor?.isPlatformAdmin) throw new Error('Platform admin access is required.')
  const take = Math.min(200, Math.max(1, Math.trunc(limit)))
  const rows = await prisma.auditLog.findMany({
    take,
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, email: true, displayName: true } } },
  })
  return rows.map(row => ({
    id: row.id,
    action: row.action,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    user: row.user ? {
      id: row.user.id,
      email: row.user.email,
      displayName: row.user.displayName,
    } : null,
  }))
}

function isPrismaUniqueError(error: unknown): error is { code: string; meta?: { target?: unknown } } {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002'
}

function prismaUniqueTargets(error: { meta?: { target?: unknown } }): string[] {
  return Array.isArray(error.meta?.target)
    ? error.meta.target.filter((value): value is string => typeof value === 'string')
    : []
}

async function hashPassword(password: string, salt = randomBytes(16).toString('hex')): Promise<{ hash: string; salt: string }> {
  const derived = await scrypt(password, salt, 64) as Buffer
  return { hash: derived.toString('hex'), salt }
}

async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = await hashPassword(password, salt)
  const expected = Buffer.from(hash, 'hex')
  const actual = Buffer.from(derived.hash, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function issueCode(length = 10): string {
  return randomBytes(length).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, length).toUpperCase()
}

function encryptionKey(): Buffer {
  if (process.env.CREDENTIAL_ENCRYPTION_KEY?.trim()) {
    return createHash('sha256').update(process.env.CREDENTIAL_ENCRYPTION_KEY.trim()).digest()
  }
  const seed = `${os.hostname()}-${os.userInfo().username}-astra-identity-vault-v1`
  return createHash('sha256').update(seed).digest()
}

function encryptText(value: string | undefined): string | null {
  if (!value) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function decryptText(value: string | null): string {
  if (!value) return ''
  const buffer = Buffer.from(value, 'base64')
  const iv = buffer.subarray(0, 12)
  const tag = buffer.subarray(12, 28)
  const encrypted = buffer.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

async function audit(userId: string | null, action: string, summary: string): Promise<void> {
  await prisma.auditLog.create({ data: { userId, action, summary } }).catch(() => undefined)
}

async function findUserByLogin(loginInput: string) {
  const login = loginInput.trim()
  if (!login) return null
  const email = normalizeEmail(login)
  const username = normalizeUsername(login)
  const candidates = Array.from(new Set([email, username].filter(Boolean)))
  return prisma.user.findFirst({
    where: {
      OR: candidates.flatMap(candidate => ([{ email: candidate }, { username: candidate }])),
    },
  })
}

async function issueAuthChallenge(user: { id: string; email: string; displayName?: string | null }, type: AuthChallengeType, ttlMinutes: number): Promise<AuthChallengeResponse> {
  const code = issueCode()
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000)
  await prisma.authChallenge.deleteMany({ where: { userId: user.id, type } })
  const challenge = await prisma.authChallenge.create({
    data: {
      userId: user.id,
      email: user.email,
      type,
      tokenHash: tokenHash(code),
      expiresAt,
    },
  })
  try {
    return {
      email: user.email,
      delivery: await deliverAuthChallenge({
        email: user.email,
        code,
        expiresAt,
        type,
        displayName: user.displayName ?? null,
      }),
      expiresAt: expiresAt.toISOString(),
    }
  } catch (error) {
    await prisma.authChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined)
    throw error
  }
}

async function consumeAuthChallenge(type: AuthChallengeType, emailInput: string, codeInput: string) {
  const email = normalizeEmail(emailInput)
  const code = codeInput.trim().toUpperCase()
  if (!email || !code) throw new Error('Email and code are required.')
  const challenge = await prisma.authChallenge.findFirst({
    where: {
      type,
      email,
      tokenHash: tokenHash(code),
      consumedAt: null,
    },
    include: { user: true },
  })
  if (!challenge || !challenge.user || challenge.expiresAt.getTime() < Date.now()) {
    throw new Error('That code is invalid or expired.')
  }
  await prisma.authChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } })
  return challenge
}

export async function identityStatus(): Promise<{ configured: boolean; userCount: number; organizationCount: number; platformAdminCount: number }> {
  await backfillLegacyOrganizations()
  await backfillLegacyOrganizationRoles()
  const [userCount, organizationCount, platformAdminCount] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.user.count({ where: { isPlatformAdmin: true } }),
  ])
  return { configured: userCount > 0, userCount, organizationCount, platformAdminCount }
}

export async function registerUser(input: { email?: string; username?: string; displayName?: string; password?: string }): Promise<RegisterResult> {
  const email = normalizeEmail(input.email ?? '')
  const username = normalizeUsername(input.username ?? '')
  const displayName = input.displayName?.trim() || username || email
  const password = input.password ?? ''
  if (!email || !email.includes('@')) throw new Error('A valid email is required.')
  if (!username || username.length < 3) throw new Error('Username must be at least 3 characters.')
  if (password.length < 8) throw new Error('Password must be at least 8 characters.')

  try {
    const passwordData = await hashPassword(password)
    const user = await prisma.$transaction(async tx => {
      if (databaseProvider === 'postgresql') {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(853164201)')
      }
      const isPlatformAdmin = await tx.user.count() === 0
      return tx.user.create({
        data: {
          email,
          username,
          displayName,
          isPlatformAdmin,
          organizationRole: 'owner',
          passwordHash: passwordData.hash,
          passwordSalt: passwordData.salt,
          organization: {
            create: {
              name: organizationName(displayName, username),
              slug: username,
            },
          },
        },
      })
    })
    const challenge = await issueAuthChallenge(user, EMAIL_VERIFICATION, EMAIL_VERIFICATION_MINUTES)
    await audit(user.id, 'identity.register', `Created Astra account for ${email}. Verification code issued.`)
    return { next: 'verify_email', ...challenge }
  } catch (error) {
    if (isPrismaUniqueError(error)) {
      const targets = new Set(prismaUniqueTargets(error))
      if (targets.has('email') && targets.has('username')) throw new Error('That email and username are already in use.')
      if (targets.has('email')) throw new Error('That email is already in use.')
      if (targets.has('username')) throw new Error('That username is already taken.')
      throw new Error('That account already exists.')
    }
    throw error
  }
}

export async function loginUser(input: { emailOrUsername?: string; password?: string }): Promise<LoginResult> {
  const password = input.password ?? ''
  const user = await findUserByLogin(input.emailOrUsername ?? '')
  if (!user || !(await verifyPassword(password, user.passwordHash, user.passwordSalt))) throw new Error('Invalid username/email or password.')
  if (!user.emailVerifiedAt) {
    const challenge = await issueAuthChallenge(user, EMAIL_VERIFICATION, EMAIL_VERIFICATION_MINUTES)
    await audit(user.id, 'identity.login.blocked', `Blocked sign-in for ${user.email} until email verification.`)
    return { next: 'verify_email', ...challenge }
  }
  await audit(user.id, 'identity.login', `Signed in as ${user.email}.`)
  return { next: 'signed_in', session: await createSession(user.id) }
}

export async function requestEmailVerification(input: { emailOrUsername?: string }): Promise<AuthChallengeResponse | null> {
  const user = await findUserByLogin(input.emailOrUsername ?? '')
  if (!user || user.emailVerifiedAt) return null
  const challenge = await issueAuthChallenge(user, EMAIL_VERIFICATION, EMAIL_VERIFICATION_MINUTES)
  await audit(user.id, 'identity.verify.request', `Issued verification code for ${user.email}.`)
  return challenge
}

export async function confirmEmailVerification(input: { email?: string; code?: string }): Promise<AuthSession> {
  const challenge = await consumeAuthChallenge(EMAIL_VERIFICATION, input.email ?? '', input.code ?? '')
  if (!challenge.userId) throw new Error('Verification record is missing a user.')
  await prisma.$transaction([
    prisma.user.update({ where: { id: challenge.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.authChallenge.deleteMany({ where: { userId: challenge.userId, type: EMAIL_VERIFICATION, id: { not: challenge.id } } }),
  ])
  await audit(challenge.userId, 'identity.verify.confirm', `Verified email for ${challenge.email}.`)
  return createSession(challenge.userId)
}

export async function requestPasswordReset(input: { email?: string }): Promise<AuthChallengeResponse | null> {
  const email = normalizeEmail(input.email ?? '')
  if (!email) return null
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return null
  const challenge = await issueAuthChallenge(user, PASSWORD_RESET, PASSWORD_RESET_MINUTES)
  await audit(user.id, 'identity.password.reset.request', `Issued password reset code for ${user.email}.`)
  return challenge
}

export async function resetPassword(input: { email?: string; code?: string; password?: string }): Promise<AuthSession> {
  const password = input.password ?? ''
  if (password.length < 8) throw new Error('Password must be at least 8 characters.')
  const challenge = await consumeAuthChallenge(PASSWORD_RESET, input.email ?? '', input.code ?? '')
  if (!challenge.userId) throw new Error('Password reset record is missing a user.')
  const passwordData = await hashPassword(password)
  await prisma.$transaction([
    prisma.user.update({
      where: { id: challenge.userId },
      data: {
        passwordHash: passwordData.hash,
        passwordSalt: passwordData.salt,
        emailVerifiedAt: new Date(),
      },
    }),
    prisma.session.deleteMany({ where: { userId: challenge.userId } }),
    prisma.authChallenge.deleteMany({ where: { userId: challenge.userId, type: PASSWORD_RESET, id: { not: challenge.id } } }),
  ])
  await audit(challenge.userId, 'identity.password.reset', `Reset password for ${challenge.email}.`)
  return createSession(challenge.userId)
}

export async function createSession(userId: string): Promise<AuthSession> {
  await ensureUserOrganizationById(userId)
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  const session = await prisma.session.create({
    data: { tokenHash: tokenHash(token), userId, expiresAt },
    include: { user: { include: { organization: true } } },
  })
  return { token, user: userPublic(session.user), expiresAt: session.expiresAt.toISOString() }
}

export async function currentUser(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: { include: { organization: true } } },
  })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.deleteMany({ where: { id: session.id } }).catch(() => undefined)
    return null
  }
  await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined)
  await ensureUserOrganizationById(session.userId)
  const user = await prisma.user.findUnique({ where: { id: session.userId }, include: { organization: true } })
  return user ? userPublic(user) : null
}

export async function logoutUser(token: string | undefined): Promise<void> {
  if (!token) return
  await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } })
}

export async function listCredentials(userId: string): Promise<Array<{ id: string; label: string; site: string; username: string; email: string; hasSecret: boolean; notes: string; updatedAt: string }>> {
  const rows = await prisma.credential.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } })
  return rows.map(row => ({
    id: row.id,
    label: row.label,
    site: row.site,
    username: row.username ?? '',
    email: row.email ?? '',
    hasSecret: Boolean(row.secretCipher),
    notes: decryptText(row.notesCipher),
    updatedAt: row.updatedAt.toISOString(),
  }))
}

export async function createCredential(userId: string, input: CredentialInput) {
  const site = input.site?.trim() ?? ''
  const label = input.label?.trim() || site || 'Credential'
  if (!site) throw new Error('Site/app is required.')
  const credential = await prisma.credential.create({
    data: {
      userId,
      label,
      site,
      username: input.username?.trim() || null,
      email: input.email?.trim() || null,
      secretCipher: encryptText(input.secret),
      notesCipher: encryptText(input.notes),
    },
  })
  await audit(userId, 'credential.create', `Saved credential for ${site}.`)
  return credential.id
}

export async function deleteCredential(userId: string, id: string): Promise<void> {
  await prisma.credential.deleteMany({ where: { id, userId } })
  await audit(userId, 'credential.delete', `Deleted credential ${id}.`)
}

export async function revealCredentialSecret(userId: string, id: string): Promise<{ secret: string }> {
  const credential = await prisma.credential.findFirst({ where: { id, userId } })
  if (!credential) throw new Error('Credential not found.')
  await audit(userId, 'credential.reveal', `Revealed credential secret for ${credential.site}.`)
  return { secret: decryptText(credential.secretCipher) }
}