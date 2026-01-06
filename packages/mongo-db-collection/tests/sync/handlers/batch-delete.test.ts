/**
 * @file Batch Delete Handler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the batch delete handler that handles
 * batched client-side delete mutations and persists them to MongoDB via RPC.
 *
 * The batch delete handler is called when multiple documents need to be deleted
 * efficiently using MongoDB's bulkWrite operation.
 *
 * RED PHASE: These tests will fail until the batch delete handler is implemented
 * in src/sync/handlers/batch-delete.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createBatchDeleteHandler,
  handleBatchDelete,
  type BatchDeleteHandlerConfig,
  type BatchDeleteContext,
  type BatchDeleteResult,
  type BatchDeleteItem,
} from '../../../src/sync/handlers/batch-delete'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing batch delete operations.
 */
interface TestDocument {
  _id: string
  name: string
  value: number
  createdAt: Date
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

describe('createBatchDeleteHandler', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createBatchDeleteHandler).toBe('function')
    })

    it('should return a handler function', () => {
      const mockRpc = createMockRpcClient()
      const handler = createBatchDeleteHandler({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
      })

      expect(typeof handler).toBe('function')
    })

    it('should throw when rpcClient is not provided', () => {
      expect(() =>
        createBatchDeleteHandler({
          rpcClient: undefined as any,
          database: 'testdb',
          collection: 'testcol',
        })
      ).toThrow('rpcClient is required')
    })

    it('should throw when database is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createBatchDeleteHandler({
          rpcClient: mockRpc,
          database: '',
          collection: 'testcol',
        })
      ).toThrow('database is required')
    })

    it('should throw when collection is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createBatchDeleteHandler({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: '',
        })
      ).toThrow('collection is required')
    })
  })

  describe('handler execution', () => {
    let mockRpc: MockRpcClient
    let handler: ReturnType<typeof createBatchDeleteHandler<TestDocument>>

    beforeEach(() => {
      mockRpc = createMockRpcClient()
      mockRpc.rpc.mockResolvedValue({ deletedCount: 1 })
      handler = createBatchDeleteHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
      })
    })

    it('should call RPC with bulkWrite for multiple deletes', async () => {
      const mutations: MockPendingMutation<TestDocument>[] = [
        {
          mutationId: 'mut-1',
          type: 'delete',
          key: 'doc-1',
          modified: {} as TestDocument,
          original: { _id: 'doc-1', name: 'Doc 1', value: 1, createdAt: new Date() },
          changes: {},
        },
        {
          mutationId: 'mut-2',
          type: 'delete',
          key: 'doc-2',
          modified: {} as TestDocument,
          original: { _id: 'doc-2', name: 'Doc 2', value: 2, createdAt: new Date() },
          changes: {},
        },
        {
          mutationId: 'mut-3',
          type: 'delete',
          key: 'doc-3',
          modified: {} as TestDocument,
          original: { _id: 'doc-3', name: 'Doc 3', value: 3, createdAt: new Date() },
          changes: {},
        },
      ]

      const transaction = createMockTransaction(mutations)
      mockRpc.rpc.mockResolvedValue({ deletedCount: 3 })

      await handler({ transaction })

      expect(mockRpc.rpc).toHaveBeenCalledWith('bulkWrite', {
        database: 'testdb',
        collection: 'testcol',
        operations: [
          { deleteOne: { filter: { _id: 'doc-1' } } },
          { deleteOne: { filter: { _id: 'doc-2' } } },
          { deleteOne: { filter: { _id: 'doc-3' } } },
        ],
      })
    })

    it('should handle empty mutations array', async () => {
      const transaction = createMockTransaction<TestDocument>([])

      await expect(handler({ transaction })).resolves.not.toThrow()
      expect(mockRpc.rpc).not.toHaveBeenCalled()
    })

    it('should only process delete type mutations', async () => {
      const mutations: MockPendingMutation<TestDocument>[] = [
        {
          mutationId: 'mut-1',
          type: 'delete',
          key: 'doc-1',
          modified: {} as TestDocument,
          original: { _id: 'doc-1', name: 'Delete', value: 1, createdAt: new Date() },
          changes: {},
        },
        {
          mutationId: 'mut-2',
          type: 'update' as any,
          key: 'doc-2',
          modified: { _id: 'doc-2', name: 'Update', value: 2, createdAt: new Date() },
          original: {},
          changes: {},
        },
        {
          mutationId: 'mut-3',
          type: 'insert' as any,
          key: 'doc-3',
          modified: { _id: 'doc-3', name: 'Insert', value: 3, createdAt: new Date() },
          original: {},
          changes: {},
        },
      ]

      const transaction = createMockTransaction(mutations)
      mockRpc.rpc.mockResolvedValue({ deletedCount: 1 })

      await handler({ transaction })

      // Should use deleteOne since only one delete mutation exists
      expect(mockRpc.rpc).toHaveBeenCalledWith('deleteOne', {
        database: 'testdb',
        collection: 'testcol',
        filter: { _id: 'doc-1' },
      })
    })

    it('should use deleteOne for single delete', async () => {
      const mutation: MockPendingMutation<TestDocument> = {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-123',
        modified: {} as TestDocument,
        original: {
          _id: 'doc-123',
          name: 'Test Doc',
          value: 42,
          createdAt: new Date(),
        },
        changes: {},
      }

      const transaction = createMockTransaction([mutation])

      await handler({ transaction })

      expect(mockRpc.rpc).toHaveBeenCalledWith('deleteOne', {
        database: 'testdb',
        collection: 'testcol',
        filter: { _id: 'doc-123' },
      })
    })

    it('should use bulkWrite for large batches', async () => {
      const mutations: MockPendingMutation<TestDocument>[] = Array.from(
        { length: 100 },
        (_, i) => ({
          mutationId: `mut-${i}`,
          type: 'delete' as const,
          key: `doc-${i}`,
          modified: {} as TestDocument,
          original: {
            _id: `doc-${i}`,
            name: `Doc ${i}`,
            value: i,
            createdAt: new Date(),
          },
          changes: {},
        })
      )

      const transaction = createMockTransaction(mutations)
      mockRpc.rpc.mockResolvedValue({ deletedCount: 100 })

      await handler({ transaction })

      expect(mockRpc.rpc).toHaveBeenCalledWith(
        'bulkWrite',
        expect.objectContaining({
          database: 'testdb',
          collection: 'testcol',
          operations: expect.arrayContaining([
            { deleteOne: { filter: { _id: 'doc-0' } } },
            { deleteOne: { filter: { _id: 'doc-99' } } },
          ]),
        })
      )
    })
  })
})

