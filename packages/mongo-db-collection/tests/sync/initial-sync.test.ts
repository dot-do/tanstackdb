/**
 * Initial Sync Executor Tests (TDD RED Phase)
 *
 * These tests verify the InitialSyncExecutor class which handles the initial
 * synchronization of MongoDB collections to TanStack DB by:
 *
 * 1. Fetching all documents from a MongoDB collection
 * 2. Writing each document as an insert message to TanStack DB
 * 3. Handling pagination/cursor for large collections
 * 4. Reporting progress during sync
 * 5. Handling errors gracefully with retries and recovery
 *
 * The InitialSyncExecutor is responsible for the "initial load" phase of sync,
 * where all existing documents are fetched before change stream watching begins.
 *
 * RED PHASE: These tests will fail until InitialSyncExecutor is implemented
 * in src/sync/initial-sync.ts
 *
 * @module @tanstack/mongo-db-collection/tests/sync/initial-sync
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { InitialSyncExecutor } from '../../src/sync/initial-sync'
import type { ChangeMessage, SyncParams } from '../../src/types'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Test document type for initial sync tests.
 */
interface TestDocument {
  _id: string
  name: string
  value: number
  createdAt: Date
}

/**
 * Test document with nested structure.
 */
interface NestedDocument {
  _id: string
  user: {
    profile: {
      name: string
      email: string
    }
  }
  metadata: {
    version: number
  }
}

/**
 * Mock RPC client for testing.
 */
interface MockRpcClient {
  find: ReturnType<typeof vi.fn>
  count: ReturnType<typeof vi.fn>
}

/**
 * Progress event emitted during sync.
 */
