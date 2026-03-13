import type { Db } from 'mongodb'
import type { Application } from '../../declarations'
import { logger } from '../../logger'

export interface ProjectMemoryData {
  projectId: string
  /** e.g. ["FastAPI", "MongoDB", "JWT"] */
  stack: string[]
  /** Last 20 user prompts (trimmed to 200 chars each) */
  prompts: string[]
  /** Recorded architecture decisions, max 30 */
  architectureDecisions: string[]
  codingStyle: {
    language?: string // "python" | "typescript"
    framework?: string // "fast-api" | "feathers"
    preferredPatterns?: string[]
  }
  updatedAt: number
}

/**
 * Per-project persistent AI memory.
 *
 * Stored in the `ai_memory` MongoDB collection.
 * Injected as a context block into every LLM system prompt, giving the model
 * project-specific knowledge across sessions.
 */
export class ProjectMemory {
  private app: Application

  constructor(app: Application) {
    this.app = app
  }

  private async collection() {
    const db: Db = await this.app.get('mongodbClient')
    const col = db.collection('ai_memory')
    await col.createIndex({ projectId: 1 }, { unique: true })
    return col
  }

  async load(projectId: string): Promise<ProjectMemoryData | null> {
    try {
      const col = await this.collection()
      return (await col.findOne({ projectId })) as ProjectMemoryData | null
    } catch (err: any) {
      logger.warn('ProjectMemory.load: %s', err.message)
      return null
    }
  }

  /**
   * Called once when a project is first created to bootstrap memory with known facts.
   */
  async initialize(projectId: string, meta: { language: string; framework: string }): Promise<void> {
    const langMap: Record<string, string> = { python: 'Python', typescript: 'TypeScript' }
    const fwMap: Record<string, string> = { 'fast-api': 'FastAPI', feathers: 'FeathersJS' }

    const memory: ProjectMemoryData = {
      projectId,
      stack: [langMap[meta.language] ?? meta.language, fwMap[meta.framework] ?? meta.framework].filter(
        Boolean
      ),
      prompts: [],
      architectureDecisions: [],
      codingStyle: {
        language: meta.language,
        framework: meta.framework,
        preferredPatterns: []
      },
      updatedAt: Date.now()
    }

    try {
      const col = await this.collection()
      await col.updateOne({ projectId }, { $set: memory }, { upsert: true })
    } catch (err: any) {
      logger.warn('ProjectMemory.initialize: %s', err.message)
    }
  }

  /** Record a new user prompt (automatically capped at 20 most recent). */
  async recordPrompt(projectId: string, prompt: string): Promise<void> {
    try {
      const col = await this.collection()
      const trimmed = prompt.slice(0, 200)
      await col.updateOne(
        { projectId },
        {
          $push: { prompts: { $each: [trimmed], $slice: -20 } } as any,
          $set: { updatedAt: Date.now() }
        },
        { upsert: true }
      )
    } catch (err: any) {
      logger.warn('ProjectMemory.recordPrompt: %s', err.message)
    }
  }

  /** Record architecture decisions after generation or extraction. */
  async recordDecisions(projectId: string, decisions: string[]): Promise<void> {
    if (!decisions.length) return
    try {
      const col = await this.collection()
      await col.updateOne(
        { projectId },
        {
          $push: { architectureDecisions: { $each: decisions, $slice: -30 } } as any,
          $set: { updatedAt: Date.now() }
        },
        { upsert: true }
      )
    } catch (err: any) {
      logger.warn('ProjectMemory.recordDecisions: %s', err.message)
    }
  }

  /** Update coding style facts (e.g. from architecture extraction). */
  async updateCodingStyle(
    projectId: string,
    patches: Partial<ProjectMemoryData['codingStyle']>
  ): Promise<void> {
    try {
      const col = await this.collection()
      const updates: Record<string, any> = { updatedAt: Date.now() }
      for (const [k, v] of Object.entries(patches)) {
        updates[`codingStyle.${k}`] = v
      }
      await col.updateOne({ projectId }, { $set: updates }, { upsert: true })
    } catch (err: any) {
      logger.warn('ProjectMemory.updateCodingStyle: %s', err.message)
    }
  }

  /**
   * Returns a formatted context block ready for injection into any system prompt.
   * Returns an empty string when no memory is recorded yet.
   */
  buildContextBlock(memory: ProjectMemoryData | null): string {
    if (!memory) return ''

    const lines: string[] = ['## Project Memory']

    if (memory.stack?.length) {
      lines.push(`Stack: ${memory.stack.join(', ')}`)
    }
    if (memory.codingStyle?.language) {
      lines.push(`Language: ${memory.codingStyle.language}`)
    }
    if (memory.codingStyle?.framework) {
      lines.push(`Framework: ${memory.codingStyle.framework}`)
    }
    if (memory.codingStyle?.preferredPatterns?.length) {
      lines.push(`Patterns: ${memory.codingStyle.preferredPatterns.join(', ')}`)
    }
    if (memory.prompts?.length) {
      const recent = memory.prompts.slice(-5)
      lines.push(`\nRecent prompts:\n${recent.map(p => `- ${p}`).join('\n')}`)
    }
    if (memory.architectureDecisions?.length) {
      const recent = memory.architectureDecisions.slice(-10)
      lines.push(`\nArchitecture decisions:\n${recent.map(d => `- ${d}`).join('\n')}`)
    }

    return lines.join('\n')
  }
}
