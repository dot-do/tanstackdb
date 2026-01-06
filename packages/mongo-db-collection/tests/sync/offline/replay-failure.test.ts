/**
 * @file Replay Failure Handler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the replay failure handler that handles errors
 * during offline mutation replay and provides retry/skip options.
 *
 * The replay failure handler is used when the application comes back online
 * and needs to replay offline mutations to the server. When errors occur,
 * it provides configurable retry strategies and the ability to skip
 * problematic mutations.
 *
 * RED PHASE: These tests will fail until the replay failure handler is implemented
 * in src/sync/offline/replay-failure.ts
 *
 * Bead ID: po0.218
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createReplayFailureHandler,
  ReplayFailureHandler,
  handleReplayFailure,
  type ReplayFailureHandlerConfig,
  type ReplayFailure,
  type ReplayFailureResult,
  type RetryStrategy,
  type FailedMutation,
  type ReplayFailureContext,
  type FailureResolution,
} from '../../../src/sync/offline/replay-failure'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing replay failures.
 */
interface TestDocument {
  _id: string
  name: string
  value: number
  createdAt: Date
}

/**
 * Mock mutation for testing.
 */
interface MockMutation<T = TestDocument> {
  mutationId: string
  type: 'insert' | 'update' | 'delete'
  key: string
  modified: T
  original: Partial<T>
  changes: Partial<T>
  metadata?: Record<string, unknown>
  timestamp: Date
  retryCount: number
}

// =============================================================================
// Mock RPC Client
// =============================================================================

interface MockRpcClient {
  rpc: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  isConnected: ReturnType<typeof vi.fn>
}

function createMockRpcClient(): MockRpcClient {
  return {
    rpc: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  }
}

// =============================================================================
// Test Helper Functions
// =============================================================================

