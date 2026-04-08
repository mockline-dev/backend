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
 * Categorizes the error type and provides type-specific fix instructions.
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

  // Categorize error type for targeted fix instructions
  const isDependencyError =
    allErrorText.includes('No matching distribution') ||
    allErrorText.includes('Could not find a version') ||
    allErrorText.includes('Dependency installation failed') ||
    allErrorText.includes('pip install') ||
    allErrorText.includes('No module named') ||
    allErrorText.includes('Missing modules')

  const isSyntaxError =
    allErrorText.includes('SyntaxError') ||
    allErrorText.includes('IndentationError') ||
    allErrorText.includes('error TS') ||
    allErrorText.includes('SyntaxError:')

  const isImportError =
    allErrorText.includes('ImportError') ||
    allErrorText.includes('ModuleNotFoundError') ||
    allErrorText.includes('Cannot find module') ||
    allErrorText.includes('Missing modules')

  const isRuntimeError =
    !isDependencyError && !isSyntaxError && !isImportError && allErrorText.length > 0

  let typeSpecificHint = ''
  if (isDependencyError) {
    typeSpecificHint = `\n\nERROR TYPE: Dependency installation failure
Fix instructions:
- Check requirements.txt: remove exact version pins (==) where the version doesn't exist on PyPI
- Use bare package names (e.g. "fastapi", not "fastapi==0.99.0") or well-known version ranges
- Fix import name → PyPI name mappings: jwt→PyJWT, dotenv→python-dotenv, yaml→PyYAML, bs4→beautifulsoup4
- Remove any invented packages that don't exist on PyPI\n`
  } else if (isSyntaxError) {
    typeSpecificHint = `\n\nERROR TYPE: Syntax error
Fix instructions:
- Correct the syntax in the file(s) mentioned in the error output
- Check for missing colons, mismatched parentheses, or incorrect indentation\n`
  } else if (isImportError) {
    typeSpecificHint = `\n\nERROR TYPE: Missing import/module
Fix instructions:
- Add every imported package to requirements.txt/package.json
- Check import name → package name mappings (e.g. import jwt → PyJWT in requirements.txt)
- Remove imports for packages you are not certain exist\n`
  } else if (isRuntimeError) {
    typeSpecificHint = `\n\nERROR TYPE: Runtime error
Fix instructions:
- Fix the runtime error shown in the output
- Server MUST bind to 0.0.0.0:8000 (not 127.0.0.1); read port from os.environ.get("PORT", 8000)\n`
  }

  return [
    'The code you generated failed validation. Please fix it.',
    '',
    'Error details:',
    errorDetails || 'Unknown error',
    typeSpecificHint,
    'CONSTRAINTS: Server must bind to 0.0.0.0:8000. Do not change the overall project structure.',
    '',
    'Original code:',
    originalCode,
    '',
    'Please provide the complete fixed version of the code.'
  ].join('\n')
}
