/**
 * @file Batch Update Handler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the batch update mutation handler that handles
 * client-side batch update mutations and persists them to MongoDB via RPC.
 *
 * The batch update handler is called when multiple documents need to be updated
 * atomically via `collection.updateMany()` or bulk update operations.
 *
 * RED PHASE: These tests will fail until the batch update handler is implemented
 * in src/sync/handlers/batch-update-mutation.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createBatchUpdateMutationHandler,
  handleBatchUpdateMutation,
  type BatchUpdateMutationHandlerConfig,
  type BatchUpdateMutationContext,
  type BatchUpdateMutationResult,
  type BatchUpdateOperation,
} from '../../../src/sync/handlers/batch-update-mutation'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing batch update mutations.
 */
interface TestDocument {
  _id: string
  name: string
  value: number
  status: 'active' | 'inactive'
  updatedAt: Date
}

/**
 * Document with nested objects for testing complex structures.
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

/**
 * Minimal document for edge case testing.
 */
interface MinimalDocument {
  _id: string
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
// Handler Factory Tests
// =============================================================================

describe('createBatchUpdateMutationHandler', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createBatchUpdateMutationHandler).toBe('function')
    })

    it('should return a handler function', () => {
      const mockRpc = createMockRpcClient()
      const handler = createBatchUpdateMutationHandler({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
      })

      expect(typeof handler).toBe('function')
    })

    it('should throw when rpcClient is not provided', () => {
      expect(() =>
        createBatchUpdateMutationHandler({
          rpcClient: undefined as any,
          database: 'testdb',
          collection: 'testcol',
        })
      ).toThrow('rpcClient is required')
    })

    it('should throw when database is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createBatchUpdateMutationHandler({
          rpcClient: mockRpc,
          database: '',
          collection: 'testcol',
        })
      ).toThrow('database is required')
    })

    it('should throw when collection is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createBatchUpdateMutationHandler({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: '',
        })
      ).toThrow('collection is required')
    })
  })

  describe('handler execution', () => {
    let mockRpc: MockRpcClient
    let handler: ReturnType<typeof createBatchUpdateMutationHandler<TestDocument>>

    beforeEach(() => {
      mockRpc = createMockRpcClient()
      mockRpc.rpc.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 })
      handler = createBatchUpdateMutationHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
      })
    })

    it('should call RPC with correct method for single update', async () => {
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'update',
        key: 'doc-123',
        modified: {
          _id: 'doc-123',
          name: 'Updated Doc',
          value: 100,
          status: 'active',
          updatedAt: new Date(),
        },
        original: {
          _id: 'doc-123',
          name: 'Original Doc',
          value: 42,
          status: 'inactive',
        },
        changes: {
          name: 'Updated Doc',
          value: 100,
          status: 'active',
        },
      }

      const transaction = createMockTransaction([mutation])

      await handler({ transaction })

      expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
        database: 'testdb',
        collection: 'testcol',
        filter: { _id: 'doc-123' },
        update: { $set: mutation.changes },
      })
    })

    it('should call RPC with bulkWrite for multiple updates', async () => {
      const mutations: MockPendingMutation<TestDocument>[] = [
        {
          mutationId: 'mut-1',
          type: 'update',
          key: 'doc-1',
          modified: {
            _id: 'doc-1',
            name: 'Doc 1 Updated',
            value: 10,
            status: 'active',
            updatedAt: new Date(),
          },
          original: { _id: 'doc-1', name: 'Doc 1', value: 1 },
          changes: { name: 'Doc 1 Updated', value: 10 },
        },
        {
          mutationId: 'mut-2',
          type: 'update',
          key: 'doc-2',
          modified: {
            _id: 'doc-2',
            name: 'Doc 2 Updated',
            value: 20,
            status: 'inactive',
            updatedAt: new Date(),
          },
          original: { _id: 'doc-2', name: 'Doc 2', value: 2 },
          changes: { name: 'Doc 2 Updated', value: 20 },
        },
      ]

      const transaction = createMockTransaction(mutations)
      mockRpc.rpc.mockResolvedValue({ modifiedCount: 2, matchedCount: 2 })

      await handler({ transaction })

      expect(mockRpc.rpc).toHaveBeenCalledWith('bulkWrite', {
        database: 'testdb',
        collection: 'testcol',
        operations: [
          {
            updateOne: {
              filter: { _id: 'doc-1' },
              update: { $set: { name: 'Doc 1 Updated', value: 10 } },
            },
          },
          {
            updateOne: {
              filter: { _id: 'doc-2' },
              update: { $set: { name: 'Doc 2 Updated', value: 20 } },
            },
          },
        ],
      })
    })

    it('should handle empty mutations array', async () => {
      const transaction = createMockTransaction<TestDocument>([])

      await expect(handler({ transaction })).resolves.not.toThrow()
      expect(mockRpc.rpc).not.toHaveBeenCalled()
    })

    it('should only process update type mutations', async () => {
      const mutations: MockPendingMutation<TestDocument>[] = [
        {
          mutationId: 'mut-1',
          type: 'update',
          key: 'doc-1',
          modified: {
            _id: 'doc-1',
            name: 'Update',
            value: 1,
            status: 'active',
            updatedAt: new Date(),
          },
          original: { _id: 'doc-1', name: 'Original', value: 0 },
          changes: { name: 'Update', value: 1 },
        },
        {
          mutationId: 'mut-2',
          type: 'insert' as any,
          key: 'doc-2',
          modified: {
            _id: 'doc-2',
            name: 'Insert',
            value: 2,
            status: 'active',
            updatedAt: new Date(),
          },
          original: {},
          changes: {},
        },
      ]

      const transaction = createMockTransaction(mutations)

      await handler({ transaction })

      // Should only call updateOne for the update mutation
      expect(mockRpc.rpc).toHaveBeenCalledTimes(1)
      expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
        database: 'testdb',
        collection: 'testcol',
        filter: { _id: 'doc-1' },
        update: { $set: { name: 'Update', value: 1 } },
      })
    })
  })
})

