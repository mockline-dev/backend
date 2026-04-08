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

    // ── Debug endpoint: GET /api-test/:sessionId/_debug ───────────────────────
    // Returns full diagnostic info without proxying — use this to isolate backend vs frontend issues.
    if (ctx.method === 'GET' && subPath === '/_debug') {
      const sandbox = getActiveSandbox(sessionId)
      const debug: Record<string, any> = {
        session: {
          id: sessionId,
          status: session.status,
          proxyUrl: session.proxyUrl,
          port: containerPort,
          containerId: session.containerId,
          endpointHeaders: session.endpointHeaders,
          startedAt: session.startedAt
        },
        sandbox: { active: !!sandbox }
      }

      // Try exec-relay test (ping localhost inside container)
      if (sandbox) {
        try {
          const pingResult = await execRelay(sandbox, 'GET', containerPort, '/openapi.json', '', ctx)
          debug.execRelay = { ok: pingResult.status >= 200 && pingResult.status < 300, status: pingResult.status, bodyLength: pingResult.body?.length, contentType: pingResult.contentType }
        } catch (err: any) {
          debug.execRelay = { ok: false, error: err?.message }
        }

        // Read server log to show why the server may have failed to start
        try {
          const logResult = await sandbox.commands.run('cat /tmp/server.log 2>/dev/null || echo "(no server log found)"', { timeoutSeconds: 5 }) as any
          const serverLog = (logResult.logs?.stdout ?? []).map((m: any) => m.text ?? '').join('')
          debug.serverLog = serverLog.slice(-3000) // last 3000 chars
        } catch {
          debug.serverLog = '(could not read server log)'
        }

        // List workspace files
        try {
          const lsResult = await sandbox.commands.run('find /workspace -type f 2>/dev/null | head -30', { timeoutSeconds: 5 }) as any
          const listing = (lsResult.logs?.stdout ?? []).map((m: any) => m.text ?? '').join('\n')
          debug.workspaceFiles = listing.trim().split('\n').filter(Boolean)
        } catch {
          debug.workspaceFiles = []
        }

        // Check if port 8000 is open right now
        try {
          const portResult = await sandbox.commands.run(`python3 -c "import socket; s=socket.create_connection(('localhost',${containerPort}),1); s.close(); print('open')" 2>/dev/null || echo "closed"`, { timeoutSeconds: 5 }) as any
          const portStatus = (portResult.logs?.stdout ?? []).map((m: any) => m.text ?? '').join('').trim()
          debug.port8000 = portStatus
        } catch {
          debug.port8000 = 'unknown'
        }

        // Process list — shows whether server process is running (D2)
        try {
          const psResult = await sandbox.commands.run('ps aux 2>/dev/null | head -20', { timeoutSeconds: 5 }) as any
          const processList = (psResult.logs?.stdout ?? []).map((m: any) => m.text ?? '').join('')
          debug.processList = processList.trim()
        } catch {
          debug.processList = '(could not read process list)'
        }
      } else {
        debug.execRelay = { ok: false, error: 'No active sandbox in memory (server may have restarted)' }
      }

      // Try direct fetch test
      if (session.proxyUrl) {
        const testUrl = `${session.proxyUrl}/openapi.json`
        try {
          const headers: Record<string, string> = {}
          const endpointHeaders = session.endpointHeaders as Record<string, string> | undefined
          if (endpointHeaders) Object.assign(headers, endpointHeaders)
          const resp = await fetch(testUrl, { method: 'GET', headers, signal: AbortSignal.timeout(10000) })
          const body = await resp.text()
          debug.directFetch = { ok: resp.ok, status: resp.status, bodyLength: body.length, url: testUrl }
        } catch (err: any) {
          debug.directFetch = { ok: false, error: err?.message, url: testUrl }
        }
      } else {
        debug.directFetch = { ok: false, error: 'No proxyUrl stored on session' }
      }

      ctx.status = 200
      ctx.set('content-type', 'application/json')
      ctx.body = JSON.stringify(debug, null, 2)
      return
    }

    log.info('Proxying request', { sessionId, method: ctx.method, path: subPath })

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
        log.info('Exec-relay failed, falling back to direct fetch', { sessionId, error: msg })
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

      // Include server log to help diagnose startup failures (D1)
      let serverLog: string | undefined
      const sandboxForLog = getActiveSandbox(sessionId)
      if (sandboxForLog) {
        try {
          const logResult = await sandboxForLog.commands.run('cat /tmp/server.log 2>/dev/null || echo "(no server log)"', { timeoutSeconds: 5 }) as any
          serverLog = (logResult.logs?.stdout ?? []).map((m: any) => m.text ?? '').join('').slice(-2000)
        } catch { /* non-fatal */ }
      }

      ctx.status = 502
      ctx.body = {
        error: 'Failed to reach sandbox',
        details: message,
        ...(serverLog ? { serverLog, hint: 'Check serverLog for startup errors' } : {})
      }
    }
  }
}

