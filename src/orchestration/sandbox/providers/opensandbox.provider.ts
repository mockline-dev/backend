import { Sandbox, ConnectionConfig } from '@alibaba-group/opensandbox'
import { createModuleLogger } from '../../../logging'
import type { ISandboxProvider } from './provider.interface'
import type { SandboxFile, SandboxOptions, SandboxResult } from '../types'

const log = createModuleLogger('opensandbox-provider')

// Commands run after writing files to /workspace
const BUILD_COMMANDS: Record<string, string[]> = {
  typescript: ['cd /workspace && npx tsc --noEmit 2>&1 || true'],
  javascript: ['cd /workspace && node --check src/index.js 2>&1 || true'],
  python: ['cd /workspace && python3 -m py_compile $(find . -name "*.py") 2>&1 || true'],
}

const TEST_COMMANDS: Record<string, string> = {
  typescript: 'cd /workspace && npm test 2>&1 || true',
  javascript: 'cd /workspace && npm test 2>&1 || true',
  python: 'cd /workspace && python3 -m pytest 2>&1 || true',
}

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

    const handleStdout = (msg: any) => {
      stdout += typeof msg === 'string' ? msg : (msg?.text ?? '')
    }
    const handleStderr = (msg: any) => {
      stderr += typeof msg === 'string' ? msg : (msg?.text ?? '')
    }

    try {
      const connectionConfig = new ConnectionConfig({
        domain: this.config.domain,
        apiKey: this.config.apiKey,
        protocol: this.config.protocol,
        requestTimeoutSeconds: Math.ceil(opts.timeoutMs / 1000),
      })

      sandbox = await Sandbox.create({
        connectionConfig,
        image: opts.image || this.config.defaultImage,
        timeoutSeconds: Math.ceil(opts.timeoutMs / 1000) + 30,
        env: { NODE_ENV: 'sandbox' },
      })

      log.debug('Sandbox created', { sandboxId: (sandbox as any).sandboxId, fileCount: files.length })

      // 1. Write all generated files to /workspace
      await sandbox.files.writeFiles(
        files.map((f) => ({
          path: `/workspace/${f.path}`,
          data: f.content,
          mode: 0o644,
        }))
      )

      // 2. Install dependencies if package.json exists
      const hasPackageJson = files.some((f) => f.path === 'package.json' || f.path.endsWith('/package.json'))
      if (hasPackageJson) {
        await sandbox.commands.run(
          'cd /workspace && npm install --prefer-offline 2>&1 || true',
          {},
          { onStdout: handleStdout, onStderr: handleStderr }
        )
      }

      // 3. Run build/compile check
      const language = opts.language || 'typescript'
      const buildCmds = BUILD_COMMANDS[language] ?? BUILD_COMMANDS['typescript']
      let compilationOutput = ''

      for (const cmd of buildCmds) {
        const execResult = await sandbox.commands.run(cmd, {}, {
          onStdout: (msg: any) => { compilationOutput += typeof msg === 'string' ? msg : (msg?.text ?? '') },
          onStderr: (msg: any) => { compilationOutput += typeof msg === 'string' ? msg : (msg?.text ?? '') },
        })
        // execResult.exitCode: 0 = success
        const compilationSuccess = (execResult as any).exitCode === 0
        if (!compilationSuccess) {
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

      // 4. Optionally run tests
      let testOutput: string | null = null
      let testsPassed = true
      if (opts.runTests && TEST_COMMANDS[language]) {
        const testCmd = TEST_COMMANDS[language]
        await sandbox.commands.run(testCmd, {}, {
          onStdout: (msg: any) => { testOutput = (testOutput ?? '') + (typeof msg === 'string' ? msg : (msg?.text ?? '')) },
          onStderr: (msg: any) => { stderr += typeof msg === 'string' ? msg : (msg?.text ?? '') },
        })
        testsPassed = !(testOutput ?? '').includes('FAIL') && !(testOutput ?? '').includes('ERROR')
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
        try {
          await sandbox.kill()
          await sandbox.close()
        } catch {/* non-fatal cleanup */}
      }
    }
  }
}