// =============================================================================
// Direct Handler Function Tests
// =============================================================================

describe('handleBatchDelete', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ deletedCount: 1 })
  })

  describe('basic functionality', () => {
    it('should be a function', () => {
      expect(typeof handleBatchDelete).toBe('function')
    })

    it('should delete a single document', async () => {
      const item: BatchDeleteItem = {
        key: 'doc-123',
      }

      const result = await handleBatchDelete<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        items: [item],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('deleteOne', {
        database: 'testdb',
        collection: 'users',
        filter: { _id: 'doc-123' },
      })
      expect(result.success).toBe(true)
      expect(result.deletedCount).toBe(1)
    })

    it('should delete multiple documents using bulkWrite', async () => {
      const items: BatchDeleteItem[] = [
        { key: 'doc-1' },
        { key: 'doc-2' },
        { key: 'doc-3' },
      ]

      mockRpc.rpc.mockResolvedValue({ deletedCount: 3 })

      const result = await handleBatchDelete<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        items,
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('bulkWrite', {
        database: 'testdb',
        collection: 'users',
        operations: [
          { deleteOne: { filter: { _id: 'doc-1' } } },
          { deleteOne: { filter: { _id: 'doc-2' } } },
          { deleteOne: { filter: { _id: 'doc-3' } } },
        ],
      })
      expect(result.success).toBe(true)
      expect(result.deletedCount).toBe(3)
      expect(result.deletedIds).toEqual(['doc-1', 'doc-2', 'doc-3'])
    })

    it('should return success false on RPC error', async () => {
      mockRpc.rpc.mockRejectedValue(new Error('MongoDB connection failed'))

      const result = await handleBatchDelete<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        items: [{ key: 'doc-1' }],
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toBe('MongoDB connection failed')
    })
  })

  describe('input validation', () => {
    it('should throw when items array is empty', async () => {
      await expect(
        handleBatchDelete<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          items: [],
        })
      ).rejects.toThrow('items array cannot be empty')
    })

    it('should throw when items is null', async () => {
      await expect(
        handleBatchDelete<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          items: null as any,
        })
      ).rejects.toThrow('items is required')
    })

    it('should throw when items is undefined', async () => {
      await expect(
        handleBatchDelete<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          items: undefined as any,
        })
      ).rejects.toThrow('items is required')
    })
  })

  describe('filter support', () => {
    it('should support custom filter in batch items', async () => {
      const items: BatchDeleteItem[] = [
        { key: 'doc-1', filter: { status: 'inactive' } },
        { key: 'doc-2', filter: { status: 'archived' } },
      ]

      mockRpc.rpc.mockResolvedValue({ deletedCount: 2 })

      await handleBatchDelete<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        items,
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('bulkWrite', {
        database: 'testdb',
        collection: 'users',
        operations: [
          { deleteOne: { filter: { _id: 'doc-1', status: 'inactive' } } },
          { deleteOne: { filter: { _id: 'doc-2', status: 'archived' } } },
        ],
      })
    })
  })

  describe('options handling', () => {
    it('should pass ordered option', async () => {
      const items: BatchDeleteItem[] = [
        { key: 'doc-1' },
        { key: 'doc-2' },
      ]

      mockRpc.rpc.mockResolvedValue({ deletedCount: 2 })

      await handleBatchDelete<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        items,
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
      const items: BatchDeleteItem[] = [
        { key: 'doc-1' },
        { key: 'doc-2' },
      ]

      mockRpc.rpc.mockResolvedValue({ deletedCount: 2 })

      await handleBatchDelete<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        items,
        options: { writeConcern: { w: 'majority' } },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('bulkWrite', {
        database: 'testdb',
        collection: 'users',
        operations: expect.any(Array),
        options: { writeConcern: { w: 'majority' } },
      })
    })
  })

  describe('connection handling', () => {
    it('should handle disconnected client', async () => {
      mockRpc.isConnected.mockReturnValue(false)

      const result = await handleBatchDelete<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        items: [{ key: 'doc-1' }],
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('not connected')
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

  describe('partial failure', () => {
    it('should identify partial failures in batch operations', async () => {
      const writeError = new Error('BulkWriteError: 2 write errors')
      mockRpc.rpc.mockRejectedValue(writeError)

      const result = await handleBatchDelete<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        items: [{ key: 'doc-1' }, { key: 'doc-2' }, { key: 'doc-3' }],
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('BulkWriteError')
    })
  })

  describe('network errors', () => {
    it('should handle connection timeout', async () => {
      const timeoutError = new Error('Connection timed out')
      mockRpc.rpc.mockRejectedValue(timeoutError)

      const result = await handleBatchDelete<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        items: [{ key: 'doc-1' }],
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Connection timed out')
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
      .mockResolvedValueOnce({ deletedCount: 3 })

    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      retryConfig: {
        maxRetries: 3,
        initialDelayMs: 10,
      },
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
      },
      {
        mutationId: 'mut-2',
        type: 'delete',
        key: 'doc-2',
        modified: {} as TestDocument,
        original: { _id: 'doc-2', name: 'Test', value: 2, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await expect(handler({ transaction })).resolves.not.toThrow()
    expect(mockRpc.rpc).toHaveBeenCalledTimes(2)
  })

  it('should not retry on non-retryable errors', async () => {
    mockRpc.rpc.mockRejectedValue(new Error('Document not found'))

    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      retryConfig: {
        maxRetries: 3,
        initialDelayMs: 10,
      },
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await expect(handler({ transaction })).rejects.toThrow('not found')
    // Should only try once - no retries for not found
    expect(mockRpc.rpc).toHaveBeenCalledTimes(1)
  })

  it('should respect maxRetries limit', async () => {
    mockRpc.rpc.mockRejectedValue(new Error('Network error'))

    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      retryConfig: {
        maxRetries: 2,
        initialDelayMs: 10,
      },
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

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
    mockRpc.rpc.mockResolvedValue({ deletedCount: 2 })
  })

  it('should call onBeforeDelete hook', async () => {
    const onBeforeDelete = vi.fn()

    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      onBeforeDelete,
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test 1', value: 1, createdAt: new Date() },
        changes: {},
      },
      {
        mutationId: 'mut-2',
        type: 'delete',
        key: 'doc-2',
        modified: {} as TestDocument,
        original: { _id: 'doc-2', name: 'Test 2', value: 2, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    expect(onBeforeDelete).toHaveBeenCalledWith({
      keys: ['doc-1', 'doc-2'],
      documents: expect.any(Array),
      transaction,
    })
  })

  it('should call onAfterDelete hook', async () => {
    const onAfterDelete = vi.fn()

    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      onAfterDelete,
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    expect(onAfterDelete).toHaveBeenCalledWith({
      keys: ['doc-1'],
      documents: expect.any(Array),
      result: { deletedCount: 2 },
      transaction,
    })
  })

  it('should call onError hook on failure', async () => {
    const error = new Error('Delete failed')
    mockRpc.rpc.mockRejectedValue(error)
    const onError = vi.fn()

    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      onError,
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await expect(handler({ transaction })).rejects.toThrow()

    expect(onError).toHaveBeenCalledWith({
      error,
      keys: ['doc-1'],
      documents: expect.any(Array),
      transaction,
    })
  })

  it('should allow onBeforeDelete to cancel deletion by throwing', async () => {
    const onBeforeDelete = vi.fn().mockImplementation(() => {
      throw new Error('Delete cancelled')
    })

    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      onBeforeDelete,
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await expect(handler({ transaction })).rejects.toThrow('Delete cancelled')
    expect(mockRpc.rpc).not.toHaveBeenCalled()
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('type safety', () => {
  it('should maintain generic type through handler', async () => {
    const mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ deletedCount: 1 })

    // This test verifies TypeScript compilation
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'delete',
      key: 'doc-1',
      modified: {} as TestDocument,
      original: {
        _id: 'doc-1',
        name: 'Test',
        value: 42,
        createdAt: new Date(),
      },
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await expect(handler({ transaction })).resolves.not.toThrow()
  })
})

// =============================================================================
// TanStack DB Integration Tests
// =============================================================================

describe('TanStack DB integration', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ deletedCount: 2 })
  })

  it('should work with TransactionWithMutations interface', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
    })

    // Simulate what TanStack DB passes to onDelete
    const mockTanStackTransaction = {
      id: 'tx-123',
      mutations: [
        {
          mutationId: 'mut-1',
          type: 'delete' as const,
          key: 'doc-1',
          globalKey: 'KEY::users/doc-1',
          modified: {} as TestDocument,
          original: {
            _id: 'doc-1',
            name: 'TanStack Test',
            value: 100,
            createdAt: new Date(),
          },
          changes: {},
          metadata: {},
          syncMetadata: {},
          optimistic: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          mutationId: 'mut-2',
          type: 'delete' as const,
          key: 'doc-2',
          globalKey: 'KEY::users/doc-2',
          modified: {} as TestDocument,
          original: {
            _id: 'doc-2',
            name: 'TanStack Test 2',
            value: 200,
            createdAt: new Date(),
          },
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
      handler({ transaction: mockTanStackTransaction as any })
    ).resolves.not.toThrow()

    expect(mockRpc.rpc).toHaveBeenCalledWith('bulkWrite', expect.any(Object))
  })

  it('should extract correct data from TanStack mutation format', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
    })

    const mockTanStackTransaction = {
      id: 'tx-456',
      mutations: [
        {
          mutationId: 'mut-2',
          type: 'delete' as const,
          key: 'user-789',
          globalKey: 'KEY::users/user-789',
          modified: {} as TestDocument,
          original: {
            _id: 'user-789',
            name: 'Jane Doe',
            value: 200,
            createdAt: new Date(),
          },
          changes: {},
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

    // Single delete should use deleteOne
    expect(mockRpc.rpc).toHaveBeenCalledWith('deleteOne', {
      database: 'testdb',
      collection: 'users',
      filter: { _id: 'user-789' },
    })
  })
})

// =============================================================================
// Batch Optimization Tests
// =============================================================================

describe('batch optimization', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ deletedCount: 10 })
  })

  it('should use deleteOne for single delete (optimization)', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    expect(mockRpc.rpc).toHaveBeenCalledWith('deleteOne', expect.any(Object))
    expect(mockRpc.rpc).not.toHaveBeenCalledWith('bulkWrite', expect.any(Object))
  })

  it('should use bulkWrite for multiple deletes', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test 1', value: 1, createdAt: new Date() },
        changes: {},
      },
      {
        mutationId: 'mut-2',
        type: 'delete',
        key: 'doc-2',
        modified: {} as TestDocument,
        original: { _id: 'doc-2', name: 'Test 2', value: 2, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    expect(mockRpc.rpc).toHaveBeenCalledWith('bulkWrite', expect.any(Object))
    expect(mockRpc.rpc).not.toHaveBeenCalledWith('deleteOne', expect.any(Object))
  })

  it('should support chunking for very large batches', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      batchSize: 50, // Chunk into batches of 50
    })

    const mutations: MockPendingMutation<TestDocument>[] = Array.from(
      { length: 120 },
      (_, i) => ({
        mutationId: `mut-${i}`,
        type: 'delete' as const,
        key: `doc-${i}`,
        modified: {} as TestDocument,
        original: {
          _id: `doc-${i}`,
          name: `Doc ${i}`,
          value: i,
          createdAt: new Date(),
        },
        changes: {},
      })
    )

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    // Should have made 3 bulkWrite calls (50 + 50 + 20)
    expect(mockRpc.rpc).toHaveBeenCalledTimes(3)
  })
})

