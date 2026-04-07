import { createModuleLogger } from '../../logging'
import type { Application } from '../../declarations'
import { getActiveSandbox } from './sessions'

const log = createModuleLogger('api-proxy')

const API_TEST_REGEX = /^\/api-test\/([^/]+)(\/.*)?$/

/**
 * Creates a Koa middleware that proxies HTTP requests to running session containers.
 *
 * Route: ALL /api-test/:sessionId/*
 *
 * Primary path: exec-relay via OpenSandbox SDK — executes curl inside the container,
 * which reaches the server on localhost:{port} directly (no Docker networking issues).
 *
 * Fallback: direct fetch to session.proxyUrl (works when container is directly reachable).
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

    if (session.status !== 'running') {
      ctx.status = 409
      ctx.body = {
        error: 'Session not running',
        status: session.status,
        message:
          session.status === 'starting'
            ? 'Container is still starting — try again in a few seconds'
            : 'Start a session first via POST /sessions'
      }
      return
    }

    const queryString = ctx.querystring ? `?${ctx.querystring}` : ''
    const containerPort = session.port || 8000

    log.debug('Proxying request', { sessionId, method: ctx.method, path: subPath })

    // ── Primary: exec-relay via SDK (works through Docker network) ────────────
    const sandbox = getActiveSandbox(sessionId)
    if (sandbox) {
      try {
        const result = await execRelay(sandbox, ctx.method, containerPort, subPath, queryString, ctx)
        ctx.status = result.status
        if (result.contentType) ctx.set('content-type', result.contentType)
        ctx.body = result.body
        return
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn('Exec-relay failed, falling back to direct fetch', { sessionId, error: msg })
      }
    }

    // ── Fallback: direct fetch to proxyUrl ────────────────────────────────────
    if (!session.proxyUrl) {
      ctx.status = 502
      ctx.body = { error: 'No proxy URL available for this session' }
      return
    }

    const targetUrl = `${session.proxyUrl}${subPath}${queryString}`
    log.debug('Direct fetch fallback', { sessionId, targetUrl })

    try {
      const headers: Record<string, string> = {}
      const skipKeys = new Set(['host', 'authorization', 'content-length', 'transfer-encoding', 'connection'])
      for (const [key, val] of Object.entries(ctx.headers)) {
        if (!skipKeys.has(key.toLowerCase()) && typeof val === 'string') headers[key] = val
      }
      if (ctx.headers['content-type']) {
        headers['content-type'] = ctx.headers['content-type'] as string
      }
      // Add endpoint routing headers required by OpenSandbox server proxy
      const endpointHeaders = session.endpointHeaders as Record<string, string> | undefined
      if (endpointHeaders) {
        for (const [k, v] of Object.entries(endpointHeaders)) headers[k] = v
      }

      const fetchInit: RequestInit = {
        method: ctx.method,
        headers,
        signal: AbortSignal.timeout(30000)
      }
      if (!['GET', 'HEAD'].includes(ctx.method) && ctx.request.rawBody) {
        fetchInit.body = ctx.request.rawBody
      }

      const response = await fetch(targetUrl, fetchInit)
      ctx.status = response.status
      const hopByHop = new Set(['transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'proxy-authenticate'])
      response.headers.forEach((val, key) => { if (!hopByHop.has(key.toLowerCase())) ctx.set(key, val) })
      ctx.body = await response.text()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('Direct fetch proxy failed', { sessionId, targetUrl, error: message })
      ctx.status = 502
      ctx.body = { error: 'Failed to reach sandbox', details: message }
    }
  }
}

/**
 * Relay an HTTP request through the OpenSandbox SDK exec channel.
 *
 * Executes `curl` inside the container, which reaches the app server on localhost
 * regardless of Docker networking. Uses python as fallback if curl is unavailable.
 */
async function execRelay(
  sandbox: any,
  method: string,
  port: number,
  path: string,
  queryString: string,
  ctx: any
): Promise<{ status: number; body: string; contentType?: string }> {
  const url = `http://localhost:${port}${path}${queryString}`

  // Build curl args — write JSON body to a temp file to avoid shell-escaping issues
  const args: string[] = ['-s', '-i', '--max-time', '25', '-X', method, `'${url}'`]

  // Forward content-type
  const ct = ctx.headers['content-type']
  if (ct) args.push('-H', `'Content-Type: ${ct}'`)

  // Write body to temp file if present
  const hasBody = !['GET', 'HEAD'].includes(method) && ctx.request.rawBody
  const bodyFile = `/tmp/proxy_body_${Date.now()}`
  if (hasBody) {
    await sandbox.files.writeFiles([{ path: bodyFile, data: ctx.request.rawBody.toString('utf8') }])
    args.push('-d', `@${bodyFile}`)
  }

  const cmd = `curl ${args.join(' ')}; echo "___CURL_EXIT_$?___"`
  const result = await sandbox.commands.run(cmd) as any

  // Collect stdout text from OutputMessage[]
  const stdout: string = (result.logs?.stdout ?? [])
    .map((m: any) => m.text ?? '')
    .join('')

  if (hasBody) {
    // Clean up temp file (best-effort)
    sandbox.commands.run(`rm -f ${bodyFile}`).catch(() => {})
  }

  // Check if curl ran at all
  const exitMatch = stdout.match(/___CURL_EXIT_(\d+)___/)
  const curlExit = exitMatch ? parseInt(exitMatch[1]) : -1

  if (curlExit !== 0 || !exitMatch) {
    throw new Error(`curl exited ${curlExit} — container app may not be running yet`)
  }

  // Parse HTTP response from curl -i output (headers + blank line + body)
  const curlOutput = stdout.slice(0, stdout.lastIndexOf('___CURL_EXIT_'))
  const headerBodySplit = curlOutput.indexOf('\r\n\r\n')
  const headerSection = headerBodySplit >= 0 ? curlOutput.slice(0, headerBodySplit) : curlOutput
  const body = headerBodySplit >= 0 ? curlOutput.slice(headerBodySplit + 4) : ''

  // Extract HTTP status from first header line: "HTTP/1.1 200 OK"
  const statusMatch = headerSection.match(/^HTTP\/\S+\s+(\d{3})/)
  const status = statusMatch ? parseInt(statusMatch[1]) : 200

  // Extract content-type
  const ctMatch = headerSection.match(/content-type:\s*([^\r\n]+)/i)
  const contentType = ctMatch ? ctMatch[1].trim() : undefined

  return { status, body, contentType }
}
