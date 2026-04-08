import { Sandbox, ConnectionConfig } from '@alibaba-group/opensandbox'
import { createModuleLogger } from '../../../logging'
import type { ISandboxProvider } from './provider.interface'
import type { SandboxFile, SandboxOptions, SandboxResult } from '../types'

const log = createModuleLogger('opensandbox-provider')

// ─── Language Configuration ───────────────────────────────────────────────────
// Each entry defines how to validate and test code in a given language.
// To add a new language: add an entry here — no other code needs changing.

interface LanguageConfig {
  /** Commands to check syntax / compile. Exit code 0 = success. */
  buildCommands: string[]
  /** Command to run tests (only used when opts.runTests = true). */
  testCommand: string
  /** Install dependencies if a manifest file is present. */
  depInstall?: {
    manifestFile: string // e.g. "requirements.txt", "package.json"
    command: string // e.g. "pip install -r /workspace/requirements.txt"
  }
  /** Patterns that indicate a failed test run in stdout/stderr. */
  failurePatterns: string[]
}

const LANGUAGE_CONFIG: Record<string, LanguageConfig> = {
  // ── Python (primary) ────────────────────────────────────────────────────────
  python: {
    buildCommands: [
      // Syntax-check every .py file — fast, no execution
      'python3 -m py_compile $(find /workspace -name "*.py" | head -50) 2>&1',
      // Verify all third-party imports are actually installed.
      // py_compile only catches syntax errors, not missing modules.
      // This walks all .py files, parses import statements via AST,
      // and tries __import__() for any non-stdlib, non-local module.
      `python3 -c "
import ast,os,sys
missing=[]
ws='/workspace'
for root,dirs,files in os.walk(ws):
 dirs[:]=[d for d in dirs if d!='__pycache__' and not d.startswith('.')]
 for fname in files:
  if not fname.endswith('.py'):continue
  try:src=open(os.path.join(root,fname)).read();tree=ast.parse(src)
  except:continue
  for node in ast.walk(tree):
   mods=[]
   if isinstance(node,ast.Import):mods=[a.name.split('.')[0] for a in node.names]
   elif isinstance(node,ast.ImportFrom) and node.module and not node.level:mods=[node.module.split('.')[0]]
   for mod in mods:
    if mod in sys.stdlib_module_names:continue
    if os.path.exists(f'{ws}/{mod}.py') or os.path.exists(f'{ws}/{mod}/__init__.py'):continue
    try:__import__(mod)
    except ImportError:missing.append(mod)
if missing:
 unique=list(set(missing))
 print(f'Missing modules (not installed): {unique}',file=sys.stderr)
 sys.exit(1)
" 2>&1`
    ],
    testCommand: 'cd /workspace && python3 -m pytest --tb=short -q 2>&1 || true',
    depInstall: {
      manifestFile: 'requirements.txt',
      command: 'python3 -m pip install --no-cache-dir --quiet -r /workspace/requirements.txt 2>&1'
    },
    failurePatterns: ['FAILED', 'ERROR', 'error:', 'SyntaxError', 'IndentationError']
  },

  // ── TypeScript (future) ─────────────────────────────────────────────────────
  typescript: {
    buildCommands: ['cd /workspace && npx --yes tsc --noEmit --strict 2>&1 || true'],
    testCommand: 'cd /workspace && npm test 2>&1 || true',
    depInstall: {
      manifestFile: 'package.json',
      command: 'cd /workspace && npm install --prefer-offline --silent 2>&1'
    },
    failurePatterns: ['error TS', 'FAIL', 'Error:']
  },

  // ── JavaScript (future) ─────────────────────────────────────────────────────
  javascript: {
    buildCommands: [
      'node --check /workspace/index.js 2>&1 || node --check /workspace/src/index.js 2>&1 || true'
    ],
    testCommand: 'cd /workspace && npm test 2>&1 || true',
    depInstall: {
      manifestFile: 'package.json',
      command: 'cd /workspace && npm install --prefer-offline --silent 2>&1'
    },
    failurePatterns: ['SyntaxError', 'FAIL', 'Error:']
  }
}

// Fallback for any unlisted language — just try to list the files so we know
// the sandbox is working, and report success.
const FALLBACK_CONFIG: LanguageConfig = {
  buildCommands: ['ls /workspace 2>&1'],
  testCommand: 'echo "no test runner configured" 2>&1',
  failurePatterns: []
}

