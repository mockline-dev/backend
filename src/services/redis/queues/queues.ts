import type { AgentStepName, PipelineContext } from '../../../agent/types'
import { createQueue } from './queue.client'

export interface GenerationJobData {
  projectId: string
  prompt: string
  userId: string
  model: string
  framework: 'fast-api' | 'feathers'
  language: 'python' | 'typescript'
  generationId?: string
}

export interface AgentJobData {
  generationId: string
  projectId: string
  step: AgentStepName
  context: PipelineContext
}

export interface ValidationJobData {
  projectId: string
  /** Serialised list of generated files waiting for validation */
  files: Array<{ path: string; content: string }>
}

export interface EmbeddingJobData {
  projectId: string
  files: Array<{ path: string; content: string }>
}

export interface DeploymentJobData {
  deploymentId: string
  projectId: string
  target: string
}

export const generationQueue = createQueue('code-generation')
export const validationQueue = createQueue('code-validation')
export const embeddingQueue = createQueue('embedding-tasks')
export const deploymentQueue = createQueue('deployment-tasks')
export const agentQueue = createQueue('agent-tasks')
