/**
 * Type definitions for the Generation Pipeline
 * Improves type safety and provides clear interfaces
 */

import type { Projects } from '../../services/projects/projects.schema'

export interface PipelineOptions {
  projectId: string
  prompt: string
  userId: string
  onProgress: (stage: string, percentage: number, currentFile?: string) => Promise<void>
  jobId?: string | number
  stackId?: string
}

export interface PipelineResult {
  files: GeneratedFile[]
  fileCount: number
  totalSize: number
  architectureId?: string
  warnings?: string[]
}

export interface GeneratedFile {
  path: string
  content: string
}

export interface ValidationError {
  field: string
  message: string
}

export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

export interface FileValidationIssue {
  path: string
  line?: number
  message: string
  severity: 'error' | 'warning'
}

export interface CriticalFileValidationResult {
  missingFiles: string[]
  emptyFiles: string[]
  syntaxErrors: FileValidationIssue[]
  dependencyIssues: string[]
}

export interface PersistedFileInfo {
  path: string
  size: number
  key?: string
}

export interface ProjectInfo {
  _id: string
  language: 'python' | 'typescript'
  framework: 'fast-api' | 'feathers'
}

export type ProjectData = Projects | null

export interface ArchitectureData {
  services: Array<{ name: string }>
  models: Array<{ name: string }>
  relations: Array<{ from: string; to: string; type: string }>
  routes: Array<{ path: string; method: string }>
}
