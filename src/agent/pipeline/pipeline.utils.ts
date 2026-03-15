/**
 * Utility functions for the Generation Pipeline
 * Extracts common logic to reduce duplication and improve maintainability
 */

import { logger } from '../../logger'
import { WARNING_ERROR_PATTERNS, WARNING_PREFIXES } from './pipeline.constants'
import type { FileValidationIssue, ValidationError, ValidationResult } from './pipeline.types'

/**
 * Filters validation errors into critical and non-critical based on error patterns
 * Non-critical errors (warnings) are those matching WARNING_ERROR_PATTERNS
 */
export function filterValidationErrors(errors: ValidationError[]): {
  critical: ValidationError[]
  warnings: ValidationError[]
} {
  const critical: ValidationError[] = []
  const warnings: ValidationError[] = []

  for (const error of errors) {
    const isWarning = WARNING_ERROR_PATTERNS.some(pattern => error.message.includes(pattern))

    if (isWarning) {
      warnings.push(error)
    } else {
      critical.push(error)
    }
  }

  return { critical, warnings }
}

/**
 * Logs validation warnings and returns formatted warning messages
 */
export function logValidationWarnings(
  warnings: ValidationError[],
  prefix: string = WARNING_PREFIXES.SCHEMA
): string[] {
  if (warnings.length === 0) {
    return []
  }

  const warningMessages = warnings.map(w => `${prefix}: ${w.field} - ${w.message}`)
  const formattedMessages = warnings.map(w => `- ${w.field}: ${w.message}`).join('\n')

  logger.warn('Pipeline: Validation warnings:\n%s', formattedMessages)

  return warningMessages
}

/**
 * Logs validation errors and throws an exception if critical errors exist
 */
export function handleValidationErrors(validationResult: ValidationResult, context: string): void {
  const { critical, warnings } = filterValidationErrors(validationResult.errors)

  // Log warnings first
  if (warnings.length > 0) {
    const warningMessages = warnings.map(e => `- ${e.field}: ${e.message}`).join('\n')
    logger.warn('Pipeline: %s validation errors treated as warnings:\n%s', context, warningMessages)
  }

  // Throw on critical errors
  if (critical.length > 0) {
    const errorMessages = critical.map(e => `- ${e.field}: ${e.message}`).join('\n')
    logger.error('Pipeline: %s validation failed with critical errors:\n%s', context, errorMessages)
    throw new Error(`${context} validation failed:\n${errorMessages}`)
  }
}

/**
 * Formats file validation issues into a readable string
 */
export function formatFileValidationIssues(issues: FileValidationIssue[]): string {
  return issues
    .map(issue => {
      const location = issue.line ? `${issue.path}:${issue.line}` : issue.path
      return `${location}: ${issue.message}`
    })
    .join('; ')
}

/**
 * Validates file content before persistence
 */
export function validateFileContent(file: { path: string; content: string }): {
  isValid: boolean
  reason?: string
} {
  if (!file.content || file.content.trim().length === 0) {
    return { isValid: false, reason: 'empty file' }
  }

  const maxSize = 10 * 1024 * 1024 // 10MB
  if (file.content.length > maxSize) {
    return { isValid: false, reason: `file too large (${file.content.length} bytes)` }
  }

  return { isValid: true }
}

/**
 * Checks if a file path matches a critical file pattern
 */
export function isCriticalFile(filePath: string, criticalFiles: readonly string[]): boolean {
  return criticalFiles.includes(filePath)
}

/**
 * Extracts file extension from a file path
 */
export function getFileExtension(filePath: string): string {
  const parts = filePath.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
}

/**
 * Checks if a file is a Python file
 */
export function isPythonFile(filePath: string): boolean {
  return getFileExtension(filePath) === 'py'
}

/**
 * Checks if a file is a requirements file
 */
export function isRequirementsFile(filePath: string): boolean {
  return filePath.toLowerCase() === 'requirements.txt'
}
