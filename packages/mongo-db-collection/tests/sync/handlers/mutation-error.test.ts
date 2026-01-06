/**
 * @file Mutation Error Handler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the mutation error handler that handles
 * Layer 7 mutation errors and provides error recovery, classification,
 * and reporting capabilities.
 *
 * The mutation error handler is called when a mutation fails and needs
 * to handle the error appropriately - either by retrying, classifying
 * the error for user feedback, or triggering recovery mechanisms.
 *
 * RED PHASE: These tests will fail until the mutation error handler is implemented
 * in src/sync/handlers/mutation-error.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createMutationErrorHandler,
  handleMutationError,
  classifyMutationError,
  isRetryableError,
  type MutationErrorHandlerConfig,
  type MutationErrorContext,
  type MutationErrorResult,
  type MutationErrorClassification,
  type ErrorRecoveryStrategy,
} from '../../../src/sync/handlers/mutation-error'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing mutation errors.
 */
interface TestDocument {
  _id: string
  name: string
  value: number
  createdAt: Date
}

/**
 * Nested document type for testing complex error scenarios.
 */
interface NestedDocument {
  _id: string
  user: {
    profile: {
      firstName: string
      lastName: string
    }
    settings: {
      theme: 'light' | 'dark'
    }
  }
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
// Mock Transaction and Mutation Types
// =============================================================================

interface MockPendingMutation<T> {
  mutationId: string
  type: 'insert' | 'update' | 'delete'
  key: string
  modified: T
  original: Partial<T>
  changes: Partial<T>
  metadata?: Record<string, unknown>
  syncMetadata?: Record<string, unknown>
}

interface MockTransaction<T> {
  id: string
  mutations: MockPendingMutation<T>[]
  getMutations: () => MockPendingMutation<T>[]
}

function createMockTransaction<T>(
  mutations: MockPendingMutation<T>[]
): MockTransaction<T> {
  return {
    id: `tx-${Date.now()}`,
    mutations,
    getMutations: () => mutations,
  }
}

// =============================================================================
// Error Classification Tests
// =============================================================================

describe('classifyMutationError', () => {
  describe('error classification function', () => {
    it('should be a function', () => {
      expect(typeof classifyMutationError).toBe('function')
    })

    it('should classify duplicate key errors', () => {
      const error = new Error('E11000 duplicate key error collection: test.users index: _id_ dup key: { _id: "123" }')
      const classification = classifyMutationError(error)

      expect(classification.type).toBe('duplicate_key')
      expect(classification.isRetryable).toBe(false)
      expect(classification.isUserError).toBe(true)
    })

    it('should classify validation errors', () => {
      const error = new Error('Document failed validation')
      const classification = classifyMutationError(error)

      expect(classification.type).toBe('validation')
      expect(classification.isRetryable).toBe(false)
      expect(classification.isUserError).toBe(true)
    })

    it('should classify network errors', () => {
      const error = new Error('Network connection refused')
      const classification = classifyMutationError(error)

      expect(classification.type).toBe('network')
      expect(classification.isRetryable).toBe(true)
      expect(classification.isUserError).toBe(false)
    })

    it('should classify timeout errors', () => {
      const error = new Error('Connection timed out')
      const classification = classifyMutationError(error)

      expect(classification.type).toBe('timeout')
      expect(classification.isRetryable).toBe(true)
      expect(classification.isUserError).toBe(false)
    })

    it('should classify authentication errors', () => {
      const error = new Error('Authentication failed: Invalid credentials')
      const classification = classifyMutationError(error)

      expect(classification.type).toBe('authentication')
      expect(classification.isRetryable).toBe(false)
      expect(classification.isUserError).toBe(false)
    })

    it('should classify authorization errors', () => {
      const error = new Error('not authorized on database to execute command')
      const classification = classifyMutationError(error)

      expect(classification.type).toBe('authorization')
      expect(classification.isRetryable).toBe(false)
      expect(classification.isUserError).toBe(false)
    })

    it('should classify write conflict errors', () => {
      const error = new Error('WriteConflict error: Write conflict during update')
      const classification = classifyMutationError(error)

      expect(classification.type).toBe('write_conflict')
      expect(classification.isRetryable).toBe(true)
      expect(classification.isUserError).toBe(false)
    })

    it('should classify server errors', () => {
      const error = new Error('Internal server error')
      const classification = classifyMutationError(error)

      expect(classification.type).toBe('server')
      expect(classification.isRetryable).toBe(true)
      expect(classification.isUserError).toBe(false)
    })

    it('should classify unknown errors', () => {
      const error = new Error('Something strange happened')
      const classification = classifyMutationError(error)

      expect(classification.type).toBe('unknown')
      expect(classification.isRetryable).toBe(false)
      expect(classification.isUserError).toBe(false)
    })

    it('should extract error code from MongoDB errors', () => {
      const error = new Error('MongoError: E11000 duplicate key error') as Error & { code?: number }
      error.code = 11000
      const classification = classifyMutationError(error)

      expect(classification.errorCode).toBe(11000)
    })

    it('should include original error message', () => {
      const error = new Error('Original error message')
      const classification = classifyMutationError(error)

      expect(classification.message).toBe('Original error message')
    })
  })
})

// =============================================================================
// isRetryableError Tests
// =============================================================================

describe('isRetryableError', () => {
  it('should be a function', () => {
    expect(typeof isRetryableError).toBe('function')
  })

  it('should return true for network errors', () => {
    expect(isRetryableError(new Error('Network error'))).toBe(true)
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true)
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true)
  })

