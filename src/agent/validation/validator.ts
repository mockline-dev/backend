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

  const fixPrompt = `The following file has these errors:\n${errorSummary}\n\nOriginal content:\n${file.content}\n\nFix the errors and return the complete corrected file. Output ONLY the file content — no markdown, no fences, no explanation.`

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