// =============================================================================
// Direct Handler Function Tests
// =============================================================================

describe('handleBatchUpdateMutation', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 })
  })

  describe('basic functionality', () => {
    it('should be a function', () => {
      expect(typeof handleBatchUpdateMutation).toBe('function')
    })

    it('should update a single document by ID', async () => {
      const operation: BatchUpdateOperation = {
        filter: { _id: 'doc-123' },
        update: { $set: { name: 'Updated', value: 100 } },
      }

      const result = await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [operation],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
        database: 'testdb',
        collection: 'users',
        filter: { _id: 'doc-123' },
        update: { $set: { name: 'Updated', value: 100 } },
      })
      expect(result.success).toBe(true)
      expect(result.modifiedCount).toBe(1)
    })

    it('should handle updateMany with filter', async () => {
      const operation: BatchUpdateOperation = {
        filter: { status: 'inactive' },
        update: { $set: { status: 'active' } },
        updateMany: true,
      }

      mockRpc.rpc.mockResolvedValue({ modifiedCount: 5, matchedCount: 5 })

      const result = await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [operation],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('updateMany', {
        database: 'testdb',
        collection: 'users',
        filter: { status: 'inactive' },
        update: { $set: { status: 'active' } },
      })
      expect(result.success).toBe(true)
      expect(result.modifiedCount).toBe(5)
    })

    it('should execute multiple operations via bulkWrite', async () => {
      const operations: BatchUpdateOperation[] = [
        {
          filter: { _id: 'doc-1' },
          update: { $set: { name: 'Doc 1 Updated' } },
        },
        {
          filter: { _id: 'doc-2' },
          update: { $set: { name: 'Doc 2 Updated' } },
        },
        {
          filter: { _id: 'doc-3' },
          update: { $inc: { value: 10 } },
        },
      ]

      mockRpc.rpc.mockResolvedValue({ modifiedCount: 3, matchedCount: 3 })

      const result = await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations,
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('bulkWrite', {
        database: 'testdb',
        collection: 'users',
        operations: [
          { updateOne: { filter: { _id: 'doc-1' }, update: { $set: { name: 'Doc 1 Updated' } } } },
          { updateOne: { filter: { _id: 'doc-2' }, update: { $set: { name: 'Doc 2 Updated' } } } },
          { updateOne: { filter: { _id: 'doc-3' }, update: { $inc: { value: 10 } } } },
        ],
      })
      expect(result.success).toBe(true)
      expect(result.modifiedCount).toBe(3)
    })

    it('should return success false on RPC error', async () => {
      mockRpc.rpc.mockRejectedValue(new Error('MongoDB connection failed'))

      const result = await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [{ filter: { _id: 'doc-1' }, update: { $set: { name: 'Test' } } }],
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toBe('MongoDB connection failed')
    })
  })

  describe('MongoDB update operators', () => {
    it('should handle $set operator', async () => {
      const operation: BatchUpdateOperation = {
        filter: { _id: 'doc-1' },
        update: { $set: { name: 'New Name', 'nested.field': 'value' } },
      }

      await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [operation],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
        database: 'testdb',
        collection: 'users',
        filter: { _id: 'doc-1' },
        update: { $set: { name: 'New Name', 'nested.field': 'value' } },
      })
    })

    it('should handle $unset operator', async () => {
      const operation: BatchUpdateOperation = {
        filter: { _id: 'doc-1' },
        update: { $unset: { obsoleteField: '' } },
      }

      await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [operation],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
        database: 'testdb',
        collection: 'users',
        filter: { _id: 'doc-1' },
        update: { $unset: { obsoleteField: '' } },
      })
    })

    it('should handle $inc operator', async () => {
      const operation: BatchUpdateOperation = {
        filter: { _id: 'doc-1' },
        update: { $inc: { value: 5, 'stats.count': 1 } },
      }

      await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [operation],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
        database: 'testdb',
        collection: 'users',
        filter: { _id: 'doc-1' },
        update: { $inc: { value: 5, 'stats.count': 1 } },
      })
    })

    it('should handle $push operator', async () => {
      const operation: BatchUpdateOperation = {
        filter: { _id: 'doc-1' },
        update: { $push: { tags: 'new-tag' } },
      }

      await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [operation],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
        database: 'testdb',
        collection: 'users',
        filter: { _id: 'doc-1' },
        update: { $push: { tags: 'new-tag' } },
      })
    })

    it('should handle $pull operator', async () => {
      const operation: BatchUpdateOperation = {
        filter: { _id: 'doc-1' },
        update: { $pull: { tags: 'old-tag' } },
      }

      await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [operation],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
        database: 'testdb',
        collection: 'users',
        filter: { _id: 'doc-1' },
        update: { $pull: { tags: 'old-tag' } },
      })
    })

    it('should handle $addToSet operator', async () => {
      const operation: BatchUpdateOperation = {
        filter: { _id: 'doc-1' },
        update: { $addToSet: { categories: 'new-category' } },
      }

      await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [operation],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
        database: 'testdb',
        collection: 'users',
        filter: { _id: 'doc-1' },
        update: { $addToSet: { categories: 'new-category' } },
      })
    })

    it('should handle combined operators', async () => {
      const operation: BatchUpdateOperation = {
        filter: { _id: 'doc-1' },
        update: {
          $set: { name: 'Updated Name' },
          $inc: { version: 1 },
          $push: { history: { action: 'update', timestamp: Date.now() } },
        },
      }

      await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [operation],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
        database: 'testdb',
        collection: 'users',
        filter: { _id: 'doc-1' },
        update: operation.update,
      })
    })
  })

  describe('input validation', () => {
    it('should throw when operations is null', async () => {
      await expect(
        handleBatchUpdateMutation<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          operations: null as any,
        })
      ).rejects.toThrow('operations is required')
    })

    it('should throw when operations is undefined', async () => {
      await expect(
        handleBatchUpdateMutation<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          operations: undefined as any,
        })
      ).rejects.toThrow('operations is required')
    })

    it('should throw when operations array is empty', async () => {
      await expect(
        handleBatchUpdateMutation<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          operations: [],
        })
      ).rejects.toThrow('operations array cannot be empty')
    })

    it('should throw when operation has no filter', async () => {
      await expect(
        handleBatchUpdateMutation<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          operations: [{ filter: null as any, update: { $set: { name: 'test' } } }],
        })
      ).rejects.toThrow('filter is required for each operation')
    })

    it('should throw when operation has no update', async () => {
      await expect(
        handleBatchUpdateMutation<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          operations: [{ filter: { _id: 'doc-1' }, update: null as any }],
        })
      ).rejects.toThrow('update is required for each operation')
    })
  })

  describe('upsert support', () => {
    it('should pass upsert option when specified', async () => {
      const operation: BatchUpdateOperation = {
        filter: { _id: 'doc-1' },
        update: { $set: { name: 'New Doc' } },
        upsert: true,
      }

      mockRpc.rpc.mockResolvedValue({ modifiedCount: 0, upsertedCount: 1, upsertedId: 'doc-1' })

      const result = await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [operation],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
        database: 'testdb',
        collection: 'users',
        filter: { _id: 'doc-1' },
        update: { $set: { name: 'New Doc' } },
        upsert: true,
      })
      expect(result.success).toBe(true)
      expect(result.upsertedCount).toBe(1)
    })

    it('should handle mixed upsert operations in bulkWrite', async () => {
      const operations: BatchUpdateOperation[] = [
        {
          filter: { _id: 'doc-1' },
          update: { $set: { name: 'Existing' } },
          upsert: false,
        },
        {
          filter: { _id: 'doc-2' },
          update: { $set: { name: 'New or Update' } },
          upsert: true,
        },
      ]

      mockRpc.rpc.mockResolvedValue({ modifiedCount: 1, upsertedCount: 1 })

      await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations,
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('bulkWrite', {
        database: 'testdb',
        collection: 'users',
        operations: [
          { updateOne: { filter: { _id: 'doc-1' }, update: { $set: { name: 'Existing' } }, upsert: false } },
          { updateOne: { filter: { _id: 'doc-2' }, update: { $set: { name: 'New or Update' } }, upsert: true } },
        ],
      })
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('error handling', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
  })

  describe('write concern errors', () => {
    it('should identify write concern errors', async () => {
      const writeConcernError = new Error('Write concern error: not enough data-bearing nodes')
      mockRpc.rpc.mockRejectedValue(writeConcernError)

      const result = await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [{ filter: { _id: 'doc-1' }, update: { $set: { name: 'test' } } }],
      })

      expect(result.success).toBe(false)
      expect(result.isWriteConcernError).toBe(true)
    })
  })

  describe('network errors', () => {
    it('should handle connection timeout', async () => {
      const timeoutError = new Error('Connection timed out')
      mockRpc.rpc.mockRejectedValue(timeoutError)

      const result = await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [{ filter: { _id: 'doc-1' }, update: { $set: { name: 'test' } } }],
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Connection timed out')
    })

    it('should handle disconnected client', async () => {
      mockRpc.isConnected.mockReturnValue(false)

      const result = await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [{ filter: { _id: 'doc-1' }, update: { $set: { name: 'test' } } }],
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('not connected')
    })
  })

  describe('validation errors', () => {
    it('should handle schema validation errors from MongoDB', async () => {
      const validationError = new Error('Document failed validation')
      mockRpc.rpc.mockRejectedValue(validationError)

      const result = await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [{ filter: { _id: 'doc-1' }, update: { $set: { name: 'test' } } }],
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Document failed validation')
    })
  })

  describe('partial failure handling', () => {
    it('should report partial success in bulkWrite', async () => {
      mockRpc.rpc.mockResolvedValue({
        modifiedCount: 2,
        matchedCount: 3,
        writeErrors: [
          { index: 1, code: 11000, errmsg: 'Duplicate key error' },
        ],
      })

      const result = await handleBatchUpdateMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        operations: [
          { filter: { _id: 'doc-1' }, update: { $set: { name: 'A' } } },
          { filter: { _id: 'doc-2' }, update: { $set: { name: 'B' } } },
          { filter: { _id: 'doc-3' }, update: { $set: { name: 'C' } } },
        ],
      })

      expect(result.success).toBe(true) // Partial success
      expect(result.modifiedCount).toBe(2)
      expect(result.hasWriteErrors).toBe(true)
      expect(result.writeErrors).toHaveLength(1)
    })
  })
})

