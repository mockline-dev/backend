import { logger } from '../../logger'
import { getProvider } from '../../llm/providers/registry'
import { buildGenerationPrompts } from '../../llm/prompts/generation.prompts'

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
}

export class IntentAnalyzer {
  async analyze(prompt: string): Promise<IntentSchema> {
    logger.debug('IntentAnalyzer: analyzing prompt (%d chars)', prompt.length)

    const provider = getProvider()
    let responseText = ''

    for await (const chunk of provider.chatStream(
      [{ role: 'user', content: buildGenerationPrompts.extractSchema(prompt) }],
      undefined,
      { temperature: 0.1 }
    )) {
      responseText += chunk.message.content
    }

    const schema = parseJson(responseText, 'intent schema')

    logger.debug('IntentAnalyzer: extracted schema with %d entities', schema.entities?.length ?? 0)
    return schema as IntentSchema
  }
}

function parseJson(text: string, context: string): any {
  const match = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  try {
    return JSON.parse((match?.[1] || text).trim())
  } catch (err) {
    logger.error('IntentAnalyzer: failed to parse %s JSON: %s', context, text.slice(0, 300))
    throw new Error(
      `IntentAnalyzer: failed to parse ${context}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
