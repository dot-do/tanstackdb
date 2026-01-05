/**
 * @file Auth State Machine Tests (RED Phase - TDD)
 *
 * These tests verify the AuthStateMachine class that manages authentication
 * state transitions for the mongo.do API. The state machine handles:
 * - State management: unauthenticated, authenticating, authenticated, refreshing, failed
 * - Transition validation: authenticate, success, failure, refresh, expire
 * - Event emission on state changes
 * - Timeout handling for stuck states
 * - Reset functionality
 *
 * RED PHASE: These tests will fail until AuthStateMachine is implemented in src/auth/state-machine.ts
 *
 * State Flow:
 * - unauthenticated -> [authenticate] -> authenticating
 * - authenticating -> [success] -> authenticated
 * - authenticating -> [failure] -> failed
 * - authenticated -> [refresh] -> refreshing
 * - authenticated -> [expire] -> unauthenticated
 * - refreshing -> [success] -> authenticated
 * - refreshing -> [failure] -> failed
 * - failed -> [authenticate] -> authenticating
 * - * -> [reset] -> unauthenticated
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AuthStateMachine } from '../../src/auth/state-machine'

describe('AuthStateMachine', () => {
  let stateMachine: AuthStateMachine

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    stateMachine = new AuthStateMachine()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('Initial State', () => {
    it('should start in unauthenticated state', () => {
      expect(stateMachine.getState()).toBe('unauthenticated')
    })

    it('should return unauthenticated state before any transitions', () => {
      const state = stateMachine.getState()
      expect(state).toBe('unauthenticated')
      expect(typeof state).toBe('string')
    })
  })

  describe('State Transitions', () => {
    describe('from unauthenticated', () => {
      it('should transition to authenticating on authenticate event', () => {
        stateMachine.transition('authenticate')
        expect(stateMachine.getState()).toBe('authenticating')
      })

      it('should reject invalid transitions from unauthenticated', () => {
        expect(() => stateMachine.transition('success')).toThrow()
        expect(() => stateMachine.transition('failure')).toThrow()
        expect(() => stateMachine.transition('refresh')).toThrow()
        expect(stateMachine.getState()).toBe('unauthenticated')
      })
    })

    describe('from authenticating', () => {
      beforeEach(() => {
        stateMachine.transition('authenticate')
      })

      it('should transition to authenticated on success event', () => {
        stateMachine.transition('success')
        expect(stateMachine.getState()).toBe('authenticated')
      })

      it('should transition to failed on failure event', () => {
        stateMachine.transition('failure')
        expect(stateMachine.getState()).toBe('failed')
      })

      it('should reject invalid transitions from authenticating', () => {
        expect(() => stateMachine.transition('authenticate')).toThrow()
        expect(() => stateMachine.transition('refresh')).toThrow()
        expect(() => stateMachine.transition('expire')).toThrow()
        expect(stateMachine.getState()).toBe('authenticating')
      })
    })

    describe('from authenticated', () => {
      beforeEach(() => {
        stateMachine.transition('authenticate')
        stateMachine.transition('success')
      })

      it('should transition to refreshing on refresh event', () => {
        stateMachine.transition('refresh')
        expect(stateMachine.getState()).toBe('refreshing')
      })

      it('should transition to unauthenticated on expire event', () => {
        stateMachine.transition('expire')
        expect(stateMachine.getState()).toBe('unauthenticated')
      })

      it('should reject invalid transitions from authenticated', () => {
        expect(() => stateMachine.transition('authenticate')).toThrow()
        expect(() => stateMachine.transition('success')).toThrow()
        expect(() => stateMachine.transition('failure')).toThrow()
        expect(stateMachine.getState()).toBe('authenticated')
      })
    })

    describe('from refreshing', () => {
      beforeEach(() => {
        stateMachine.transition('authenticate')
        stateMachine.transition('success')
        stateMachine.transition('refresh')
      })

      it('should transition to authenticated on success event', () => {
        stateMachine.transition('success')
        expect(stateMachine.getState()).toBe('authenticated')
      })

      it('should transition to failed on failure event', () => {
        stateMachine.transition('failure')
        expect(stateMachine.getState()).toBe('failed')
      })

      it('should reject invalid transitions from refreshing', () => {
        expect(() => stateMachine.transition('authenticate')).toThrow()
        expect(() => stateMachine.transition('refresh')).toThrow()
        expect(() => stateMachine.transition('expire')).toThrow()
        expect(stateMachine.getState()).toBe('refreshing')
      })
    })

    describe('from failed', () => {
      beforeEach(() => {
        stateMachine.transition('authenticate')
        stateMachine.transition('failure')
      })

      it('should transition to authenticating on authenticate event', () => {
        stateMachine.transition('authenticate')
        expect(stateMachine.getState()).toBe('authenticating')
      })

      it('should reject invalid transitions from failed', () => {
        expect(() => stateMachine.transition('success')).toThrow()
        expect(() => stateMachine.transition('failure')).toThrow()
        expect(() => stateMachine.transition('refresh')).toThrow()
        expect(() => stateMachine.transition('expire')).toThrow()
        expect(stateMachine.getState()).toBe('failed')
      })
    })
  })

  describe('Invalid Transitions', () => {
    it('should throw error with descriptive message for invalid transition', () => {
      expect(() => stateMachine.transition('success')).toThrow(
        /invalid transition.*success.*unauthenticated/i
      )
    })

    it('should throw error for unknown events', () => {
      // @ts-expect-error Testing invalid event
      expect(() => stateMachine.transition('unknown')).toThrow()
    })

    it('should not change state on invalid transition attempt', () => {
      const initialState = stateMachine.getState()
      try {
        stateMachine.transition('success')
      } catch {
        // Expected to throw
      }
      expect(stateMachine.getState()).toBe(initialState)
    })
  })

  describe('State Change Events', () => {
    it('should emit event when state changes', () => {
      const listener = vi.fn()
      stateMachine.on('stateChange', listener)

      stateMachine.transition('authenticate')

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'unauthenticated',
          to: 'authenticating',
          event: 'authenticate',
        })
      )
    })

    it('should emit events for multiple transitions', () => {
      const listener = vi.fn()
      stateMachine.on('stateChange', listener)

      stateMachine.transition('authenticate')
      stateMachine.transition('success')

      expect(listener).toHaveBeenCalledTimes(2)
      expect(listener).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          from: 'unauthenticated',
          to: 'authenticating',
          event: 'authenticate',
        })
      )
      expect(listener).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          from: 'authenticating',
          to: 'authenticated',
          event: 'success',
        })
      )
    })

    it('should support multiple event listeners', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      stateMachine.on('stateChange', listener1)
      stateMachine.on('stateChange', listener2)

      stateMachine.transition('authenticate')

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })

    it('should allow removing event listeners', () => {
      const listener = vi.fn()

      stateMachine.on('stateChange', listener)
      stateMachine.off('stateChange', listener)

      stateMachine.transition('authenticate')

      expect(listener).not.toHaveBeenCalled()
    })

    it('should not emit event if transition fails', () => {
      const listener = vi.fn()
      stateMachine.on('stateChange', listener)

      try {
        stateMachine.transition('success')
      } catch {
        // Expected to throw
      }

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('Timeout Handling', () => {
    it('should timeout authenticating state after configured duration', () => {
      const listener = vi.fn()
      stateMachine.on('stateChange', listener)

      stateMachine.transition('authenticate')

      // Fast-forward time by 30 seconds (default timeout)
      vi.advanceTimersByTime(30000)

      expect(stateMachine.getState()).toBe('failed')
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'authenticating',
          to: 'failed',
        })
      )
    })

    it('should timeout refreshing state after configured duration', () => {
      stateMachine.transition('authenticate')
      stateMachine.transition('success')
      stateMachine.transition('refresh')

      // Fast-forward time by 30 seconds (default timeout)
      vi.advanceTimersByTime(30000)

      expect(stateMachine.getState()).toBe('failed')
    })

    it('should not timeout if transition completes before timeout', () => {
      stateMachine.transition('authenticate')

      // Fast-forward time by 15 seconds (half of default timeout)
      vi.advanceTimersByTime(15000)

      // Complete the transition
      stateMachine.transition('success')

      // Fast-forward remaining time
      vi.advanceTimersByTime(15000)

      expect(stateMachine.getState()).toBe('authenticated')
    })

    it('should allow configuring custom timeout duration', () => {
      stateMachine = new AuthStateMachine({ timeout: 10000 })

      stateMachine.transition('authenticate')

      // Fast-forward by 9 seconds - should not timeout yet
      vi.advanceTimersByTime(9000)
      expect(stateMachine.getState()).toBe('authenticating')

      // Fast-forward by 2 more seconds - should timeout
      vi.advanceTimersByTime(2000)
      expect(stateMachine.getState()).toBe('failed')
    })

    it('should cancel timeout when leaving intermediate state', () => {
      stateMachine.transition('authenticate')

      // Complete transition before timeout
      stateMachine.transition('success')

      // Fast-forward time beyond timeout
      vi.advanceTimersByTime(60000)

      // Should remain authenticated, not timeout
      expect(stateMachine.getState()).toBe('authenticated')
    })

    it('should not set timeout for terminal states', () => {
      const listener = vi.fn()
      stateMachine.on('stateChange', listener)

      stateMachine.transition('authenticate')
      stateMachine.transition('success')

      listener.mockClear()

      // Fast-forward time - authenticated state should not timeout
      vi.advanceTimersByTime(60000)

      expect(stateMachine.getState()).toBe('authenticated')
      expect(listener).not.toHaveBeenCalled()
    })

    it('should emit timeout event when state times out', () => {
      const timeoutListener = vi.fn()
      stateMachine.on('timeout', timeoutListener)

      stateMachine.transition('authenticate')
      vi.advanceTimersByTime(30000)

      expect(timeoutListener).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'authenticating',
          timeoutMs: 30000,
        })
      )
    })
  })

  describe('Reset Functionality', () => {
    it('should reset to unauthenticated from any state', () => {
      stateMachine.transition('authenticate')
      stateMachine.transition('success')

      stateMachine.reset()

      expect(stateMachine.getState()).toBe('unauthenticated')
    })

    it('should reset from failed state', () => {
      stateMachine.transition('authenticate')
      stateMachine.transition('failure')

      stateMachine.reset()

      expect(stateMachine.getState()).toBe('unauthenticated')
    })

    it('should reset from refreshing state', () => {
      stateMachine.transition('authenticate')
      stateMachine.transition('success')
      stateMachine.transition('refresh')

      stateMachine.reset()

      expect(stateMachine.getState()).toBe('unauthenticated')
    })

    it('should emit state change event on reset', () => {
      const listener = vi.fn()

      stateMachine.transition('authenticate')
      stateMachine.transition('success')

      stateMachine.on('stateChange', listener)
      stateMachine.reset()

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'authenticated',
          to: 'unauthenticated',
          event: 'reset',
        })
      )
    })

    it('should cancel pending timeouts on reset', () => {
      stateMachine.transition('authenticate')

      stateMachine.reset()

      // Fast-forward time - should not timeout after reset
      vi.advanceTimersByTime(60000)

      expect(stateMachine.getState()).toBe('unauthenticated')
    })

    it('should allow transitions after reset', () => {
      stateMachine.transition('authenticate')
      stateMachine.transition('success')

      stateMachine.reset()

      // Should be able to start fresh authentication flow
      stateMachine.transition('authenticate')
      expect(stateMachine.getState()).toBe('authenticating')
    })

    it('should be idempotent when already unauthenticated', () => {
      const listener = vi.fn()
      stateMachine.on('stateChange', listener)

      stateMachine.reset()

      expect(stateMachine.getState()).toBe('unauthenticated')
      // Should not emit event if already unauthenticated
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('Complete Authentication Flows', () => {
    it('should handle successful authentication flow', () => {
      const states: string[] = []

      stateMachine.on('stateChange', ({ to }) => {
        states.push(to)
      })

      stateMachine.transition('authenticate')
      stateMachine.transition('success')

      expect(states).toEqual(['authenticating', 'authenticated'])
      expect(stateMachine.getState()).toBe('authenticated')
    })

    it('should handle failed authentication flow', () => {
      const states: string[] = []

      stateMachine.on('stateChange', ({ to }) => {
        states.push(to)
      })

      stateMachine.transition('authenticate')
      stateMachine.transition('failure')

      expect(states).toEqual(['authenticating', 'failed'])
      expect(stateMachine.getState()).toBe('failed')
    })

    it('should handle token refresh flow', () => {
      const states: string[] = []

      stateMachine.on('stateChange', ({ to }) => {
        states.push(to)
      })

      // Initial authentication
      stateMachine.transition('authenticate')
      stateMachine.transition('success')

      // Token refresh
      stateMachine.transition('refresh')
      stateMachine.transition('success')

      expect(states).toEqual([
        'authenticating',
        'authenticated',
        'refreshing',
        'authenticated',
      ])
      expect(stateMachine.getState()).toBe('authenticated')
    })

    it('should handle token expiration flow', () => {
      const states: string[] = []

      stateMachine.on('stateChange', ({ to }) => {
        states.push(to)
      })

      stateMachine.transition('authenticate')
      stateMachine.transition('success')
      stateMachine.transition('expire')

      expect(states).toEqual(['authenticating', 'authenticated', 'unauthenticated'])
      expect(stateMachine.getState()).toBe('unauthenticated')
    })

    it('should handle retry after failure', () => {
      const states: string[] = []

      stateMachine.on('stateChange', ({ to }) => {
        states.push(to)
      })

      // First attempt fails
      stateMachine.transition('authenticate')
      stateMachine.transition('failure')

      // Retry
      stateMachine.transition('authenticate')
      stateMachine.transition('success')

      expect(states).toEqual([
        'authenticating',
        'failed',
        'authenticating',
        'authenticated',
      ])
      expect(stateMachine.getState()).toBe('authenticated')
    })

    it('should handle failed refresh flow', () => {
      const states: string[] = []

      stateMachine.on('stateChange', ({ to }) => {
        states.push(to)
      })

      stateMachine.transition('authenticate')
      stateMachine.transition('success')
      stateMachine.transition('refresh')
      stateMachine.transition('failure')

      expect(states).toEqual([
        'authenticating',
        'authenticated',
        'refreshing',
        'failed',
      ])
      expect(stateMachine.getState()).toBe('failed')
    })
  })

  describe('Edge Cases', () => {
    it('should handle rapid successive valid transitions', () => {
      stateMachine.transition('authenticate')
      stateMachine.transition('success')
      stateMachine.transition('refresh')
      stateMachine.transition('success')
      stateMachine.transition('expire')

      expect(stateMachine.getState()).toBe('unauthenticated')
    })

    it('should maintain consistent state after error', () => {
      const initialState = stateMachine.getState()

      try {
        stateMachine.transition('success')
      } catch {
        // Expected
      }

      expect(stateMachine.getState()).toBe(initialState)

      // Should still allow valid transitions
      stateMachine.transition('authenticate')
      expect(stateMachine.getState()).toBe('authenticating')
    })

    it('should handle multiple resets', () => {
      stateMachine.transition('authenticate')
      stateMachine.reset()
      stateMachine.transition('authenticate')
      stateMachine.reset()

      expect(stateMachine.getState()).toBe('unauthenticated')
    })

    it('should cleanup all listeners on destroy', () => {
      const listener = vi.fn()
      stateMachine.on('stateChange', listener)

      stateMachine.destroy()

      stateMachine.transition('authenticate')

      expect(listener).not.toHaveBeenCalled()
    })

    it('should clear all timeouts on destroy', () => {
      stateMachine.transition('authenticate')

      stateMachine.destroy()

      vi.advanceTimersByTime(60000)

      // Should not timeout after destroy
      expect(stateMachine.getState()).toBe('authenticating')
    })
  })
})
