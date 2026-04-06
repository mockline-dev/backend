import type { SandboxFile, SandboxResult, SandboxOptions } from '../types'

export interface ISandboxProvider {
  readonly name: string
  execute(files: SandboxFile[], opts: SandboxOptions): Promise<SandboxResult>
}
