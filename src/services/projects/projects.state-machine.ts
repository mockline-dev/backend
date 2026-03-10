type ProjectStatus = 'initializing' | 'generating' | 'validating' | 'ready' | 'error'

const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  initializing: ['generating', 'error'],
  generating: ['validating', 'error'],
  validating: ['ready', 'error'],
  ready: ['generating'],
  error: ['generating']
}

export function assertValidTransition(from: ProjectStatus, to: ProjectStatus): void {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid status transition: ${from} → ${to}`)
  }
}
