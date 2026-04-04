import { Intent } from '../types'

export interface IntentConfig {
  needsRAG: boolean
  description: string
}

export const INTENT_CONFIG: Record<Intent, IntentConfig> = {
  [Intent.GenerateProject]: {
    needsRAG: false,
    description: 'Generate a new backend project from a description',
  },
  [Intent.EditCode]: {
    needsRAG: true,
    description: 'Edit or modify existing code in the project',
  },
  [Intent.ExplainCode]: {
    needsRAG: true,
    description: 'Explain how existing code works',
  },
  [Intent.FixBug]: {
    needsRAG: true,
    description: 'Identify and fix a bug in the project',
  },
  [Intent.AddFeature]: {
    needsRAG: true,
    description: 'Add a new feature to the existing project',
  },
  [Intent.General]: {
    needsRAG: false,
    description: 'General programming question or conversation',
  },
}

export { Intent }
