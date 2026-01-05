/**
 * @file Insert Mutation Handler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the insert mutation handler that handles
 * client-side insert mutations and persists them to MongoDB via RPC.
 *
 * The insert mutation handler is called when `collection.insert()` is invoked
 * on the client side and needs to persist the data to MongoDB.
 *
 * RED PHASE: These tests will fail until the insert mutation handler is implemented
 * in src/sync/handlers/insert-mutation.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createInsertMutationHandler,
  handleInsertMutation,
  type InsertMutationHandlerConfig,
  type InsertMutationContext,
  type InsertMutationResult,
} from '../../../src/sync/handlers/insert-mutation'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing insert mutations.
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

describe('createInsertMutationHandler', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createInsertMutationHandler).toBe('function')
    })

    it('should return a handler function', () => {
      const mockRpc = createMockRpcClient()
      const handler = createInsertMutationHandler({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
      })

      expect(typeof handler).toBe('function')
    })

    it('should throw when rpcClient is not provided', () => {
      expect(() =>
        createInsertMutationHandler({
          rpcClient: undefined as any,
          database: 'testdb',
          collection: 'testcol',
        })
      ).toThrow('rpcClient is required')
    })

    it('should throw when database is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createInsertMutationHandler({
          rpcClient: mockRpc,
          database: '',
          collection: 'testcol',
        })
      ).toThrow('database is required')
    })

    it('should throw when collection is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createInsertMutationHandler({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: '',
        })
      ).toThrow('collection is required')
    })
  })

  describe('handler execution', () => {
    let mockRpc: MockRpcClient
    let handler: ReturnType<typeof createInsertMutationHandler<TestDocument>>

    beforeEach(() => {
      mockRpc = createMockRpcClient()
      mockRpc.rpc.mockResolvedValue({ insertedId: 'doc-123' })
      handler = createInsertMutationHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
      })
    })

    it('should call RPC with correct method for single insert', async () => {
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
        changes: {
          _id: 'doc-123',
          name: 'Test Doc',
          value: 42,
        },
      }

      const transaction = createMockTransaction([mutation])

      await handler({ transaction })

      expect(mockRpc.rpc).toHaveBeenCalledWith('insertOne', {
        database: 'testdb',
        collection: 'testcol',
        document: mutation.modified,
      })
    })

    it('should call RPC with insertMany for multiple inserts', async () => {
      const mutations: MockPendingMutation<TestDocument>[] = [
        {
          mutationId: 'mut-1',
          type: 'insert',
          key: 'doc-1',
          modified: {
            _id: 'doc-1',
            name: 'Doc 1',
            value: 1,
            createdAt: new Date(),
          },
          original: {},
          changes: {},
        },
        {
          mutationId: 'mut-2',
          type: 'insert',
          key: 'doc-2',
          modified: {
            _id: 'doc-2',
            name: 'Doc 2',
            value: 2,
            createdAt: new Date(),
          },
          original: {},
          changes: {},
        },
      ]

      const transaction = createMockTransaction(mutations)
      mockRpc.rpc.mockResolvedValue({ insertedIds: ['doc-1', 'doc-2'] })

      await handler({ transaction })

      expect(mockRpc.rpc).toHaveBeenCalledWith('insertMany', {
        database: 'testdb',
        collection: 'testcol',
        documents: [mutations[0].modified, mutations[1].modified],
      })
    })

    it('should handle empty mutations array', async () => {
      const transaction = createMockTransaction<TestDocument>([])

      await expect(handler({ transaction })).resolves.not.toThrow()
      expect(mockRpc.rpc).not.toHaveBeenCalled()
    })

    it('should only process insert type mutations', async () => {
      const mutations: MockPendingMutation<TestDocument>[] = [
        {
          mutationId: 'mut-1',
          type: 'insert',
          key: 'doc-1',
          modified: {
            _id: 'doc-1',
            name: 'Insert',
            value: 1,
            createdAt: new Date(),
          },
          original: {},
          changes: {},
        },
        {
          mutationId: 'mut-2',
          type: 'update' as any,
          key: 'doc-2',
          modified: {
            _id: 'doc-2',
            name: 'Update',
            value: 2,
            createdAt: new Date(),
          },
          original: {},
          changes: {},
        },
      ]

      const transaction = createMockTransaction(mutations)

      await handler({ transaction })

      // Should only call insertOne for the insert mutation
      expect(mockRpc.rpc).toHaveBeenCalledTimes(1)
      expect(mockRpc.rpc).toHaveBeenCalledWith('insertOne', {
        database: 'testdb',
        collection: 'testcol',
        document: mutations[0].modified,
      })
    })
  })
})

// =============================================================================
// Direct Handler Function Tests
// =============================================================================

describe('handleInsertMutation', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ insertedId: 'doc-123' })
  })

  describe('basic functionality', () => {
    it('should be a function', () => {
      expect(typeof handleInsertMutation).toBe('function')
    })

    it('should insert a single document', async () => {
      const document: TestDocument = {
        _id: 'doc-123',
        name: 'Test Document',
        value: 100,
        createdAt: new Date('2024-01-01'),
      }

      const result = await handleInsertMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        document,
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('insertOne', {
        database: 'testdb',
        collection: 'users',
        document,
      })
      expect(result.success).toBe(true)
      expect(result.insertedId).toBe('doc-123')
    })

    it('should insert multiple documents', async () => {
      const documents: TestDocument[] = [
        { _id: 'doc-1', name: 'Doc 1', value: 1, createdAt: new Date() },
        { _id: 'doc-2', name: 'Doc 2', value: 2, createdAt: new Date() },
        { _id: 'doc-3', name: 'Doc 3', value: 3, createdAt: new Date() },
      ]

      mockRpc.rpc.mockResolvedValue({
        insertedIds: ['doc-1', 'doc-2', 'doc-3'],
        insertedCount: 3,
      })

      const result = await handleInsertMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        documents,
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('insertMany', {
        database: 'testdb',
        collection: 'users',
        documents,
      })
      expect(result.success).toBe(true)
      expect(result.insertedIds).toEqual(['doc-1', 'doc-2', 'doc-3'])
      expect(result.insertedCount).toBe(3)
    })

    it('should return success false on RPC error', async () => {
      mockRpc.rpc.mockRejectedValue(new Error('MongoDB connection failed'))

      const result = await handleInsertMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        document: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toBe('MongoDB connection failed')
    })
  })

  describe('document validation', () => {
    it('should throw when document is null', async () => {
      await expect(
        handleInsertMutation<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          document: null as any,
        })
      ).rejects.toThrow('document or documents is required')
    })

    it('should throw when document is undefined', async () => {
      await expect(
        handleInsertMutation<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          document: undefined as any,
        })
      ).rejects.toThrow('document or documents is required')
    })

    it('should throw when documents array is empty', async () => {
      await expect(
        handleInsertMutation<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          documents: [],
        })
      ).rejects.toThrow('documents array cannot be empty')
    })

    it('should handle documents with missing _id', async () => {
      const document = {
        name: 'No ID',
        value: 1,
        createdAt: new Date(),
      } as TestDocument

      // Should still call RPC - MongoDB can generate _id
      await handleInsertMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        document,
      })

      expect(mockRpc.rpc).toHaveBeenCalled()
    })
  })

  describe('nested documents', () => {
    it('should preserve nested object structures', async () => {
      const document: NestedDocument = {
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
      }

      await handleInsertMutation<NestedDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        document,
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('insertOne', {
        database: 'testdb',
        collection: 'users',
        document,
      })
    })
  })

  describe('options handling', () => {
    it('should pass ordered option for insertMany', async () => {
      const documents: TestDocument[] = [
        { _id: 'doc-1', name: 'Doc 1', value: 1, createdAt: new Date() },
        { _id: 'doc-2', name: 'Doc 2', value: 2, createdAt: new Date() },
      ]

      mockRpc.rpc.mockResolvedValue({ insertedIds: ['doc-1', 'doc-2'] })

      await handleInsertMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        documents,
        options: { ordered: false },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('insertMany', {
        database: 'testdb',
        collection: 'users',
        documents,
        options: { ordered: false },
      })
    })

    it('should pass writeConcern option', async () => {
      const document: TestDocument = {
        _id: 'doc-1',
        name: 'Test',
        value: 1,
        createdAt: new Date(),
      }

      await handleInsertMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        document,
        options: { writeConcern: { w: 'majority' } },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('insertOne', {
        database: 'testdb',
        collection: 'users',
        document,
        options: { writeConcern: { w: 'majority' } },
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

  describe('duplicate key errors', () => {
    it('should identify duplicate key errors', async () => {
      const duplicateKeyError = new Error('E11000 duplicate key error collection')
      mockRpc.rpc.mockRejectedValue(duplicateKeyError)

      const result = await handleInsertMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        document: { _id: 'dup-1', name: 'Dup', value: 1, createdAt: new Date() },
      })

      expect(result.success).toBe(false)
      expect(result.isDuplicateKeyError).toBe(true)
    })
  })

  describe('network errors', () => {
    it('should handle connection timeout', async () => {
      const timeoutError = new Error('Connection timed out')
      mockRpc.rpc.mockRejectedValue(timeoutError)

      const result = await handleInsertMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        document: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Connection timed out')
    })

    it('should handle disconnected client', async () => {
      mockRpc.isConnected.mockReturnValue(false)

      const result = await handleInsertMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        document: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('not connected')
    })
  })

  describe('validation errors', () => {
    it('should handle schema validation errors from MongoDB', async () => {
      const validationError = new Error('Document failed validation')
      mockRpc.rpc.mockRejectedValue(validationError)

      const result = await handleInsertMutation<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        document: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Document failed validation')
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
      .mockResolvedValueOnce({ insertedId: 'doc-1' })

    const handler = createInsertMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      retryConfig: {
        maxRetries: 3,
        initialDelayMs: 100,
      },
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await expect(handler({ transaction })).resolves.not.toThrow()
    expect(mockRpc.rpc).toHaveBeenCalledTimes(2)
  })

  it('should not retry on non-retryable errors', async () => {
    mockRpc.rpc.mockRejectedValue(new Error('E11000 duplicate key error'))

    const handler = createInsertMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      retryConfig: {
        maxRetries: 3,
        initialDelayMs: 100,
      },
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await expect(handler({ transaction })).rejects.toThrow('duplicate key')
    // Should only try once - no retries for duplicate key
    expect(mockRpc.rpc).toHaveBeenCalledTimes(1)
  })

  it('should respect maxRetries limit', async () => {
    mockRpc.rpc.mockRejectedValue(new Error('Network error'))

    const handler = createInsertMutationHandler<TestDocument>({
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
      type: 'insert',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
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
    mockRpc.rpc.mockResolvedValue({ insertedId: 'doc-1' })
  })

  it('should call onBeforeInsert hook', async () => {
    const onBeforeInsert = vi.fn()

    const handler = createInsertMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      onBeforeInsert,
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await handler({ transaction })

    expect(onBeforeInsert).toHaveBeenCalledWith({
      documents: [mutation.modified],
      transaction,
    })
  })

  it('should call onAfterInsert hook', async () => {
    const onAfterInsert = vi.fn()

    const handler = createInsertMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      onAfterInsert,
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await handler({ transaction })

    expect(onAfterInsert).toHaveBeenCalledWith({
      documents: [mutation.modified],
      result: { insertedId: 'doc-1' },
      transaction,
    })
  })

  it('should call onError hook on failure', async () => {
    const error = new Error('Insert failed')
    mockRpc.rpc.mockRejectedValue(error)
    const onError = vi.fn()

    const handler = createInsertMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      onError,
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await expect(handler({ transaction })).rejects.toThrow()

    expect(onError).toHaveBeenCalledWith({
      error,
      documents: [mutation.modified],
      transaction,
    })
  })

  it('should allow onBeforeInsert to transform documents', async () => {
    const onBeforeInsert = vi.fn().mockImplementation(({ documents }) => {
      return documents.map((doc: TestDocument) => ({
        ...doc,
        transformed: true,
      }))
    })

    const handler = createInsertMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      onBeforeInsert,
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-1',
      modified: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
      original: {},
      changes: {},
    }

    const transaction = createMockTransaction([mutation])

    await handler({ transaction })

    expect(mockRpc.rpc).toHaveBeenCalledWith(
      'insertOne',
      expect.objectContaining({
        document: expect.objectContaining({
          transformed: true,
        }),
      })
    )
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('type safety', () => {
  it('should maintain generic type through handler', async () => {
    const mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ insertedId: 'doc-1' })

    // This test verifies TypeScript compilation
    const handler = createInsertMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
    })

    const mutation: MockPendingMutation<TestDocument> = {
      mutationId: 'mut-1',
      type: 'insert',
      key: 'doc-1',
      modified: {
        _id: 'doc-1',
        name: 'Test',
        value: 42,
        createdAt: new Date(),
      },
      original: {},
      changes: {},
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
    mockRpc.rpc.mockResolvedValue({ insertedId: 'doc-1' })
  })

  it('should work with TransactionWithMutations interface', async () => {
    const handler = createInsertMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
    })

    // Simulate what TanStack DB passes to onInsert
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
      handler({ transaction: mockTanStackTransaction as any })
    ).resolves.not.toThrow()

    expect(mockRpc.rpc).toHaveBeenCalled()
  })

  it('should extract correct data from TanStack mutation format', async () => {
    const handler = createInsertMutationHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
    })

    const createdAt = new Date('2024-06-15')
    const mockTanStackTransaction = {
      id: 'tx-456',
      mutations: [
        {
          mutationId: 'mut-2',
          type: 'insert' as const,
          key: 'user-789',
          globalKey: 'KEY::users/user-789',
          modified: {
            _id: 'user-789',
            name: 'Jane Doe',
            value: 200,
            createdAt,
          },
          original: {},
          changes: {
            _id: 'user-789',
            name: 'Jane Doe',
            value: 200,
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

    expect(mockRpc.rpc).toHaveBeenCalledWith('insertOne', {
      database: 'testdb',
      collection: 'users',
      document: {
        _id: 'user-789',
        name: 'Jane Doe',
        value: 200,
        createdAt,
      },
    })
  })
})