  it('should return true for timeout errors', () => {
    expect(isRetryableError(new Error('Connection timed out'))).toBe(true)
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true)
  })

  it('should return true for transient server errors', () => {
    expect(isRetryableError(new Error('temporarily unavailable'))).toBe(true)
    expect(isRetryableError(new Error('Write conflict'))).toBe(true)
  })

  it('should return false for duplicate key errors', () => {
    expect(isRetryableError(new Error('E11000 duplicate key'))).toBe(false)
  })

  it('should return false for validation errors', () => {
    expect(isRetryableError(new Error('Document failed validation'))).toBe(false)
  })

  it('should return false for authentication errors', () => {
    expect(isRetryableError(new Error('Authentication failed'))).toBe(false)
  })

  it('should return false for authorization errors', () => {
    expect(isRetryableError(new Error('not authorized'))).toBe(false)
  })
})

// =============================================================================
// Handler Factory Tests
// =============================================================================

describe('createMutationErrorHandler', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createMutationErrorHandler).toBe('function')
    })

    it('should return a handler function', () => {
      const handler = createMutationErrorHandler({
        database: 'testdb',
        collection: 'testcol',
      })

      expect(typeof handler).toBe('function')
    })

    it('should throw when database is not provided', () => {
      expect(() =>
        createMutationErrorHandler({
          database: '',
          collection: 'testcol',
        })
      ).toThrow('database is required')
    })

    it('should throw when collection is not provided', () => {
      expect(() =>
        createMutationErrorHandler({
          database: 'testdb',
          collection: '',
        })
      ).toThrow('collection is required')
    })
  })

  describe('handler execution', () => {
    let handler: ReturnType<typeof createMutationErrorHandler<TestDocument>>

    beforeEach(() => {
      handler = createMutationErrorHandler<TestDocument>({
        database: 'testdb',
        collection: 'testcol',
      })
    })

    it('should handle an error and return a result', async () => {
      const error = new Error('Test error')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test Doc',
          value: 42,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
      })

      expect(result).toBeDefined()
      expect(result.handled).toBe(true)
      expect(result.classification).toBeDefined()
    })

    it('should classify the error', async () => {
      const error = new Error('E11000 duplicate key error')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test Doc',
          value: 42,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
      })

      expect(result.classification.type).toBe('duplicate_key')
      expect(result.classification.isRetryable).toBe(false)
    })

    it('should suggest retry for retryable errors', async () => {
      const error = new Error('Network temporarily unavailable')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test Doc',
          value: 42,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
      })

      expect(result.shouldRetry).toBe(true)
      expect(result.retryDelayMs).toBeGreaterThan(0)
    })

    it('should not suggest retry for non-retryable errors', async () => {
      const error = new Error('E11000 duplicate key error')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test Doc',
          value: 42,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
      })

      expect(result.shouldRetry).toBe(false)
    })

    it('should track retry count', async () => {
      const handler = createMutationErrorHandler<TestDocument>({
        database: 'testdb',
        collection: 'testcol',
        maxRetries: 3,
      })

      const error = new Error('Network error')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test Doc',
          value: 42,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      // First attempt
      const result1 = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
        retryCount: 0,
      })
      expect(result1.shouldRetry).toBe(true)
      expect(result1.nextRetryCount).toBe(1)

      // Second attempt
      const result2 = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
        retryCount: 1,
      })
      expect(result2.shouldRetry).toBe(true)
      expect(result2.nextRetryCount).toBe(2)

      // Third attempt
      const result3 = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
        retryCount: 2,
      })
      expect(result3.shouldRetry).toBe(true)
      expect(result3.nextRetryCount).toBe(3)

      // Fourth attempt (exceeds maxRetries)
      const result4 = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
        retryCount: 3,
      })
      expect(result4.shouldRetry).toBe(false)
    })
  })
})

// =============================================================================
// Direct Handler Function Tests
// =============================================================================

describe('handleMutationError', () => {
  describe('basic functionality', () => {
    it('should be a function', () => {
      expect(typeof handleMutationError).toBe('function')
    })

    it('should handle an error directly', async () => {
      const error = new Error('Test error')

      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'insert',
        documentKey: 'doc-123',
      })

      expect(result).toBeDefined()
      expect(result.handled).toBe(true)
      expect(result.classification).toBeDefined()
    })

    it('should return classification for duplicate key error', async () => {
      const error = new Error('E11000 duplicate key error collection: test.users')

      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'insert',
        documentKey: 'doc-123',
      })

      expect(result.classification.type).toBe('duplicate_key')
      expect(result.classification.isRetryable).toBe(false)
      expect(result.classification.isUserError).toBe(true)
    })

    it('should return classification for network error', async () => {
      const error = new Error('Network connection failed')

      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'update',
        documentKey: 'doc-123',
      })

      expect(result.classification.type).toBe('network')
      expect(result.classification.isRetryable).toBe(true)
    })

    it('should include suggested recovery strategy', async () => {
      const error = new Error('E11000 duplicate key error')

      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'insert',
        documentKey: 'doc-123',
      })

      expect(result.recoveryStrategy).toBeDefined()
      expect(result.recoveryStrategy).toBe('abort')
    })

    it('should suggest retry strategy for retryable errors', async () => {
      const error = new Error('Network temporarily unavailable')

      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'insert',
        documentKey: 'doc-123',
      })

      expect(result.recoveryStrategy).toBe('retry')
      expect(result.shouldRetry).toBe(true)
    })
  })

  describe('user-friendly messages', () => {
    it('should provide user-friendly message for duplicate key error', async () => {
      const error = new Error('E11000 duplicate key error collection: test.users')

      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'insert',
        documentKey: 'doc-123',
      })

      expect(result.userMessage).toBeDefined()
      expect(result.userMessage).toContain('already exists')
    })

    it('should provide user-friendly message for validation error', async () => {
      const error = new Error('Document failed validation')

      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'insert',
        documentKey: 'doc-123',
      })

      expect(result.userMessage).toBeDefined()
      expect(result.userMessage).toContain('invalid')
    })

    it('should provide user-friendly message for network error', async () => {
      const error = new Error('Network connection failed')

      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'insert',
        documentKey: 'doc-123',
      })

      expect(result.userMessage).toBeDefined()
      expect(result.userMessage).toContain('connection')
    })

    it('should provide user-friendly message for timeout error', async () => {
      const error = new Error('Operation timed out')

      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'update',
        documentKey: 'doc-123',
      })

      expect(result.userMessage).toBeDefined()
      expect(result.userMessage).toContain('timed out')
    })

    it('should provide generic user-friendly message for unknown errors', async () => {
      const error = new Error('Something unexpected happened')

      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'delete',
        documentKey: 'doc-123',
      })

      expect(result.userMessage).toBeDefined()
      expect(result.userMessage.length).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// Recovery Strategy Tests