// ─────────────────────────────────────────────────────────────────────────────

export interface OpenSandboxConfig {
  domain: string
  apiKey: string
  protocol: 'http' | 'https'
  defaultImage: string
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect a likely server entry point from the file list.
 */
function detectEntryPoint(files: SandboxFile[], language: string): string | null {
  if (language === 'python') {
    const mainGuard = files.find(f => f.content.includes('if __name__') && f.path.endsWith('.py'))
    if (mainGuard) return mainGuard.path
    const known = ['main.py', 'app.py', 'server.py', 'run.py']
    for (const name of known) {
      const found = files.find(f => f.path === name || f.path.endsWith('/' + name))
      if (found) return found.path
    }
    const anyPy = files.find(f => f.path.endsWith('.py'))
    return anyPy ? anyPy.path : null
  }
  return null
}

/**
 * Build a background start command for the validation sandbox startup check.
 */
function buildValidationStartCmd(files: SandboxFile[], language: string, entryPoint: string): string {
  if (language === 'python') {
    const hasFastAPI = files.some(f =>
      f.content.includes('app = FastAPI(') || f.content.includes('app=FastAPI(')
    )
    if (hasFastAPI) {
      const moduleBase = entryPoint.replace('.py', '').replace(/\//g, '.')
      return `cd /workspace && (uvicorn ${moduleBase}:app --host 0.0.0.0 --port 8000 > /tmp/server.log 2>&1 || python3 ${entryPoint} > /tmp/server.log 2>&1) &`
    }
    return `cd /workspace && python3 ${entryPoint} > /tmp/server.log 2>&1 &`
  }
  return `cd /workspace && python3 main.py > /tmp/server.log 2>&1 &`
}

export class OpenSandboxProvider implements ISandboxProvider {
  readonly name = 'opensandbox'

  constructor(private config: OpenSandboxConfig) {}

  async execute(files: SandboxFile[], opts: SandboxOptions): Promise<SandboxResult> {
    const start = Date.now()
    let sandbox: Sandbox | null = null
    let stdout = ''
    let stderr = ''

    const capture = (target: 'stdout' | 'stderr') => (msg: any) => {
      const text = typeof msg === 'string' ? msg : (msg?.text ?? '')
      if (target === 'stdout') stdout += text
      else stderr += text
    }

    const langKey = opts.language || 'python'
    const lang = LANGUAGE_CONFIG[langKey] ?? FALLBACK_CONFIG

    try {
      const connectionConfig = new ConnectionConfig({
        domain: this.config.domain,
        apiKey: this.config.apiKey,
        protocol: this.config.protocol,
        requestTimeoutSeconds: Math.ceil(opts.timeoutMs / 1000),
        // Required when the OpenSandbox server runs in Docker.
        // Without this, sandbox containers try to call back to localhost:8080
        // from inside their container network and fail with a health-check timeout.
        // useServerProxy routes all container↔server traffic through the SDK instead.
        useServerProxy: true
      })

      sandbox = await Sandbox.create({
        connectionConfig,
        image: opts.image || this.config.defaultImage,
        timeoutSeconds: Math.ceil(opts.timeoutMs / 1000) + 30,
        env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' }
      })

      log.debug('Sandbox created', { language: langKey, fileCount: files.length })

      // 1. Write all generated files to /workspace
      await sandbox.files.writeFiles(
        files.map(f => ({
          path: `/workspace/${f.path}`,
          data: f.content,
          mode: 0o644
        }))
      )

      // 2. Install dependencies if manifest file is present
      if (lang.depInstall) {
        const hasManifest = files.some(
          f =>
            f.path === lang.depInstall!.manifestFile || f.path.endsWith(`/${lang.depInstall!.manifestFile}`)
        )
        if (hasManifest) {
          log.debug('Installing dependencies', { langKey, manifest: lang.depInstall.manifestFile })
          const depResult = await sandbox.commands.run(
            lang.depInstall.command,
            {},
            {
              onStdout: capture('stdout'),
              onStderr: capture('stderr')
            }
          )
          const depExitCode = (depResult as any).exitCode ?? 0
          if (depExitCode !== 0) {
            log.debug('Dependency install failed', { langKey, depExitCode, output: stdout.slice(0, 300) })
            return {
              success: false,
              files,
              syntaxValid: true,
              compilationOutput: `Dependency installation failed (exit ${depExitCode}):\n${stdout}\n${stderr}`.trim(),
              testOutput: null,
              stdout,
              stderr,
              durationMs: Date.now() - start
            }
          }
        }
      }

      // 3. Syntax / compile check
      let compilationOutput = ''
      for (const cmd of lang.buildCommands) {
        const result = await sandbox.commands.run(
          cmd,
          {},
          {
            onStdout: (msg: any) => {
              compilationOutput += typeof msg === 'string' ? msg : (msg?.text ?? '')
            },
            onStderr: (msg: any) => {
              compilationOutput += typeof msg === 'string' ? msg : (msg?.text ?? '')
            }
          }
        )
        const exitCode = (result as any).exitCode ?? 0
        if (exitCode !== 0) {
          log.debug('Compilation failed', { langKey, exitCode, output: compilationOutput.slice(0, 200) })
          return {
            success: false,
            files,
            syntaxValid: false,
            compilationOutput,
            testOutput: null,
            stdout,
            stderr,
            durationMs: Date.now() - start
          }
        }
      }

      // 4. Server startup check (optional — GenerateProject only)
      if (opts.checkServerStart) {
        const entryPoint = detectEntryPoint(files, langKey)
        if (entryPoint) {
          const startCmd = buildValidationStartCmd(files, langKey, entryPoint)
          log.debug('Running server startup check', { langKey, entryPoint, startCmd })

          // Touch log file and start server in background
          await sandbox.commands.run('touch /tmp/server.log')
          await sandbox.commands.run(startCmd).catch(() => {})

          // Poll for port 8000 (max 10s)
          const pyPortCheck = `python3 -c "
import socket,time,sys
for _ in range(5):
 try:socket.create_connection(('localhost',8000),1).close();sys.exit(0)
 except:time.sleep(2)
sys.exit(1)
"`
          const portResult = await sandbox.commands.run(pyPortCheck, { timeoutSeconds: 15 }) as any
          const portOpen = (portResult as any).exitCode === 0

          // HTTP health check
          let httpOk = false
          if (portOpen) {
            try {
              const pyHttpCheck = `python3 -c "
import urllib.request, urllib.error, sys
try:
 urllib.request.urlopen('http://localhost:8000/', timeout=5)
except urllib.error.HTTPError:
 sys.exit(0)
except Exception as e:
 print(str(e), end='')
 sys.exit(1)
"`
              const httpResult = await sandbox.commands.run(pyHttpCheck, { timeoutSeconds: 10 }) as any
              httpOk = (httpResult as any).exitCode === 0
            } catch { /* non-fatal */ }
          }

          // Read server log for diagnostics
          let serverStartLog = ''
          try {
            const logResult = await sandbox.commands.run('cat /tmp/server.log 2>/dev/null || echo ""', { timeoutSeconds: 5 }) as any
            serverStartLog = (logResult.logs?.stdout ?? []).map((m: any) => m.text ?? '').join('')
          } catch { /* non-fatal */ }

          if (!portOpen || !httpOk) {
            log.debug('Server startup check failed', { langKey, portOpen, httpOk, serverStartLog: serverStartLog.slice(0, 200) })
            return {
              success: false,
              files,
              syntaxValid: true,
              compilationOutput: `Server failed to start within 10s.\n${serverStartLog}`.trim(),
              testOutput: null,
              stdout,
              stderr,
              durationMs: Date.now() - start
            }
          }

          log.debug('Server startup check passed', { langKey, entryPoint })
        }
      }

      // 5. Run tests (optional)
      let testOutput: string | null = null
      let testsPassed = true
      if (opts.runTests) {
        await sandbox.commands.run(
          lang.testCommand,
          {},
          {
            onStdout: (msg: any) => {
              testOutput = (testOutput ?? '') + (typeof msg === 'string' ? msg : (msg?.text ?? ''))
            },
            onStderr: capture('stderr')
          }
        )
        const combined = (testOutput ?? '') + stderr
        testsPassed = !lang.failurePatterns.some(p => combined.includes(p))
      }

      return {
        success: testsPassed,
        files,
        syntaxValid: true,
        compilationOutput,
        testOutput,
        stdout,
        stderr,
        durationMs: Date.now() - start
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err))
      log.error('OpenSandbox execution failed', { error: error.message })
      return {
        success: false,
        files,
        syntaxValid: false,
        compilationOutput: null,
        testOutput: null,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        error: error.message
      }
    } finally {
      if (sandbox) {
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
    }
  }
}
