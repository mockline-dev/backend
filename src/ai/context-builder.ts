import type { Application } from '../declarations'
import { r2Client } from '../storage/r2.client'

export interface RetrievedProjectContext {
  architectureSummary?: string
  files: Array<{ path: string; content: string }>
}

export class ContextBuilder {
  constructor(private readonly app: Application) {}

  async build(projectId: string, maxFiles = 8): Promise<RetrievedProjectContext> {
    const architectureRecords = await this.app.service('architecture').find({
      query: { projectId, $limit: 1, $sort: { updatedAt: -1 } }
    })

    const architectureSummary = Array.isArray((architectureRecords as any)?.data)
      ? (architectureRecords as any).data[0]?.summary
      : undefined

    const prefix = `projects/${projectId}/workspace/`
    const objects = await r2Client.listObjects(prefix)
    const files: Array<{ path: string; content: string }> = []

    for (const object of objects.slice(0, maxFiles)) {
      const content = await r2Client.getObject(object.key)
      files.push({
        path: object.key.replace(prefix, ''),
        content
      })
    }

    return { architectureSummary, files }
  }
}
