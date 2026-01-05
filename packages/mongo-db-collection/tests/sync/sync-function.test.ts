/**
 * @file Sync Function Tests (RED Phase - TDD)
 *
 * These tests verify the main `createMongoDoSync` function that creates
 * a sync function matching the TanStack DB interface.
 *
 * The sync function is responsible for:
 * 1. Connecting to the mongo.do API and establishing synchronization
 * 2. Transforming MongoDB change events to TanStack DB format
 * 3. Managing the sync lifecycle (begin/write/commit/markReady)
 * 4. Providing cleanup and optional subset loading capabilities
 *
 * RED PHASE: These tests will fail until createMongoDoSync is implemented
 * in src/sync/sync-function.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMongoDoSync } from '../../src/sync/sync-function'
import type {
  MongoDoCollectionConfig,
  SyncParams,
  SyncReturn,
  ChangeMessage,
} from '../../src/types'
import type { Collection } from '@tanstack/db'
import { z } from 'zod'

// Test document schema and type
const testDocumentSchema = z.object({
  _id: z.string(),
  name: z.string(),
  value: z.number(),
  createdAt: z.date().optional(),
  tags: z.array(z.string()).optional(),
})

type TestDocument = z.infer<typeof testDocumentSchema>

// Mock Collection type for testing
interface MockCollection<T> extends Partial<Collection<T>> {
  id: string
  state: () => Map<string, T>
}

// Mock RPC client
const mockRpcClient = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn(() => false),
  rpc: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}

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

  simulateError(error: Event) {
    if (this.onerror) this.onerror(error)
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

describe('createMongoDoSync', () => {
  const testConfig: MongoDoCollectionConfig<TestDocument> = {
    id: 'test-collection',
    endpoint: 'https://api.mongo.do',
    database: 'testdb',
    collectionName: 'documents',
    schema: testDocumentSchema,
    getKey: (doc) => doc._id,
    authToken: 'test-token',
    syncMode: 'eager',
    enableChangeStream: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Replace global WebSocket with mock
    ;(globalThis as any).WebSocket = vi.fn((url: string) => {
      mockWs = new MockWebSocket(url)
      return mockWs
    })
    // Reset RPC client mocks
    mockRpcClient.isConnected.mockReturnValue(false)
    mockRpcClient.connect.mockResolvedValue(undefined)
    mockRpcClient.disconnect.mockResolvedValue(undefined)
    mockRpcClient.rpc.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    ;(globalThis as any).WebSocket = originalWebSocket
    vi.restoreAllMocks()
  })

  describe('function creation and interface', () => {
    it('should return a sync function', () => {
      const syncFn = createMongoDoSync(testConfig)

      expect(syncFn).toBeInstanceOf(Function)
    })

    it('should accept MongoDoCollectionConfig as parameter', () => {
      // Should not throw with valid config
      expect(() => createMongoDoSync(testConfig)).not.toThrow()
    })

    it('should throw if required config fields are missing', () => {
      const invalidConfig = {
        id: 'test',
        // Missing required fields
      } as MongoDoCollectionConfig<TestDocument>

      expect(() => createMongoDoSync(invalidConfig)).toThrow(/endpoint/i)
    })

    it('should accept minimal config with only required fields', () => {
      const minimalConfig: MongoDoCollectionConfig<TestDocument> = {
        id: 'minimal-collection',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'docs',
        schema: testDocumentSchema,
        getKey: (doc) => doc._id,
      }

      expect(() => createMongoDoSync(minimalConfig)).not.toThrow()
    })
  })

  describe('sync function return type', () => {
    it('should return object with cleanup function', () => {
      const syncFn = createMongoDoSync(testConfig)

      const mockParams = createMockSyncParams()
      const result = syncFn(mockParams)

      expect(result).toBeDefined()
      expect(result).toHaveProperty('cleanup')
      expect(result!.cleanup).toBeInstanceOf(Function)
    })

    it('should return object with optional loadSubset function', () => {
      const syncFn = createMongoDoSync(testConfig)

      const mockParams = createMockSyncParams()
      const result = syncFn(mockParams)

      expect(result).toBeDefined()
      // loadSubset is optional but should be present for on-demand mode
      if (testConfig.syncMode === 'on-demand') {
        expect(result!.loadSubset).toBeInstanceOf(Function)
      }
    })

    it('should match SyncReturn interface', () => {
      const syncFn = createMongoDoSync(testConfig)

      const mockParams = createMockSyncParams()
      const result: SyncReturn | void = syncFn(mockParams)

      // Type assertion to verify interface conformance
      if (result) {
        const syncReturn: SyncReturn = result
        expect(syncReturn.cleanup).toBeDefined()
      }
    })

    it('should include loadSubset when syncMode is on-demand', () => {
      const onDemandConfig: MongoDoCollectionConfig<TestDocument> = {
        ...testConfig,
        syncMode: 'on-demand',
      }

      const syncFn = createMongoDoSync(onDemandConfig)
      const mockParams = createMockSyncParams()
      const result = syncFn(mockParams)

      expect(result).toBeDefined()
      expect(result!.loadSubset).toBeInstanceOf(Function)
    })
  })

  describe('sync lifecycle - begin/write/commit/markReady', () => {
    it('should call begin when sync starts', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)

      // Simulate connection established
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.begin).toHaveBeenCalled()
    })

    it('should call write for each document during initial sync', async () => {
      const initialDocs: TestDocument[] = [
        { _id: 'doc-1', name: 'First', value: 1 },
        { _id: 'doc-2', name: 'Second', value: 2 },
        { _id: 'doc-3', name: 'Third', value: 3 },
      ]

      mockRpcClient.rpc.mockResolvedValueOnce(initialDocs)

      const configWithRpc = {
        ...testConfig,
        _rpcClient: mockRpcClient, // Inject mock for testing
      }

      const syncFn = createMongoDoSync(configWithRpc as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Should have called write for each document
      expect(mockParams.write).toHaveBeenCalledTimes(3)
      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          key: 'doc-1',
          value: initialDocs[0],
        })
      )
      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          key: 'doc-2',
          value: initialDocs[1],
        })
      )
      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          key: 'doc-3',
          value: initialDocs[2],
        })
      )
    })

    it('should call commit after initial sync writes', async () => {
      const initialDocs: TestDocument[] = [
        { _id: 'doc-1', name: 'First', value: 1 },
      ]

      mockRpcClient.rpc.mockResolvedValueOnce(initialDocs)

      const configWithRpc = {
        ...testConfig,
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(configWithRpc as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.commit).toHaveBeenCalled()
      // commit should be called after writes
      const writeOrder = mockParams.write.mock.invocationCallOrder[0]
      const commitOrder = mockParams.commit.mock.invocationCallOrder[0]
      expect(commitOrder).toBeGreaterThan(writeOrder)
    })

    it('should call markReady after initial sync completes', async () => {
      const initialDocs: TestDocument[] = [
        { _id: 'doc-1', name: 'First', value: 1 },
      ]

      mockRpcClient.rpc.mockResolvedValueOnce(initialDocs)

      const configWithRpc = {
        ...testConfig,
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(configWithRpc as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.markReady).toHaveBeenCalled()
      // markReady should be called after commit
      const commitOrder = mockParams.commit.mock.invocationCallOrder[0]
      const markReadyOrder = mockParams.markReady.mock.invocationCallOrder[0]
      expect(markReadyOrder).toBeGreaterThan(commitOrder)
    })

    it('should call begin/write/commit for change stream updates', async () => {
      const syncFn = createMongoDoSync(testConfig)
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
        fullDocument: { _id: 'new-doc', name: 'New', value: 100 },
        documentKey: { _id: 'new-doc' },
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.begin).toHaveBeenCalled()
      expect(mockParams.write).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          key: 'new-doc',
          value: { _id: 'new-doc', name: 'New', value: 100 },
        })
      )
      expect(mockParams.commit).toHaveBeenCalled()
    })

    it('should correctly order begin, write, commit sequence', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()
      const callOrder: string[] = []

      mockParams.begin.mockImplementation(() => callOrder.push('begin'))
      mockParams.write.mockImplementation(() => callOrder.push('write'))
      mockParams.commit.mockImplementation(() => callOrder.push('commit'))
      mockParams.markReady.mockImplementation(() => callOrder.push('markReady'))

      mockRpcClient.rpc.mockResolvedValueOnce([
        { _id: 'doc-1', name: 'Test', value: 1 },
      ])

      const configWithRpc = {
        ...testConfig,
        _rpcClient: mockRpcClient,
      }

      const syncFnWithRpc = createMongoDoSync(configWithRpc as MongoDoCollectionConfig<TestDocument>)
      syncFnWithRpc(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(callOrder).toEqual(['begin', 'write', 'commit', 'markReady'])
    })
  })

  describe('connection error handling', () => {
    it('should handle connection timeout', async () => {
      const configWithTimeout = {
        ...testConfig,
        connectionTimeout: 5000,
      }

      const syncFn = createMongoDoSync(configWithTimeout as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()
      const onError = vi.fn()

      syncFn(mockParams)

      // Attach error handler if available
      if ((syncFn as any).onError) {
        ;(syncFn as any).onError(onError)
      }

      // Don't simulate open - let it timeout
      await vi.advanceTimersByTimeAsync(5001)

      // markReady should NOT have been called due to timeout
      expect(mockParams.markReady).not.toHaveBeenCalled()
    })

    it('should handle WebSocket connection error', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)

      // Simulate connection error
      mockWs.simulateError(new Event('error'))

      await vi.advanceTimersByTimeAsync(0)

      // markReady should NOT have been called due to error
      expect(mockParams.markReady).not.toHaveBeenCalled()
    })

    it('should handle network disconnection during sync', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)

      // First connect successfully
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Then disconnect
      mockWs.close()

      await vi.advanceTimersByTimeAsync(0)

      // Verify disconnection was handled
      expect(mockWs.readyState).toBe(MockWebSocket.CLOSED)
    })

    it('should handle RPC errors gracefully', async () => {
      mockRpcClient.rpc.mockRejectedValueOnce(new Error('RPC request failed'))

      const configWithRpc = {
        ...testConfig,
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(configWithRpc as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      // Should not throw, but handle error gracefully
      expect(() => {
        syncFn(mockParams)
      }).not.toThrow()

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // markReady should not be called on error
      // Or should be called with error state depending on implementation
    })

    it('should handle authentication errors', async () => {
      const invalidAuthConfig: MongoDoCollectionConfig<TestDocument> = {
        ...testConfig,
        authToken: 'invalid-token',
      }

      mockRpcClient.connect.mockRejectedValueOnce(new Error('Authentication failed'))

      const configWithRpc = {
        ...invalidAuthConfig,
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(configWithRpc as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)

      // Simulate auth error on connection
      mockWs.simulateError(new Event('error'))

      await vi.advanceTimersByTimeAsync(0)

      expect(mockParams.markReady).not.toHaveBeenCalled()
    })

    it('should handle malformed change stream events', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Reset mocks after initial sync
      mockParams.begin.mockClear()
      mockParams.write.mockClear()

      // Simulate malformed event (missing required fields)
      mockWs.simulateMessage({
        operationType: 'insert',
        // Missing fullDocument and documentKey
      })

      await vi.advanceTimersByTimeAsync(0)

      // Should not crash, write should not be called for invalid event
      expect(mockParams.write).not.toHaveBeenCalled()
    })
  })

  describe('cleanup functionality', () => {
    it('should close connections on cleanup', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Call cleanup
      result!.cleanup()

      expect(mockWs.close).toHaveBeenCalled()
    })

    it('should stop receiving change events after cleanup', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Reset mocks
      mockParams.write.mockClear()

      // Call cleanup
      result!.cleanup()

      // Try to send event after cleanup
      mockWs.simulateMessage({
        operationType: 'insert',
        fullDocument: { _id: 'post-cleanup', name: 'Should not sync', value: 0 },
        documentKey: { _id: 'post-cleanup' },
      })

      await vi.advanceTimersByTimeAsync(0)

      // Write should not be called after cleanup
      expect(mockParams.write).not.toHaveBeenCalled()
    })

    it('should be safe to call cleanup multiple times', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Call cleanup multiple times - should not throw
      expect(() => {
        result!.cleanup()
        result!.cleanup()
        result!.cleanup()
      }).not.toThrow()
    })

    it('should cancel pending operations on cleanup', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)

      // Don't wait for connection - cleanup immediately
      result!.cleanup()

      await vi.advanceTimersByTimeAsync(0)

      // Should not have completed sync
      expect(mockParams.markReady).not.toHaveBeenCalled()
    })
  })

  describe('loadSubset functionality', () => {
    it('should provide loadSubset function for on-demand mode', () => {
      const onDemandConfig: MongoDoCollectionConfig<TestDocument> = {
        ...testConfig,
        syncMode: 'on-demand',
      }

      const syncFn = createMongoDoSync(onDemandConfig)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)

      expect(result!.loadSubset).toBeDefined()
      expect(result!.loadSubset).toBeInstanceOf(Function)
    })

    it('should load subset with filter options', async () => {
      const onDemandConfig: MongoDoCollectionConfig<TestDocument> = {
        ...testConfig,
        syncMode: 'on-demand',
      }

      const filteredDocs: TestDocument[] = [
        { _id: 'high-1', name: 'High Value', value: 100 },
        { _id: 'high-2', name: 'High Value 2', value: 150 },
      ]

      mockRpcClient.rpc.mockResolvedValueOnce(filteredDocs)

      const configWithRpc = {
        ...onDemandConfig,
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(configWithRpc as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Reset after initial sync
      mockParams.begin.mockClear()
      mockParams.write.mockClear()
      mockParams.commit.mockClear()

      // Load subset with filter
      await result!.loadSubset!({
        where: { value: { $gte: 100 } },
        limit: 10,
      })

      expect(mockParams.begin).toHaveBeenCalled()
      expect(mockParams.write).toHaveBeenCalledTimes(2)
      expect(mockParams.commit).toHaveBeenCalled()
    })

    it('should load subset with pagination options', async () => {
      const onDemandConfig: MongoDoCollectionConfig<TestDocument> = {
        ...testConfig,
        syncMode: 'on-demand',
      }

      const paginatedDocs: TestDocument[] = [
        { _id: 'page-2-1', name: 'Page 2 Doc 1', value: 21 },
        { _id: 'page-2-2', name: 'Page 2 Doc 2', value: 22 },
      ]

      mockRpcClient.rpc.mockResolvedValueOnce(paginatedDocs)

      const configWithRpc = {
        ...onDemandConfig,
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(configWithRpc as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Reset after initial sync
      mockParams.write.mockClear()

      // Load subset with pagination
      await result!.loadSubset!({
        limit: 20,
        offset: 20,
        orderBy: { value: 'desc' },
      })

      // Verify RPC was called with pagination params
      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'find',
        expect.objectContaining({
          limit: 20,
          skip: 20,
          sort: expect.any(Object),
        })
      )
    })

    it('should handle loadSubset errors', async () => {
      const onDemandConfig: MongoDoCollectionConfig<TestDocument> = {
        ...testConfig,
        syncMode: 'on-demand',
      }

      mockRpcClient.rpc.mockRejectedValueOnce(new Error('Query failed'))

      const configWithRpc = {
        ...onDemandConfig,
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(configWithRpc as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      const result = syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // loadSubset should reject with error
      await expect(
        result!.loadSubset!({ where: { invalid: true } as any })
      ).rejects.toThrow()
    })
  })

  describe('change message transformation', () => {
    it('should transform insert events correctly', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()
      let capturedMessage: ChangeMessage<TestDocument> | undefined

      mockParams.write.mockImplementation((msg: ChangeMessage<TestDocument>) => {
        capturedMessage = msg
      })

      syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Send insert event
      mockWs.simulateMessage({
        operationType: 'insert',
        fullDocument: { _id: 'insert-doc', name: 'Inserted', value: 42 },
        documentKey: { _id: 'insert-doc' },
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(capturedMessage).toBeDefined()
      expect(capturedMessage!.type).toBe('insert')
      expect(capturedMessage!.key).toBe('insert-doc')
      expect(capturedMessage!.value).toEqual({ _id: 'insert-doc', name: 'Inserted', value: 42 })
    })

    it('should transform update events correctly', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()
      let capturedMessage: ChangeMessage<TestDocument> | undefined

      mockParams.write.mockImplementation((msg: ChangeMessage<TestDocument>) => {
        capturedMessage = msg
      })

      syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Clear initial sync messages
      mockParams.write.mockClear()
      capturedMessage = undefined

      // Send update event
      mockWs.simulateMessage({
        operationType: 'update',
        fullDocument: { _id: 'update-doc', name: 'Updated', value: 100 },
        documentKey: { _id: 'update-doc' },
        updateDescription: {
          updatedFields: { name: 'Updated', value: 100 },
          removedFields: [],
        },
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(capturedMessage).toBeDefined()
      expect(capturedMessage!.type).toBe('update')
      expect(capturedMessage!.key).toBe('update-doc')
      expect(capturedMessage!.value).toEqual({ _id: 'update-doc', name: 'Updated', value: 100 })
    })

    it('should transform delete events correctly', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()
      let capturedMessage: ChangeMessage<TestDocument> | undefined

      mockParams.write.mockImplementation((msg: ChangeMessage<TestDocument>) => {
        capturedMessage = msg
      })

      syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Clear initial sync messages
      mockParams.write.mockClear()
      capturedMessage = undefined

      // Send delete event
      mockWs.simulateMessage({
        operationType: 'delete',
        documentKey: { _id: 'delete-doc' },
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(capturedMessage).toBeDefined()
      expect(capturedMessage!.type).toBe('delete')
      expect(capturedMessage!.key).toBe('delete-doc')
    })

    it('should transform replace events as updates', async () => {
      const syncFn = createMongoDoSync(testConfig)
      const mockParams = createMockSyncParams()
      let capturedMessage: ChangeMessage<TestDocument> | undefined

      mockParams.write.mockImplementation((msg: ChangeMessage<TestDocument>) => {
        capturedMessage = msg
      })

      syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Clear initial sync messages
      mockParams.write.mockClear()
      capturedMessage = undefined

      // Send replace event
      mockWs.simulateMessage({
        operationType: 'replace',
        fullDocument: { _id: 'replace-doc', name: 'Replaced', value: 999 },
        documentKey: { _id: 'replace-doc' },
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(capturedMessage).toBeDefined()
      expect(capturedMessage!.type).toBe('update')
      expect(capturedMessage!.key).toBe('replace-doc')
    })
  })

  describe('sync modes', () => {
    it('should perform immediate sync in eager mode', async () => {
      const eagerConfig: MongoDoCollectionConfig<TestDocument> = {
        ...testConfig,
        syncMode: 'eager',
      }

      const initialDocs: TestDocument[] = [
        { _id: 'eager-1', name: 'Eager Doc', value: 1 },
      ]

      mockRpcClient.rpc.mockResolvedValueOnce(initialDocs)

      const configWithRpc = {
        ...eagerConfig,
        _rpcClient: mockRpcClient,
      }

      const syncFn = createMongoDoSync(configWithRpc as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // In eager mode, initial load happens immediately
      expect(mockParams.write).toHaveBeenCalled()
      expect(mockParams.markReady).toHaveBeenCalled()
    })

    it('should defer initial load in on-demand mode', async () => {
      const onDemandConfig: MongoDoCollectionConfig<TestDocument> = {
        ...testConfig,
        syncMode: 'on-demand',
      }

      const syncFn = createMongoDoSync(onDemandConfig)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // In on-demand mode, no initial data load
      expect(mockParams.write).not.toHaveBeenCalled()
      // But should still mark ready (empty but ready)
      expect(mockParams.markReady).toHaveBeenCalled()
    })

    it('should batch sync in progressive mode', async () => {
      const progressiveConfig: MongoDoCollectionConfig<TestDocument> = {
        ...testConfig,
        syncMode: 'progressive',
      }

      const batch1: TestDocument[] = [
        { _id: 'prog-1', name: 'Batch 1', value: 1 },
        { _id: 'prog-2', name: 'Batch 1', value: 2 },
      ]

      const batch2: TestDocument[] = [
        { _id: 'prog-3', name: 'Batch 2', value: 3 },
        { _id: 'prog-4', name: 'Batch 2', value: 4 },
      ]

      mockRpcClient.rpc
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce([]) // End of data

      const configWithRpc = {
        ...progressiveConfig,
        _rpcClient: mockRpcClient,
        batchSize: 2,
      }

      const syncFn = createMongoDoSync(configWithRpc as MongoDoCollectionConfig<TestDocument>)
      const mockParams = createMockSyncParams()

      syncFn(mockParams)

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // First batch
      expect(mockParams.write).toHaveBeenCalledTimes(2)

      // Wait for next batch
      await vi.advanceTimersByTimeAsync(100)

      expect(mockParams.write).toHaveBeenCalledTimes(4)
    })
  })
})

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

describe('createMongoDoSync Type Safety', () => {
  it('should infer document type from config', () => {
    const userSchema = z.object({
      _id: z.string(),
      name: z.string(),
      email: z.string().email(),
    })

    type User = z.infer<typeof userSchema>

    const userConfig: MongoDoCollectionConfig<User> = {
      id: 'users',
      endpoint: 'https://api.mongo.do',
      database: 'testdb',
      collectionName: 'users',
      schema: userSchema,
      getKey: (user) => user._id,
    }

    // This should compile without errors
    const syncFn = createMongoDoSync(userConfig)

    expect(syncFn).toBeInstanceOf(Function)
  })

  it('should enforce type consistency between config and sync params', () => {
    interface Product {
      _id: string
      sku: string
      price: number
    }

    const productSchema = z.object({
      _id: z.string(),
      sku: z.string(),
      price: z.number(),
    })

    const productConfig: MongoDoCollectionConfig<Product> = {
      id: 'products',
      endpoint: 'https://api.mongo.do',
      database: 'testdb',
      collectionName: 'products',
      schema: productSchema,
      getKey: (product) => product._id,
    }

    const syncFn = createMongoDoSync(productConfig)

    // The sync function should work with Product-typed params
    expect(syncFn).toBeInstanceOf(Function)
  })
})
