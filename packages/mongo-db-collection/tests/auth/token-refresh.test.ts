/**
 * @file Token Refresh Manager Tests (RED Phase - TDD)
 *
 * These tests verify the TokenRefreshManager class that handles automatic
 * token refresh for authenticated connections to mongo.do.
 *
 * Tests cover:
 * 1. Constructor with refresh configuration
 * 2. Scheduling refresh before token expiry
 * 3. Calling refresh endpoint with current token
 * 4. Handling refresh failures with retry logic
 * 5. Callback notifications for new tokens
 * 6. Cancellation of scheduled refresh operations
 * 7. Exponential backoff strategy on repeated failures
 * 8. Prevention of concurrent refresh attempts
 *
 * The TokenRefreshManager ensures seamless authentication by:
 * - Automatically refreshing tokens before they expire
 * - Retrying failed refresh attempts with backoff
 * - Preventing race conditions with concurrent refreshes
 * - Notifying the application of new tokens
 *
 * RED PHASE: These tests will fail until TokenRefreshManager is implemented
 * in src/auth/token-refresh.ts
 *
 * @see https://tools.ietf.org/html/rfc6749#section-6 (OAuth 2.0 Token Refresh)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TokenRefreshManager, TokenRefreshError } from '../../src/auth/token-refresh'

// Mock fetch globally for refresh endpoint calls
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('TokenRefreshManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should construct with refresh endpoint URL', () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      expect(manager).toBeInstanceOf(TokenRefreshManager)
    })

    it('should construct with custom refresh interval', () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        refreshBeforeExpiry: 300000, // 5 minutes before expiry
      })

      expect(manager).toBeInstanceOf(TokenRefreshManager)
    })

    it('should construct with custom retry configuration', () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        maxRetries: 5,
        initialRetryDelay: 2000,
      })

      expect(manager).toBeInstanceOf(TokenRefreshManager)
    })

    it('should construct with onRefresh callback', () => {
      const onRefresh = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        onRefresh,
      })

      expect(manager).toBeInstanceOf(TokenRefreshManager)
    })

    it('should construct with onError callback', () => {
      const onError = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        onError,
      })

      expect(manager).toBeInstanceOf(TokenRefreshManager)
    })
  })

  describe('scheduleRefresh()', () => {
    it('should schedule refresh before token expiry', () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        refreshBeforeExpiry: 300000, // 5 minutes
      })

      const token = {
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 3600000, // Expires in 1 hour
      }

      manager.scheduleRefresh(token)

      // Verify refresh is scheduled
      expect(manager.isScheduled()).toBe(true)
    })

    it('should calculate correct refresh time based on expiry', () => {
      const onRefresh = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        refreshBeforeExpiry: 300000, // 5 minutes before expiry
        onRefresh,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresAt: Date.now() + 3600000,
        }),
      })

      const expiresAt = Date.now() + 3600000 // 1 hour from now
      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt,
      })

      // Fast-forward to just before refresh time (55 minutes)
      vi.advanceTimersByTime(3300000 - 1000) // 55 minutes - 1 second
      expect(mockFetch).not.toHaveBeenCalled()

      // Fast-forward past refresh time
      vi.advanceTimersByTime(2000)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should refresh immediately if token already expired', async () => {
      const onRefresh = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        onRefresh,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresAt: Date.now() + 3600000,
        }),
      })

      // Token already expired
      manager.scheduleRefresh({
        accessToken: 'expired-token',
        expiresAt: Date.now() - 1000,
      })

      // Should trigger immediately
      await vi.runAllTimersAsync()
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should cancel previous refresh when scheduling new one', () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      const token1 = {
        accessToken: 'token-1',
        expiresAt: Date.now() + 3600000,
      }

      const token2 = {
        accessToken: 'token-2',
        expiresAt: Date.now() + 7200000,
      }

      manager.scheduleRefresh(token1)
      expect(manager.isScheduled()).toBe(true)

      // Scheduling new refresh should cancel old one
      manager.scheduleRefresh(token2)
      expect(manager.isScheduled()).toBe(true)
    })

    it('should accept token with expiresIn instead of expiresAt', () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        refreshBeforeExpiry: 300000,
      })

      // Token with expiresIn (seconds)
      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresIn: 3600, // 1 hour in seconds
      })

      expect(manager.isScheduled()).toBe(true)
    })
  })

  describe('refresh()', () => {
    it('should call refresh endpoint with current token', async () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresAt: Date.now() + 3600000,
        }),
      })

      await manager.refresh('current-token-123')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.mongo.do/auth/refresh',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer current-token-123',
          }),
        })
      )
    })

    it('should return new token from refresh response', async () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      const newToken = {
        accessToken: 'new-token-456',
        expiresAt: Date.now() + 3600000,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => newToken,
      })

      const result = await manager.refresh('current-token-123')

      expect(result).toEqual(newToken)
    })

    it('should include refresh token if provided', async () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresAt: Date.now() + 3600000,
        }),
      })

      await manager.refresh('access-token', 'refresh-token-xyz')

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse((options as { body: string }).body)

      expect(body.refreshToken).toBe('refresh-token-xyz')
    })

    it('should throw on non-200 response', async () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      await expect(manager.refresh('invalid-token')).rejects.toThrow()
    })

    it('should throw on network error', async () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      await expect(manager.refresh('test-token')).rejects.toThrow('Failed to fetch')
    })
  })

  describe('retry on failure', () => {
    it('should retry on refresh failure', async () => {
      const onRefresh = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        maxRetries: 3,
        initialRetryDelay: 1000,
        onRefresh,
      })

      // First attempt fails, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accessToken: 'new-token-456',
            expiresAt: Date.now() + 3600000,
          }),
        })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 1000, // Expires soon
      })

      // Trigger immediate refresh
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(onRefresh).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'new-token-456',
        })
      )
    })

    it('should respect max retries limit', async () => {
      const onError = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        maxRetries: 2,
        initialRetryDelay: 100,
        onError,
      })

      // All attempts fail
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 100,
      })

      await vi.runAllTimersAsync()

      // Initial attempt + 2 retries = 3 total
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(onError).toHaveBeenCalled()
    })

    it('should call onError callback on exhausted retries', async () => {
      const onError = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        maxRetries: 1,
        initialRetryDelay: 100,
        onError,
      })

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 100,
      })

      await vi.runAllTimersAsync()

      expect(onError).toHaveBeenCalledWith(expect.any(Error))
      expect(onError.mock.calls[0]![0].message).toContain('Unauthorized')
    })

    it('should not retry on 4xx client errors', async () => {
      const onError = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        maxRetries: 3,
        initialRetryDelay: 100,
        onError,
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 100,
      })

      await vi.runAllTimersAsync()

      // Should fail immediately without retries
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalled()
    })

    it('should retry on network errors', async () => {
      const onRefresh = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        maxRetries: 2,
        initialRetryDelay: 100,
        onRefresh,
      })

      // First fails with network error, second succeeds
      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accessToken: 'new-token-456',
            expiresAt: Date.now() + 3600000,
          }),
        })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 100,
      })

      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(onRefresh).toHaveBeenCalled()
    })
  })

  describe('onRefresh callback', () => {
    it('should call onRefresh with new token on success', async () => {
      const onRefresh = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        onRefresh,
      })

      const newToken = {
        accessToken: 'new-token-456',
        expiresAt: Date.now() + 3600000,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => newToken,
      })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 100,
      })

      await vi.runAllTimersAsync()

      expect(onRefresh).toHaveBeenCalledTimes(1)
      expect(onRefresh).toHaveBeenCalledWith(newToken)
    })

    it('should not call onRefresh on failure', async () => {
      const onRefresh = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        maxRetries: 1,
        initialRetryDelay: 100,
        onRefresh,
      })

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 100,
      })

      await vi.runAllTimersAsync()

      expect(onRefresh).not.toHaveBeenCalled()
    })

    it('should support async onRefresh callback', async () => {
      const onRefresh = vi.fn(async (token) => {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        onRefresh,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresAt: Date.now() + 3600000,
        }),
      })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 100,
      })

      await vi.runAllTimersAsync()

      expect(onRefresh).toHaveBeenCalled()
    })
  })

  describe('cancel()', () => {
    it('should cancel scheduled refresh', () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 3600000,
      })

      expect(manager.isScheduled()).toBe(true)

      manager.cancel()

      expect(manager.isScheduled()).toBe(false)
    })

    it('should prevent scheduled refresh from executing after cancel', async () => {
      const onRefresh = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        refreshBeforeExpiry: 100,
        onRefresh,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresAt: Date.now() + 3600000,
        }),
      })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 1000,
      })

      // Cancel before refresh triggers
      manager.cancel()

      // Fast-forward past scheduled time
      await vi.runAllTimersAsync()

      expect(mockFetch).not.toHaveBeenCalled()
      expect(onRefresh).not.toHaveBeenCalled()
    })

    it('should not throw when canceling with no scheduled refresh', () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      expect(() => manager.cancel()).not.toThrow()
    })

    it('should allow scheduling after cancel', () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      manager.scheduleRefresh({
        accessToken: 'token-1',
        expiresAt: Date.now() + 3600000,
      })

      manager.cancel()
      expect(manager.isScheduled()).toBe(false)

      // Should be able to schedule again
      manager.scheduleRefresh({
        accessToken: 'token-2',
        expiresAt: Date.now() + 3600000,
      })

      expect(manager.isScheduled()).toBe(true)
    })
  })

  describe('exponential backoff', () => {
    it('should use exponential backoff for retries', async () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        maxRetries: 3,
        initialRetryDelay: 1000,
      })

      const delays: number[] = []
      let lastTime = Date.now()

      mockFetch.mockImplementation(async () => {
        const now = Date.now()
        if (mockFetch.mock.calls.length > 1) {
          delays.push(now - lastTime)
        }
        lastTime = now

        if (mockFetch.mock.calls.length < 3) {
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
          }
        }

        return {
          ok: true,
          json: async () => ({
            accessToken: 'new-token-456',
            expiresAt: Date.now() + 3600000,
          }),
        }
      })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 100,
      })

      await vi.runAllTimersAsync()

      // Should have exponential delays: 1000ms, 2000ms
      expect(delays.length).toBe(2)
      expect(delays[0]).toBeGreaterThanOrEqual(1000)
      expect(delays[1]).toBeGreaterThanOrEqual(2000)
    })

    it('should cap exponential backoff at max delay', async () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        maxRetries: 5,
        initialRetryDelay: 1000,
        maxRetryDelay: 5000, // Cap at 5 seconds
      })

      const delays: number[] = []
      let lastTime = Date.now()

      mockFetch.mockImplementation(async () => {
        const now = Date.now()
        if (mockFetch.mock.calls.length > 1) {
          delays.push(now - lastTime)
        }
        lastTime = now

        if (mockFetch.mock.calls.length < 5) {
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
          }
        }

        return {
          ok: true,
          json: async () => ({
            accessToken: 'new-token-456',
            expiresAt: Date.now() + 3600000,
          }),
        }
      })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 100,
      })

      await vi.runAllTimersAsync()

      // Delays: 1000, 2000, 4000, 5000 (capped)
      expect(delays.length).toBe(4)
      expect(delays[delays.length - 1]).toBeLessThanOrEqual(5000)
    })

    it('should support custom backoff multiplier', async () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        maxRetries: 2,
        initialRetryDelay: 1000,
        backoffMultiplier: 3, // Triple instead of double
      })

      const delays: number[] = []
      let lastTime = Date.now()

      mockFetch.mockImplementation(async () => {
        const now = Date.now()
        if (mockFetch.mock.calls.length > 1) {
          delays.push(now - lastTime)
        }
        lastTime = now

        if (mockFetch.mock.calls.length < 2) {
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
          }
        }

        return {
          ok: true,
          json: async () => ({
            accessToken: 'new-token-456',
            expiresAt: Date.now() + 3600000,
          }),
        }
      })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 100,
      })

      await vi.runAllTimersAsync()

      // With multiplier of 3: 1000ms, then should be ~3000ms
      expect(delays.length).toBe(1)
      expect(delays[0]).toBeGreaterThanOrEqual(1000)
    })
  })

  describe('concurrent refresh prevention', () => {
    it('should prevent concurrent refresh attempts', async () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      let resolveRefresh: (value: any) => void
      const refreshPromise = new Promise((resolve) => {
        resolveRefresh = resolve
      })

      mockFetch.mockImplementation(async () => {
        await refreshPromise
        return {
          ok: true,
          json: async () => ({
            accessToken: 'new-token-456',
            expiresAt: Date.now() + 3600000,
          }),
        }
      })

      // Start first refresh
      const promise1 = manager.refresh('test-token-123')

      // Try to start second refresh while first is in progress
      const promise2 = manager.refresh('test-token-123')

      // Both should resolve to the same result
      resolveRefresh!({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresAt: Date.now() + 3600000,
        }),
      })

      const [result1, result2] = await Promise.all([promise1, promise2])

      expect(result1).toEqual(result2)
      // Should only call fetch once
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should allow new refresh after previous completes', async () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresAt: Date.now() + 3600000,
        }),
      })

      // First refresh
      await manager.refresh('test-token-123')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Second refresh after first completes
      await manager.refresh('test-token-456')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should allow new refresh after previous fails', async () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        maxRetries: 0,
      })

      // First refresh fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(manager.refresh('test-token-123')).rejects.toThrow()
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Second refresh should be allowed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresAt: Date.now() + 3600000,
        }),
      })

      await manager.refresh('test-token-123')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('edge cases', () => {
    it('should handle missing expiresAt in refresh response', async () => {
      const onRefresh = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        onRefresh,
      })

      // Response with only accessToken, no expiresAt
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
        }),
      })

      const result = await manager.refresh('test-token-123')

      expect(result.accessToken).toBe('new-token-456')
      expect(onRefresh).toHaveBeenCalled()
    })

    it('should handle refresh response with expiresIn', async () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      const now = Date.now()
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresIn: 3600, // 1 hour in seconds
        }),
      })

      const result = await manager.refresh('test-token-123')

      expect(result.accessToken).toBe('new-token-456')
      // Should convert expiresIn to expiresAt
      expect(result.expiresAt).toBeGreaterThanOrEqual(now + 3600000)
    })

    it('should handle very short token lifetimes', () => {
      const onRefresh = vi.fn()
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
        refreshBeforeExpiry: 5000, // 5 seconds
        onRefresh,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresAt: Date.now() + 3600000,
        }),
      })

      // Token expires in 3 seconds (less than refresh buffer)
      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 3000,
      })

      // Should schedule immediate refresh
      expect(manager.isScheduled()).toBe(true)
    })

    it('should clean up resources on manager destruction', () => {
      const manager = new TokenRefreshManager({
        refreshUrl: 'https://api.mongo.do/auth/refresh',
      })

      manager.scheduleRefresh({
        accessToken: 'test-token-123',
        expiresAt: Date.now() + 3600000,
      })

      expect(manager.isScheduled()).toBe(true)

      // Call destroy/cleanup method
      manager.destroy()

      expect(manager.isScheduled()).toBe(false)
    })
  })
})

describe('TokenRefreshManager Types', () => {
  it('should export proper TypeScript types', () => {
    const config = {
      refreshUrl: 'https://api.mongo.do/auth/refresh',
      maxRetries: 3,
      initialRetryDelay: 1000,
      refreshBeforeExpiry: 300000,
      onRefresh: (token: any) => {},
      onError: (error: Error) => {},
    }

    const manager: TokenRefreshManager = new TokenRefreshManager(config)

    expect(manager).toBeInstanceOf(TokenRefreshManager)
  })
})

describe('RefreshMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should track successful refreshes', async () => {
    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
    })

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        accessToken: 'new-token-456',
        expiresAt: Date.now() + 3600000,
      }),
    })

    // Initial metrics should be zero
    let metrics = manager.getMetrics()
    expect(metrics.successCount).toBe(0)
    expect(metrics.failureCount).toBe(0)
    expect(metrics.lastRefreshAt).toBeUndefined()

    // Perform successful refresh
    await manager.refresh('test-token-123')

    metrics = manager.getMetrics()
    expect(metrics.successCount).toBe(1)
    expect(metrics.failureCount).toBe(0)
    expect(metrics.lastRefreshAt).toBeDefined()
    expect(metrics.lastRefreshAt).toBeGreaterThan(0)
  })

  it('should track failed refreshes after retries exhausted', async () => {
    const onError = vi.fn()
    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
      maxRetries: 1,
      initialRetryDelay: 100,
      onError,
    })

    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    manager.scheduleRefresh({
      accessToken: 'test-token-123',
      expiresAt: Date.now() + 100,
    })

    await vi.runAllTimersAsync()

    const metrics = manager.getMetrics()
    expect(metrics.failureCount).toBe(1)
    expect(metrics.lastFailureAt).toBeDefined()
    expect(metrics.lastFailureAt).toBeGreaterThan(0)
  })

  it('should track total retry attempts', async () => {
    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
      maxRetries: 3,
      initialRetryDelay: 100,
    })

    // Fail twice, succeed on third attempt
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresAt: Date.now() + 3600000,
        }),
      })

    manager.scheduleRefresh({
      accessToken: 'test-token-123',
      expiresAt: Date.now() + 100,
    })

    await vi.runAllTimersAsync()

    const metrics = manager.getMetrics()
    expect(metrics.successCount).toBe(1)
    expect(metrics.totalRetryAttempts).toBeGreaterThan(0)
  })

  it('should reset metrics when requested', async () => {
    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
    })

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        accessToken: 'new-token-456',
        expiresAt: Date.now() + 3600000,
      }),
    })

    await manager.refresh('test-token-123')

    let metrics = manager.getMetrics()
    expect(metrics.successCount).toBe(1)

    manager.resetMetrics()

    metrics = manager.getMetrics()
    expect(metrics.successCount).toBe(0)
    expect(metrics.failureCount).toBe(0)
    expect(metrics.lastRefreshAt).toBeUndefined()
  })
})

describe('Jitter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should add jitter to scheduled refresh timing', () => {
    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
      refreshBeforeExpiry: 60000,
      jitterMs: 5000, // 5 seconds of jitter
    })

    // Schedule with jitter - the timing will vary
    manager.scheduleRefresh({
      accessToken: 'test-token-123',
      expiresAt: Date.now() + 3600000,
    })

    expect(manager.isScheduled()).toBe(true)
  })

  it('should work with zero jitter', () => {
    const onRefresh = vi.fn()
    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
      refreshBeforeExpiry: 300000,
      jitterMs: 0, // No jitter
      onRefresh,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'new-token-456',
        expiresAt: Date.now() + 3600000,
      }),
    })

    const expiresAt = Date.now() + 3600000 // 1 hour
    manager.scheduleRefresh({
      accessToken: 'test-token-123',
      expiresAt,
    })

    expect(manager.isScheduled()).toBe(true)
  })
})

describe('Custom refresh request builder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should use custom request builder when provided', async () => {
    const customBuilder = vi.fn().mockReturnValue({
      url: 'https://custom.auth.com/token',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Custom-Header': 'custom-value',
      },
      body: 'grant_type=refresh_token&token=test',
    })

    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
      buildRefreshRequest: customBuilder,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'new-token-456',
        expiresAt: Date.now() + 3600000,
      }),
    })

    await manager.refresh('test-token-123', 'refresh-token-xyz')

    expect(customBuilder).toHaveBeenCalledWith({
      accessToken: 'test-token-123',
      refreshToken: 'refresh-token-xyz',
      refreshUrl: 'https://api.mongo.do/auth/refresh',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom.auth.com/token',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Custom-Header': 'custom-value',
        }),
        body: 'grant_type=refresh_token&token=test',
      })
    )
  })
})

describe('Lifecycle hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should call beforeRefresh hook before each attempt', async () => {
    const beforeRefresh = vi.fn()
    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
      beforeRefresh,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'new-token-456',
        expiresAt: Date.now() + 3600000,
      }),
    })

    await manager.refresh('test-token-123', 'refresh-token-xyz')

    expect(beforeRefresh).toHaveBeenCalledTimes(1)
    expect(beforeRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'test-token-123',
        refreshToken: 'refresh-token-xyz',
        isRetry: false,
        attemptNumber: 0,
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('should call afterRefresh hook after successful refresh', async () => {
    const afterRefresh = vi.fn()
    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
      afterRefresh,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'new-token-456',
        expiresAt: Date.now() + 3600000,
      }),
    })

    await manager.refresh('test-token-123')

    expect(afterRefresh).toHaveBeenCalledTimes(1)
    expect(afterRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'test-token-123',
        isRetry: false,
        attemptNumber: 0,
        newToken: expect.objectContaining({
          accessToken: 'new-token-456',
        }),
        durationMs: expect.any(Number),
      })
    )
  })

  it('should support async lifecycle hooks', async () => {
    const beforeRefresh = vi.fn(async () => {
      // Simulate async operation without using setTimeout (since fake timers are active)
      await Promise.resolve()
    })
    const afterRefresh = vi.fn(async () => {
      // Simulate async operation without using setTimeout (since fake timers are active)
      await Promise.resolve()
    })

    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
      beforeRefresh,
      afterRefresh,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'new-token-456',
        expiresAt: Date.now() + 3600000,
      }),
    })

    await manager.refresh('test-token-123')

    expect(beforeRefresh).toHaveBeenCalled()
    expect(afterRefresh).toHaveBeenCalled()
  })

  it('should pass isRetry=true for retry attempts in scheduled refresh', async () => {
    const beforeRefresh = vi.fn()
    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
      maxRetries: 2,
      initialRetryDelay: 100,
      beforeRefresh,
    })

    // First attempt fails, second succeeds
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'new-token-456',
          expiresAt: Date.now() + 3600000,
        }),
      })

    manager.scheduleRefresh({
      accessToken: 'test-token-123',
      expiresAt: Date.now() + 100,
    })

    await vi.runAllTimersAsync()

    // Should have been called twice (initial + retry)
    expect(beforeRefresh).toHaveBeenCalledTimes(2)

    // First call should have isRetry=false
    expect(beforeRefresh.mock.calls[0]![0]).toMatchObject({
      isRetry: false,
      attemptNumber: 0,
    })

    // Second call should have isRetry=true
    expect(beforeRefresh.mock.calls[1]![0]).toMatchObject({
      isRetry: true,
      attemptNumber: 1,
    })
  })
})

describe('AbortController cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should clean up AbortController after successful refresh', async () => {
    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'new-token-456',
        expiresAt: Date.now() + 3600000,
      }),
    })

    await manager.refresh('test-token-123')

    // After successful refresh, calling cancel should not throw
    expect(() => manager.cancel()).not.toThrow()
  })

  it('should clean up AbortController after failed refresh', async () => {
    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
    })

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    await expect(manager.refresh('test-token-123')).rejects.toThrow()

    // After failed refresh, calling cancel should not throw
    expect(() => manager.cancel()).not.toThrow()
  })

  it('should abort scheduled refresh when destroy is called', async () => {
    const onRefresh = vi.fn()
    const manager = new TokenRefreshManager({
      refreshUrl: 'https://api.mongo.do/auth/refresh',
      onRefresh,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'new-token-456',
        expiresAt: Date.now() + 3600000,
      }),
    })

    manager.scheduleRefresh({
      accessToken: 'test-token-123',
      expiresAt: Date.now() + 1000,
    })

    // Destroy before refresh triggers
    manager.destroy()

    // Fast-forward past scheduled time
    await vi.runAllTimersAsync()

    expect(mockFetch).not.toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()
  })
})

describe('TokenRefreshError', () => {
  it('should identify client errors as non-retryable', () => {
    const error = new TokenRefreshError('Unauthorized', 401, 'Unauthorized')

    expect(error.isClientError).toBe(true)
    expect(error.isRetryable).toBe(false)
  })

  it('should identify server errors as retryable', () => {
    const error = new TokenRefreshError('Internal Server Error', 500, 'Internal Server Error')

    expect(error.isClientError).toBe(false)
    expect(error.isRetryable).toBe(true)
  })

  it('should identify network errors (no status) as retryable', () => {
    const error = new TokenRefreshError('Network error')

    expect(error.isClientError).toBe(false)
    expect(error.isRetryable).toBe(true)
  })
})