/**
 * Relay an HTTP request through the OpenSandbox SDK exec channel.
 *
 * Tries curl first (faster), then python3 urllib as fallback (always available in Python containers).
 * Uses curl's -w flag for structured output — avoids fragile CRLF header parsing.
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
  const ct = ctx.headers['content-type'] as string | undefined
  const hasBody = !['GET', 'HEAD'].includes(method) && ctx.request.rawBody
  const bodyFile = `/tmp/proxy_body_${Date.now()}`

  if (hasBody) {
    await sandbox.files.writeFiles([{ path: bodyFile, data: ctx.request.rawBody.toString('utf8') }])
  }

  try {
    // ── Attempt 1: curl with -w markers (no -i; avoids CRLF parsing issues) ─────
    // Output format: <body>___STATUS_NNN___CT_<content-type>___
    const curlArgs = ['-s', '--max-time', '20', '-X', method, `'${url}'`]
    if (ct) curlArgs.push('-H', `'Content-Type: ${ct}'`)
    if (hasBody) curlArgs.push('-d', `@${bodyFile}`)
    curlArgs.push('-w', `'\\n___STATUS_%{http_code}___CT_%{content_type}___'`)

    const curlCmd = `curl ${curlArgs.join(' ')}; echo "___EXIT_$?___"`
    const curlResult = await sandbox.commands.run(curlCmd, { timeoutSeconds: 25 }) as any
    const curlStdout: string = (curlResult.logs?.stdout ?? []).map((m: any) => m.text ?? '').join('')

    const curlExitMatch = curlStdout.match(/___EXIT_(\d+)___/)
    const curlExit = curlExitMatch ? parseInt(curlExitMatch[1]) : -1

    if (curlExit === 0) {
      // Parse markers — body is everything before the ___STATUS_ marker
      const markerIdx = curlStdout.lastIndexOf('\n___STATUS_')
      const body = markerIdx >= 0 ? curlStdout.slice(0, markerIdx) : ''
      const statusMatch = curlStdout.match(/___STATUS_(\d{3})___/)
      const status = statusMatch ? parseInt(statusMatch[1]) : 200
      const ctMatch = curlStdout.match(/___CT_([^_\n\r]*)___/)
      const contentType = ctMatch?.[1]?.trim() || undefined
      return { status, body, contentType }
    }

    // curl not installed (exit 127) or other error — fall through to python3
    if (curlExit !== 127) {
      throw new Error(`curl exited ${curlExit}`)
    }

    // ── Attempt 2: python3 urllib (always available in Python containers) ────────
    // Writes a JSON result to stdout: {"status":200,"ct":"...","body":"..."}
    const escapedUrl = url.replace(/'/g, "\\'")
    const escapedMethod = method.replace(/'/g, "\\'")
    const bodyArg = hasBody ? `, data=open('${bodyFile}','rb').read()` : ''
    const ctArg = ct ? `req.add_header('Content-Type', '${ct.replace(/'/g, "\\'")}')` : ''
    const pyScript = [
      'import urllib.request, json, sys',
      `req = urllib.request.Request('${escapedUrl}', method='${escapedMethod}'${bodyArg})`,
      ctArg,
      'try:',
      '  with urllib.request.urlopen(req, timeout=20) as r:',
      '    body = r.read().decode("utf-8", errors="replace")',
      '    ct = r.headers.get("Content-Type", "")',
      '    sys.stdout.write(json.dumps({"status": r.status, "ct": ct, "body": body}))',
      'except urllib.error.HTTPError as e:',
      '  body = e.read().decode("utf-8", errors="replace")',
      '  ct = e.headers.get("Content-Type", "")',
      '  sys.stdout.write(json.dumps({"status": e.code, "ct": ct, "body": body}))',
      'except Exception as e:',
      '  sys.stdout.write(json.dumps({"status": 0, "ct": "", "body": "", "error": str(e)}))',
    ].join('; ')

    const pyResult = await sandbox.commands.run(`python3 -c "${pyScript.replace(/"/g, '\\"')}"`, { timeoutSeconds: 25 }) as any
    const pyStdout: string = (pyResult.logs?.stdout ?? []).map((m: any) => m.text ?? '').join('')

    const parsed = JSON.parse(pyStdout)
    if (parsed.error) {
      throw new Error(`python3 relay: ${parsed.error}`)
    }
    return {
      status: parsed.status ?? 200,
      body: parsed.body ?? '',
      contentType: parsed.ct || undefined
    }
  } finally {
    if (hasBody) {
      sandbox.commands.run(`rm -f ${bodyFile}`).catch(() => {})
    }
  }
}