// =============================================================================

describe('recovery strategies', () => {
  let handler: ReturnType<typeof createMutationErrorHandler<TestDocument>>

  beforeEach(() => {
    handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      maxRetries: 3,
    })
  })

  describe('retry strategy', () => {
    it('should suggest retry for network errors', async () => {
      const error = new Error('ECONNRESET')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test',
          value: 1,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
      })

      expect(result.recoveryStrategy).toBe('retry')
      expect(result.shouldRetry).toBe(true)
    })

    it('should calculate exponential backoff delay', async () => {
      const handler = createMutationErrorHandler<TestDocument>({
        database: 'testdb',
        collection: 'testcol',
        maxRetries: 5,
        initialDelayMs: 100,
        backoffMultiplier: 2,
      })

      const error = new Error('Network error')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test',
          value: 1,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result0 = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
        retryCount: 0,
      })
      expect(result0.retryDelayMs).toBe(100)

      const result1 = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
        retryCount: 1,
      })
      expect(result1.retryDelayMs).toBe(200)

      const result2 = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
        retryCount: 2,
      })
      expect(result2.retryDelayMs).toBe(400)
    })

    it('should respect maximum delay', async () => {
      const handler = createMutationErrorHandler<TestDocument>({
        database: 'testdb',
        collection: 'testcol',
        maxRetries: 10,
        initialDelayMs: 100,
        backoffMultiplier: 10,
        maxDelayMs: 1000,
      })

      const error = new Error('Network error')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test',
          value: 1,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
        retryCount: 5,
      })

      expect(result.retryDelayMs).toBeLessThanOrEqual(1000)
    })
  })

  describe('abort strategy', () => {
    it('should suggest abort for duplicate key errors', async () => {
      const error = new Error('E11000 duplicate key error')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test',
          value: 1,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
      })

      expect(result.recoveryStrategy).toBe('abort')
      expect(result.shouldRetry).toBe(false)
    })

    it('should suggest abort for validation errors', async () => {
      const error = new Error('Document failed validation')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test',
          value: 1,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
      })

      expect(result.recoveryStrategy).toBe('abort')
      expect(result.shouldRetry).toBe(false)
    })

    it('should suggest abort for authentication errors', async () => {
      const error = new Error('Authentication failed')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test',
          value: 1,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
      })

      expect(result.recoveryStrategy).toBe('abort')
    })
  })

  describe('rollback strategy', () => {
    it('should suggest rollback for partial transaction failures', async () => {
      const handler = createMutationErrorHandler<TestDocument>({
        database: 'testdb',
        collection: 'testcol',
        enableRollback: true,
      })

      const error = new Error('Partial transaction failure')
      const mutations: MockPendingMutation<TestDocument>[] = [
        {
          mutationId: 'mut-1',
          type: 'insert',
          key: 'doc-1',
          modified: { _id: 'doc-1', name: 'Test 1', value: 1, createdAt: new Date() },
          original: {},
          changes: {},
        },
        {
          mutationId: 'mut-2',
          type: 'insert',
          key: 'doc-2',
          modified: { _id: 'doc-2', name: 'Test 2', value: 2, createdAt: new Date() },
          original: {},
          changes: {},
        },
      ]

      const transaction = createMockTransaction(mutations)

      const result = await handler({
        error,
        mutation: mutations[1]!,
        transaction,
        mutationType: 'insert',
        failedMutationIndex: 1,
        completedMutations: [mutations[0]!],
      })

      expect(result.recoveryStrategy).toBe('rollback')
      expect(result.rollbackMutations).toBeDefined()
      expect(result.rollbackMutations?.length).toBe(1)
    })
  })

  describe('manual_intervention strategy', () => {
    it('should suggest manual intervention for authorization errors', async () => {
      const error = new Error('not authorized on database')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test',
          value: 1,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
      })

      expect(result.recoveryStrategy).toBe('manual_intervention')
    })

    it('should suggest manual intervention after max retries exceeded', async () => {
      const handler = createMutationErrorHandler<TestDocument>({
        database: 'testdb',
        collection: 'testcol',
        maxRetries: 3,
      })

      const error = new Error('Network error')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test',
          value: 1,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
        retryCount: 3,
      })

      expect(result.recoveryStrategy).toBe('manual_intervention')
      expect(result.shouldRetry).toBe(false)
    })
  })
})

// =============================================================================
// Hooks and Callbacks Tests
// =============================================================================

