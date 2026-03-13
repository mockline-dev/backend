import { Application } from '../../declarations'
import { getProvider } from '../../llm/providers/registry'
import { logger } from '../../logger'
import type { GeneratedFile } from '../pipeline/file-generator'
import { validatePython } from './python-validator'
import { validateTypeScript } from './ts-validator'

export interface FileValidationResult {
  path: string
  valid: boolean
  errors: Array<{ line?: number; code?: string; message: string }>
}

export interface ValidationSummary {
  passCount: number
  failCount: number
  results: FileValidationResult[]
}

/**
 * Validates all generated files and attempts to regenerate any that fail.
 * Returns a summary of pass/fail counts.
 */
export async function validateGeneratedFiles(
  files: GeneratedFile[],
  projectId: string,
  _app: Application,
  onProgress: (stage: string, pct: number) => Promise<void>
): Promise<ValidationSummary> {
  const results: FileValidationResult[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const ext = file.path.split('.').pop()?.toLowerCase() ?? ''
    await onProgress(`Validating ${file.path}`, 90 + Math.round((i / files.length) * 5))

    let result: FileValidationResult

    if (ext === 'py') {
      const r = await validatePython(file.path, file.content)
      result = r
    } else if (ext === 'ts' || ext === 'tsx') {
      const r = await validateTypeScript(file.path, file.content)
      result = r
    } else {
      result = { path: file.path, valid: true, errors: [] }
    }

    if (!result.valid && result.errors.length > 0) {
      logger.warn('Validator: %s has %d errors — attempting regeneration', file.path, result.errors.length)
      const fixed = await tryRegenerate(file, result, files)
      if (fixed) {
        file.content = fixed
        result = { path: file.path, valid: true, errors: [] }
        logger.info('Validator: regeneration succeeded for %s', file.path)
      }
    }

    results.push(result)
  }

  const failCount = results.filter(r => !r.valid).length
  return { passCount: results.length - failCount, failCount, results }
}

async function tryRegenerate(
  file: GeneratedFile,
  validation: FileValidationResult,
  allFiles: GeneratedFile[]
): Promise<string | null> {
  const errorSummary = validation.errors
    .slice(0, 10)
    .map(e => `  Line ${e.line ?? '?'}: ${e.message}`)
    .join('\n')

  const contextFiles = allFiles.filter(f => f.path !== file.path).slice(-3)

  const fixPrompt = `You are an expert code debugger and fixer. The following file has validation errors that need to be fixed.

=== ERROR CONTEXT ===
The following file has these errors:
${errorSummary}

=== ORIGINAL FILE CONTENT ===
${file.content}

=== INSTRUCTIONS FOR FIXING ERRORS ===

1. UNDERSTAND THE ERROR CONTEXT:
   - Analyze each error carefully to understand what went wrong.
   - Look for patterns in the errors (e.g., missing imports, syntax errors, type mismatches).
   - Understand the relationship between errors (some errors may be caused by others).
   - Consider the file type (Python, TypeScript) and apply language-specific fixes.

2. FIX ERRORS EFFICIENTLY:
   - Prioritize errors that block compilation or execution (syntax errors, missing imports).
   - Fix errors in order of dependency (fix import errors before type errors).
   - Make minimal changes to fix each error - don't rewrite the entire file.
   - If multiple errors are related, fix them together with a single change.
   - Ensure that fixing one error doesn't introduce new errors.

3. MAINTAIN CODE QUALITY:
   - Preserve the original code structure and formatting.
   - Keep the original coding style and conventions.
   - Don't refactor or optimize code unless necessary to fix errors.
   - Add missing imports at the top of the file, properly organized.
   - Add type annotations where required but missing.
   - Ensure all functions and classes are properly defined.

4. PREVENT REGRESSION:
   - Test your fixes mentally - will this break anything else?
   - Ensure that all existing functionality is preserved.
   - Don't remove or modify code that's not related to the errors.
   - Keep the original logic intact - only fix the errors.
   - If you need to change logic, do it minimally and carefully.

5. SPECIFIC ERROR FIXING GUIDELINES:

   For Python files:
   - Missing imports: Add the required import at the top of the file.
   - Undefined variables: Check for typos or missing variable definitions.
   - Syntax errors: Fix the syntax (colons, indentation, brackets).
   - Type errors: Add proper type hints or convert types as needed.
   - Indentation errors: Fix indentation to use 4 spaces consistently.
   - Missing methods: Implement the missing method or import from a base class.

   For TypeScript/JavaScript files:
   - Missing imports: Add the required import statement.
   - Type errors: Add proper type annotations or use 'any' if appropriate.
   - Undefined properties: Check for typos or missing property definitions.
   - Syntax errors: Fix the syntax (semicolons, brackets, parentheses).
   - Module resolution errors: Fix import paths or add proper exports.

   Common error patterns:
   - NameError/ReferenceError: Check for typos, missing imports, or undefined variables.
   - TypeError: Check for type mismatches, wrong function signatures, or incorrect operations.
   - SyntaxError: Check for missing colons, brackets, or incorrect syntax.
   - ImportError/ModuleNotFoundError: Check import paths and module names.
   - AttributeError: Check for typos in attribute names or missing attributes.

6. ERROR-SPECIFIC FIXING STRATEGIES:

   If you see "NameError: name 'X' is not defined":
   - Check if 'X' should be imported from a module.
   - Check if 'X' is a typo for an existing variable.
   - Check if 'X' should be defined as a local variable or parameter.

   If you see "ImportError: cannot import name 'X'":
   - Check if the module name is correct.
   - Check if the import path is correct.
   - Check if the module is installed (add to requirements.txt if needed).

   If you see "TypeError: X() takes Y positional argument but Z were given":
   - Check the function signature and fix the call.
   - Add or remove parameters as needed.
   - Check for self/this in method definitions.

   If you see "SyntaxError: invalid syntax":
   - Check for missing colons after if/for/while/def/class.
   - Check for missing parentheses, brackets, or quotes.
   - Check for incorrect indentation.
   - Check for invalid characters or keywords.

   If you see "IndentationError: unexpected indent":
   - Fix indentation to use consistent spacing (4 spaces for Python).
   - Remove extra indentation where not needed.
   - Add missing indentation where required.

7. FINAL CHECKLIST:
   - Have all reported errors been addressed?
   - Are all imports present and correct?
   - Is the syntax correct for the language?
   - Are all variables and functions properly defined?
   - Is the code structure preserved?
   - Will the code compile/run without errors?
   - Have you maintained the original code style?

=== OUTPUT REQUIREMENTS ===

Fix the errors and return the complete corrected file.
- Output ONLY the file content - no markdown, no code fences, no explanation.
- Return the entire file, not just the fixed portions.
- Ensure the fixed file is syntactically correct and will pass validation.
- Preserve all original code that doesn't need to be changed.
- Make only the minimal changes necessary to fix the errors.`

  try {
    const provider = getProvider()
    let response = ''
    for await (const chunk of provider.chatStream([{ role: 'user', content: fixPrompt }], undefined, {
      temperature: 0.05
    })) {
      response += chunk.message.content
    }

    const clean = response
      .replace(/^```[\w]*\n/, '')
      .replace(/\n```$/, '')
      .trim()
    return clean || null
  } catch (err: any) {
    logger.warn('Validator: regeneration failed for %s: %s', file.path, err.message)
    return null
  }
}
