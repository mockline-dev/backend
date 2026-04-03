import type { PlanEntity } from '../../types'
import type { ChatMessage, OllamaClient } from '../../llm/client'
import { getModelConfig } from '../../llm/client'
import { structuredLLMCall } from '../../llm/structured-output'
import { logger } from '../../logger'

import { EntitySchema } from './schemas'
import type { Requirements } from './schemas'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** One-line summary of already-extracted entities for context injection. */
function summariseExtracted(entities: PlanEntity[]): string {
  if (entities.length === 0) return 'None extracted yet.'
  return entities
    .map(e => `- ${e.name}: ${e.fields.map(f => f.name).join(', ')}`)
    .join('\n')
}

function isValidPythonIdentifier(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(name)
}

// ─── Post-validator ──────────────────────────────────────────────────────────

function postValidate(entity: PlanEntity, knownEntityNames: Set<string>): string[] {
  const errors: string[] = []

  if (entity.fields.length === 0) {
    errors.push(`Entity "${entity.name}" has no fields defined`)
  }

  for (const field of entity.fields) {
    if (!isValidPythonIdentifier(field.name)) {
      errors.push(
        `Field "${field.name}" is not a valid Python identifier (must be lowercase snake_case)`
      )
    }
    if (field.reference && !knownEntityNames.has(field.reference.entity)) {
      errors.push(
        `Field "${field.name}" references unknown entity "${field.reference.entity}"`
      )
    }
  }

  return errors
}

// ─── Extractor ────────────────────────────────────────────────────────────────

/**
 * Extracts one entity at a time — one LLM call per entity.
 *
 * Each call receives the compact summary of previously-extracted entities so
 * the model can use consistent field names and foreign keys.
 */
export async function extractEntities(
  client: OllamaClient,
  requirements: Requirements
): Promise<PlanEntity[]> {
  const knownEntityNames = new Set(requirements.entityNames)
  const extracted: PlanEntity[] = []

  for (const entityName of requirements.entityNames) {
    logger.debug('extractEntities: extracting "%s"', entityName)

    const context = summariseExtracted(extracted)

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a database architect. Output ONLY a JSON object with this EXACT structure:\n' +
          '{\n' +
          '  "name": "EntityName",\n' +
          '  "tableName": "table_name",\n' +
          '  "fields": [\n' +
          '    {"name": "field_name", "type": "string", "required": true, "unique": false}\n' +
          '  ],\n' +
          '  "timestamps": true,\n' +
          '  "softDelete": false\n' +
          '}\n' +
          'Rules:\n' +
          '- "name": PascalCase entity name (string)\n' +
          '- "tableName": snake_case plural table name (string)\n' +
          '- "fields": array of field objects (do NOT include id field)\n' +
          '- Each field: "name" (snake_case string), "type" (one of: string/text/number/float/boolean/date/email/password), "required" (boolean), "unique" (boolean)\n' +
          '- For foreign keys add: "reference": {"entity": "OtherEntity", "field": "id"}\n' +
          '- "timestamps": true if the entity needs created_at/updated_at (boolean)\n' +
          '- "softDelete": false unless explicitly needed (boolean)\n' +
          'Do NOT wrap the object in any outer key. Return the entity object directly.',
      },
      {
        role: 'user',
        content:
          `Project: ${requirements.description}\n\n` +
          `All entities in this project: ${requirements.entityNames.join(', ')}\n\n` +
          `Already defined entities:\n${context}\n\n` +
          `Define the "${entityName}" entity. Use snake_case field names. ` +
          `Return the JSON entity object directly (no wrapper key).`,
      },
    ]

    const modelCfg = getModelConfig('planning')
    let entity = await structuredLLMCall(client, EntitySchema, messages, {
      model: modelCfg.name,
      temperature: modelCfg.temperature,
      think: modelCfg.think,
    })

    // ── Post-validation (code, not LLM) ──────────────────────────────────────
    const errors = postValidate(entity as PlanEntity, knownEntityNames)

    if (errors.length > 0) {
      logger.warn('extractEntities: post-validation failed for "%s" — retrying', entityName)

      const retryMessages: ChatMessage[] = [
        ...messages,
        { role: 'assistant', content: JSON.stringify(entity) },
        {
          role: 'user',
          content:
            `The entity definition has validation errors:\n${errors.join('\n')}\n\n` +
            `Fix these issues and respond with corrected JSON.`,
        },
      ]

      entity = await structuredLLMCall(client, EntitySchema, retryMessages, {
        model: modelCfg.name,
        temperature: modelCfg.temperature,
        think: modelCfg.think,
      })
    }

    extracted.push(entity as PlanEntity)
    logger.info('extractEntities: "%s" extracted (%d fields)', entityName, entity.fields.length)
  }

  return extracted
}
