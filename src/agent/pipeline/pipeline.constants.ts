/**
 * Constants for the Generation Pipeline
 * Centralizes magic numbers, file lists, and configuration values
 */

// Progress percentage constants for each pipeline stage
export const PROGRESS_STAGES = {
  INTENT_ANALYSIS: 5,
  SCHEMA_VALIDATION: 10,
  TASK_PLANNING: 15,
  FILE_GENERATION_START: 20,
  FILE_GENERATION_END: 80,
  FILE_STRUCTURE_VALIDATION: 75,
  CROSS_FILE_VALIDATION: 80,
  VALIDATION_BEFORE_PERSISTENCE: 80,
  SAVING_FILES: 82,
  FINAL_VALIDATION: 90,
  ARCHITECTURE_EXTRACTION: 95,
  COMPLETE: 100
} as const

// File size limits
export const FILE_SIZE_LIMITS = {
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  MIN_FILE_SIZE_CHARS: 1
} as const

// Critical files that must be generated for FastAPI projects
export const CRITICAL_FASTAPI_FILES = [
  'requirements.txt',
  '.env.example',
  'app/__init__.py',
  'app/core/config.py',
  'app/core/security.py',
  'app/core/database.py',
  'main.py'
] as const

// Essential Python dependencies that should be in requirements.txt
export const ESSENTIAL_PYTHON_DEPENDENCIES = ['fastapi', 'uvicorn', 'pydantic', 'sqlalchemy'] as const

// Error severity levels
export enum ErrorSeverity {
  CRITICAL = 'critical',
  WARNING = 'warning',
  INFO = 'info'
}

// Validation error patterns that should be treated as warnings
export const WARNING_ERROR_PATTERNS = [
  'missing',
  'Missing',
  'relationship',
  'Relationship',
  'not found',
  'undefined',
  'import',
  'Import'
] as const

// Warning prefixes for categorization
export const WARNING_PREFIXES = {
  SCHEMA: 'Schema',
  CROSS_FILE: 'Cross-file',
  EMPTY_FILES: 'Empty files',
  SYNTAX_ERRORS: 'Syntax errors'
} as const

// Validation thresholds
export const VALIDATION_THRESHOLDS = {
  MAX_INDENT_INCREASE: 4,
  MIN_FILES_FOR_PARALLELISM: 3,
  MAX_WORKERS: 5
} as const
