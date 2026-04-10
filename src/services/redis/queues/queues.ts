import { createQueue } from './queue.client'

export interface OrchestrationJobData {
  projectId: string
  userId: string
  prompt: string
  conversationHistory?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  messageId?: string
}

export interface IndexingJobData {
  projectId?: string // if absent, syncs all stale projects
}

export const orchestrationQueue = createQueue<OrchestrationJobData>('orchestration')
export const indexingQueue = createQueue<IndexingJobData>('indexing')
