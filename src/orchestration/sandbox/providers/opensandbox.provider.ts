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
    manifestFile: string   // e.g. "requirements.txt", "package.json"
    command: string        // e.g. "pip install -r /workspace/requirements.txt"
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
    ],
    testCommand: 'cd /workspace && python3 -m pytest --tb=short -q 2>&1 || true',
    depInstall: {
      manifestFile: 'requirements.txt',
      command: 'pip install --quiet -r /workspace/requirements.txt 2>&1 || true',
    },
    failurePatterns: ['FAILED', 'ERROR', 'error:', 'SyntaxError', 'IndentationError'],
  },

  // ── TypeScript (future) ─────────────────────────────────────────────────────
  typescript: {
    buildCommands: [
      'cd /workspace && npx --yes tsc --noEmit --strict 2>&1 || true',
    ],
    testCommand: 'cd /workspace && npm test 2>&1 || true',
    depInstall: {
      manifestFile: 'package.json',
      command: 'cd /workspace && npm install --prefer-offline --silent 2>&1 || true',
    },
    failurePatterns: ['error TS', 'FAIL', 'Error:'],
  },

  // ── JavaScript (future) ─────────────────────────────────────────────────────
  javascript: {
    buildCommands: [
      'node --check /workspace/index.js 2>&1 || node --check /workspace/src/index.js 2>&1 || true',
    ],
    testCommand: 'cd /workspace && npm test 2>&1 || true',
    depInstall: {
      manifestFile: 'package.json',
      command: 'cd /workspace && npm install --prefer-offline --silent 2>&1 || true',
    },
    failurePatterns: ['SyntaxError', 'FAIL', 'Error:'],
  },
}

// Fallback for any unlisted language — just try to list the files so we know
// the sandbox is working, and report success.
const FALLBACK_CONFIG: LanguageConfig = {
  buildCommands: ['ls /workspace 2>&1'],
  testCommand: 'echo "no test runner configured" 2>&1',
  failurePatterns: [],
}

// ─────────────────────────────────────────────────────────────────────────────

export interface OpenSandboxConfig {
  domain: string
  apiKey: string
  protocol: 'http' | 'https'
  defaultImage: string
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
        useServerProxy: true,
      })

      sandbox = await Sandbox.create({
        connectionConfig,
        image: opts.image || this.config.defaultImage,
        timeoutSeconds: Math.ceil(opts.timeoutMs / 1000) + 30,
        env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' },
      })

      log.debug('Sandbox created', { language: langKey, fileCount: files.length })

      // 1. Write all generated files to /workspace
      await sandbox.files.writeFiles(
        files.map((f) => ({
          path: `/workspace/${f.path}`,
          data: f.content,
          mode: 0o644,
        }))
      )

      // 2. Install dependencies if manifest file is present
      if (lang.depInstall) {
        const hasManifest = files.some((f) =>
          f.path === lang.depInstall!.manifestFile ||
          f.path.endsWith(`/${lang.depInstall!.manifestFile}`)
        )
        if (hasManifest) {
          log.debug('Installing dependencies', { langKey, manifest: lang.depInstall.manifestFile })
          await sandbox.commands.run(lang.depInstall.command, {}, {
            onStdout: capture('stdout'),
            onStderr: capture('stderr'),
          })
        }
      }

      // 3. Syntax / compile check
      let compilationOutput = ''
      for (const cmd of lang.buildCommands) {
        const result = await sandbox.commands.run(cmd, {}, {
          onStdout: (msg: any) => { compilationOutput += typeof msg === 'string' ? msg : (msg?.text ?? '') },
          onStderr: (msg: any) => { compilationOutput += typeof msg === 'string' ? msg : (msg?.text ?? '') },
        })
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
            durationMs: Date.now() - start,
          }
        }
      }

      // 4. Run tests (optional)
      let testOutput: string | null = null
      let testsPassed = true
      if (opts.runTests) {
        await sandbox.commands.run(lang.testCommand, {}, {
          onStdout: (msg: any) => { testOutput = (testOutput ?? '') + (typeof msg === 'string' ? msg : (msg?.text ?? '')) },
          onStderr: capture('stderr'),
        })
        const combined = (testOutput ?? '') + stderr
        testsPassed = !lang.failurePatterns.some((p) => combined.includes(p))
      }

      return {
        success: testsPassed,
        files,
        syntaxValid: true,
        compilationOutput,
        testOutput,
        stdout,
        stderr,
        durationMs: Date.now() - start,
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
        error: error.message,
      }
    } finally {
      if (sandbox) {
        try { await sandbox.kill() } catch {/* non-fatal */}
        try { await sandbox.close() } catch {/* non-fatal */}
      }
    }
  }
}
