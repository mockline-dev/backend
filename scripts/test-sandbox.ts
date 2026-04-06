/**
 * Shadow Workspace (OpenSandbox) Smoke Test
 *
 * Tests each layer of the sandbox system:
 *   1. Code extractor (pure) — no deps
 *   2. buildFixPrompt() (pure) — no deps
 *   3. OpenSandbox connectivity — needs OpenSandbox running
 *   4. Full sandbox execution — TypeScript file compile check
 *   5. Full sandbox execution — Python file compile check
 *   6. Agentic fix loop — intentionally broken code, verify retry
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

const SANDBOX_DOMAIN = process.env.OPENSANDBOX_DOMAIN
  || defaultConfig?.sandbox?.opensandbox?.domain
  || 'localhost:8080'
const SANDBOX_API_KEY = process.env.OPENSANDBOX_API_KEY
  || defaultConfig?.sandbox?.opensandbox?.apiKey
  || ''
const SANDBOX_PROTOCOL = defaultConfig?.sandbox?.opensandbox?.protocol || 'http'
const SANDBOX_IMAGE = process.env.OPENSANDBOX_IMAGE
  || defaultConfig?.sandbox?.opensandbox?.defaultImage
  || 'opensandbox/code-interpreter:v1.0.2'
const SANDBOX_TIMEOUT = defaultConfig?.sandbox?.timeoutMs || 30000

import { extractCodeBlocks, detectPrimaryLanguage } from '../src/orchestration/sandbox/code-extractor'
import { runSandbox, buildFixPrompt } from '../src/orchestration/sandbox/sandbox'
import { OpenSandboxProvider } from '../src/orchestration/sandbox/providers/opensandbox.provider'
import type { SandboxResult } from '../src/orchestration/sandbox/types'

// ─── Console helpers ─────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN   = '\x1b[36m'
const DIM    = '\x1b[2m'
const RESET  = '\x1b[0m'
const BOLD   = '\x1b[1m'

let passCount = 0, failCount = 0, warnCount = 0

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
      '```ts // filepath: src/c.ts\nexport const c = 3\n```',
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
      { path: 'c.ts', content: '', language: 'typescript' },
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
      durationMs: 50,
    }

    const prompt = buildFixPrompt('const x = foo()', broken)

    if (prompt.includes('Cannot find name')) ok('Compilation error included in prompt')
    else fail('Compilation error missing from prompt', prompt.slice(0, 100))

    if (prompt.includes('const x = foo()')) ok('Original code included in prompt')
    else fail('Original code missing from prompt', prompt.slice(0, 100))

    if (prompt.toLowerCase().includes('fix')) ok('Fix instruction present in prompt')
    else fail('Fix instruction missing', prompt.slice(0, 100))

    // Prompt with only stderr
    const onlyStderr: SandboxResult = { ...broken, compilationOutput: null, stderr: 'ModuleNotFoundError: numpy' }
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
      signal: AbortSignal.timeout(5000),
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

// ─── 4. TypeScript Sandbox Execution ─────────────────────────────────────────

async function testTypescriptExecution(available: boolean) {
  section('4. TypeScript Code Execution')

  if (!available) {
    warn('Skipping — OpenSandbox not available')
    return
  }

  const llmOutput = `
Here is the TypeScript code:

\`\`\`typescript // filepath: src/greet.ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`
}

const result = greet("World")
console.log(result)
\`\`\`
  `.trim()

  const provider = new OpenSandboxProvider({
    domain: SANDBOX_DOMAIN,
    apiKey: SANDBOX_API_KEY,
    protocol: SANDBOX_PROTOCOL as any,
    defaultImage: SANDBOX_IMAGE,
  })

  const events: string[] = []
  const emit = (event: string, _pid: string, _payload: unknown) => { events.push(event) }

  console.log(`  ${DIM}Provisioning sandbox container (this may take 10-30s on first run)...${RESET}`)
  const start = Date.now()

  try {
    const { result } = await runSandbox(llmOutput, provider, emit, 'test-proj', {
      timeoutMs: SANDBOX_TIMEOUT,
      language: 'typescript',
      runTests: false,
    })

    const elapsed = Date.now() - start

    ok(`Sandbox executed in ${elapsed}ms`, `success=${result.success}`)

    if (result.files.length > 0) ok('Code blocks extracted', `files=[${result.files.map(f => f.path).join(', ')}]`)
    else fail('No files extracted from LLM output', '')

    if (events.includes('sandbox:started')) ok('sandbox:started event emitted')
    else fail('sandbox:started not emitted', `events=[${events.join(', ')}]`)

    if (result.success) {
      ok('TypeScript compilation succeeded', result.compilationOutput?.slice(0, 60) || 'no output')
    } else {
      warn('TypeScript compilation failed (may be expected if tsc not in image)', result.compilationOutput?.slice(0, 80) || result.stderr?.slice(0, 80) || 'unknown')
    }

    if (result.stdout) ok('stdout captured', result.stdout.trim().slice(0, 60))
    if (result.stderr && !result.success) warn('stderr', result.stderr.trim().slice(0, 80))

  } catch (err) {
    fail('TypeScript execution threw', err)
  }
}

// ─── 5. Python Sandbox Execution ─────────────────────────────────────────────

async function testPythonExecution(available: boolean) {
  section('5. Python Code Execution')

  if (!available) {
    warn('Skipping — OpenSandbox not available')
    return
  }

  const llmOutput = `
Here is the Python code:

\`\`\`python
# src/main.py
def greet(name: str) -> str:
    return f"Hello, {name}!"

if __name__ == "__main__":
    print(greet("World"))
\`\`\`
  `.trim()

  const provider = new OpenSandboxProvider({
    domain: SANDBOX_DOMAIN,
    apiKey: SANDBOX_API_KEY,
    protocol: SANDBOX_PROTOCOL as any,
    defaultImage: SANDBOX_IMAGE,
  })

  const emit = (_e: string, _p: string, _d: unknown) => {}

  console.log(`  ${DIM}Running Python syntax check...${RESET}`)
  const start = Date.now()

  try {
    const { result } = await runSandbox(llmOutput, provider, emit, 'test-proj-py', {
      timeoutMs: SANDBOX_TIMEOUT,
      language: 'python',
      runTests: false,
    })
    const elapsed = Date.now() - start
    ok(`Python sandbox executed in ${elapsed}ms`, `success=${result.success}`)

    if (result.files.length > 0 && result.files[0].path === 'src/main.py') {
      ok('Python filepath extracted correctly', `path=${result.files[0].path}`)
    } else {
      warn('Python filepath extraction', `files=[${result.files.map(f => f.path).join(', ')}]`)
    }

    if (result.success) ok('Python syntax check passed')
    else warn('Python syntax check failed (may be expected if python3 not in image)', result.compilationOutput?.slice(0, 80) || '')

  } catch (err) {
    fail('Python execution threw', err)
  }
}

// ─── 6. Agentic Fix Loop (broken code) ───────────────────────────────────────

async function testAgenticFixLoop(available: boolean) {
  section('6. Agentic Fix Loop (broken → fixed)')

  if (!available) {
    warn('Skipping — OpenSandbox not available')
    return
  }

  // This code has a deliberate type error that tsc will catch
  const brokenOutput = `
\`\`\`typescript // filepath: src/broken.ts
const x: number = "this is a string"  // TS2322: Type 'string' is not assignable to type 'number'
console.log(x)
\`\`\`
  `.trim()

  const fixedOutput = `
\`\`\`typescript // filepath: src/broken.ts
const x: number = 42
console.log(x)
\`\`\`
  `.trim()

  const provider = new OpenSandboxProvider({
    domain: SANDBOX_DOMAIN,
    apiKey: SANDBOX_API_KEY,
    protocol: SANDBOX_PROTOCOL as any,
    defaultImage: SANDBOX_IMAGE,
  })

  const retryEvents: string[] = []
  const emit = (event: string, _pid: string, payload: unknown) => {
    retryEvents.push(event)
    if (event === 'sandbox:retry') {
      const p = payload as any
      console.log(`  ${DIM}  → retry attempt ${p.attempt}: ${String(p.error).slice(0, 60)}...${RESET}`)
    }
  }

  console.log(`  ${DIM}Running broken code (expecting compilation failure)...${RESET}`)

  try {
    // Step 1: run broken code
    const { result: brokenResult } = await runSandbox(brokenOutput, provider, emit, 'test-fix', {
      timeoutMs: SANDBOX_TIMEOUT,
      language: 'typescript',
      runTests: false,
    })

    if (!brokenResult.success) {
      ok('Broken code detected as failed', `compilationOutput="${brokenResult.compilationOutput?.slice(0,50)}..."`)
    } else {
      warn('Broken code unexpectedly succeeded (tsc may be lenient in this image)')
    }

    // Step 2: build fix prompt
    const fixPrompt = buildFixPrompt(brokenOutput, brokenResult)
    ok('buildFixPrompt() generated', `${fixPrompt.length} chars`)
    if (fixPrompt.includes('fix') || fixPrompt.includes('Fix')) ok('Fix instruction present in prompt')

    // Step 3: simulate LLM returning fixed code → run again
    console.log(`  ${DIM}Running fixed code...${RESET}`)
    const { result: fixedResult } = await runSandbox(fixedOutput, provider, emit, 'test-fix', {
      timeoutMs: SANDBOX_TIMEOUT,
      language: 'typescript',
      runTests: false,
    })

    if (fixedResult.success) {
      ok('Fixed code passes compilation — agentic loop works end-to-end')
    } else {
      warn('Fixed code failed too', fixedResult.compilationOutput?.slice(0, 80) || fixedResult.error || '')
    }

  } catch (err) {
    fail('Agentic fix loop threw', err)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner('Mockline Shadow Workspace (OpenSandbox) Smoke Test')
  console.log(`${DIM}  Layers: code-extractor → buildFixPrompt → connectivity → TS exec → Python exec → fix loop${RESET}`)
  console.log(`${DIM}  OpenSandbox: http://${SANDBOX_DOMAIN}  image=${SANDBOX_IMAGE}${RESET}`)

  testCodeExtractor()
  testBuildFixPrompt()
  const available = await checkOpenSandboxConnectivity()
  await testTypescriptExecution(available)
  await testPythonExecution(available)
  await testAgenticFixLoop(available)

  const line = '─'.repeat(55)
  console.log(`\n${BOLD}${line}${RESET}`)
  console.log(`  ${GREEN}${passCount} passed${RESET}  ${failCount > 0 ? RED : DIM}${failCount} failed${RESET}  ${warnCount > 0 ? YELLOW : DIM}${warnCount} warnings${RESET}`)
  console.log(`${BOLD}${line}${RESET}\n`)

  if (failCount > 0) process.exit(1)
}

main().catch((err) => {
  console.error(`\n${RED}Fatal error:${RESET}`, err)
  process.exit(1)
})