// =============================================================================
// Retry Logic Tests
// =============================================================================

describe('retry logic', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
  })

  it('should retry on transient errors', async () => {
    // First call fails, second succeeds
    mockRpc.rpc
      .mockRejectedValueOnce(new Error('Network temporarily unavailable'))
      .mockResolvedValueOnce({ modifiedCount: 1, matchedCount: 1 })

    const handler = createBatchUpdateMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      retryConfig: {
        maxRetries: 3,
        initialDelayMs: 10,
      },
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, status: 'active', updatedAt: new Date() },
      original: { _id: 'doc-1', name: 'Original', value: 0 },
      changes: { name: 'Test', value: 1 },
    }

    const transaction = createMockTransaction([mutation])

    await expect(handler({ transaction })).resolves.not.toThrow()
    expect(mockRpc.rpc).toHaveBeenCalledTimes(2)
  })

  it('should not retry on non-retryable errors', async () => {
    mockRpc.rpc.mockRejectedValue(new Error('Document failed validation'))

    const handler = createBatchUpdateMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      retryConfig: {
        maxRetries: 3,
        initialDelayMs: 10,
      },
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, status: 'active', updatedAt: new Date() },
      original: { _id: 'doc-1', name: 'Original', value: 0 },
      changes: { name: 'Test', value: 1 },
    }

    const transaction = createMockTransaction([mutation])

    await expect(handler({ transaction })).rejects.toThrow('validation')
    // Should only try once - no retries for validation errors
    expect(mockRpc.rpc).toHaveBeenCalledTimes(1)
  })

  it('should respect maxRetries limit', async () => {
    mockRpc.rpc.mockRejectedValue(new Error('Network error'))

    const handler = createBatchUpdateMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      retryConfig: {
        maxRetries: 2,
        initialDelayMs: 10,
      },
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, status: 'active', updatedAt: new Date() },
      original: { _id: 'doc-1', name: 'Original', value: 0 },
      changes: { name: 'Test', value: 1 },
    }

    const transaction = createMockTransaction([mutation])

    await expect(handler({ transaction })).rejects.toThrow('Network error')
    // Initial attempt + 2 retries = 3 total
    expect(mockRpc.rpc).toHaveBeenCalledTimes(3)
  })
})

