/**
 * @file State Recovery Tests (RED Phase - TDD)
 *
 * These tests verify the State Recovery implementation for Layer 11 Reconnection/Resilience.
 * StateRecoveryManager handles restoration of subscriptions and pending requests after
 * WebSocket reconnection events.
 *
 * Features being tested:
 * - Subscription state tracking and restoration
 * - Pending request tracking and retry
 * - Recovery progress events
 * - Recovery failure handling
 * - Partial recovery scenarios
 * - State snapshot and restore functionality
 *
 * RED PHASE: These tests will fail until StateRecoveryManager is implemented in src/rpc/state-recovery.ts
 *
 * Bead ID: po0.191 (RED tests)
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  StateRecoveryManager,
  type StateRecoveryConfig,
  type RecoverableSubscription,
  type RecoverablePendingRequest,
  type RecoveryResult,
  type RecoveryProgress,
  type StateSnapshot,
} from '../../src/rpc/state-recovery.js'

describe('StateRecoveryManager', () => {
  let manager: StateRecoveryManager

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('Constructor', () => {
    it('should construct with default options', () => {
      manager = new StateRecoveryManager()

      expect(manager).toBeInstanceOf(StateRecoveryManager)
    })

    it('should construct with custom configuration', () => {
      const config: StateRecoveryConfig = {
        maxRetries: 5,
        retryDelay: 2000,
        subscriptionTimeout: 10000,
        requestTimeout: 15000,
        enablePartialRecovery: true,
        prioritizeSubscriptions: true,
      }

      manager = new StateRecoveryManager(config)

      expect(manager.config.maxRetries).toBe(5)
      expect(manager.config.retryDelay).toBe(2000)
      expect(manager.config.subscriptionTimeout).toBe(10000)
      expect(manager.config.requestTimeout).toBe(15000)
      expect(manager.config.enablePartialRecovery).toBe(true)
      expect(manager.config.prioritizeSubscriptions).toBe(true)
    })

    it('should use sensible defaults when not provided', () => {
      manager = new StateRecoveryManager()

      expect(manager.config.maxRetries).toBeGreaterThan(0)
      expect(manager.config.retryDelay).toBeGreaterThan(0)
      expect(manager.config.subscriptionTimeout).toBeGreaterThan(0)
      expect(manager.config.requestTimeout).toBeGreaterThan(0)
    })
  })

  describe('Subscription Tracking', () => {
    beforeEach(() => {
      manager = new StateRecoveryManager()
    })

    it('should track a new subscription', () => {
      const subscription: RecoverableSubscription = {
        id: 'sub-1',
        method: 'subscribe',
        params: { collection: 'users', filter: { active: true } },
        createdAt: Date.now(),
      }

      manager.trackSubscription(subscription)

      const tracked = manager.getSubscriptions()
      expect(tracked).toHaveLength(1)
      expect(tracked[0]).toEqual(subscription)
    })

    it('should update an existing subscription', () => {
      const subscription: RecoverableSubscription = {
        id: 'sub-1',
        method: 'subscribe',
        params: { collection: 'users' },
        createdAt: Date.now(),
      }

      manager.trackSubscription(subscription)

      // Update with new server-assigned subscription ID
      const updatedSubscription: RecoverableSubscription = {
        ...subscription,
        serverSubscriptionId: 'server-sub-123',
      }

      manager.trackSubscription(updatedSubscription)

      const tracked = manager.getSubscriptions()
      expect(tracked).toHaveLength(1)
      expect(tracked[0].serverSubscriptionId).toBe('server-sub-123')
    })

    it('should untrack a subscription by ID', () => {
      const subscription: RecoverableSubscription = {
        id: 'sub-1',
        method: 'subscribe',
        params: { collection: 'users' },
        createdAt: Date.now(),
      }

      manager.trackSubscription(subscription)
      expect(manager.getSubscriptions()).toHaveLength(1)

      manager.untrackSubscription('sub-1')
      expect(manager.getSubscriptions()).toHaveLength(0)
    })

    it('should track multiple subscriptions', () => {
      const sub1: RecoverableSubscription = {
        id: 'sub-1',
        method: 'subscribe',
        params: { collection: 'users' },
        createdAt: Date.now(),
      }
      const sub2: RecoverableSubscription = {
        id: 'sub-2',
        method: 'subscribe',
        params: { collection: 'orders' },
        createdAt: Date.now(),
      }
      const sub3: RecoverableSubscription = {
        id: 'sub-3',
        method: 'watch',
        params: { collection: 'products', pipeline: [] },
        createdAt: Date.now(),
      }

      manager.trackSubscription(sub1)
      manager.trackSubscription(sub2)
      manager.trackSubscription(sub3)

      expect(manager.getSubscriptions()).toHaveLength(3)
    })

    it('should clear all subscriptions', () => {
      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })
      manager.trackSubscription({
        id: 'sub-2',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      manager.clearSubscriptions()

      expect(manager.getSubscriptions()).toHaveLength(0)
    })
  })

  describe('Pending Request Tracking', () => {
    beforeEach(() => {
      manager = new StateRecoveryManager()
    })

    it('should track a pending request', () => {
      const request: RecoverablePendingRequest = {
        id: 'req-1',
        method: 'find',
        params: { collection: 'users', filter: {} },
        sentAt: Date.now(),
        retryCount: 0,
      }

      manager.trackPendingRequest(request)

      const tracked = manager.getPendingRequests()
      expect(tracked).toHaveLength(1)
      expect(tracked[0]).toEqual(request)
    })

    it('should remove a pending request when resolved', () => {
      const request: RecoverablePendingRequest = {
        id: 'req-1',
        method: 'find',
        params: {},
        sentAt: Date.now(),
        retryCount: 0,
      }

      manager.trackPendingRequest(request)
      expect(manager.getPendingRequests()).toHaveLength(1)

      manager.resolvePendingRequest('req-1')
      expect(manager.getPendingRequests()).toHaveLength(0)
    })

    it('should mark a request for retry', () => {
      const request: RecoverablePendingRequest = {
        id: 'req-1',
        method: 'find',
        params: {},
        sentAt: Date.now(),
        retryCount: 0,
      }

      manager.trackPendingRequest(request)
      manager.markForRetry('req-1')

      const tracked = manager.getPendingRequests()
      expect(tracked[0].retryCount).toBe(1)
    })

    it('should limit retry count', () => {
      manager = new StateRecoveryManager({ maxRetries: 3 })

      const request: RecoverablePendingRequest = {
        id: 'req-1',
        method: 'find',
        params: {},
        sentAt: Date.now(),
        retryCount: 0,
      }

      manager.trackPendingRequest(request)

      // Retry up to max
      manager.markForRetry('req-1')
      manager.markForRetry('req-1')
      manager.markForRetry('req-1')

      // Should be marked as failed after max retries
      const tracked = manager.getPendingRequests()
      expect(tracked[0].retryCount).toBe(3)
      expect(tracked[0].failed).toBe(true)
    })

    it('should clear all pending requests', () => {
      manager.trackPendingRequest({
        id: 'req-1',
        method: 'find',
        params: {},
        sentAt: Date.now(),
        retryCount: 0,
      })
      manager.trackPendingRequest({
        id: 'req-2',
        method: 'insert',
        params: {},
        sentAt: Date.now(),
        retryCount: 0,
      })

      manager.clearPendingRequests()

      expect(manager.getPendingRequests()).toHaveLength(0)
    })

    it('should get pending requests sorted by timestamp', () => {
      const now = Date.now()

      manager.trackPendingRequest({
        id: 'req-2',
        method: 'find',
        params: {},
        sentAt: now + 1000, // Later
        retryCount: 0,
      })
      manager.trackPendingRequest({
        id: 'req-1',
        method: 'find',
        params: {},
        sentAt: now, // Earlier
        retryCount: 0,
      })
      manager.trackPendingRequest({
        id: 'req-3',
        method: 'find',
        params: {},
        sentAt: now + 500, // Middle
        retryCount: 0,
      })

      const sorted = manager.getPendingRequests({ sortBy: 'sentAt' })

      expect(sorted[0].id).toBe('req-1')
      expect(sorted[1].id).toBe('req-3')
      expect(sorted[2].id).toBe('req-2')
    })
  })

  describe('State Snapshot', () => {
    beforeEach(() => {
      manager = new StateRecoveryManager()
    })

    it('should create a state snapshot', () => {
      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: { collection: 'users' },
        createdAt: Date.now(),
      })
      manager.trackPendingRequest({
        id: 'req-1',
        method: 'find',
        params: {},
        sentAt: Date.now(),
        retryCount: 0,
      })

      const snapshot = manager.createSnapshot()

      expect(snapshot).toBeDefined()
      expect(snapshot.subscriptions).toHaveLength(1)
      expect(snapshot.pendingRequests).toHaveLength(1)
      expect(snapshot.timestamp).toBeLessThanOrEqual(Date.now())
    })

    it('should restore from a state snapshot', () => {
      const snapshot: StateSnapshot = {
        subscriptions: [
          {
            id: 'sub-1',
            method: 'subscribe',
            params: { collection: 'users' },
            createdAt: Date.now() - 10000,
          },
          {
            id: 'sub-2',
            method: 'watch',
            params: { collection: 'orders' },
            createdAt: Date.now() - 5000,
          },
        ],
        pendingRequests: [
          {
            id: 'req-1',
            method: 'find',
            params: {},
            sentAt: Date.now() - 1000,
            retryCount: 1,
          },
        ],
        timestamp: Date.now() - 100,
        version: 1,
      }

      manager.restoreFromSnapshot(snapshot)

      expect(manager.getSubscriptions()).toHaveLength(2)
      expect(manager.getPendingRequests()).toHaveLength(1)
    })

    it('should validate snapshot version on restore', () => {
      const invalidSnapshot: StateSnapshot = {
        subscriptions: [],
        pendingRequests: [],
        timestamp: Date.now(),
        version: 999, // Invalid version
      }

      expect(() => manager.restoreFromSnapshot(invalidSnapshot)).toThrow(/version/i)
    })

    it('should merge snapshot with existing state', () => {
      // Existing state
      manager.trackSubscription({
        id: 'sub-existing',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      const snapshot: StateSnapshot = {
        subscriptions: [
          {
            id: 'sub-new',
            method: 'subscribe',
            params: {},
            createdAt: Date.now(),
          },
        ],
        pendingRequests: [],
        timestamp: Date.now(),
        version: 1,
      }

      manager.restoreFromSnapshot(snapshot, { merge: true })

      expect(manager.getSubscriptions()).toHaveLength(2)
    })
  })

  describe('Recovery Process', () => {
    let mockSendFn: ReturnType<typeof vi.fn>

    beforeEach(() => {
      manager = new StateRecoveryManager({
        maxRetries: 3,
        retryDelay: 100,
        subscriptionTimeout: 1000,
        requestTimeout: 1000,
      })

      mockSendFn = vi.fn()
    })

    it('should recover subscriptions on reconnect', async () => {
      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: { collection: 'users' },
        createdAt: Date.now(),
      })
      manager.trackSubscription({
        id: 'sub-2',
        method: 'subscribe',
        params: { collection: 'orders' },
        createdAt: Date.now(),
      })

      // Mock successful re-subscription
      mockSendFn.mockResolvedValue({ subscriptionId: 'new-server-id' })

      const result = await manager.recover(mockSendFn)

      expect(result.success).toBe(true)
      expect(result.subscriptionsRecovered).toBe(2)
      expect(mockSendFn).toHaveBeenCalledTimes(2)
    })

    it('should recover pending requests on reconnect', async () => {
      manager.trackPendingRequest({
        id: 'req-1',
        method: 'find',
        params: { collection: 'users' },
        sentAt: Date.now(),
        retryCount: 0,
      })
      manager.trackPendingRequest({
        id: 'req-2',
        method: 'insert',
        params: { document: { name: 'test' } },
        sentAt: Date.now(),
        retryCount: 0,
      })

      mockSendFn.mockResolvedValue({ result: 'success' })

      const result = await manager.recover(mockSendFn)

      expect(result.success).toBe(true)
      expect(result.requestsRetried).toBe(2)
    })

    it('should handle partial recovery', async () => {
      manager = new StateRecoveryManager({
        enablePartialRecovery: true,
        maxRetries: 1,
      })

      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: { collection: 'users' },
        createdAt: Date.now(),
      })
      manager.trackSubscription({
        id: 'sub-2',
        method: 'subscribe',
        params: { collection: 'orders' },
        createdAt: Date.now(),
      })

      // First subscription succeeds, second fails
      mockSendFn
        .mockResolvedValueOnce({ subscriptionId: 'server-1' })
        .mockRejectedValueOnce(new Error('Server error'))

      const result = await manager.recover(mockSendFn)

      expect(result.success).toBe(false)
      expect(result.partialSuccess).toBe(true)
      expect(result.subscriptionsRecovered).toBe(1)
      expect(result.subscriptionsFailed).toBe(1)
    })

    it('should emit recovery progress events', async () => {
      const progressHandler = vi.fn()
      manager.on('recoveryProgress', progressHandler)

      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })
      manager.trackSubscription({
        id: 'sub-2',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      mockSendFn.mockResolvedValue({ subscriptionId: 'new-id' })

      await manager.recover(mockSendFn)

      expect(progressHandler).toHaveBeenCalled()

      const progressCalls = progressHandler.mock.calls
      const lastProgress = progressCalls[progressCalls.length - 1][0] as RecoveryProgress

      expect(lastProgress.phase).toBe('complete')
      expect(lastProgress.subscriptionsTotal).toBe(2)
      expect(lastProgress.subscriptionsRecovered).toBe(2)
    })

    it('should emit recovery start and complete events', async () => {
      const startHandler = vi.fn()
      const completeHandler = vi.fn()

      manager.on('recoveryStart', startHandler)
      manager.on('recoveryComplete', completeHandler)

      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      mockSendFn.mockResolvedValue({ subscriptionId: 'new-id' })

      await manager.recover(mockSendFn)

      expect(startHandler).toHaveBeenCalledTimes(1)
      expect(completeHandler).toHaveBeenCalledTimes(1)
    })

    it('should emit recovery failed event on complete failure', async () => {
      const failedHandler = vi.fn()
      manager.on('recoveryFailed', failedHandler)

      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      mockSendFn.mockRejectedValue(new Error('Connection failed'))

      const result = await manager.recover(mockSendFn)

      expect(result.success).toBe(false)
      expect(failedHandler).toHaveBeenCalled()
    })

    it('should prioritize subscriptions over pending requests when configured', async () => {
      manager = new StateRecoveryManager({ prioritizeSubscriptions: true })

      const callOrder: string[] = []

      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: { collection: 'users' },
        createdAt: Date.now(),
      })
      manager.trackPendingRequest({
        id: 'req-1',
        method: 'find',
        params: {},
        sentAt: Date.now(),
        retryCount: 0,
      })

      mockSendFn.mockImplementation(async (method: string) => {
        callOrder.push(method)
        return { result: 'ok' }
      })

      await manager.recover(mockSendFn)

      // Subscription should be recovered before pending request
      expect(callOrder[0]).toBe('subscribe')
      expect(callOrder[1]).toBe('find')
    })

    it('should abort recovery if aborted', async () => {
      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })
      manager.trackSubscription({
        id: 'sub-2',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      let callCount = 0
      mockSendFn.mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          // Abort after first recovery
          manager.abortRecovery()
        }
        return { subscriptionId: 'new-id' }
      })

      const result = await manager.recover(mockSendFn)

      expect(result.aborted).toBe(true)
      expect(result.subscriptionsRecovered).toBe(1)
    })

    it('should handle timeout during recovery', async () => {
      manager = new StateRecoveryManager({
        subscriptionTimeout: 100,
      })

      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      mockSendFn.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500))
      )

      const resultPromise = manager.recover(mockSendFn)
      await vi.advanceTimersByTimeAsync(200)

      const result = await resultPromise

      expect(result.success).toBe(false)
      expect(result.errors?.some((e) => e.message.includes('timeout'))).toBe(true)
    })
  })

  describe('Recovery with Retry Logic', () => {
    let mockSendFn: ReturnType<typeof vi.fn>

    beforeEach(() => {
      manager = new StateRecoveryManager({
        maxRetries: 3,
        retryDelay: 100,
      })
      mockSendFn = vi.fn()
    })

    it('should retry failed subscription recovery', async () => {
      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      // Fail twice, succeed on third attempt
      mockSendFn
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ subscriptionId: 'new-id' })

      const resultPromise = manager.recover(mockSendFn)

      // Advance through retry delays
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      const result = await resultPromise

      expect(result.success).toBe(true)
      expect(mockSendFn).toHaveBeenCalledTimes(3)
    })

    it('should fail after max retries exceeded', async () => {
      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      mockSendFn.mockRejectedValue(new Error('Persistent failure'))

      const resultPromise = manager.recover(mockSendFn)

      // Advance through all retry attempts
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(200)
      }

      const result = await resultPromise

      expect(result.success).toBe(false)
      expect(mockSendFn).toHaveBeenCalledTimes(4) // 1 initial + 3 retries
    })

    it('should use exponential backoff for retries', async () => {
      manager = new StateRecoveryManager({
        maxRetries: 3,
        retryDelay: 100,
        exponentialBackoff: true,
      })

      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      const callTimes: number[] = []
      mockSendFn.mockImplementation(async () => {
        callTimes.push(Date.now())
        throw new Error('Failure')
      })

      const resultPromise = manager.recover(mockSendFn)

      // Advance through exponentially increasing delays
      await vi.advanceTimersByTimeAsync(100) // First retry
      await vi.advanceTimersByTimeAsync(200) // Second retry (2x)
      await vi.advanceTimersByTimeAsync(400) // Third retry (4x)

      await resultPromise.catch(() => {})

      expect(mockSendFn).toHaveBeenCalledTimes(4)
    })
  })

  describe('Subscription Metadata', () => {
    beforeEach(() => {
      manager = new StateRecoveryManager()
    })

    it('should track subscription metadata', () => {
      const subscription: RecoverableSubscription = {
        id: 'sub-1',
        method: 'subscribe',
        params: { collection: 'users' },
        createdAt: Date.now(),
        metadata: {
          priority: 'high',
          tags: ['important', 'user-data'],
          resumeToken: 'token-123',
        },
      }

      manager.trackSubscription(subscription)

      const tracked = manager.getSubscriptions()
      expect(tracked[0].metadata).toEqual({
        priority: 'high',
        tags: ['important', 'user-data'],
        resumeToken: 'token-123',
      })
    })

    it('should use resume token when recovering', async () => {
      const mockSendFn = vi.fn().mockResolvedValue({ subscriptionId: 'new-id' })

      manager.trackSubscription({
        id: 'sub-1',
        method: 'watch',
        params: { collection: 'users' },
        createdAt: Date.now(),
        metadata: {
          resumeToken: 'resume-123',
        },
      })

      await manager.recover(mockSendFn)

      expect(mockSendFn).toHaveBeenCalledWith(
        'watch',
        expect.objectContaining({
          resumeToken: 'resume-123',
        })
      )
    })
  })

  describe('Event Emitter Interface', () => {
    beforeEach(() => {
      manager = new StateRecoveryManager()
    })

    it('should support on/off for event listeners', () => {
      const handler = vi.fn()

      manager.on('subscriptionTracked', handler)

      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      expect(handler).toHaveBeenCalled()

      manager.off('subscriptionTracked', handler)

      manager.trackSubscription({
        id: 'sub-2',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      // Handler should only have been called once
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should emit subscriptionTracked event', () => {
      const handler = vi.fn()
      manager.on('subscriptionTracked', handler)

      const subscription: RecoverableSubscription = {
        id: 'sub-1',
        method: 'subscribe',
        params: { collection: 'users' },
        createdAt: Date.now(),
      }

      manager.trackSubscription(subscription)

      expect(handler).toHaveBeenCalledWith(subscription)
    })

    it('should emit subscriptionUntracked event', () => {
      const handler = vi.fn()
      manager.on('subscriptionUntracked', handler)

      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      manager.untrackSubscription('sub-1')

      expect(handler).toHaveBeenCalledWith({ id: 'sub-1' })
    })

    it('should emit requestTracked event', () => {
      const handler = vi.fn()
      manager.on('requestTracked', handler)

      const request: RecoverablePendingRequest = {
        id: 'req-1',
        method: 'find',
        params: {},
        sentAt: Date.now(),
        retryCount: 0,
      }

      manager.trackPendingRequest(request)

      expect(handler).toHaveBeenCalledWith(request)
    })
  })

  describe('Integration with WebSocket Transport', () => {
    beforeEach(() => {
      manager = new StateRecoveryManager()
    })

    it('should provide a connection handler for WebSocket events', () => {
      expect(typeof manager.getReconnectHandler).toBe('function')

      const handler = manager.getReconnectHandler()
      expect(typeof handler).toBe('function')
    })

    it('should track subscriptions from transport subscribe calls', () => {
      // Simulates how WebSocketTransport would integrate with StateRecoveryManager
      const subscribeParams = { collection: 'users', filter: { active: true } }

      manager.trackFromTransport('subscribe', subscribeParams, 'sub-1')

      const subscriptions = manager.getSubscriptions()
      expect(subscriptions).toHaveLength(1)
      expect(subscriptions[0].params).toEqual(subscribeParams)
    })

    it('should update subscription with server response', () => {
      manager.trackFromTransport('subscribe', { collection: 'users' }, 'sub-1')

      manager.updateFromResponse('sub-1', {
        subscriptionId: 'server-sub-abc',
        resumeToken: 'token-xyz',
      })

      const subscriptions = manager.getSubscriptions()
      expect(subscriptions[0].serverSubscriptionId).toBe('server-sub-abc')
      expect(subscriptions[0].metadata?.resumeToken).toBe('token-xyz')
    })
  })

  describe('Statistics and Metrics', () => {
    beforeEach(() => {
      manager = new StateRecoveryManager()
    })

    it('should track recovery statistics', async () => {
      const mockSendFn = vi.fn().mockResolvedValue({ subscriptionId: 'new' })

      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      await manager.recover(mockSendFn)

      const stats = manager.getStatistics()

      expect(stats.totalRecoveryAttempts).toBe(1)
      expect(stats.successfulRecoveries).toBe(1)
      expect(stats.failedRecoveries).toBe(0)
      expect(stats.lastRecoveryTime).toBeDefined()
    })

    it('should track average recovery duration', async () => {
      const mockSendFn = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { subscriptionId: 'new' }
      })

      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      const recoveryPromise = manager.recover(mockSendFn)
      await vi.advanceTimersByTimeAsync(100)
      await recoveryPromise

      const stats = manager.getStatistics()

      expect(stats.averageRecoveryDuration).toBeGreaterThan(0)
    })

    it('should provide active subscription count', () => {
      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })
      manager.trackSubscription({
        id: 'sub-2',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })

      const stats = manager.getStatistics()

      expect(stats.activeSubscriptions).toBe(2)
    })

    it('should provide pending request count', () => {
      manager.trackPendingRequest({
        id: 'req-1',
        method: 'find',
        params: {},
        sentAt: Date.now(),
        retryCount: 0,
      })

      const stats = manager.getStatistics()

      expect(stats.pendingRequests).toBe(1)
    })
  })

  describe('Clear and Reset', () => {
    beforeEach(() => {
      manager = new StateRecoveryManager()
    })

    it('should clear all state', () => {
      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })
      manager.trackPendingRequest({
        id: 'req-1',
        method: 'find',
        params: {},
        sentAt: Date.now(),
        retryCount: 0,
      })

      manager.clear()

      expect(manager.getSubscriptions()).toHaveLength(0)
      expect(manager.getPendingRequests()).toHaveLength(0)
    })

    it('should reset statistics on clear', async () => {
      const mockSendFn = vi.fn().mockResolvedValue({ subscriptionId: 'new' })

      manager.trackSubscription({
        id: 'sub-1',
        method: 'subscribe',
        params: {},
        createdAt: Date.now(),
      })
      await manager.recover(mockSendFn)

      manager.clear({ resetStatistics: true })

      const stats = manager.getStatistics()
      expect(stats.totalRecoveryAttempts).toBe(0)
    })
  })
})
