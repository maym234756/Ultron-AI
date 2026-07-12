import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_SQLITE_URL = 'file:./lumivex.db'
const PRISMA_DIR = fileURLToPath(new URL('../prisma/', import.meta.url))

process.env.DATABASE_URL ??= DEFAULT_SQLITE_URL

const require = createRequire(import.meta.url)

function isPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url)
}

function normalizeSqliteUrl(url: string): string {
  if (!url.toLowerCase().startsWith('file:')) return url
  const sqlitePath = url.slice('file:'.length)
  if (!sqlitePath || sqlitePath.startsWith('//') || /^[a-z]:/i.test(sqlitePath) || sqlitePath.startsWith('/')) return url
  const absolutePath = resolve(PRISMA_DIR, sqlitePath)
  return `file:${absolutePath.replace(/\\/g, '/')}`
}

process.env.DATABASE_URL = isPostgresUrl(process.env.DATABASE_URL ?? DEFAULT_SQLITE_URL)
  ? process.env.DATABASE_URL
  : normalizeSqliteUrl(process.env.DATABASE_URL ?? DEFAULT_SQLITE_URL)

type SqlitePrismaModule = typeof import('../prisma/generated/sqlite/index.js')

function loadPrismaModule(): SqlitePrismaModule {
  if (isPostgresUrl(process.env.DATABASE_URL ?? DEFAULT_SQLITE_URL)) {
    return require('../prisma/generated/postgres/index.js') as SqlitePrismaModule
  }
  return require('../prisma/generated/sqlite/index.js') as SqlitePrismaModule
}

const { PrismaClient } = loadPrismaModule()

export const prisma = new PrismaClient()
export const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_SQLITE_URL
export const databaseProvider = isPostgresUrl(databaseUrl) ? 'postgresql' : 'sqlite'