// =============================================================================
// Hooks and Callbacks Tests
// =============================================================================

describe('hooks and callbacks', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 })
  })

  it('should call onBeforeUpdate hook', async () => {
    const onBeforeUpdate = vi.fn()

    const handler = createBatchUpdateMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      onBeforeUpdate,
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, status: 'active', updatedAt: new Date() },
      original: { _id: 'doc-1', name: 'Original', value: 0 },
      changes: { name: 'Test', value: 1 },
    }

    const transaction = createMockTransaction([mutation])

    await handler({ transaction })

    expect(onBeforeUpdate).toHaveBeenCalledWith({
      operations: expect.any(Array),
      transaction,
    })
  })

  it('should call onAfterUpdate hook', async () => {
    const onAfterUpdate = vi.fn()

    const handler = createBatchUpdateMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      onAfterUpdate,
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, status: 'active', updatedAt: new Date() },
      original: { _id: 'doc-1', name: 'Original', value: 0 },
      changes: { name: 'Test', value: 1 },
    }

    const transaction = createMockTransaction([mutation])

    await handler({ transaction })

    expect(onAfterUpdate).toHaveBeenCalledWith({
      operations: expect.any(Array),
      result: { modifiedCount: 1, matchedCount: 1 },
      transaction,
    })
  })

  it('should call onError hook on failure', async () => {
    const error = new Error('Update failed')
    mockRpc.rpc.mockRejectedValue(error)
    const onError = vi.fn()

    const handler = createBatchUpdateMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      onError,
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, status: 'active', updatedAt: new Date() },
      original: { _id: 'doc-1', name: 'Original', value: 0 },
      changes: { name: 'Test', value: 1 },
    }

    const transaction = createMockTransaction([mutation])

    await expect(handler({ transaction })).rejects.toThrow()

    expect(onError).toHaveBeenCalledWith({
      error,
      operations: expect.any(Array),
      transaction,
    })
  })

  it('should allow onBeforeUpdate to transform operations', async () => {
    const onBeforeUpdate = vi.fn().mockImplementation(({ operations }) => {
      return operations.map((op: any) => ({
        ...op,
        update: {
          ...op.update,
          $set: {
            ...op.update.$set,
            transformedAt: new Date(),
          },
        },
      }))
    })

    const handler = createBatchUpdateMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      onBeforeUpdate,
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, status: 'active', updatedAt: new Date() },
      original: { _id: 'doc-1', name: 'Original', value: 0 },
      changes: { name: 'Test', value: 1 },
    }

    const transaction = createMockTransaction([mutation])

    await handler({ transaction })

    expect(mockRpc.rpc).toHaveBeenCalledWith(
      'updateOne',
      expect.objectContaining({
        update: expect.objectContaining({
          $set: expect.objectContaining({
            transformedAt: expect.any(Date),
          }),
        }),
      })
    )
  })
})

