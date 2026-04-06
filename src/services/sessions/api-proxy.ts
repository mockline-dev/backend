import { createModuleLogger } from '../../logging'
import type { Application } from '../../declarations'

const log = createModuleLogger('api-proxy')

const API_TEST_REGEX = /^\/api-test\/([^/]+)(\/.*)?$/

/**
 * Creates a Koa middleware that proxies HTTP requests to running session containers.
 *
 * Route: ALL /api-test/:sessionId/*
 *
 * The client authenticates with a JWT in the Authorization header.
 * The middleware looks up the session, verifies it's running,
 * then forwards the request to the sandbox's proxyUrl.
 */
export function createApiProxyMiddleware(app: Application) {
  return async (ctx: any, next: () => Promise<void>) => {
    const match = API_TEST_REGEX.exec(ctx.path)
    if (!match) return next()

    const sessionId = match[1]
    const subPath = match[2] || '/'

    // Require JWT
    const authHeader = ctx.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      ctx.status = 401
      ctx.body = { error: 'Authentication required' }
      return
    }

    let session: any
    try {
      session = await app.service('sessions').get(sessionId, { provider: undefined })
    } catch {
      ctx.status = 404
      ctx.body = { error: 'Session not found' }
      return
    }

    if (session.status !== 'running' || !session.proxyUrl) {
      ctx.status = 409
      ctx.body = {
        error: 'Session not running',
        status: session.status,
        message: session.status === 'starting'
          ? 'Container is still starting — try again in a few seconds'
          : 'Start a session first via POST /sessions',
      }
      return
    }

    const queryString = ctx.querystring ? `?${ctx.querystring}` : ''
    const targetUrl = `${session.proxyUrl}${subPath}${queryString}`

    log.debug('Proxying request', { sessionId, method: ctx.method, path: subPath, targetUrl })

    try {
      const headers: Record<string, string> = {}

      // Forward safe headers, skip hop-by-hop and auth
      const skipKeys = new Set(['host', 'authorization', 'content-length', 'transfer-encoding', 'connection'])
      for (const [key, val] of Object.entries(ctx.headers)) {
        if (!skipKeys.has(key.toLowerCase()) && typeof val === 'string') {
          headers[key] = val
        }
      }
      if (ctx.headers['content-type']) {
        headers['content-type'] = ctx.headers['content-type'] as string
      }

      const fetchInit: RequestInit = {
        method: ctx.method,
        headers,
        signal: AbortSignal.timeout(30000),
      }

      if (!['GET', 'HEAD'].includes(ctx.method) && ctx.request.rawBody) {
        fetchInit.body = ctx.request.rawBody
      }

      const response = await fetch(targetUrl, fetchInit)

      ctx.status = response.status

      const hopByHop = new Set(['transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'proxy-authenticate'])
      response.headers.forEach((val, key) => {
        if (!hopByHop.has(key.toLowerCase())) ctx.set(key, val)
      })

      ctx.body = await response.text()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('Proxy request failed', { sessionId, targetUrl, error: message })
      ctx.status = 502
      ctx.body = { error: 'Failed to reach sandbox', details: message }
    }
  }
}
