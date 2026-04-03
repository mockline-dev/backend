import type { ProjectPlan } from '../../types'
import type { OllamaClient } from '../../llm/client'
import { logger } from '../../logger'

import { decomposeRequirements } from './requirements-decomposer'
import { extractEntities } from './entity-extractor'
import { mapRelationships } from './relationship-mapper'
import { planAPIContracts } from './api-contract-planner'
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
 * Orchestrates all planning sub-steps:
 *   1. Decompose requirements
 *   2. Extract entities (one LLM call per entity)
 *   3. Map relationships
 *   4. Plan API contracts
 *   5. Validate the assembled plan
 *
 * Throws PlanningError if the assembled plan fails integrity checks.
 */
export async function executePlanningPipeline(
  client: OllamaClient,
  userPrompt: string,
  onProgress: ProgressCallback
): Promise<ProjectPlan> {
  // ── Step 1: Requirements ───────────────────────────────────────────────────
  onProgress('requirements', 'Decomposing requirements...')
  const requirements = await decomposeRequirements(client, userPrompt)
  logger.info(
    'PlanningPipeline: requirements extracted — %d entities, authRequired=%s',
    requirements.entityNames.length,
    requirements.authRequired
  )

  // ── Step 2: Entities ───────────────────────────────────────────────────────
  onProgress('entities', `Extracting ${requirements.entityNames.length} entities...`)
  const entities = await extractEntities(client, requirements)
  for (const entity of entities) {
    onProgress('entity', `Defined ${entity.name} entity (${entity.fields.length} fields)`)
  }
  logger.info('PlanningPipeline: %d entities extracted', entities.length)

  // ── Step 3: Relationships ──────────────────────────────────────────────────
  onProgress('relationships', 'Mapping relationships...')
  const relationships = await mapRelationships(client, entities)
  logger.info('PlanningPipeline: %d relationships mapped', relationships.length)

  // ── Step 4: API contracts ──────────────────────────────────────────────────
  onProgress('api', 'Planning API contracts...')
  const endpoints = await planAPIContracts(
    client,
    entities,
    relationships,
    requirements.authRequired
  )
  logger.info('PlanningPipeline: %d endpoints planned', endpoints.length)

  // ── Step 5: Assemble plan ──────────────────────────────────────────────────
  const plan: ProjectPlan = {
    projectName: requirements.projectName,
    description: requirements.description,
    features: requirements.features,
    entities,
    relationships,
    endpoints,
    authRequired: requirements.authRequired,
    externalPackages: requirements.externalPackages,
  }

  // ── Step 6: Validate ───────────────────────────────────────────────────────
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
