import { createQueue } from './queue.client'

// ─── Job Data Types ───────────────────────────────────────────────────────────

export interface OrchestrationJobData {
  projectId: string
  userId: string
  prompt: string
  conversationHistory?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  /** ID of the user message that triggered this job */
  messageId?: string
}

export interface IndexingJobData {
  /** If absent, the worker syncs all stale projects */
  projectId?: string
}

// ─── Queue Instances ─────────────────────────────────────────────────────────

export const orchestrationQueue = createQueue<OrchestrationJobData>('orchestration')
export const indexingQueue = createQueue<IndexingJobData>('indexing')
