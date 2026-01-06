/**
 * @file Request Retry Tests (RED Phase - TDD)
 *
 * These tests verify the RequestRetry class for Layer 11: Reconnection/Resilience.
 * The RequestRetry module provides:
 * - Automatic retry of failed requests
 * - Exponential backoff with configurable parameters
 * - Maximum retry limits
 * - Retry condition customization
 * - Jitter for distributed system friendliness
 * - Retry event callbacks for monitoring
 *
 * RED PHASE: These tests will fail until RequestRetry is implemented
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  RequestRetry,
  type RequestRetryConfig,
  type RetryableError,
  createDefaultRetryConfig,
  isRetryableError,
} from '../../src/rpc/request-retry'

describe('RequestRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // ===========================================================================
  // Constructor and Configuration Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should construct with default configuration', () => {
      const retry = new RequestRetry()

      expect(retry).toBeInstanceOf(RequestRetry)
      expect(retry.getConfig()).toBeDefined()
    })

    it('should construct with custom configuration', () => {
      const config: RequestRetryConfig = {
        maxRetries: 5,
        baseDelayMs: 500,
        maxDelayMs: 30000,
        exponentialBackoff: true,
        jitterFactor: 0.2,
      }

      const retry = new RequestRetry(config)

      expect(retry.getConfig().maxRetries).toBe(5)
      expect(retry.getConfig().baseDelayMs).toBe(500)
      expect(retry.getConfig().maxDelayMs).toBe(30000)
      expect(retry.getConfig().exponentialBackoff).toBe(true)
      expect(retry.getConfig().jitterFactor).toBe(0.2)
    })

    it('should merge partial config with defaults', () => {
      const retry = new RequestRetry({ maxRetries: 10 })

      expect(retry.getConfig().maxRetries).toBe(10)
      // Other values should be defaults
      expect(retry.getConfig().baseDelayMs).toBeDefined()
      expect(retry.getConfig().exponentialBackoff).toBeDefined()
    })
  })

  // ===========================================================================
  // createDefaultRetryConfig Tests
  // ===========================================================================

  describe('createDefaultRetryConfig', () => {
    it('should return sensible default values', () => {
      const config = createDefaultRetryConfig()

      expect(config.maxRetries).toBe(3)
      expect(config.baseDelayMs).toBe(1000)
      expect(config.maxDelayMs).toBe(30000)
      expect(config.exponentialBackoff).toBe(true)
      expect(config.jitterFactor).toBe(0.1)
    })
  })

  // ===========================================================================
  // execute() - Core Retry Logic Tests
  // ===========================================================================

  describe('execute()', () => {
    it('should execute a successful operation without retries', async () => {
      const retry = new RequestRetry()
      const operation = vi.fn().mockResolvedValue('success')

      const result = await retry.execute(operation)

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should retry a failed operation until success', async () => {
      const retry = new RequestRetry({ maxRetries: 3, baseDelayMs: 100 })
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValue('success')

      const resultPromise = retry.execute(operation)

      // Advance timers to allow retries
      await vi.advanceTimersByTimeAsync(100) // First retry
      await vi.advanceTimersByTimeAsync(200) // Second retry (exponential)

      const result = await resultPromise

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it('should throw after exhausting all retries', async () => {
      const retry = new RequestRetry({ maxRetries: 2, baseDelayMs: 100 })
      const error = new Error('Persistent failure')
      const operation = vi.fn().mockRejectedValue(error)

      const resultPromise = retry.execute(operation)
      resultPromise.catch(() => {}) // Prevent unhandled rejection

      // Advance through all retries
      await vi.advanceTimersByTimeAsync(100) // First retry
      await vi.advanceTimersByTimeAsync(200) // Second retry

      await expect(resultPromise).rejects.toThrow('Persistent failure')
      expect(operation).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })

    it('should pass attempt number to operation', async () => {
      const retry = new RequestRetry({ maxRetries: 2, baseDelayMs: 100 })
      const operation = vi.fn((attempt: number) => {
        if (attempt < 2) {
          throw new Error('Not yet')
        }
        return Promise.resolve('success')
      })

      const resultPromise = retry.execute(operation)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(200)

      const result = await resultPromise

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledWith(0)
      expect(operation).toHaveBeenCalledWith(1)
      expect(operation).toHaveBeenCalledWith(2)
    })
  })

  // ===========================================================================
  // Exponential Backoff Tests
  // ===========================================================================

  describe('exponential backoff', () => {
    it('should apply exponential backoff between retries', async () => {
      const retry = new RequestRetry({
        maxRetries: 3,
        baseDelayMs: 100,
        exponentialBackoff: true,
        jitterFactor: 0, // No jitter for predictable timing
      })

      const delays: number[] = []
      let lastTime = Date.now()

      const operation = vi.fn().mockImplementation(() => {
        const now = Date.now()
        if (lastTime !== now) {
          delays.push(now - lastTime)
          lastTime = now
        }
        throw new Error('fail')
      })

      const resultPromise = retry.execute(operation)
      resultPromise.catch(() => {})

      // Expected delays: 100, 200, 400 (base * 2^attempt)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(200)
      await vi.advanceTimersByTimeAsync(400)

      try {
        await resultPromise
      } catch {
        // Expected
      }

      expect(operation).toHaveBeenCalledTimes(4)
    })

    it('should cap delay at maxDelayMs', async () => {
      const retry = new RequestRetry({
        maxRetries: 5,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        exponentialBackoff: true,
        jitterFactor: 0,
      })

      // With base 1000 and exponential: 1000, 2000, 4000, 8000 (capped at 5000), 16000 (capped at 5000)
      const operation = vi.fn().mockRejectedValue(new Error('fail'))

      const resultPromise = retry.execute(operation)
      resultPromise.catch(() => {})

      // Advance through retries - max delay should be 5000
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(2000)
      await vi.advanceTimersByTimeAsync(4000)
      await vi.advanceTimersByTimeAsync(5000) // Capped
      await vi.advanceTimersByTimeAsync(5000) // Capped

      try {
        await resultPromise
      } catch {
        // Expected
      }

      expect(operation).toHaveBeenCalledTimes(6)
    })

    it('should use linear backoff when exponentialBackoff is false', async () => {
      const retry = new RequestRetry({
        maxRetries: 2,
        baseDelayMs: 100,
        exponentialBackoff: false,
        jitterFactor: 0,
      })

      const operation = vi.fn().mockRejectedValue(new Error('fail'))

      const resultPromise = retry.execute(operation)
      resultPromise.catch(() => {})

      // Should wait 100ms between each retry
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      try {
        await resultPromise
      } catch {
        // Expected
      }

      expect(operation).toHaveBeenCalledTimes(3)
    })
  })

  // ===========================================================================
  // Jitter Tests
  // ===========================================================================

  describe('jitter', () => {
    it('should add jitter to delay when jitterFactor is set', async () => {
      const retry = new RequestRetry({
        maxRetries: 1,
        baseDelayMs: 1000,
        exponentialBackoff: false,
        jitterFactor: 0.5, // 50% jitter
      })

      // Mock Math.random to return 0.5
      vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const operation = vi.fn().mockRejectedValue(new Error('fail'))

      const resultPromise = retry.execute(operation)
      resultPromise.catch(() => {})

      // With 50% jitter and random=0.5, delay should be within range
      // baseDelay * (1 - jitter/2 + random*jitter) = 1000 * (1 - 0.25 + 0.25) = 1000
      await vi.advanceTimersByTimeAsync(1000)

      try {
        await resultPromise
      } catch {
        // Expected
      }

      expect(operation).toHaveBeenCalledTimes(2)
    })

    it('should have no jitter when jitterFactor is 0', async () => {
      const retry = new RequestRetry({
        maxRetries: 1,
        baseDelayMs: 100,
        exponentialBackoff: false,
        jitterFactor: 0,
      })

      const operation = vi.fn().mockRejectedValue(new Error('fail'))

      const resultPromise = retry.execute(operation)
      resultPromise.catch(() => {})

      await vi.advanceTimersByTimeAsync(100)

      try {
        await resultPromise
      } catch {
        // Expected
      }

      expect(operation).toHaveBeenCalledTimes(2)
    })
  })

  // ===========================================================================
  // Custom Retry Condition Tests
  // ===========================================================================

  describe('retry conditions', () => {
    it('should respect shouldRetry callback', async () => {
      const shouldRetry = vi.fn().mockReturnValue(false)
      const retry = new RequestRetry({
        maxRetries: 3,
        baseDelayMs: 100,
        shouldRetry,
      })

      const error = new Error('Do not retry this')
      const operation = vi.fn().mockRejectedValue(error)

      await expect(retry.execute(operation)).rejects.toThrow('Do not retry this')

      expect(shouldRetry).toHaveBeenCalledWith(error, 0)
      expect(operation).toHaveBeenCalledTimes(1) // No retries
    })

    it('should conditionally retry based on shouldRetry', async () => {
      const shouldRetry = vi.fn().mockImplementation((error: Error) => {
        return error.message.includes('please')
      })

      const retry = new RequestRetry({
        maxRetries: 3,
        baseDelayMs: 100,
        shouldRetry,
      })

      // First fails with retryable, then fails with non-retryable
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('please retry'))
        .mockRejectedValueOnce(new Error('do not retry'))

      const resultPromise = retry.execute(operation)
      resultPromise.catch(() => {})

      await vi.advanceTimersByTimeAsync(100)

      await expect(resultPromise).rejects.toThrow('do not retry')
      expect(operation).toHaveBeenCalledTimes(2)
    })

    it('should not retry when maxRetries is 0', async () => {
      const retry = new RequestRetry({ maxRetries: 0 })
      const operation = vi.fn().mockRejectedValue(new Error('fail'))

      await expect(retry.execute(operation)).rejects.toThrow('fail')
      expect(operation).toHaveBeenCalledTimes(1)
    })
  })

  // ===========================================================================
  // isRetryableError Helper Tests
  // ===========================================================================

  describe('isRetryableError', () => {
    it('should return true for network errors', () => {
      const error = new TypeError('Failed to fetch')
      expect(isRetryableError(error)).toBe(true)
    })

    it('should return true for errors with retryable property', () => {
      const error = new Error('Server error') as RetryableError
      error.retryable = true
      expect(isRetryableError(error)).toBe(true)
    })

    it('should return false for errors marked as non-retryable', () => {
      const error = new Error('Client error') as RetryableError
      error.retryable = false
      expect(isRetryableError(error)).toBe(false)
    })

    it('should return true for timeout errors', () => {
      const error = new Error('Request timeout')
      ;(error as any).code = 'ETIMEDOUT'
      expect(isRetryableError(error)).toBe(true)
    })

    it('should return true for connection refused errors', () => {
      const error = new Error('Connection refused')
      ;(error as any).code = 'ECONNREFUSED'
      expect(isRetryableError(error)).toBe(true)
    })

    it('should return true for connection reset errors', () => {
      const error = new Error('Connection reset')
      ;(error as any).code = 'ECONNRESET'
      expect(isRetryableError(error)).toBe(true)
    })

    it('should return false for validation errors', () => {
      const error = new Error('Invalid parameters')
      expect(isRetryableError(error)).toBe(false)
    })
  })

  // ===========================================================================
  // Event Callbacks Tests
  // ===========================================================================

  describe('event callbacks', () => {
    it('should call onRetry callback before each retry', async () => {
      const onRetry = vi.fn()
      const retry = new RequestRetry({
        maxRetries: 2,
        baseDelayMs: 100,
        onRetry,
      })

      const error = new Error('fail')
      const operation = vi.fn().mockRejectedValue(error)

      const resultPromise = retry.execute(operation)
      resultPromise.catch(() => {})

      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(200)

      try {
        await resultPromise
      } catch {
        // Expected
      }

      expect(onRetry).toHaveBeenCalledTimes(2)
      expect(onRetry).toHaveBeenCalledWith({
        attempt: 1,
        error,
        delay: expect.any(Number),
      })
      expect(onRetry).toHaveBeenCalledWith({
        attempt: 2,
        error,
        delay: expect.any(Number),
      })
    })

    it('should call onSuccess callback on successful execution', async () => {
      const onSuccess = vi.fn()
      const retry = new RequestRetry({
        maxRetries: 3,
        onSuccess,
      })

      const operation = vi.fn().mockResolvedValue('result')

      await retry.execute(operation)

      expect(onSuccess).toHaveBeenCalledWith({
        result: 'result',
        attempts: 1,
      })
    })

    it('should call onSuccess with retry count after retries', async () => {
      const onSuccess = vi.fn()
      const retry = new RequestRetry({
        maxRetries: 3,
        baseDelayMs: 100,
        onSuccess,
      })

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('result')

      const resultPromise = retry.execute(operation)
      await vi.advanceTimersByTimeAsync(100)

      await resultPromise

      expect(onSuccess).toHaveBeenCalledWith({
        result: 'result',
        attempts: 2,
      })
    })

    it('should call onExhausted callback when retries are exhausted', async () => {
      const onExhausted = vi.fn()
      const retry = new RequestRetry({
        maxRetries: 2,
        baseDelayMs: 100,
        onExhausted,
      })

      const error = new Error('persistent failure')
      const operation = vi.fn().mockRejectedValue(error)

      const resultPromise = retry.execute(operation)
      resultPromise.catch(() => {})

      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(200)

      try {
        await resultPromise
      } catch {
        // Expected
      }

      expect(onExhausted).toHaveBeenCalledWith({
        error,
        attempts: 3,
      })
    })
  })

  // ===========================================================================
  // Abort/Cancel Tests
  // ===========================================================================

  describe('abort support', () => {
    it('should abort retry loop when signal is aborted', async () => {
      const retry = new RequestRetry({
        maxRetries: 5,
        baseDelayMs: 1000,
      })

      const controller = new AbortController()
      const operation = vi.fn().mockRejectedValue(new Error('fail'))

      const resultPromise = retry.execute(operation, { signal: controller.signal })
      resultPromise.catch(() => {})

      // Abort after first retry starts
      await vi.advanceTimersByTimeAsync(500)
      controller.abort()
      await vi.advanceTimersByTimeAsync(500)

      await expect(resultPromise).rejects.toThrow()
      // Should have stopped retrying after abort
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should throw AbortError when aborted', async () => {
      const retry = new RequestRetry({ maxRetries: 3, baseDelayMs: 100 })
      const controller = new AbortController()
      const operation = vi.fn().mockRejectedValue(new Error('fail'))

      controller.abort('User cancelled')

      await expect(
        retry.execute(operation, { signal: controller.signal })
      ).rejects.toThrow()
    })

    it('should check abort signal before each retry', async () => {
      const retry = new RequestRetry({
        maxRetries: 5,
        baseDelayMs: 100,
      })

      const controller = new AbortController()
      const operation = vi.fn().mockRejectedValue(new Error('fail'))

      const resultPromise = retry.execute(operation, { signal: controller.signal })
      resultPromise.catch(() => {})

      // First attempt
      expect(operation).toHaveBeenCalledTimes(1)

      // Wait for first retry delay, then abort
      await vi.advanceTimersByTimeAsync(100)
      expect(operation).toHaveBeenCalledTimes(2)

      controller.abort()

      // Should not continue with more retries
      await vi.advanceTimersByTimeAsync(200)

      try {
        await resultPromise
      } catch {
        // Expected
      }

      expect(operation).toHaveBeenCalledTimes(2) // No more after abort
    })
  })

  // ===========================================================================
  // Utility Methods Tests
  // ===========================================================================

  describe('utility methods', () => {
    it('should calculate delay for a given attempt', () => {
      const retry = new RequestRetry({
        baseDelayMs: 100,
        exponentialBackoff: true,
        jitterFactor: 0,
      })

      expect(retry.calculateDelay(0)).toBe(100)
      expect(retry.calculateDelay(1)).toBe(200)
      expect(retry.calculateDelay(2)).toBe(400)
      expect(retry.calculateDelay(3)).toBe(800)
    })

    it('should respect maxDelayMs in calculateDelay', () => {
      const retry = new RequestRetry({
        baseDelayMs: 1000,
        maxDelayMs: 3000,
        exponentialBackoff: true,
        jitterFactor: 0,
      })

      expect(retry.calculateDelay(0)).toBe(1000)
      expect(retry.calculateDelay(1)).toBe(2000)
      expect(retry.calculateDelay(2)).toBe(3000) // Capped
      expect(retry.calculateDelay(3)).toBe(3000) // Capped
    })

    it('should allow updating config', () => {
      const retry = new RequestRetry({ maxRetries: 3 })

      retry.updateConfig({ maxRetries: 5, baseDelayMs: 500 })

      expect(retry.getConfig().maxRetries).toBe(5)
      expect(retry.getConfig().baseDelayMs).toBe(500)
    })
  })

  // ===========================================================================
  // Static Helper Method Tests
  // ===========================================================================

  describe('static helpers', () => {
    it('should provide withRetry static method for quick usage', async () => {
      const operation = vi.fn().mockResolvedValue('success')

      const result = await RequestRetry.withRetry(operation, { maxRetries: 3 })

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should retry with default config using static method', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success')

      const resultPromise = RequestRetry.withRetry(operation)

      await vi.advanceTimersByTimeAsync(1000) // Default base delay

      const result = await resultPromise

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(2)
    })
  })
})

describe('RequestRetry Types', () => {
  it('should export proper TypeScript types', () => {
    // Type verification test
    const config: RequestRetryConfig = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      exponentialBackoff: true,
      jitterFactor: 0.1,
      shouldRetry: (error) => error.message.includes('retry'),
      onRetry: ({ attempt, error, delay }) => {
        console.log(`Retry ${attempt} after ${delay}ms: ${error.message}`)
      },
      onSuccess: ({ result, attempts }) => {
        console.log(`Success after ${attempts} attempts: ${result}`)
      },
      onExhausted: ({ error, attempts }) => {
        console.log(`Exhausted after ${attempts} attempts: ${error.message}`)
      },
    }

    const retry = new RequestRetry(config)
    expect(retry).toBeInstanceOf(RequestRetry)
  })
})
