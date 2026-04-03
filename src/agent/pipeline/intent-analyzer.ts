import { logger } from '../../logger'
import { llmClient, getModelConfig } from '../../llm/client'
import { stripThinkTags } from '../../llm/structured-output'
import { buildGenerationPrompts } from '../../llm/prompts/generation.prompts'
import { parseJson, withRetry } from './utils'

export interface IntentSchema {
  projectName: string
  description: string
  entities: Array<{
    name: string
    fields: Array<{ name: string; type: string; required: boolean; indexed: boolean }>
    endpoints: string[]
  }>
  features: string[]
  authType: 'jwt' | 'none' | 'oauth2'
  relationships?: Array<{
    from: string
    to: string
    type: 'one-to-many' | 'many-to-one' | 'one-to-one' | 'many-to-many'
    foreignKey?: string
  }>
}

export class IntentAnalyzer {
  async analyze(prompt: string): Promise<IntentSchema> {
    logger.debug('IntentAnalyzer: analyzing prompt (%d chars)', prompt.length)

    const schema = await withRetry(
      () => this.callLLM(prompt),
      2,
      [1000, 2000],
      'IntentAnalyzer'
    )

    logger.debug('IntentAnalyzer: extracted schema with %d entities', schema.entities?.length ?? 0)
    return schema as IntentSchema
  }

  private async callLLM(prompt: string): Promise<IntentSchema> {
    const modelCfg = getModelConfig('planning')

    const response = await llmClient.chat({
      model: modelCfg.name,
      messages: [
        { role: 'system', content: 'You are a backend architecture expert. Always respond with valid JSON only. No markdown, no explanation.' },
        { role: 'user', content: buildGenerationPrompts.extractSchema(prompt) }
      ],
      temperature: modelCfg.temperature,
      think: modelCfg.think,
      format: 'json'
    })

    const raw = stripThinkTags(response.content)
    const schema = parseJson(raw, 'intent schema')

    // Runtime validation
    if (!Array.isArray(schema.entities) || schema.entities.length === 0) {
      throw new Error('IntentAnalyzer: schema.entities must be a non-empty array')
    }
    for (const entity of schema.entities) {
      if (typeof entity.name !== 'string' || !entity.name) {
        throw new Error('IntentAnalyzer: each entity must have a name field')
      }
      if (!Array.isArray(entity.fields)) {
        throw new Error(`IntentAnalyzer: entity ${entity.name} must have a fields array`)
      }
    }

    return schema as IntentSchema
  }
}
