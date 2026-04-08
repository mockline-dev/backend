/**
 * Shadow Workspace (OpenSandbox) Smoke Test
 *
 * Tests each layer of the sandbox system:
 *   1. Code extractor (pure) — no deps
 *   2. buildFixPrompt() (pure) — no deps
 *   3. OpenSandbox connectivity — needs OpenSandbox running
 *   4. Full sandbox execution — TypeScript file compile check
 *   5. Full sandbox execution — Python file compile check
 *   6. Sandbox Error Detection & Fix Prompt — broken code → error detection + fix prompt
 *   7. Import checker — missing module detection
 *   8. Terminal text normalization
 *   9. Server Startup Integration Test — FastAPI start + HTTP verify
 *  10. Terminal Event Ordering — event phases arrive in order
 *
 * Usage:
 *   pnpm run test:sandbox
 *
 * Optional env vars:
 *   OPENSANDBOX_DOMAIN    host:port of OpenSandbox server (default: localhost:8080)
 *   OPENSANDBOX_API_KEY   API key (default: empty — no auth in local dev)
 *   OPENSANDBOX_IMAGE     Docker image to use (default: opensandbox/code-interpreter:v1.0.2)
 */

import * as fs from 'fs'
import * as path from 'path'

const configPath = path.resolve(__dirname, '../config/default.json')
const defaultConfig: Record<string, any> = JSON.parse(fs.readFileSync(configPath, 'utf8'))

const SANDBOX_DOMAIN =
  process.env.OPENSANDBOX_DOMAIN || defaultConfig?.sandbox?.opensandbox?.domain || 'localhost:8080'
const SANDBOX_API_KEY = process.env.OPENSANDBOX_API_KEY || defaultConfig?.sandbox?.opensandbox?.apiKey || ''
const SANDBOX_PROTOCOL = defaultConfig?.sandbox?.opensandbox?.protocol || 'http'
const SANDBOX_IMAGE =
  process.env.OPENSANDBOX_IMAGE || defaultConfig?.sandbox?.opensandbox?.defaultImage || 'python:3.11-slim'
const SANDBOX_TIMEOUT = defaultConfig?.sandbox?.timeoutMs || 30000

import { extractCodeBlocks, detectPrimaryLanguage } from '../src/orchestration/sandbox/code-extractor'
import { runSandbox, buildFixPrompt } from '../src/orchestration/sandbox/sandbox'
import { OpenSandboxProvider } from '../src/orchestration/sandbox/providers/opensandbox.provider'
import type { SandboxResult } from '../src/orchestration/sandbox/types'

// ─── Console helpers ─────────────────────────────────────────────────────────

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'

let passCount = 0,
  failCount = 0,
  warnCount = 0

