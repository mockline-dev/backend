import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

import { validatePython } from '../../src/agent/validation/python-validator'

const tmpDir = path.join(os.tmpdir(), 'mockline-validation-test')

function setup() {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })
}

async function main() {
  console.log('=== Test 5D: Validation Pipeline ===\n')
  setup()

  // ── Test 1: Valid simple Python file ────────────────────────────────────────
  console.log('--- Test 1: Valid Python file ---')
  const validContent = `def greet(name: str) -> str:
    return f"Hello, {name}!"

class Greeter:
    def __init__(self, prefix: str = "Hello"):
        self.prefix = prefix

    def greet(self, name: str) -> str:
        return f"{self.prefix}, {name}!"`

  const result1 = await validatePython('valid.py', validContent)
  console.log(`  valid=${result1.valid}, errors=${result1.errors.length}, tiers=${result1.tiersRun.join(',')}`)
  console.log(result1.valid ? '  ✓ Valid file passes' : `  ✗ Valid file FAILED: ${JSON.stringify(result1.errors)}`)

  // ── Test 2: Syntax error ─────────────────────────────────────────────────────
  console.log('\n--- Test 2: Syntax error ---')
  const syntaxContent = `def broken_function(:
    pass`

  const result2 = await validatePython('syntax_error.py', syntaxContent)
  console.log(`  valid=${result2.valid}, errors=${result2.errors.length}, tiers=${result2.tiersRun.join(',')}`)
  if (!result2.valid && result2.errors.length > 0) {
    console.log(`  Error: ${result2.errors[0].message}`)
  }
  console.log(!result2.valid ? '  ✓ Syntax error caught' : '  ✗ Syntax error NOT caught')

  // ── Test 3: Undefined name (pyflakes via ruff) ────────────────────────────────
  console.log('\n--- Test 3: Undefined name ---')
  const undefinedContent = `def calculate():
    return undefined_variable + 1`

  const result3 = await validatePython('undefined_name.py', undefinedContent)
  console.log(`  valid=${result3.valid}, errors=${result3.errors.length}, tiers=${result3.tiersRun.join(',')}`)
  if (result3.errors.length > 0) {
    console.log(`  Error: ${result3.errors[0].message}`)
  }
  const caught3 = !result3.valid || result3.errors.length > 0
  console.log(caught3 ? '  ✓ Undefined name caught' : '  ⚠ Undefined name not caught (ruff may not be installed)')

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n=== Summary ===')
  console.log(`Valid file passes:   ${result1.valid ? '✓' : '✗'}`)
  console.log(`Syntax error caught: ${!result2.valid ? '✓' : '✗'}`)
  console.log(`Undefined caught:    ${caught3 ? '✓' : '⚠ (ruff unavailable)'}`)

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