// =============================================================================
// Result Aggregation Tests
// =============================================================================

describe('result aggregation', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
  })

  it('should aggregate results from multiple batches', async () => {
    mockRpc.rpc
      .mockResolvedValueOnce({ deletedCount: 50 })
      .mockResolvedValueOnce({ deletedCount: 30 })

    const result = await handleBatchDelete<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      items: Array.from({ length: 80 }, (_, i) => ({ key: `doc-${i}` })),
      batchSize: 50,
    })

    expect(result.success).toBe(true)
    expect(result.deletedCount).toBe(80)
  })
})

// =============================================================================
// Soft Delete Support Tests (RED Phase)
// =============================================================================

describe('soft delete support', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 })
  })

  it('should support soft delete mode', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      softDelete: true,
      softDeleteField: 'deletedAt',
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    // Soft delete should use updateOne instead of deleteOne
    expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
      database: 'testdb',
      collection: 'users',
      filter: { _id: 'doc-1' },
      update: { $set: { deletedAt: expect.any(Date) } },
    })
  })

  it('should support custom soft delete field name', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      softDelete: true,
      softDeleteField: '_removedAt',
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
      database: 'testdb',
      collection: 'users',
      filter: { _id: 'doc-1' },
      update: { $set: { _removedAt: expect.any(Date) } },
    })
  })

  it('should support soft delete with additional metadata', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      softDelete: true,
      softDeleteField: 'deletedAt',
      softDeleteMetadata: {
        deletedBy: 'system',
        reason: 'user-requested',
      },
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', {
      database: 'testdb',
      collection: 'users',
      filter: { _id: 'doc-1' },
      update: {
        $set: {
          deletedAt: expect.any(Date),
          deletedBy: 'system',
          reason: 'user-requested',
        },
      },
    })
  })

  it('should use bulkWrite for multiple soft deletes', async () => {
    mockRpc.rpc.mockResolvedValue({ modifiedCount: 3, matchedCount: 3 })

    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      softDelete: true,
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test 1', value: 1, createdAt: new Date() },
        changes: {},
      },
      {
        mutationId: 'mut-2',
        type: 'delete',
        key: 'doc-2',
        modified: {} as TestDocument,
        original: { _id: 'doc-2', name: 'Test 2', value: 2, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    expect(mockRpc.rpc).toHaveBeenCalledWith('bulkWrite', {
      database: 'testdb',
      collection: 'users',
      operations: [
        { updateOne: { filter: { _id: 'doc-1' }, update: { $set: { deletedAt: expect.any(Date) } } } },
        { updateOne: { filter: { _id: 'doc-2' }, update: { $set: { deletedAt: expect.any(Date) } } } },
      ],
    })
  })
})

