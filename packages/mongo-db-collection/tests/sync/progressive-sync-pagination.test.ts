/**
 * @file Progressive Sync Pagination Tests (RED Phase - TDD)
 *
 * These tests verify that progressive sync correctly paginates through
 * all documents in batches, advancing the cursor/skip value between batches.
 *
 * BUG: sync-function.ts:322-355
 * The current implementation fetches the same first batch repeatedly
 * without advancing the cursor/skip parameter.
 *
 * RED PHASE: These tests will fail until the bug is fixed.
 *
 * @see https://github.com/tanstackdb/issues/tanstackdb-5k2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMongoDoSync } from '../../src/sync/sync-function'
import type { MongoDoCollectionConfig, SyncParams, ChangeMessage } from '../../src/types'
import type { Collection } from '@tanstack/db'
import { z } from 'zod'

// Test document schema
const testDocumentSchema = z.object({
  _id: z.string(),
  name: z.string(),
  value: z.number(),
})

type TestDocument = z.infer<typeof testDocumentSchema>

// Mock Collection interface
interface MockCollection<T extends object> {
  id: string
  state: () => Map<string | number, T>
}

// Mock RPC client
const mockRpcClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  isConnected: vi.fn(() => false),
  rpc: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}

// Helper to get all rpc calls with method 'find'
function getFindCalls() {
  return mockRpcClient.rpc.mock.calls
    .filter((call) => call[0] === 'find')
    .map((call) => ({ method: call[0], params: call[1] || {} }))
}

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState: number = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((error: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(url: string) {
    this.url = url
  }

  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) this.onclose()
  })

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    if (this.onopen) this.onopen()
  }
}

// Store original WebSocket
const originalWebSocket = globalThis.WebSocket

// Track mock WebSocket instance
let mockWs: MockWebSocket

// Helper function to create mock SyncParams
function createMockSyncParams(): SyncParams<TestDocument> & {
  begin: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
  markReady: ReturnType<typeof vi.fn>
} {
  const mockCollection: MockCollection<TestDocument> = {
    id: 'test-collection',
    state: () => new Map(),
  }

  return {
    collection: mockCollection as unknown as Collection<TestDocument>,
    begin: vi.fn(),
    write: vi.fn(),
    commit: vi.fn(),
    markReady: vi.fn(),
  }
}

// Generate test documents with sequential IDs
function generateTestDocuments(count: number, startIndex = 0): TestDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `doc-${startIndex + i}`,
    name: `Document ${startIndex + i}`,
    value: startIndex + i,
  }))
}

describe('Progressive Sync Pagination', () => {
  const baseConfig: MongoDoCollectionConfig<TestDocument> = {
    id: 'test-collection',
    endpoint: 'https://api.mongo.do',
    database: 'testdb',
    collectionName: 'documents',
    schema: testDocumentSchema,
    getKey: (doc) => doc._id,
    syncMode: 'progressive',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    ;(globalThis as any).WebSocket = vi.fn((url: string) => {
      mockWs = new MockWebSocket(url)
      return mockWs
    })
    // Reset RPC client mocks
    mockRpcClient.isConnected.mockReturnValue(false)
    mockRpcClient.connect.mockResolvedValue(undefined)
    mockRpcClient.disconnect.mockResolvedValue(undefined)
    mockRpcClient.rpc.mockReset()
    mockRpcClient.rpc.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    ;(globalThis as any).WebSocket = originalWebSocket
    vi.restoreAllMocks()
  })

  describe('cursor/skip advancement', () => {
    it('should increment skip parameter for each batch', async () => {
      const batchSize = 2

      // Setup: 5 documents total, fetched in batches of 2
      // Expected batches: [doc-0, doc-1], [doc-2, doc-3], [doc-4]
      const batch1 = generateTestDocuments(2, 0) // doc-0, doc-1
      const batch2 = generateTestDocuments(2, 2) // doc-2, doc-3
      const batch3 = generateTestDocuments(1, 4) // doc-4 (partial batch - end of data)

      mockRpcClient.rpc
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce(batch3)

      const config = {
        ...baseConfig,
        _rpcClient: mockRpcClient,
        batchSize,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()

      // Wait for all batches to complete
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(100) // Wait for batch delay
      await vi.advanceTimersByTimeAsync(100) // Wait for batch delay

      const findCalls = getFindCalls()

      expect(findCalls).toHaveLength(3)

      // First batch: skip should be 0 (or undefined)
      expect(findCalls[0]?.params?.skip ?? 0).toBe(0)
      expect(findCalls[0]?.params?.limit).toBe(batchSize)

      // Second batch: skip should be 2
      expect(findCalls[1]?.params?.skip).toBe(2)
      expect(findCalls[1]?.params?.limit).toBe(batchSize)

      // Third batch: skip should be 4
      expect(findCalls[2]?.params?.skip).toBe(4)
      expect(findCalls[2]?.params?.limit).toBe(batchSize)
    })

    it('should advance cursor correctly with custom batch size', async () => {
      const batchSize = 50

      // Setup: 125 documents total, fetched in batches of 50
      // Expected: 3 full batches (skip: 0, 50, 100), then partial batch
      const batches = [
        generateTestDocuments(50, 0),
        generateTestDocuments(50, 50),
        generateTestDocuments(25, 100), // Partial batch (25 < 50)
      ]

      mockRpcClient.rpc
        .mockResolvedValueOnce(batches[0])
        .mockResolvedValueOnce(batches[1])
        .mockResolvedValueOnce(batches[2])

      const config = {
        ...baseConfig,
        _rpcClient: mockRpcClient,
        batchSize,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()

      // Wait for all batches
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      const findCalls = getFindCalls()

      expect(findCalls).toHaveLength(3)
      expect(findCalls[0]?.params?.skip ?? 0).toBe(0)
      expect(findCalls[1]?.params?.skip).toBe(50)
      expect(findCalls[2]?.params?.skip).toBe(100)
    })
  })

  describe('fetching different documents per batch', () => {
    it('should not fetch the same documents twice', async () => {
      const batchSize = 3

      // Track which document IDs are written
      const writtenDocIds: string[] = []

      // Create 7 documents - will need 3 batches
      const allDocs = generateTestDocuments(7)
      const batch1 = allDocs.slice(0, 3)
      const batch2 = allDocs.slice(3, 6)
      const batch3 = allDocs.slice(6, 7)

      mockRpcClient.rpc
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce(batch3)

      const config = {
        ...baseConfig,
        _rpcClient: mockRpcClient,
        batchSize,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      mockParams.write.mockImplementation((msg: ChangeMessage<TestDocument>) => {
        writtenDocIds.push(msg.key)
      })

      syncFn(mockParams)
      mockWs.simulateOpen()

      // Wait for all batches
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      // All 7 documents should be written exactly once
      expect(writtenDocIds).toHaveLength(7)

      // Check for no duplicates
      const uniqueIds = new Set(writtenDocIds)
      expect(uniqueIds.size).toBe(7)

      // Verify each expected document was written
      for (const doc of allDocs) {
        expect(writtenDocIds).toContain(doc._id)
      }
    })

    it('should fetch documents in sequential order across batches', async () => {
      const batchSize = 2

      const writtenDocs: TestDocument[] = []

      const allDocs = generateTestDocuments(5)

      mockRpcClient.rpc
        .mockResolvedValueOnce(allDocs.slice(0, 2))
        .mockResolvedValueOnce(allDocs.slice(2, 4))
        .mockResolvedValueOnce(allDocs.slice(4, 5))

      const config = {
        ...baseConfig,
        _rpcClient: mockRpcClient,
        batchSize,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      mockParams.write.mockImplementation((msg: ChangeMessage<TestDocument>) => {
        if (msg.value) {
          writtenDocs.push(msg.value)
        }
      })

      syncFn(mockParams)
      mockWs.simulateOpen()

      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      // Documents should be in order
      expect(writtenDocs.map((d) => d._id)).toEqual([
        'doc-0',
        'doc-1',
        'doc-2',
        'doc-3',
        'doc-4',
      ])
    })
  })

  describe('syncing all documents', () => {
    it('should sync all documents across multiple batches', async () => {
      const batchSize = 10
      const totalDocs = 35

      const allDocs = generateTestDocuments(totalDocs)
      const writtenDocIds: string[] = []

      // Setup batches: 10, 10, 10, 5 (partial)
      mockRpcClient.rpc
        .mockResolvedValueOnce(allDocs.slice(0, 10))
        .mockResolvedValueOnce(allDocs.slice(10, 20))
        .mockResolvedValueOnce(allDocs.slice(20, 30))
        .mockResolvedValueOnce(allDocs.slice(30, 35))

      const config = {
        ...baseConfig,
        _rpcClient: mockRpcClient,
        batchSize,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      mockParams.write.mockImplementation((msg: ChangeMessage<TestDocument>) => {
        writtenDocIds.push(msg.key)
      })

      syncFn(mockParams)
      mockWs.simulateOpen()

      // Wait for all 4 batches
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      // All 35 documents should be synced
      expect(writtenDocIds).toHaveLength(totalDocs)

      // Verify each document was synced
      for (let i = 0; i < totalDocs; i++) {
        expect(writtenDocIds).toContain(`doc-${i}`)
      }
    })

    it('should sync exactly the number of documents in the collection', async () => {
      const batchSize = 100 // Default batch size
      const totalDocs = 250

      const allDocs = generateTestDocuments(totalDocs)
      let writeCount = 0

      // Setup: 3 batches (100, 100, 50)
      mockRpcClient.rpc
        .mockResolvedValueOnce(allDocs.slice(0, 100))
        .mockResolvedValueOnce(allDocs.slice(100, 200))
        .mockResolvedValueOnce(allDocs.slice(200, 250))

      const config = {
        ...baseConfig,
        _rpcClient: mockRpcClient,
        batchSize,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      mockParams.write.mockImplementation(() => {
        writeCount++
      })

      syncFn(mockParams)
      mockWs.simulateOpen()

      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      expect(writeCount).toBe(totalDocs)
    })
  })

  describe('partial batch handling at end', () => {
    it('should stop when receiving partial batch (less than batch size)', async () => {
      const batchSize = 10

      // 23 documents: batch 1 (10), batch 2 (10), batch 3 (3 - partial)
      const allDocs = generateTestDocuments(23)

      mockRpcClient.rpc
        .mockResolvedValueOnce(allDocs.slice(0, 10))
        .mockResolvedValueOnce(allDocs.slice(10, 20))
        .mockResolvedValueOnce(allDocs.slice(20, 23))
        .mockResolvedValueOnce([]) // Should never reach this

      const config = {
        ...baseConfig,
        _rpcClient: mockRpcClient,
        batchSize,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()

      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100) // Extra time to ensure no more batches

      const findCalls = getFindCalls()

      // Should have made exactly 3 calls (not 4)
      expect(findCalls).toHaveLength(3)
    })

    it('should stop when receiving empty batch', async () => {
      const batchSize = 10

      // Exactly 10 documents - first batch full, second batch empty
      const allDocs = generateTestDocuments(10)

      mockRpcClient.rpc
        .mockResolvedValueOnce(allDocs)
        .mockResolvedValueOnce([]) // Empty batch indicates end

      const config = {
        ...baseConfig,
        _rpcClient: mockRpcClient,
        batchSize,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()

      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      const findCalls = getFindCalls()

      // Should have made exactly 2 calls
      expect(findCalls).toHaveLength(2)
      expect(mockParams.markReady).toHaveBeenCalled()
    })

    it('should handle single partial batch (total < batch size)', async () => {
      const batchSize = 100

      // Only 5 documents - single partial batch
      const allDocs = generateTestDocuments(5)

      mockRpcClient.rpc.mockResolvedValueOnce(allDocs)

      const config = {
        ...baseConfig,
        _rpcClient: mockRpcClient,
        batchSize,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()

      await vi.advanceTimersByTimeAsync(0)

      const findCalls = getFindCalls()

      // Should have made exactly 1 call
      expect(findCalls).toHaveLength(1)
      expect(mockParams.write).toHaveBeenCalledTimes(5)
      expect(mockParams.markReady).toHaveBeenCalled()
    })

    it('should handle empty collection gracefully', async () => {
      const batchSize = 100

      // Empty collection
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config = {
        ...baseConfig,
        _rpcClient: mockRpcClient,
        batchSize,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()

      await vi.advanceTimersByTimeAsync(0)

      const findCalls = getFindCalls()

      expect(findCalls).toHaveLength(1)
      expect(mockParams.write).not.toHaveBeenCalled()
      expect(mockParams.markReady).toHaveBeenCalled()
    })
  })

  describe('skip value calculation', () => {
    it('should calculate skip as (batch number) * (batch size)', async () => {
      const batchSize = 15
      const totalDocs = 50

      const allDocs = generateTestDocuments(totalDocs)

      // Setup batches: 15, 15, 15, 5
      mockRpcClient.rpc
        .mockResolvedValueOnce(allDocs.slice(0, 15))
        .mockResolvedValueOnce(allDocs.slice(15, 30))
        .mockResolvedValueOnce(allDocs.slice(30, 45))
        .mockResolvedValueOnce(allDocs.slice(45, 50))

      const config = {
        ...baseConfig,
        _rpcClient: mockRpcClient,
        batchSize,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()

      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      const findCalls = getFindCalls()

      expect(findCalls).toHaveLength(4)

      // Verify skip calculations: 0, 15, 30, 45
      expect(findCalls[0]?.params?.skip ?? 0).toBe(0 * batchSize) // 0
      expect(findCalls[1]?.params?.skip).toBe(1 * batchSize) // 15
      expect(findCalls[2]?.params?.skip).toBe(2 * batchSize) // 30
      expect(findCalls[3]?.params?.skip).toBe(3 * batchSize) // 45
    })
  })
})

describe('Progressive Sync Pagination - Regression Tests', () => {
  const baseConfig: MongoDoCollectionConfig<TestDocument> = {
    id: 'test-collection',
    endpoint: 'https://api.mongo.do',
    database: 'testdb',
    collectionName: 'documents',
    schema: testDocumentSchema,
    getKey: (doc) => doc._id,
    syncMode: 'progressive',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    ;(globalThis as any).WebSocket = vi.fn((url: string) => {
      mockWs = new MockWebSocket(url)
      return mockWs
    })
    // Reset RPC client mocks
    mockRpcClient.isConnected.mockReturnValue(false)
    mockRpcClient.connect.mockResolvedValue(undefined)
    mockRpcClient.disconnect.mockResolvedValue(undefined)
    mockRpcClient.rpc.mockReset()
    mockRpcClient.rpc.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    ;(globalThis as any).WebSocket = originalWebSocket
    vi.restoreAllMocks()
  })

  it('should NOT fetch the same batch repeatedly (the bug)', async () => {
    /**
     * This test specifically catches the bug where skip is not incremented,
     * causing the same first batch to be fetched repeatedly.
     *
     * BUG BEHAVIOR: Without skip, the loop fetches [doc-0, doc-1] repeatedly
     * until some condition breaks it (like cleanup or infinite loop detection).
     *
     * EXPECTED BEHAVIOR: Each batch should have an incrementing skip value,
     * ensuring different documents are fetched each time.
     */
    const batchSize = 2

    // We'll track what RPC calls are made
    let callCount = 0
    const batch = generateTestDocuments(2, 0) // Always return same batch

    mockRpcClient.rpc.mockImplementation(() => {
      callCount++
      if (callCount > 10) {
        // Failsafe to prevent infinite loop in buggy code
        return Promise.resolve([])
      }
      return Promise.resolve(batch)
    })

    const config = {
      ...baseConfig,
      _rpcClient: mockRpcClient,
      batchSize,
    }

    const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
    const mockParams = createMockSyncParams()

    syncFn(mockParams)
    mockWs.simulateOpen()

    // Simulate multiple batch cycles
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(100)
    }

    const findCalls = getFindCalls()

    // If the bug exists: all calls have skip=0 (or undefined)
    // If fixed: each subsequent call should have skip = previous_skip + batchSize
    const skipValues = findCalls.map((call) => call.params.skip ?? 0)

    // This assertion will FAIL with the current buggy implementation
    // because all skip values will be 0
    const allSameSkip = skipValues.every((skip) => skip === 0)
    expect(allSameSkip).toBe(false) // Each batch should have different skip value
  })

  it('should not create duplicate document entries', async () => {
    /**
     * This test verifies that the bug doesn't cause duplicate documents
     * in the synced collection.
     */
    const batchSize = 3

    const writtenKeys = new Map<string, number>() // Track write count per key

    // 9 documents total - should be 3 batches
    const allDocs = generateTestDocuments(9)

    mockRpcClient.rpc
      .mockResolvedValueOnce(allDocs.slice(0, 3))
      .mockResolvedValueOnce(allDocs.slice(3, 6))
      .mockResolvedValueOnce(allDocs.slice(6, 9))

    const config = {
      ...baseConfig,
      _rpcClient: mockRpcClient,
      batchSize,
    }

    const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
    const mockParams = createMockSyncParams()

    mockParams.write.mockImplementation((msg: ChangeMessage<TestDocument>) => {
      const count = writtenKeys.get(msg.key) ?? 0
      writtenKeys.set(msg.key, count + 1)
    })

    syncFn(mockParams)
    mockWs.simulateOpen()

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)

    // Each document should have been written exactly once
    for (const [key, count] of writtenKeys) {
      expect(count).toBe(1)
    }

    // All 9 unique documents should be present
    expect(writtenKeys.size).toBe(9)
  })
})
