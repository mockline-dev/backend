import { createQueue } from './queue.client'

export interface GenerationJobData {
  projectId: string
  prompt: string
  userId: string
  model: string
}

export const generationQueue = createQueue('code-generation')
