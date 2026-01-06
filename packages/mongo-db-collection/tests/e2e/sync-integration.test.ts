/**
 * @file End-to-End Sync Integration Tests (RED Phase - TDD)
 *
 * These tests verify the complete end-to-end synchronization functionality
 * between clients and the MongoDB server via the mongo.do API.
 *
 * The sync integration tests verify:
 * 1. Full sync cycles - initial sync, bidirectional updates
 * 2. Document operations - CRUD operations syncing correctly
 * 3. Conflict scenarios - concurrent edits, resolution strategies
 * 4. Offline/Online transitions - queue mutations, replay on reconnect
 * 5. Real-time updates - change streams, multi-client sync
 * 6. Error recovery - network errors, retries, data consistency
 *
 * RED PHASE: These tests define the expected behavior for sync integration.
 * Implementation will follow in the GREEN phase.
 *
 * Bead ID: tanstackdb-po0.161
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

import type {
  MongoDoCollectionConfig,
  SyncParams,
  SyncReturn,
  ChangeMessage,
  ConflictContext,
  ConflictResolution,
  LoadSubsetOptions,
} from '../../src/types'

import {
  createSyncClient,
  type SyncClient,
  type SyncClientConfig,
  type SyncState,
  type SyncStats,
  type QueuedMutation,
  type SubscriptionHandle,
  type NetworkStatusProvider,
  type StorageProvider,
} from '../../src/sync/client'

// ============================================================================
// Test Fixtures & Types
// ============================================================================

/**
 * Test document schema for sync tests
 */
const userSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().min(0),
  status: z.enum(['active', 'inactive', 'pending']),
  version: z.number().int().default(1),
  tags: z.array(z.string()).optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
})

type User = z.infer<typeof userSchema>

/**
 * Product document for multi-collection tests
 */
const productSchema = z.object({
  _id: z.string(),
  sku: z.string(),
  name: z.string(),
  price: z.number().positive(),
  inventory: z.number().int().min(0),
  category: z.string(),
})

type Product = z.infer<typeof productSchema>

/**
 * Order document for relationship testing
 */
const orderSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  productIds: z.array(z.string()),
  total: z.number().positive(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered']),
  createdAt: z.date(),
})

type Order = z.infer<typeof orderSchema>

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Creates a mock WebSocket for testing
 */
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState: number = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  private messageQueue: unknown[] = []

  constructor(url: string) {
    this.url = url
  }

  send = vi.fn((data: string) => {
    this.messageQueue.push(JSON.parse(data))
  })

  close = vi.fn((code?: number, reason?: string) => {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code: code ?? 1000, reason }))
    }
  })

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    if (this.onopen) this.onopen()
  }

  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }))
    }
  }

  simulateError(error: Error): void {
    if (this.onerror) {
      this.onerror(new ErrorEvent('error', { error, message: error.message }))
    }
  }

  simulateClose(code: number = 1000, reason: string = ''): void {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code, reason, wasClean: code === 1000 }))
    }
  }

  getLastMessage(): unknown {
    return this.messageQueue[this.messageQueue.length - 1]
  }

  getAllMessages(): unknown[] {
    return [...this.messageQueue]
  }

  clearMessages(): void {
    this.messageQueue = []
  }
}

// Polyfill CloseEvent for Node.js
class CloseEvent extends Event {
  code: number
  reason: string
  wasClean: boolean

  constructor(type: string, init?: { code?: number; reason?: string; wasClean?: boolean }) {
    super(type)
    this.code = init?.code ?? 1000
    this.reason = init?.reason ?? ''
    this.wasClean = init?.wasClean ?? true
  }
}

// Polyfill ErrorEvent for Node.js
class ErrorEvent extends Event {
  error: Error | undefined
  message: string

  constructor(type: string, init?: { error?: Error; message?: string }) {
    super(type)
    this.error = init?.error
    this.message = init?.message ?? ''
  }
}

;(globalThis as any).CloseEvent = CloseEvent
;(globalThis as any).ErrorEvent = ErrorEvent

/**
 * Mock network status provider
 */
interface MockNetworkStatus {
  isOnline: boolean
  setOnline: (online: boolean) => void
  listeners: Set<(online: boolean) => void>
}

function createMockNetworkStatus(initialOnline = true): MockNetworkStatus {
  const listeners: Set<(online: boolean) => void> = new Set()
  let isOnline = initialOnline

  return {
    get isOnline() {
      return isOnline
    },
    setOnline(online: boolean) {
      isOnline = online
      listeners.forEach((cb) => cb(online))
    },
    listeners,
  }
}

/**
 * Mock storage for persistence testing
 */
class MockStorage {
  private data: Map<string, string> = new Map()

  async getItem(key: string): Promise<string | null> {
    return this.data.get(key) ?? null
  }

  async setItem(key: string, value: string): Promise<void> {
    this.data.set(key, value)
  }

  async removeItem(key: string): Promise<void> {
    this.data.delete(key)
  }

  clear(): void {
    this.data.clear()
  }
}

/**
 * Creates a mock sync client configuration
 */
function createMockConfig(overrides: Partial<SyncClientConfig> = {}): SyncClientConfig {
  return {
    endpoint: 'wss://api.mongo.do/sync',
    database: 'testdb',
    authToken: 'test-token',
    ...overrides,
  }
}

/**
 * Creates test users
 */
function createTestUser(id: string, overrides: Partial<User> = {}): User {
  return {
    _id: id,
    name: `User ${id}`,
    email: `user${id}@example.com`,
    age: 25,
    status: 'active',
    version: 1,
    ...overrides,
  }
}