// =============================================================================
// Statistics Tests (RED Phase)
// =============================================================================

describe('statistics', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ deletedCount: 5 })
  })

  it('should return processing statistics', async () => {
    const result = await handleBatchDelete<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      items: Array.from({ length: 5 }, (_, i) => ({ key: `doc-${i}` })),
      batchSize: 2,
    })

    expect(result.statistics).toBeDefined()
    expect(result.statistics).toMatchObject({
      totalBatches: 3,
      successfulBatches: 3,
      failedBatches: 0,
      totalDocuments: 5,
      deletedDocuments: 5,
      durationMs: expect.any(Number),
    })
  })

  it('should calculate throughput statistics', async () => {
    // Add artificial delay to ensure measurable duration
    mockRpc.rpc.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return { deletedCount: 2 }
    })

    const result = await handleBatchDelete<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      items: Array.from({ length: 10 }, (_, i) => ({ key: `doc-${i}` })),
      batchSize: 5,
    })

    expect(result.statistics?.documentsPerSecond).toBeGreaterThan(0)
  })

  it('should track failed document count in statistics', async () => {
    mockRpc.rpc
      .mockResolvedValueOnce({ deletedCount: 2 })
      .mockRejectedValueOnce(new Error('Batch failed'))
      .mockResolvedValueOnce({ deletedCount: 2 })

    const result = await handleBatchDelete<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      items: Array.from({ length: 6 }, (_, i) => ({ key: `doc-${i}` })),
      batchSize: 2,
      continueOnError: true,
    })

    expect(result.statistics).toBeDefined()
    expect(result.statistics?.failedBatches).toBe(1)
    expect(result.statistics?.failedDocuments).toBe(2)
  })
})

