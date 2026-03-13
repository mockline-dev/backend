import { createQueue } from './queue.client'

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

export const generationQueue = createQueue('code-generation')
export const validationQueue = createQueue('code-validation')