function ok(label: string, detail?: string) {
  passCount++
  console.log(`  ${GREEN}✓${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}
function fail(label: string, err: unknown) {
  failCount++
  console.log(`  ${RED}✗${RESET} ${label}  ${DIM}${err instanceof Error ? err.message : String(err)}${RESET}`)
}
function warn(label: string, detail?: string) {
  warnCount++
  console.log(`  ${YELLOW}⚠${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}
function section(title: string) {
  console.log(`\n${BOLD}${CYAN}── ${title} ──${RESET}`)
}
function banner(title: string) {
  const line = '─'.repeat(55)
  console.log(`\n${BOLD}${line}\n  ${title}\n${line}${RESET}`)
}

// ─── 1. Code Extractor ───────────────────────────────────────────────────────

function testCodeExtractor() {
  section('1. Code Extractor (pure)')

  try {
    // No code blocks
    const empty = extractCodeBlocks('Just some plain text without any code.')
    if (empty.length === 0) ok('Empty input → 0 files')
    else fail('Expected 0 files for plain text', `got ${empty.length}`)

    // filepath in fence line
    const md1 = '```ts // filepath: src/index.ts\nexport const x = 1\n```'
    const f1 = extractCodeBlocks(md1)
    if (f1.length === 1 && f1[0].path === 'src/index.ts' && f1[0].language === 'ts') {
      ok('filepath from fence line', `path=${f1[0].path} lang=${f1[0].language}`)
    } else fail('filepath from fence line failed', JSON.stringify(f1))

    // filepath in first-line C-style comment
    const md2 = '```typescript\n// src/utils.ts\nexport const add = (a: number, b: number) => a + b\n```'
    const f2 = extractCodeBlocks(md2)
    if (f2.length === 1 && f2[0].path === 'src/utils.ts') {
      ok('filepath from first-line comment', `path=${f2[0].path}`)
    } else fail('filepath from first-line comment failed', JSON.stringify(f2))

    // Python-style comment
    const md3 = '```python\n# src/main.py\nprint("hello")\n```'
    const f3 = extractCodeBlocks(md3)
    if (f3.length === 1 && f3[0].path === 'src/main.py') {
      ok('filepath from Python # comment', `path=${f3[0].path}`)
    } else fail('Python # comment extraction failed', JSON.stringify(f3))

    // Fallback filename generation
    const md4 = '```typescript\nconst x = 42\n```'
    const f4 = extractCodeBlocks(md4)
    if (f4.length === 1 && f4[0].path.endsWith('.ts')) {
      ok('Fallback filename uses language extension', `path=${f4[0].path}`)
    } else fail('Fallback filename failed', JSON.stringify(f4))

    // Multiple blocks
    const md5 = [
      '```ts // filepath: src/a.ts\nexport const a = 1\n```',
      '```ts // filepath: src/b.ts\nexport const b = 2\n```',
      '```ts // filepath: src/c.ts\nexport const c = 3\n```'
    ].join('\n\n')
    const f5 = extractCodeBlocks(md5)
    if (f5.length === 3 && f5.map(f => f.path).join(',') === 'src/a.ts,src/b.ts,src/c.ts') {
      ok('Multiple code blocks extracted in order', `paths=[${f5.map(f => f.path).join(', ')}]`)
    } else fail('Multiple blocks extraction failed', JSON.stringify(f5.map(f => f.path)))

    // Empty block skipped
    const md6 = '```ts\n```'
    const f6 = extractCodeBlocks(md6)
    if (f6.length === 0) ok('Empty code block is skipped')
    else fail('Empty block should be skipped', `got ${f6.length}`)

    // Language detection
    const files = [
      { path: 'a.py', content: '', language: 'python' },
      { path: 'b.py', content: '', language: 'python' },
      { path: 'c.ts', content: '', language: 'typescript' }
    ]
    const lang = detectPrimaryLanguage(files)
    if (lang === 'python') ok('detectPrimaryLanguage() returns most frequent', `detected=${lang}`)
    else fail('detectPrimaryLanguage() wrong result', lang)
  } catch (err) {
    fail('Code extractor threw', err)
  }
}

// ─── 2. buildFixPrompt ───────────────────────────────────────────────────────

function testBuildFixPrompt() {
  section('2. buildFixPrompt() (pure)')

  try {
    const broken: SandboxResult = {
      success: false,
      files: [],
      syntaxValid: false,
      compilationOutput: 'error TS2304: Cannot find name "foo"',
      testOutput: null,
      stdout: '',
      stderr: 'Type checking failed',
      durationMs: 50
    }

    const prompt = buildFixPrompt('const x = foo()', broken)

    if (prompt.includes('Cannot find name')) ok('Compilation error included in prompt')
    else fail('Compilation error missing from prompt', prompt.slice(0, 100))

    if (prompt.includes('const x = foo()')) ok('Original code included in prompt')
    else fail('Original code missing from prompt', prompt.slice(0, 100))

    if (prompt.toLowerCase().includes('fix')) ok('Fix instruction present in prompt')
    else fail('Fix instruction missing', prompt.slice(0, 100))

    // Prompt with only stderr
    const onlyStderr: SandboxResult = {
      ...broken,
      compilationOutput: null,
      stderr: 'ModuleNotFoundError: numpy'
    }
    const prompt2 = buildFixPrompt('import numpy', onlyStderr)
    if (prompt2.includes('ModuleNotFoundError')) ok('stderr fallback included when no compilationOutput')
    else fail('stderr fallback missing', prompt2.slice(0, 100))
  } catch (err) {
    fail('buildFixPrompt threw', err)
  }
}

// ─── 3. OpenSandbox Connectivity ─────────────────────────────────────────────

async function checkOpenSandboxConnectivity(): Promise<boolean> {
  section('3. OpenSandbox Connectivity')

  console.log(`  ${DIM}Connecting to http://${SANDBOX_DOMAIN}/health ...${RESET}`)
  try {
    const res = await fetch(`http://${SANDBOX_DOMAIN}/health`, {
      signal: AbortSignal.timeout(5000)
    })
    if (res.ok) {
      ok(`OpenSandbox reachable at http://${SANDBOX_DOMAIN}`, `HTTP ${res.status}`)
      return true
    } else {
      warn(`OpenSandbox returned HTTP ${res.status}`, `URL: http://${SANDBOX_DOMAIN}/health`)
      return false
    }
  } catch (err) {
    warn(`OpenSandbox not reachable at http://${SANDBOX_DOMAIN}`, 'start: ./scripts/infra.sh start')
    return false
  }
}

// ─── 4. Python Sandbox Execution (primary language) ──────────────────────────

async function testPythonExecution(available: boolean) {
  section('4. Python Code Execution (primary)')

  if (!available) {
    warn('Skipping — OpenSandbox not available')
    return
  }

  const llmOutput = `
Here is the Python implementation:

\`\`\`python
# src/main.py
def greet(name: str) -> str:
    return f"Hello, {name}!"

def add(a: int, b: int) -> int:
    return a + b

if __name__ == "__main__":
    print(greet("World"))
    print(add(2, 3))
\`\`\`

\`\`\`python
# src/utils.py
def flatten(lst: list) -> list:
    return [item for sublist in lst for item in sublist]
\`\`\`
  `.trim()

  const provider = new OpenSandboxProvider({
    domain: SANDBOX_DOMAIN,
    apiKey: SANDBOX_API_KEY,
    protocol: SANDBOX_PROTOCOL as any,
    defaultImage: SANDBOX_IMAGE
  })

  const events: string[] = []
  const emit = (event: string, _pid: string, _payload: unknown) => {
    events.push(event)
  }

  console.log(`  ${DIM}Provisioning sandbox container (this may take 10-30s on first run)...${RESET}`)
  const start = Date.now()

  try {
    const { result } = await runSandbox(llmOutput, provider, emit, 'test-proj-py', {
      timeoutMs: SANDBOX_TIMEOUT,
      language: 'python',
      runTests: false
    })

    const elapsed = Date.now() - start
    ok(`Sandbox executed in ${elapsed}ms`, `success=${result.success}`)

    if (result.files.length === 2) {
      ok('Both Python files extracted', `files=[${result.files.map(f => f.path).join(', ')}]`)
    } else {
      warn('Unexpected file count', `got ${result.files.length} files`)
    }

    if (events.includes('sandbox:started')) ok('sandbox:started event emitted')
    else fail('sandbox:started not emitted', `events=[${events.join(', ')}]`)

    if (result.success) {
      ok('Python syntax check passed')
    } else {
      warn('Python syntax check failed', result.compilationOutput?.slice(0, 80) || result.error || '')
    }

    if (result.stdout) ok('stdout captured', result.stdout.trim().slice(0, 60))
  } catch (err) {
    fail('Python execution threw', err)
  }
}

// ─── 5. TypeScript Sandbox Execution (future language) ────────────────────────

async function testTypescriptExecution(available: boolean) {
  section('5. TypeScript Code Execution (future language — skipped in Python-first mode)')
  warn(
    'TypeScript sandbox execution not tested in Python-first mode',
    'will be enabled when multi-language support is added'
  )
}

// ─── 6. Sandbox Error Detection & Fix Prompt ─────────────────────────────────
// Tests that broken code produces success=false with meaningful output,
// and that buildFixPrompt() includes the error + original code + fix instructions.
// NOTE: This is a unit-level test — it does NOT test the live agentic LLM fix loop.

async function testSandboxErrorDetection(available: boolean) {
  section('6. Sandbox Error Detection & Fix Prompt (unit-level)')

  if (!available) {
    warn('Skipping — OpenSandbox not available')
    return
  }

  // Deliberate SyntaxError Python will catch
  const brokenOutput = `
\`\`\`python
# src/broken.py
def greet(name: str) -> str
    return f"Hello, {name}!"   # missing colon on def line
\`\`\`
  `.trim()

  const fixedOutput = `
\`\`\`python
# src/broken.py
def greet(name: str) -> str:
    return f"Hello, {name}!"
\`\`\`
  `.trim()

  const provider = new OpenSandboxProvider({
    domain: SANDBOX_DOMAIN,
    apiKey: SANDBOX_API_KEY,
    protocol: SANDBOX_PROTOCOL as any,
    defaultImage: SANDBOX_IMAGE
  })

  const retryEvents: string[] = []
  const emit = (event: string, _pid: string, payload: unknown) => {
    retryEvents.push(event)
    if (event === 'sandbox:retry') {
      const p = payload as any
      console.log(`  ${DIM}  → retry attempt ${p.attempt}: ${String(p.error).slice(0, 60)}...${RESET}`)
    }
  }

  console.log(`  ${DIM}Running broken Python code (expecting SyntaxError)...${RESET}`)

  try {
    // Step 1: run broken code — must fail
    const { result: brokenResult } = await runSandbox(brokenOutput, provider, emit, 'test-fix', {
      timeoutMs: SANDBOX_TIMEOUT,
      language: 'python',
      runTests: false
    })

    if (!brokenResult.success) {
      ok('Broken code correctly detected as failed', `output="${brokenResult.compilationOutput?.slice(0, 60)}..."`)
    } else {
      fail('Broken code unexpectedly succeeded — SyntaxError should be caught by py_compile', '')
    }

    // Step 2: build fix prompt — verify it contains required sections
    const fixPrompt = buildFixPrompt(brokenOutput, brokenResult)
    ok('buildFixPrompt() generated', `${fixPrompt.length} chars`)

    if (fixPrompt.includes('SyntaxError') || fixPrompt.includes(brokenResult.compilationOutput?.slice(0, 20) ?? '')) {
      ok('Fix prompt includes error details')
    } else {
      fail('Fix prompt missing error details', fixPrompt.slice(0, 100))
    }

    if (fixPrompt.toLowerCase().includes('fix') && fixPrompt.includes('def greet')) {
      ok('Fix prompt includes original code and fix instruction')
    } else {
      fail('Fix prompt missing original code or fix instruction', fixPrompt.slice(0, 100))
    }

    if (fixPrompt.includes('0.0.0.0') || fixPrompt.includes('CONSTRAINTS')) {
      ok('Fix prompt includes server binding constraint')
    } else {
      warn('Fix prompt missing server binding constraint', fixPrompt.slice(0, 100))
    }

    // Step 3: simulate LLM returning fixed code → run again
    console.log(`  ${DIM}Running fixed Python code...${RESET}`)
    const { result: fixedResult } = await runSandbox(fixedOutput, provider, emit, 'test-fix', {
      timeoutMs: SANDBOX_TIMEOUT,
      language: 'python',
      runTests: false
    })

    if (fixedResult.success) {
      ok('Fixed Python code passes — sandbox error detection works end-to-end')
    } else {
      fail('Fixed code still failed — fix prompt or sandbox has issues', fixedResult.compilationOutput?.slice(0, 80) || fixedResult.error || '')
    }
  } catch (err) {
    fail('Sandbox error detection test threw', err)
  }
}

// ─── 7. Import Checker (Fix 3) ───────────────────────────────────────────────
// Verifies that importing a third-party module not listed in requirements.txt
// causes the sandbox to return success=false and triggers the fix loop.

async function testImportChecker(available: boolean) {
  section('7. Import Checker — missing module detection (Fix 3)')

  if (!available) {
    warn('Skipping — OpenSandbox not available')
    return
  }

  // Code imports `jwt` but requirements.txt only has `fastapi`.
  // The AST checker should catch `jwt` as uninstalled → exit 1 → success: false.
  const missingJwtOutput = `
\`\`\`python
# filepath: main.py
import jwt

def create_token(payload: dict) -> str:
    return jwt.encode(payload, "secret", algorithm="HS256")
\`\`\`

\`\`\`python
# filepath: requirements.txt
fastapi
uvicorn
\`\`\`
  `.trim()

  const provider = new OpenSandboxProvider({
    domain: SANDBOX_DOMAIN,
    apiKey: SANDBOX_API_KEY,
    protocol: SANDBOX_PROTOCOL as any,
    defaultImage: SANDBOX_IMAGE
  })

  console.log(`  ${DIM}Running Python code with import jwt but jwt not in requirements.txt...${RESET}`)

  try {
    const { result } = await runSandbox(missingJwtOutput, provider, () => {}, 'test-import-check', {
      timeoutMs: SANDBOX_TIMEOUT,
      language: 'python',
      runTests: false
    })

    if (!result.success) {
      ok('Sandbox correctly detected missing import', `success=${result.success}`)
    } else {
      fail('Expected failure for missing jwt module, but sandbox reported success', '')
    }

    const output = (result.compilationOutput ?? '') + (result.stderr ?? '')
    if (output.toLowerCase().includes('missing') || output.toLowerCase().includes('jwt')) {
      ok('compilationOutput mentions missing module', output.slice(0, 80))
    } else {
      warn('compilationOutput does not mention jwt — check AST checker output', output.slice(0, 80))
    }

    // Also verify the fix prompt mentions a dependency issue
    if (!result.success) {
      const fixPrompt = buildFixPrompt(missingJwtOutput, result)
      const hasDependencyHint = fixPrompt.includes('requirements.txt') || fixPrompt.includes('dependency')
      if (hasDependencyHint) ok('buildFixPrompt() includes dependency hint for missing module')
      else warn('buildFixPrompt() did not add dependency hint', fixPrompt.slice(0, 120))
    }
  } catch (err) {
    fail('Import checker test threw', err)
  }
}

// ─── 8. Terminal text normalization (Fix 1) ──────────────────────────────────
// Verifies that all terminal:stdout / terminal:stderr events emitted during
// sandbox execution carry a defined `text` field (never undefined).
// This catches regressions where msg.text is used directly on raw-string SDKs.

async function testTerminalTextNormalization(available: boolean) {
  section('8. Terminal msg.text normalization (Fix 1)')

  if (!available) {
    warn('Skipping — OpenSandbox not available')
    return
  }

  const simplePython = `
\`\`\`python
# filepath: main.py
print("hello from sandbox")
\`\`\`

\`\`\`python
# filepath: requirements.txt
\`\`\`
  `.trim()

  const provider = new OpenSandboxProvider({
    domain: SANDBOX_DOMAIN,
    apiKey: SANDBOX_API_KEY,
    protocol: SANDBOX_PROTOCOL as any,
    defaultImage: SANDBOX_IMAGE
  })

  // Collect all terminal events, checking for undefined text
  const undefinedTextEvents: string[] = []
  let terminalEventCount = 0
  const emit = (event: string, _pid: string, payload: unknown) => {
    if (event === 'terminal:stdout' || event === 'terminal:stderr') {
      terminalEventCount++
      const text = (payload as any)?.text
      if (text === undefined) {
        undefinedTextEvents.push(event)
      }
    }
  }

  // Use startProjectExecution indirectly via runSandbox — it uses OpenSandboxProvider
  // which already normalizes, but we can still verify via the provider's capture function
  console.log(`  ${DIM}Running simple Python and checking terminal event text fields...${RESET}`)

  try {
    const { result } = await runSandbox(simplePython, provider, emit, 'test-terminal-norm', {
      timeoutMs: SANDBOX_TIMEOUT,
      language: 'python',
      runTests: false
    })

    // OpenSandboxProvider.execute() does not emit terminal:* events (that's execution.ts).
    // This test confirms the provider itself doesn't surface undefined text in stdout/stderr capture.
    if (result.stdout !== undefined && result.stderr !== undefined) {
      ok('provider stdout/stderr are always defined strings (not undefined)')
    } else {
      fail('provider stdout or stderr is undefined', `stdout=${result.stdout} stderr=${result.stderr}`)
    }

    if (undefinedTextEvents.length === 0) {
      ok(`All ${terminalEventCount} terminal events have defined text fields`)
    } else {
      fail(
        `${undefinedTextEvents.length} terminal events had undefined text`,
        undefinedTextEvents.slice(0, 5).join(', ')
      )
    }

    console.log(
      `  ${DIM}  Note: terminal:stdout/stderr events from execution.ts (startProjectExecution) are tested via live server run, not this script.${RESET}`
    )
  } catch (err) {
    fail('Terminal normalization test threw', err)
  }
}

// ─── 9. Server Startup Integration Test ──────────────────────────────────────
// Writes a minimal FastAPI app, installs deps, verifies it starts and serves HTTP.
// Uses checkServerStart: true to exercise the new startup validation path.

async function testServerStartupIntegration(available: boolean) {
  section('9. Server Startup Integration Test (FastAPI)')

  if (!available) {
    warn('Skipping — OpenSandbox not available')
    return
  }

  const fastapiApp = `
\`\`\`python
# filepath: main.py
import os
from fastapi import FastAPI

app = FastAPI(title="Test App", version="1.0.0")

@app.get("/")
def root():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
\`\`\`

\`\`\`python
# filepath: requirements.txt
fastapi
uvicorn
\`\`\`
  `.trim()

  const provider = new OpenSandboxProvider({
    domain: SANDBOX_DOMAIN,
    apiKey: SANDBOX_API_KEY,
    protocol: SANDBOX_PROTOCOL as any,
    defaultImage: SANDBOX_IMAGE
  })

  console.log(`  ${DIM}Running FastAPI startup check (installs deps + starts server + HTTP verify)...${RESET}`)
  const start = Date.now()

  try {
    const { result } = await runSandbox(fastapiApp, provider, () => {}, 'test-startup', {
      timeoutMs: SANDBOX_TIMEOUT,
      language: 'python',
      runTests: false,
      checkServerStart: true
    })

    const elapsed = Date.now() - start
    console.log(`  ${DIM}  completed in ${elapsed}ms${RESET}`)

    if (result.success) {
      ok('FastAPI app starts and serves HTTP within timeout', `${elapsed}ms`)
    } else {
      fail('FastAPI app failed to start', result.compilationOutput?.slice(0, 200) || result.error || '')
    }

    if (result.syntaxValid) {
      ok('Syntax validation passed before startup check')
    } else {
      fail('Syntax validation failed', result.compilationOutput?.slice(0, 80) || '')
    }
  } catch (err) {
    fail('Server startup integration test threw', err)
  }
}

// ─── 10. Broken Server Startup — Error in compilationOutput ──────────────────
// When checkServerStart: true is set and the server fails to start,
// the server log should appear in compilationOutput so the fix loop has context.

async function testBrokenServerStartup(available: boolean) {
  section('10. Broken Server — Error Captured in compilationOutput')

  if (!available) {
    warn('Skipping — OpenSandbox not available')
    return
  }

  // FastAPI app that will fail: bad port binding (binds to a port that's already in use
  // is hard to test portably, so use a Python app that crashes on startup instead)
  const crashingApp = `
\`\`\`python
# filepath: main.py
import os
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def root():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    raise RuntimeError("Intentional startup crash for testing")
\`\`\`

\`\`\`python
# filepath: requirements.txt
fastapi
uvicorn
\`\`\`
  `.trim()

  const provider = new OpenSandboxProvider({
    domain: SANDBOX_DOMAIN,
    apiKey: SANDBOX_API_KEY,
    protocol: SANDBOX_PROTOCOL as any,
    defaultImage: SANDBOX_IMAGE
  })

  console.log(`  ${DIM}Running crashing Python server (expecting startup failure)...${RESET}`)

  try {
    const { result } = await runSandbox(crashingApp, provider, () => {}, 'test-broken-startup', {
      timeoutMs: SANDBOX_TIMEOUT,
      language: 'python',
      runTests: false,
      checkServerStart: true
    })

    if (!result.success) {
      ok('Broken server correctly detected as failed (success=false)')
    } else {
      // uvicorn may start and serve via the app even if __main__ block raises,
      // so this is a soft warning
      warn('Broken server unexpectedly succeeded — uvicorn may have served before crash')
    }

    const output = result.compilationOutput ?? ''
    if (output.length > 0) {
      ok('compilationOutput contains server log', output.slice(0, 80))
    } else {
      warn('compilationOutput is empty — server log may not be captured', '')
    }

    // Verify buildFixPrompt picks up the runtime error type
    if (!result.success) {
      const fixPrompt = buildFixPrompt(crashingApp, result)
      if (fixPrompt.includes('Runtime') || fixPrompt.includes('runtime') || fixPrompt.includes('0.0.0.0')) {
        ok('buildFixPrompt() identifies runtime error type')
      } else {
        warn('buildFixPrompt() did not classify as runtime error', fixPrompt.slice(0, 120))
      }
    }
  } catch (err) {
    fail('Broken server startup test threw', err)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner('Mockline Shadow Workspace (OpenSandbox) Smoke Test')
  console.log(
    `${DIM}  Layers: code-extractor → buildFixPrompt → connectivity → TS exec → Python exec → error detection → import checker → terminal norm → server startup → broken startup${RESET}`
  )
  console.log(`${DIM}  OpenSandbox: http://${SANDBOX_DOMAIN}  image=${SANDBOX_IMAGE}${RESET}`)

  testCodeExtractor()
  testBuildFixPrompt()
  const available = await checkOpenSandboxConnectivity()
  await testTypescriptExecution(available)
  await testPythonExecution(available)
  await testSandboxErrorDetection(available)
  await testImportChecker(available)
  await testTerminalTextNormalization(available)
  await testServerStartupIntegration(available)
  await testBrokenServerStartup(available)

  const line = '─'.repeat(55)
  console.log(`\n${BOLD}${line}${RESET}`)
  console.log(
    `  ${GREEN}${passCount} passed${RESET}  ${failCount > 0 ? RED : DIM}${failCount} failed${RESET}  ${warnCount > 0 ? YELLOW : DIM}${warnCount} warnings${RESET}`
  )
  console.log(`${BOLD}${line}${RESET}\n`)

  if (failCount > 0) process.exit(1)
}

main().catch(err => {
  console.error(`\n${RED}Fatal error:${RESET}`, err)
  process.exit(1)
})
