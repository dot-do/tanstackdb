/**
 * @file Graceful Degradation Tests (RED Phase - TDD)
 *
 * These tests verify the graceful degradation capabilities for Layer 11
 * Reconnection/Resilience. Graceful degradation allows the application to
 * continue working with cached data when connection fails, providing a
 * seamless user experience even during network issues.
 *
 * Features being tested:
 * - Offline mode detection and signaling
 * - Cached data serving when connection fails
 * - Request queueing during offline periods
 * - Automatic retry with exponential backoff
 * - State synchronization after reconnection
 * - Configurable degradation strategies
 * - Event emission for degradation state changes
 *
 * RED PHASE: These tests will fail until GracefulDegradation is implemented
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GracefulDegradation } from '../../src/rpc/graceful-degradation'
import type {
  GracefulDegradationConfig,
  DegradationState,
  CacheEntry,
  QueuedRequest,
} from '../../src/rpc/graceful-degradation'

// =============================================================================
// Mock Dependencies
// =============================================================================

/**
 * Mock transport that simulates WebSocket connection behavior
 */
class MockTransport {
  isConnected = true
  private _listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map()
  private _sendHandler: ((method: string, params: unknown) => Promise<unknown>) | null = null

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    this._listeners.get(event)!.add(handler)
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this._listeners.get(event)?.delete(handler)
  }

  emit(event: string, ...args: unknown[]): void {
    this._listeners.get(event)?.forEach((h) => h(...args))
  }

  async send<T>(method: string, params: unknown): Promise<T> {
    if (!this.isConnected) {
      throw new Error('Not connected')
    }
    if (this._sendHandler) {
      return this._sendHandler(method, params) as Promise<T>
    }
    throw new Error('No send handler configured')
  }

  setSendHandler(handler: (method: string, params: unknown) => Promise<unknown>): void {
    this._sendHandler = handler
  }

  simulateDisconnect(): void {
    this.isConnected = false
    this.emit('disconnect')
  }

  simulateReconnect(): void {
    this.isConnected = true
    this.emit('connect')
  }
}

/**
 * Simple in-memory cache for testing
 */
class MockCache {
  private store = new Map<string, { data: unknown; timestamp: number; ttl: number }>()

  async get(key: string): Promise<unknown | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    if (Date.now() > entry.timestamp + entry.ttl) {
      this.store.delete(key)
      return null
    }
    return entry.data
  }

  async set(key: string, data: unknown, ttl: number = 300000): Promise<void> {
    this.store.set(key, { data, timestamp: Date.now(), ttl })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key)
  }
}

// =============================================================================
// Test Suite
// =============================================================================