// =============================================================================
// Progress Callbacks Tests (RED Phase)
// =============================================================================

describe('progress callbacks', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ deletedCount: 2 })
  })

  it('should call onProgress after each batch', async () => {
    const onProgress = vi.fn()

    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      batchSize: 2,
      onProgress,
    })

    const mutations: MockPendingMutation<TestDocument>[] = Array.from(
      { length: 5 },
      (_, i) => ({
        mutationId: `mut-${i}`,
        type: 'delete' as const,
        key: `doc-${i}`,
        modified: {} as TestDocument,
        original: { _id: `doc-${i}`, name: `Doc ${i}`, value: i, createdAt: new Date() },
        changes: {},
      })
    )

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    // Should be called 3 times (one per batch: 2+2+1)
    expect(onProgress).toHaveBeenCalledTimes(3)

    // First call - batch 1 of 3 complete
    expect(onProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        batchNumber: 1,
        totalBatches: 3,
        documentsProcessed: 2,
        totalDocuments: 5,
        percentComplete: expect.any(Number),
      })
    )

    // Third call - batch 3 of 3 complete
    expect(onProgress).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        batchNumber: 3,
        totalBatches: 3,
        documentsProcessed: 5,
        totalDocuments: 5,
        percentComplete: 100,
      })
    )
  })

  it('should include deleted count in progress', async () => {
    const onProgress = vi.fn()

    mockRpc.rpc
      .mockResolvedValueOnce({ deletedCount: 2 })
      .mockResolvedValueOnce({ deletedCount: 1 })

    const result = await handleBatchDelete<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      items: Array.from({ length: 3 }, (_, i) => ({ key: `doc-${i}` })),
      batchSize: 2,
      onProgress,
    })

    expect(onProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        deletedCount: 2,
      })
    )

    expect(onProgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        deletedCount: 3, // Cumulative
      })
    )
  })
})