// =============================================================================
// Options Handling Tests
// =============================================================================

describe('options handling', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 })
  })

  it('should pass ordered option for bulkWrite', async () => {
    const operations: BatchUpdateOperation[] = [
      { filter: { _id: 'doc-1' }, update: { $set: { name: 'A' } } },
      { filter: { _id: 'doc-2' }, update: { $set: { name: 'B' } } },
    ]

    await handleBatchUpdateMutation<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      operations,
      options: { ordered: false },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('bulkWrite', {
      database: 'testdb',
      collection: 'users',
      operations: expect.any(Array),
      options: { ordered: false },
    })
  })

  it('should pass writeConcern option', async () => {
    await handleBatchUpdateMutation<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      operations: [{ filter: { _id: 'doc-1' }, update: { $set: { name: 'test' } } }],
      options: { writeConcern: { w: 'majority' } },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
      database: 'testdb',
      collection: 'users',
      filter: { _id: 'doc-1' },
      update: { $set: { name: 'test' } },
      options: { writeConcern: { w: 'majority' } },
    })
  })

  it('should pass arrayFilters option', async () => {
    const operation: BatchUpdateOperation = {
      filter: { _id: 'doc-1' },
      update: { $set: { 'items.$[elem].status': 'completed' } },
      arrayFilters: [{ 'elem.status': 'pending' }],
    }

    await handleBatchUpdateMutation<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      operations: [operation],
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
      database: 'testdb',
      collection: 'users',
      filter: { _id: 'doc-1' },
      update: { $set: { 'items.$[elem].status': 'completed' } },
      arrayFilters: [{ 'elem.status': 'pending' }],
    })
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('type safety', () => {
  it('should maintain generic type through handler', async () => {
    const mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 })

    // This test verifies TypeScript compilation
    const handler = createBatchUpdateMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'update',
      key: 'doc-1',
      modified: {
        _id: 'doc-1',
        name: 'Test',
        value: 42,
        status: 'active',
        updatedAt: new Date(),
      },
      original: { _id: 'doc-1', name: 'Original', value: 0 },
      changes: { name: 'Test', value: 42 },
    }

    const transaction = createMockTransaction([mutation])

    await expect(handler({ transaction })).resolves.not.toThrow()
  })
})

