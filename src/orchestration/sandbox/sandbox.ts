import { createModuleLogger } from '../../logging'
import { extractCodeBlocks } from './code-extractor'
import type { ISandboxProvider } from './providers/provider.interface'
import type { SandboxFile, SandboxOptions, SandboxResult } from './types'

const log = createModuleLogger('sandbox')

type EmitFn = (event: string, projectId: string, payload: unknown) => void

const DEFAULT_OPTS: SandboxOptions = {
  timeoutMs: 30000,
  image: 'python:3.11-slim',
  language: 'python',
  runTests: false
}

/**
 * Run LLM-generated code through a sandbox provider.
 *
 * 1. Extracts code blocks from the markdown LLM output
 * 2. If no code blocks found, returns a no-op success result
 * 3. Emits socket events throughout execution
 * 4. Returns the SandboxResult (success/failure + compilation/test output)
 */
export async function runSandbox(
  llmOutput: string,
  provider: ISandboxProvider,
  emit: EmitFn,
  projectId: string,
  opts?: Partial<SandboxOptions>
): Promise<{ files: SandboxFile[]; result: SandboxResult }> {
  const mergedOpts: SandboxOptions = { ...DEFAULT_OPTS, ...opts }

  const files = extractCodeBlocks(llmOutput)

  if (files.length === 0) {
    log.debug('No code blocks found in LLM output, skipping sandbox', { projectId })
    const emptyResult: SandboxResult = {
      success: true,
      files: [],
      syntaxValid: true,
      compilationOutput: null,
      testOutput: null,
      stdout: '',
      stderr: '',
      durationMs: 0
    }
    return { files: [], result: emptyResult }
  }

  log.info('Starting sandbox execution', { projectId, fileCount: files.length, provider: provider.name })
  emit('sandbox:started', projectId, { fileCount: files.length, provider: provider.name })

  try {
    emit('sandbox:executing', projectId, {
      stage: 'setup',
      files: files.map(f => f.path)
    })

    const result = await provider.execute(files, mergedOpts)

    log.info('Sandbox execution complete', {
      projectId,
      success: result.success,
      durationMs: result.durationMs
    })

    return { files, result }
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err))
    log.error('Sandbox provider threw an exception', { projectId, error: error.message })

    const errorResult: SandboxResult = {
      success: false,
      files,
      syntaxValid: false,
      compilationOutput: null,
      testOutput: null,
      stdout: '',
      stderr: error.message,
      durationMs: 0,
      error: error.message
    }
    emit('sandbox:error', projectId, { error: error.message })
    return { files, result: errorResult }
  }
}

/**
 * Build a prompt asking the LLM to fix code that failed sandbox validation.
 */
export function buildFixPrompt(originalCode: string, sandboxResult: SandboxResult): string {
  const errorDetails = [
    sandboxResult.compilationOutput && `Compilation output:\n${sandboxResult.compilationOutput}`,
    sandboxResult.stderr && `Stderr:\n${sandboxResult.stderr}`,
    sandboxResult.error && `Error: ${sandboxResult.error}`
  ]
    .filter(Boolean)
    .join('\n\n')

  const allErrorText = [errorDetails, sandboxResult.stdout].filter(Boolean).join('\n')
  const isDependencyError =
    allErrorText.includes('No matching distribution') ||
    allErrorText.includes('Could not find a version') ||
    allErrorText.includes('Dependency installation failed') ||
    allErrorText.includes('pip install') ||
    allErrorText.includes('No module named')

  const dependencyHint = isDependencyError
    ? `\n\nIMPORTANT: The failure is in dependency installation. Fix requirements.txt by:
- Removing exact version pins (==) for packages where the version does not exist
- Using >= constraints instead (e.g. "fastapi>=0.100.0") or omitting the version entirely (e.g. just "fastapi")
- Removing any packages that do not exist on PyPI
- Only using well-known packages with versions you are certain exist\n`
    : ''

  return [
    'The code you generated failed validation. Please fix it.',
    '',
    'Error details:',
    errorDetails || 'Unknown error',
    dependencyHint,
    'Original code:',
    originalCode,
    '',
    'Please provide the complete fixed version of the code.'
  ].join('\n')
}