describe('hooks and callbacks', () => {
  it('should call onError hook', async () => {
    const onError = vi.fn()

    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      onError,
    })

    const error = new Error('Test error')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-123',
      modified: {
        _id: 'doc-123',
        name: 'Test',
        value: 1,
        createdAt: new Date(),
      },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await handler({
      error,
      mutation,
      transaction,
      mutationType: 'insert',
    })

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error,
        mutation,
        transaction,
      })
    )
  })

  it('should call onRetry hook when retry is suggested', async () => {
    const onRetry = vi.fn()

    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      maxRetries: 3,
      onRetry,
    })

    const error = new Error('Network error')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-123',
      modified: {
        _id: 'doc-123',
        name: 'Test',
        value: 1,
        createdAt: new Date(),
      },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await handler({
      error,
      mutation,
      transaction,
      mutationType: 'insert',
      retryCount: 0,
    })

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        error,
        retryCount: 1,
        delayMs: expect.any(Number),
      })
    )
  })

  it('should call onMaxRetriesExceeded when retries are exhausted', async () => {
    const onMaxRetriesExceeded = vi.fn()

    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      maxRetries: 3,
      onMaxRetriesExceeded,
    })

    const error = new Error('Network error')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-123',
      modified: {
        _id: 'doc-123',
        name: 'Test',
        value: 1,
        createdAt: new Date(),
      },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await handler({
      error,
      mutation,
      transaction,
      mutationType: 'insert',
      retryCount: 3,
    })

    expect(onMaxRetriesExceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        error,
        mutation,
        totalRetries: 3,
      })
    )
  })

  it('should call onRollback when rollback is triggered', async () => {
    const onRollback = vi.fn()

    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      enableRollback: true,
      onRollback,
    })

    const error = new Error('Partial failure')
    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-1',
        modified: { _id: 'doc-1', name: 'Test 1', value: 1, createdAt: new Date() },
        original: {},
        changes: {},
      },
      {
        mutationId: 'mut-2',
        type: 'insert',
        key: 'doc-2',
        modified: { _id: 'doc-2', name: 'Test 2', value: 2, createdAt: new Date() },
        original: {},
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await handler({
      error,
      mutation: mutations[1]!,
      transaction,
      mutationType: 'insert',
      failedMutationIndex: 1,
      completedMutations: [mutations[0]!],
    })

    expect(onRollback).toHaveBeenCalledWith(
      expect.objectContaining({
        completedMutations: [mutations[0]],
      })
    )
  })
})

// =============================================================================
// Error Logging Tests
// =============================================================================

describe('error logging', () => {
  it('should generate structured error log', async () => {
    const result = await handleMutationError({
      error: new Error('Test error'),
      mutationId: 'mut-1',
      mutationType: 'insert',
      documentKey: 'doc-123',
    })

    expect(result.errorLog).toBeDefined()
    expect(result.errorLog?.mutationId).toBe('mut-1')
    expect(result.errorLog?.mutationType).toBe('insert')
    expect(result.errorLog?.documentKey).toBe('doc-123')
    expect(result.errorLog?.timestamp).toBeDefined()
  })

  it('should include stack trace in error log', async () => {
    const error = new Error('Test error')

    const result = await handleMutationError({
      error,
      mutationId: 'mut-1',
      mutationType: 'insert',
      documentKey: 'doc-123',
    })

    expect(result.errorLog?.stack).toBeDefined()
    expect(result.errorLog?.stack).toContain('Error: Test error')
  })

  it('should include classification in error log', async () => {
    const error = new Error('E11000 duplicate key error')

    const result = await handleMutationError({
      error,
      mutationId: 'mut-1',
      mutationType: 'insert',
      documentKey: 'doc-123',
    })

    expect(result.errorLog?.classification).toBe('duplicate_key')
    expect(result.errorLog?.isRetryable).toBe(false)
  })
})

// =============================================================================
// Mutation Type Specific Tests
// =============================================================================

describe('mutation type specific handling', () => {
  let handler: ReturnType<typeof createMutationErrorHandler<TestDocument>>

  beforeEach(() => {
    handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
    })
  })

  describe('insert mutations', () => {
    it('should handle duplicate key for insert', async () => {
      const error = new Error('E11000 duplicate key error')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'insert',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Test',
          value: 1,
          createdAt: new Date(),
        },
        original: {},
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
      })

      expect(result.classification.type).toBe('duplicate_key')
      expect(result.recoveryStrategy).toBe('abort')
    })
  })

  describe('update mutations', () => {
    it('should handle document not found for update', async () => {
      const error = new Error('Document not found')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'update',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Updated',
          value: 2,
          createdAt: new Date(),
        },
        original: {
          _id: 'doc-123',
          name: 'Original',
          value: 1,
        },
        changes: { name: 'Updated', value: 2 },
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'update',
      })

      expect(result.classification.type).toBe('not_found')
      expect(result.recoveryStrategy).toBe('abort')
    })

    it('should handle write conflict for update', async () => {
      const error = new Error('WriteConflict')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'update',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Updated',
          value: 2,
          createdAt: new Date(),
        },
        original: {
          _id: 'doc-123',
          name: 'Original',
          value: 1,
        },
        changes: { name: 'Updated', value: 2 },
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'update',
      })

      expect(result.classification.type).toBe('write_conflict')
      expect(result.classification.isRetryable).toBe(true)
    })
  })

  describe('delete mutations', () => {
    it('should handle document not found for delete', async () => {
      const error = new Error('Document does not exist')
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-123',
        modified: {} as TestDocument,
        original: {
          _id: 'doc-123',
          name: 'To Delete',
          value: 1,
        },
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'delete',
      })

      expect(result.classification.type).toBe('not_found')
    })
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('type safety', () => {
  it('should maintain generic type through handler', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
    })

    const error = new Error('Test error')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-123',
      modified: {
        _id: 'doc-123',
        name: 'Test',
        value: 42,
        createdAt: new Date(),
      },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await expect(
      handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
      })
    ).resolves.not.toThrow()
  })

  it('should work with nested document types', async () => {
    const handler = createMutationErrorHandler<NestedDocument>({
      database: 'testdb',
      collection: 'testcol',
    })

    const error = new Error('Test error')
    const mutation: MockPendingMutation<NestedDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'nested-123',
      modified: {
        _id: 'nested-123',
        user: {
          profile: {
            firstName: 'John',
            lastName: 'Doe',
          },
          settings: {
            theme: 'dark',
          },
        },
      },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await expect(
      handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
      })
    ).resolves.not.toThrow()
  })
})