// =============================================================================
// Parallel Processing Tests (RED Phase)
// =============================================================================

describe('parallel processing', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
  })

  it('should process batches in parallel when concurrency > 1', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      batchSize: 2,
      concurrency: 2, // Process 2 batches in parallel
    })

    const mutations: MockPendingMutation<TestDocument>[] = Array.from(
      { length: 4 },
      (_, i) => ({
        mutationId: `mut-${i}`,
        type: 'delete' as const,
        key: `doc-${i}`,
        modified: {} as TestDocument,
        original: { _id: `doc-${i}`, name: `Doc ${i}`, value: i, createdAt: new Date() },
        changes: {},
      })
    )

    const transaction = createMockTransaction(mutations)

    // Track timing to verify parallel execution
    const callTimes: number[] = []
    mockRpc.rpc.mockImplementation(async () => {
      callTimes.push(Date.now())
      await new Promise((r) => setTimeout(r, 10))
      return { deletedCount: 2 }
    })

    await handler({ transaction })

    expect(mockRpc.rpc).toHaveBeenCalledTimes(2)

    // Both batches should start at roughly the same time (parallel)
    if (callTimes.length >= 2) {
      const timeDiff = Math.abs(callTimes[0]! - callTimes[1]!)
      expect(timeDiff).toBeLessThan(5) // Should start within 5ms of each other
    }
  })

  it('should process batches sequentially when concurrency is 1', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      batchSize: 2,
      concurrency: 1, // Sequential processing
    })

    const mutations: MockPendingMutation<TestDocument>[] = Array.from(
      { length: 4 },
      (_, i) => ({
        mutationId: `mut-${i}`,
        type: 'delete' as const,
        key: `doc-${i}`,
        modified: {} as TestDocument,
        original: { _id: `doc-${i}`, name: `Doc ${i}`, value: i, createdAt: new Date() },
        changes: {},
      })
    )

    const transaction = createMockTransaction(mutations)

    const callTimes: number[] = []
    mockRpc.rpc.mockImplementation(async () => {
      callTimes.push(Date.now())
      await new Promise((r) => setTimeout(r, 10))
      return { deletedCount: 2 }
    })

    await handler({ transaction })

    expect(mockRpc.rpc).toHaveBeenCalledTimes(2)

    // Second batch should start after first completes (sequential)
    if (callTimes.length >= 2) {
      const timeDiff = callTimes[1]! - callTimes[0]!
      expect(timeDiff).toBeGreaterThanOrEqual(10)
    }
  })
})

