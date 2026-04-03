import type { PlanEntity, PlanRelationship } from '../../types'
import type { ChatMessage, OllamaClient } from '../../llm/client'
import { getModelConfig } from '../../llm/client'
import { structuredLLMCall } from '../../llm/structured-output'
import { logger } from '../../logger'

import { RelationshipsSchema } from './schemas'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSnakeCase(s: string): string {
  return s
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toLowerCase()
}

function summariseEntities(entities: PlanEntity[]): string {
  return entities
    .map(e => {
      const fields = e.fields
        .map(f => `${f.name}:${f.type}${f.reference ? `→FK(${f.reference.entity})` : ''}`)
        .join(', ')
      return `- ${e.name} (table: ${e.tableName}): ${fields}`
    })
    .join('\n')
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

/**
 * Infers relationships from entity definitions.
 *
 * Post-validation:
 * - unknown entity references are dropped
 * - duplicates are removed
 * - many-to-many gets a junctionTable if one was not provided
 * - for one-to-many, if the FK field is missing on the "many" entity it is injected
 */
export async function mapRelationships(
  client: OllamaClient,
  entities: PlanEntity[]
): Promise<PlanRelationship[]> {
  const entityNames = new Set(entities.map(e => e.name))
  const entityMap = new Map(entities.map(e => [e.name, e]))

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a database architect. Output ONLY a JSON object with this EXACT structure:\n' +
        '{"relationships": [{"from": "Entity1", "to": "Entity2", "type": "one-to-many", "foreignKey": "entity1_id"}]}\n' +
        'Rules:\n' +
        '- "from": owner entity (PascalCase)\n' +
        '- "to": dependent entity (PascalCase)\n' +
        '- "type": one of one-to-one, one-to-many, many-to-many\n' +
        '- "foreignKey": snake_case FK field name on the "to" entity\n' +
        '- For many-to-many add "junctionTable": "table_name"\n' +
        'Return only the {"relationships": [...]} wrapper object.',
    },
    {
      role: 'user',
      content: `Entities:\n${summariseEntities(entities)}\n\nIdentify all relationships between these entities.`,
    },
  ]

  const modelCfg = getModelConfig('planning')
  const result = await structuredLLMCall(client, RelationshipsSchema, messages, {
    model: modelCfg.name,
    temperature: modelCfg.temperature,
    think: modelCfg.think,
  })

  const relationships: PlanRelationship[] = []
  const seen = new Set<string>()

  for (const rel of result.relationships) {
    // Validate entity existence
    if (!entityNames.has(rel.from) || !entityNames.has(rel.to)) {
      logger.warn(
        'mapRelationships: dropping relationship with unknown entity "%s" or "%s"',
        rel.from,
        rel.to
      )
      continue
    }

    // Deduplicate
    const key = `${rel.from}:${rel.to}:${rel.type}`
    if (seen.has(key)) {
      logger.warn('mapRelationships: duplicate relationship dropped: %s', key)
      continue
    }
    seen.add(key)

    // many-to-many: ensure junctionTable
    let junctionTable = rel.junctionTable
    if (rel.type === 'many-to-many' && !junctionTable) {
      junctionTable = `${toSnakeCase(rel.from)}_${toSnakeCase(rel.to)}`
      logger.info('mapRelationships: generated junctionTable "%s"', junctionTable)
    }

    // one-to-many: inject missing FK on the "to" (many) entity
    if (rel.type === 'one-to-many') {
      const manyEntity = entityMap.get(rel.to)
      if (manyEntity) {
        const hasFK = manyEntity.fields.some(f => f.name === rel.foreignKey)
        if (!hasFK) {
          logger.info(
            'mapRelationships: injecting missing FK field "%s" into "%s"',
            rel.foreignKey,
            rel.to
          )
          manyEntity.fields.push({
            name: rel.foreignKey,
            type: 'number',
            required: false,
            unique: false,
            reference: { entity: rel.from, field: 'id' },
          })
        }
      }
    }

    relationships.push({
      from: rel.from,
      to: rel.to,
      type: rel.type,
      foreignKey: rel.foreignKey,
      ...(junctionTable !== undefined ? { junctionTable } : {}),
    })
  }

  return relationships
}
