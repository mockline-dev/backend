import type { ProjectPlan } from '../../types'
import type { OllamaClient } from '../../llm/client'
import { logger } from '../../logger'

import { planProject } from './single-call-planner'
import { normalizePlan } from './plan-normalizer'
import { validatePlan } from './plan-validator'

// ─── Error type ───────────────────────────────────────────────────────────────

export class PlanningError extends Error {
  readonly validationErrors: string[]

  constructor(message: string, validationErrors: string[]) {
    super(message)
    this.name = 'PlanningError'
    this.validationErrors = validationErrors
  }
}

// ─── Progress callback ────────────────────────────────────────────────────────

export type ProgressCallback = (step: string, detail: string) => void

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Single-call planning pipeline:
 *   1. ONE structured LLM call → raw LLMProjectPlan
 *   2. Deterministic normalization → ProjectPlan
 *      (type mapping, FK injection, relationship resolution, topological sort)
 *   3. Pure-code plan validation
 *
 * Throws PlanningError if the assembled plan fails integrity checks.
 */
export async function executePlanningPipeline(
  client: OllamaClient,
  userPrompt: string,
  onProgress: ProgressCallback
): Promise<ProjectPlan> {
  // ── Step 1: Single LLM call ──────────────────────────────────────────────
  onProgress('planning', 'Extracting project plan from prompt...')
  const llmPlan = await planProject(client, userPrompt)

  logger.info(
    'PlanningPipeline: LLM plan extracted — %d entities, authRequired=%s',
    llmPlan.entities.length,
    llmPlan.auth.required
  )

  // ── Step 2: Normalize ────────────────────────────────────────────────────
  onProgress('normalizing', 'Normalizing plan (types, relationships, endpoints)...')
  const plan = normalizePlan(llmPlan, userPrompt)

  logger.info(
    'PlanningPipeline: normalized — %d entities, %d relationships, %d endpoints',
    plan.entities.length,
    plan.relationships.length,
    plan.endpoints.length
  )
  for (const entity of plan.entities) {
    onProgress('entity', `Defined ${entity.name} entity (${entity.fields.length} fields)`)
  }

  // ── Step 3: Validate ─────────────────────────────────────────────────────
  onProgress('validation', 'Validating plan integrity...')
  const validation = validatePlan(plan)

  if (!validation.valid) {
    logger.warn(
      'PlanningPipeline: validation failed (%d errors): %s',
      validation.errors.length,
      validation.errors.join(' | ')
    )
    throw new PlanningError(
      `Plan validation failed with ${validation.errors.length} error(s)`,
      validation.errors
    )
  }

  if (validation.warnings.length > 0) {
    logger.warn(
      'PlanningPipeline: entity coverage warnings (%d): %s',
      validation.warnings.length,
      validation.warnings.join(' | ')
    )
  }

  logger.info('PlanningPipeline: plan validated — "%s"', plan.projectName)
  return plan
}