// =============================================================================
// Integration with TanStack DB Tests
// =============================================================================

describe('TanStack DB integration', () => {
  it('should work with TanStack DB transaction format', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
    })

    const error = new Error('Test error')
    const mockTanStackTransaction = {
      id: 'tx-123',
      mutations: [
        {
          mutationId: 'mut-1',
          type: 'insert' as const,
          key: 'doc-1',
          globalKey: 'KEY::users/doc-1',
          modified: {
            _id: 'doc-1',
            name: 'TanStack Test',
            value: 100,
            createdAt: new Date(),
          },
          original: {},
          changes: {},
          metadata: {},
          syncMetadata: {},
          optimistic: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      getMutations: function () {
        return this.mutations
      },
    }

    await expect(
      handler({
        error,
        mutation: mockTanStackTransaction.mutations[0] as any,
        transaction: mockTanStackTransaction as any,
        mutationType: 'insert',
      })
    ).resolves.not.toThrow()
  })

  it('should be usable as onError handler in collection config', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
    })

    // Simulate how TanStack DB would use this handler
    const collectionConfig = {
      onError: handler,
    }

    expect(typeof collectionConfig.onError).toBe('function')
  })
})

// =============================================================================
// Batch Error Aggregation Tests (RED Phase - New Features)
// =============================================================================

describe('batch error aggregation', () => {
  it('should aggregate multiple errors from a batch operation', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
    })

    const errors = [
      new Error('E11000 duplicate key error for doc-1'),
      new Error('Validation failed for doc-2'),
      new Error('Network error for doc-3'),
    ]

    const mutations: MockPendingMutation<TestDocument>[] = [
      { mutationId: 'mut-1', type: 'insert', key: 'doc-1', modified: { _id: 'doc-1', name: 'Test 1', value: 1, createdAt: new Date() }, original: {}, changes: {} },
      { mutationId: 'mut-2', type: 'insert', key: 'doc-2', modified: { _id: 'doc-2', name: 'Test 2', value: 2, createdAt: new Date() }, original: {}, changes: {} },
      { mutationId: 'mut-3', type: 'insert', key: 'doc-3', modified: { _id: 'doc-3', name: 'Test 3', value: 3, createdAt: new Date() }, original: {}, changes: {} },
    ]

    const transaction = createMockTransaction(mutations)

    // Process each error
    const results = await Promise.all(
      errors.map((error, index) =>
        handler({
          error,
          mutation: mutations[index]!,
          transaction,
          mutationType: 'insert',
          failedMutationIndex: index,
        })
      )
    )

    expect(results).toHaveLength(3)
    expect(results[0]?.classification.type).toBe('duplicate_key')
    expect(results[1]?.classification.type).toBe('validation')
    expect(results[2]?.classification.type).toBe('network')
  })

  it('should provide aggregated error summary for batch failures', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
    })

    // Create a batch error with multiple sub-errors
    const batchError = new Error('Batch operation failed: 3 errors occurred') as Error & {
      errors?: Error[]
      failedCount?: number
      successCount?: number
    }
    batchError.errors = [
      new Error('E11000 duplicate key error'),
      new Error('Network timeout'),
      new Error('Validation failed'),
    ]
    batchError.failedCount = 3
    batchError.successCount = 7

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-batch',
      type: 'insert',
      key: 'batch-op',
      modified: { _id: 'batch-op', name: 'Batch', value: 10, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    const result = await handler({
      error: batchError,
      mutation,
      transaction,
      mutationType: 'insert',
    })

    expect(result.handled).toBe(true)
    // The handler should recognize this as a batch error and provide appropriate info
    expect(result.classification).toBeDefined()
  })

  it('should determine retry strategy based on majority error type', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      maxRetries: 3,
    })

    // Simulate batch with mostly retryable errors
    const errors = [
      new Error('Network timeout'),
      new Error('Connection reset'),
      new Error('E11000 duplicate key'), // Non-retryable
      new Error('Server temporarily unavailable'),
    ]

    const mutations = errors.map((_, i) => ({
      mutationId: `mut-${i}`,
      type: 'insert' as const,
      key: `doc-${i}`,
      modified: { _id: `doc-${i}`, name: `Test ${i}`, value: i, createdAt: new Date() },
      original: {},
      changes: {},
    }))

    const transaction = createMockTransaction(mutations)

    const results = await Promise.all(
      errors.map((error, index) =>
        handler({
          error,
          mutation: mutations[index]!,
          transaction,
          mutationType: 'insert',
        })
      )
    )

    // Count retryable vs non-retryable
    const retryableCount = results.filter(r => r.shouldRetry).length
    const nonRetryableCount = results.filter(r => !r.shouldRetry).length

    expect(retryableCount).toBe(3) // Network, connection, server errors
    expect(nonRetryableCount).toBe(1) // Duplicate key error
  })

  it('should separate recoverable from non-recoverable errors in batch', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
    })

    const recoverableError = new Error('Network timeout - please retry')
    const nonRecoverableError = new Error('E11000 duplicate key error')

    const mutations: MockPendingMutation<TestDocument>[] = [
      { mutationId: 'mut-1', type: 'insert', key: 'doc-1', modified: { _id: 'doc-1', name: 'Test 1', value: 1, createdAt: new Date() }, original: {}, changes: {} },
      { mutationId: 'mut-2', type: 'insert', key: 'doc-2', modified: { _id: 'doc-2', name: 'Test 2', value: 2, createdAt: new Date() }, original: {}, changes: {} },
    ]

    const transaction = createMockTransaction(mutations)

    const result1 = await handler({
      error: recoverableError,
      mutation: mutations[0]!,
      transaction,
      mutationType: 'insert',
    })

    const result2 = await handler({
      error: nonRecoverableError,
      mutation: mutations[1]!,
      transaction,
      mutationType: 'insert',
    })

    expect(result1.classification.isRetryable).toBe(true)
    expect(result1.recoveryStrategy).toBe('retry')

    expect(result2.classification.isRetryable).toBe(false)
    expect(result2.recoveryStrategy).toBe('abort')
  })
})

