/**
 * Sync Modes Tests - TDD (RED/GREEN)
 *
 * This test file verifies the different synchronization modes for MongoDB collections:
 * - eager: Full collection loaded on mount
 * - on-demand: Collection loads data only when explicitly requested
 * - progressive: Collection loads data in batches
 *
 * @module @tanstack/mongo-db-collection/tests/sync/sync-modes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMongoDoSync } from '../../src/sync/sync-function'
import type {
  MongoDoCollectionConfig,
  SyncParams,
  ChangeMessage,
} from '../../src/types'
import type { Collection } from '@tanstack/db'
import { z } from 'zod'

// =============================================================================
// Test Types and Schemas
// =============================================================================

const testDocumentSchema = z.object({
  _id: z.string(),
  name: z.string(),
  value: z.number(),
  category: z.string().optional(),
})

type TestDocument = z.infer<typeof testDocumentSchema>

// =============================================================================
// Mock RPC Client
// =============================================================================

interface MockRpcClient {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  isConnected: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
}

function createMockRpcClient(): MockRpcClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(() => true),
    rpc: vi.fn().mockResolvedValue([]),
    on: vi.fn(),
    off: vi.fn(),
  }
}

// =============================================================================
// Mock WebSocket
// =============================================================================

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

// Store original WebSocket
const originalWebSocket = globalThis.WebSocket

// Track mock WebSocket instance
let mockWs: MockWebSocket

// =============================================================================
// Test Helpers
// =============================================================================

interface MockCollection<T> {
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

function createTestDocuments(count: number): TestDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `doc-${i + 1}`,
    name: `Document ${i + 1}`,
    value: (i + 1) * 10,
    category: i % 2 === 0 ? 'even' : 'odd',
  }))
}

// =============================================================================
// Eager Sync Mode Tests
// =============================================================================

describe('Eager Sync Mode', () => {
  let mockRpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockRpcClient = createMockRpcClient()
    // Replace global WebSocket with mock
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

  describe('Full Collection Load on Mount', () => {
    it('should load full collection immediately when sync starts in eager mode', async () => {
      const testDocs = createTestDocuments(5)
      mockRpcClient.rpc.mockResolvedValueOnce(testDocs)

      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'eager-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
        syncMode: 'eager',
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)

      // Simulate WebSocket connection
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Verify RPC was called to fetch all documents
      expect(mockRpcClient.rpc).toHaveBeenCalledWith('find', {
        database: 'testdb',
        collection: 'documents',
      })

      // Verify all documents were written
      expect(mockParams.write).toHaveBeenCalledTimes(5)
    })

    it('should call begin before writing any documents', async () => {
      const testDocs = createTestDocuments(3)
      mockRpcClient.rpc.mockResolvedValueOnce(testDocs)

      const callOrder: string[] = []

      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'eager-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
        syncMode: 'eager',
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      mockParams.begin.mockImplementation(() => callOrder.push('begin'))
      mockParams.write.mockImplementation(() => callOrder.push('write'))

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(callOrder[0]).toBe('begin')
      expect(callOrder.filter((c) => c === 'write').length).toBe(3)
    })

    it('should call commit after all documents are written', async () => {
      const testDocs = createTestDocuments(3)
      mockRpcClient.rpc.mockResolvedValueOnce(testDocs)

      const callOrder: string[] = []

      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'eager-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
        syncMode: 'eager',
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      mockParams.write.mockImplementation(() => callOrder.push('write'))
      mockParams.commit.mockImplementation(() => callOrder.push('commit'))

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const lastWriteIndex = callOrder.lastIndexOf('write')
      const commitIndex = callOrder.indexOf('commit')
      expect(commitIndex).toBeGreaterThan(lastWriteIndex)
    })

    it('should call markReady after commit', async () => {
      const testDocs = createTestDocuments(2)
      mockRpcClient.rpc.mockResolvedValueOnce(testDocs)

      const callOrder: string[] = []

      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'eager-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
        syncMode: 'eager',
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      mockParams.commit.mockImplementation(() => callOrder.push('commit'))
      mockParams.markReady.mockImplementation(() => callOrder.push('markReady'))

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const commitIndex = callOrder.indexOf('commit')
      const markReadyIndex = callOrder.indexOf('markReady')
      expect(markReadyIndex).toBeGreaterThan(commitIndex)
    })

    it('should write documents as insert messages with correct keys', async () => {
      const testDocs = createTestDocuments(3)
      mockRpcClient.rpc.mockResolvedValueOnce(testDocs)

      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'eager-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
        syncMode: 'eager',
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()
      const writtenMessages: ChangeMessage<TestDocument>[] = []

      mockParams.write.mockImplementation((msg: ChangeMessage<TestDocument>) => {
        writtenMessages.push(msg)
      })

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(writtenMessages).toHaveLength(3)
      writtenMessages.forEach((msg, i) => {
        expect(msg.type).toBe('insert')
        expect(msg.key).toBe(testDocs[i]._id)
        expect(msg.value).toEqual(testDocs[i])
      })
    })

    it('should handle empty collection gracefully', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce([])

      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'eager-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
        syncMode: 'eager',
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.begin).toHaveBeenCalled()
      expect(mockParams.write).not.toHaveBeenCalled()
      expect(mockParams.commit).toHaveBeenCalled()
      expect(mockParams.markReady).toHaveBeenCalled()
    })

    it('should handle large collections (100+ documents)', async () => {
      const largeDocs = createTestDocuments(150)
      mockRpcClient.rpc.mockResolvedValueOnce(largeDocs)

      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'eager-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
        syncMode: 'eager',
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.write).toHaveBeenCalledTimes(150)
      expect(mockParams.markReady).toHaveBeenCalled()
    })

    it('should use custom getKey function for document keys', async () => {
      const testDocs: TestDocument[] = [
        { _id: 'id-1', name: 'Test 1', value: 100, category: 'A' },
        { _id: 'id-2', name: 'Test 2', value: 200, category: 'B' },
      ]
      mockRpcClient.rpc.mockResolvedValueOnce(testDocs)

      const customGetKey = (doc: TestDocument) => `custom-${doc.value}-${doc._id}`

      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'eager-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: customGetKey,
        syncMode: 'eager',
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()
      const writtenKeys: string[] = []

      mockParams.write.mockImplementation((msg: ChangeMessage<TestDocument>) => {
        writtenKeys.push(msg.key)
      })

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(writtenKeys).toEqual(['custom-100-id-1', 'custom-200-id-2'])
    })
  })

  describe('Eager Mode Error Handling', () => {
    it('should not call markReady if initial fetch fails', async () => {
      mockRpcClient.rpc.mockRejectedValueOnce(new Error('Fetch failed'))

      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'eager-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
        syncMode: 'eager',
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.markReady).not.toHaveBeenCalled()
    })

    it('should handle network errors during initial load', async () => {
      mockRpcClient.rpc.mockRejectedValueOnce(new Error('Network error'))

      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'eager-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
        syncMode: 'eager',
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      // Should not throw
      expect(() => {
        syncFn(mockParams)
      }).not.toThrow()

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // markReady should not be called on error
      expect(mockParams.markReady).not.toHaveBeenCalled()
    })
  })

  describe('Eager Mode with Change Stream', () => {
    it('should process change events after initial load completes', async () => {
      const initialDocs = createTestDocuments(2)
      mockRpcClient.rpc.mockResolvedValueOnce(initialDocs)

      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'eager-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
        syncMode: 'eager',
        enableChangeStream: true,
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Reset mocks after initial load
      mockParams.begin.mockClear()
      mockParams.write.mockClear()
      mockParams.commit.mockClear()

      // Simulate change stream event
      mockWs.simulateMessage({
        operationType: 'insert',
        fullDocument: { _id: 'new-doc', name: 'New', value: 999 },
        documentKey: { _id: 'new-doc' },
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.begin).toHaveBeenCalled()
      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          key: 'new-doc',
        })
      )
      expect(mockParams.commit).toHaveBeenCalled()
    })

    it('should not process change events before initial load completes', async () => {
      // Delay the RPC response
      let resolveRpc: (value: TestDocument[]) => void
      const rpcPromise = new Promise<TestDocument[]>((resolve) => {
        resolveRpc = resolve
      })
      mockRpcClient.rpc.mockReturnValueOnce(rpcPromise)

      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'eager-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
        syncMode: 'eager',
        enableChangeStream: true,
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()

      // Try to send change event before initial load completes
      mockWs.simulateMessage({
        operationType: 'insert',
        fullDocument: { _id: 'premature-doc', name: 'Premature', value: 0 },
        documentKey: { _id: 'premature-doc' },
      })

      await vi.advanceTimersByTimeAsync(0)

      // Since initial load hasn't completed, change events should be ignored
      // (only initial load writes should be processed)
      const writeCallsBeforeResolve = mockParams.write.mock.calls.length

      // Now resolve the initial load
      resolveRpc!([{ _id: 'doc-1', name: 'Initial', value: 10 }])
      await vi.advanceTimersByTimeAsync(0)

      // After initial load, the premature change should have been ignored
      // Only the initial document should have been written
      expect(mockParams.write).toHaveBeenCalledTimes(1)
      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'doc-1' })
      )
    })
  })

  describe('Eager Mode Default Behavior', () => {
    it('should default to eager mode when syncMode is not specified', async () => {
      const testDocs = createTestDocuments(3)
      mockRpcClient.rpc.mockResolvedValueOnce(testDocs)

      // Config without syncMode specified
      const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
        id: 'default-mode-test',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'documents',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
        // syncMode not specified - should default to 'eager'
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Should behave like eager mode - load all documents
      expect(mockRpcClient.rpc).toHaveBeenCalledWith('find', expect.any(Object))
      expect(mockParams.write).toHaveBeenCalledTimes(3)
      expect(mockParams.markReady).toHaveBeenCalled()
    })
  })
})

// =============================================================================
// On-Demand Sync Mode Tests (for comparison)
// =============================================================================

describe('On-Demand Sync Mode', () => {
  let mockRpcClient: MockRpcClient

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

  it('should not load any documents on mount in on-demand mode', async () => {
    const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
      id: 'on-demand-test',
      endpoint: 'https://api.mongo.do',
      database: 'testdb',
      collectionName: 'documents',
      schema: testDocumentSchema,
      getKey: (doc) => doc._id,
      syncMode: 'on-demand',
      _rpcClient: mockRpcClient,
    }

    const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
    const mockParams = createMockSyncParams()

    syncFn(mockParams)
    mockWs.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    // In on-demand mode, no initial fetch should occur
    expect(mockParams.write).not.toHaveBeenCalled()
    // But should still mark ready
    expect(mockParams.markReady).toHaveBeenCalled()
  })

  it('should provide loadSubset function in on-demand mode', async () => {
    const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
      id: 'on-demand-test',
      endpoint: 'https://api.mongo.do',
      database: 'testdb',
      collectionName: 'documents',
      schema: testDocumentSchema,
      getKey: (doc) => doc._id,
      syncMode: 'on-demand',
      _rpcClient: mockRpcClient,
    }

    const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
    const mockParams = createMockSyncParams()

    const result = syncFn(mockParams)

    expect(result).toBeDefined()
    expect(result!.loadSubset).toBeDefined()
    expect(result!.loadSubset).toBeInstanceOf(Function)
  })
})

// =============================================================================
// Progressive Sync Mode Tests (for comparison)
// =============================================================================

describe('Progressive Sync Mode', () => {
  let mockRpcClient: MockRpcClient

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

  it('should load documents in batches in progressive mode', async () => {
    const batch1 = createTestDocuments(2)
    const batch2 = [
      { _id: 'doc-3', name: 'Document 3', value: 30 },
      { _id: 'doc-4', name: 'Document 4', value: 40 },
    ]

    mockRpcClient.rpc
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
      .mockResolvedValueOnce([]) // End of data

    const config: MongoDoCollectionConfig<TestDocument> & {
      _rpcClient: MockRpcClient
      batchSize: number
    } = {
      id: 'progressive-test',
      endpoint: 'https://api.mongo.do',
      database: 'testdb',
      collectionName: 'documents',
      schema: testDocumentSchema,
      getKey: (doc) => doc._id,
      syncMode: 'progressive',
      batchSize: 2,
      _rpcClient: mockRpcClient,
    }

    const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
    const mockParams = createMockSyncParams()

    syncFn(mockParams)
    mockWs.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    // First batch loaded
    expect(mockParams.write).toHaveBeenCalledTimes(2)

    // Advance time for next batch
    await vi.advanceTimersByTimeAsync(100)

    // Second batch loaded
    expect(mockParams.write).toHaveBeenCalledTimes(4)
  })
})

// =============================================================================
// Sync Mode Comparison Tests
// =============================================================================

describe('Sync Mode Comparison', () => {
  let mockRpcClient: MockRpcClient

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

  it('eager mode should load all documents before markReady', async () => {
    const testDocs = createTestDocuments(5)
    mockRpcClient.rpc.mockResolvedValueOnce(testDocs)

    const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
      id: 'eager-comparison',
      endpoint: 'https://api.mongo.do',
      database: 'testdb',
      collectionName: 'documents',
      schema: testDocumentSchema,
      getKey: (doc) => doc._id,
      syncMode: 'eager',
      _rpcClient: mockRpcClient,
    }

    const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
    const mockParams = createMockSyncParams()
    let documentsLoadedAtMarkReady = 0

    mockParams.markReady.mockImplementation(() => {
      documentsLoadedAtMarkReady = mockParams.write.mock.calls.length
    })

    syncFn(mockParams)
    mockWs.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    expect(documentsLoadedAtMarkReady).toBe(5)
  })

  it('on-demand mode should have zero documents at markReady', async () => {
    const config: MongoDoCollectionConfig<TestDocument> & { _rpcClient: MockRpcClient } = {
      id: 'on-demand-comparison',
      endpoint: 'https://api.mongo.do',
      database: 'testdb',
      collectionName: 'documents',
      schema: testDocumentSchema,
      getKey: (doc) => doc._id,
      syncMode: 'on-demand',
      _rpcClient: mockRpcClient,
    }

    const syncFn = createMongoDoSync(config as MongoDoCollectionConfig<TestDocument>)
    const mockParams = createMockSyncParams()
    let documentsLoadedAtMarkReady = 0

    mockParams.markReady.mockImplementation(() => {
      documentsLoadedAtMarkReady = mockParams.write.mock.calls.length
    })

    syncFn(mockParams)
    mockWs.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    expect(documentsLoadedAtMarkReady).toBe(0)
  })
})
