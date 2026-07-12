import type express from 'express'

export const AUTH_SESSION_COOKIE = process.env.AUTH_SESSION_COOKIE ?? 'astra_session'

const rawSameSite = (process.env.AUTH_COOKIE_SAME_SITE ?? 'lax').toLowerCase()
export const AUTH_COOKIE_SAME_SITE: 'lax' | 'strict' | 'none' = rawSameSite === 'strict' || rawSameSite === 'none' ? rawSameSite : 'lax'
export const AUTH_COOKIE_SECURE = process.env.AUTH_COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production'
export const AUTH_COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined

function baseCookieOptions(): express.CookieOptions {
  return {
    httpOnly: true,
    sameSite: AUTH_COOKIE_SAME_SITE,
    secure: AUTH_COOKIE_SECURE,
    domain: AUTH_COOKIE_DOMAIN,
    path: '/',
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  return Object.fromEntries(
    header
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const separator = part.indexOf('=')
        const key = separator >= 0 ? part.slice(0, separator) : part
        const value = separator >= 0 ? part.slice(separator + 1) : ''
        return [key, decodeURIComponent(value)]
      }),
  )
}

export function readSessionCookie(request: express.Request): string | undefined {
  const cookies = parseCookies(request.header('cookie'))
  return cookies[AUTH_SESSION_COOKIE]
}

export function setSessionCookie(response: express.Response, token: string, expiresAt: Date): void {
  response.cookie(AUTH_SESSION_COOKIE, token, { ...baseCookieOptions(), expires: expiresAt })
}

export function clearSessionCookie(response: express.Response): void {
  response.clearCookie(AUTH_SESSION_COOKIE, baseCookieOptions())
}