// =============================================================================
// Cancellation Support Tests (RED Phase)
// =============================================================================

describe('cancellation support', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
  })

  it('should support AbortController for cancellation', async () => {
    const abortController = new AbortController()

    mockRpc.rpc.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 100))
      return { deletedCount: 2 }
    })

    const resultPromise = handleBatchDelete<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      items: Array.from({ length: 10 }, (_, i) => ({ key: `doc-${i}` })),
      batchSize: 2,
      signal: abortController.signal,
    })

    // Cancel after a short delay
    setTimeout(() => abortController.abort(), 50)

    await expect(resultPromise).rejects.toThrow(/abort/i)
  })

  it('should stop processing remaining batches on cancellation', async () => {
    const abortController = new AbortController()
    let batchCount = 0

    mockRpc.rpc.mockImplementation(async () => {
      batchCount++
      if (batchCount === 2) {
        abortController.abort()
      }
      await new Promise((r) => setTimeout(r, 10))
      return { deletedCount: 2 }
    })

    const resultPromise = handleBatchDelete<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      items: Array.from({ length: 10 }, (_, i) => ({ key: `doc-${i}` })),
      batchSize: 2,
      signal: abortController.signal,
    })

    await expect(resultPromise).rejects.toThrow(/abort/i)
    // Should not have processed all 5 batches
    expect(batchCount).toBeLessThan(5)
  })

  it('should return partial results on cancellation when configured', async () => {
    const abortController = new AbortController()
    let batchCount = 0

    mockRpc.rpc.mockImplementation(async () => {
      batchCount++
      if (batchCount === 2) {
        abortController.abort()
      }
      return { deletedCount: 2 }
    })

    const result = await handleBatchDelete<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      items: Array.from({ length: 10 }, (_, i) => ({ key: `doc-${i}` })),
      batchSize: 2,
      signal: abortController.signal,
      returnPartialOnCancel: true,
    })

    expect(result.success).toBe(false)
    expect(result.cancelled).toBe(true)
    expect(result.deletedCount).toBeGreaterThan(0)
  })
})

// =============================================================================
// Write Concern Options Tests (RED Phase)
// =============================================================================

describe('write concern options', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ deletedCount: 1 })
  })

  it('should pass writeConcern to deleteOne', async () => {
    await handleBatchDelete<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      items: [{ key: 'doc-1' }],
      options: {
        writeConcern: { w: 'majority', j: true, wtimeout: 5000 },
      },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('deleteOne', {
      database: 'testdb',
      collection: 'users',
      filter: { _id: 'doc-1' },
      options: {
        writeConcern: { w: 'majority', j: true, wtimeout: 5000 },
      },
    })
  })

  it('should handle write concern errors gracefully', async () => {
    const writeConcernError = new Error('Write concern error: not enough data-bearing nodes')
    mockRpc.rpc.mockRejectedValue(writeConcernError)

    const result = await handleBatchDelete<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      items: [{ key: 'doc-1' }],
    })

    expect(result.success).toBe(false)
    expect(result.isWriteConcernError).toBe(true)
  })
})

// =============================================================================
// Idempotency Tests (RED Phase)
// =============================================================================

