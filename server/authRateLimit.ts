import type express from 'express'

type RateLimitOptions = {
  id: string
  windowMs: number
  max: number
  key?: (request: express.Request) => string
}

type RateLimitBucket = {
  count: number
  resetAt: number
}

const buckets = new Map<string, RateLimitBucket>()

function trimExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export function authRateLimit(options: RateLimitOptions): express.RequestHandler {
  return (request, response, next) => {
    const now = Date.now()
    trimExpiredBuckets(now)
    const identity = [
      options.id,
      request.ip || 'unknown-ip',
      options.key?.(request)?.trim().toLowerCase() || '',
    ].join(':')

    const bucket = buckets.get(identity)
    const active = bucket && bucket.resetAt > now ? bucket : { count: 0, resetAt: now + options.windowMs }
    active.count += 1
    buckets.set(identity, active)

    response.setHeader('X-RateLimit-Limit', String(options.max))
    response.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.max - active.count)))
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(active.resetAt / 1000)))

    if (active.count > options.max) {
      response.setHeader('Retry-After', String(Math.ceil((active.resetAt - now) / 1000)))
      response.status(429).json({ error: 'Too many authentication attempts. Please wait and try again.' })
      return
    }

    next()
  }
}