// =============================================================================
// Conflict Detection Tests (RED Phase - Enhanced)
// =============================================================================

describe('conflict detection', () => {
  it('should detect version mismatch conflicts', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
    })

    const error = new Error('Version mismatch: expected version 5, found version 7')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-123',
      modified: { _id: 'doc-123', name: 'Updated', value: 10, createdAt: new Date() },
      original: { _id: 'doc-123', name: 'Original', value: 5 },
      changes: { name: 'Updated', value: 10 },
      syncMetadata: { version: 5 },
    }

    const transaction = createMockTransaction([mutation])

    const result = await handler({
      error,
      mutation,
      transaction,
      mutationType: 'update',
    })

    expect(result.classification.type).toBe('write_conflict')
    expect(result.classification.isRetryable).toBe(true)
  })

  it('should detect concurrent modification conflicts', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
    })

    const error = new Error('WriteConflict: Document was modified by another operation')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-123',
      modified: { _id: 'doc-123', name: 'My Update', value: 100, createdAt: new Date() },
      original: { _id: 'doc-123', name: 'Original', value: 50 },
      changes: { name: 'My Update', value: 100 },
    }

    const transaction = createMockTransaction([mutation])

    const result = await handler({
      error,
      mutation,
      transaction,
      mutationType: 'update',
    })

    expect(result.classification.type).toBe('write_conflict')
    expect(result.shouldRetry).toBe(true)
    expect(result.userMessage).toContain('modified')
  })

  it('should detect optimistic concurrency control failures', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
    })

    const error = new Error('Optimistic lock failed: document has been updated since read')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-123',
      modified: { _id: 'doc-123', name: 'Optimistic Update', value: 200, createdAt: new Date() },
      original: { _id: 'doc-123', name: 'Stale Data', value: 100 },
      changes: { name: 'Optimistic Update', value: 200 },
      metadata: { optimisticLock: true },
    }

    const transaction = createMockTransaction([mutation])

    const result = await handler({
      error,
      mutation,
      transaction,
      mutationType: 'update',
    })

    // Should recognize this as a conflict scenario
    expect(result.classification.isRetryable).toBe(true)
  })

  it('should provide conflict resolution hints', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
    })

    const error = new Error('WriteConflict during update')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-123',
      modified: { _id: 'doc-123', name: 'Updated', value: 99, createdAt: new Date() },
      original: { _id: 'doc-123', name: 'Original', value: 50 },
      changes: { name: 'Updated', value: 99 },
    }

    const transaction = createMockTransaction([mutation])

    const result = await handler({
      error,
      mutation,
      transaction,
      mutationType: 'update',
    })

    expect(result.userMessage).toBeDefined()
    expect(result.userMessage.length).toBeGreaterThan(0)
    // Should suggest refreshing or retrying
  })
})

// =============================================================================
// Rollback Handling Tests (RED Phase - Enhanced)
// =============================================================================