describe('idempotency', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
  })

  it('should support idempotency keys for deduplication', async () => {
    mockRpc.rpc.mockResolvedValue({ deletedCount: 1 })

    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      idempotencyEnabled: true,
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
        syncMetadata: { idempotencyKey: 'delete-doc-1-v1' },
      },
    ]

    const transaction = createMockTransaction(mutations)

    // First call should execute
    await handler({ transaction })
    expect(mockRpc.rpc).toHaveBeenCalledTimes(1)

    // Second call with same idempotency key should be skipped
    await handler({ transaction })
    expect(mockRpc.rpc).toHaveBeenCalledTimes(1) // Still only 1 call
  })

  it('should return success for already-processed idempotent operations', async () => {
    mockRpc.rpc.mockResolvedValue({ deletedCount: 0 }) // Document already deleted

    const result = await handleBatchDelete<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      items: [{ key: 'doc-1' }],
      idempotent: true,
    })

    // Should be considered successful even if deletedCount is 0
    expect(result.success).toBe(true)
    expect(result.alreadyDeleted).toBe(true)
  })
})

// =============================================================================
// Cascade Delete Tests (RED Phase)
// =============================================================================

describe('cascade delete', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ deletedCount: 1 })
  })

  it('should support cascading deletes to related collections', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      cascadeDeletes: [
        { collection: 'posts', foreignKey: 'authorId' },
        { collection: 'comments', foreignKey: 'userId' },
      ],
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'user-123',
        modified: {} as TestDocument,
        original: { _id: 'user-123', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    // Should delete from main collection and cascade to related collections
    expect(mockRpc.rpc).toHaveBeenCalledWith('deleteOne', {
      database: 'testdb',
      collection: 'users',
      filter: { _id: 'user-123' },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('deleteMany', {
      database: 'testdb',
      collection: 'posts',
      filter: { authorId: 'user-123' },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('deleteMany', {
      database: 'testdb',
      collection: 'comments',
      filter: { userId: 'user-123' },
    })
  })

  it('should rollback cascade deletes on failure', async () => {
    mockRpc.rpc
      .mockResolvedValueOnce({ deletedCount: 1 }) // Main delete
      .mockResolvedValueOnce({ deletedCount: 5 }) // Posts deleted
      .mockRejectedValueOnce(new Error('Failed to delete comments')) // Comments fail

    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      cascadeDeletes: [
        { collection: 'posts', foreignKey: 'authorId' },
        { collection: 'comments', foreignKey: 'userId' },
      ],
      cascadeRollbackOnFailure: true,
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'user-123',
        modified: {} as TestDocument,
        original: { _id: 'user-123', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await expect(handler({ transaction })).rejects.toThrow('Failed to delete comments')

    // Should have attempted rollback
    expect(mockRpc.rpc).toHaveBeenCalledWith('insertMany', expect.any(Object))
  })
})

// =============================================================================
// Audit Trail Tests (RED Phase)
// =============================================================================

describe('audit trail', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ deletedCount: 1, insertedId: 'audit-1' })
  })

  it('should create audit records for deletes', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      auditEnabled: true,
      auditCollection: 'audit_log',
    })

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
        changes: {},
        metadata: { userId: 'admin-1' },
      },
    ]

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    // Should have written audit record
    expect(mockRpc.rpc).toHaveBeenCalledWith('insertOne', {
      database: 'testdb',
      collection: 'audit_log',
      document: expect.objectContaining({
        operation: 'delete',
        collection: 'users',
        documentId: 'doc-1',
        deletedDocument: expect.objectContaining({ _id: 'doc-1', name: 'Test' }),
        timestamp: expect.any(Date),
        userId: 'admin-1',
      }),
    })
  })

  it('should include before state in audit record', async () => {
    const handler = createBatchDeleteHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      auditEnabled: true,
      auditCollection: 'audit_log',
      includeDocumentInAudit: true,
    })

    const originalDoc = { _id: 'doc-1', name: 'Test User', value: 42, createdAt: new Date() }

    const mutations: MockPendingMutation<TestDocument>[] = [
      {
        mutationId: 'mut-1',
        type: 'delete',
        key: 'doc-1',
        modified: {} as TestDocument,
        original: originalDoc,
        changes: {},
      },
    ]

    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    expect(mockRpc.rpc).toHaveBeenCalledWith('insertOne', {
      database: 'testdb',
      collection: 'audit_log',
      document: expect.objectContaining({
        beforeState: originalDoc,
      }),
    })
  })
})
