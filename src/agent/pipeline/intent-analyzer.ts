import { buildGenerationPrompts } from '../../llm/prompts/generation.prompts'
import { getProvider } from '../../llm/providers/registry'
import { logger } from '../../logger'

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
  const candidates: string[] = []
  const fenced = text.match(/```json\n?([\s\S]*?)\n?```/)

  if (fenced?.[1]) {
    candidates.push(fenced[1].trim())
  }

  const direct = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (direct?.[1]) {
    candidates.push(direct[1].trim())
  }

  candidates.push(text.trim())

  const firstJsonStart = text.search(/[\[{]/)
  if (firstJsonStart >= 0) {
    const trimmed = text.slice(firstJsonStart).trim()
    const lastBrace = trimmed.lastIndexOf('}')
    const lastBracket = trimmed.lastIndexOf(']')
    const end = Math.max(lastBrace, lastBracket)
    if (end > 0) {
      candidates.push(trimmed.slice(0, end + 1).trim())
    }
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }
    try {
      return JSON.parse(candidate)
    } catch {
      // try next candidate
    }
  }

  logger.error('IntentAnalyzer: failed to parse %s JSON: %s', context, text.slice(0, 500))
  throw new Error(`IntentAnalyzer: failed to parse ${context}: model response is not valid JSON`)
}
