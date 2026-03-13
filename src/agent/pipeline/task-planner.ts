import { logger } from '../../logger'
import { getProvider } from '../../llm/providers/registry'
import { buildGenerationPrompts } from '../../llm/prompts/generation.prompts'
import type { IntentSchema } from './intent-analyzer'

export interface TaskPlan {
  path: string
  description: string
}

const REQUIRED_FASTAPI_FILES: TaskPlan[] = [
  { path: 'requirements.txt', description: 'Python dependencies' },
  { path: 'main.py', description: 'FastAPI app entrypoint' }
]

export class TaskPlanner {
  async plan(prompt: string, schema: IntentSchema): Promise<TaskPlan[]> {
    logger.debug('TaskPlanner: planning file structure for project "%s"', schema.projectName)

    const provider = getProvider()
    let responseText = ''

    for await (const chunk of provider.chatStream(
      [{ role: 'user', content: buildGenerationPrompts.filePlan(prompt, schema) }],
      undefined,
      { temperature: 0.1 }
    )) {
      responseText += chunk.message.content
    }

    const raw = parseJson(responseText, 'file plan')

    if (!Array.isArray(raw)) {
      throw new Error('TaskPlanner: file plan is not an array')
    }

    const normalized: TaskPlan[] = raw
      .filter((item: any) => typeof item === 'object' && item !== null)
      .map((item: any) => ({
        path: String(item.path ?? '').trim(),
        description: String(item.description ?? 'Generated file').trim()
      }))
      .filter(item => item.path.length > 0)

    if (normalized.length === 0) {
      throw new Error('TaskPlanner: file plan is empty')
    }

    return this.ensureRequiredFiles(normalized)
  }

  private ensureRequiredFiles(plan: TaskPlan[]): TaskPlan[] {
    const existing = new Set(plan.map(f => f.path))
    const result = [...plan]
    for (const required of REQUIRED_FASTAPI_FILES) {
      if (!existing.has(required.path)) {
        logger.warn('TaskPlanner: injecting missing required file: %s', required.path)
        result.unshift(required)
      }
    }
    return result
  }
}

function parseJson(text: string, context: string): any {
  const match = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  try {
    return JSON.parse((match?.[1] || text).trim())
  } catch (err) {
    logger.error('TaskPlanner: failed to parse %s JSON: %s', context, text.slice(0, 300))
    throw new Error(
      `TaskPlanner: failed to parse ${context}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