describe('GracefulDegradation', () => {
  let transport: MockTransport
  let cache: MockCache
  let degradation: GracefulDegradation

  beforeEach(() => {
    vi.useFakeTimers()
    transport = new MockTransport()
    cache = new MockCache()
  })

  afterEach(async () => {
    if (degradation) {
      await degradation.dispose()
    }
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('Constructor', () => {
    it('should construct with transport and default options', () => {
      degradation = new GracefulDegradation({
        transport: transport as any,
      })

      expect(degradation).toBeInstanceOf(GracefulDegradation)
      expect(degradation.state).toBe('online')
    })

    it('should construct with custom cache', () => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
      })

      expect(degradation).toBeInstanceOf(GracefulDegradation)
    })

    it('should construct with full configuration', () => {
      const config: GracefulDegradationConfig = {
        transport: transport as any,
        cache: cache as any,
        maxRetries: 5,
        retryBaseDelay: 1000,
        retryMaxDelay: 30000,
        cacheDefaultTTL: 300000,
        maxQueueSize: 100,
        queueTimeout: 60000,
        enableOfflineQueue: true,
        offlineMethods: ['find', 'findOne', 'aggregate'],
      }

      degradation = new GracefulDegradation(config)

      expect(degradation.config.maxRetries).toBe(5)
      expect(degradation.config.retryBaseDelay).toBe(1000)
      expect(degradation.config.cacheDefaultTTL).toBe(300000)
    })

    it('should use default values when not specified', () => {
      degradation = new GracefulDegradation({
        transport: transport as any,
      })

      expect(degradation.config.maxRetries).toBeGreaterThan(0)
      expect(degradation.config.retryBaseDelay).toBeGreaterThan(0)
      expect(degradation.config.cacheDefaultTTL).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // State Management Tests
  // ===========================================================================

  describe('State Management', () => {
    beforeEach(() => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
      })
    })

    it('should start in online state when transport is connected', () => {
      expect(degradation.state).toBe('online')
      expect(degradation.isOnline).toBe(true)
    })

    it('should transition to degraded state when connection is lost', () => {
      transport.simulateDisconnect()

      expect(degradation.state).toBe('degraded')
      expect(degradation.isOnline).toBe(false)
    })

    it('should transition back to online when connection is restored', () => {
      transport.simulateDisconnect()
      expect(degradation.state).toBe('degraded')

      transport.simulateReconnect()
      expect(degradation.state).toBe('online')
      expect(degradation.isOnline).toBe(true)
    })

    it('should emit stateChange events', () => {
      const stateHandler = vi.fn()
      degradation.on('stateChange', stateHandler)

      transport.simulateDisconnect()
      expect(stateHandler).toHaveBeenCalledWith('degraded')

      transport.simulateReconnect()
      expect(stateHandler).toHaveBeenCalledWith('online')
    })

    it('should track time spent in degraded state', async () => {
      transport.simulateDisconnect()

      await vi.advanceTimersByTimeAsync(5000)

      expect(degradation.degradedDuration).toBeGreaterThanOrEqual(5000)

      transport.simulateReconnect()
      // Duration should be frozen after reconnect
      const duration = degradation.degradedDuration
      await vi.advanceTimersByTimeAsync(1000)
      expect(degradation.degradedDuration).toBe(duration)
    })
  })

  // ===========================================================================
  // Cache Integration Tests
  // ===========================================================================

  describe('Cache Integration', () => {
    beforeEach(() => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
        cacheDefaultTTL: 60000,
      })
    })

    it('should cache successful responses', async () => {
      transport.setSendHandler(async (method, params) => {
        return [{ _id: '1', name: 'Test' }]
      })

      const result = await degradation.request('find', {
        collection: 'users',
        filter: {},
      })

      expect(result).toEqual([{ _id: '1', name: 'Test' }])

      // Verify cache was populated
      const cacheKey = degradation.getCacheKey('find', {
        collection: 'users',
        filter: {},
      })
      const cached = await cache.get(cacheKey)
      expect(cached).toEqual([{ _id: '1', name: 'Test' }])
    })

    it('should serve cached data when offline', async () => {
      // First, populate cache while online
      transport.setSendHandler(async () => [{ _id: '1', name: 'Cached' }])
      await degradation.request('find', { collection: 'users' })

      // Go offline
      transport.simulateDisconnect()

      // Should return cached data
      const result = await degradation.request('find', { collection: 'users' })
      expect(result).toEqual([{ _id: '1', name: 'Cached' }])
    })

    it('should throw when offline with no cache', async () => {
      transport.simulateDisconnect()

      await expect(
        degradation.request('find', { collection: 'newcollection' })
      ).rejects.toThrow(/offline/i)
    })

    it('should respect cache TTL', async () => {
      transport.setSendHandler(async () => [{ _id: '1' }])
      await degradation.request('find', { collection: 'users' })

      // Advance past TTL
      await vi.advanceTimersByTimeAsync(61000)

      transport.simulateDisconnect()

      // Cache should be expired
      await expect(
        degradation.request('find', { collection: 'users' })
      ).rejects.toThrow(/offline/i)
    })

    it('should support custom cache keys', async () => {
      transport.setSendHandler(async () => ({ count: 42 }))

      await degradation.request(
        'count',
        { collection: 'users' },
        { cacheKey: 'user-count' }
      )

      const cached = await cache.get('user-count')
      expect(cached).toEqual({ count: 42 })
    })

    it('should support cache bypass', async () => {
      transport.setSendHandler(async () => [{ _id: '1' }])
      await degradation.request('find', { collection: 'users' })

      transport.setSendHandler(async () => [{ _id: '2' }])

      // With bypass, should get fresh data
      const result = await degradation.request(
        'find',
        { collection: 'users' },
        { bypassCache: true }
      )

      expect(result).toEqual([{ _id: '2' }])
    })

    it('should support stale-while-revalidate pattern', async () => {
      transport.setSendHandler(async () => [{ _id: 'fresh' }])
      await degradation.request('find', { collection: 'users' })

      // Update server data
      transport.setSendHandler(async () => {
        // Simulate slow response
        await new Promise((r) => setTimeout(r, 1000))
        return [{ _id: 'revalidated' }]
      })

      // Request with stale-while-revalidate
      const result = await degradation.request(
        'find',
        { collection: 'users' },
        { staleWhileRevalidate: true }
      )

      // Should return stale data immediately
      expect(result).toEqual([{ _id: 'fresh' }])

      // After revalidation completes, cache should be updated
      await vi.advanceTimersByTimeAsync(2000)
      const cacheKey = degradation.getCacheKey('find', { collection: 'users' })
      const cached = await cache.get(cacheKey)
      expect(cached).toEqual([{ _id: 'revalidated' }])
    })
  })

  // ===========================================================================
  // Request Queue Tests
  // ===========================================================================

  describe('Request Queue', () => {
    beforeEach(() => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
        enableOfflineQueue: true,
        maxQueueSize: 5,
        queueTimeout: 10000,
      })
    })

    it('should queue write requests when offline', async () => {
      transport.simulateDisconnect()

      const insertPromise = degradation.request(
        'insertOne',
        { collection: 'users', document: { name: 'New User' } },
        { queueable: true }
      )

      expect(degradation.queueSize).toBe(1)

      // Reconnect and process queue
      transport.setSendHandler(async () => ({ insertedId: '123' }))
      transport.simulateReconnect()

      await vi.advanceTimersByTimeAsync(100)

      const result = await insertPromise
      expect(result).toEqual({ insertedId: '123' })
      expect(degradation.queueSize).toBe(0)
    })

    it('should respect queue size limits', async () => {
      transport.simulateDisconnect()

      // Fill the queue
      for (let i = 0; i < 5; i++) {
        degradation.request(
          'insertOne',
          { document: { id: i } },
          { queueable: true }
        ).catch(() => {})
      }

      expect(degradation.queueSize).toBe(5)

      // Next request should fail or drop oldest
      await expect(
        degradation.request(
          'insertOne',
          { document: { id: 6 } },
          { queueable: true }
        )
      ).rejects.toThrow(/queue.*full/i)
    })

    it('should timeout queued requests', async () => {
      transport.simulateDisconnect()

      const requestPromise = degradation.request(
        'insertOne',
        { document: {} },
        { queueable: true }
      )
      requestPromise.catch(() => {}) // Prevent unhandled rejection

      await vi.advanceTimersByTimeAsync(11000)

      await expect(requestPromise).rejects.toThrow(/timeout/i)
      expect(degradation.queueSize).toBe(0)
    })

    it('should process queue in order on reconnect', async () => {
      const processedOrder: number[] = []

      transport.simulateDisconnect()

      // Queue multiple requests
      const promises = [1, 2, 3].map((id) =>
        degradation.request(
          'insertOne',
          { document: { id } },
          { queueable: true }
        )
      )

      transport.setSendHandler(async (method, params) => {
        const doc = (params as any).document
        processedOrder.push(doc.id)
        return { insertedId: doc.id }
      })

      transport.simulateReconnect()
      await vi.advanceTimersByTimeAsync(100)

      await Promise.all(promises)

      expect(processedOrder).toEqual([1, 2, 3])
    })

    it('should emit queue events', async () => {
      const queueHandler = vi.fn()
      const processedHandler = vi.fn()

      degradation.on('requestQueued', queueHandler)
      degradation.on('queueProcessed', processedHandler)

      transport.simulateDisconnect()

      degradation.request(
        'insertOne',
        { document: {} },
        { queueable: true }
      ).catch(() => {})

      expect(queueHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'insertOne',
        })
      )

      transport.setSendHandler(async () => ({ insertedId: '1' }))
      transport.simulateReconnect()
      await vi.advanceTimersByTimeAsync(100)

      expect(processedHandler).toHaveBeenCalled()
    })

    it('should allow clearing the queue', async () => {
      transport.simulateDisconnect()

      const promises = [1, 2, 3].map((id) =>
        degradation.request(
          'insertOne',
          { document: { id } },
          { queueable: true }
        ).catch(() => {})
      )

      degradation.clearQueue()

      expect(degradation.queueSize).toBe(0)
      // All promises should reject
      await Promise.allSettled(promises)
    })
  })

  // ===========================================================================
  // Retry Logic Tests
  // ===========================================================================

  describe('Retry Logic', () => {
    beforeEach(() => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
        maxRetries: 3,
        retryBaseDelay: 1000,
        retryMaxDelay: 10000,
      })
    })

    it('should retry failed requests', async () => {
      let attempts = 0

      transport.setSendHandler(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
        return { success: true }
      })

      const result = await degradation.request(
        'find',
        { collection: 'users' },
        { retry: true }
      )

      expect(attempts).toBe(3)
      expect(result).toEqual({ success: true })
    })

    it('should use exponential backoff', async () => {
      const delays: number[] = []
      let lastTime = Date.now()

      transport.setSendHandler(async () => {
        const now = Date.now()
        if (delays.length > 0) {
          delays.push(now - lastTime)
        }
        lastTime = now
        if (delays.length < 3) {
          throw new Error('Retry')
        }
        return { success: true }
      })

      const promise = degradation.request(
        'find',
        { collection: 'users' },
        { retry: true }
      )

      // Advance through retries
      await vi.advanceTimersByTimeAsync(1000) // First retry
      await vi.advanceTimersByTimeAsync(2000) // Second retry (exponential)
      await vi.advanceTimersByTimeAsync(4000) // Third retry

      await promise

      // Delays should increase exponentially
      expect(delays[0]).toBeGreaterThanOrEqual(1000)
      expect(delays[1]).toBeGreaterThanOrEqual(delays[0] ?? 0)
    })

    it('should respect max delay cap', async () => {
      const delays: number[] = []

      transport.setSendHandler(async () => {
        delays.push(Date.now())
        if (delays.length < 5) {
          throw new Error('Retry')
        }
        return { success: true }
      })

      const promise = degradation.request(
        'find',
        { collection: 'users' },
        { retry: true, maxRetries: 5 }
      )

      // Advance through all retries
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(10000)
      }

      await promise

      // Delays should be capped at maxDelay
      for (let i = 1; i < delays.length; i++) {
        const delay = (delays[i] ?? 0) - (delays[i - 1] ?? 0)
        expect(delay).toBeLessThanOrEqual(10001) // maxDelay + 1ms tolerance
      }
    })

    it('should give up after max retries', async () => {
      transport.setSendHandler(async () => {
        throw new Error('Persistent failure')
      })

      const promise = degradation.request(
        'find',
        { collection: 'users' },
        { retry: true }
      )
      promise.catch(() => {}) // Prevent unhandled rejection

      // Advance through all retries
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(10000)
      }

      await expect(promise).rejects.toThrow('Persistent failure')
    })

    it('should emit retry events', async () => {
      const retryHandler = vi.fn()
      degradation.on('retry', retryHandler)

      let attempts = 0
      transport.setSendHandler(async () => {
        attempts++
        if (attempts < 2) {
          throw new Error('Retry needed')
        }
        return { success: true }
      })

      const promise = degradation.request(
        'find',
        { collection: 'users' },
        { retry: true }
      )

      await vi.advanceTimersByTimeAsync(2000)
      await promise

      expect(retryHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'find',
          attempt: 1,
        })
      )
    })

    it('should support custom retry conditions', async () => {
      let attempts = 0

      transport.setSendHandler(async () => {
        attempts++
        if (attempts === 1) {
          const error = new Error('Retryable') as any
          error.code = 'ETIMEDOUT'
          throw error
        }
        return { success: true }
      })

      await degradation.request(
        'find',
        { collection: 'users' },
        {
          retry: true,
          retryCondition: (error) => (error as any).code === 'ETIMEDOUT',
        }
      )

      expect(attempts).toBe(2)
    })
  })

  // ===========================================================================
  // Sync After Reconnection Tests
  // ===========================================================================

  describe('Sync After Reconnection', () => {
    beforeEach(() => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
        enableOfflineQueue: true,
      })
    })

    it('should sync queued mutations on reconnect', async () => {
      const synced: unknown[] = []

      transport.simulateDisconnect()

      // Queue some mutations
      const mutation1 = degradation.request(
        'insertOne',
        { collection: 'users', document: { name: 'User 1' } },
        { queueable: true }
      )
      const mutation2 = degradation.request(
        'updateOne',
        { collection: 'users', filter: { _id: '1' }, update: { name: 'Updated' } },
        { queueable: true }
      )

      transport.setSendHandler(async (method, params) => {
        synced.push({ method, params })
        return { success: true }
      })

      transport.simulateReconnect()
      await vi.advanceTimersByTimeAsync(100)

      await Promise.all([mutation1, mutation2])

      expect(synced).toHaveLength(2)
      expect(synced[0]).toMatchObject({ method: 'insertOne' })
      expect(synced[1]).toMatchObject({ method: 'updateOne' })
    })

    it('should invalidate related cache entries after sync', async () => {
      // Populate cache
      transport.setSendHandler(async () => [{ _id: '1', name: 'Original' }])
      await degradation.request('find', { collection: 'users' })

      transport.simulateDisconnect()

      // Queue a mutation that affects the cached data
      degradation.request(
        'updateOne',
        {
          collection: 'users',
          filter: { _id: '1' },
          update: { $set: { name: 'Modified' } },
        },
        { queueable: true, invalidates: ['find:users'] }
      ).catch(() => {})

      transport.setSendHandler(async (method) => {
        if (method === 'updateOne') {
          return { modifiedCount: 1 }
        }
        return [{ _id: '1', name: 'Modified' }]
      })

      transport.simulateReconnect()
      await vi.advanceTimersByTimeAsync(100)

      // Cache should be invalidated - next request should fetch fresh data
      const result = await degradation.request('find', { collection: 'users' })
      expect(result).toEqual([{ _id: '1', name: 'Modified' }])
    })

    it('should emit sync events', async () => {
      const syncStartHandler = vi.fn()
      const syncCompleteHandler = vi.fn()

      degradation.on('syncStart', syncStartHandler)
      degradation.on('syncComplete', syncCompleteHandler)

      transport.simulateDisconnect()

      degradation.request(
        'insertOne',
        { document: {} },
        { queueable: true }
      ).catch(() => {})

      transport.setSendHandler(async () => ({ success: true }))
      transport.simulateReconnect()
      await vi.advanceTimersByTimeAsync(100)

      expect(syncStartHandler).toHaveBeenCalled()
      expect(syncCompleteHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          processed: 1,
          failed: 0,
        })
      )
    })

    it('should handle partial sync failures', async () => {
      const failedHandler = vi.fn()
      degradation.on('syncFailed', failedHandler)

      transport.simulateDisconnect()

      const mutation1 = degradation.request(
        'insertOne',
        { document: { id: 1 } },
        { queueable: true }
      )
      const mutation2 = degradation.request(
        'insertOne',
        { document: { id: 2 } },
        { queueable: true }
      )
      mutation2.catch(() => {}) // This one will fail

      let callCount = 0
      transport.setSendHandler(async () => {
        callCount++
        if (callCount === 2) {
          throw new Error('Second mutation failed')
        }
        return { insertedId: '1' }
      })

      transport.simulateReconnect()
      await vi.advanceTimersByTimeAsync(100)

      await expect(mutation1).resolves.toEqual({ insertedId: '1' })
      await expect(mutation2).rejects.toThrow('Second mutation failed')

      expect(failedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'insertOne',
          error: expect.any(Error),
        })
      )
    })
  })

  // ===========================================================================
  // Degradation Strategy Tests
  // ===========================================================================

  describe('Degradation Strategies', () => {
    it('should support "cache-first" strategy', async () => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
        strategy: 'cache-first',
      })

      // Populate cache
      transport.setSendHandler(async () => [{ _id: 'cached' }])
      await degradation.request('find', { collection: 'users' })

      // Update server response
      transport.setSendHandler(async () => [{ _id: 'fresh' }])

      // Should return cached data (cache-first)
      const result = await degradation.request('find', { collection: 'users' })
      expect(result).toEqual([{ _id: 'cached' }])
    })

    it('should support "network-first" strategy', async () => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
        strategy: 'network-first',
      })

      // Populate cache
      transport.setSendHandler(async () => [{ _id: 'cached' }])
      await degradation.request('find', { collection: 'users' })

      // Update server response
      transport.setSendHandler(async () => [{ _id: 'fresh' }])

      // Should return fresh data (network-first)
      const result = await degradation.request('find', { collection: 'users' })
      expect(result).toEqual([{ _id: 'fresh' }])
    })

    it('should fallback to cache on network failure with "network-first"', async () => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
        strategy: 'network-first',
      })

      // Populate cache
      transport.setSendHandler(async () => [{ _id: 'cached' }])
      await degradation.request('find', { collection: 'users' })

      // Network fails
      transport.setSendHandler(async () => {
        throw new Error('Network error')
      })

      // Should fallback to cached data
      const result = await degradation.request('find', { collection: 'users' })
      expect(result).toEqual([{ _id: 'cached' }])
    })

    it('should support "stale-while-revalidate" strategy', async () => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
        strategy: 'stale-while-revalidate',
      })

      // Populate cache
      transport.setSendHandler(async () => [{ _id: 'stale' }])
      await degradation.request('find', { collection: 'users' })

      // Slow network response
      transport.setSendHandler(async () => {
        await new Promise((r) => setTimeout(r, 1000))
        return [{ _id: 'revalidated' }]
      })

      // Should return stale immediately
      const result = await degradation.request('find', { collection: 'users' })
      expect(result).toEqual([{ _id: 'stale' }])

      // After revalidation
      await vi.advanceTimersByTimeAsync(2000)
      const cacheKey = degradation.getCacheKey('find', { collection: 'users' })
      const cached = await cache.get(cacheKey)
      expect(cached).toEqual([{ _id: 'revalidated' }])
    })

    it('should support per-request strategy override', async () => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
        strategy: 'cache-first',
      })

      // Populate cache
      transport.setSendHandler(async () => [{ _id: 'cached' }])
      await degradation.request('find', { collection: 'users' })

      transport.setSendHandler(async () => [{ _id: 'fresh' }])

      // Override to network-first
      const result = await degradation.request(
        'find',
        { collection: 'users' },
        { strategy: 'network-first' }
      )

      expect(result).toEqual([{ _id: 'fresh' }])
    })
  })

  // ===========================================================================
  // Statistics and Monitoring Tests
  // ===========================================================================

  describe('Statistics and Monitoring', () => {
    beforeEach(() => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
      })
    })

    it('should track cache hit/miss statistics', async () => {
      transport.setSendHandler(async () => [{ _id: '1' }])

      // Cache miss
      await degradation.request('find', { collection: 'users' })

      // Cache hit
      transport.simulateDisconnect()
      await degradation.request('find', { collection: 'users' })

      const stats = degradation.stats
      expect(stats.cacheHits).toBe(1)
      expect(stats.cacheMisses).toBe(1)
      expect(stats.cacheHitRate).toBe(0.5)
    })

    it('should track request counts', async () => {
      transport.setSendHandler(async () => ({ success: true }))

      await degradation.request('find', {})
      await degradation.request('findOne', {})
      await degradation.request('aggregate', {})

      const stats = degradation.stats
      expect(stats.totalRequests).toBe(3)
      expect(stats.successfulRequests).toBe(3)
      expect(stats.failedRequests).toBe(0)
    })

    it('should track degraded time', async () => {
      transport.simulateDisconnect()
      await vi.advanceTimersByTimeAsync(5000)
      transport.simulateReconnect()

      const stats = degradation.stats
      expect(stats.totalDegradedTime).toBeGreaterThanOrEqual(5000)
    })

    it('should track retry statistics', async () => {
      let attempts = 0
      transport.setSendHandler(async () => {
        attempts++
        if (attempts < 3) throw new Error('Retry')
        return { success: true }
      })

      const promise = degradation.request('find', {}, { retry: true })
      await vi.advanceTimersByTimeAsync(5000)
      await promise

      const stats = degradation.stats
      expect(stats.totalRetries).toBe(2)
    })

    it('should provide queue statistics', async () => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
        enableOfflineQueue: true,
      })

      transport.simulateDisconnect()

      for (let i = 0; i < 3; i++) {
        degradation.request(
          'insertOne',
          { document: { id: i } },
          { queueable: true }
        ).catch(() => {})
      }

      const stats = degradation.stats
      expect(stats.queuedRequests).toBe(3)
      expect(stats.currentQueueSize).toBe(3)
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('Error Handling', () => {
    beforeEach(() => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
      })
    })

    it('should emit error events', async () => {
      const errorHandler = vi.fn()
      degradation.on('error', errorHandler)

      transport.setSendHandler(async () => {
        throw new Error('Request failed')
      })

      await expect(degradation.request('find', {})).rejects.toThrow()

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Request failed',
        })
      )
    })

    it('should include context in errors', async () => {
      transport.setSendHandler(async () => {
        throw new Error('Failed')
      })

      try {
        await degradation.request('find', { collection: 'users' })
      } catch (error) {
        expect(error).toMatchObject({
          method: 'find',
          params: { collection: 'users' },
        })
      }
    })

    it('should handle cache errors gracefully', async () => {
      const brokenCache = {
        get: async () => {
          throw new Error('Cache read failed')
        },
        set: async () => {
          throw new Error('Cache write failed')
        },
        delete: async () => {},
        clear: async () => {},
        has: async () => false,
      }

      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: brokenCache as any,
      })

      transport.setSendHandler(async () => [{ _id: '1' }])

      // Should still work despite cache errors
      const result = await degradation.request('find', { collection: 'users' })
      expect(result).toEqual([{ _id: '1' }])
    })
  })

  // ===========================================================================
  // Dispose Tests
  // ===========================================================================

  describe('Dispose', () => {
    beforeEach(() => {
      degradation = new GracefulDegradation({
        transport: transport as any,
        cache: cache as any,
        enableOfflineQueue: true,
      })
    })

    it('should clean up on dispose', async () => {
      transport.simulateDisconnect()

      const queuedRequest = degradation.request(
        'insertOne',
        { document: {} },
        { queueable: true }
      )
      queuedRequest.catch(() => {})

      await degradation.dispose()

      // Queue should be cleared
      expect(degradation.queueSize).toBe(0)

      // Queued requests should reject
      await expect(queuedRequest).rejects.toThrow(/disposed/i)
    })

    it('should remove event listeners on dispose', async () => {
      const handler = vi.fn()
      degradation.on('stateChange', handler)

      await degradation.dispose()

      transport.simulateDisconnect()
      expect(handler).not.toHaveBeenCalled()
    })

    it('should reject new requests after dispose', async () => {
      await degradation.dispose()

      await expect(degradation.request('find', {})).rejects.toThrow(/disposed/i)
    })
  })
})