/**
 * Creates test products
 */
function createTestProduct(id: string, overrides: Partial<Product> = {}): Product {
  return {
    _id: id,
    sku: `SKU-${id}`,
    name: `Product ${id}`,
    price: 99.99,
    inventory: 100,
    category: 'electronics',
    ...overrides,
  }
}

// Store original WebSocket for restoration
const originalWebSocket = globalThis.WebSocket

// ============================================================================
// Test Suites
// ============================================================================

describe('End-to-End Sync Integration Tests', () => {
  let mockWs: MockWebSocket
  let mockNetworkStatus: MockNetworkStatus
  let mockStorage: MockStorage

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockStorage = new MockStorage()
    mockNetworkStatus = createMockNetworkStatus(true)

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
    mockStorage.clear()
  })

  // ==========================================================================
  // 1. Full Sync Cycle Tests
  // ==========================================================================

  describe('Full Sync Cycle', () => {
    it('should create a sync client with valid configuration', () => {
      const config = createMockConfig()
      const client = createSyncClient(config)

      expect(client).toBeDefined()
      expect(client.getState()).toBe('disconnected')
    })

    it('should connect to the sync server', async () => {
      const client = createSyncClient(createMockConfig())

      const connectPromise = client.connect()
      mockWs.simulateOpen()

      await expect(connectPromise).resolves.toBeUndefined()
      expect(client.getState()).toBe('connected')
    })

    it('should perform initial sync from server', async () => {
      const client = createSyncClient(createMockConfig())
      const onSync = vi.fn()

      client.on('sync', onSync)
      client.connect()
      mockWs.simulateOpen()

      // Simulate server sending initial data
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [
          createTestUser('1'),
          createTestUser('2'),
          createTestUser('3'),
        ],
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(onSync).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'initial-sync',
          collection: 'users',
          documentCount: 3,
        })
      )
    })

    it('should sync local changes to server', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Create a local document
      const newUser = createTestUser('local-1')
      await client.insert('users', newUser)

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"mutation"')
      )
      expect(mockWs.getLastMessage()).toEqual(
        expect.objectContaining({
          type: 'mutation',
          operation: 'insert',
          collection: 'users',
          document: newUser,
        })
      )
    })

    it('should sync server changes to client', async () => {
      const client = createSyncClient(createMockConfig())
      const onChange = vi.fn()

      client.on('change', onChange)
      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Simulate server pushing a change
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'insert',
        collection: 'users',
        documentKey: { _id: 'server-1' },
        fullDocument: createTestUser('server-1'),
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          collection: 'users',
          document: expect.objectContaining({ _id: 'server-1' }),
        })
      )
    })

    it('should handle bidirectional sync correctly', async () => {
      const client = createSyncClient(createMockConfig())
      const changes: unknown[] = []

      client.on('change', (event) => changes.push(event))
      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Local insert
      await client.insert('users', createTestUser('local-1'))

      // Server insert
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'insert',
        collection: 'users',
        documentKey: { _id: 'server-1' },
        fullDocument: createTestUser('server-1'),
      })

      // Local update
      await client.update('users', 'local-1', { name: 'Updated Name' })

      // Server update
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'update',
        collection: 'users',
        documentKey: { _id: 'server-1' },
        fullDocument: createTestUser('server-1', { name: 'Server Updated' }),
        updateDescription: { updatedFields: { name: 'Server Updated' }, removedFields: [] },
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(changes.length).toBeGreaterThanOrEqual(2)
    })

    it('should mark sync as ready after initial load completes', async () => {
      const client = createSyncClient(createMockConfig())
      const onReady = vi.fn()

      client.on('ready', onReady)
      client.connect()
      mockWs.simulateOpen()

      // Simulate initial sync completion
      mockWs.simulateMessage({
        type: 'initial-sync-complete',
        collection: 'users',
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(onReady).toHaveBeenCalled()
      expect(client.isReady('users')).toBe(true)
    })

    it('should support multiple collections syncing simultaneously', async () => {
      const client = createSyncClient(createMockConfig())
      const readyCollections: string[] = []

      client.on('ready', (event) => readyCollections.push(event.collection))
      client.connect()
      mockWs.simulateOpen()

      // Subscribe to multiple collections
      await client.subscribe('users')
      await client.subscribe('products')

      // Simulate initial sync for both
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [createTestUser('1')],
      })
      mockWs.simulateMessage({
        type: 'initial-sync-complete',
        collection: 'users',
      })

      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'products',
        documents: [createTestProduct('1')],
      })
      mockWs.simulateMessage({
        type: 'initial-sync-complete',
        collection: 'products',
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(readyCollections).toContain('users')
      expect(readyCollections).toContain('products')
    })
  })

  // ==========================================================================
  // 2. Document Operations Tests
  // ==========================================================================

  describe('Document Operations', () => {
    it('should create document locally and sync to server', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const user = createTestUser('new-user')
      const result = await client.insert('users', user)

      expect(result).toEqual(expect.objectContaining({ _id: 'new-user' }))
      expect(mockWs.send).toHaveBeenCalled()
    })

    it('should update document locally and sync to server', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()

      // Setup: insert initial document
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [createTestUser('user-1')],
      })
      await vi.advanceTimersByTimeAsync(0)

      // Update the document
      const result = await client.update('users', 'user-1', { name: 'Updated Name', age: 30 })

      expect(result).toEqual(expect.objectContaining({ name: 'Updated Name', age: 30 }))
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"operation":"update"')
      )
    })

    it('should delete document locally and sync to server', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()

      // Setup: insert initial document
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [createTestUser('user-1')],
      })
      await vi.advanceTimersByTimeAsync(0)

      // Delete the document
      const result = await client.delete('users', 'user-1')

      expect(result).toBe(true)
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"operation":"delete"')
      )
    })

    it('should apply server-side changes locally', async () => {
      const client = createSyncClient(createMockConfig())
      const onChange = vi.fn()

      client.on('change', onChange)
      client.connect()
      mockWs.simulateOpen()

      // Server sends an insert
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'insert',
        collection: 'users',
        documentKey: { _id: 'server-user' },
        fullDocument: createTestUser('server-user', { name: 'Server Created' }),
      })

      await vi.advanceTimersByTimeAsync(0)

      const user = client.get('users', 'server-user')
      expect(user).toEqual(expect.objectContaining({ name: 'Server Created' }))
    })

    it('should handle bulk insert operations', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const users = [
        createTestUser('bulk-1'),
        createTestUser('bulk-2'),
        createTestUser('bulk-3'),
      ]

      const results = await client.insertMany('users', users)

      expect(results).toHaveLength(3)
      expect(mockWs.send).toHaveBeenCalled()
    })

    it('should handle bulk update operations', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()

      // Setup initial documents
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [
          createTestUser('user-1'),
          createTestUser('user-2'),
          createTestUser('user-3'),
        ],
      })
      await vi.advanceTimersByTimeAsync(0)

      const results = await client.updateMany('users',
        { status: 'active' },
        { status: 'inactive' }
      )

      expect(results.modifiedCount).toBe(3)
    })

    it('should handle bulk delete operations', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()

      // Setup initial documents
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [
          createTestUser('user-1', { status: 'inactive' }),
          createTestUser('user-2', { status: 'inactive' }),
          createTestUser('user-3', { status: 'active' }),
        ],
      })
      await vi.advanceTimersByTimeAsync(0)

      const results = await client.deleteMany('users', { status: 'inactive' })

      expect(results.deletedCount).toBe(2)
    })

    it('should handle upsert operations', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Upsert non-existing document (should insert)
      const result1 = await client.upsert('users', 'upsert-1', createTestUser('upsert-1'))
      expect(result1.upserted).toBe(true)

      // Upsert existing document (should update)
      const result2 = await client.upsert('users', 'upsert-1', { name: 'Updated' })
      expect(result2.upserted).toBe(false)
    })

    it('should track optimistic updates before server confirmation', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const user = createTestUser('optimistic-1')

      // Insert returns immediately with optimistic state
      const insertPromise = client.insert('users', user)

      // Document should be available immediately (optimistic)
      const optimisticUser = client.get('users', 'optimistic-1')
      expect(optimisticUser).toEqual(expect.objectContaining({ _id: 'optimistic-1' }))
      expect(client.isPending('users', 'optimistic-1')).toBe(true)

      // Server confirms - use the mutation ID from the last sent message
      const lastMessage = mockWs.getLastMessage() as { mutationId: string }
      mockWs.simulateMessage({
        type: 'ack',
        mutationId: lastMessage.mutationId,
        success: true,
      })

      await insertPromise
      await vi.advanceTimersByTimeAsync(0)
      expect(client.isPending('users', 'optimistic-1')).toBe(false)
    })
  })

  // ==========================================================================
  // 3. Conflict Scenarios Tests
  // ==========================================================================

  describe('Conflict Scenarios', () => {
    it('should detect concurrent edits', async () => {
      const client = createSyncClient(createMockConfig({
        conflictStrategy: 'detect',
      }))
      const onConflict = vi.fn()

      client.on('conflict', onConflict)
      client.connect()
      mockWs.simulateOpen()

      // Initial sync
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [createTestUser('user-1', { version: 1 })],
      })
      await vi.advanceTimersByTimeAsync(0)

      // Local edit
      await client.update('users', 'user-1', { name: 'Local Edit', version: 2 })

      // Server edit arrives for same document
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'update',
        collection: 'users',
        documentKey: { _id: 'user-1' },
        fullDocument: createTestUser('user-1', { name: 'Server Edit', version: 2 }),
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(onConflict).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'users',
          documentId: 'user-1',
          localValue: expect.objectContaining({ name: 'Local Edit' }),
          serverValue: expect.objectContaining({ name: 'Server Edit' }),
        })
      )
    })

    it('should apply last-write-wins strategy', async () => {
      const client = createSyncClient(createMockConfig({
        conflictStrategy: 'last-write-wins',
      }))

      client.connect()
      mockWs.simulateOpen()

      // Initial sync
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [createTestUser('user-1')],
      })
      await vi.advanceTimersByTimeAsync(0)

      // Local edit at T1
      await client.update('users', 'user-1', { name: 'Local at T1' })

      // Server edit at T2 (later timestamp)
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'update',
        collection: 'users',
        documentKey: { _id: 'user-1' },
        fullDocument: createTestUser('user-1', { name: 'Server at T2' }),
        timestamp: Date.now() + 1000,
      })

      await vi.advanceTimersByTimeAsync(0)

      const user = client.get('users', 'user-1')
      expect(user?.name).toBe('Server at T2')
    })

    it('should apply server-wins strategy', async () => {
      const client = createSyncClient(createMockConfig({
        conflictStrategy: 'server-wins',
      }))

      client.connect()
      mockWs.simulateOpen()

      // Initial sync
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [createTestUser('user-1')],
      })
      await vi.advanceTimersByTimeAsync(0)

      // Local edit
      await client.update('users', 'user-1', { name: 'Local Edit' })

      // Server edit arrives
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'update',
        collection: 'users',
        documentKey: { _id: 'user-1' },
        fullDocument: createTestUser('user-1', { name: 'Server Edit' }),
      })

      await vi.advanceTimersByTimeAsync(0)

      const user = client.get('users', 'user-1')
      expect(user?.name).toBe('Server Edit')
    })

    it('should apply client-wins strategy', async () => {
      const client = createSyncClient(createMockConfig({
        conflictStrategy: 'client-wins',
      }))

      client.connect()
      mockWs.simulateOpen()

      // Initial sync
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [createTestUser('user-1')],
      })
      await vi.advanceTimersByTimeAsync(0)

      // Local edit
      await client.update('users', 'user-1', { name: 'Local Edit' })

      // Server edit arrives
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'update',
        collection: 'users',
        documentKey: { _id: 'user-1' },
        fullDocument: createTestUser('user-1', { name: 'Server Edit' }),
      })

      await vi.advanceTimersByTimeAsync(0)

      const user = client.get('users', 'user-1')
      expect(user?.name).toBe('Local Edit')
    })

    it('should invoke custom conflict resolver', async () => {
      const customResolver = vi.fn((context: ConflictContext<User>): ConflictResolution<User> => {
        // Merge strategy: take local name but server age
        return {
          resolved: {
            ...context.serverVersion,
            name: context.clientVersion.name,
          },
        }
      })

      const client = createSyncClient(createMockConfig({
        conflictStrategy: 'custom',
        conflictResolver: customResolver,
      }))

      client.connect()
      mockWs.simulateOpen()

      // Initial sync
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [createTestUser('user-1', { name: 'Original', age: 25 })],
      })
      await vi.advanceTimersByTimeAsync(0)

      // Local edit: change name
      await client.update('users', 'user-1', { name: 'Local Name' })

      // Server edit: change age
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'update',
        collection: 'users',
        documentKey: { _id: 'user-1' },
        fullDocument: createTestUser('user-1', { name: 'Server Name', age: 30 }),
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(customResolver).toHaveBeenCalled()
      const user = client.get('users', 'user-1')
      expect(user?.name).toBe('Local Name')
      expect(user?.age).toBe(30)
    })

    it('should handle field-level conflicts', async () => {
      const client = createSyncClient(createMockConfig({
        conflictStrategy: 'field-merge',
      }))

      client.connect()
      mockWs.simulateOpen()

      // Initial sync
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [createTestUser('user-1', { name: 'Original', age: 25, status: 'active' })],
      })
      await vi.advanceTimersByTimeAsync(0)

      // Local edit: change name only
      await client.update('users', 'user-1', { name: 'Local Name' })

      // Server edit: change age only
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'update',
        collection: 'users',
        documentKey: { _id: 'user-1' },
        updateDescription: {
          updatedFields: { age: 30 },
          removedFields: [],
        },
        fullDocument: createTestUser('user-1', { name: 'Original', age: 30, status: 'active' }),
      })

      await vi.advanceTimersByTimeAsync(0)

      const user = client.get('users', 'user-1')
      // Field merge: local name + server age
      expect(user?.name).toBe('Local Name')
      expect(user?.age).toBe(30)
    })

    it('should handle delete during pending update conflict', async () => {
      const client = createSyncClient(createMockConfig())
      const onConflict = vi.fn()

      client.on('conflict', onConflict)
      client.connect()
      mockWs.simulateOpen()

      // Initial sync
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [createTestUser('user-1')],
      })
      await vi.advanceTimersByTimeAsync(0)

      // Local update pending
      await client.update('users', 'user-1', { name: 'Local Update' })

      // Server deletes the document
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'delete',
        collection: 'users',
        documentKey: { _id: 'user-1' },
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(onConflict).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'delete-during-update',
          documentId: 'user-1',
        })
      )
    })
  })

  // ==========================================================================
  // 4. Offline/Online Tests
  // ==========================================================================

  describe('Offline/Online', () => {
    it('should queue mutations while offline', async () => {
      const client = createSyncClient(createMockConfig({
        networkStatus: mockNetworkStatus,
      }))

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Go offline
      mockNetworkStatus.setOnline(false)
      mockWs.simulateClose(1006, 'Connection lost')

      // Mutations while offline should be queued
      await client.insert('users', createTestUser('offline-1'))
      await client.update('users', 'offline-1', { name: 'Offline Update' })

      expect(client.getQueuedMutations()).toHaveLength(2)
      expect(mockWs.send).not.toHaveBeenCalledWith(
        expect.stringContaining('"_id":"offline-1"')
      )
    })

    it('should replay queued mutations when back online', async () => {
      const client = createSyncClient(createMockConfig({
        networkStatus: mockNetworkStatus,
      }))

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Go offline and queue mutations
      mockNetworkStatus.setOnline(false)
      mockWs.simulateClose(1006, 'Connection lost')

      await client.insert('users', createTestUser('offline-1'))
      await client.insert('users', createTestUser('offline-2'))

      const queuedCount = client.getQueuedMutations().length
      expect(queuedCount).toBe(2)

      // Go back online
      mockNetworkStatus.setOnline(true)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Queued mutations should be replayed
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"_id":"offline-1"')
      )
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"_id":"offline-2"')
      )
    })

    it('should handle partial failures during replay', async () => {
      const client = createSyncClient(createMockConfig({
        networkStatus: mockNetworkStatus,
      }))
      const onReplayError = vi.fn()

      client.on('replayError', onReplayError)
      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Go offline and queue mutations
      mockNetworkStatus.setOnline(false)
      mockWs.simulateClose(1006, 'Connection lost')

      await client.insert('users', createTestUser('offline-1'))
      await client.insert('users', createTestUser('offline-2'))
      await client.insert('users', createTestUser('offline-3'))

      // Get the actual mutation IDs from the queue
      const queuedMutations = client.getQueuedMutations()
      expect(queuedMutations).toHaveLength(3)
      const [m1, m2, m3] = queuedMutations.map(m => m.id)

      // Go back online
      mockNetworkStatus.setOnline(true)
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Simulate partial failure (second mutation fails)
      mockWs.simulateMessage({ type: 'ack', mutationId: m1, success: true })
      mockWs.simulateMessage({
        type: 'ack',
        mutationId: m2,
        success: false,
        error: 'Duplicate key error'
      })
      mockWs.simulateMessage({ type: 'ack', mutationId: m3, success: true })

      await vi.advanceTimersByTimeAsync(0)

      expect(onReplayError).toHaveBeenCalledWith(
        expect.objectContaining({
          mutationId: m2,
          error: expect.stringContaining('Duplicate key'),
        })
      )
    })

    it('should persist offline queue across app restarts', async () => {
      const client1 = createSyncClient(createMockConfig({
        networkStatus: mockNetworkStatus,
        storage: mockStorage,
      }))

      client1.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Go offline and queue mutations
      mockNetworkStatus.setOnline(false)
      mockWs.simulateClose(1006, 'Connection lost')

      await client1.insert('users', createTestUser('persistent-1'))
      await client1.insert('users', createTestUser('persistent-2'))

      // "Restart" - create new client with same storage
      const client2 = createSyncClient(createMockConfig({
        networkStatus: mockNetworkStatus,
        storage: mockStorage,
      }))

      await client2.loadPersistedQueue()

      expect(client2.getQueuedMutations()).toHaveLength(2)
    })

    it('should deduplicate mutations in offline queue', async () => {
      const client = createSyncClient(createMockConfig({
        networkStatus: mockNetworkStatus,
      }))

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Go offline
      mockNetworkStatus.setOnline(false)
      mockWs.simulateClose(1006, 'Connection lost')

      // Multiple updates to same document
      await client.insert('users', createTestUser('user-1'))
      await client.update('users', 'user-1', { name: 'Update 1' })
      await client.update('users', 'user-1', { name: 'Update 2' })
      await client.update('users', 'user-1', { name: 'Final Update' })

      // Should be deduplicated to single insert with final state
      const queued = client.getQueuedMutations()
      expect(queued.length).toBeLessThanOrEqual(2) // Insert + final update or merged
    })

    it('should handle offline delete correctly', async () => {
      const client = createSyncClient(createMockConfig({
        networkStatus: mockNetworkStatus,
      }))

      client.connect()
      mockWs.simulateOpen()

      // Initial sync
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [createTestUser('user-1')],
      })
      await vi.advanceTimersByTimeAsync(0)

      // Go offline
      mockNetworkStatus.setOnline(false)
      mockWs.simulateClose(1006, 'Connection lost')

      // Delete while offline
      await client.delete('users', 'user-1')

      // Document should appear deleted locally
      expect(client.get('users', 'user-1')).toBeUndefined()

      // Queued deletion
      expect(client.getQueuedMutations()).toContainEqual(
        expect.objectContaining({
          operation: 'delete',
          documentId: 'user-1',
        })
      )
    })

    it('should emit network status change events', async () => {
      const client = createSyncClient(createMockConfig({
        networkStatus: mockNetworkStatus,
      }))
      const onOffline = vi.fn()
      const onOnline = vi.fn()

      client.on('offline', onOffline)
      client.on('online', onOnline)

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      mockNetworkStatus.setOnline(false)
      expect(onOffline).toHaveBeenCalled()

      mockNetworkStatus.setOnline(true)
      expect(onOnline).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 5. Real-time Updates Tests
  // ==========================================================================

  describe('Real-time Updates', () => {
    it('should process change stream events', async () => {
      const client = createSyncClient(createMockConfig())
      const changes: unknown[] = []

      client.on('change', (event) => changes.push(event))
      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Simulate change stream events
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'insert',
        collection: 'users',
        documentKey: { _id: 'rt-1' },
        fullDocument: createTestUser('rt-1'),
      })

      mockWs.simulateMessage({
        type: 'change',
        operationType: 'update',
        collection: 'users',
        documentKey: { _id: 'rt-1' },
        updateDescription: { updatedFields: { name: 'Real-time Update' }, removedFields: [] },
        fullDocument: createTestUser('rt-1', { name: 'Real-time Update' }),
      })

      mockWs.simulateMessage({
        type: 'change',
        operationType: 'delete',
        collection: 'users',
        documentKey: { _id: 'rt-1' },
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(changes).toHaveLength(3)
      expect(changes[0]).toEqual(expect.objectContaining({ type: 'insert' }))
      expect(changes[1]).toEqual(expect.objectContaining({ type: 'update' }))
      expect(changes[2]).toEqual(expect.objectContaining({ type: 'delete' }))
    })

    it('should keep multiple clients in sync via shared mock', async () => {
      // Simulate two clients connected to same server
      const sharedMessages: unknown[] = []

      const client1 = createSyncClient(createMockConfig())
      const client2 = createSyncClient(createMockConfig())

      client1.on('change', (e) => sharedMessages.push({ client: 1, ...e }))
      client2.on('change', (e) => sharedMessages.push({ client: 2, ...e }))

      // Connect both clients
      client1.connect()
      const ws1 = mockWs
      ws1.simulateOpen()

      client2.connect()
      const ws2 = mockWs
      ws2.simulateOpen()

      await vi.advanceTimersByTimeAsync(0)

      // Client 1 inserts (simulated broadcast to both)
      const insertEvent = {
        type: 'change',
        operationType: 'insert',
        collection: 'users',
        documentKey: { _id: 'shared-1' },
        fullDocument: createTestUser('shared-1'),
      }

      ws1.simulateMessage(insertEvent)
      ws2.simulateMessage(insertEvent)

      await vi.advanceTimersByTimeAsync(0)

      expect(sharedMessages).toHaveLength(2)
      expect(sharedMessages[0]).toEqual(expect.objectContaining({ client: 1, type: 'insert' }))
      expect(sharedMessages[1]).toEqual(expect.objectContaining({ client: 2, type: 'insert' }))
    })

    it('should handle high-frequency updates', async () => {
      const client = createSyncClient(createMockConfig())
      const updateCount = { value: 0 }

      client.on('change', () => updateCount.value++)
      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Simulate rapid updates
      for (let i = 0; i < 100; i++) {
        mockWs.simulateMessage({
          type: 'change',
          operationType: 'update',
          collection: 'users',
          documentKey: { _id: 'rapid-update' },
          fullDocument: createTestUser('rapid-update', { name: `Update ${i}` }),
        })
      }

      await vi.advanceTimersByTimeAsync(0)

      expect(updateCount.value).toBe(100)
    })

    it('should batch process rapid changes efficiently', async () => {
      const client = createSyncClient(createMockConfig({
        batchInterval: 50, // Batch changes every 50ms
      }))
      const batchEvents: unknown[] = []

      client.on('batch', (event) => batchEvents.push(event))
      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Rapid changes within batch window
      for (let i = 0; i < 10; i++) {
        mockWs.simulateMessage({
          type: 'change',
          operationType: 'insert',
          collection: 'users',
          documentKey: { _id: `batch-${i}` },
          fullDocument: createTestUser(`batch-${i}`),
        })
      }

      // Wait for batch to process
      await vi.advanceTimersByTimeAsync(100)

      expect(batchEvents.length).toBeGreaterThanOrEqual(1)
      expect(batchEvents[0]).toEqual(
        expect.objectContaining({
          count: expect.any(Number),
        })
      )
    })

    it('should handle latency in updates', async () => {
      const client = createSyncClient(createMockConfig())
      const timestamps: number[] = []

      client.on('change', () => timestamps.push(Date.now()))
      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Simulate delayed message
      const startTime = Date.now()

      await vi.advanceTimersByTimeAsync(500) // Simulate 500ms latency

      mockWs.simulateMessage({
        type: 'change',
        operationType: 'insert',
        collection: 'users',
        documentKey: { _id: 'delayed' },
        fullDocument: createTestUser('delayed'),
        serverTimestamp: startTime,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(timestamps).toHaveLength(1)
    })

    it('should support query-based subscriptions', async () => {
      const client = createSyncClient(createMockConfig())
      const filteredChanges: unknown[] = []

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Subscribe to only active users
      const subscription = await client.subscribe('users', {
        filter: { status: 'active' },
        onData: (change) => filteredChanges.push(change),
      })

      // Active user change
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'insert',
        collection: 'users',
        documentKey: { _id: 'active-user' },
        fullDocument: createTestUser('active-user', { status: 'active' }),
      })

      // Inactive user change (should be filtered)
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'insert',
        collection: 'users',
        documentKey: { _id: 'inactive-user' },
        fullDocument: createTestUser('inactive-user', { status: 'inactive' }),
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(filteredChanges).toHaveLength(1)
      expect(filteredChanges[0]).toEqual(
        expect.objectContaining({
          document: expect.objectContaining({ status: 'active' }),
        })
      )
    })
  })

  // ==========================================================================
  // 6. Error Recovery Tests
  // ==========================================================================

  describe('Error Recovery', () => {
    it('should handle network errors gracefully', async () => {
      const client = createSyncClient(createMockConfig())
      const onError = vi.fn()

      client.on('error', onError)
      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Simulate network error
      mockWs.simulateError(new Error('Network error'))

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'network',
          message: expect.stringContaining('Network'),
        })
      )
    })

    it('should implement retry logic with exponential backoff', async () => {
      const client = createSyncClient(createMockConfig({
        retryAttempts: 3,
        retryBaseDelay: 1000,
      }))
      const connectionAttempts: number[] = []

      // Track connection attempts
      const originalWebSocket = (globalThis as any).WebSocket
      ;(globalThis as any).WebSocket = vi.fn((url: string) => {
        connectionAttempts.push(Date.now())
        mockWs = new MockWebSocket(url)
        return mockWs
      })

      client.connect()

      // First attempt fails
      mockWs.simulateError(new Error('Connection failed'))
      await vi.advanceTimersByTimeAsync(1000) // 1s base delay

      // Second attempt fails
      mockWs.simulateError(new Error('Connection failed'))
      await vi.advanceTimersByTimeAsync(2000) // 2s (exponential)

      // Third attempt fails
      mockWs.simulateError(new Error('Connection failed'))
      await vi.advanceTimersByTimeAsync(4000) // 4s (exponential)

      expect(connectionAttempts.length).toBeGreaterThanOrEqual(3)

      ;(globalThis as any).WebSocket = originalWebSocket
    })

    it('should maintain data consistency after error recovery', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()

      // Initial sync
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [
          createTestUser('user-1'),
          createTestUser('user-2'),
        ],
      })
      await vi.advanceTimersByTimeAsync(0)

      const countBefore = client.count('users')
      expect(countBefore).toBe(2)

      // Connection drops
      mockWs.simulateClose(1006, 'Connection lost')

      // Reconnect
      mockWs.simulateOpen()

      // Re-sync
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [
          createTestUser('user-1'),
          createTestUser('user-2'),
          createTestUser('user-3'), // New document
        ],
      })
      await vi.advanceTimersByTimeAsync(0)

      const countAfter = client.count('users')
      expect(countAfter).toBe(3)
    })

    it('should handle server rejection errors', async () => {
      const client = createSyncClient(createMockConfig())
      const onError = vi.fn()

      client.on('mutationError', onError)
      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Attempt to insert invalid document
      await client.insert('users', createTestUser('invalid'))

      // Get the actual mutation ID from the sent message
      const lastMessage = mockWs.getLastMessage() as { mutationId: string }

      // Server rejects
      mockWs.simulateMessage({
        type: 'ack',
        mutationId: lastMessage.mutationId,
        success: false,
        error: 'Validation failed: invalid email format',
      })

      await vi.advanceTimersByTimeAsync(0)

      // With optimistic updates, we check for mutation error event instead
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          mutationId: lastMessage.mutationId,
          error: expect.stringContaining('Validation failed'),
        })
      )
    })

    it('should handle authentication errors', async () => {
      const client = createSyncClient(createMockConfig({
        authToken: 'expired-token',
      }))
      const onAuthError = vi.fn()

      client.on('authError', onAuthError)
      client.connect()

      // Server rejects due to auth
      mockWs.simulateMessage({
        type: 'error',
        code: 401,
        message: 'Token expired',
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(onAuthError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 401,
          message: expect.stringContaining('Token expired'),
        })
      )
    })

    it('should handle timeout errors', async () => {
      const client = createSyncClient(createMockConfig({
        timeout: 5000,
      }))
      const onTimeout = vi.fn()

      client.on('timeout', onTimeout)

      // Capture the promise and attach error handler immediately
      let caughtError: Error | null = null
      const connectPromise = client.connect().catch((err) => {
        caughtError = err
      })

      // Connection never opens - timeout after 5s
      await vi.advanceTimersByTimeAsync(5001)

      // Wait for the catch handler to run
      await connectPromise

      expect(caughtError?.message).toBe('Connection timeout')
      expect(onTimeout).toHaveBeenCalled()
      expect(client.getState()).toBe('disconnected')
    })

    it('should clean up resources on fatal errors', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Subscribe to collection
      await client.subscribe('users')

      // Fatal error occurs
      mockWs.simulateMessage({
        type: 'error',
        code: 500,
        message: 'Internal server error',
        fatal: true,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(client.getSubscriptions()).toHaveLength(0)
      expect(client.getState()).toBe('disconnected')
    })

    it('should recover gracefully from invalid server messages', async () => {
      const client = createSyncClient(createMockConfig())
      const onError = vi.fn()

      client.on('error', onError)
      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Send malformed message
      mockWs.simulateMessage('invalid json{{{')
      await vi.advanceTimersByTimeAsync(0)

      // Client should still be connected and functional
      expect(client.getState()).toBe('connected')

      // Valid message should still work
      mockWs.simulateMessage({
        type: 'change',
        operationType: 'insert',
        collection: 'users',
        documentKey: { _id: 'valid' },
        fullDocument: createTestUser('valid'),
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(client.get('users', 'valid')).toBeDefined()
    })

    it('should handle concurrent error scenarios', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Multiple errors in quick succession
      mockWs.simulateError(new Error('Error 1'))
      mockWs.simulateError(new Error('Error 2'))
      mockWs.simulateError(new Error('Error 3'))

      await vi.advanceTimersByTimeAsync(0)

      // Client should not crash
      expect(client).toBeDefined()
    })
  })

  // ==========================================================================
  // 7. Subscription Management Tests
  // ==========================================================================

  describe('Subscription Management', () => {
    it('should subscribe to a collection', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const handle = await client.subscribe('users')

      expect(handle).toBeDefined()
      expect(handle.collection).toBe('users')
      expect(handle.isActive()).toBe(true)
    })

    it('should unsubscribe from a collection', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const handle = await client.subscribe('users')
      expect(handle.isActive()).toBe(true)

      await handle.unsubscribe()
      expect(handle.isActive()).toBe(false)
    })

    it('should support query-filtered subscriptions', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const handle = await client.subscribe('users', {
        filter: { status: 'active', age: { $gte: 18 } },
      })

      expect(handle.filter).toEqual({
        status: 'active',
        age: { $gte: 18 },
      })
    })

    it('should support multiple subscriptions to same collection', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const handle1 = await client.subscribe('users', { filter: { status: 'active' } })
      const handle2 = await client.subscribe('users', { filter: { status: 'inactive' } })

      expect(handle1.id).not.toBe(handle2.id)
      expect(client.getSubscriptions()).toHaveLength(2)
    })

    it('should clean up subscriptions on disconnect', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await client.subscribe('users')
      await client.subscribe('products')

      expect(client.getSubscriptions()).toHaveLength(2)

      await client.disconnect()

      expect(client.getSubscriptions()).toHaveLength(0)
    })

    it('should restore subscriptions on reconnect', async () => {
      const client = createSyncClient(createMockConfig({
        autoResubscribe: true,
      }))

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      await client.subscribe('users')
      await client.subscribe('products')

      // Connection drops
      mockWs.simulateClose(1006, 'Connection lost')

      // Reconnect
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Subscriptions should be restored
      expect(client.getSubscriptions()).toHaveLength(2)
    })
  })

  // ==========================================================================
  // 8. Sync State Management Tests
  // ==========================================================================

  describe('Sync State Management', () => {
    it('should track sync state transitions', async () => {
      const client = createSyncClient(createMockConfig())
      const states: SyncState[] = []

      client.on('stateChange', (state) => states.push(state))

      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Send initial-sync to trigger syncing state
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: [],
      })
      await vi.advanceTimersByTimeAsync(0)

      mockWs.simulateMessage({
        type: 'initial-sync-complete',
        collection: 'users',
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(states).toContain('connecting')
      expect(states).toContain('connected')
      expect(states).toContain('syncing')
      expect(states).toContain('ready')
    })

    it('should expose current sync state', async () => {
      const client = createSyncClient(createMockConfig())

      expect(client.getState()).toBe('disconnected')

      client.connect()
      expect(client.getState()).toBe('connecting')

      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(client.getState()).toBe('connected')
    })

    it('should track sync progress', async () => {
      const client = createSyncClient(createMockConfig())
      const progressEvents: unknown[] = []

      client.on('syncProgress', (event) => progressEvents.push(event))
      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Simulate progressive sync
      mockWs.simulateMessage({
        type: 'sync-progress',
        collection: 'users',
        loaded: 100,
        total: 1000,
        percentage: 10,
      })

      mockWs.simulateMessage({
        type: 'sync-progress',
        collection: 'users',
        loaded: 500,
        total: 1000,
        percentage: 50,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(progressEvents).toHaveLength(2)
      expect(progressEvents[1]).toEqual(
        expect.objectContaining({
          percentage: 50,
        })
      )
    })

    it('should provide sync statistics', async () => {
      const client = createSyncClient(createMockConfig())

      client.connect()
      mockWs.simulateOpen()

      // Initial sync
      mockWs.simulateMessage({
        type: 'initial-sync',
        collection: 'users',
        documents: Array.from({ length: 100 }, (_, i) => createTestUser(`user-${i}`)),
      })
      await vi.advanceTimersByTimeAsync(0)

      const stats = client.getStats()

      expect(stats).toEqual(
        expect.objectContaining({
          documentsLoaded: expect.any(Number),
          lastSyncTime: expect.any(Number),
          pendingMutations: expect.any(Number),
        })
      )
    })
  })
})

