import { describe, expect, it } from 'vitest'
import { assertValidTransition } from '../projects.state-machine'

describe('Projects State Machine', () => {
  describe('assertValidTransition', () => {
    it('should allow valid transitions', () => {
      // Valid transitions should not throw
      expect(() => assertValidTransition('initializing', 'generating')).not.toThrow()
      expect(() => assertValidTransition('generating', 'validating')).not.toThrow()
      expect(() => assertValidTransition('validating', 'ready')).not.toThrow()
      expect(() => assertValidTransition('ready', 'generating')).not.toThrow()
      expect(() => assertValidTransition('error', 'generating')).not.toThrow()
    })

    it('should throw on invalid transitions', () => {
      // Invalid transitions should throw
      expect(() => assertValidTransition('initializing', 'ready')).toThrow(
        'Invalid status transition: initializing → ready'
      )
      expect(() => assertValidTransition('ready', 'error')).toThrow(
        'Invalid status transition: ready → error'
      )
      expect(() => assertValidTransition('generating', 'ready')).toThrow(
        'Invalid status transition: generating → ready'
      )
      expect(() => assertValidTransition('validating', 'error')).toThrow(
        'Invalid status transition: validating → error'
      )
      expect(() => assertValidTransition('ready', 'initializing')).toThrow(
        'Invalid status transition: ready → initializing'
      )
    })
  })
})
