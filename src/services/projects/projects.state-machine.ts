type ProjectStatus =
  | 'created'
  | 'initializing'
  | 'planning'
  | 'scaffolding'
  | 'generating'
  | 'validating'
  | 'editing'
  | 'ready'
  | 'error'

const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  // New pipeline flow
  created:     ['planning', 'error'],
  planning:    ['scaffolding', 'error'],
  scaffolding: ['generating', 'error'],
  generating:  ['validating', 'error'],
  validating:  ['ready', 'error'],
  // Legacy status (kept for backward compatibility)
  initializing: ['generating', 'planning', 'error'],
  // Terminal / editing states
  editing: ['ready', 'error'],
  ready:   ['generating', 'planning', 'editing'],
  error:   ['generating', 'planning', 'editing']
}

export function assertValidTransition(from: ProjectStatus, to: ProjectStatus): void {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid status transition: ${from} → ${to}`)
  }
}
