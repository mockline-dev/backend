import type { ISandboxProvider } from './provider.interface'
import type { SandboxFile, SandboxOptions, SandboxResult } from '../types'

/**
 * Local child_process sandbox provider.
 * Stub — not used in production. Kept as a fallback for local dev without OpenSandbox.
 */
export class LocalSandboxProvider implements ISandboxProvider {
  readonly name = 'local'

  async execute(_files: SandboxFile[], _opts: SandboxOptions): Promise<SandboxResult> {
    throw new Error(
      'LocalSandboxProvider is not implemented. ' +
        'Set sandbox.provider to "opensandbox" in config/default.json.'
    )
  }
}
