import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import os from 'node:os'
import { PrismaClient } from '@prisma/client'

process.env.DATABASE_URL ??= 'file:./ultron.db'

const scrypt = promisify(scryptCallback)
const prisma = new PrismaClient()
const SESSION_DAYS = 14

export type AuthUser = {
  id: string
  email: string
  username: string
  displayName: string
  createdAt: string
}

export type AuthSession = {
  token: string
  user: AuthUser
  expiresAt: string
}

export type CredentialInput = {
  label?: string
  site?: string
  username?: string
  email?: string
  secret?: string
  notes?: string
}

function userPublic(user: { id: string; email: string; username: string; displayName: string; createdAt: Date }): AuthUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
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

function encryptionKey(): Buffer {
  const seed = `${os.hostname()}-${os.userInfo().username}-ultron-identity-vault-v1`
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

export async function identityStatus(): Promise<{ configured: boolean; userCount: number }> {
  const userCount = await prisma.user.count()
  return { configured: userCount > 0, userCount }
}

export async function registerUser(input: { email?: string; username?: string; displayName?: string; password?: string }): Promise<AuthSession> {
  const email = normalizeEmail(input.email ?? '')
  const username = normalizeUsername(input.username ?? '')
  const displayName = input.displayName?.trim() || username || email
  const password = input.password ?? ''
  if (!email || !email.includes('@')) throw new Error('A valid email is required.')
  if (!username || username.length < 3) throw new Error('Username must be at least 3 characters.')
  if (password.length < 8) throw new Error('Password must be at least 8 characters.')

  const existingUsers = await prisma.user.count()
  if (existingUsers > 0) throw new Error('Ultron identity is already configured. Sign in instead.')
  const passwordData = await hashPassword(password)
  const user = await prisma.user.create({
    data: { email, username, displayName, passwordHash: passwordData.hash, passwordSalt: passwordData.salt },
  })
  await audit(user.id, 'identity.register', `Created local Ultron identity for ${email}.`)
  return createSession(user.id)
}

export async function loginUser(input: { emailOrUsername?: string; password?: string }): Promise<AuthSession> {
  const login = (input.emailOrUsername ?? '').trim().toLowerCase()
  const password = input.password ?? ''
  const user = await prisma.user.findFirst({ where: { OR: [{ email: login }, { username: login }] } })
  if (!user || !(await verifyPassword(password, user.passwordHash, user.passwordSalt))) throw new Error('Invalid username/email or password.')
  await audit(user.id, 'identity.login', `Signed in as ${user.email}.`)
  return createSession(user.id)
}

export async function createSession(userId: string): Promise<AuthSession> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  const session = await prisma.session.create({ data: { tokenHash: tokenHash(token), userId, expiresAt }, include: { user: true } })
  return { token, user: userPublic(session.user), expiresAt: session.expiresAt.toISOString() }
}

export async function currentUser(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null
  const session = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } })
  if (!session || session.expiresAt.getTime() < Date.now()) return null
  await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined)
  return userPublic(session.user)
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