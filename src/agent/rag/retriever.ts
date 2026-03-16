import { ContextBuilder } from '../../ai/context-builder'
import type { Application } from '../../declarations'

interface RelevantFile {
  path: string
  content: string
  score: number
}

export class ContextRetriever {
  constructor(private readonly app: Application) {}

  async getRelevantFiles(projectId: string, query: string, limit = 8): Promise<RelevantFile[]> {
    const builder = new ContextBuilder(this.app)
    const ctx = await builder.build(projectId, 40)

    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter(Boolean)

    const scored = ctx.files
      .map(file => {
        const haystack = `${file.path}\n${file.content}`.toLowerCase()
        const score = tokens.reduce((acc, token) => (haystack.includes(token) ? acc + 1 : acc), 0)
        return {
          path: file.path,
          content: file.content,
          score
        }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return scored
  }
}