// ============================================================================
// Additional Edge Case Tests
// ============================================================================

describe('Edge Cases', () => {
  let mockWs: MockWebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as any).WebSocket = vi.fn((url: string) => {
      mockWs = new MockWebSocket(url)
      return mockWs
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    ;(globalThis as any).WebSocket = originalWebSocket
  })

  it('should handle empty initial sync', async () => {
    const client = createSyncClient(createMockConfig())

    client.connect()
    mockWs.simulateOpen()

    mockWs.simulateMessage({
      type: 'initial-sync',
      collection: 'users',
      documents: [],
    })
    mockWs.simulateMessage({
      type: 'initial-sync-complete',
      collection: 'users',
    })

    await vi.advanceTimersByTimeAsync(0)

    expect(client.isReady('users')).toBe(true)
    expect(client.count('users')).toBe(0)
  })

  it('should handle very large documents', async () => {
    const client = createSyncClient(createMockConfig())

    client.connect()
    mockWs.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    // Create document with large array
    const largeUser = createTestUser('large-user', {
      tags: Array.from({ length: 10000 }, (_, i) => `tag-${i}`),
    })

    await client.insert('users', largeUser)

    expect(mockWs.send).toHaveBeenCalled()
  })

  it('should handle special characters in document IDs', async () => {
    const client = createSyncClient(createMockConfig())

    client.connect()
    mockWs.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    const specialIds = [
      'user/with/slashes',
      'user.with.dots',
      'user:with:colons',
      'user@with@at',
      'user with spaces',
      'user-with-unicode-\u00e9\u00e0\u00fc',
    ]

    for (const id of specialIds) {
      const user = createTestUser(id)
      await client.insert('users', user)
    }

    expect(mockWs.send).toHaveBeenCalledTimes(specialIds.length)
  })

  it('should handle null and undefined values in documents', async () => {
    const client = createSyncClient(createMockConfig())

    client.connect()
    mockWs.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    const userWithNulls = {
      _id: 'null-user',
      name: 'Test',
      email: 'test@example.com',
      age: 25,
      status: 'active' as const,
      version: 1,
      tags: undefined,
      createdAt: null,
    }

    await client.insert('users', userWithNulls as unknown as User)

    expect(mockWs.send).toHaveBeenCalled()
  })

  it('should handle rapid connect/disconnect cycles', async () => {
    const client = createSyncClient(createMockConfig())

    for (let i = 0; i < 10; i++) {
      client.connect()
      mockWs.simulateOpen()
      await vi.advanceTimersByTimeAsync(10)
      await client.disconnect()
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(client.getState()).toBe('disconnected')
  })

  it('should handle operations on non-existent collections', async () => {
    const client = createSyncClient(createMockConfig())

    client.connect()
    mockWs.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    const result = client.get('nonexistent', 'doc-1')
    expect(result).toBeUndefined()
  })
})
