/**
 * Critical Files Validator
 * Validates that all critical files are present and properly structured
 */

import { logger } from '../../logger'
import {
  CRITICAL_FASTAPI_FILES,
  ESSENTIAL_PYTHON_DEPENDENCIES,
  VALIDATION_THRESHOLDS
} from './pipeline.constants'
import type { FileValidationIssue, GeneratedFile } from './pipeline.types'
import { isPythonFile, isRequirementsFile } from './pipeline.utils'

/**
 * Validates critical files are present and properly structured
 */
export class CriticalFilesValidator {
  /**
   * Validates that all critical files are present and properly structured
   * @throws Error if critical files are missing
   */
  validate(generatedFiles: GeneratedFile[]): {
    warnings: string[]
  } {
    const warnings: string[] = []

    const generatedPaths = new Set(generatedFiles.map(f => f.path))

    // Check for missing critical files
    const missingFiles = this.checkMissingCriticalFiles(generatedPaths)
    if (missingFiles.length > 0) {
      logger.error('Pipeline: Missing critical files: %s', missingFiles.join(', '))
      throw new Error(`Missing critical files: ${missingFiles.join(', ')}`)
    }

    // Check for empty files
    const emptyFiles = this.checkEmptyFiles(generatedFiles)
    if (emptyFiles.length > 0) {
      logger.warn('Pipeline: Empty files detected: %s', emptyFiles.join(', '))
      warnings.push(`Empty files: ${emptyFiles.join(', ')}`)
    }

    // Validate Python syntax
    const syntaxErrors = this.validatePythonSyntax(generatedFiles)
    if (syntaxErrors.length > 0) {
      const formattedErrors = syntaxErrors.map(e => `${e.path}${e.line ? `:${e.line}` : ''}: ${e.message}`)
      logger.warn('Pipeline: Syntax errors detected: %s', formattedErrors.join('; '))
      warnings.push(`Syntax errors: ${formattedErrors.join('; ')}`)
    }

    // Validate requirements.txt has essential dependencies
    const dependencyIssues = this.validateRequirementsDependencies(generatedFiles)
    if (dependencyIssues.length > 0) {
      warnings.push(...dependencyIssues)
    }

    return { warnings }
  }

  /**
   * Checks which critical files are missing from the generated files
   */
  private checkMissingCriticalFiles(generatedPaths: Set<string>): string[] {
    const missing: string[] = []

    for (const criticalFile of CRITICAL_FASTAPI_FILES) {
      if (!generatedPaths.has(criticalFile)) {
        missing.push(criticalFile)
      }
    }

    return missing
  }

  /**
   * Identifies empty files in the generated files
   */
  private checkEmptyFiles(generatedFiles: GeneratedFile[]): string[] {
    return generatedFiles
      .filter(file => !file.content || file.content.trim().length === 0)
      .map(file => file.path)
  }

  /**
   * Validates Python syntax for all .py files
   */
  private validatePythonSyntax(generatedFiles: GeneratedFile[]): FileValidationIssue[] {
    const errors: FileValidationIssue[] = []

    for (const file of generatedFiles) {
      if (!isPythonFile(file.path)) {
        continue
      }

      const fileErrors = this.validateSinglePythonFile(file)
      errors.push(...fileErrors)
    }

    return errors
  }

  /**
   * Validates syntax for a single Python file
   */
  private validateSinglePythonFile(file: GeneratedFile): FileValidationIssue[] {
    const errors: FileValidationIssue[] = []

    try {
      const lines = file.content.split('\n')
      let indentLevel = 0
      let inMultilineString = false

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // Skip multiline strings
        if (this.hasMultilineStringMarker(line)) {
          inMultilineString = !inMultilineString
          continue
        }

        if (inMultilineString) continue

        const trimmed = line.trim()

        // Check for unmatched quotes
        const quoteErrors = this.checkUnmatchedQuotes(trimmed, file.path, i + 1)
        errors.push(...quoteErrors)

        // Check for basic indentation
        const indentErrors = this.checkIndentation(trimmed, line, i + 1, indentLevel)
        errors.push(...indentErrors)

        // Update indent level for next line
        if (trimmed && !trimmed.startsWith('#')) {
          const newIndent = line.search(/\S/)
          if (trimmed.startsWith('def ') || trimmed.startsWith('class ')) {
            indentLevel = newIndent
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to validate syntax for %s: %s', file.path, err)
    }

    return errors
  }

  /**
   * Checks if a line contains a multiline string marker
   */
  private hasMultilineStringMarker(line: string): boolean {
    return line.includes('"""') || line.includes("'''")
  }

  /**
   * Checks for unmatched quotes in a line
   */
  private checkUnmatchedQuotes(trimmed: string, filePath: string, lineNumber: number): FileValidationIssue[] {
    const errors: FileValidationIssue[] = []

    const singleQuotes = (trimmed.match(/'/g) || []).length
    const doubleQuotes = (trimmed.match(/"/g) || []).length

    if (singleQuotes % 2 !== 0) {
      errors.push({
        path: filePath,
        line: lineNumber,
        message: 'Unmatched single quotes',
        severity: 'warning'
      })
    }

    if (doubleQuotes % 2 !== 0) {
      errors.push({
        path: filePath,
        line: lineNumber,
        message: 'Unmatched double quotes',
        severity: 'warning'
      })
    }

    return errors
  }

  /**
   * Checks for proper indentation in a line
   */
  private checkIndentation(
    trimmed: string,
    line: string,
    lineNumber: number,
    currentIndentLevel: number
  ): FileValidationIssue[] {
    const errors: FileValidationIssue[] = []

    if (trimmed && !trimmed.startsWith('#')) {
      const newIndent = line.search(/\S/)

      if (newIndent > 0 && newIndent > currentIndentLevel + VALIDATION_THRESHOLDS.MAX_INDENT_INCREASE) {
        errors.push({
          path: '',
          line: lineNumber,
          message: 'Excessive indentation',
          severity: 'warning'
        })
      }
    }

    return errors
  }

  /**
   * Validates that requirements.txt contains essential dependencies
   */
  private validateRequirementsDependencies(generatedFiles: GeneratedFile[]): string[] {
    const issues: string[] = []

    const requirementsFile = generatedFiles.find(f => isRequirementsFile(f.path))
    if (!requirementsFile) {
      return issues
    }

    const missingDeps = ESSENTIAL_PYTHON_DEPENDENCIES.filter(
      dep => !requirementsFile.content.toLowerCase().includes(dep)
    )

    if (missingDeps.length > 0) {
      const message = `requirements.txt: Missing essential dependencies: ${missingDeps.join(', ')}`
      issues.push(message)
    }

    return issues
  }
}