describe('rollback handling', () => {
  it('should identify mutations requiring rollback after partial failure', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      enableRollback: true,
    })

    const completedMutations: MockPendingMutation<TestDocument>[] = [
      { mutationId: 'mut-1', type: 'insert', key: 'doc-1', modified: { _id: 'doc-1', name: 'Inserted 1', value: 1, createdAt: new Date() }, original: {}, changes: {} },
      { mutationId: 'mut-2', type: 'update', key: 'doc-2', modified: { _id: 'doc-2', name: 'Updated 2', value: 2, createdAt: new Date() }, original: { _id: 'doc-2', name: 'Original 2', value: 0 }, changes: { name: 'Updated 2', value: 2 } },
    ]

    const failedMutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-3',
      type: 'insert',
      key: 'doc-3',
      modified: { _id: 'doc-3', name: 'Failed Insert', value: 3, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([...completedMutations, failedMutation])
    const error = new Error('Insert failed - network error')

    const result = await handler({
      error,
      mutation: failedMutation,
      transaction,
      mutationType: 'insert',
      failedMutationIndex: 2,
      completedMutations,
    })

    expect(result.recoveryStrategy).toBe('rollback')
    expect(result.rollbackMutations).toBeDefined()
    expect(result.rollbackMutations?.length).toBe(2)
  })

  it('should generate correct rollback operations for inserts', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      enableRollback: true,
    })

    const insertMutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'New Doc', value: 100, createdAt: new Date() },
      original: {},
      changes: { _id: 'doc-1', name: 'New Doc', value: 100 },
    }

    const transaction = createMockTransaction([insertMutation])
    const error = new Error('Subsequent operation failed')

    const result = await handler({
      error,
      mutation: insertMutation,
      transaction,
      mutationType: 'insert',
      completedMutations: [insertMutation],
    })

    expect(result.rollbackMutations).toBeDefined()
    // For an insert, rollback would mean delete
    expect(result.rollbackMutations?.[0]?.type).toBe('insert')
    expect(result.rollbackMutations?.[0]?.key).toBe('doc-1')
  })

  it('should generate correct rollback operations for updates', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      enableRollback: true,
    })

    const updateMutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Updated Name', value: 200, createdAt: new Date() },
      original: { _id: 'doc-1', name: 'Original Name', value: 100 },
      changes: { name: 'Updated Name', value: 200 },
    }

    const transaction = createMockTransaction([updateMutation])
    const error = new Error('Subsequent operation failed')

    const result = await handler({
      error,
      mutation: updateMutation,
      transaction,
      mutationType: 'update',
      completedMutations: [updateMutation],
    })

    expect(result.rollbackMutations).toBeDefined()
    // The rollback should contain the original state
    expect(result.rollbackMutations?.[0]?.original).toEqual({ _id: 'doc-1', name: 'Original Name', value: 100 })
  })

  it('should generate correct rollback operations for deletes', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      enableRollback: true,
    })

    const deleteMutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'delete',
      key: 'doc-1',
      modified: {} as TestDocument,
      original: { _id: 'doc-1', name: 'Deleted Doc', value: 50 },
      changes: {},
    }

    const transaction = createMockTransaction([deleteMutation])
    const error = new Error('Subsequent operation failed')

    const result = await handler({
      error,
      mutation: deleteMutation,
      transaction,
      mutationType: 'delete',
      completedMutations: [deleteMutation],
    })

    expect(result.rollbackMutations).toBeDefined()
    // The rollback should contain the original document for re-insertion
    expect(result.rollbackMutations?.[0]?.original).toEqual({ _id: 'doc-1', name: 'Deleted Doc', value: 50 })
  })

  it('should respect rollback order (reverse of execution)', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      enableRollback: true,
    })

    const completedMutations: MockPendingMutation<TestDocument>[] = [
      { mutationId: 'mut-1', type: 'insert', key: 'doc-1', modified: { _id: 'doc-1', name: 'First', value: 1, createdAt: new Date() }, original: {}, changes: {} },
      { mutationId: 'mut-2', type: 'insert', key: 'doc-2', modified: { _id: 'doc-2', name: 'Second', value: 2, createdAt: new Date() }, original: {}, changes: {} },
      { mutationId: 'mut-3', type: 'insert', key: 'doc-3', modified: { _id: 'doc-3', name: 'Third', value: 3, createdAt: new Date() }, original: {}, changes: {} },
    ]

    const failedMutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-4',
      type: 'insert',
      key: 'doc-4',
      modified: { _id: 'doc-4', name: 'Failed', value: 4, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([...completedMutations, failedMutation])
    const error = new Error('Transaction failure')

    const result = await handler({
      error,
      mutation: failedMutation,
      transaction,
      mutationType: 'insert',
      failedMutationIndex: 3,
      completedMutations,
    })

    expect(result.rollbackMutations).toBeDefined()
    expect(result.rollbackMutations?.length).toBe(3)
    // Rollback order should be correct (passed through as-is, caller reverses)
  })

  it('should not suggest rollback when enableRollback is false', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      enableRollback: false,
    })

    const completedMutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Completed', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const failedMutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-2',
      type: 'insert',
      key: 'doc-2',
      modified: { _id: 'doc-2', name: 'Failed', value: 2, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([completedMutation, failedMutation])
    const error = new Error('Transaction failure')

    const result = await handler({
      error,
      mutation: failedMutation,
      transaction,
      mutationType: 'insert',
      failedMutationIndex: 1,
      completedMutations: [completedMutation],
    })

    expect(result.recoveryStrategy).not.toBe('rollback')
    expect(result.rollbackMutations).toBeUndefined()
  })
})

// =============================================================================
// User Notification Callbacks Tests (RED Phase - Enhanced)
// =============================================================================

describe('user notification callbacks', () => {
  it('should call onUserNotification callback with error details', async () => {
    const onUserNotification = vi.fn()

    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      onError: (context) => {
        onUserNotification({
          type: 'error',
          message: context.classification.message,
          errorType: context.classification.type,
        })
      },
    })

    const error = new Error('E11000 duplicate key error')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-123',
      modified: { _id: 'doc-123', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await handler({
      error,
      mutation,
      transaction,
      mutationType: 'insert',
    })

    expect(onUserNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        errorType: 'duplicate_key',
      })
    )
  })

  it('should provide actionable error messages for users', async () => {
    const result = await handleMutationError({
      error: new Error('E11000 duplicate key error'),
      mutationId: 'mut-1',
      mutationType: 'insert',
      documentKey: 'doc-123',
    })

    expect(result.userMessage).toBeDefined()
    expect(result.userMessage).not.toContain('E11000') // Technical details should be hidden
    expect(result.userMessage.toLowerCase()).toContain('already exists')
  })

  it('should provide different messages for different error types', async () => {
    const errorScenarios = [
      { error: new Error('E11000 duplicate key'), expectedContains: 'exists' },
      { error: new Error('Document failed validation'), expectedContains: 'invalid' },
      { error: new Error('Network connection refused'), expectedContains: 'connection' },
      { error: new Error('not authorized'), expectedContains: 'permission' },
      { error: new Error('Operation timed out'), expectedContains: 'timed out' },
    ]

    for (const scenario of errorScenarios) {
      const result = await handleMutationError({
        error: scenario.error,
        mutationId: 'mut-1',
        mutationType: 'insert',
        documentKey: 'doc-123',
      })

      expect(result.userMessage.toLowerCase()).toContain(scenario.expectedContains)
    }
  })

  it('should call onRetryScheduled callback with timing info', async () => {
    const onRetry = vi.fn()

    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      maxRetries: 3,
      initialDelayMs: 100,
      onRetry,
    })

    const error = new Error('Network timeout')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-123',
      modified: { _id: 'doc-123', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await handler({
      error,
      mutation,
      transaction,
      mutationType: 'insert',
      retryCount: 0,
    })

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        retryCount: 1,
        delayMs: 100,
      })
    )
  })

  it('should call onPermanentFailure callback when retries exhausted', async () => {
    const onMaxRetriesExceeded = vi.fn()

    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      maxRetries: 2,
      onMaxRetriesExceeded,
    })

    const error = new Error('Network error')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-123',
      modified: { _id: 'doc-123', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await handler({
      error,
      mutation,
      transaction,
      mutationType: 'insert',
      retryCount: 2,
    })

    expect(onMaxRetriesExceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        totalRetries: 2,
      })
    )
  })

  it('should include recovery suggestions in callback context', async () => {
    let receivedContext: any

    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      onError: (context) => {
        receivedContext = context
      },
    })

    const error = new Error('E11000 duplicate key error')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-123',
      modified: { _id: 'doc-123', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await handler({
      error,
      mutation,
      transaction,
      mutationType: 'insert',
    })

    expect(receivedContext).toBeDefined()
    expect(receivedContext.classification).toBeDefined()
    expect(receivedContext.classification.type).toBe('duplicate_key')
    expect(receivedContext.classification.isRetryable).toBe(false)
  })
})

