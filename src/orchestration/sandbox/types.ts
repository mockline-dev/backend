// ─── Sandbox Types ────────────────────────────────────────────────────────────

export interface SandboxFile {
  /** Relative path inside the sandbox workspace, e.g. "src/index.ts" */
  path: string
  content: string
  /** Language detected from the code fence, e.g. "typescript", "python" */
  language?: string
}

export interface SandboxResult {
  success: boolean
  files: SandboxFile[]
  syntaxValid: boolean
  compilationOutput: string | null
  testOutput: string | null
  stdout: string
  stderr: string
  durationMs: number
  error?: string
}

export interface SandboxOptions {
  /** Max execution time in ms (default: 30000) */
  timeoutMs: number
  /** Docker image to use for the sandbox container */
  image: string
  /** Primary programming language to determine build commands */
  language: string
  /** Whether to attempt running tests after compilation */
  runTests: boolean
  /** Whether to attempt starting the server and verifying it responds (GenerateProject only) */
  checkServerStart?: boolean
}
