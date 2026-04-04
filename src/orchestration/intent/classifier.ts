import { createModuleLogger } from '../../logging'
import { Intent } from '../types'
import type { ClassifiedIntent, ILLMProvider, LLMCallOptions } from '../types'

const log = createModuleLogger('intent-classifier')

const CLASSIFIER_PROMPT = `You are an intent classifier for an AI-powered backend code generator.

Classify the user's message into exactly one of these intents:
- generate_project: User wants to create a new backend project from scratch
- edit_code: User wants to modify, refactor, or update existing code
- explain_code: User wants to understand how code works
- fix_bug: User wants to debug or fix an error/bug
- add_feature: User wants to add a new feature to an existing project
- general: General programming question or anything else

Return ONLY valid JSON with this structure:
{
  "intent": "<intent_value>",
  "confidence": <0.0-1.0>,
  "entities": {
    "framework": "<detected framework if any, else ''>",
    "language": "<detected language if any, else ''>"
  }
}`

/**
 * Classifies user query into a structured intent using a fast LLM call.
 * Falls back to Intent.General on any failure — never throws.
 */
export async function classifyIntent(
  query: string,
  provider: ILLMProvider,
  classifierModel?: string
): Promise<ClassifiedIntent> {
  const opts: LLMCallOptions = {
    model: classifierModel,
    temperature: 0.1,
    maxTokens: 200,
    json: true,
    timeoutMs: 15_000,
  }

  try {
    const response = await provider.chat(
      [
        { role: 'system', content: CLASSIFIER_PROMPT },
        { role: 'user', content: query },
      ],
      opts
    )

    const parsed = JSON.parse(response.content) as {
      intent?: string
      confidence?: number
      entities?: Record<string, string>
    }

    const intent = Object.values(Intent).includes(parsed.intent as Intent)
      ? (parsed.intent as Intent)
      : Intent.General

    log.debug('Intent classified', {
      intent,
      confidence: parsed.confidence,
      model: response.model,
    })

    return {
      intent,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
      entities: parsed.entities ?? {},
    }
  } catch (err: unknown) {
    log.warn('Intent classification failed, defaulting to General', {
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      intent: Intent.General,
      confidence: 0.5,
      entities: {},
    }
  }
}