// =============================================================================
// Integration with TanStack DB Tests
// =============================================================================

describe('TanStack DB integration', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 })
  })

  it('should work with TransactionWithMutations interface', async () => {
    const handler = createBatchUpdateMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
    })

    // Simulate what TanStack DB passes to onUpdate
    const mockTanStackTransaction = {
      id: 'tx-123',
      mutations: [
        {
          mutationId: 'mut-1',
          type: 'update' as const,
          key: 'doc-1',
          globalKey: 'KEY::users/doc-1',
          modified: {
            _id: 'doc-1',
            name: 'TanStack Test Updated',
            value: 100,
            status: 'active' as const,
            updatedAt: new Date(),
          },
          original: {
            _id: 'doc-1',
            name: 'TanStack Test',
            value: 50,
            status: 'inactive' as const,
          },
          changes: {
            name: 'TanStack Test Updated',
            value: 100,
            status: 'active',
          },
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
      handler({ transaction: mockTanStackTransaction as any })
    ).resolves.not.toThrow()

    expect(mockRpc.rpc).toHaveBeenCalled()
  })

  it('should extract correct data from TanStack mutation format', async () => {
    const handler = createBatchUpdateMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
    })

    const mockTanStackTransaction = {
      id: 'tx-456',
      mutations: [
        {
          mutationId: 'mut-2',
          type: 'update' as const,
          key: 'user-789',
          globalKey: 'KEY::users/user-789',
          modified: {
            _id: 'user-789',
            name: 'Jane Doe Updated',
            value: 200,
            status: 'active' as const,
            updatedAt: new Date(),
          },
          original: {
            _id: 'user-789',
            name: 'Jane Doe',
            value: 100,
            status: 'inactive' as const,
          },
          changes: {
            name: 'Jane Doe Updated',
            value: 200,
            status: 'active',
          },
          metadata: { source: 'client' },
          syncMetadata: { version: 1 },
          optimistic: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      getMutations: function () {
        return this.mutations
      },
    }

    await handler({ transaction: mockTanStackTransaction as any })

    expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
      database: 'testdb',
      collection: 'users',
      filter: { _id: 'user-789' },
      update: {
        $set: {
          name: 'Jane Doe Updated',
          value: 200,
          status: 'active',
        },
      },
    })
  })

  it('should handle multiple batch updates from TanStack transaction', async () => {
    const handler = createBatchUpdateMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
    })

    mockRpc.rpc.mockResolvedValue({ modifiedCount: 3, matchedCount: 3 })

    const mockTanStackTransaction = {
      id: 'tx-789',
      mutations: [
        {
          mutationId: 'mut-1',
          type: 'update' as const,
          key: 'doc-1',
          modified: { _id: 'doc-1', name: 'A Updated', value: 10, status: 'active' as const, updatedAt: new Date() },
          original: { _id: 'doc-1', name: 'A', value: 1 },
          changes: { name: 'A Updated', value: 10 },
        },
        {
          mutationId: 'mut-2',
          type: 'update' as const,
          key: 'doc-2',
          modified: { _id: 'doc-2', name: 'B Updated', value: 20, status: 'active' as const, updatedAt: new Date() },
          original: { _id: 'doc-2', name: 'B', value: 2 },
          changes: { name: 'B Updated', value: 20 },
        },
        {
          mutationId: 'mut-3',
          type: 'update' as const,
          key: 'doc-3',
          modified: { _id: 'doc-3', name: 'C Updated', value: 30, status: 'active' as const, updatedAt: new Date() },
          original: { _id: 'doc-3', name: 'C', value: 3 },
          changes: { name: 'C Updated', value: 30 },
        },
      ],
      getMutations: function () {
        return this.mutations
      },
    }

    await handler({ transaction: mockTanStackTransaction as any })

    expect(mockRpc.rpc).toHaveBeenCalledWith('bulkWrite', {
      database: 'testdb',
      collection: 'users',
      operations: [
        { updateOne: { filter: { _id: 'doc-1' }, update: { $set: { name: 'A Updated', value: 10 } } } },
        { updateOne: { filter: { _id: 'doc-2' }, update: { $set: { name: 'B Updated', value: 20 } } } },
        { updateOne: { filter: { _id: 'doc-3' }, update: { $set: { name: 'C Updated', value: 30 } } } },
      ],
    })
  })
})
