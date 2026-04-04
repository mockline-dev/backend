// ─── Project lifecycle ────────────────────────────────────────────────────────

export enum ProjectStatus {
  created = 'created',
  planning = 'planning',
  scaffolding = 'scaffolding',
  generating = 'generating',
  validating = 'validating',
  ready = 'ready',
  error = 'error',
  editing = 'editing'
}

// ─── Plan entities ────────────────────────────────────────────────────────────

export interface PlanFieldReference {
  entity: string
  field: string
}

export interface PlanField {
  name: string
  type: string
  required: boolean
  unique: boolean
  default?: unknown
  reference?: PlanFieldReference
}

export interface PlanEntity {
  name: string
  tableName: string
  fields: PlanField[]
  timestamps: boolean
  softDelete: boolean
  /** Feature flags extracted from the LLM plan (e.g. 'slug', 'search', 'filter') */
  features: string[]
}

export interface PlanRelationship {
  from: string
  to: string
  type: 'one-to-one' | 'one-to-many' | 'many-to-many'
  foreignKey: string
  junctionTable?: string
}

export interface PlanEndpoint {
  path: string
  methods: string[]
  auth: Record<string, boolean>
  description: string
}

export interface ProjectPlan {
  projectName: string
  description: string
  features: string[]
  entities: PlanEntity[]
  relationships: PlanRelationship[]
  endpoints: PlanEndpoint[]
  authRequired: boolean
  externalPackages: string[]
}

// ─── Generation ───────────────────────────────────────────────────────────────

export interface GeneratedFile {
  path: string
  content: string
  source: 'template' | 'llm'
  validated: boolean
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationError {
  file: string
  line?: number
  code?: string
  message: string
  severity: 'error' | 'warning'
}

export interface ValidationResult {
  passed: boolean
  errors: ValidationError[]
  round: number
}

// ─── Tool calling ─────────────────────────────────────────────────────────────

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  name: string
  result: string
  success: boolean
}
