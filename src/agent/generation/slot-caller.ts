import { logger } from '../../logger'
import { stripThinkTags } from '../../llm/structured-output'
import { validateSyntaxOnly } from '../validation/python-validator'
import type { OllamaClient } from '../../llm/client'
import type { CodeSlot } from './slot-definitions'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SlotStrategy = 'enhanced' | 'default'

export interface SlotResult {
  slotId: string
  strategy: SlotStrategy
  /** The code to append to the CRUD class body (empty string = no addition) */
  code: string
  /** Brief description of what happened */
  reason: string
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildSlotPrompt(slot: CodeSlot): string {
  return `You are a Python developer writing SQLAlchemy CRUD methods for a FastAPI application.

## Task
${slot.description}

## Entity model (SQLAlchemy, SQLAlchemy 2.0 style)
${slot.modelSummary}

## Existing CRUD file context
${slot.contextCode}

## Instructions
Write Python methods to add to the CRUD${slot.entityName} class.
- Use SQLAlchemy 2.0 select() API (from sqlalchemy import select)
- The Session import is: from sqlalchemy.orm import Session
- Use Optional[${slot.entityName}] for methods that may return None
- You may use "from sqlalchemy import ..." inside methods if needed
- Write ONLY the method definitions (def ... blocks)
- NO imports at the top level
- NO class definition
- NO markdown code fences
- NO explanations
- Indent each method with 4 spaces (they go inside the class)
- Keep methods focused and under 20 lines each

Example format:
    def my_method(self, db: Session, *, id: int) -> Optional[${slot.entityName}]:
        from sqlalchemy import select
        obj = db.execute(select(${slot.entityName}).where(${slot.entityName}.id == id)).scalar_one_or_none()
        if obj is None:
            return None
        return obj`
}

/** Strip markdown code fences from LLM output */
function stripFences(text: string): string {
  const match = text.match(/^```(?:\w+)?\s*\n([\s\S]*?)```\s*$/m)
  if (match) return match[1].trim()
  return text.trim()
}

/** Check if text contains only comments or is otherwise empty of real code */
function isCodeEmpty(text: string): boolean {
  const meaningful = text
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t && !t.startsWith('#') && t !== 'pass'
    })
  return meaningful.length === 0
}

/** Assemble the LLM-generated methods into the existing CRUD file */
function assembleFile(existingContent: string, entityName: string, newMethods: string): string {
  const instanceLine = `\ncrud_${entityName.replace(/([A-Z])/g, '_$1').replace(/^_/, '').toLowerCase()} = CRUD${entityName}(`
  if (!existingContent.includes(`CRUD${entityName}(`)) {
    // Append at end of file
    return existingContent + '\n' + newMethods + '\n'
  }
  // Insert before the module-level instance assignment
  const idx = existingContent.lastIndexOf(instanceLine)
  if (idx === -1) {
    return existingContent + '\n' + newMethods + '\n'
  }
  return existingContent.slice(0, idx) + '\n' + newMethods + existingContent.slice(idx)
}

// ─── Slot caller ──────────────────────────────────────────────────────────────

/**
 * Executes a single LLM code slot:
 *   1. Build prompt and call LLM (one attempt, no retry)
 *   2. Strip think tags + markdown fences
 *   3. Assemble into full file and py_compile check
 *   4. If valid → return enhanced code
 *      If invalid or empty → return default (no addition)
 *
 * NEVER throws — always returns a SlotResult.
 */
export async function executeSlot(
  slot: CodeSlot,
  client: OllamaClient,
  timeoutMs = 60_000
): Promise<SlotResult> {
  const startMs = Date.now()
  logger.info('slot-caller [%s]: starting — entity=%s feature="%s"', slot.id, slot.entityName, slot.feature)

  // ── 1. Call LLM ───────────────────────────────────────────────────────────
  let rawResponse: string
  try {
    const prompt = buildSlotPrompt(slot)

    let timer: ReturnType<typeof setTimeout>
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`slot LLM timed out after ${timeoutMs}ms`)), timeoutMs)
    })

    const chatPromise = client.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      think: false,
    })

    rawResponse = await Promise.race([
      chatPromise.finally(() => clearTimeout(timer!)),
      timeoutPromise
    ]).then(r => r.content)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn('slot-caller [%s]: LLM call failed: %s — using default', slot.id, msg)
    return { slotId: slot.id, strategy: 'default', code: '', reason: `LLM error: ${msg}` }
  }

  // ── 2. Strip think tags + markdown fences ─────────────────────────────────
  const stripped = stripFences(stripThinkTags(rawResponse))

  if (!stripped || isCodeEmpty(stripped)) {
    logger.warn('slot-caller [%s]: empty response (%d raw chars) — using default', slot.id, rawResponse.length)
    return { slotId: slot.id, strategy: 'default', code: '', reason: 'Empty LLM response' }
  }

  // ── 3. Assemble into full file and validate syntax ────────────────────────
  const assembled = assembleFile(slot.existingCode, slot.entityName, stripped)
  const syntaxErrors = await validateSyntaxOnly(slot.filePath, assembled)

  if (syntaxErrors.length > 0) {
    const errMsg = syntaxErrors[0]?.message ?? 'syntax error'
    logger.warn('slot-caller [%s]: py_compile failed (%s) — using default', slot.id, errMsg)
    return { slotId: slot.id, strategy: 'default', code: '', reason: `Syntax error: ${errMsg}` }
  }

  const elapsed = Date.now() - startMs
  logger.info(
    'slot-caller [%s]: success — enhanced in %dms (%d chars)',
    slot.id,
    elapsed,
    stripped.length
  )

  return { slotId: slot.id, strategy: 'enhanced', code: stripped, reason: 'LLM enhancement validated' }
}
