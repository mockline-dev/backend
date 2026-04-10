export interface SandboxFile {
  path: string
  content: string
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
  timeoutMs: number
  image: string
  language: string
  runTests: boolean
  /** Only used for GenerateProject — starts the server and checks it responds */
  checkServerStart?: boolean
}
