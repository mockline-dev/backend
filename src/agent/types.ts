export type AgentStepName =
  | 'analyze_requirements'
  | 'generate_architecture'
  | 'decompose_tasks'
  | 'create_db_schema'
  | 'generate_services'
  | 'generate_routes'
  | 'generate_validation'
  | 'generate_tests'
  | 'assemble_project'

export interface GeneratedFile {
  path: string
  content: string
}

export interface PipelineStepMetric {
  step: AgentStepName
  model?: string
  task?: string
  temperature?: number
  startedAt: number
  completedAt?: number
  durationMs?: number
  filesBefore?: number
  filesAfter?: number
  filesAdded?: number
  parsedFiles?: number
  fallbackUsed?: boolean
  summary?: string
}

export interface PromptComplexityProfile {
  score: number
  level: 'low' | 'medium' | 'high'
  reasons: string[]
}

export interface PipelineContext {
  generationId: string
  projectId: string
  userId: string
  prompt: string
  framework: 'fast-api' | 'feathers'
  language: 'python' | 'typescript'
  targetModel?: string
  intentSummary?: string
  architecturePlan?: string
  taskPlan?: string[]
  files: GeneratedFile[]
  warnings: string[]
  metadata: Record<string, unknown> & {
    stepMetrics?: PipelineStepMetric[]
    complexity?: PromptComplexityProfile
  }
}

export interface AgentExecutionInput {
  step: AgentStepName
  context: PipelineContext
}

export interface AgentExecutionResult {
  step: AgentStepName
  context: PipelineContext
  summary: string
}
