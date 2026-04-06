import { createModuleLogger } from '../../logging'
import { Intent } from '../types'
import type { ClassifiedIntent, ILLMProvider, LLMCallOptions } from '../types'

const log = createModuleLogger('intent-classifier')

const CLASSIFIER_PROMPT = `You are an intent classifier for an AI-powered backend code generator.

Classify the user's message into exactly one of these intents:

- generate_project: User wants to BUILD or CREATE a new backend project, API, service, or app from scratch.
  Examples: "build a REST API for a blog", "create a FastAPI todo app", "make a user authentication service",
  "I need a backend for an e-commerce site", "build me a CRUD API with MongoDB"

- edit_code: User wants to MODIFY, REFACTOR, or UPDATE code that already exists.
  Examples: "change the user model to add email", "refactor the auth module", "update the endpoint to return JSON"

- explain_code: User wants to UNDERSTAND how existing code works.
  Examples: "explain the auth middleware", "what does this function do", "how does the JWT refresh work"

- fix_bug: User wants to DEBUG or FIX an error, exception, or unexpected behaviour.
  Examples: "fix the 500 error on login", "the endpoint crashes when user is null", "getting a KeyError in production"

- add_feature: User wants to ADD a specific NEW feature to an EXISTING project.
  Examples: "add pagination to the users endpoint", "add email notifications", "add rate limiting"

- general: Anything else — questions about tools, concepts, comparisons, or unclear intent.

IMPORTANT: If the user is building or creating something new (API, service, app, project), always use generate_project.

Return ONLY valid JSON:
{
  "intent": "<intent_value>",
  "confidence": <0.0-1.0>,
  "entities": {
    "framework": "<detected framework or ''>",
    "language": "<detected language or ''>"
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
    timeoutMs: 15_000
  }

  try {
    const response = await provider.chat(
      [
        { role: 'system', content: CLASSIFIER_PROMPT },
        { role: 'user', content: query }
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
      model: response.model
    })

    return {
      intent,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
      entities: parsed.entities ?? {}
    }
  } catch (err: unknown) {
    log.warn('Intent classification failed, defaulting to General', {
      error: err instanceof Error ? err.message : String(err)
    })
    return {
      intent: Intent.General,
      confidence: 0.5,
      entities: {}
    }
  }
}