function createMockMutation<T extends TestDocument>(
  overrides: Partial<MockMutation<T>> = {}
): MockMutation<T> {
  return {
    mutationId: `mut-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'insert',
    key: 'doc-1',
    modified: {
      _id: 'doc-1',
      name: 'Test Document',
      value: 42,
      createdAt: new Date(),
    } as T,
    original: {},
    changes: {},
    metadata: {},
    timestamp: new Date(),
    retryCount: 0,
    ...overrides,
  }
}

function createReplayFailure<T = TestDocument>(
  mutation: MockMutation<T>,
  error: Error,
  overrides: Partial<ReplayFailure<T>> = {}
): ReplayFailure<T> {
  return {
    mutation: mutation as FailedMutation<T>,
    error,
    timestamp: new Date(),
    attemptNumber: 1,
    ...overrides,
  }
}

// =============================================================================
// Handler Factory Tests
// =============================================================================

describe('createReplayFailureHandler', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createReplayFailureHandler).toBe('function')
    })

    it('should return a ReplayFailureHandler instance', () => {
      const handler = createReplayFailureHandler({
        maxRetries: 3,
        retryStrategy: 'exponential-backoff',
      })

      expect(handler).toBeDefined()
      expect(typeof handler.handleFailure).toBe('function')
      expect(typeof handler.getFailedMutations).toBe('function')
      expect(typeof handler.retryFailed).toBe('function')
      expect(typeof handler.skipMutation).toBe('function')
      expect(typeof handler.clearFailed).toBe('function')
    })

    it('should accept default configuration', () => {
      const handler = createReplayFailureHandler({})

      expect(handler).toBeDefined()
    })

    it('should accept custom retry strategy', () => {
      const customStrategy: RetryStrategy = {
        type: 'custom',
        getDelay: (attemptNumber: number) => attemptNumber * 500,
        shouldRetry: (error: Error, attemptNumber: number) => attemptNumber < 5,
      }

      const handler = createReplayFailureHandler({
        retryStrategy: customStrategy,
      })

      expect(handler).toBeDefined()
    })

    it('should validate maxRetries is non-negative', () => {
      expect(() =>
        createReplayFailureHandler({
          maxRetries: -1,
        })
      ).toThrow('maxRetries must be non-negative')
    })
  })

  describe('handleFailure', () => {
    let handler: ReplayFailureHandler<TestDocument>

    beforeEach(() => {
      handler = createReplayFailureHandler<TestDocument>({
        maxRetries: 3,
        retryStrategy: 'exponential-backoff',
      })
    })

    it('should record a failed mutation', async () => {
      const mutation = createMockMutation()
      const error = new Error('Network error')

      const result = await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
      })

      expect(result.recorded).toBe(true)
      expect(result.mutationId).toBe(mutation.mutationId)
    })

    it('should track retry count', async () => {
      const mutation = createMockMutation()
      const error = new Error('Network error')

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
      })

      const failed = handler.getFailedMutations()
      expect(failed).toHaveLength(1)
      expect(failed[0].attemptNumber).toBe(1)
    })

    it('should increment attempt number on repeated failures', async () => {
      const mutation = createMockMutation()
      const error = new Error('Network error')

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
      })

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
      })

      const failed = handler.getFailedMutations()
      expect(failed).toHaveLength(1)
      expect(failed[0].attemptNumber).toBe(2)
    })

    it('should call onFailure callback when provided', async () => {
      const onFailure = vi.fn()
      const handlerWithCallback = createReplayFailureHandler<TestDocument>({
        maxRetries: 3,
        onFailure,
      })

      const mutation = createMockMutation()
      const error = new Error('Network error')

      await handlerWithCallback.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
      })

      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          mutation: expect.objectContaining({
            mutationId: mutation.mutationId,
          }),
          error,
        })
      )
    })

    it('should categorize errors by type', async () => {
      const mutation = createMockMutation()

      // Network error
      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Network timeout'),
      })

      const failed = handler.getFailedMutations()
      expect(failed[0].errorCategory).toBe('network')
    })

    it('should categorize conflict errors', async () => {
      const mutation = createMockMutation({ mutationId: 'mut-conflict' })

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Conflict: document has been modified'),
      })

      const failed = handler.getFailedMutations()
      const conflictFailure = failed.find((f: ReplayFailure<TestDocument>) => f.mutation.mutationId === 'mut-conflict')
      expect(conflictFailure?.errorCategory).toBe('conflict')
    })

    it('should categorize validation errors', async () => {
      const mutation = createMockMutation({ mutationId: 'mut-validation' })

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Validation failed: invalid document'),
      })

      const failed = handler.getFailedMutations()
      const validationFailure = failed.find((f: ReplayFailure<TestDocument>) => f.mutation.mutationId === 'mut-validation')
      expect(validationFailure?.errorCategory).toBe('validation')
    })
  })

  describe('getFailedMutations', () => {
    let handler: ReplayFailureHandler<TestDocument>

    beforeEach(() => {
      handler = createReplayFailureHandler<TestDocument>({
        maxRetries: 3,
      })
    })

    it('should return empty array when no failures', () => {
      const failed = handler.getFailedMutations()
      expect(failed).toEqual([])
    })

    it('should return all failed mutations', async () => {
      const mutation1 = createMockMutation({ mutationId: 'mut-1' })
      const mutation2 = createMockMutation({ mutationId: 'mut-2' })

      await handler.handleFailure({
        mutation: mutation1 as FailedMutation<TestDocument>,
        error: new Error('Error 1'),
      })
      await handler.handleFailure({
        mutation: mutation2 as FailedMutation<TestDocument>,
        error: new Error('Error 2'),
      })

      const failed = handler.getFailedMutations()
      expect(failed).toHaveLength(2)
    })

    it('should filter by error category', async () => {
      const mutation1 = createMockMutation({ mutationId: 'mut-network' })
      const mutation2 = createMockMutation({ mutationId: 'mut-conflict' })

      await handler.handleFailure({
        mutation: mutation1 as FailedMutation<TestDocument>,
        error: new Error('Network timeout'),
      })
      await handler.handleFailure({
        mutation: mutation2 as FailedMutation<TestDocument>,
        error: new Error('Conflict detected'),
      })

      const networkFailures = handler.getFailedMutations({ category: 'network' })
      expect(networkFailures).toHaveLength(1)
      expect(networkFailures[0].mutation.mutationId).toBe('mut-network')
    })

    it('should filter by mutation type', async () => {
      const insertMutation = createMockMutation({ mutationId: 'mut-insert', type: 'insert' })
      const updateMutation = createMockMutation({ mutationId: 'mut-update', type: 'update' })

      await handler.handleFailure({
        mutation: insertMutation as FailedMutation<TestDocument>,
        error: new Error('Error'),
      })
      await handler.handleFailure({
        mutation: updateMutation as FailedMutation<TestDocument>,
        error: new Error('Error'),
      })

      const insertFailures = handler.getFailedMutations({ mutationType: 'insert' })
      expect(insertFailures).toHaveLength(1)
      expect(insertFailures[0].mutation.type).toBe('insert')
    })
  })

  describe('retryFailed', () => {
    let handler: ReplayFailureHandler<TestDocument>
    let mockRpc: MockRpcClient

    beforeEach(() => {
      mockRpc = createMockRpcClient()
      handler = createReplayFailureHandler<TestDocument>({
        maxRetries: 3,
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
      })
    })

    it('should retry a specific failed mutation', async () => {
      const mutation = createMockMutation()
      mockRpc.rpc.mockRejectedValueOnce(new Error('Network error'))

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Network error'),
      })

      mockRpc.rpc.mockResolvedValueOnce({ success: true })

      const result = await handler.retryFailed(mutation.mutationId)

      expect(result.success).toBe(true)
      expect(result.retriedMutationId).toBe(mutation.mutationId)
    })

    it('should remove mutation from failed list on successful retry', async () => {
      const mutation = createMockMutation()

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Network error'),
      })

      expect(handler.getFailedMutations()).toHaveLength(1)

      mockRpc.rpc.mockResolvedValueOnce({ success: true })
      await handler.retryFailed(mutation.mutationId)

      expect(handler.getFailedMutations()).toHaveLength(0)
    })

    it('should keep mutation in failed list if retry fails', async () => {
      const mutation = createMockMutation()

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Network error'),
      })

      mockRpc.rpc.mockRejectedValueOnce(new Error('Still failing'))

      const result = await handler.retryFailed(mutation.mutationId)

      expect(result.success).toBe(false)
      expect(handler.getFailedMutations()).toHaveLength(1)
    })

    it('should throw if mutation not found', async () => {
      await expect(handler.retryFailed('non-existent-id')).rejects.toThrow(
        'Mutation not found'
      )
    })

    it('should retry all failed mutations when no id specified', async () => {
      const mutation1 = createMockMutation({ mutationId: 'mut-1' })
      const mutation2 = createMockMutation({ mutationId: 'mut-2' })

      await handler.handleFailure({
        mutation: mutation1 as FailedMutation<TestDocument>,
        error: new Error('Error 1'),
      })
      await handler.handleFailure({
        mutation: mutation2 as FailedMutation<TestDocument>,
        error: new Error('Error 2'),
      })

      mockRpc.rpc.mockResolvedValue({ success: true })

      const results = await handler.retryAllFailed()

      expect(results.successful).toHaveLength(2)
      expect(results.failed).toHaveLength(0)
    })

    it('should respect retry strategy delays', async () => {
      const handlerWithDelay = createReplayFailureHandler<TestDocument>({
        maxRetries: 3,
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        retryStrategy: {
          type: 'fixed',
          delayMs: 100,
        },
      })

      const mutation = createMockMutation()

      await handlerWithDelay.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Network error'),
      })

      mockRpc.rpc.mockResolvedValueOnce({ success: true })

      const startTime = Date.now()
      await handlerWithDelay.retryFailed(mutation.mutationId)
      const elapsed = Date.now() - startTime

      // Should have waited at least close to 100ms
      expect(elapsed).toBeGreaterThanOrEqual(90)
    })
  })

  describe('skipMutation', () => {
    let handler: ReplayFailureHandler<TestDocument>

    beforeEach(() => {
      handler = createReplayFailureHandler<TestDocument>({
        maxRetries: 3,
      })
    })

    it('should skip a specific failed mutation', async () => {
      const mutation = createMockMutation()

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Error'),
      })

      const result = await handler.skipMutation(mutation.mutationId)

      expect(result.skipped).toBe(true)
      expect(result.mutationId).toBe(mutation.mutationId)
    })

    it('should remove mutation from failed list when skipped', async () => {
      const mutation = createMockMutation()

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Error'),
      })

      expect(handler.getFailedMutations()).toHaveLength(1)

      await handler.skipMutation(mutation.mutationId)

      expect(handler.getFailedMutations()).toHaveLength(0)
    })

    it('should add to skipped list', async () => {
      const mutation = createMockMutation()

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Error'),
      })

      await handler.skipMutation(mutation.mutationId)

      const skipped = handler.getSkippedMutations()
      expect(skipped).toHaveLength(1)
      expect(skipped[0].mutationId).toBe(mutation.mutationId)
    })

    it('should throw if mutation not found', async () => {
      await expect(handler.skipMutation('non-existent-id')).rejects.toThrow(
        'Mutation not found'
      )
    })

    it('should call onSkip callback when provided', async () => {
      const onSkip = vi.fn()
      const handlerWithCallback = createReplayFailureHandler<TestDocument>({
        maxRetries: 3,
        onSkip,
      })

      const mutation = createMockMutation()

      await handlerWithCallback.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Error'),
      })

      await handlerWithCallback.skipMutation(mutation.mutationId)

      expect(onSkip).toHaveBeenCalledWith(
        expect.objectContaining({
          mutationId: mutation.mutationId,
        })
      )
    })

    it('should support skip with reason', async () => {
      const mutation = createMockMutation()

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Error'),
      })

      await handler.skipMutation(mutation.mutationId, {
        reason: 'User requested skip',
      })

      const skipped = handler.getSkippedMutations()
      expect(skipped[0].skipReason).toBe('User requested skip')
    })
  })

  describe('clearFailed', () => {
    let handler: ReplayFailureHandler<TestDocument>

    beforeEach(() => {
      handler = createReplayFailureHandler<TestDocument>({
        maxRetries: 3,
      })
    })

    it('should clear all failed mutations', async () => {
      const mutation1 = createMockMutation({ mutationId: 'mut-1' })
      const mutation2 = createMockMutation({ mutationId: 'mut-2' })

      await handler.handleFailure({
        mutation: mutation1 as FailedMutation<TestDocument>,
        error: new Error('Error 1'),
      })
      await handler.handleFailure({
        mutation: mutation2 as FailedMutation<TestDocument>,
        error: new Error('Error 2'),
      })

      expect(handler.getFailedMutations()).toHaveLength(2)

      handler.clearFailed()

      expect(handler.getFailedMutations()).toHaveLength(0)
    })

    it('should clear specific mutation when id provided', async () => {
      const mutation1 = createMockMutation({ mutationId: 'mut-1' })
      const mutation2 = createMockMutation({ mutationId: 'mut-2' })

      await handler.handleFailure({
        mutation: mutation1 as FailedMutation<TestDocument>,
        error: new Error('Error 1'),
      })
      await handler.handleFailure({
        mutation: mutation2 as FailedMutation<TestDocument>,
        error: new Error('Error 2'),
      })

      handler.clearFailed('mut-1')

      const failed = handler.getFailedMutations()
      expect(failed).toHaveLength(1)
      expect(failed[0].mutation.mutationId).toBe('mut-2')
    })
  })
})

// =============================================================================
// Direct Function Tests
// =============================================================================

describe('handleReplayFailure', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
  })

  describe('basic functionality', () => {
    it('should be a function', () => {
      expect(typeof handleReplayFailure).toBe('function')
    })

    it('should process a failed replay', async () => {
      const mutation = createMockMutation()
      const error = new Error('Network error')

      const result = await handleReplayFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
        strategy: 'retry',
        maxRetries: 3,
      })

      expect(result).toBeDefined()
      expect(result.resolution).toBeDefined()
    })

    it('should return retry resolution for retryable errors', async () => {
      const mutation = createMockMutation()
      const error = new Error('Network timeout')

      const result = await handleReplayFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
        strategy: 'retry',
        maxRetries: 3,
      })

      expect(result.resolution).toBe('retry')
      expect(result.nextRetryDelay).toBeGreaterThan(0)
    })

    it('should return skip resolution for non-retryable errors', async () => {
      const mutation = createMockMutation()
      const error = new Error('Validation failed: invalid document')

      const result = await handleReplayFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
        strategy: 'retry',
        maxRetries: 3,
      })

      expect(result.resolution).toBe('skip')
      expect(result.reason).toContain('non-retryable')
    })

    it('should return skip resolution when max retries exceeded', async () => {
      const mutation = createMockMutation({ retryCount: 5 })
      const error = new Error('Network timeout')

      const result = await handleReplayFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
        strategy: 'retry',
        maxRetries: 3,
      })

      expect(result.resolution).toBe('skip')
      expect(result.reason).toContain('max retries')
    })
  })

  describe('retry strategies', () => {
    it('should use exponential backoff strategy', async () => {
      const mutation = createMockMutation({ retryCount: 2 })
      const error = new Error('Network error')

      const result = await handleReplayFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
        strategy: 'exponential-backoff',
        maxRetries: 5,
        baseDelayMs: 100,
      })

      // Exponential backoff: 100 * 2^2 = 400ms (with some jitter)
      expect(result.nextRetryDelay).toBeGreaterThanOrEqual(300)
      expect(result.nextRetryDelay).toBeLessThanOrEqual(500)
    })

    it('should use linear backoff strategy', async () => {
      const mutation = createMockMutation({ retryCount: 2 })
      const error = new Error('Network error')

      const result = await handleReplayFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
        strategy: 'linear-backoff',
        maxRetries: 5,
        baseDelayMs: 100,
      })

      // Linear backoff: 100 * 3 = 300ms
      expect(result.nextRetryDelay).toBeGreaterThanOrEqual(250)
      expect(result.nextRetryDelay).toBeLessThanOrEqual(350)
    })

    it('should use fixed delay strategy', async () => {
      const mutation = createMockMutation({ retryCount: 2 })
      const error = new Error('Network error')

      const result = await handleReplayFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
        strategy: 'fixed',
        maxRetries: 5,
        baseDelayMs: 500,
      })

      expect(result.nextRetryDelay).toBe(500)
    })
  })

  describe('error classification', () => {
    it('should classify network errors', async () => {
      const mutation = createMockMutation()
      const error = new Error('ECONNREFUSED')

      const result = await handleReplayFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
        strategy: 'retry',
        maxRetries: 3,
      })

      expect(result.errorCategory).toBe('network')
      expect(result.isRetryable).toBe(true)
    })

    it('should classify conflict errors', async () => {
      const mutation = createMockMutation()
      const error = new Error('E11000 duplicate key error')

      const result = await handleReplayFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
        strategy: 'retry',
        maxRetries: 3,
      })

      expect(result.errorCategory).toBe('conflict')
      expect(result.isRetryable).toBe(false)
    })

    it('should classify validation errors', async () => {
      const mutation = createMockMutation()
      const error = new Error('Document failed validation')

      const result = await handleReplayFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
        strategy: 'retry',
        maxRetries: 3,
      })

      expect(result.errorCategory).toBe('validation')
      expect(result.isRetryable).toBe(false)
    })

    it('should classify authorization errors', async () => {
      const mutation = createMockMutation()
      const error = new Error('Unauthorized: invalid credentials')

      const result = await handleReplayFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
        strategy: 'retry',
        maxRetries: 3,
      })

      expect(result.errorCategory).toBe('authorization')
      expect(result.isRetryable).toBe(false)
    })
  })
})

// =============================================================================
// Retry Strategy Tests
// =============================================================================

describe('retry strategies', () => {
  describe('exponential-backoff', () => {
    it('should double delay on each retry', async () => {
      const handler = createReplayFailureHandler<TestDocument>({
        retryStrategy: {
          type: 'exponential-backoff',
          baseDelayMs: 100,
          maxDelayMs: 10000,
        },
      })

      const mutation = createMockMutation()
      const error = new Error('Network error')

      // First failure
      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
      })

      let failed = handler.getFailedMutations()
      expect(failed[0].nextRetryDelay).toBeGreaterThanOrEqual(90) // ~100ms
      expect(failed[0].nextRetryDelay).toBeLessThanOrEqual(150)

      // Second failure
      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
      })

      failed = handler.getFailedMutations()
      expect(failed[0].nextRetryDelay).toBeGreaterThanOrEqual(180) // ~200ms
      expect(failed[0].nextRetryDelay).toBeLessThanOrEqual(300)
    })

    it('should cap delay at maxDelayMs', async () => {
      const handler = createReplayFailureHandler<TestDocument>({
        retryStrategy: {
          type: 'exponential-backoff',
          baseDelayMs: 1000,
          maxDelayMs: 5000,
        },
      })

      const mutation = createMockMutation({ retryCount: 10 }) // Would be 2^10 * 1000 = huge

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Network error'),
      })

      const failed = handler.getFailedMutations()
      expect(failed[0].nextRetryDelay).toBeLessThanOrEqual(5000)
    })
  })

  describe('linear-backoff', () => {
    it('should increase delay linearly', async () => {
      const handler = createReplayFailureHandler<TestDocument>({
        retryStrategy: {
          type: 'linear-backoff',
          baseDelayMs: 100,
          incrementMs: 100,
        },
      })

      const mutation = createMockMutation()
      const error = new Error('Network error')

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
      })

      let failed = handler.getFailedMutations()
      expect(failed[0].nextRetryDelay).toBe(100) // base

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
      })

      failed = handler.getFailedMutations()
      expect(failed[0].nextRetryDelay).toBe(200) // base + increment
    })
  })

  describe('custom strategy', () => {
    it('should use custom delay function', async () => {
      const customDelay = vi.fn().mockReturnValue(42)

      const handler = createReplayFailureHandler<TestDocument>({
        retryStrategy: {
          type: 'custom',
          getDelay: customDelay,
          shouldRetry: () => true,
        },
      })

      const mutation = createMockMutation()

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Error'),
      })

      const failed = handler.getFailedMutations()
      expect(failed[0].nextRetryDelay).toBe(42)
      expect(customDelay).toHaveBeenCalled()
    })

    it('should use custom shouldRetry function', async () => {
      const shouldRetry = vi.fn().mockReturnValue(false)

      const handler = createReplayFailureHandler<TestDocument>({
        retryStrategy: {
          type: 'custom',
          getDelay: () => 100,
          shouldRetry,
        },
      })

      const mutation = createMockMutation()

      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Error'),
      })

      const failed = handler.getFailedMutations()
      expect(failed[0].shouldRetry).toBe(false)
      expect(shouldRetry).toHaveBeenCalled()
    })
  })
})

// =============================================================================
// Event Emission Tests
// =============================================================================

describe('event emission', () => {
  it('should emit onFailure event', async () => {
    const onFailure = vi.fn()
    const handler = createReplayFailureHandler<TestDocument>({
      maxRetries: 3,
      onFailure,
    })

    const mutation = createMockMutation()
    const error = new Error('Error')

    await handler.handleFailure({
      mutation: mutation as FailedMutation<TestDocument>,
      error,
    })

    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          mutationId: mutation.mutationId,
        }),
        error,
        attemptNumber: 1,
      })
    )
  })

  it('should emit onRetry event', async () => {
    const mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ success: true })

    const onRetry = vi.fn()
    const handler = createReplayFailureHandler<TestDocument>({
      maxRetries: 3,
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      onRetry,
    })

    const mutation = createMockMutation()

    await handler.handleFailure({
      mutation: mutation as FailedMutation<TestDocument>,
      error: new Error('Error'),
    })

    await handler.retryFailed(mutation.mutationId)

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        mutationId: mutation.mutationId,
      })
    )
  })

  it('should emit onRetrySuccess event', async () => {
    const mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ success: true })

    const onRetrySuccess = vi.fn()
    const handler = createReplayFailureHandler<TestDocument>({
      maxRetries: 3,
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      onRetrySuccess,
    })

    const mutation = createMockMutation()

    await handler.handleFailure({
      mutation: mutation as FailedMutation<TestDocument>,
      error: new Error('Error'),
    })

    await handler.retryFailed(mutation.mutationId)

    expect(onRetrySuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        mutationId: mutation.mutationId,
      })
    )
  })

  it('should emit onSkip event', async () => {
    const onSkip = vi.fn()
    const handler = createReplayFailureHandler<TestDocument>({
      maxRetries: 3,
      onSkip,
    })

    const mutation = createMockMutation()

    await handler.handleFailure({
      mutation: mutation as FailedMutation<TestDocument>,
      error: new Error('Error'),
    })

    await handler.skipMutation(mutation.mutationId)

    expect(onSkip).toHaveBeenCalledWith(
      expect.objectContaining({
        mutationId: mutation.mutationId,
      })
    )
  })

  it('should emit onMaxRetriesExceeded event', async () => {
    const onMaxRetriesExceeded = vi.fn()
    const handler = createReplayFailureHandler<TestDocument>({
      maxRetries: 2,
      onMaxRetriesExceeded,
    })

    const mutation = createMockMutation()
    const error = new Error('Network error')

    // Exceed max retries
    for (let i = 0; i <= 3; i++) {
      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error,
      })
    }

    expect(onMaxRetriesExceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: expect.objectContaining({
          mutationId: mutation.mutationId,
        }),
        attemptNumber: 3,
      })
    )
  })
})

// =============================================================================
// Persistence Tests
// =============================================================================

describe('persistence', () => {
  it('should export failed mutations for persistence', async () => {
    const handler = createReplayFailureHandler<TestDocument>({
      maxRetries: 3,
    })

    const mutation = createMockMutation()

    await handler.handleFailure({
      mutation: mutation as FailedMutation<TestDocument>,
      error: new Error('Error'),
    })

    const exported = handler.exportFailedMutations()

    expect(typeof exported).toBe('string')
    expect(JSON.parse(exported)).toHaveLength(1)
  })

  it('should import failed mutations from persistence', async () => {
    const handler = createReplayFailureHandler<TestDocument>({
      maxRetries: 3,
    })

    const mutation = createMockMutation()

    await handler.handleFailure({
      mutation: mutation as FailedMutation<TestDocument>,
      error: new Error('Error'),
    })

    const exported = handler.exportFailedMutations()

    const newHandler = createReplayFailureHandler<TestDocument>({
      maxRetries: 3,
    })

    newHandler.importFailedMutations(exported)

    const failed = newHandler.getFailedMutations()
    expect(failed).toHaveLength(1)
    expect(failed[0].mutation.mutationId).toBe(mutation.mutationId)
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('integration scenarios', () => {
  it('should handle complete offline replay flow', async () => {
    const mockRpc = createMockRpcClient()
    const onFailure = vi.fn()
    const onRetrySuccess = vi.fn()

    const handler = createReplayFailureHandler<TestDocument>({
      maxRetries: 3,
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      onFailure,
      onRetrySuccess,
    })

    // Simulate offline mutations that fail on first replay
    const mutations = [
      createMockMutation({ mutationId: 'mut-1', type: 'insert' }),
      createMockMutation({ mutationId: 'mut-2', type: 'update' }),
      createMockMutation({ mutationId: 'mut-3', type: 'delete' }),
    ]

    // Record failures
    for (const mutation of mutations) {
      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Network error'),
      })
    }

    expect(handler.getFailedMutations()).toHaveLength(3)

    // Simulate network recovery - all retries succeed
    mockRpc.rpc.mockResolvedValue({ success: true })

    const results = await handler.retryAllFailed()

    expect(results.successful).toHaveLength(3)
    expect(results.failed).toHaveLength(0)
    expect(handler.getFailedMutations()).toHaveLength(0)
    expect(onRetrySuccess).toHaveBeenCalledTimes(3)
  })

  it('should handle mixed success/failure during retry', async () => {
    const mockRpc = createMockRpcClient()

    const handler = createReplayFailureHandler<TestDocument>({
      maxRetries: 3,
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
    })

    const mutations = [
      createMockMutation({ mutationId: 'mut-success', type: 'insert' }),
      createMockMutation({ mutationId: 'mut-fail', type: 'insert' }),
    ]

    for (const mutation of mutations) {
      await handler.handleFailure({
        mutation: mutation as FailedMutation<TestDocument>,
        error: new Error('Initial error'),
      })
    }

    // First mutation succeeds, second fails
    mockRpc.rpc
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('Still failing'))

    const results = await handler.retryAllFailed()

    expect(results.successful).toHaveLength(1)
    expect(results.failed).toHaveLength(1)
    expect(handler.getFailedMutations()).toHaveLength(1)
  })

  it('should support user-driven skip workflow', async () => {
    const onSkip = vi.fn()

    const handler = createReplayFailureHandler<TestDocument>({
      maxRetries: 3,
      onSkip,
    })

    const mutation = createMockMutation()

    await handler.handleFailure({
      mutation: mutation as FailedMutation<TestDocument>,
      error: new Error('Validation error'),
    })

    // User decides to skip this mutation
    await handler.skipMutation(mutation.mutationId, {
      reason: 'User acknowledged data loss',
    })

    expect(handler.getFailedMutations()).toHaveLength(0)
    expect(handler.getSkippedMutations()).toHaveLength(1)
    expect(onSkip).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'User acknowledged data loss',
      })
    )
  })
})
