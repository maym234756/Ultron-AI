import type express from 'express'
import { monitorEventLoopDelay } from 'node:perf_hooks'

type RuntimeSeverity = 'info' | 'warn' | 'error'

type RuntimeEvent = {
  at: number
  severity: RuntimeSeverity
  source: string
  detail: string
}

type EndpointStat = {
  method: string
  path: string
  count: number
  errorCount: number
  avgMs: number
  maxMs: number
  lastMs: number
  lastStatus: number
  lastAt: number
}

type RouteInfo = {
  method: string
  path: string
}

type RuntimeSnapshotOptions = {
  routes: RouteInfo[]
  toolCount: number
  modelCount: number
  defaultModel: string
  fastModel: string | null
  warmupDetail: string
}

type ExpressLayer = {
  route?: {
    path?: string | RegExp | Array<string | RegExp>
    methods?: Record<string, boolean>
  }
  handle?: {
    stack?: unknown
  }
}

type ExpressRoutePath = NonNullable<NonNullable<ExpressLayer['route']>['path']>

const startedAt = Date.now()
const endpointStats = new Map<string, EndpointStat>()
const recentEvents: RuntimeEvent[] = []
const eventLoop = monitorEventLoopDelay({ resolution: 20 })
eventLoop.enable()

let activeRequests = 0
let activeStreams = 0
let totalRequests = 0
let totalErrors = 0

const STREAM_PATHS = new Set([
  '/api/chat',
  '/api/agent',
  '/api/compare',
  '/api/pull-model',
  '/api/self-upgrade',
  '/v1/chat/completions',
  '/v1/completions',
])

function normalizePath(pathname: string): string {
  return pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/:id')
}

function pushRuntimeEvent(event: RuntimeEvent): void {
  recentEvents.push(event)
  if (recentEvents.length > 80) recentEvents.splice(0, recentEvents.length - 80)
}

export function recordRuntimeEvent(source: string, detail: string, severity: RuntimeSeverity = 'info'): void {
  pushRuntimeEvent({ at: Date.now(), severity, source, detail: detail.slice(0, 500) })
  if (severity === 'error') totalErrors += 1
}

export function backendRuntimeMiddleware(): express.RequestHandler {
  return (request, response, next) => {
    const started = Date.now()
    const routePath = normalizePath(request.path)
    const method = request.method.toUpperCase()
    const streamLike = STREAM_PATHS.has(routePath)
    let completed = false

    activeRequests += 1
    totalRequests += 1
    if (streamLike) activeStreams += 1

    const finish = (aborted: boolean): void => {
      if (completed) return
      completed = true
      activeRequests = Math.max(0, activeRequests - 1)
      if (streamLike) activeStreams = Math.max(0, activeStreams - 1)

      const durationMs = Date.now() - started
      const status = aborted && response.statusCode < 400 ? 499 : response.statusCode
      const key = `${method} ${routePath}`
      const existing = endpointStats.get(key)
      const error = status >= 500 || status === 499
      if (error) totalErrors += 1

      if (existing) {
        existing.count += 1
        existing.errorCount += error ? 1 : 0
        existing.avgMs = Math.round((existing.avgMs * (existing.count - 1) + durationMs) / existing.count)
        existing.maxMs = Math.max(existing.maxMs, durationMs)
        existing.lastMs = durationMs
        existing.lastStatus = status
        existing.lastAt = Date.now()
      } else {
        endpointStats.set(key, {
          method,
          path: routePath,
          count: 1,
          errorCount: error ? 1 : 0,
          avgMs: durationMs,
          maxMs: durationMs,
          lastMs: durationMs,
          lastStatus: status,
          lastAt: Date.now(),
        })
      }

      if (error) recordRuntimeEvent('http', `${method} ${routePath} ended with ${status} in ${durationMs}ms`, 'error')
    }

    response.once('finish', () => finish(false))
    response.once('close', () => finish(!response.writableEnded))
    next()
  }
}

function readStack(value: unknown): ExpressLayer[] {
  const maybe = value as { router?: { stack?: unknown }; _router?: { stack?: unknown }; stack?: unknown }
  const stack = maybe.stack ?? maybe.router?.stack ?? maybe._router?.stack
  return Array.isArray(stack) ? stack as ExpressLayer[] : []
}

function routePaths(pathValue: ExpressRoutePath | undefined): string[] {
  if (Array.isArray(pathValue)) return pathValue.map(path => path.toString())
  if (pathValue instanceof RegExp) return [pathValue.toString()]
  return [String(pathValue ?? '')]
}

export function collectBackendRoutes(app: express.Express): RouteInfo[] {
  const routes: RouteInfo[] = []
  const visit = (layers: ExpressLayer[]): void => {
    for (const layer of layers) {
      if (layer.route?.path && layer.route.methods) {
        const methods = Object.entries(layer.route.methods)
          .filter(([, enabled]) => enabled)
          .map(([method]) => method.toUpperCase())
        for (const pathName of routePaths(layer.route.path)) {
          for (const method of methods) routes.push({ method, path: pathName })
        }
      }
      const childStack = readStack(layer.handle)
      if (childStack.length > 0) visit(childStack)
    }
  }
  visit(readStack(app))
  return routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`))
}

export function backendRuntimeSnapshot(options: RuntimeSnapshotOptions) {
  const memory = process.memoryUsage()
  const eventLoopMeanMs = Number.isFinite(eventLoop.mean) ? Math.round(eventLoop.mean / 1e6) : 0
  const eventLoopMaxMs = Number.isFinite(eventLoop.max) ? Math.round(eventLoop.max / 1e6) : 0
  const recentErrorCount = recentEvents.filter(event => event.severity === 'error' && Date.now() - event.at < 10 * 60_000).length
  const slowEndpoints = [...endpointStats.values()]
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 8)
  const busyEndpoints = [...endpointStats.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
  const healthy = recentErrorCount === 0 && eventLoopMaxMs < 750

  return {
    healthy,
    checkedAt: Date.now(),
    summary: healthy ? 'Backend runtime is healthy.' : 'Backend runtime needs attention.',
    process: {
      pid: process.pid,
      platform: process.platform,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      startedAt,
      memoryMb: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
        external: Math.round(memory.external / 1024 / 1024),
      },
      eventLoop: {
        meanMs: eventLoopMeanMs,
        maxMs: eventLoopMaxMs,
      },
    },
    traffic: {
      activeRequests,
      activeStreams,
      totalRequests,
      totalErrors,
      recentErrorCount,
    },
    inventory: {
      apiRoutes: options.routes.length,
      toolCount: options.toolCount,
      modelCount: options.modelCount,
      defaultModel: options.defaultModel,
      fastModel: options.fastModel,
      warmupDetail: options.warmupDetail,
    },
    endpoints: {
      busy: busyEndpoints,
      slow: slowEndpoints,
    },
    routes: options.routes,
    recentEvents: [...recentEvents].reverse().slice(0, 20),
  }
}
