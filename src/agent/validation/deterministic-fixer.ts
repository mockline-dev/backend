import { logger } from '../../logger'
import type { ValidationError } from './python-validator'
import { runRuffFix, validateSyntaxOnly } from './python-validator'

export type DeterministicFixStrategy = 'auto-fixed' | 'stubbed' | 'unchanged'

export interface DeterministicFixResult {
  content: string
  strategy: DeterministicFixStrategy
  fixes: string[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Tier 1 — ruff auto-fix + regex normalization
// ---------------------------------------------------------------------------

/**
 * Applies deterministic auto-fixes to Python content:
 * 1. ruff check --fix (auto-fixable lint errors)
 * 2. Regex normalizations (tabs → spaces, trailing newline)
 */
export async function applyAutoFixes(
  path: string,
  content: string
): Promise<{ content: string; fixes: string[] }> {
  const fixes: string[] = []
  let result = content

  // Regex fixes first (cheap, always safe)
  if (result.includes('\t')) {
    result = result.replace(/\t/g, '    ')
    fixes.push('normalized tabs to 4 spaces')
  }
  if (!result.endsWith('\n')) {
    result += '\n'
    fixes.push('added trailing newline')
  }

  // ruff auto-fix
  try {
    const { content: ruffFixed, fixed } = await runRuffFix(path, result)
    if (fixed) {
      result = ruffFixed
      fixes.push('ruff auto-fixed lint errors')
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.debug('deterministic-fixer: ruff auto-fix skipped for %s: %s', path, msg)
  }

  return { content: result, fixes }
}

// ---------------------------------------------------------------------------
// Tier 2 — minimal stub (guarantees py_compile passes)
// ---------------------------------------------------------------------------

/**
 * Builds a minimal valid Python file from the original content's structure.
 * Extracts import lines and function/class signatures, replaces bodies with `pass`.
 * Guarantees syntax validity (py_compile passes).
 */
export function buildMinimalStub(
  path: string,
  content: string,
  _errors: ValidationError[]
): string {
  const lines = content.split('\n')
  const importLines: string[] = []
  const stubs: string[] = []

  let inClass = false
  let inFunc = false
  let indentLevel = 0

  for (const line of lines) {
    const trimmed = line.trimStart()

    // Collect import lines (skip if they look broken)
    if ((trimmed.startsWith('import ') || trimmed.startsWith('from ')) && !trimmed.includes('(')) {
      // Basic validity check: must not have syntax-like issues
      if (!trimmed.includes('...') && trimmed.split(' ').length >= 2) {
        importLines.push(line)
      }
      continue
    }

    // Extract function/class signatures
    const funcMatch = trimmed.match(/^(async\s+)?def\s+(\w+)\s*\(/)
    if (funcMatch) {
      const currentIndent = line.length - trimmed.length
      indentLevel = currentIndent
      inFunc = true
      inClass = false
      stubs.push('')
      stubs.push(line.trimEnd())
      stubs.push(' '.repeat(currentIndent + 4) + 'pass')
      continue
    }

    const classMatch = trimmed.match(/^class\s+(\w+)/)
    if (classMatch) {
      const currentIndent = line.length - trimmed.length
      indentLevel = currentIndent
      inClass = true
      inFunc = false
      stubs.push('')
      stubs.push(line.trimEnd())
      stubs.push(' '.repeat(currentIndent + 4) + 'pass')
      continue
    }

    // Module-level assignments (e.g., variable = ...) — keep simple ones
    if (!inClass && !inFunc && trimmed.match(/^\w+\s*=\s*.+/) && !trimmed.includes('(')) {
      stubs.push(line.trimEnd())
    }

    // Track dedent to reset inClass/inFunc context
    const currentIndent = line.length - trimmed.length
    if (trimmed && currentIndent <= indentLevel) {
      inClass = false
      inFunc = false
    }
  }

  const header = `# AUTO-STUB: Original file had syntax errors, replaced with stubs\n# File: ${path}\n`
  const imports = importLines.length > 0 ? importLines.join('\n') + '\n' : ''
  const body = stubs.join('\n').trimStart()

  return header + '\n' + imports + body + '\n'
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Applies deterministic fix strategy to a single file:
 *   Tier 1 — ruff auto-fix + regex normalization
 *   Tier 2 — build minimal stub (if Tier 1 still fails py_compile)
 *   Tier 3 — accept remaining ruff/pyflakes warnings (not py_compile failures)
 */
export async function fixFileDeterministic(
  path: string,
  content: string,
  errors: ValidationError[],
  revalidate: (path: string, content: string) => Promise<ValidationError[]>
): Promise<DeterministicFixResult> {
  const warnings: string[] = []

  // Tier 1 — auto-fix
  const { content: tier1Content, fixes } = await applyAutoFixes(path, content)

  // Re-validate after Tier 1
  const tier1Errors = await revalidate(path, tier1Content)
  const tier1SyntaxErrors = tier1Errors.filter(e => e.code === 'E999')

  if (tier1SyntaxErrors.length === 0) {
    // Only warnings/lint remain — accept them
    for (const e of tier1Errors) {
      warnings.push(`${path}:${e.line ?? '?'} [${e.code ?? 'W'}]: ${e.message}`)
    }

    if (fixes.length > 0 || tier1Errors.length < errors.length) {
      return {
        content: tier1Content,
        strategy: 'auto-fixed',
        fixes,
        warnings
      }
    }

    // Content unchanged, no syntax errors — just warnings
    return { content: tier1Content, strategy: 'unchanged', fixes: [], warnings }
  }

  // Tier 2 — build minimal stub (guaranteed py_compile pass)
  logger.debug(
    'deterministic-fixer: Tier 1 did not fix syntax for %s (%d syntax errors), building stub',
    path,
    tier1SyntaxErrors.length
  )

  const stubContent = buildMinimalStub(path, content, errors)

  // Verify stub compiles
  const stubSyntaxErrors = await validateSyntaxOnly(path, stubContent)
  if (stubSyntaxErrors.length > 0) {
    // Fallback: ultra-minimal stub
    const minimalStub = `# AUTO-STUB: Syntax errors could not be auto-fixed\n# File: ${path}\n\ndef placeholder():\n    pass\n`
    return {
      content: minimalStub,
      strategy: 'stubbed',
      fixes: ['replaced with minimal placeholder stub'],
      warnings: [`${path}: all content replaced with placeholder stub due to unfixable syntax errors`]
    }
  }

  return {
    content: stubContent,
    strategy: 'stubbed',
    fixes: ['replaced with auto-generated stubs preserving function/class signatures'],
    warnings: [`${path}: body replaced with stubs due to unfixable syntax errors`]
  }
}
