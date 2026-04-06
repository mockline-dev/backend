import { createQueue } from './queue.client'

// ─── Job Data Types ───────────────────────────────────────────────────────────

export interface GenerationJobData {
  projectId: string
  prompt: string
  userId: string
  model: string
}

export interface ValidationJobData {
  projectId: string
  /** Serialised list of generated files waiting for validation */
  files: Array<{ path: string; content: string }>
}

export interface OrchestrationJobData {
  projectId: string
  userId: string
  prompt: string
  conversationHistory?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
}

export interface IndexingJobData {
  /** If absent, the worker syncs all stale projects */
  projectId?: string
}

// ─── Queue Instances ─────────────────────────────────────────────────────────

export const generationQueue = createQueue<GenerationJobData>('generation')
export const validationQueue = createQueue<ValidationJobData>('validation')
export const orchestrationQueue = createQueue<OrchestrationJobData>('orchestration')
export const indexingQueue = createQueue<IndexingJobData>('indexing')
