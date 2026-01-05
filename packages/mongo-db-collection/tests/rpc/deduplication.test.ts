/**
 * Request Deduplication Tests
 *
 * These tests verify the RequestDeduplicator class which prevents
 * duplicate network calls for identical concurrent requests.
 *
 * Key behaviors:
 * 1. Identical concurrent requests share a single network call
 * 2. Cache keys are generated from method + params
 * 3. Pending requests are tracked in a map
 * 4. Subsequent identical requests await the existing promise
 * 5. Cache clears after request completes
 * 6. Different params create separate requests
 * 7. Error results are not cached (failed requests can be retried)
 * 8. Statistics tracking (hits, misses, pending hits, evictions)
 * 9. LRU eviction when maxCacheSize is configured
 * 10. Custom key serializer support
 * 11. Debug logging support
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RequestDeduplicator, type KeySerializer, type CacheStatistics } from '../../src/rpc/deduplication'

describe('RequestDeduplicator', () => {
  let deduplicator: RequestDeduplicator

  beforeEach(() => {
    deduplicator = new RequestDeduplicator()
  })

  describe('cache key generation', () => {
    it('should generate cache keys from method+params', () => {
      const key1 = deduplicator.generateCacheKey('find', { filter: { name: 'John' } })
      const key2 = deduplicator.generateCacheKey('find', { filter: { name: 'John' } })
      const key3 = deduplicator.generateCacheKey('find', { filter: { name: 'Jane' } })
      const key4 = deduplicator.generateCacheKey('insert', { filter: { name: 'John' } })

      // Same method + same params = same key
      expect(key1).toBe(key2)

      // Same method + different params = different key
      expect(key1).not.toBe(key3)

      // Different method + same params = different key
      expect(key1).not.toBe(key4)
    })

    it('should generate consistent keys for deeply nested objects', () => {
      const params1 = {
        filter: {
          $and: [
            { age: { $gte: 18 } },
            { status: 'active' },
          ],
        },
        options: { limit: 10 },
      }
      const params2 = {
        filter: {
          $and: [
            { age: { $gte: 18 } },
            { status: 'active' },
          ],
        },
        options: { limit: 10 },
      }

      const key1 = deduplicator.generateCacheKey('find', params1)
      const key2 = deduplicator.generateCacheKey('find', params2)

      expect(key1).toBe(key2)
    })

    it('should handle undefined and null params correctly', () => {
      const key1 = deduplicator.generateCacheKey('count', undefined)
      const key2 = deduplicator.generateCacheKey('count', null)
      const key3 = deduplicator.generateCacheKey('count', {})

      // All should generate valid (but potentially different) keys
      expect(typeof key1).toBe('string')
      expect(typeof key2).toBe('string')
      expect(typeof key3).toBe('string')
    })
  })

  describe('request deduplication', () => {
    it('should deduplicate identical concurrent requests', async () => {
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      // Fire 3 concurrent requests with same method + params
      const request1 = deduplicator.execute('find', { filter: { id: 1 } }, networkCall)
      const request2 = deduplicator.execute('find', { filter: { id: 1 } }, networkCall)
      const request3 = deduplicator.execute('find', { filter: { id: 1 } }, networkCall)

      // All should resolve to the same result
      const [result1, result2, result3] = await Promise.all([request1, request2, request3])

      expect(result1).toEqual({ data: 'result' })
      expect(result2).toEqual({ data: 'result' })
      expect(result3).toEqual({ data: 'result' })

      // Network should only be called once
      expect(networkCall).toHaveBeenCalledTimes(1)
    })

    it('should track pending requests in the pending map', async () => {
      let resolveRequest: (value: unknown) => void
      const networkCall = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve
        })
      )

      // Start a request but don't await it
      const requestPromise = deduplicator.execute('find', { filter: { id: 1 } }, networkCall)

      // Should have one pending request
      expect(deduplicator.getPendingCount()).toBe(1)
      expect(deduplicator.hasPending('find', { filter: { id: 1 } })).toBe(true)

      // Resolve the request
      resolveRequest!({ data: 'result' })
      await requestPromise

      // Should have no pending requests
      expect(deduplicator.getPendingCount()).toBe(0)
      expect(deduplicator.hasPending('find', { filter: { id: 1 } })).toBe(false)
    })

    it('should return existing promise for subsequent identical requests', async () => {
      let resolveRequest: (value: unknown) => void
      const networkCall = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve
        })
      )

      // Start first request
      const promise1 = deduplicator.execute('find', { filter: { id: 1 } }, networkCall)

      // Start second identical request - should get the same promise (or one that resolves together)
      const promise2 = deduplicator.execute('find', { filter: { id: 1 } }, networkCall)

      // Network should only be called once
      expect(networkCall).toHaveBeenCalledTimes(1)

      // Both promises should be pending
      expect(deduplicator.getPendingCount()).toBe(1)

      // Resolve the request
      resolveRequest!({ data: 'shared result' })

      // Both should resolve to the same value
      const [result1, result2] = await Promise.all([promise1, promise2])
      expect(result1).toEqual({ data: 'shared result' })
      expect(result2).toEqual({ data: 'shared result' })
    })

    it('should clear cache after request completes', async () => {
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      // First batch of requests
      await deduplicator.execute('find', { filter: { id: 1 } }, networkCall)

      // Cache should be clear
      expect(deduplicator.getPendingCount()).toBe(0)

      // Second batch should trigger a new network call
      await deduplicator.execute('find', { filter: { id: 1 } }, networkCall)

      // Should have called network twice (once per batch)
      expect(networkCall).toHaveBeenCalledTimes(2)
    })

    it('should not dedupe different params', async () => {
      const networkCall = vi.fn()
        .mockResolvedValueOnce({ data: 'result1' })
        .mockResolvedValueOnce({ data: 'result2' })

      // Fire concurrent requests with different params
      const request1 = deduplicator.execute('find', { filter: { id: 1 } }, networkCall)
      const request2 = deduplicator.execute('find', { filter: { id: 2 } }, networkCall)

      const [result1, result2] = await Promise.all([request1, request2])

      expect(result1).toEqual({ data: 'result1' })
      expect(result2).toEqual({ data: 'result2' })

      // Should have two separate network calls
      expect(networkCall).toHaveBeenCalledTimes(2)
    })

    it('should not dedupe different methods with same params', async () => {
      const networkCall = vi.fn()
        .mockResolvedValueOnce({ data: 'find-result' })
        .mockResolvedValueOnce({ data: 'count-result' })

      // Fire concurrent requests with different methods
      const request1 = deduplicator.execute('find', { filter: { id: 1 } }, networkCall)
      const request2 = deduplicator.execute('count', { filter: { id: 1 } }, networkCall)

      const [result1, result2] = await Promise.all([request1, request2])

      expect(result1).toEqual({ data: 'find-result' })
      expect(result2).toEqual({ data: 'count-result' })

      // Should have two separate network calls
      expect(networkCall).toHaveBeenCalledTimes(2)
    })
  })

  describe('error handling', () => {
    it('should not cache errors', async () => {
      const error = new Error('Network failure')
      const networkCall = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ data: 'success' })

      // First request fails
      await expect(deduplicator.execute('find', { filter: { id: 1 } }, networkCall))
        .rejects.toThrow('Network failure')

      // Cache should be clear after error
      expect(deduplicator.getPendingCount()).toBe(0)

      // Retry should trigger new network call
      const result = await deduplicator.execute('find', { filter: { id: 1 } }, networkCall)

      expect(result).toEqual({ data: 'success' })
      expect(networkCall).toHaveBeenCalledTimes(2)
    })

    it('should propagate errors to all waiting requests', async () => {
      const error = new Error('Network failure')
      const networkCall = vi.fn().mockRejectedValue(error)

      // Fire 3 concurrent requests
      const request1 = deduplicator.execute('find', { filter: { id: 1 } }, networkCall)
      const request2 = deduplicator.execute('find', { filter: { id: 1 } }, networkCall)
      const request3 = deduplicator.execute('find', { filter: { id: 1 } }, networkCall)

      // All should reject with the same error
      await expect(request1).rejects.toThrow('Network failure')
      await expect(request2).rejects.toThrow('Network failure')
      await expect(request3).rejects.toThrow('Network failure')

      // Network should only be called once
      expect(networkCall).toHaveBeenCalledTimes(1)

      // Cache should be clear
      expect(deduplicator.getPendingCount()).toBe(0)
    })

    it('should clear pending entry even when error occurs', async () => {
      let rejectRequest: (error: Error) => void
      const networkCall = vi.fn().mockReturnValue(
        new Promise((_, reject) => {
          rejectRequest = reject
        })
      )

      // Start a request
      const requestPromise = deduplicator.execute('find', { filter: { id: 1 } }, networkCall)

      // Should have one pending request
      expect(deduplicator.getPendingCount()).toBe(1)

      // Reject the request
      rejectRequest!(new Error('Timeout'))

      try {
        await requestPromise
      } catch {
        // Expected to fail
      }

      // Should have no pending requests
      expect(deduplicator.getPendingCount()).toBe(0)
    })
  })

  describe('TTL-based result caching (optional)', () => {
    it('should cache successful results for TTL duration when configured', async () => {
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      const networkCall = vi.fn().mockResolvedValue({ data: 'cached result' })

      // First request
      const result1 = await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)

      // Second request immediately after (should use cache)
      const result2 = await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)

      expect(result1).toEqual({ data: 'cached result' })
      expect(result2).toEqual({ data: 'cached result' })

      // Should only have one network call due to caching
      expect(networkCall).toHaveBeenCalledTimes(1)
    })

    it('should expire cached results after TTL', async () => {
      vi.useFakeTimers()
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      const networkCall = vi.fn()
        .mockResolvedValueOnce({ data: 'result1' })
        .mockResolvedValueOnce({ data: 'result2' })

      // First request
      const result1 = await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)

      // Advance time past TTL
      vi.advanceTimersByTime(1001)

      // Second request should make a new network call
      const result2 = await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)

      expect(result1).toEqual({ data: 'result1' })
      expect(result2).toEqual({ data: 'result2' })
      expect(networkCall).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('should not cache results when TTL is not configured', async () => {
      const networkCall = vi.fn()
        .mockResolvedValueOnce({ data: 'result1' })
        .mockResolvedValueOnce({ data: 'result2' })

      // First request
      const result1 = await deduplicator.execute('find', { filter: { id: 1 } }, networkCall)

      // Second request (sequential, not concurrent)
      const result2 = await deduplicator.execute('find', { filter: { id: 1 } }, networkCall)

      expect(result1).toEqual({ data: 'result1' })
      expect(result2).toEqual({ data: 'result2' })

      // Without TTL, each sequential request makes a new network call
      expect(networkCall).toHaveBeenCalledTimes(2)
    })
  })

  describe('utility methods', () => {
    it('should provide method to clear all pending requests', async () => {
      let resolveRequest: (value: unknown) => void
      const networkCall = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve
        })
      )

      // Start a request
      deduplicator.execute('find', { filter: { id: 1 } }, networkCall)

      expect(deduplicator.getPendingCount()).toBe(1)

      // Clear all pending
      deduplicator.clear()

      expect(deduplicator.getPendingCount()).toBe(0)

      // Clean up
      resolveRequest!({ data: 'result' })
    })

    it('should provide method to clear cached results when TTL is enabled', async () => {
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      const networkCall = vi.fn().mockResolvedValue({ data: 'cached result' })

      // First request to populate cache
      await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)

      // Clear cache
      deduplicatorWithTTL.clearCache()

      // Second request should make a new network call
      await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)

      expect(networkCall).toHaveBeenCalledTimes(2)
    })

    it('should provide clearAll method to clear both pending and cache', async () => {
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      // Populate cache
      await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)

      expect(deduplicatorWithTTL.getCacheSize()).toBe(1)

      // Clear all
      deduplicatorWithTTL.clearAll()

      expect(deduplicatorWithTTL.getPendingCount()).toBe(0)
      expect(deduplicatorWithTTL.getCacheSize()).toBe(0)
    })
  })

  describe('cache statistics', () => {
    it('should track cache hits and misses', async () => {
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      // Initial stats should be zero
      let stats = deduplicatorWithTTL.getStatistics()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)

      // First request - cache miss
      await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)
      stats = deduplicatorWithTTL.getStatistics()
      expect(stats.misses).toBe(1)
      expect(stats.hits).toBe(0)

      // Second request - cache hit
      await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)
      stats = deduplicatorWithTTL.getStatistics()
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)
    })

    it('should track pending hits (deduplication)', async () => {
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      let resolveRequest: (value: unknown) => void
      const networkCall = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve
        })
      )

      // Start concurrent requests
      const promise1 = deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)
      const promise2 = deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)
      const promise3 = deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)

      // Should have 2 pending hits (requests 2 and 3 reused request 1)
      const stats = deduplicatorWithTTL.getStatistics()
      expect(stats.pendingHits).toBe(2)

      resolveRequest!({ data: 'result' })
      await Promise.all([promise1, promise2, promise3])
    })

    it('should allow resetting statistics', async () => {
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      // Generate some stats
      await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)
      await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)

      let stats = deduplicatorWithTTL.getStatistics()
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)

      // Reset stats
      deduplicatorWithTTL.resetStatistics()

      stats = deduplicatorWithTTL.getStatistics()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.pendingHits).toBe(0)
      expect(stats.evictions).toBe(0)
    })

    it('should return a copy of statistics', () => {
      const stats1 = deduplicator.getStatistics()
      const stats2 = deduplicator.getStatistics()

      // Should be equal but not the same object
      expect(stats1).toEqual(stats2)
      expect(stats1).not.toBe(stats2)
    })
  })

  describe('LRU eviction', () => {
    it('should evict least recently used entries when cache exceeds maxCacheSize', async () => {
      const deduplicatorWithLRU = new RequestDeduplicator({ ttl: 10000, maxCacheSize: 2 })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      // Fill cache to capacity
      await deduplicatorWithLRU.execute('find', { filter: { id: 1 } }, networkCall)
      await deduplicatorWithLRU.execute('find', { filter: { id: 2 } }, networkCall)

      expect(deduplicatorWithLRU.getCacheSize()).toBe(2)

      // Add third entry - should evict the first one
      await deduplicatorWithLRU.execute('find', { filter: { id: 3 } }, networkCall)

      expect(deduplicatorWithLRU.getCacheSize()).toBe(2)

      // Check that first entry was evicted
      expect(deduplicatorWithLRU.hasCached('find', { filter: { id: 1 } })).toBe(false)
      expect(deduplicatorWithLRU.hasCached('find', { filter: { id: 2 } })).toBe(true)
      expect(deduplicatorWithLRU.hasCached('find', { filter: { id: 3 } })).toBe(true)

      // Check eviction count in stats
      const stats = deduplicatorWithLRU.getStatistics()
      expect(stats.evictions).toBe(1)
    })

    it('should update LRU order on cache hit', async () => {
      const deduplicatorWithLRU = new RequestDeduplicator({ ttl: 10000, maxCacheSize: 2 })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      // Fill cache
      await deduplicatorWithLRU.execute('find', { filter: { id: 1 } }, networkCall)
      await deduplicatorWithLRU.execute('find', { filter: { id: 2 } }, networkCall)

      // Access first entry to make it most recently used
      await deduplicatorWithLRU.execute('find', { filter: { id: 1 } }, networkCall)

      // Add third entry - should evict entry 2 (now the LRU)
      await deduplicatorWithLRU.execute('find', { filter: { id: 3 } }, networkCall)

      expect(deduplicatorWithLRU.hasCached('find', { filter: { id: 1 } })).toBe(true)
      expect(deduplicatorWithLRU.hasCached('find', { filter: { id: 2 } })).toBe(false)
      expect(deduplicatorWithLRU.hasCached('find', { filter: { id: 3 } })).toBe(true)
    })
  })

  describe('custom key serializer', () => {
    it('should use custom key serializer when provided', () => {
      const customSerializer: KeySerializer = (method, params) => {
        return `custom:${method}:${typeof params}`
      }

      const deduplicatorWithSerializer = new RequestDeduplicator({
        keySerializer: customSerializer,
      })

      const key = deduplicatorWithSerializer.generateCacheKey('find', { id: 1 })
      expect(key).toBe('custom:find:object')
    })

    it('should deduplicate based on custom serializer output', async () => {
      // Serializer that ignores the 'timestamp' field
      const customSerializer: KeySerializer = (method, params) => {
        if (typeof params === 'object' && params !== null) {
          const { timestamp, ...rest } = params as Record<string, unknown>
          return `${method}:${JSON.stringify(rest)}`
        }
        return `${method}:${JSON.stringify(params)}`
      }

      const deduplicatorWithSerializer = new RequestDeduplicator({
        keySerializer: customSerializer,
      })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      // These should be deduplicated because they differ only in timestamp
      const request1 = deduplicatorWithSerializer.execute('find', { id: 1, timestamp: 100 }, networkCall)
      const request2 = deduplicatorWithSerializer.execute('find', { id: 1, timestamp: 200 }, networkCall)

      await Promise.all([request1, request2])

      // Should only call network once
      expect(networkCall).toHaveBeenCalledTimes(1)
    })
  })

  describe('debug logging', () => {
    it('should call debug logger when provided', async () => {
      const debugLogger = vi.fn()
      const deduplicatorWithDebug = new RequestDeduplicator({
        ttl: 1000,
        debug: debugLogger,
      })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      // Should log initialization
      expect(debugLogger).toHaveBeenCalledWith(
        '[RequestDeduplicator] Initialized',
        expect.objectContaining({ ttl: 1000 })
      )

      await deduplicatorWithDebug.execute('find', { filter: { id: 1 } }, networkCall)

      // Should have logged various operations
      expect(debugLogger).toHaveBeenCalledWith(
        '[RequestDeduplicator] Executing new request',
        expect.any(Object)
      )
      expect(debugLogger).toHaveBeenCalledWith(
        '[RequestDeduplicator] Cached result',
        expect.any(Object)
      )
    })

    it('should log cache hits', async () => {
      const debugLogger = vi.fn()
      const deduplicatorWithDebug = new RequestDeduplicator({
        ttl: 1000,
        debug: debugLogger,
      })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      await deduplicatorWithDebug.execute('find', { filter: { id: 1 } }, networkCall)
      debugLogger.mockClear()

      await deduplicatorWithDebug.execute('find', { filter: { id: 1 } }, networkCall)

      expect(debugLogger).toHaveBeenCalledWith(
        '[RequestDeduplicator] Cache hit',
        expect.any(Object)
      )
    })

    it('should log errors', async () => {
      const debugLogger = vi.fn()
      const deduplicatorWithDebug = new RequestDeduplicator({
        debug: debugLogger,
      })
      const networkCall = vi.fn().mockRejectedValue(new Error('Network error'))

      try {
        await deduplicatorWithDebug.execute('find', { filter: { id: 1 } }, networkCall)
      } catch {
        // Expected
      }

      expect(debugLogger).toHaveBeenCalledWith(
        '[RequestDeduplicator] Request failed',
        expect.objectContaining({ error: expect.any(String) })
      )
    })

    it('should not call logger when debug is not configured', async () => {
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      // This should not throw even though there's no logger
      await deduplicator.execute('find', { filter: { id: 1 } }, networkCall)
    })
  })

  describe('cache inspection methods', () => {
    it('should provide getCacheSize method', async () => {
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      expect(deduplicatorWithTTL.getCacheSize()).toBe(0)

      await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)
      expect(deduplicatorWithTTL.getCacheSize()).toBe(1)

      await deduplicatorWithTTL.execute('find', { filter: { id: 2 } }, networkCall)
      expect(deduplicatorWithTTL.getCacheSize()).toBe(2)
    })

    it('should provide hasCached method', async () => {
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      expect(deduplicatorWithTTL.hasCached('find', { filter: { id: 1 } })).toBe(false)

      await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)
      expect(deduplicatorWithTTL.hasCached('find', { filter: { id: 1 } })).toBe(true)
      expect(deduplicatorWithTTL.hasCached('find', { filter: { id: 2 } })).toBe(false)
    })

    it('should report expired entries as not cached', async () => {
      vi.useFakeTimers()
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)
      expect(deduplicatorWithTTL.hasCached('find', { filter: { id: 1 } })).toBe(true)

      // Advance past TTL
      vi.advanceTimersByTime(1001)
      expect(deduplicatorWithTTL.hasCached('find', { filter: { id: 1 } })).toBe(false)

      vi.useRealTimers()
    })
  })

  describe('pruneExpired', () => {
    it('should remove expired entries', async () => {
      vi.useFakeTimers()
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)
      await deduplicatorWithTTL.execute('find', { filter: { id: 2 } }, networkCall)

      expect(deduplicatorWithTTL.getCacheSize()).toBe(2)

      // Advance past TTL
      vi.advanceTimersByTime(1001)

      // Prune expired entries
      const removed = deduplicatorWithTTL.pruneExpired()
      expect(removed).toBe(2)
      expect(deduplicatorWithTTL.getCacheSize()).toBe(0)

      vi.useRealTimers()
    })

    it('should not remove non-expired entries', async () => {
      vi.useFakeTimers()
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      const networkCall = vi.fn().mockResolvedValue({ data: 'result' })

      await deduplicatorWithTTL.execute('find', { filter: { id: 1 } }, networkCall)

      // Advance time but not past TTL
      vi.advanceTimersByTime(500)

      const removed = deduplicatorWithTTL.pruneExpired()
      expect(removed).toBe(0)
      expect(deduplicatorWithTTL.getCacheSize()).toBe(1)

      vi.useRealTimers()
    })

    it('should return 0 when no entries to prune', () => {
      const deduplicatorWithTTL = new RequestDeduplicator({ ttl: 1000 })
      const removed = deduplicatorWithTTL.pruneExpired()
      expect(removed).toBe(0)
    })
  })
})
