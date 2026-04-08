import { Sandbox, ConnectionConfig } from '@alibaba-group/opensandbox'
import { createModuleLogger } from '../../logging'
import { r2Client } from '../../storage/r2.client'

const log = createModuleLogger('sandbox-execution')

export interface ExecutionResult {
  containerId: string
  proxyUrl: string
  endpointHeaders: Record<string, string>
  port: number
  serverReady: boolean
  serverLog: string
}

const SERVER_PORT = 8000

interface ProjectFile {
  path: string
  data: string
  mode: number
}

const DEP_INSTALL_COMMANDS: Record<string, { manifest: string; cmd: string }> = {
  python: {
    manifest: 'requirements.txt',
    // python3 -m pip is more reliable than bare `pip` in slim images.
    // sed strips \r to handle Windows-style line endings in requirements.txt.
    // --no-cache-dir avoids stale cache issues in ephemeral containers.
    cmd: 'python3 -m pip install --no-cache-dir -r <(sed "s/\\r//" /workspace/requirements.txt) 2>&1'
  },
  typescript: {
    manifest: 'package.json',
    cmd: 'cd /workspace && npm install --prefer-offline --silent 2>&1 || true'
  },
  javascript: {
    manifest: 'package.json',
    cmd: 'cd /workspace && npm install --prefer-offline --silent 2>&1 || true'
  }
}

/**
 * Determine the entry point file for a project by scanning file content.
 * Returns the workspace-relative path (e.g. "main.py", "src/index.ts").
 */
function findEntryPoint(files: ProjectFile[], language: string): string {
  // Strip /workspace/ prefix to get relative paths
  const relative = (f: ProjectFile) => f.path.replace('/workspace/', '')

  if (language === 'python') {
    // 1. File with __main__ guard
    const mainGuard = files.find(f => f.data.includes('if __name__') && relative(f).endsWith('.py'))
    if (mainGuard) return relative(mainGuard)

    // 2. FastAPI app — must instantiate the app (not just import from fastapi)
    // Route files import from fastapi too, so require actual app = FastAPI() call
    const fastapiFile = files.find(f =>
      relative(f).endsWith('.py') &&
      (f.data.includes('app = FastAPI(') || f.data.includes('app=FastAPI('))
    )
    if (fastapiFile) return relative(fastapiFile)

    // 3. Flask app — Flask(__name__) is already specific enough
    const flaskFile = files.find(f =>
      relative(f).endsWith('.py') &&
      f.data.includes('Flask(__name__)')
    )
    if (flaskFile) return relative(flaskFile)

    // 4. Known entry point names
    const knownNames = ['main.py', 'app.py', 'server.py', 'run.py']
    for (const name of knownNames) {
      if (files.some(f => relative(f) === name)) return name
    }

    // 5. Any .py file
    const anyPy = files.find(f => relative(f).endsWith('.py'))
    return anyPy ? relative(anyPy) : 'main.py'
  }

  if (language === 'typescript' || language === 'javascript') {
    const isTS = language === 'typescript'
    const ext = isTS ? '.ts' : '.js'

    // 1. Check package.json for main or start script
    const pkgFile = files.find(f => relative(f) === 'package.json')
    if (pkgFile) {
      try {
        const pkg = JSON.parse(pkgFile.data)
        if (pkg.main && typeof pkg.main === 'string') return pkg.main
        if (pkg.scripts?.start) {
          // Extract file from "ts-node src/index.ts" or "node src/index.js"
          const startMatch = pkg.scripts.start.match(/(?:ts-node|tsx|node)\s+(\S+)/)
          if (startMatch) return startMatch[1]
        }
      } catch {
        // Ignore parse errors
      }
    }

    // 2. File with app.listen() or createServer
    const serverFile = files.find(f =>
      (relative(f).endsWith(ext) || relative(f).endsWith('.ts') || relative(f).endsWith('.js')) &&
      (f.data.includes('app.listen(') || f.data.includes('createServer(') ||
       f.data.includes('.listen('))
    )
    if (serverFile) return relative(serverFile)

    // 3. Known entry point names
    const knownNames = isTS
      ? ['src/index.ts', 'index.ts', 'src/app.ts', 'app.ts', 'src/server.ts', 'server.ts']
      : ['src/index.js', 'index.js', 'src/app.js', 'app.js', 'src/server.js', 'server.js']
    for (const name of knownNames) {
      if (files.some(f => relative(f) === name)) return name
    }

    // 4. Any matching file
    const anyMatch = files.find(f => relative(f).endsWith(ext))
    return anyMatch ? relative(anyMatch) : `index${ext}`
  }

  return 'main.py'
}

