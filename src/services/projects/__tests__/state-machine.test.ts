import { describe, expect, it } from 'vitest'
import { assertValidTransition } from '../projects.state-machine'

describe('Projects State Machine', () => {
  describe('assertValidTransition', () => {
    it('should allow valid transitions', () => {
      // Generation pipeline
      expect(() => assertValidTransition('initializing', 'generating')).not.toThrow()
      expect(() => assertValidTransition('generating', 'validating')).not.toThrow()
      expect(() => assertValidTransition('validating', 'ready')).not.toThrow()
      // Error recovery
      expect(() => assertValidTransition('initializing', 'error')).not.toThrow()
      expect(() => assertValidTransition('generating', 'error')).not.toThrow()
      expect(() => assertValidTransition('validating', 'error')).not.toThrow()
      expect(() => assertValidTransition('error', 'generating')).not.toThrow()
      // Agentic edit flow (Phase D)
      expect(() => assertValidTransition('ready', 'editing')).not.toThrow()
      expect(() => assertValidTransition('editing', 'ready')).not.toThrow()
      expect(() => assertValidTransition('editing', 'error')).not.toThrow()
      expect(() => assertValidTransition('error', 'editing')).not.toThrow()
      // Re-generation from ready
      expect(() => assertValidTransition('ready', 'generating')).not.toThrow()
    })

    it('should throw on invalid transitions', () => {
      expect(() => assertValidTransition('initializing', 'ready')).toThrow(
        'Invalid status transition: initializing → ready'
      )
      expect(() => assertValidTransition('ready', 'error')).toThrow(
        'Invalid status transition: ready → error'
      )
      expect(() => assertValidTransition('generating', 'ready')).toThrow(
        'Invalid status transition: generating → ready'
      )
      expect(() => assertValidTransition('ready', 'initializing')).toThrow(
        'Invalid status transition: ready → initializing'
      )
      expect(() => assertValidTransition('editing', 'generating')).toThrow(
        'Invalid status transition: editing → generating'
      )
    })
  })
})
