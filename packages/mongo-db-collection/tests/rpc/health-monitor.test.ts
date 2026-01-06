/**
 * @file Connection Health Monitor Tests (RED Phase - TDD)
 *
 * These tests verify the Connection Health Monitor implementation for @tanstack/mongo-db-collection.
 * The ConnectionHealthMonitor class provides connection health tracking via heartbeats/pings,
 * automatic reconnection triggering when unhealthy, and health status reporting.
 *
 * Features being tested:
 * - Health monitoring with configurable heartbeat intervals
 * - Connection health state tracking (healthy, degraded, unhealthy)
 * - Automatic reconnection triggering based on health thresholds
 * - Latency tracking and reporting
 * - Health check callback integration
 * - Event emission for health state changes
 * - Graceful start/stop of monitoring
 * - Integration with transport layer for reconnection
 *
 * RED PHASE: These tests will fail until ConnectionHealthMonitor is implemented in src/rpc/health-monitor.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConnectionHealthMonitor } from '../../src/rpc/health-monitor'
import type {
  HealthMonitorOptions,
  HealthState,
  HealthStatus,
  HealthCheckResult,
  ReconnectCallback,
} from '../../src/rpc/health-monitor'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a mock ping function for testing
 */
function createMockPingFn(options: {
  latencyMs?: number
  shouldSucceed?: boolean
  successAfterAttempts?: number
} = {}): () => Promise<void> {
  const { latencyMs = 10, shouldSucceed = true, successAfterAttempts } = options
  let attempts = 0

  return vi.fn(async () => {
    attempts++
    await new Promise((resolve) => setTimeout(resolve, latencyMs))

    if (successAfterAttempts !== undefined && attempts <= successAfterAttempts) {
      throw new Error('Ping failed')
    }

    if (!shouldSucceed) {
      throw new Error('Ping failed')
    }
  })
}

/**
 * Creates a mock reconnect callback for testing
 */
