/**
 * @file Batch Insert Handler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the batch insert mutation handler that
 * efficiently processes multiple insert mutations in configurable batch sizes.
 *
 * The batch insert handler extends the basic insert mutation handler with:
 * - Configurable batch sizes for optimal bulk insert performance
 * - Parallel batch processing support
 * - Progress tracking and callbacks
 * - Partial failure handling
 *
 * RED PHASE: These tests will fail until the batch insert handler is implemented
 * in src/sync/handlers/batch-insert.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createBatchInsertHandler,
  handleBatchInsert,
  type BatchInsertHandlerConfig,
  type BatchInsertResult,
  type BatchInsertProgress,
} from '../../../src/sync/handlers/batch-insert'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing batch insert mutations.
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

function createMockTransaction<T>(mutations: MockPendingMutation<T>[]): MockTransaction<T> {
  return {
    id: `tx-${Date.now()}`,
    mutations,
    getMutations: () => mutations,
  }
}

// =============================================================================
// Test Data Generators
// =============================================================================

function createTestDocuments(count: number): TestDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `doc-${i + 1}`,
    name: `Document ${i + 1}`,
    value: i + 1,
    createdAt: new Date(),
  }))
}

function createTestMutations(documents: TestDocument[]): MockPendingMutation<TestDocument>[] {
  return documents.map((doc) => ({
    mutationId: `mut-${doc._id}`,
    type: 'insert' as const,
    key: doc._id,
    modified: doc,
    original: {},
    changes: doc,
  }))
}

// =============================================================================
// Handler Factory Tests
// =============================================================================

describe('createBatchInsertHandler', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createBatchInsertHandler).toBe('function')
    })

    it('should return a handler function', () => {
      const mockRpc = createMockRpcClient()
      const handler = createBatchInsertHandler({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
      })

      expect(typeof handler).toBe('function')
    })

    it('should throw when rpcClient is not provided', () => {
      expect(() =>
        createBatchInsertHandler({
          rpcClient: undefined as any,
          database: 'testdb',
          collection: 'testcol',
        })
      ).toThrow('rpcClient is required')
    })

    it('should throw when database is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createBatchInsertHandler({
          rpcClient: mockRpc,
          database: '',
          collection: 'testcol',
        })
      ).toThrow('database is required')
    })

    it('should throw when collection is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createBatchInsertHandler({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: '',
        })
      ).toThrow('collection is required')
    })

    it('should throw when batchSize is zero or negative', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createBatchInsertHandler({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'testcol',
          batchSize: 0,
        })
      ).toThrow('batchSize must be a positive number')

      expect(() =>
        createBatchInsertHandler({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'testcol',
          batchSize: -1,
        })
      ).toThrow('batchSize must be a positive number')
    })
  })

  describe('batch processing', () => {
    let mockRpc: MockRpcClient
    let handler: ReturnType<typeof createBatchInsertHandler<TestDocument>>

    beforeEach(() => {
      mockRpc = createMockRpcClient()
      mockRpc.rpc.mockResolvedValue({
        insertedIds: ['doc-1', 'doc-2'],
        insertedCount: 2,
      })
    })

    it('should process documents in batches of configured size', async () => {
      handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 2, // Small batch size for testing
      })

      const documents = createTestDocuments(5)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      // Mock responses for each batch
      mockRpc.rpc
        .mockResolvedValueOnce({
          insertedIds: ['doc-1', 'doc-2'],
          insertedCount: 2,
        })
        .mockResolvedValueOnce({
          insertedIds: ['doc-3', 'doc-4'],
          insertedCount: 2,
        })
        .mockResolvedValueOnce({
          insertedIds: ['doc-5'],
          insertedCount: 1,
        })

      await handler({ transaction })

      // Should have made 3 RPC calls (2+2+1 documents)
      expect(mockRpc.rpc).toHaveBeenCalledTimes(3)

      // First batch should have 2 documents
      expect(mockRpc.rpc).toHaveBeenNthCalledWith(1, 'insertMany', {
        database: 'testdb',
        collection: 'testcol',
        documents: [documents[0], documents[1]],
      })

      // Second batch should have 2 documents
      expect(mockRpc.rpc).toHaveBeenNthCalledWith(2, 'insertMany', {
        database: 'testdb',
        collection: 'testcol',
        documents: [documents[2], documents[3]],
      })

      // Third batch should have 1 document (uses insertOne by default for single doc)
      expect(mockRpc.rpc).toHaveBeenNthCalledWith(3, 'insertOne', {
        database: 'testdb',
        collection: 'testcol',
        document: documents[4],
      })
    })

    it('should use insertOne for single document in a batch', async () => {
      handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 10, // Batch size larger than document count
        useSingleInsertForOne: true,
      })

      const documents = createTestDocuments(1)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      mockRpc.rpc.mockResolvedValue({ insertedId: 'doc-1' })

      await handler({ transaction })

      expect(mockRpc.rpc).toHaveBeenCalledWith('insertOne', {
        database: 'testdb',
        collection: 'testcol',
        document: documents[0],
      })
    })

    it('should use insertMany even for single document when useSingleInsertForOne is false', async () => {
      handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 10,
        useSingleInsertForOne: false,
      })

      const documents = createTestDocuments(1)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      mockRpc.rpc.mockResolvedValue({ insertedIds: ['doc-1'], insertedCount: 1 })

      await handler({ transaction })

      expect(mockRpc.rpc).toHaveBeenCalledWith('insertMany', {
        database: 'testdb',
        collection: 'testcol',
        documents: [documents[0]],
      })
    })

    it('should default to batch size of 100', async () => {
      handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
      })

      // Create 101 documents to verify default batch size
      const documents = createTestDocuments(101)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      mockRpc.rpc
        .mockResolvedValueOnce({
          insertedIds: documents.slice(0, 100).map((d) => d._id),
          insertedCount: 100,
        })
        .mockResolvedValueOnce({
          insertedIds: [documents[100]._id],
          insertedCount: 1,
        })

      await handler({ transaction })

      // Should have made 2 RPC calls (100+1 documents)
      expect(mockRpc.rpc).toHaveBeenCalledTimes(2)

      // First batch should have 100 documents
      const firstCall = mockRpc.rpc.mock.calls[0]
      expect(firstCall[1].documents).toHaveLength(100)
    })

    it('should handle empty mutations array', async () => {
      handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
      })

      const transaction = createMockTransaction<TestDocument>([])

      await expect(handler({ transaction })).resolves.not.toThrow()
      expect(mockRpc.rpc).not.toHaveBeenCalled()
    })

    it('should only process insert type mutations', async () => {
      handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 10,
      })

      const mutations: MockPendingMutation<TestDocument>[] = [
        {
          mutationId: 'mut-1',
          type: 'insert',
          key: 'doc-1',
          modified: { _id: 'doc-1', name: 'Insert', value: 1, createdAt: new Date() },
          original: {},
          changes: {},
        },
        {
          mutationId: 'mut-2',
          type: 'update',
          key: 'doc-2',
          modified: { _id: 'doc-2', name: 'Update', value: 2, createdAt: new Date() },
          original: {},
          changes: {},
        },
        {
          mutationId: 'mut-3',
          type: 'delete',
          key: 'doc-3',
          modified: { _id: 'doc-3', name: 'Delete', value: 3, createdAt: new Date() },
          original: {},
          changes: {},
        },
      ]

      const transaction = createMockTransaction(mutations)
      mockRpc.rpc.mockResolvedValue({ insertedId: 'doc-1' })

      await handler({ transaction })

      // Should only call RPC once for the insert mutation
      expect(mockRpc.rpc).toHaveBeenCalledTimes(1)
    })
  })

  describe('parallel processing', () => {
    let mockRpc: MockRpcClient

    beforeEach(() => {
      mockRpc = createMockRpcClient()
    })

    it('should process batches in parallel when concurrency > 1', async () => {
      const handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 2,
        concurrency: 2, // Process 2 batches in parallel
      })

      const documents = createTestDocuments(4)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      // Track timing to verify parallel execution
      const callTimes: number[] = []
      mockRpc.rpc.mockImplementation(async () => {
        callTimes.push(Date.now())
        await new Promise((r) => setTimeout(r, 10))
        return { insertedIds: [], insertedCount: 2 }
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
      const handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 2,
        concurrency: 1, // Sequential processing
      })

      const documents = createTestDocuments(4)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      const callTimes: number[] = []
      mockRpc.rpc.mockImplementation(async () => {
        callTimes.push(Date.now())
        await new Promise((r) => setTimeout(r, 10))
        return { insertedIds: [], insertedCount: 2 }
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

  describe('progress callbacks', () => {
    let mockRpc: MockRpcClient

    beforeEach(() => {
      mockRpc = createMockRpcClient()
    })

    it('should call onProgress after each batch', async () => {
      const onProgress = vi.fn()

      const handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 2,
        onProgress,
      })

      const documents = createTestDocuments(5)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      mockRpc.rpc.mockResolvedValue({ insertedIds: [], insertedCount: 2 })

      await handler({ transaction })

      // Should be called 3 times (one per batch)
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

      // Second call - batch 2 of 3 complete
      expect(onProgress).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          batchNumber: 2,
          totalBatches: 3,
          documentsProcessed: 4,
          totalDocuments: 5,
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
  })

  describe('hooks and callbacks', () => {
    let mockRpc: MockRpcClient

    beforeEach(() => {
      mockRpc = createMockRpcClient()
      mockRpc.rpc.mockResolvedValue({ insertedIds: [], insertedCount: 2 })
    })

    it('should call onBeforeBatch before each batch', async () => {
      const onBeforeBatch = vi.fn()

      const handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 2,
        onBeforeBatch,
      })

      const documents = createTestDocuments(4)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      await handler({ transaction })

      expect(onBeforeBatch).toHaveBeenCalledTimes(2)
      expect(onBeforeBatch).toHaveBeenNthCalledWith(1, {
        batchNumber: 1,
        documents: [documents[0], documents[1]],
        transaction,
      })
      expect(onBeforeBatch).toHaveBeenNthCalledWith(2, {
        batchNumber: 2,
        documents: [documents[2], documents[3]],
        transaction,
      })
    })

    it('should call onAfterBatch after each batch', async () => {
      const onAfterBatch = vi.fn()

      const handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 2,
        onAfterBatch,
      })

      const documents = createTestDocuments(4)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      await handler({ transaction })

      expect(onAfterBatch).toHaveBeenCalledTimes(2)
      expect(onAfterBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          batchNumber: expect.any(Number),
          documents: expect.any(Array),
          result: expect.any(Object),
          transaction,
        })
      )
    })

    it('should call onBatchError when a batch fails', async () => {
      const onBatchError = vi.fn()
      const error = new Error('Batch failed')

      const handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 2,
        onBatchError,
        continueOnError: true, // Continue processing after error
      })

      const documents = createTestDocuments(4)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      // First batch fails, second succeeds
      mockRpc.rpc.mockRejectedValueOnce(error).mockResolvedValueOnce({
        insertedIds: ['doc-3', 'doc-4'],
        insertedCount: 2,
      })

      await handler({ transaction })

      expect(onBatchError).toHaveBeenCalledTimes(1)
      expect(onBatchError).toHaveBeenCalledWith({
        batchNumber: 1,
        documents: [documents[0], documents[1]],
        error,
        transaction,
      })
    })

    it('should allow onBeforeBatch to transform documents', async () => {
      const onBeforeBatch = vi.fn().mockImplementation(({ documents }) => {
        return documents.map((doc: TestDocument) => ({
          ...doc,
          transformed: true,
        }))
      })

      const handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 2,
        onBeforeBatch,
      })

      const documents = createTestDocuments(2)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      await handler({ transaction })

      // Verify transformed documents were sent
      expect(mockRpc.rpc).toHaveBeenCalledWith(
        'insertMany',
        expect.objectContaining({
          documents: expect.arrayContaining([
            expect.objectContaining({ transformed: true }),
            expect.objectContaining({ transformed: true }),
          ]),
        })
      )
    })
  })

  describe('error handling', () => {
    let mockRpc: MockRpcClient

    beforeEach(() => {
      mockRpc = createMockRpcClient()
    })

    it('should stop on first error by default', async () => {
      const handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 2,
      })

      const documents = createTestDocuments(4)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      mockRpc.rpc.mockRejectedValueOnce(new Error('First batch failed'))

      await expect(handler({ transaction })).rejects.toThrow('First batch failed')

      // Should only have attempted first batch
      expect(mockRpc.rpc).toHaveBeenCalledTimes(1)
    })

    it('should continue on error when continueOnError is true', async () => {
      const handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 2,
        continueOnError: true,
      })

      const documents = createTestDocuments(4)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      mockRpc.rpc
        .mockRejectedValueOnce(new Error('First batch failed'))
        .mockResolvedValueOnce({
          insertedIds: ['doc-3', 'doc-4'],
          insertedCount: 2,
        })

      // Should not throw
      await expect(handler({ transaction })).resolves.not.toThrow()

      // Should have processed both batches
      expect(mockRpc.rpc).toHaveBeenCalledTimes(2)
    })

    it('should collect and throw aggregate error when continueOnError is true and throwAggregateError is true', async () => {
      const handler = createBatchInsertHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 2,
        continueOnError: true,
        throwAggregateError: true,
      })

      const documents = createTestDocuments(6)
      const mutations = createTestMutations(documents)
      const transaction = createMockTransaction(mutations)

      mockRpc.rpc
        .mockRejectedValueOnce(new Error('Batch 1 failed'))
        .mockResolvedValueOnce({ insertedIds: ['doc-3', 'doc-4'], insertedCount: 2 })
        .mockRejectedValueOnce(new Error('Batch 3 failed'))

      await expect(handler({ transaction })).rejects.toThrow(/Batch 1 failed.*Batch 3 failed/s)
    })
  })
})

// =============================================================================
// Direct Handler Function Tests
// =============================================================================

describe('handleBatchInsert', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({
      insertedIds: ['doc-1', 'doc-2'],
      insertedCount: 2,
    })
  })

  describe('basic functionality', () => {
    it('should be a function', () => {
      expect(typeof handleBatchInsert).toBe('function')
    })

    it('should insert documents in batches', async () => {
      const documents = createTestDocuments(5)

      mockRpc.rpc
        .mockResolvedValueOnce({
          insertedIds: ['doc-1', 'doc-2'],
          insertedCount: 2,
        })
        .mockResolvedValueOnce({
          insertedIds: ['doc-3', 'doc-4'],
          insertedCount: 2,
        })
        .mockResolvedValueOnce({
          insertedIds: ['doc-5'],
          insertedCount: 1,
        })

      const result = await handleBatchInsert<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        documents,
        batchSize: 2,
      })

      expect(result.success).toBe(true)
      expect(result.insertedCount).toBe(5)
      expect(result.insertedIds).toHaveLength(5)
      expect(mockRpc.rpc).toHaveBeenCalledTimes(3)
    })

    it('should return detailed batch results', async () => {
      const documents = createTestDocuments(4)

      mockRpc.rpc
        .mockResolvedValueOnce({
          insertedIds: ['doc-1', 'doc-2'],
          insertedCount: 2,
        })
        .mockResolvedValueOnce({
          insertedIds: ['doc-3', 'doc-4'],
          insertedCount: 2,
        })

      const result = await handleBatchInsert<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        documents,
        batchSize: 2,
      })

      expect(result.batchResults).toHaveLength(2)
      expect(result.batchResults![0]).toMatchObject({
        batchNumber: 1,
        success: true,
        insertedCount: 2,
      })
      expect(result.batchResults![1]).toMatchObject({
        batchNumber: 2,
        success: true,
        insertedCount: 2,
      })
    })
  })

  describe('input validation', () => {
    it('should throw when documents is not provided', async () => {
      await expect(
        handleBatchInsert<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          documents: undefined as any,
        })
      ).rejects.toThrow('documents is required')
    })

    it('should throw when documents is empty', async () => {
      await expect(
        handleBatchInsert<TestDocument>({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          documents: [],
        })
      ).rejects.toThrow('documents array cannot be empty')
    })
  })

  describe('partial failure handling', () => {
    it('should track failed batches in result', async () => {
      const documents = createTestDocuments(6)

      mockRpc.rpc
        .mockResolvedValueOnce({ insertedIds: ['doc-1', 'doc-2'], insertedCount: 2 })
        .mockRejectedValueOnce(new Error('Batch 2 failed'))
        .mockResolvedValueOnce({ insertedIds: ['doc-5', 'doc-6'], insertedCount: 2 })

      const result = await handleBatchInsert<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        documents,
        batchSize: 2,
        continueOnError: true,
      })

      expect(result.success).toBe(false) // Overall success is false due to failed batch
      expect(result.insertedCount).toBe(4) // 2 + 0 + 2
      expect(result.failedBatches).toHaveLength(1)
      expect(result.failedBatches![0]).toMatchObject({
        batchNumber: 2,
        error: expect.any(Error),
        documents: [documents[2], documents[3]],
      })
    })
  })

  describe('connection handling', () => {
    it('should return error when client is not connected', async () => {
      mockRpc.isConnected.mockReturnValue(false)

      const result = await handleBatchInsert<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        documents: createTestDocuments(2),
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('not connected')
    })
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('type safety', () => {
  it('should maintain generic type through handler', async () => {
    const mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({
      insertedIds: ['doc-1'],
      insertedCount: 1,
    })

    // This test verifies TypeScript compilation
    const handler = createBatchInsertHandler<TestDocument>({
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
// Statistics Tests
// =============================================================================

describe('statistics', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({
      insertedIds: ['doc-1', 'doc-2'],
      insertedCount: 2,
    })
  })

  it('should return processing statistics', async () => {
    const result = await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: createTestDocuments(5),
      batchSize: 2,
    })

    expect(result.statistics).toBeDefined()
    expect(result.statistics).toMatchObject({
      totalBatches: 3,
      successfulBatches: 3,
      failedBatches: 0,
      totalDocuments: 5,
      insertedDocuments: 5,
      durationMs: expect.any(Number),
    })
  })

  it('should calculate throughput statistics', async () => {
    // Add artificial delay to ensure measurable duration
    mockRpc.rpc.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return { insertedIds: ['doc-1', 'doc-2'], insertedCount: 2 }
    })

    const result = await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: createTestDocuments(10),
      batchSize: 5,
    })

    expect(result.statistics?.documentsPerSecond).toBeGreaterThan(0)
  })
})

// =============================================================================
// Retry Logic Tests (RED Phase)
// =============================================================================

describe('retry logic', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
  })

  it('should retry on transient network errors', async () => {
    // First call fails, second succeeds
    mockRpc.rpc
      .mockRejectedValueOnce(new Error('Network temporarily unavailable'))
      .mockResolvedValueOnce({ insertedIds: ['doc-1', 'doc-2'], insertedCount: 2 })

    const handler = createBatchInsertHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      batchSize: 10,
      retryConfig: {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      },
    })

    const documents = createTestDocuments(2)
    const mutations = createTestMutations(documents)
    const transaction = createMockTransaction(mutations)

    await expect(handler({ transaction })).resolves.not.toThrow()
    expect(mockRpc.rpc).toHaveBeenCalledTimes(2)
  })

  it('should not retry on duplicate key errors', async () => {
    mockRpc.rpc.mockRejectedValue(new Error('E11000 duplicate key error collection'))

    const handler = createBatchInsertHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      batchSize: 10,
      retryConfig: {
        maxRetries: 3,
        initialDelayMs: 10,
      },
    })

    const documents = createTestDocuments(2)
    const mutations = createTestMutations(documents)
    const transaction = createMockTransaction(mutations)

    await expect(handler({ transaction })).rejects.toThrow('duplicate key')
    // Should only try once - no retries for duplicate key errors
    expect(mockRpc.rpc).toHaveBeenCalledTimes(1)
  })

  it('should respect maxRetries limit', async () => {
    mockRpc.rpc.mockRejectedValue(new Error('Connection refused'))

    const handler = createBatchInsertHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      batchSize: 10,
      retryConfig: {
        maxRetries: 2,
        initialDelayMs: 10,
      },
    })

    const documents = createTestDocuments(2)
    const mutations = createTestMutations(documents)
    const transaction = createMockTransaction(mutations)

    await expect(handler({ transaction })).rejects.toThrow('Connection refused')
    // Initial attempt + 2 retries = 3 total
    expect(mockRpc.rpc).toHaveBeenCalledTimes(3)
  })

  it('should use exponential backoff between retries', async () => {
    const callTimes: number[] = []
    mockRpc.rpc.mockImplementation(async () => {
      callTimes.push(Date.now())
      throw new Error('Network error')
    })

    const handler = createBatchInsertHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      batchSize: 10,
      retryConfig: {
        maxRetries: 2,
        initialDelayMs: 20,
        backoffMultiplier: 2,
      },
    })

    const documents = createTestDocuments(2)
    const mutations = createTestMutations(documents)
    const transaction = createMockTransaction(mutations)

    await expect(handler({ transaction })).rejects.toThrow()

    // Verify exponential backoff: first delay ~20ms, second ~40ms
    if (callTimes.length >= 3) {
      const firstDelay = callTimes[1]! - callTimes[0]!
      const secondDelay = callTimes[2]! - callTimes[1]!
      expect(firstDelay).toBeGreaterThanOrEqual(15) // Allow some tolerance
      expect(secondDelay).toBeGreaterThanOrEqual(firstDelay)
    }
  })

  it('should retry with jitter when configured', async () => {
    const callTimes: number[] = []
    mockRpc.rpc.mockImplementation(async () => {
      callTimes.push(Date.now())
      throw new Error('Timeout')
    })

    const handler = createBatchInsertHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      batchSize: 10,
      retryConfig: {
        maxRetries: 3,
        initialDelayMs: 50,
        jitter: true,
      },
    })

    const documents = createTestDocuments(2)
    const mutations = createTestMutations(documents)
    const transaction = createMockTransaction(mutations)

    await expect(handler({ transaction })).rejects.toThrow()
    expect(mockRpc.rpc).toHaveBeenCalledTimes(4)
  })
})

// =============================================================================
// Write Concern Tests (RED Phase)
// =============================================================================

describe('write concern options', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ insertedIds: ['doc-1'], insertedCount: 1 })
  })

  it('should pass writeConcern to insertMany', async () => {
    const result = await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: createTestDocuments(2),
      batchSize: 10,
      options: {
        writeConcern: { w: 'majority', j: true, wtimeout: 5000 },
      },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith(
      'insertMany',
      expect.objectContaining({
        options: {
          writeConcern: { w: 'majority', j: true, wtimeout: 5000 },
        },
      })
    )
  })

  it('should pass ordered option for batch processing', async () => {
    const result = await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: createTestDocuments(3),
      batchSize: 10,
      options: {
        ordered: false,
      },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith(
      'insertMany',
      expect.objectContaining({
        options: { ordered: false },
      })
    )
  })

  it('should handle write concern errors gracefully', async () => {
    const writeConcernError = new Error('Write concern error: not enough data-bearing nodes')
    mockRpc.rpc.mockRejectedValue(writeConcernError)

    const result = await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: createTestDocuments(2),
    })

    expect(result.success).toBe(false)
    expect(result.isWriteConcernError).toBe(true)
  })
})

// =============================================================================
// Cancellation Tests (RED Phase)
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
      return { insertedIds: ['doc-1'], insertedCount: 1 }
    })

    const resultPromise = handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: createTestDocuments(10),
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
      return { insertedIds: ['doc-1'], insertedCount: 1 }
    })

    const resultPromise = handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: createTestDocuments(10),
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
      return { insertedIds: [`doc-${batchCount}`], insertedCount: 1 }
    })

    const result = await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: createTestDocuments(10),
      batchSize: 2,
      signal: abortController.signal,
      returnPartialOnCancel: true,
    })

    expect(result.success).toBe(false)
    expect(result.cancelled).toBe(true)
    expect(result.insertedCount).toBeGreaterThan(0)
  })
})

// =============================================================================
// Memory Efficiency Tests (RED Phase)
// =============================================================================

describe('memory efficiency', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ insertedIds: [], insertedCount: 100 })
  })

  it('should support streaming mode for large datasets', async () => {
    const handler = createBatchInsertHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      batchSize: 100,
      streamingMode: true,
    })

    // Create an async generator for documents
    async function* generateDocuments() {
      for (let i = 0; i < 500; i++) {
        yield {
          _id: `doc-${i}`,
          name: `Document ${i}`,
          value: i,
          createdAt: new Date(),
        }
      }
    }

    const transaction = {
      id: 'tx-stream',
      mutations: [],
      getMutations: () => [],
      getDocumentStream: generateDocuments,
    }

    await handler({ transaction: transaction as any })

    // Should have processed 5 batches (500 / 100)
    expect(mockRpc.rpc).toHaveBeenCalledTimes(5)
  })

  it('should limit maximum documents in memory', async () => {
    const handler = createBatchInsertHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      batchSize: 50,
      maxDocumentsInMemory: 100,
    })

    const documents = createTestDocuments(200)
    const mutations = createTestMutations(documents)
    const transaction = createMockTransaction(mutations)

    await handler({ transaction })

    // Verify batches were processed without holding all documents in memory
    expect(mockRpc.rpc).toHaveBeenCalledTimes(4)
  })
})

// =============================================================================
// Validation Tests (RED Phase)
// =============================================================================

describe('document validation', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ insertedIds: ['doc-1'], insertedCount: 1 })
  })

  it('should validate documents before insert when schema provided', async () => {
    const schema = {
      type: 'object',
      required: ['_id', 'name'],
      properties: {
        _id: { type: 'string' },
        name: { type: 'string', minLength: 1 },
        value: { type: 'number' },
      },
    }

    const result = await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: [
        { _id: 'doc-1', name: 'Valid', value: 1, createdAt: new Date() },
        { _id: 'doc-2', name: '', value: 2, createdAt: new Date() }, // Invalid: empty name
      ],
      batchSize: 10,
      validationSchema: schema,
    })

    expect(result.success).toBe(false)
    expect(result.validationErrors).toBeDefined()
    expect(result.validationErrors).toHaveLength(1)
    expect(result.validationErrors![0].documentIndex).toBe(1)
  })

  it('should skip invalid documents when skipInvalidDocuments is true', async () => {
    const schema = {
      type: 'object',
      required: ['_id', 'name'],
    }

    const result = await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: [
        { _id: 'doc-1', name: 'Valid', value: 1, createdAt: new Date() },
        { _id: 'doc-2', name: undefined as any, value: 2, createdAt: new Date() },
        { _id: 'doc-3', name: 'Also Valid', value: 3, createdAt: new Date() },
      ],
      batchSize: 10,
      validationSchema: schema,
      skipInvalidDocuments: true,
    })

    expect(result.success).toBe(true)
    expect(result.insertedCount).toBe(2)
    expect(result.skippedDocuments).toBe(1)
  })

  it('should run custom validation function', async () => {
    const validateFn = vi.fn().mockImplementation((doc: TestDocument) => {
      if (doc.value < 0) {
        return { valid: false, error: 'Value must be non-negative' }
      }
      return { valid: true }
    })

    const result = await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: [
        { _id: 'doc-1', name: 'Valid', value: 1, createdAt: new Date() },
        { _id: 'doc-2', name: 'Invalid', value: -5, createdAt: new Date() },
      ],
      batchSize: 10,
      validateDocument: validateFn,
    })

    expect(validateFn).toHaveBeenCalledTimes(2)
    expect(result.success).toBe(false)
    expect(result.validationErrors).toHaveLength(1)
  })
})

// =============================================================================
// Duplicate Detection Tests (RED Phase)
// =============================================================================

describe('duplicate detection', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ insertedIds: ['doc-1', 'doc-2'], insertedCount: 2 })
  })

  it('should detect duplicate _ids within batch', async () => {
    const result = await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: [
        { _id: 'doc-1', name: 'First', value: 1, createdAt: new Date() },
        { _id: 'doc-1', name: 'Duplicate', value: 2, createdAt: new Date() }, // Same _id
        { _id: 'doc-2', name: 'Second', value: 3, createdAt: new Date() },
      ],
      batchSize: 10,
      detectDuplicates: true,
    })

    expect(result.success).toBe(false)
    expect(result.duplicateIds).toContain('doc-1')
  })

  it('should remove duplicates when deduplicateById is true', async () => {
    const result = await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: [
        { _id: 'doc-1', name: 'First', value: 1, createdAt: new Date() },
        { _id: 'doc-1', name: 'Duplicate', value: 2, createdAt: new Date() },
        { _id: 'doc-2', name: 'Second', value: 3, createdAt: new Date() },
      ],
      batchSize: 10,
      deduplicateById: true,
    })

    expect(result.success).toBe(true)
    expect(result.insertedCount).toBe(2)
    expect(result.deduplicatedCount).toBe(1)
  })

  it('should keep last document when deduplicateById with keepLast strategy', async () => {
    const result = await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: [
        { _id: 'doc-1', name: 'First', value: 1, createdAt: new Date() },
        { _id: 'doc-1', name: 'Last', value: 99, createdAt: new Date() },
      ],
      batchSize: 10,
      deduplicateById: true,
      deduplicationStrategy: 'keepLast',
    })

    // Should have sent the last version
    expect(mockRpc.rpc).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        documents: expect.arrayContaining([
          expect.objectContaining({ name: 'Last', value: 99 }),
        ]),
      })
    )
  })
})

// =============================================================================
// Transformation Tests (RED Phase)
// =============================================================================

describe('document transformation', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ insertedIds: ['doc-1'], insertedCount: 1 })
  })

  it('should transform documents with transformDocument function', async () => {
    const transformFn = vi.fn().mockImplementation((doc: TestDocument) => ({
      ...doc,
      name: doc.name.toUpperCase(),
      processedAt: new Date(),
    }))

    await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: [{ _id: 'doc-1', name: 'test', value: 1, createdAt: new Date() }],
      batchSize: 10,
      transformDocument: transformFn,
    })

    expect(transformFn).toHaveBeenCalled()
    expect(mockRpc.rpc).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        documents: expect.arrayContaining([
          expect.objectContaining({
            name: 'TEST',
            processedAt: expect.any(Date),
          }),
        ]),
      })
    )
  })

  it('should add timestamps when addTimestamps is true', async () => {
    await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents: [{ _id: 'doc-1', name: 'test', value: 1, createdAt: new Date() }],
      batchSize: 10,
      addTimestamps: true,
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        documents: expect.arrayContaining([
          expect.objectContaining({
            _createdAt: expect.any(Date),
            _updatedAt: expect.any(Date),
          }),
        ]),
      })
    )
  })

  it('should generate _id when generateId is true and _id is missing', async () => {
    const documents = [
      { name: 'No ID 1', value: 1, createdAt: new Date() },
      { name: 'No ID 2', value: 2, createdAt: new Date() },
    ] as TestDocument[]

    await handleBatchInsert<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      documents,
      batchSize: 10,
      generateId: true,
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        documents: expect.arrayContaining([
          expect.objectContaining({ _id: expect.any(String) }),
          expect.objectContaining({ _id: expect.any(String) }),
        ]),
      })
    )
  })
})

// =============================================================================
// TanStack DB Integration Tests (RED Phase)
// =============================================================================

describe('TanStack DB integration', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ insertedIds: ['doc-1'], insertedCount: 1 })
  })

  it('should work with TransactionWithMutations interface', async () => {
    const handler = createBatchInsertHandler<TestDocument>({
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
    const handler = createBatchInsertHandler<TestDocument>({
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

  it('should handle syncMetadata for conflict resolution', async () => {
    const handler = createBatchInsertHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      includeSyncMetadata: true,
    })

    const mockTanStackTransaction = {
      id: 'tx-789',
      mutations: [
        {
          mutationId: 'mut-1',
          type: 'insert' as const,
          key: 'doc-1',
          modified: { _id: 'doc-1', name: 'Test', value: 1, createdAt: new Date() },
          original: {},
          changes: {},
          syncMetadata: {
            clientId: 'client-123',
            version: 1,
            timestamp: Date.now(),
          },
        },
      ],
      getMutations: function () {
        return this.mutations
      },
    }

    await handler({ transaction: mockTanStackTransaction as any })

    expect(mockRpc.rpc).toHaveBeenCalledWith(
      'insertOne',
      expect.objectContaining({
        document: expect.objectContaining({
          _syncMetadata: expect.objectContaining({
            clientId: 'client-123',
            version: 1,
          }),
        }),
      })
    )
  })
})
