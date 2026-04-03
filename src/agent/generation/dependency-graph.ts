import { logger } from '../../logger'

import type { LLMFileSpec } from './file-planner'

// ─── Topological sort ─────────────────────────────────────────────────────────

/**
 * Sorts LLM file specs topologically so that dependencies are generated before
 * the files that use them.
 *
 * Uses Kahn's BFS algorithm. Cycles are handled gracefully: any files still
 * unsorted after BFS are appended with a warning.
 *
 * Expected ordering for a typical project:
 *   1. Service files (no LLM deps)
 *   2. Entity route files (depend on service files)
 *   3. Auth route (depends on user service)
 *   4. Test files (depend on route files)
 */
export function topologicalSort(llmFiles: LLMFileSpec[]): LLMFileSpec[] {
  if (llmFiles.length === 0) return []

  const pathToSpec = new Map(llmFiles.map(f => [f.outputPath, f]))

  // in-degree: number of unresolved LLM dependencies
  const inDegree = new Map<string, number>()
  // dependents[A] = files that depend on A (A must come first)
  const dependents = new Map<string, string[]>()

  for (const file of llmFiles) {
    inDegree.set(file.outputPath, 0)
    dependents.set(file.outputPath, [])
  }

  for (const file of llmFiles) {
    for (const dep of file.dependencies) {
      if (pathToSpec.has(dep)) {
        // dep is an LLM file — increment dependent's in-degree
        inDegree.set(file.outputPath, (inDegree.get(file.outputPath) ?? 0) + 1)
        dependents.get(dep)?.push(file.outputPath)
      }
      // If dep is a template file it's already generated — skip
    }
  }

  // Seed queue with nodes that have no LLM dependencies
  const queue: string[] = []
  for (const [path, deg] of inDegree) {
    if (deg === 0) queue.push(path)
  }

  const sorted: LLMFileSpec[] = []
  const visited = new Set<string>()

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)

    const spec = pathToSpec.get(current)
    if (spec) sorted.push(spec)

    for (const dependent of (dependents.get(current) ?? [])) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1
      inDegree.set(dependent, newDeg)
      if (newDeg === 0) queue.push(dependent)
    }
  }

  // Cycle detection: append any remaining files with a warning
  if (sorted.length < llmFiles.length) {
    const remaining = llmFiles.filter(f => !visited.has(f.outputPath))
    logger.warn(
      'topologicalSort: cycle detected — appending %d file(s) in arbitrary order: %s',
      remaining.length,
      remaining.map(f => f.outputPath).join(', ')
    )
    sorted.push(...remaining)
  }

  return sorted
}