function createMockReconnectCallback(): ReconnectCallback {
  return vi.fn(async () => {
    // Simulate reconnection delay
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

// =============================================================================
// Tests
// =============================================================================

describe('ConnectionHealthMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('Constructor', () => {
    it('should construct with default options', () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn })

      expect(monitor).toBeInstanceOf(ConnectionHealthMonitor)
    })

    it('should construct with custom options', () => {
      const pingFn = createMockPingFn()
      const options: HealthMonitorOptions = {
        pingFn,
        pingInterval: 5000,
        pingTimeout: 2000,
        unhealthyThreshold: 5,
        degradedThreshold: 2,
        healthyThreshold: 3,
        reconnectOnUnhealthy: true,
      }

      const monitor = new ConnectionHealthMonitor(options)

      expect(monitor.options.pingInterval).toBe(5000)
      expect(monitor.options.pingTimeout).toBe(2000)
      expect(monitor.options.unhealthyThreshold).toBe(5)
      expect(monitor.options.degradedThreshold).toBe(2)
      expect(monitor.options.healthyThreshold).toBe(3)
      expect(monitor.options.reconnectOnUnhealthy).toBe(true)
    })

    it('should use sensible default values', () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn })

      expect(monitor.options.pingInterval).toBeGreaterThan(0)
      expect(monitor.options.pingTimeout).toBeGreaterThan(0)
      expect(monitor.options.unhealthyThreshold).toBeGreaterThanOrEqual(1)
      expect(monitor.options.degradedThreshold).toBeGreaterThanOrEqual(1)
      expect(monitor.options.healthyThreshold).toBeGreaterThanOrEqual(1)
    })

    it('should initialize in healthy state', () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn })

      expect(monitor.state).toBe('healthy')
    })

    it('should not be running initially', () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn })

      expect(monitor.isRunning).toBe(false)
    })
  })

  describe('Start/Stop Monitoring', () => {
    it('should start monitoring', () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn })

      monitor.start()

      expect(monitor.isRunning).toBe(true)
    })

    it('should stop monitoring', () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn })

      monitor.start()
      monitor.stop()

      expect(monitor.isRunning).toBe(false)
    })

    it('should not throw when stopping already stopped monitor', () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn })

      expect(() => monitor.stop()).not.toThrow()
    })

    it('should not throw when starting already running monitor', () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn })

      monitor.start()
      expect(() => monitor.start()).not.toThrow()
    })

    it('should send ping immediately on start', async () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn, pingInterval: 5000 })

      monitor.start()

      // Allow immediate ping to execute
      await vi.advanceTimersByTimeAsync(0)

      expect(pingFn).toHaveBeenCalledTimes(1)
    })

    it('should send pings at configured interval', async () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn, pingInterval: 1000 })

      monitor.start()

      // Initial ping
      await vi.advanceTimersByTimeAsync(0)
      expect(pingFn).toHaveBeenCalledTimes(1)

      // After 1 second
      await vi.advanceTimersByTimeAsync(1000)
      expect(pingFn).toHaveBeenCalledTimes(2)

      // After 2 seconds
      await vi.advanceTimersByTimeAsync(1000)
      expect(pingFn).toHaveBeenCalledTimes(3)

      monitor.stop()
    })

    it('should stop sending pings after stop', async () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn, pingInterval: 1000 })

      monitor.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(pingFn).toHaveBeenCalledTimes(1)

      monitor.stop()

      // Advance time significantly
      await vi.advanceTimersByTimeAsync(5000)

      // Should not have sent more pings
      expect(pingFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('Health State Transitions', () => {
    it('should remain healthy when pings succeed', async () => {
      const pingFn = createMockPingFn({ shouldSucceed: true })
      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        pingTimeout: 500,
      })

      monitor.start()

      // Send several successful pings
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }

      expect(monitor.state).toBe('healthy')
      monitor.stop()
    })

    it('should transition to degraded state after consecutive failures', async () => {
      const pingFn = createMockPingFn({ shouldSucceed: false })
      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        pingTimeout: 500,
        degradedThreshold: 2,
        unhealthyThreshold: 5,
      })

      monitor.start()

      // Initial ping (fail 1)
      await vi.advanceTimersByTimeAsync(0)

      // Second fail triggers degraded
      await vi.advanceTimersByTimeAsync(1000)

      expect(monitor.state).toBe('degraded')
      monitor.stop()
    })

    it('should transition to unhealthy state after more failures', async () => {
      const pingFn = createMockPingFn({ shouldSucceed: false })
      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        pingTimeout: 500,
        degradedThreshold: 2,
        unhealthyThreshold: 4,
      })

      monitor.start()

      // Accumulate failures
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }

      expect(monitor.state).toBe('unhealthy')
      monitor.stop()
    })

    it('should recover to healthy state after successful pings', async () => {
      let shouldSucceed = false
      const pingFn = vi.fn(async () => {
        if (!shouldSucceed) {
          throw new Error('Ping failed')
        }
      })

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        pingTimeout: 500,
        degradedThreshold: 2,
        unhealthyThreshold: 4,
        healthyThreshold: 2,
      })

      monitor.start()

      // Fail enough to become degraded
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }
      expect(monitor.state).toBe('degraded')

      // Start succeeding
      shouldSucceed = true

      // Succeed enough to become healthy
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }

      expect(monitor.state).toBe('healthy')
      monitor.stop()
    })

    it('should reset failure count on successful ping', async () => {
      let failCount = 0
      const pingFn = vi.fn(async () => {
        failCount++
        if (failCount <= 1) {
          throw new Error('Ping failed')
        }
      })

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        pingTimeout: 500,
        degradedThreshold: 2,
      })

      monitor.start()

      // First ping fails
      await vi.advanceTimersByTimeAsync(0)

      // Second ping succeeds
      await vi.advanceTimersByTimeAsync(1000)

      // Third ping would be second failure but we reset counter
      // So we remain healthy
      expect(monitor.state).toBe('healthy')
      monitor.stop()
    })
  })

  describe('Events', () => {
    it('should emit healthChange event when state changes', async () => {
      const pingFn = createMockPingFn({ shouldSucceed: false })
      const healthChangeHandler = vi.fn()

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        degradedThreshold: 2,
      })

      monitor.on('healthChange', healthChangeHandler)
      monitor.start()

      // Trigger state change
      await vi.advanceTimersByTimeAsync(2000)

      expect(healthChangeHandler).toHaveBeenCalled()
      expect(healthChangeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'degraded' })
      )

      monitor.stop()
    })

    it('should emit ping event for each ping attempt', async () => {
      const pingFn = createMockPingFn()
      const pingHandler = vi.fn()

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
      })

      monitor.on('ping', pingHandler)
      monitor.start()

      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1000)

      expect(pingHandler).toHaveBeenCalledTimes(2)

      monitor.stop()
    })

    it('should emit pingSuccess event on successful ping', async () => {
      const pingFn = createMockPingFn()
      const successHandler = vi.fn()

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
      })

      monitor.on('pingSuccess', successHandler)
      monitor.start()

      await vi.advanceTimersByTimeAsync(0)

      expect(successHandler).toHaveBeenCalledTimes(1)
      expect(successHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          latency: expect.any(Number),
        })
      )

      monitor.stop()
    })

    it('should emit pingFailure event on failed ping', async () => {
      const pingFn = createMockPingFn({ shouldSucceed: false })
      const failureHandler = vi.fn()

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
      })

      monitor.on('pingFailure', failureHandler)
      monitor.start()

      await vi.advanceTimersByTimeAsync(0)

      expect(failureHandler).toHaveBeenCalledTimes(1)
      expect(failureHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          consecutiveFailures: 1,
        })
      )

      monitor.stop()
    })

    it('should emit reconnecting event when triggering reconnection', async () => {
      const pingFn = createMockPingFn({ shouldSucceed: false })
      const reconnectCallback = createMockReconnectCallback()
      const reconnectingHandler = vi.fn()

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        unhealthyThreshold: 2,
        reconnectOnUnhealthy: true,
        onReconnect: reconnectCallback,
      })

      monitor.on('reconnecting', reconnectingHandler)
      monitor.start()

      // Trigger unhealthy state
      await vi.advanceTimersByTimeAsync(3000)

      expect(reconnectingHandler).toHaveBeenCalled()

      monitor.stop()
    })

    it('should support off for removing listeners', async () => {
      const pingFn = createMockPingFn()
      const handler = vi.fn()

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
      })

      monitor.on('ping', handler)
      monitor.off('ping', handler)
      monitor.start()

      await vi.advanceTimersByTimeAsync(0)

      expect(handler).not.toHaveBeenCalled()

      monitor.stop()
    })
  })

  describe('Reconnection', () => {
    it('should trigger reconnection when unhealthy and reconnectOnUnhealthy is true', async () => {
      const pingFn = createMockPingFn({ shouldSucceed: false })
      const reconnectCallback = createMockReconnectCallback()

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        unhealthyThreshold: 2,
        reconnectOnUnhealthy: true,
        onReconnect: reconnectCallback,
      })

      monitor.start()

      // Trigger unhealthy state
      await vi.advanceTimersByTimeAsync(3000)

      expect(reconnectCallback).toHaveBeenCalled()

      monitor.stop()
    })

    it('should not trigger reconnection when reconnectOnUnhealthy is false', async () => {
      const pingFn = createMockPingFn({ shouldSucceed: false })
      const reconnectCallback = createMockReconnectCallback()

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        unhealthyThreshold: 2,
        reconnectOnUnhealthy: false,
        onReconnect: reconnectCallback,
      })

      monitor.start()

      // Trigger unhealthy state
      await vi.advanceTimersByTimeAsync(3000)

      expect(reconnectCallback).not.toHaveBeenCalled()

      monitor.stop()
    })

    it('should pause monitoring during reconnection', async () => {
      let reconnectResolve: () => void
      const reconnectPromise = new Promise<void>((resolve) => {
        reconnectResolve = resolve
      })
      const reconnectCallback = vi.fn(() => reconnectPromise)

      const pingFn = createMockPingFn({ shouldSucceed: false })

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        unhealthyThreshold: 2,
        reconnectOnUnhealthy: true,
        onReconnect: reconnectCallback,
      })

      monitor.start()

      // Trigger unhealthy and reconnection
      await vi.advanceTimersByTimeAsync(3000)

      const pingCountAtReconnect = (pingFn as any).mock.calls.length

      // Advance time during reconnection
      await vi.advanceTimersByTimeAsync(2000)

      // Should not have sent more pings during reconnection
      expect((pingFn as any).mock.calls.length).toBe(pingCountAtReconnect)

      // Complete reconnection
      reconnectResolve!()
      await vi.advanceTimersByTimeAsync(0)

      monitor.stop()
    })

    it('should resume monitoring after successful reconnection', async () => {
      let reconnectResolve: () => void
      const reconnectPromise = new Promise<void>((resolve) => {
        reconnectResolve = resolve
      })
      const reconnectCallback = vi.fn(() => reconnectPromise)

      let failPings = true
      const pingFn = vi.fn(async () => {
        if (failPings) {
          throw new Error('Ping failed')
        }
      })

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        unhealthyThreshold: 2,
        reconnectOnUnhealthy: true,
        onReconnect: reconnectCallback,
      })

      monitor.start()

      // Trigger unhealthy and reconnection
      await vi.advanceTimersByTimeAsync(3000)

      // Complete reconnection and make pings succeed
      failPings = false
      reconnectResolve!()
      await vi.advanceTimersByTimeAsync(0)

      const pingCountAfterReconnect = (pingFn as any).mock.calls.length

      // Advance time to trigger new ping
      await vi.advanceTimersByTimeAsync(1000)

      // Should have resumed pinging
      expect((pingFn as any).mock.calls.length).toBeGreaterThan(pingCountAfterReconnect)

      monitor.stop()
    })

    it('should reset health state after successful reconnection', async () => {
      let reconnectResolve: () => void
      const reconnectPromise = new Promise<void>((resolve) => {
        reconnectResolve = resolve
      })
      const reconnectCallback = vi.fn(() => reconnectPromise)

      let failPings = true
      const pingFn = vi.fn(async () => {
        if (failPings) {
          throw new Error('Ping failed')
        }
      })

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        unhealthyThreshold: 2,
        reconnectOnUnhealthy: true,
        onReconnect: reconnectCallback,
      })

      monitor.start()

      // Trigger unhealthy state
      await vi.advanceTimersByTimeAsync(3000)
      expect(monitor.state).toBe('unhealthy')

      // Complete reconnection
      failPings = false
      reconnectResolve!()
      await vi.advanceTimersByTimeAsync(0)

      // State should be reset to healthy
      expect(monitor.state).toBe('healthy')

      monitor.stop()
    })

    it('should emit reconnectFailed event on reconnection failure', async () => {
      const reconnectCallback = vi.fn(async () => {
        throw new Error('Reconnection failed')
      })
      const reconnectFailedHandler = vi.fn()

      const pingFn = createMockPingFn({ shouldSucceed: false })

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        unhealthyThreshold: 2,
        reconnectOnUnhealthy: true,
        onReconnect: reconnectCallback,
      })

      monitor.on('reconnectFailed', reconnectFailedHandler)
      monitor.start()

      // Trigger unhealthy and reconnection
      await vi.advanceTimersByTimeAsync(3000)

      expect(reconnectFailedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
        })
      )

      monitor.stop()
    })

    it('should emit reconnected event on successful reconnection', async () => {
      const reconnectCallback = createMockReconnectCallback()
      const reconnectedHandler = vi.fn()

      const pingFn = createMockPingFn({ shouldSucceed: false })

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        unhealthyThreshold: 2,
        reconnectOnUnhealthy: true,
        onReconnect: reconnectCallback,
      })

      monitor.on('reconnected', reconnectedHandler)
      monitor.start()

      // Trigger unhealthy and reconnection
      await vi.advanceTimersByTimeAsync(3000)

      // Wait for reconnection to complete
      await vi.advanceTimersByTimeAsync(100)

      expect(reconnectedHandler).toHaveBeenCalled()

      monitor.stop()
    })
  })

  describe('Health Status', () => {
    it('should provide current health status', async () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
      })

      monitor.start()
      await vi.advanceTimersByTimeAsync(0)

      const status = monitor.getStatus()

      expect(status).toEqual(
        expect.objectContaining({
          state: 'healthy',
          consecutiveFailures: 0,
          consecutiveSuccesses: expect.any(Number),
          lastPingTime: expect.any(Number),
          isRunning: true,
        })
      )

      monitor.stop()
    })

    it('should track consecutive failures in status', async () => {
      const pingFn = createMockPingFn({ shouldSucceed: false })
      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        degradedThreshold: 5,
        unhealthyThreshold: 10,
      })

      monitor.start()

      // Accumulate failures
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }

      const status = monitor.getStatus()
      expect(status.consecutiveFailures).toBeGreaterThanOrEqual(3)

      monitor.stop()
    })

    it('should track latency statistics', async () => {
      const pingFn = createMockPingFn({ latencyMs: 50 })
      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
      })

      monitor.start()

      // Send a few pings
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }

      const status = monitor.getStatus()

      expect(status.latency).toBeDefined()
      expect(status.latency?.current).toBeGreaterThan(0)
      expect(status.latency?.average).toBeGreaterThan(0)
      expect(status.latency?.min).toBeGreaterThan(0)
      expect(status.latency?.max).toBeGreaterThan(0)

      monitor.stop()
    })

    it('should include total ping count in status', async () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
      })

      monitor.start()

      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }

      const status = monitor.getStatus()
      expect(status.totalPings).toBeGreaterThanOrEqual(5)

      monitor.stop()
    })
  })

  describe('Ping Timeout', () => {
    it('should timeout pings that take too long', async () => {
      // Ping takes longer than timeout
      const pingFn = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
      })

      const failureHandler = vi.fn()

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        pingTimeout: 500, // Timeout before ping completes
      })

      monitor.on('pingFailure', failureHandler)
      monitor.start()

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(600)

      expect(failureHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: expect.stringMatching(/timeout/i),
          }),
        })
      )

      monitor.stop()
    })

    it('should count timeout as failure', async () => {
      const pingFn = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
      })

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        pingTimeout: 500,
        degradedThreshold: 2,
      })

      monitor.start()

      // Timeout first ping
      await vi.advanceTimersByTimeAsync(600)

      // Start second ping
      await vi.advanceTimersByTimeAsync(400)

      // Timeout second ping - should trigger degraded
      await vi.advanceTimersByTimeAsync(600)

      expect(monitor.state).toBe('degraded')

      monitor.stop()
    })
  })

  describe('Manual Health Check', () => {
    it('should support manual health check', async () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn })

      const result = await monitor.check()

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          latency: expect.any(Number),
        })
      )
    })

    it('should return failure result on failed check', async () => {
      const pingFn = createMockPingFn({ shouldSucceed: false })
      const monitor = new ConnectionHealthMonitor({ pingFn })

      const result = await monitor.check()

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          error: expect.any(Error),
        })
      )
    })

    it('should not affect internal state during manual check when not running', async () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn })

      // Should start healthy
      expect(monitor.state).toBe('healthy')

      // Manual check should not affect state
      await monitor.check()

      expect(monitor.state).toBe('healthy')
    })

    it('should update internal state during manual check when running', async () => {
      const pingFn = createMockPingFn({ shouldSucceed: false })
      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 10000, // Long interval so we control timing
        degradedThreshold: 2,
      })

      monitor.start()

      // First failure (from start)
      await vi.advanceTimersByTimeAsync(0)

      // Manual check triggers second failure
      await monitor.check()

      expect(monitor.state).toBe('degraded')

      monitor.stop()
    })
  })

  describe('Configuration Updates', () => {
    it('should allow updating ping interval while running', async () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 5000,
      })

      monitor.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(pingFn).toHaveBeenCalledTimes(1)

      // Update interval to shorter time
      monitor.setPingInterval(1000)

      await vi.advanceTimersByTimeAsync(1000)
      expect(pingFn).toHaveBeenCalledTimes(2)

      monitor.stop()
    })

    it('should allow updating reconnect callback', async () => {
      const pingFn = createMockPingFn({ shouldSucceed: false })
      const originalCallback = createMockReconnectCallback()
      const newCallback = createMockReconnectCallback()

      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
        unhealthyThreshold: 2,
        reconnectOnUnhealthy: true,
        onReconnect: originalCallback,
      })

      // Update callback before starting
      monitor.setReconnectCallback(newCallback)

      monitor.start()

      // Trigger unhealthy state
      await vi.advanceTimersByTimeAsync(3000)

      expect(originalCallback).not.toHaveBeenCalled()
      expect(newCallback).toHaveBeenCalled()

      monitor.stop()
    })

    it('should allow updating thresholds', () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({
        pingFn,
        degradedThreshold: 2,
        unhealthyThreshold: 5,
      })

      monitor.setThresholds({
        degradedThreshold: 3,
        unhealthyThreshold: 6,
        healthyThreshold: 2,
      })

      expect(monitor.options.degradedThreshold).toBe(3)
      expect(monitor.options.unhealthyThreshold).toBe(6)
      expect(monitor.options.healthyThreshold).toBe(2)
    })
  })

  describe('Destroy', () => {
    it('should clean up all resources on destroy', async () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({
        pingFn,
        pingInterval: 1000,
      })

      const handler = vi.fn()
      monitor.on('ping', handler)

      monitor.start()
      await vi.advanceTimersByTimeAsync(0)

      monitor.destroy()

      // Should stop monitoring
      expect(monitor.isRunning).toBe(false)

      // Advance time - no more pings should occur
      await vi.advanceTimersByTimeAsync(5000)
      const callCountAtDestroy = (pingFn as any).mock.calls.length

      await vi.advanceTimersByTimeAsync(5000)
      expect((pingFn as any).mock.calls.length).toBe(callCountAtDestroy)
    })

    it('should remove all event listeners on destroy', () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn })

      const handler = vi.fn()
      monitor.on('healthChange', handler)
      monitor.on('ping', handler)
      monitor.on('pingSuccess', handler)

      monitor.destroy()

      // Should have removed all listeners
      expect(monitor.listenerCount('healthChange')).toBe(0)
      expect(monitor.listenerCount('ping')).toBe(0)
      expect(monitor.listenerCount('pingSuccess')).toBe(0)
    })

    it('should not throw when destroyed multiple times', () => {
      const pingFn = createMockPingFn()
      const monitor = new ConnectionHealthMonitor({ pingFn })

      monitor.start()
      monitor.destroy()

      expect(() => monitor.destroy()).not.toThrow()
    })
  })
})