/**
 * Build the start commands for a given language and entry point.
 */
function buildStartCommands(language: string, entryFile: string, files: ProjectFile[]): string[] {
  const relative = (f: ProjectFile) => f.path.replace('/workspace/', '')

  if (language === 'python') {
    // Detect if FastAPI is being used → prefer uvicorn
    const hasFastAPI = files.some(f =>
      f.data.toLowerCase().includes('from fastapi') ||
      f.data.includes('FastAPI()')
    )

    if (hasFastAPI) {
      // Derive uvicorn module path from entry file (e.g. main.py → main:app, src/main.py → src.main:app)
      const moduleBase = entryFile.replace('.py', '').replace(/\//g, '.')
      return [
        `cd /workspace && (uvicorn ${moduleBase}:app --host 0.0.0.0 --port ${SERVER_PORT} > /tmp/server.log 2>&1 || python3 ${entryFile} > /tmp/server.log 2>&1) &`
      ]
    }

    const hasFlask = files.some(f =>
      f.data.toLowerCase().includes('from flask') ||
      f.data.includes('Flask(__name__)')
    )

    if (hasFlask) {
      return [`cd /workspace && python3 ${entryFile} > /tmp/server.log 2>&1 &`]
    }

    return [`cd /workspace && python3 ${entryFile} > /tmp/server.log 2>&1 &`]
  }

  if (language === 'typescript') {
    const hasPackageJson = files.some(f => relative(f) === 'package.json')
    const installCmd = hasPackageJson
      ? 'cd /workspace && npm install --silent 2>/dev/null || true'
      : 'true'

    return [
      installCmd,
      `cd /workspace && (npx tsx ${entryFile} > /tmp/server.log 2>&1 || npx ts-node ${entryFile} > /tmp/server.log 2>&1 || node ${entryFile.replace('.ts', '.js')} > /tmp/server.log 2>&1) &`
    ]
  }

  if (language === 'javascript') {
    const hasPackageJson = files.some(f => relative(f) === 'package.json')
    const installCmd = hasPackageJson
      ? 'cd /workspace && npm install --silent 2>/dev/null || true'
      : 'true'

    return [
      installCmd,
      `cd /workspace && node ${entryFile} > /tmp/server.log 2>&1 &`
    ]
  }

  // Fallback
  return [`cd /workspace && python3 main.py > /tmp/server.log 2>&1 &`]
}

type EmitFn = (event: string, projectId: string, payload: unknown) => void

/**
 * Starts a long-lived sandbox container with all project files,
 * installs dependencies, and starts the server process.
 * Returns the container reference and proxy URL.
 */
export async function startProjectExecution(
  projectId: string,
  language: string,
  sandboxConfig: any,
  emit?: EmitFn
): Promise<ExecutionResult & { sandbox: Sandbox }> {
  log.info('Starting project execution sandbox', { projectId, language })

  // Fetch all project files from R2
  const objects = await r2Client.listObjects(`projects/${projectId}/`)
  if (objects.length === 0) {
    throw new Error('No project files found — generate the project first')
  }

  const files: ProjectFile[] = []
  for (const obj of objects) {
    try {
      // r2Client.getObject returns a string directly — no stream iteration needed
      const content = await r2Client.getObject(obj.key)
      if (!content) continue
      const relativePath = obj.key.replace(`projects/${projectId}/`, '')
      files.push({ path: `/workspace/${relativePath}`, data: content, mode: 0o644 })
    } catch (err: unknown) {
      log.warn('Failed to fetch file from R2', {
        key: obj.key,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  if (files.length === 0) {
    throw new Error('Could not fetch any project files from storage')
  }

  const executionTimeout = sandboxConfig.executionTimeoutMs ?? 300000
  const connectionConfig = new ConnectionConfig({
    domain: sandboxConfig.opensandbox.domain,
    apiKey: sandboxConfig.opensandbox.apiKey,
    protocol: sandboxConfig.opensandbox.protocol,
    requestTimeoutSeconds: Math.ceil(executionTimeout / 1000),
    useServerProxy: true
  })

  const sandbox = await Sandbox.create({
    connectionConfig,
    image: sandboxConfig.opensandbox.defaultImage,
    timeoutSeconds: Math.ceil(executionTimeout / 1000) + 30,
    env: {
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUNBUFFERED: '1',
      PORT: String(SERVER_PORT)
    }
  })

  log.debug('Execution sandbox created', { projectId, fileCount: files.length })

  try {
    // Write all project files
    await sandbox.files.writeFiles(files)

    // Install dependencies if manifest present
    const depConfig = DEP_INSTALL_COMMANDS[language] ?? DEP_INSTALL_COMMANDS['python']
    const hasManifest = files.some(f => f.path.endsWith(`/${depConfig.manifest}`))
    if (hasManifest) {
      log.info('Installing dependencies', { projectId, language, cmd: depConfig.cmd })
      let pipOutput = ''
      const depResult = await sandbox.commands.run(depConfig.cmd, {}, {
        onStdout: (msg: any) => {
          const text = typeof msg === 'string' ? msg : (msg?.text ?? '')
          pipOutput += text
          emit?.('terminal:stdout', projectId, { phase: 'deps', text })
        },
        onStderr: (msg: any) => {
          const text = typeof msg === 'string' ? msg : (msg?.text ?? '')
          pipOutput += text
          emit?.('terminal:stderr', projectId, { phase: 'deps', text })
        }
      }).catch((err: any) => {
        log.warn('Dependency install error (non-fatal)', { projectId, error: err?.message })
      })
      const depExitCode = (depResult as any)?.exitCode
      if (pipOutput) {
        log.info('Dependency install output', { projectId, output: pipOutput.slice(0, 2000) })
      }
      if (depExitCode !== 0 && depExitCode != null) {
        const msg = `Dependency installation failed (exit ${depExitCode}). Check requirements.txt and network access.`
        log.error(msg, { projectId, exitCode: depExitCode })
        emit?.('terminal:stderr', projectId, { phase: 'deps', text: `\n[ERROR] ${msg}\n` })
        throw new Error(msg)
      }
      log.info('Dependency install complete', { projectId, exitCode: depExitCode })
    }

    // Dynamically find entry point and build start commands
    const entryPoint = findEntryPoint(files, language)
    const startCmds = buildStartCommands(language, entryPoint, files)
    log.debug('Starting server', { projectId, entryPoint, language })

    // Create server log file first so tail can start immediately (A3)
    await sandbox.commands.run('touch /tmp/server.log').catch(() => {})

    // Start tailing server log BEFORE launching server — captures output from byte 0,
    // including crash tracebacks that appear before the port opens (A3)
    log.debug('Starting server log tail', { projectId })
    sandbox.commands.run('tail -n +1 -f /tmp/server.log 2>/dev/null', {}, {
      onStdout: (msg: any) => {
        const text = typeof msg === 'string' ? msg : (msg?.text ?? '')
        emit?.('terminal:stdout', projectId, { phase: 'server', text })
      },
      onStderr: (msg: any) => {
        const text = typeof msg === 'string' ? msg : (msg?.text ?? '')
        emit?.('terminal:stderr', projectId, { phase: 'server', text })
      }
    }).catch(() => { /* non-fatal — tail exits when sandbox is killed */ })

    // Run start commands. Output is redirected to /tmp/server.log (backgrounded with &),
    // so stdout/stderr callbacks would never fire — emit the command text instead (A4)
    for (const cmd of startCmds) {
      log.info('Running start command', { projectId, cmd })
      emit?.('terminal:stdout', projectId, { phase: 'start', text: `$ ${cmd}\n` })
      await sandbox.commands.run(cmd).catch((err: any) => {
        log.warn('Start command error (non-fatal)', { projectId, cmd, error: err?.message })
      })
    }

    log.info('Waiting for server to be ready', { projectId, port: SERVER_PORT })

    // Poll for server readiness (max 30s) and get external URL + routing headers
    const { proxyUrl, endpointHeaders, serverReady, serverLog } = await waitForServer(sandbox, SERVER_PORT, 30000)
    log.info('Execution sandbox server ready', { projectId, proxyUrl, entryPoint, serverReady })

    // Extract containerId from sandbox internals (best-effort)
    const containerId = (sandbox as any).id ?? (sandbox as any).containerId ?? 'unknown'

    return { containerId, proxyUrl, endpointHeaders, port: SERVER_PORT, sandbox, serverReady, serverLog }
  } catch (err) {
    // Kill the sandbox container on any startup failure to prevent resource leaks.
    // Without this, the container stays alive until OpenSandbox's timeout.
    log.warn('Startup failed — killing orphaned sandbox', { projectId })
    await sandbox.kill().catch(() => {})
    await sandbox.close().catch(() => {})
    throw err
  }
}

async function waitForServer(
  sandbox: Sandbox,
  port: number,
  timeoutMs: number
): Promise<{ proxyUrl: string; endpointHeaders: Record<string, string>; serverReady: boolean; serverLog: string }> {
  // Use Python's socket module — always available, unlike nc which isn't in python:3.11-slim.
  const maxAttempts = Math.max(5, Math.floor(timeoutMs / 2000))
  const pyPortCheck = `python3 -c "
import socket,time,sys
for _ in range(${maxAttempts}):
 try:socket.create_connection(('localhost',${port}),1).close();sys.exit(0)
 except:time.sleep(2)
sys.exit(1)
"`

  let portOpen = false
  try {
    const result = await sandbox.commands.run(pyPortCheck, { timeoutSeconds: Math.ceil(timeoutMs / 1000) + 5 }) as any
    portOpen = result.exitCode === 0
    if (!portOpen) {
      log.warn('Server did not open port within timeout', { port, maxAttempts })
    }
  } catch (err: unknown) {
    log.warn('Port check failed', { port, error: err instanceof Error ? err.message : String(err) })
  }

  // HTTP health check: port open but server might not be serving yet (A2)
  let serverReady = portOpen
  if (portOpen) {
    try {
      const pyHttpCheck = `python3 -c "
import urllib.request, urllib.error, sys
try:
 urllib.request.urlopen('http://localhost:${port}/', timeout=5)
except urllib.error.HTTPError:
 sys.exit(0)
except Exception as e:
 print(str(e), end='')
 sys.exit(1)
"`
      const httpResult = await sandbox.commands.run(pyHttpCheck, { timeoutSeconds: 10 }) as any
      if (httpResult.exitCode !== 0) {
        log.warn('HTTP health check failed — port open but server not serving', { port })
        serverReady = false
      }
    } catch {
      serverReady = false
    }
  }

  // Read server log — always useful for both success and failure diagnostics (A1)
  let serverLog = ''
  try {
    const logResult = await sandbox.commands.run('cat /tmp/server.log 2>/dev/null || echo ""', { timeoutSeconds: 5 }) as any
    serverLog = (logResult.logs?.stdout ?? []).map((m: any) => m.text ?? '').join('')
  } catch { /* non-fatal */ }

  // Get endpoint URL (best-effort regardless of server status)
  try {
    const ep = await sandbox.getEndpoint(port)
    const proxyUrl = `${sandbox.connectionConfig.protocol}://${ep.endpoint}`
    const endpointHeaders = (ep.headers as Record<string, string>) ?? {}
    if (portOpen) log.info('Server port is open', { port, proxyUrl })
    return { proxyUrl, endpointHeaders, serverReady, serverLog }
  } catch {
    return { proxyUrl: `http://localhost:${port}`, endpointHeaders: {}, serverReady, serverLog }
  }
}

/**
 * Stops and cleans up an execution sandbox.
 */
export async function stopProjectExecution(sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.kill()
  } catch {
    /* non-fatal */
  }
  try {
    await sandbox.close()
  } catch {
    /* non-fatal */
  }
}