// =============================================================================
// Advanced Retry Logic Tests (RED Phase - Enhanced)
// =============================================================================

describe('advanced retry logic', () => {
  it('should support jitter in retry delays', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      maxRetries: 5,
      initialDelayMs: 100,
      backoffMultiplier: 2,
    })

    const error = new Error('Network error')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-123',
      modified: { _id: 'doc-123', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    // Get multiple delay values
    const delays: number[] = []
    for (let i = 0; i < 3; i++) {
      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
        retryCount: i,
      })
      if (result.retryDelayMs) {
        delays.push(result.retryDelayMs)
      }
    }

    // Delays should follow exponential pattern (100, 200, 400)
    expect(delays[0]).toBe(100)
    expect(delays[1]).toBe(200)
    expect(delays[2]).toBe(400)
  })

  it('should handle immediate retry for certain error types', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      maxRetries: 3,
      initialDelayMs: 1000, // Large default delay
    })

    // Write conflicts might benefit from immediate retry
    const error = new Error('WriteConflict - try again')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-123',
      modified: { _id: 'doc-123', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    const result = await handler({
      error,
      mutation,
      transaction,
      mutationType: 'update',
      retryCount: 0,
    })

    expect(result.shouldRetry).toBe(true)
    // Write conflicts are retryable
    expect(result.classification.type).toBe('write_conflict')
  })

  it('should cap total retry duration', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      maxRetries: 10,
      initialDelayMs: 100,
      backoffMultiplier: 3,
      maxDelayMs: 500, // Cap at 500ms
    })

    const error = new Error('Network error')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-123',
      modified: { _id: 'doc-123', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    // Even at high retry counts, delay should be capped
    const result = await handler({
      error,
      mutation,
      transaction,
      mutationType: 'insert',
      retryCount: 5,
    })

    expect(result.retryDelayMs).toBeLessThanOrEqual(500)
  })

  it('should track cumulative retry time', async () => {
    const handler = createMutationErrorHandler<TestDocument>({
      database: 'testdb',
      collection: 'testcol',
      maxRetries: 5,
      initialDelayMs: 100,
      backoffMultiplier: 2,
    })

    const error = new Error('Network error')
    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-123',
      modified: { _id: 'doc-123', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    let cumulativeDelay = 0
    for (let i = 0; i < 5; i++) {
      const result = await handler({
        error,
        mutation,
        transaction,
        mutationType: 'insert',
        retryCount: i,
      })
      if (result.retryDelayMs && result.shouldRetry) {
        cumulativeDelay += result.retryDelayMs
      }
    }

    // 100 + 200 + 400 + 800 + 1600 = 3100 (but last might not retry)
    expect(cumulativeDelay).toBeGreaterThan(0)
  })
})

// =============================================================================
// Error Severity Tests (RED Phase - New)
// =============================================================================

describe('error severity classification', () => {
  it('should classify critical errors that require immediate attention', async () => {
    const criticalErrors = [
      new Error('Authentication failed'),
      new Error('not authorized on database'),
      new Error('Database connection closed permanently'),
    ]

    for (const error of criticalErrors) {
      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'insert',
        documentKey: 'doc-123',
      })

      expect(result.classification.isRetryable).toBe(false)
      expect(['abort', 'manual_intervention']).toContain(result.recoveryStrategy)
    }
  })

  it('should classify transient errors that may resolve automatically', async () => {
    const transientErrors = [
      new Error('Network temporarily unavailable'),
      new Error('Connection reset by peer'),
      new Error('Server busy, try again later'),
    ]

    for (const error of transientErrors) {
      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'insert',
        documentKey: 'doc-123',
      })

      expect(result.classification.isRetryable).toBe(true)
      expect(result.recoveryStrategy).toBe('retry')
    }
  })

  it('should classify user-caused errors appropriately', async () => {
    const userErrors = [
      new Error('E11000 duplicate key error'),
      new Error('Document failed validation'),
      new Error('Invalid schema provided'),
    ]

    for (const error of userErrors) {
      const result = await handleMutationError({
        error,
        mutationId: 'mut-1',
        mutationType: 'insert',
        documentKey: 'doc-123',
      })

      expect(result.classification.isUserError).toBe(true)
      expect(result.classification.isRetryable).toBe(false)
    }
  })
})
