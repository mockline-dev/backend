import type { Application } from '../../declarations'

interface ProjectMemoryData {
  recentPrompts: string[]
  recentMessages: string[]
}

export class ProjectMemory {
  constructor(private readonly app: Application) {}

  async recordPrompt(projectId: string, prompt: string): Promise<void> {
    try {
      await this.app.service('prompts').create({
        projectId,
        kind: 'user_prompt',
        content: prompt,
        createdAt: Date.now(),
        updatedAt: Date.now()
      } as any)
    } catch {
      // best effort memory
    }
  }

  async load(projectId: string): Promise<ProjectMemoryData> {
    const [prompts, messages] = await Promise.all([
      this.app
        .service('prompts')
        .find({ query: { projectId, $limit: 10, $sort: { createdAt: -1 } } })
        .catch(() => ({ data: [] })),
      this.app
        .service('messages')
        .find({ query: { projectId, $limit: 10, $sort: { createdAt: -1 } } })
        .catch(() => ({ data: [] }))
    ])

    const promptData = Array.isArray((prompts as any).data) ? (prompts as any).data : []
    const messageData = Array.isArray((messages as any).data) ? (messages as any).data : []

    return {
      recentPrompts: promptData.map((item: any) => item.content).filter(Boolean),
      recentMessages: messageData.map((item: any) => item.content).filter(Boolean)
    }
  }

  buildContextBlock(memory: ProjectMemoryData): string {
    const promptSection = memory.recentPrompts.length
      ? `Recent prompts:\n${memory.recentPrompts.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}`
      : 'Recent prompts: none'

    const messageSection = memory.recentMessages.length
      ? `Recent assistant messages:\n${memory.recentMessages.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}`
      : 'Recent assistant messages: none'

    return `${promptSection}\n\n${messageSection}`
  }
}
