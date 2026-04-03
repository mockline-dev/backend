import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import type { ChatMessage } from '../../llm/client'
import type { OllamaClient } from '../../llm/client'
import { logger } from '../../logger'

import type { LLMFileSpec } from './file-planner'
import { findUnknownImports } from './import-resolver'
import type { ProjectPlan, PlanEntity, PlanEndpoint } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3

const SYSTEM_PROMPT =
  'You are a senior Python/FastAPI developer. Generate ONLY the requested file. ' +
  'Output ONLY valid Python code. No markdown, no explanation, no code fences.\n' +
  'CRITICAL: Write simple, direct code. 5-10 functions maximum. No over-engineering.\n' +
  'CRITICAL: Depends() is ONLY for FastAPI route handlers. ' +
  'Service functions MUST receive db: Session as a plain parameter — NEVER Depends() there.'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSnakeCase(s: string): string {
  return s.replace(/([A-Z])/g, '_$1').replace(/^_/, '').toLowerCase()
}

/** Remove ```python ... ``` or ``` ... ``` fences if the LLM adds them. */
function stripFences(raw: string): string {
  return raw
    .replace(/^```(?:python)?\s*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim()
}

/** Run python3 -m py_compile on the code string. Returns error message or null. */
function validateAST(code: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'mockline-gen-'))
  const file = join(dir, 'check.py')
  try {
    writeFileSync(file, code, 'utf8')
    execFileSync('python3', ['-m', 'py_compile', file], { stdio: 'pipe' })
    return null
  } catch (err: unknown) {
    const msg =
      err instanceof Error && 'stderr' in err
        ? (err as NodeJS.ErrnoException & { stderr: Buffer }).stderr?.toString() ?? String(err)
        : String(err)
    return msg.replace(file, '<generated>')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Find the relevant entity for the file being generated. */
function entityForFile(filePath: string, plan: ProjectPlan): PlanEntity | undefined {
  for (const entity of plan.entities) {
    const snake = toSnakeCase(entity.name)
    if (
      filePath.includes(`/${snake}_service.py`) ||
      filePath.includes(`/routes/${snake}.py`) ||
      filePath.includes(`/test_${snake}.py`)
    ) {
      return entity
    }
  }
  return undefined
}

/** Find relevant endpoints for the entity. */
function endpointsForEntity(entityName: string, plan: ProjectPlan): PlanEndpoint[] {
  const snake = toSnakeCase(entityName)
  return plan.endpoints.filter(
    ep => ep.path.includes(`/${snake}`) || ep.path.includes('/auth')
  )
}

/** Format entity fields as a concise schema string. */
function formatEntitySchema(entity: PlanEntity): string {
  const fields = entity.fields
    .map(f => `  ${f.name}: ${f.type}${f.required ? ' (required)' : ''} ${f.unique ? '[unique]' : ''}`)
    .join('\n')
  return `${entity.name} (table: ${entity.tableName})\n${fields}`
}

/** Format endpoints as a concise contract string. */
function formatEndpoints(endpoints: PlanEndpoint[]): string {
  return endpoints
    .map(ep => `  ${ep.methods.join(', ')} ${ep.path} — ${ep.description}`)
    .join('\n')
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * Generates a single LLM file with AST validation + import validation.
 *
 * Retries up to MAX_RETRIES times, appending the specific error each time
 * so the model can self-correct.
 */
export async function generateFile(
  client: OllamaClient,
  fileSpec: LLMFileSpec,
  plan: ProjectPlan,
  availableImports: string,
  fewShotExample: string,
  projectPaths: string[]
): Promise<string> {
  const entity = entityForFile(fileSpec.outputPath, plan)
  const endpoints = entity ? endpointsForEntity(entity.name, plan) : plan.endpoints.slice(0, 5)

  const entitySection = entity
    ? `ENTITY SCHEMA:\n${formatEntitySchema(entity)}`
    : ''
  const contractSection =
    endpoints.length > 0
      ? `API CONTRACT:\n${formatEndpoints(endpoints)}`
      : ''
  const exampleSection = fewShotExample
    ? `EXAMPLE (follow this pattern exactly):\n${fewShotExample}`
    : ''

  const userPrompt = [
    `PROJECT: ${plan.projectName} — ${plan.description}`,
    '',
    `GENERATE: ${fileSpec.outputPath}`,
    `PURPOSE: ${fileSpec.purpose}`,
    '',
    availableImports,
    '',
    entitySection,
    '',
    contractSection,
    '',
    exampleSection,
    '',
    'Requirements:',
    ...(fileSpec.outputPath.includes('_service.py')
      ? [
          '- Simple delegation: call crud methods directly. No classes, no extra logic.',
          '- Service functions receive db: Session as a plain parameter. NEVER use Depends().',
          '- Raise HTTPException(status_code=404) for not-found, no custom exception classes.',
        ]
      : fileSpec.outputPath.startsWith('tests/')
      ? [
          '- Basic happy-path tests only: create, read, update, delete.',
          '- No complex mocking, no class-based test structure.',
          '- Use the TestClient fixture from conftest.py directly.',
        ]
      : [
          '- Use async def for all route handlers.',
          '- Thin handlers: call the service function and return the result directly.',
          '- Route handlers use Depends(get_db) for database sessions (route files only).',
        ]),
    '- Output ONLY Python code, no markdown fences',
  ]
    .filter(l => l !== null)
    .join('\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  let lastError = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.debug('generateFile: %s attempt %d/%d', fileSpec.outputPath, attempt, MAX_RETRIES)

    const response = await client.chat({
      messages,
      temperature: 0.3,
      think: false,
    })

    const code = stripFences(response.content)

    // ── AST validation ──────────────────────────────────────────────────────
    const astError = validateAST(code)
    if (astError) {
      lastError = `Python syntax error:\n${astError}`
      logger.warn(
        'generateFile: %s attempt %d — AST failed: %s',
        fileSpec.outputPath,
        attempt,
        astError
      )
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: `Fix the syntax error and output ONLY the corrected Python code:\n${astError}`,
        }
      )
      continue
    }

    // ── Import validation ───────────────────────────────────────────────────
    const unknownImports = findUnknownImports(code, projectPaths)
    if (unknownImports.length > 0) {
      lastError = `Unknown imports: ${unknownImports.join(', ')}`
      logger.warn(
        'generateFile: %s attempt %d — bad imports: %s',
        fileSpec.outputPath,
        attempt,
        unknownImports.join(', ')
      )
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content:
            `Remove these imports — they do not exist in this project: ${unknownImports.join(', ')}\n` +
            `Use only imports from the "Available imports" section. Output ONLY corrected Python code.`,
        }
      )
      continue
    }

    logger.info('generateFile: %s generated successfully (attempt %d)', fileSpec.outputPath, attempt)
    return code
  }

  throw new Error(
    `generateFile failed for ${fileSpec.outputPath} after ${MAX_RETRIES} attempts. Last error: ${lastError}`
  )
}

/** Select the appropriate few-shot example based on file path. */
export function selectExample(
  filePath: string,
  examples: {
    service: string
    route: string
    authRoute: string
    test: string
  }
): string {
  if (filePath.endsWith('auth.py')) return examples.authRoute
  if (filePath.startsWith('tests/')) return examples.test
  if (filePath.includes('_service.py')) return examples.service
  if (filePath.startsWith('app/api/routes/')) return examples.route
  return ''
}