interface SyncProgressEvent {
  phase: 'starting' | 'fetching' | 'writing' | 'completed' | 'error'
  totalDocuments?: number
  processedDocuments: number
  percentage: number
  currentBatch?: number
  totalBatches?: number
  error?: Error
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a mock RPC client for testing.
 */
function createMockRpcClient(): MockRpcClient {
  return {
    find: vi.fn(),
    count: vi.fn(),
  }
}

/**
 * Creates mock sync params for testing.
 */
function createMockSyncParams<T extends object>(): {
  params: SyncParams<T>
  mocks: {
    begin: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    commit: ReturnType<typeof vi.fn>
    markReady: ReturnType<typeof vi.fn>
  }
} {
  const mocks = {
    begin: vi.fn(),
    write: vi.fn(),
    commit: vi.fn(),
    markReady: vi.fn(),
  }

  return {
    params: {
      collection: {} as any,
      begin: mocks.begin,
      write: mocks.write,
      commit: mocks.commit,
      markReady: mocks.markReady,
    },
    mocks,
  }
}

/**
 * Creates test documents for a given range.
 */
function createTestDocuments(start: number, count: number): TestDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `doc-${start + i}`,
    name: `Document ${start + i}`,
    value: (start + i) * 10,
    createdAt: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`),
  }))
}

// =============================================================================
// Constructor and Configuration Tests
// =============================================================================

describe('InitialSyncExecutor', () => {
  describe('constructor and configuration', () => {
    it('should be a class that can be instantiated', () => {
      const client = createMockRpcClient()
      const executor = new InitialSyncExecutor({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      expect(executor).toBeInstanceOf(InitialSyncExecutor)
    })

    it('should accept required configuration options', () => {
      const client = createMockRpcClient()
      const executor = new InitialSyncExecutor({
        rpcClient: client,
        database: 'mydb',
        collection: 'users',
      })

      expect(executor.database).toBe('mydb')
      expect(executor.collection).toBe('users')
    })

    it('should accept optional batch size configuration', () => {
      const client = createMockRpcClient()
      const executor = new InitialSyncExecutor({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 500,
      })

      expect(executor.batchSize).toBe(500)
    })

    it('should use default batch size when not specified', () => {
      const client = createMockRpcClient()
      const executor = new InitialSyncExecutor({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      expect(executor.batchSize).toBe(1000) // Default batch size
    })

    it('should accept optional getKey function', () => {
      const client = createMockRpcClient()
      const customGetKey = (doc: TestDocument) => `custom-${doc._id}`

      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        getKey: customGetKey,
      })

      expect(executor.getKey).toBe(customGetKey)
    })

    it('should use default getKey extracting _id when not specified', () => {
      const client = createMockRpcClient()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      const doc: TestDocument = {
        _id: 'test-123',
        name: 'Test',
        value: 42,
        createdAt: new Date(),
      }

      expect(executor.getKey(doc)).toBe('test-123')
    })

    it('should reject invalid batch size (zero or negative)', () => {
      const client = createMockRpcClient()

      expect(
        () =>
          new InitialSyncExecutor({
            rpcClient: client,
            database: 'testdb',
            collection: 'testcol',
            batchSize: 0,
          })
      ).toThrow(/batchSize/i)

      expect(
        () =>
          new InitialSyncExecutor({
            rpcClient: client,
            database: 'testdb',
            collection: 'testcol',
            batchSize: -10,
          })
      ).toThrow(/batchSize/i)
    })

    it('should accept retry configuration', () => {
      const client = createMockRpcClient()
      const executor = new InitialSyncExecutor({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        retries: 5,
        retryDelayMs: 2000,
      })

      expect(executor.retries).toBe(5)
      expect(executor.retryDelayMs).toBe(2000)
    })

    it('should use default retry configuration when not specified', () => {
      const client = createMockRpcClient()
      const executor = new InitialSyncExecutor({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      expect(executor.retries).toBe(3) // Default retries
      expect(executor.retryDelayMs).toBe(1000) // Default retry delay
    })
  })

  // =============================================================================
  // Basic Document Fetching Tests
  // =============================================================================

  describe('fetching documents from collection', () => {
    it('should fetch all documents from collection', async () => {
      const client = createMockRpcClient()
      const documents = createTestDocuments(1, 5)
      client.find.mockResolvedValue({ documents, hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await executor.execute(params)

      expect(client.find).toHaveBeenCalledWith(
        expect.objectContaining({
          database: 'testdb',
          collection: 'testcol',
        })
      )
    })

    it('should request documents with correct batch size', async () => {
      const client = createMockRpcClient()
      client.find.mockResolvedValue({ documents: [], hasMore: false })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 250,
      })

      await executor.execute(params)

      expect(client.find).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 250,
        })
      )
    })

    it('should fetch from empty collection without error', async () => {
      const client = createMockRpcClient()
      client.find.mockResolvedValue({ documents: [], hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await expect(executor.execute(params)).resolves.not.toThrow()
      expect(mocks.begin).toHaveBeenCalled()
      expect(mocks.commit).toHaveBeenCalled()
      expect(mocks.write).not.toHaveBeenCalled() // No documents to write
    })

    it('should preserve document structure during fetch', async () => {
      const client = createMockRpcClient()
      const nestedDoc: NestedDocument = {
        _id: 'nested-1',
        user: {
          profile: {
            name: 'John Doe',
            email: 'john@example.com',
          },
        },
        metadata: {
          version: 1,
        },
      }
      client.find.mockResolvedValue({ documents: [nestedDoc], hasMore: false })

      const { params, mocks } = createMockSyncParams<NestedDocument>()
      const executor = new InitialSyncExecutor<NestedDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await executor.execute(params)

      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          value: nestedDoc,
        })
      )
    })
  })

  // =============================================================================
  // Writing Insert Messages Tests
  // =============================================================================

  describe('writing insert messages', () => {
    it('should write each document as insert message', async () => {
      const client = createMockRpcClient()
      const documents = createTestDocuments(1, 3)
      client.find.mockResolvedValue({ documents, hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await executor.execute(params)

      expect(mocks.write).toHaveBeenCalledTimes(3)

      documents.forEach((doc, index) => {
        expect(mocks.write).toHaveBeenNthCalledWith(
          index + 1,
          expect.objectContaining({
            type: 'insert',
            key: doc._id,
            value: doc,
          })
        )
      })
    })

    it('should call begin before writing', async () => {
      const client = createMockRpcClient()
      client.find.mockResolvedValue({ documents: createTestDocuments(1, 1), hasMore: false })

      const callOrder: string[] = []
      const { params } = createMockSyncParams<TestDocument>()
      params.begin = vi.fn(() => {
        callOrder.push('begin')
      })
      params.write = vi.fn(() => {
        callOrder.push('write')
      })

      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await executor.execute(params)

      expect(callOrder[0]).toBe('begin')
      expect(callOrder).toContain('write')
    })

    it('should call commit after writing all documents', async () => {
      const client = createMockRpcClient()
      client.find.mockResolvedValue({ documents: createTestDocuments(1, 3), hasMore: false })

      const callOrder: string[] = []
      const { params } = createMockSyncParams<TestDocument>()
      params.write = vi.fn(() => {
        callOrder.push('write')
      })
      params.commit = vi.fn(() => {
        callOrder.push('commit')
      })

      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await executor.execute(params)

      const lastWriteIndex = callOrder.lastIndexOf('write')
      const commitIndex = callOrder.indexOf('commit')
      expect(commitIndex).toBeGreaterThan(lastWriteIndex)
    })

    it('should call markReady after commit', async () => {
      const client = createMockRpcClient()
      client.find.mockResolvedValue({ documents: createTestDocuments(1, 1), hasMore: false })

      const callOrder: string[] = []
      const { params } = createMockSyncParams<TestDocument>()
      params.commit = vi.fn(() => {
        callOrder.push('commit')
      })
      params.markReady = vi.fn(() => {
        callOrder.push('markReady')
      })

      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await executor.execute(params)

      const commitIndex = callOrder.indexOf('commit')
      const markReadyIndex = callOrder.indexOf('markReady')
      expect(markReadyIndex).toBeGreaterThan(commitIndex)
    })

    it('should use custom getKey function for message key', async () => {
      const client = createMockRpcClient()
      const doc: TestDocument = {
        _id: 'original-id',
        name: 'Test Doc',
        value: 100,
        createdAt: new Date(),
      }
      client.find.mockResolvedValue({ documents: [doc], hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const customGetKey = (d: TestDocument) => `custom-${d.value}-${d._id}`

      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        getKey: customGetKey,
      })

      await executor.execute(params)

      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'custom-100-original-id',
        })
      )
    })

    it('should not include previousValue in insert messages', async () => {
      const client = createMockRpcClient()
      client.find.mockResolvedValue({ documents: createTestDocuments(1, 1), hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await executor.execute(params)

      const writtenMessage = mocks.write.mock.calls[0][0] as ChangeMessage<TestDocument>
      expect(writtenMessage.previousValue).toBeUndefined()
    })
  })

  // =============================================================================
  // Pagination and Cursor Tests
  // =============================================================================

  describe('pagination and cursor handling', () => {
    it('should handle pagination for large collections', async () => {
      const client = createMockRpcClient()
      const batch1 = createTestDocuments(1, 100)
      const batch2 = createTestDocuments(101, 100)
      const batch3 = createTestDocuments(201, 50)

      client.find
        .mockResolvedValueOnce({ documents: batch1, hasMore: true, cursor: 'cursor-1' })
        .mockResolvedValueOnce({ documents: batch2, hasMore: true, cursor: 'cursor-2' })
        .mockResolvedValueOnce({ documents: batch3, hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 100,
      })

      await executor.execute(params)

      expect(client.find).toHaveBeenCalledTimes(3)
      expect(mocks.write).toHaveBeenCalledTimes(250) // 100 + 100 + 50
    })

    it('should pass cursor to subsequent fetch requests', async () => {
      const client = createMockRpcClient()
      const batch1 = createTestDocuments(1, 10)
      const batch2 = createTestDocuments(11, 5)

      client.find
        .mockResolvedValueOnce({ documents: batch1, hasMore: true, cursor: 'next-cursor-abc' })
        .mockResolvedValueOnce({ documents: batch2, hasMore: false })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 10,
      })

      await executor.execute(params)

      // First call should not have cursor
      expect(client.find).toHaveBeenNthCalledWith(
        1,
        expect.not.objectContaining({ cursor: expect.anything() })
      )

      // Second call should have cursor from first response
      expect(client.find).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ cursor: 'next-cursor-abc' })
      )
    })

    it('should stop fetching when hasMore is false', async () => {
      const client = createMockRpcClient()
      client.find.mockResolvedValue({
        documents: createTestDocuments(1, 50),
        hasMore: false,
        cursor: 'some-cursor',
      })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 100,
      })

      await executor.execute(params)

      expect(client.find).toHaveBeenCalledTimes(1)
    })

    it('should handle cursor-based pagination with _id sorting', async () => {
      const client = createMockRpcClient()
      const batch1 = createTestDocuments(1, 10)
      const batch2 = createTestDocuments(11, 10)

      client.find
        .mockResolvedValueOnce({ documents: batch1, hasMore: true, cursor: 'doc-10' })
        .mockResolvedValueOnce({ documents: batch2, hasMore: false })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 10,
      })

      await executor.execute(params)

      // Verify sorting by _id is requested
      expect(client.find).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          sort: { _id: 1 },
        })
      )
    })

    it('should handle very large collections with many pages', async () => {
      const client = createMockRpcClient()
      const pageCount = 100
      const docsPerPage = 1000

      // Mock 100 pages of 1000 documents each
      for (let i = 0; i < pageCount; i++) {
        const isLast = i === pageCount - 1
        client.find.mockResolvedValueOnce({
          documents: createTestDocuments(i * docsPerPage + 1, docsPerPage),
          hasMore: !isLast,
          cursor: isLast ? undefined : `cursor-${i}`,
        })
      }

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 1000,
      })

      await executor.execute(params)

      expect(client.find).toHaveBeenCalledTimes(pageCount)
      expect(mocks.write).toHaveBeenCalledTimes(pageCount * docsPerPage)
    })
  })

  // =============================================================================
  // Progress Reporting Tests
  // =============================================================================

  describe('progress reporting', () => {
    it('should emit progress events during sync', async () => {
      const client = createMockRpcClient()
      client.count.mockResolvedValue(100)
      client.find
        .mockResolvedValueOnce({ documents: createTestDocuments(1, 50), hasMore: true, cursor: 'c1' })
        .mockResolvedValueOnce({ documents: createTestDocuments(51, 50), hasMore: false })

      const onProgress = vi.fn()
      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 50,
        onProgress,
      })

      await executor.execute(params)

      expect(onProgress).toHaveBeenCalled()
    })

    it('should report starting phase', async () => {
      const client = createMockRpcClient()
      client.count.mockResolvedValue(10)
      client.find.mockResolvedValue({ documents: createTestDocuments(1, 10), hasMore: false })

      const progressEvents: SyncProgressEvent[] = []
      const onProgress = vi.fn((event: SyncProgressEvent) => {
        progressEvents.push(event)
      })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        onProgress,
      })

      await executor.execute(params)

      expect(progressEvents.some((e) => e.phase === 'starting')).toBe(true)
    })

    it('should report fetching phase with batch info', async () => {
      const client = createMockRpcClient()
      client.count.mockResolvedValue(100)
      client.find
        .mockResolvedValueOnce({ documents: createTestDocuments(1, 50), hasMore: true, cursor: 'c1' })
        .mockResolvedValueOnce({ documents: createTestDocuments(51, 50), hasMore: false })

      const progressEvents: SyncProgressEvent[] = []
      const onProgress = vi.fn((event: SyncProgressEvent) => {
        progressEvents.push(event)
      })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 50,
        onProgress,
      })

      await executor.execute(params)

      const fetchingEvents = progressEvents.filter((e) => e.phase === 'fetching')
      expect(fetchingEvents.length).toBeGreaterThan(0)
      expect(fetchingEvents[0]).toMatchObject({
        phase: 'fetching',
        currentBatch: expect.any(Number),
      })
    })

    it('should report writing phase with document counts', async () => {
      const client = createMockRpcClient()
      client.count.mockResolvedValue(100)
      client.find
        .mockResolvedValueOnce({ documents: createTestDocuments(1, 50), hasMore: true, cursor: 'c1' })
        .mockResolvedValueOnce({ documents: createTestDocuments(51, 50), hasMore: false })

      const progressEvents: SyncProgressEvent[] = []
      const onProgress = vi.fn((event: SyncProgressEvent) => {
        progressEvents.push(event)
      })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 50,
        onProgress,
      })

      await executor.execute(params)

      const writingEvents = progressEvents.filter((e) => e.phase === 'writing')
      expect(writingEvents.length).toBeGreaterThan(0)
      expect(writingEvents[0]).toMatchObject({
        phase: 'writing',
        processedDocuments: expect.any(Number),
      })
    })

    it('should report completion phase', async () => {
      const client = createMockRpcClient()
      client.count.mockResolvedValue(10)
      client.find.mockResolvedValue({ documents: createTestDocuments(1, 10), hasMore: false })

      const progressEvents: SyncProgressEvent[] = []
      const onProgress = vi.fn((event: SyncProgressEvent) => {
        progressEvents.push(event)
      })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        onProgress,
      })

      await executor.execute(params)

      const completedEvent = progressEvents.find((e) => e.phase === 'completed')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.percentage).toBe(100)
    })

    it('should report accurate percentage during sync', async () => {
      const client = createMockRpcClient()
      client.count.mockResolvedValue(100)
      client.find
        .mockResolvedValueOnce({ documents: createTestDocuments(1, 25), hasMore: true, cursor: 'c1' })
        .mockResolvedValueOnce({ documents: createTestDocuments(26, 25), hasMore: true, cursor: 'c2' })
        .mockResolvedValueOnce({ documents: createTestDocuments(51, 25), hasMore: true, cursor: 'c3' })
        .mockResolvedValueOnce({ documents: createTestDocuments(76, 25), hasMore: false })

      const progressEvents: SyncProgressEvent[] = []
      const onProgress = vi.fn((event: SyncProgressEvent) => {
        progressEvents.push(event)
      })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 25,
        onProgress,
      })

      await executor.execute(params)

      // Should have progress at 25%, 50%, 75%, 100%
      const percentages = progressEvents
        .filter((e) => e.phase === 'writing' || e.phase === 'completed')
        .map((e) => e.percentage)

      expect(percentages).toContain(25)
      expect(percentages).toContain(50)
      expect(percentages).toContain(75)
      expect(percentages).toContain(100)
    })

    it('should report total document count when available', async () => {
      const client = createMockRpcClient()
      client.count.mockResolvedValue(500)
      client.find.mockResolvedValue({ documents: createTestDocuments(1, 500), hasMore: false })

      const progressEvents: SyncProgressEvent[] = []
      const onProgress = vi.fn((event: SyncProgressEvent) => {
        progressEvents.push(event)
      })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        onProgress,
      })

      await executor.execute(params)

      const eventWithTotal = progressEvents.find((e) => e.totalDocuments !== undefined)
      expect(eventWithTotal?.totalDocuments).toBe(500)
    })

    it('should handle progress without count estimation', async () => {
      const client = createMockRpcClient()
      client.count.mockRejectedValue(new Error('Count not supported'))
      client.find
        .mockResolvedValueOnce({ documents: createTestDocuments(1, 50), hasMore: true, cursor: 'c1' })
        .mockResolvedValueOnce({ documents: createTestDocuments(51, 50), hasMore: false })

      const progressEvents: SyncProgressEvent[] = []
      const onProgress = vi.fn((event: SyncProgressEvent) => {
        progressEvents.push(event)
      })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 50,
        onProgress,
      })

      await executor.execute(params)

      // Should still report progress events even without total count
      expect(progressEvents.length).toBeGreaterThan(0)
      expect(progressEvents.some((e) => e.processedDocuments > 0)).toBe(true)
    })
  })

  // =============================================================================
  // Error Handling Tests
  // =============================================================================

  describe('error handling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should handle fetch errors gracefully', async () => {
      const client = createMockRpcClient()
      client.find.mockRejectedValue(new Error('Network error'))

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        retries: 0,
      })

      await expect(executor.execute(params)).rejects.toThrow('Network error')
    })

    it('should retry on transient errors', async () => {
      const client = createMockRpcClient()
      client.find
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ documents: createTestDocuments(1, 10), hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        retries: 3,
        retryDelayMs: 100,
      })

      const executePromise = executor.execute(params)

      // Advance timers for retry delays
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      await executePromise

      expect(client.find).toHaveBeenCalledTimes(3)
      expect(mocks.write).toHaveBeenCalledTimes(10)
    })

    it('should fail after exhausting retries', async () => {
      const client = createMockRpcClient()
      client.find.mockRejectedValue(new Error('Persistent failure'))

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        retries: 2,
        retryDelayMs: 50,
      })

      const executePromise = executor.execute(params)

      // Advance timers for retry delays
      await vi.advanceTimersByTimeAsync(50)
      await vi.advanceTimersByTimeAsync(50)

      await expect(executePromise).rejects.toThrow('Persistent failure')
      expect(client.find).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })

    it('should report error phase in progress', async () => {
      const client = createMockRpcClient()
      client.find.mockRejectedValue(new Error('Sync failed'))

      const progressEvents: SyncProgressEvent[] = []
      const onProgress = vi.fn((event: SyncProgressEvent) => {
        progressEvents.push(event)
      })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        retries: 0,
        onProgress,
      })

      await expect(executor.execute(params)).rejects.toThrow()

      const errorEvent = progressEvents.find((e) => e.phase === 'error')
      expect(errorEvent).toBeDefined()
      expect(errorEvent?.error).toBeInstanceOf(Error)
    })

    it('should not call commit or markReady on error', async () => {
      const client = createMockRpcClient()
      client.find.mockRejectedValue(new Error('Fetch failed'))

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        retries: 0,
      })

      await expect(executor.execute(params)).rejects.toThrow()

      expect(mocks.commit).not.toHaveBeenCalled()
      expect(mocks.markReady).not.toHaveBeenCalled()
    })

    it('should handle partial failure during pagination', async () => {
      const client = createMockRpcClient()
      client.find
        .mockResolvedValueOnce({ documents: createTestDocuments(1, 50), hasMore: true, cursor: 'c1' })
        .mockRejectedValueOnce(new Error('Connection lost'))
        .mockResolvedValueOnce({ documents: createTestDocuments(51, 50), hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 50,
        retries: 1,
        retryDelayMs: 50,
      })

      const executePromise = executor.execute(params)
      await vi.advanceTimersByTimeAsync(50)
      await executePromise

      expect(client.find).toHaveBeenCalledTimes(3)
      expect(mocks.write).toHaveBeenCalledTimes(100)
    })

    it('should use exponential backoff for retries', async () => {
      const client = createMockRpcClient()
      client.find
        .mockRejectedValueOnce(new Error('Retry 1'))
        .mockRejectedValueOnce(new Error('Retry 2'))
        .mockResolvedValueOnce({ documents: [], hasMore: false })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        retries: 3,
        retryDelayMs: 100,
        useExponentialBackoff: true,
      })

      const startTime = Date.now()
      const executePromise = executor.execute(params)

      // First retry: 100ms
      await vi.advanceTimersByTimeAsync(100)
      // Second retry: 200ms (exponential)
      await vi.advanceTimersByTimeAsync(200)

      await executePromise

      expect(client.find).toHaveBeenCalledTimes(3)
    })

    it('should handle write errors gracefully', async () => {
      const client = createMockRpcClient()
      client.find.mockResolvedValue({ documents: createTestDocuments(1, 5), hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      mocks.write.mockImplementationOnce(() => {
        throw new Error('Write failed')
      })

      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await expect(executor.execute(params)).rejects.toThrow('Write failed')
    })
  })

  // =============================================================================
  // Cancellation Tests
  // =============================================================================

  describe('cancellation', () => {
    it('should support cancellation via AbortSignal', async () => {
      const client = createMockRpcClient()
      client.find.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return { documents: createTestDocuments(1, 10), hasMore: true, cursor: 'c1' }
      })

      const { params } = createMockSyncParams<TestDocument>()
      const abortController = new AbortController()

      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      const executePromise = executor.execute(params, { signal: abortController.signal })

      // Cancel after first batch starts
      setTimeout(() => abortController.abort(), 50)

      await expect(executePromise).rejects.toThrow(/abort|cancel/i)
    })

    it('should stop fetching when cancelled', async () => {
      const client = createMockRpcClient()
      let fetchCount = 0
      client.find.mockImplementation(async () => {
        fetchCount++
        return { documents: createTestDocuments(fetchCount, 10), hasMore: true, cursor: `c${fetchCount}` }
      })

      const { params } = createMockSyncParams<TestDocument>()
      const abortController = new AbortController()

      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 10,
      })

      // Cancel after a few iterations
      setTimeout(() => abortController.abort(), 10)

      try {
        await executor.execute(params, { signal: abortController.signal })
      } catch {
        // Expected
      }

      // Should have stopped fetching
      expect(fetchCount).toBeLessThan(100)
    })

    it('should report cancellation in progress event', async () => {
      const client = createMockRpcClient()
      client.find.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { documents: createTestDocuments(1, 10), hasMore: true, cursor: 'c1' }
      })

      const progressEvents: SyncProgressEvent[] = []
      const onProgress = vi.fn((event: SyncProgressEvent) => {
        progressEvents.push(event)
      })

      const { params } = createMockSyncParams<TestDocument>()
      const abortController = new AbortController()

      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        onProgress,
      })

      setTimeout(() => abortController.abort(), 10)

      try {
        await executor.execute(params, { signal: abortController.signal })
      } catch {
        // Expected
      }

      // Should have an error phase event
      expect(progressEvents.some((e) => e.phase === 'error')).toBe(true)
    })
  })

  // =============================================================================
  // State and Lifecycle Tests
  // =============================================================================

  describe('state and lifecycle', () => {
    it('should report isRunning status', async () => {
      const client = createMockRpcClient()
      let isRunningDuringFetch = false

      client.find.mockImplementation(async () => {
        isRunningDuringFetch = executor.isRunning
        return { documents: createTestDocuments(1, 10), hasMore: false }
      })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      expect(executor.isRunning).toBe(false)
      await executor.execute(params)
      expect(isRunningDuringFetch).toBe(true)
      expect(executor.isRunning).toBe(false)
    })

    it('should prevent concurrent execution', async () => {
      const client = createMockRpcClient()
      client.find.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return { documents: createTestDocuments(1, 10), hasMore: false }
      })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      const promise1 = executor.execute(params)

      // Attempt concurrent execution
      await expect(executor.execute(params)).rejects.toThrow(/already running|concurrent/i)

      await promise1
    })

    it('should allow re-execution after completion', async () => {
      const client = createMockRpcClient()
      client.find.mockResolvedValue({ documents: createTestDocuments(1, 5), hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await executor.execute(params)
      expect(mocks.write).toHaveBeenCalledTimes(5)

      // Reset mock and execute again
      mocks.write.mockClear()
      await executor.execute(params)
      expect(mocks.write).toHaveBeenCalledTimes(5)
    })

    it('should return execution result with statistics', async () => {
      const client = createMockRpcClient()
      client.count.mockResolvedValue(100)
      client.find
        .mockResolvedValueOnce({ documents: createTestDocuments(1, 50), hasMore: true, cursor: 'c1' })
        .mockResolvedValueOnce({ documents: createTestDocuments(51, 50), hasMore: false })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 50,
      })

      const result = await executor.execute(params)

      expect(result).toMatchObject({
        totalDocuments: 100,
        batchCount: 2,
        durationMs: expect.any(Number),
        success: true,
      })
    })
  })

  // =============================================================================
  // Edge Cases Tests
  // =============================================================================

  describe('edge cases', () => {
    it('should handle documents with special characters in _id', async () => {
      const client = createMockRpcClient()
      const specialDoc: TestDocument = {
        _id: 'doc/with:special$chars#and@symbols!',
        name: 'Special',
        value: 1,
        createdAt: new Date(),
      }
      client.find.mockResolvedValue({ documents: [specialDoc], hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await executor.execute(params)

      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'doc/with:special$chars#and@symbols!',
        })
      )
    })

    it('should handle documents with Date fields', async () => {
      const client = createMockRpcClient()
      const testDate = new Date('2024-06-15T12:00:00Z')
      const doc: TestDocument = {
        _id: 'date-test',
        name: 'Date Test',
        value: 1,
        createdAt: testDate,
      }
      client.find.mockResolvedValue({ documents: [doc], hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await executor.execute(params)

      const writtenMessage = mocks.write.mock.calls[0][0] as ChangeMessage<TestDocument>
      expect(writtenMessage.value.createdAt).toEqual(testDate)
    })

    it('should handle empty batch in middle of pagination', async () => {
      const client = createMockRpcClient()
      client.find
        .mockResolvedValueOnce({ documents: createTestDocuments(1, 50), hasMore: true, cursor: 'c1' })
        .mockResolvedValueOnce({ documents: [], hasMore: true, cursor: 'c2' }) // Empty batch
        .mockResolvedValueOnce({ documents: createTestDocuments(51, 50), hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 50,
      })

      await executor.execute(params)

      expect(client.find).toHaveBeenCalledTimes(3)
      expect(mocks.write).toHaveBeenCalledTimes(100)
    })

    it('should handle single document collection', async () => {
      const client = createMockRpcClient()
      const singleDoc = createTestDocuments(1, 1)[0]
      client.find.mockResolvedValue({ documents: [singleDoc], hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
      })

      await executor.execute(params)

      expect(mocks.write).toHaveBeenCalledTimes(1)
      expect(mocks.write).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          key: singleDoc._id,
          value: singleDoc,
        })
      )
    })

    it('should handle batch size larger than collection', async () => {
      const client = createMockRpcClient()
      const docs = createTestDocuments(1, 5)
      client.find.mockResolvedValue({ documents: docs, hasMore: false })

      const { params, mocks } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        batchSize: 10000, // Much larger than collection
      })

      await executor.execute(params)

      expect(client.find).toHaveBeenCalledTimes(1)
      expect(mocks.write).toHaveBeenCalledTimes(5)
    })
  })

  // =============================================================================
  // Filter Options Tests
  // =============================================================================

  describe('filter options', () => {
    it('should support initial filter query', async () => {
      const client = createMockRpcClient()
      client.find.mockResolvedValue({ documents: [], hasMore: false })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        filter: { value: { $gt: 100 } },
      })

      await executor.execute(params)

      expect(client.find).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { value: { $gt: 100 } },
        })
      )
    })

    it('should support projection options', async () => {
      const client = createMockRpcClient()
      client.find.mockResolvedValue({ documents: [], hasMore: false })

      const { params } = createMockSyncParams<TestDocument>()
      const executor = new InitialSyncExecutor<TestDocument>({
        rpcClient: client,
        database: 'testdb',
        collection: 'testcol',
        projection: { _id: 1, name: 1 },
      })

      await executor.execute(params)

      expect(client.find).toHaveBeenCalledWith(
        expect.objectContaining({
          projection: { _id: 1, name: 1 },
        })
      )
    })
  })
})
