// ─── Pipeline phase timer ─────────────────────────────────────────────────────

export class PipelineTimer {
  private readonly starts = new Map<string, number>()
  private readonly durations = new Map<string, number>()

  /** Record the start of a phase. */
  start(phase: string): void {
    this.starts.set(phase, Date.now())
  }

  /**
   * Record the end of a phase.
   * @returns Duration in milliseconds, or -1 if start was never called.
   */
  end(phase: string): number {
    const startedAt = this.starts.get(phase)
    if (startedAt === undefined) return -1
    const ms = Date.now() - startedAt
    this.durations.set(phase, ms)
    this.starts.delete(phase)
    return ms
  }

  /** Return a record of all completed phase durations in milliseconds. */
  summary(): Record<string, number> {
    return Object.fromEntries(this.durations)
  }

  /** Total elapsed ms across all completed phases. */
  total(): number {
    let sum = 0
    for (const ms of this.durations.values()) sum += ms
    return sum
  }
}
