import { createQueue } from './queue.client'

export interface ValidationJobData {
  projectId: string
  /** Serialised list of generated files waiting for validation */
  files: Array<{ path: string; content: string }>
}

export const validationQueue = createQueue('code-validation')
