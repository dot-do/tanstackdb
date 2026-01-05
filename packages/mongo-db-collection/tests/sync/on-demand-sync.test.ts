/**
 * @file On-Demand Sync Mode Tests (RED Phase - TDD)
 *
 * These tests verify the on-demand sync mode functionality where data is loaded
 * only when explicitly accessed rather than eagerly syncing all documents.
 *
 * On-demand sync mode is designed for:
 * - Large datasets where loading all data upfront is impractical
 * - Bandwidth-limited environments
 * - Scenarios where users control when to sync
 * - Applications with selective data requirements
 *
 * Key behaviors tested:
 * 1. Initial sync should NOT load any data (marks ready immediately)
 * 2. loadSubset function should be provided
 * 3. Data loads only when loadSubset is called
 * 4. Multiple loadSubset calls with different filters
 * 5. Pagination support (limit, offset, cursor)
 * 6. Filter query support with MongoDB operators
 * 7. Change stream events still sync in real-time after loadSubset
 * 8. Cleanup properly stops all pending loads
 *
 * RED PHASE: These tests will fail until on-demand sync mode is fully implemented
 *
 * @module tests/sync/on-demand-sync
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMongoDoSync } from '../../src/sync/sync-function'
import type {
  MongoDoCollectionConfig,
  SyncParams,
  SyncReturn,
  ChangeMessage,
  LoadSubsetOptions,
} from '../../src/types'
import type { Collection } from '@tanstack/db'
import { z } from 'zod'

// =============================================================================
// Test Setup
// =============================================================================

const testDocumentSchema = z.object({
  _id: z.string(),
  name: z.string(),
  category: z.string(),
  price: z.number(),
  inStock: z.boolean(),
  tags: z.array(z.string()).optional(),
  createdAt: z.date().optional(),
})

type TestDocument = z.infer<typeof testDocumentSchema>

// Mock RPC client for testing
const createMockRpcClient = () => ({
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  isConnected: vi.fn(() => true),
  rpc: vi.fn().mockResolvedValue([]),
  on: vi.fn(),
  off: vi.fn(),
})

// Mock WebSocket for change stream
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

  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }))
    }
  }
}

const originalWebSocket = globalThis.WebSocket
let mockWs: MockWebSocket

// Mock Collection type
interface MockCollection<T extends object> {
  id: string
  state: () => Map<string, T>
}

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

// =============================================================================
// Test Suite
// =============================================================================

describe('On-Demand Sync Mode', () => {
  let mockRpcClient: ReturnType<typeof createMockRpcClient>

  const createOnDemandConfig = (
    overrides: Partial<MongoDoCollectionConfig<TestDocument>> = {}
  ): MongoDoCollectionConfig<TestDocument> & { _rpcClient: typeof mockRpcClient } => ({
    id: 'on-demand-collection',
    endpoint: 'https://api.mongo.do',
    database: 'testdb',
    collectionName: 'products',
    schema: testDocumentSchema,
    getKey: (doc) => doc._id,
    syncMode: 'on-demand',
    enableChangeStream: true,
    _rpcClient: mockRpcClient,
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockRpcClient = createMockRpcClient()
    ;(globalThis as any).WebSocket = vi.fn((url: string) => {
      mockWs = new MockWebSocket(url)
      return mockWs
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    ;(globalThis as any).WebSocket = originalWebSocket
    vi.restoreAllMocks()
  })

  describe('initial sync behavior', () => {
    it('should NOT load any data during initial sync in on-demand mode', async () => {
      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Should NOT call RPC to fetch data
      expect(mockRpcClient.rpc).not.toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          database: 'testdb',
          collection: 'products',
        })
      )
    })

    it('should call markReady immediately without loading data', async () => {
      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.markReady).toHaveBeenCalled()
      // No data should have been written
      expect(mockParams.write).not.toHaveBeenCalled()
    })

    it('should call begin and commit even with no data', async () => {
      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.begin).toHaveBeenCalled()
      expect(mockParams.commit).toHaveBeenCalled()
    })

    it('should be ready faster than eager mode', async () => {
      const onDemandConfig = createOnDemandConfig()
      const eagerConfig = createOnDemandConfig({ syncMode: 'eager' })

      // Mock slow data load for eager mode
      mockRpcClient.rpc.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return Array(100)
          .fill(null)
          .map((_, i) => ({
            _id: `doc-${i}`,
            name: `Doc ${i}`,
            category: 'test',
            price: 10,
            inStock: true,
          }))
      })

      const onDemandParams = createMockSyncParams()
      const eagerParams = createMockSyncParams()

      // Start on-demand sync
      const onDemandSync = createMongoDoSync(onDemandConfig)
      onDemandSync(onDemandParams)

      // Create a second mock WebSocket for eager mode
      const eagerMockWs = new MockWebSocket('ws://test')
      ;(globalThis as any).WebSocket = vi.fn(() => eagerMockWs)

      const eagerSync = createMongoDoSync(eagerConfig)
      eagerSync(eagerParams)

      // Open both connections
      mockWs.simulateOpen()
      eagerMockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // On-demand should be ready immediately
      expect(onDemandParams.markReady).toHaveBeenCalled()

      // Eager should NOT be ready yet (data is loading)
      expect(eagerParams.markReady).not.toHaveBeenCalled()

      // Advance time to allow eager to complete
      await vi.advanceTimersByTimeAsync(1100)
      expect(eagerParams.markReady).toHaveBeenCalled()
    })
  })

  describe('loadSubset function', () => {
    it('should provide loadSubset function in return value', async () => {
      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)

      expect(result).toBeDefined()
      expect(result!.loadSubset).toBeDefined()
      expect(result!.loadSubset).toBeInstanceOf(Function)
    })

    it('should NOT provide loadSubset in eager mode', async () => {
      const config = createOnDemandConfig({ syncMode: 'eager' })
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)

      expect(result).toBeDefined()
      expect(result!.loadSubset).toBeUndefined()
    })

    it('should NOT provide loadSubset in progressive mode', async () => {
      const config = createOnDemandConfig({ syncMode: 'progressive' })
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)

      expect(result).toBeDefined()
      expect(result!.loadSubset).toBeUndefined()
    })
  })

  describe('loading data with loadSubset', () => {
    it('should load data when loadSubset is called', async () => {
      const documents: TestDocument[] = [
        { _id: 'prod-1', name: 'Product 1', category: 'electronics', price: 100, inStock: true },
        { _id: 'prod-2', name: 'Product 2', category: 'electronics', price: 200, inStock: false },
      ]

      mockRpcClient.rpc.mockResolvedValueOnce(documents)

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Reset mocks after initial sync
      mockParams.begin.mockClear()
      mockParams.write.mockClear()
      mockParams.commit.mockClear()

      // Load subset
      await result!.loadSubset!({})

      expect(mockParams.begin).toHaveBeenCalled()
      expect(mockParams.write).toHaveBeenCalledTimes(2)
      expect(mockParams.commit).toHaveBeenCalled()
    })

    it('should pass filter query to RPC', async () => {
      const documents: TestDocument[] = [
        { _id: 'prod-1', name: 'Product 1', category: 'electronics', price: 150, inStock: true },
      ]

      mockRpcClient.rpc.mockResolvedValueOnce(documents)

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await result!.loadSubset!({
        where: { category: 'electronics', price: { $gte: 100 } },
      })

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          filter: { category: 'electronics', price: { $gte: 100 } },
        })
      )
    })

    it('should pass limit to RPC', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await result!.loadSubset!({ limit: 10 })

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          limit: 10,
        })
      )
    })

    it('should pass offset (skip) to RPC', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await result!.loadSubset!({ offset: 20 })

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          skip: 20,
        })
      )
    })

    it('should pass sort order to RPC', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await result!.loadSubset!({
        orderBy: { price: 'desc', name: 'asc' },
      })

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          sort: { price: -1, name: 1 },
        })
      )
    })

    it('should write loaded documents as insert messages', async () => {
      const documents: TestDocument[] = [
        { _id: 'prod-1', name: 'Product 1', category: 'electronics', price: 100, inStock: true },
        { _id: 'prod-2', name: 'Product 2', category: 'electronics', price: 200, inStock: false },
      ]

      mockRpcClient.rpc.mockResolvedValueOnce(documents)

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      mockParams.write.mockClear()

      await result!.loadSubset!({})

      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          key: 'prod-1',
          value: documents[0],
        })
      )
      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          key: 'prod-2',
          value: documents[1],
        })
      )
    })
  })

  describe('multiple loadSubset calls', () => {
    it('should allow multiple loadSubset calls with different filters', async () => {
      const electronicsProducts: TestDocument[] = [
        { _id: 'elec-1', name: 'Laptop', category: 'electronics', price: 999, inStock: true },
      ]
      const clothingProducts: TestDocument[] = [
        { _id: 'cloth-1', name: 'Shirt', category: 'clothing', price: 29, inStock: true },
      ]

      mockRpcClient.rpc
        .mockResolvedValueOnce(electronicsProducts)
        .mockResolvedValueOnce(clothingProducts)

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      mockParams.write.mockClear()

      // First load
      await result!.loadSubset!({ where: { category: 'electronics' } })

      expect(mockParams.write).toHaveBeenCalledTimes(1)
      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'elec-1',
        })
      )

      mockParams.write.mockClear()

      // Second load with different filter
      await result!.loadSubset!({ where: { category: 'clothing' } })

      expect(mockParams.write).toHaveBeenCalledTimes(1)
      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'cloth-1',
        })
      )
    })

    it('should handle concurrent loadSubset calls', async () => {
      const batch1: TestDocument[] = [
        { _id: 'batch1-1', name: 'Batch 1 Item', category: 'a', price: 10, inStock: true },
      ]
      const batch2: TestDocument[] = [
        { _id: 'batch2-1', name: 'Batch 2 Item', category: 'b', price: 20, inStock: true },
      ]

      let resolveFirst: (value: TestDocument[]) => void
      let resolveSecond: (value: TestDocument[]) => void

      mockRpcClient.rpc
        .mockReturnValueOnce(
          new Promise<TestDocument[]>((resolve) => {
            resolveFirst = resolve
          })
        )
        .mockReturnValueOnce(
          new Promise<TestDocument[]>((resolve) => {
            resolveSecond = resolve
          })
        )

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      mockParams.write.mockClear()

      // Start both loads concurrently
      const load1 = result!.loadSubset!({ where: { category: 'a' } })
      const load2 = result!.loadSubset!({ where: { category: 'b' } })

      // Resolve in reverse order
      resolveSecond!(batch2)
      await vi.advanceTimersByTimeAsync(0)

      resolveFirst!(batch1)
      await vi.advanceTimersByTimeAsync(0)

      await Promise.all([load1, load2])

      // Both documents should be written
      expect(mockParams.write).toHaveBeenCalledTimes(2)
    })

    it('should support paginated loading', async () => {
      const page1: TestDocument[] = [
        { _id: 'page1-1', name: 'Page 1 Item 1', category: 'test', price: 10, inStock: true },
        { _id: 'page1-2', name: 'Page 1 Item 2', category: 'test', price: 20, inStock: true },
      ]
      const page2: TestDocument[] = [
        { _id: 'page2-1', name: 'Page 2 Item 1', category: 'test', price: 30, inStock: true },
        { _id: 'page2-2', name: 'Page 2 Item 2', category: 'test', price: 40, inStock: true },
      ]

      mockRpcClient.rpc.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2)

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      mockParams.write.mockClear()

      // Load page 1
      await result!.loadSubset!({ limit: 2, offset: 0 })
      expect(mockParams.write).toHaveBeenCalledTimes(2)

      mockParams.write.mockClear()

      // Load page 2
      await result!.loadSubset!({ limit: 2, offset: 2 })
      expect(mockParams.write).toHaveBeenCalledTimes(2)
    })
  })

  describe('MongoDB query operators support', () => {
    it('should support $gt operator', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await result!.loadSubset!({
        where: { price: { $gt: 100 } },
      })

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          filter: { price: { $gt: 100 } },
        })
      )
    })

    it('should support $in operator', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await result!.loadSubset!({
        where: { category: { $in: ['electronics', 'clothing'] } },
      })

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          filter: { category: { $in: ['electronics', 'clothing'] } },
        })
      )
    })

    it('should support $and operator', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await result!.loadSubset!({
        where: {
          $and: [{ category: 'electronics' }, { price: { $lte: 500 } }, { inStock: true }],
        },
      })

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          filter: {
            $and: [{ category: 'electronics' }, { price: { $lte: 500 } }, { inStock: true }],
          },
        })
      )
    })

    it('should support $or operator', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await result!.loadSubset!({
        where: {
          $or: [{ price: { $lt: 50 } }, { inStock: false }],
        },
      })

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          filter: {
            $or: [{ price: { $lt: 50 } }, { inStock: false }],
          },
        })
      )
    })

    it('should support $regex operator for text search', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await result!.loadSubset!({
        where: { name: { $regex: '^Pro', $options: 'i' } },
      })

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          filter: { name: { $regex: '^Pro', $options: 'i' } },
        })
      )
    })
  })

  describe('change stream integration', () => {
    it('should still receive real-time updates via change stream', async () => {
      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Reset mocks after initial sync
      mockParams.begin.mockClear()
      mockParams.write.mockClear()
      mockParams.commit.mockClear()

      // Simulate change stream event
      mockWs.simulateMessage({
        operationType: 'insert',
        fullDocument: {
          _id: 'new-prod',
          name: 'New Product',
          category: 'electronics',
          price: 299,
          inStock: true,
        },
        documentKey: { _id: 'new-prod' },
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.begin).toHaveBeenCalled()
      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          key: 'new-prod',
        })
      )
      expect(mockParams.commit).toHaveBeenCalled()
    })

    it('should handle update events from change stream', async () => {
      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      mockParams.write.mockClear()

      // Simulate update event
      mockWs.simulateMessage({
        operationType: 'update',
        fullDocument: {
          _id: 'existing-prod',
          name: 'Updated Product',
          category: 'electronics',
          price: 199,
          inStock: false,
        },
        documentKey: { _id: 'existing-prod' },
        updateDescription: {
          updatedFields: { price: 199, inStock: false },
          removedFields: [],
        },
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'update',
          key: 'existing-prod',
        })
      )
    })

    it('should handle delete events from change stream', async () => {
      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      mockParams.write.mockClear()

      // Simulate delete event
      mockWs.simulateMessage({
        operationType: 'delete',
        documentKey: { _id: 'deleted-prod' },
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'delete',
          key: 'deleted-prod',
        })
      )
    })
  })

  describe('error handling', () => {
    it('should reject loadSubset promise on RPC error', async () => {
      mockRpcClient.rpc.mockRejectedValueOnce(new Error('Network error'))

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await expect(result!.loadSubset!({})).rejects.toThrow()
    })

    it('should throw error if loadSubset called without RPC client', async () => {
      const config = {
        id: 'no-rpc-collection',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'products',
        schema: testDocumentSchema,
        getKey: (doc: TestDocument) => doc._id,
        syncMode: 'on-demand' as const,
        // No _rpcClient
      }

      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await expect(result!.loadSubset!({})).rejects.toThrow(/RPC client/i)
    })

    it('should handle empty result from loadSubset gracefully', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      mockParams.write.mockClear()

      // Should not throw, just complete with no writes
      await expect(result!.loadSubset!({})).resolves.toBeUndefined()
      expect(mockParams.write).not.toHaveBeenCalled()
    })
  })

  describe('cleanup behavior', () => {
    it('should stop loadSubset operations on cleanup', async () => {
      let resolveRpc: (value: TestDocument[]) => void

      mockRpcClient.rpc.mockReturnValueOnce(
        new Promise<TestDocument[]>((resolve) => {
          resolveRpc = resolve
        })
      )

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      mockParams.write.mockClear()

      // Start loading (doesn't complete yet)
      const loadPromise = result!.loadSubset!({})

      // Cleanup before load completes
      result!.cleanup()

      // Complete the RPC call
      resolveRpc!([{ _id: 'late-doc', name: 'Late', category: 'test', price: 10, inStock: true }])
      await vi.advanceTimersByTimeAsync(0)

      // Write should not be called after cleanup
      expect(mockParams.write).not.toHaveBeenCalled()
    })

    it('should reject pending loadSubset calls on cleanup', async () => {
      let rejectRpc: (error: Error) => void

      mockRpcClient.rpc.mockReturnValueOnce(
        new Promise<TestDocument[]>((_, reject) => {
          rejectRpc = reject
        })
      )

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Start loading
      const loadPromise = result!.loadSubset!({})

      // Cleanup
      result!.cleanup()

      // Simulate rejection from RPC
      rejectRpc!(new Error('Connection closed'))

      // The promise should either reject or complete without writing
      await expect(loadPromise).rejects.toThrow()
    })

    it('should not accept loadSubset calls after cleanup', async () => {
      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Cleanup first
      result!.cleanup()

      // Try to load - should either throw or do nothing
      const loadPromise = result!.loadSubset!({})

      // Should not call RPC after cleanup
      expect(mockRpcClient.rpc).not.toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          database: 'testdb',
        })
      )
    })
  })

  describe('cursor-based pagination', () => {
    it('should support cursor-based pagination', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await result!.loadSubset!({
        cursor: 'last-id-123',
        cursorField: '_id',
        limit: 20,
      })

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          filter: expect.objectContaining({
            _id: { $gt: 'last-id-123' },
          }),
          limit: 20,
        })
      )
    })

    it('should support descending cursor pagination', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config = createOnDemandConfig()
      const syncFn = createMongoDoSync(config)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await result!.loadSubset!({
        cursor: 1000,
        cursorField: 'price',
        orderBy: { price: 'desc' },
        limit: 10,
      })

      // For descending order, cursor should use $lt
      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          filter: expect.objectContaining({
            price: { $lt: 1000 },
          }),
          sort: { price: -1 },
          limit: 10,
        })
      )
    })
  })
})

describe('On-Demand Sync Mode Type Safety', () => {
  it('should return SyncReturn with loadSubset in on-demand mode', () => {
    const testDocumentSchema = z.object({
      _id: z.string(),
      name: z.string(),
    })

    type TestDoc = z.infer<typeof testDocumentSchema>

    const config: MongoDoCollectionConfig<TestDoc> = {
      id: 'typed-collection',
      endpoint: 'https://api.mongo.do',
      database: 'testdb',
      collectionName: 'docs',
      schema: testDocumentSchema,
      getKey: (doc) => doc._id,
      syncMode: 'on-demand',
    }

    const syncFn = createMongoDoSync(config)

    // Type check - the return should include loadSubset
    expect(syncFn).toBeInstanceOf(Function)
  })

  it('should accept LoadSubsetOptions with proper types', () => {
    // Type check that LoadSubsetOptions has the expected properties
    const options: LoadSubsetOptions = {
      where: { category: 'test' },
      orderBy: { price: 'desc' },
      limit: 10,
      offset: 0,
      cursor: 'abc123',
      cursorField: '_id',
    }

    expect(options.where).toBeDefined()
    expect(options.orderBy).toBeDefined()
    expect(options.limit).toBe(10)
    expect(options.offset).toBe(0)
    expect(options.cursor).toBe('abc123')
    expect(options.cursorField).toBe('_id')
  })
})
