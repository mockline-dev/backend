import { createModuleLogger } from '../../logging'
import { Intent } from '../types'
import type { ILLMProvider } from '../types'
import { getEnhancementTemplate, interpolateTemplate, type EnhancementContext } from './templates'

const log = createModuleLogger('prompt-enhancer')

// Intents that benefit from enhancement
const ENHANCE_INTENTS = new Set([Intent.GenerateProject, Intent.EditCode, Intent.AddFeature, Intent.FixBug])

/**
 * Enhances a user prompt before it's sent to the main LLM.
 * Uses the fast classifier model (Groq 8B) to enrich vague prompts
 * with technical specifics appropriate for the intent and project context.
 *
 * Returns the original prompt unchanged for intents that don't benefit
 * from enhancement (ExplainCode, General) or on any failure.
 */
export async function enhancePrompt(
  prompt: string,
  intent: Intent,
  projectMeta: EnhancementContext,
  provider: ILLMProvider
): Promise<string> {
  if (!ENHANCE_INTENTS.has(intent)) {
    return prompt
  }

  // Skip very long prompts — they're already detailed enough
  if (prompt.length > 2000) {
    return prompt
  }

  const template = getEnhancementTemplate(intent)
  if (!template) {
    return prompt
  }

  try {
    const systemPrompt = interpolateTemplate(template, { prompt, ...projectMeta })

    const response = await provider.chat([{ role: 'user', content: systemPrompt }], {
      temperature: 0.3,
      maxTokens: 1024,
      timeoutMs: 15000
    })

    const enhanced = response.content.trim()

    // Sanity check: enhanced prompt should be at least as long as original
    if (enhanced.length < prompt.length * 0.5) {
      log.warn('Enhancement produced suspiciously short result, using original', {
        original: prompt.length,
        enhanced: enhanced.length,
        intent
      })
      return prompt
    }

    log.debug('Prompt enhanced', {
      intent,
      originalLength: prompt.length,
      enhancedLength: enhanced.length
    })

    return enhanced
  } catch (err: unknown) {
    log.warn('Prompt enhancement failed, using original', {
      error: err instanceof Error ? err.message : String(err),
      intent
    })
    return prompt
  }
}
