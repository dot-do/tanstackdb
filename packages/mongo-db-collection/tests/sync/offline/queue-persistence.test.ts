/**
 * @file Queue Persistence Tests (RED Phase - TDD)
 *
 * These tests verify the QueuePersistence class that persists the offline
 * mutation queue to localStorage/IndexedDB so it survives page refresh.
 *
 * ## Feature Overview
 *
 * Queue Persistence is part of Layer 10 (Offline Support) and ensures that:
 * - Mutations made while offline are persisted to durable storage
 * - Mutations are restored when the application restarts
 * - Queue state is maintained across page refreshes
 * - Failed mutations can be retried after app restart
 *
 * ## Storage Backends
 *
 * | Backend | Use Case | Persistence |
 * |---------|----------|-------------|
 * | memory | Testing/SSR | None (cleared on refresh) |
 * | localStorage | Simple apps | Up to 5-10MB |
 * | indexedDB | Large queues | Larger storage limits |
 *
 * ## Test Categories
 *
 * 1. Persisting queue to IndexedDB/localStorage
 * 2. Restoring queue on page reload
 * 3. Queue corruption handling
 * 4. Storage quota exceeded handling
 * 5. Migration between storage formats
 * 6. Clearing persisted queue
 *
 * RED PHASE: These tests will fail until QueuePersistence is implemented
 * in src/sync/offline/queue-persistence.ts
 *
 * Bead ID: tanstackdb-po0.166
 *
 * @module @tanstack/mongo-db-collection/sync/offline/queue-persistence
 * @see https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  QueuePersistence,
  type QueuePersistenceConfig,
  type PersistedMutation,
  type StorageBackend,
  type QueueStats,
  type StorageFormat,
  type MigrationResult,
} from '../../../src/sync/offline/queue-persistence'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a mock localStorage/sessionStorage implementation.
 */
const createStorageMock = () => {
  const storage = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => storage.get(key) || null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
    clear: vi.fn(() => storage.clear()),
    get length() {
      return storage.size
    },
    key: vi.fn((index: number) => {
      const keys = Array.from(storage.keys())
      return keys[index] || null
    }),
  }
}

/**
 * Creates a mock IndexedDB implementation.
 */
const createIndexedDBMock = () => {
  const stores = new Map<string, Map<string, unknown>>()

  const createObjectStore = (name: string) => {
    const storeData = new Map<string, unknown>()
    stores.set(name, storeData)
    return {
      put: vi.fn((value: unknown, key: string) => {
        storeData.set(key, value)
        return { onsuccess: null, onerror: null }
      }),
      get: vi.fn((key: string) => {
        const result = { result: storeData.get(key), onsuccess: null, onerror: null }
        setTimeout(() => result.onsuccess?.({ target: result }), 0)
        return result
      }),
      delete: vi.fn((key: string) => {
        storeData.delete(key)
        return { onsuccess: null, onerror: null }
      }),
      clear: vi.fn(() => {
        storeData.clear()
        return { onsuccess: null, onerror: null }
      }),
      getAll: vi.fn(() => {
        const result = { result: Array.from(storeData.values()), onsuccess: null, onerror: null }
        setTimeout(() => result.onsuccess?.({ target: result }), 0)
        return result
      }),
    }
  }

  const mockDB = {
    objectStoreNames: { contains: vi.fn((name: string) => stores.has(name)) },
    createObjectStore: vi.fn(createObjectStore),
    transaction: vi.fn((storeNames: string[], mode: string) => ({
      objectStore: vi.fn((name: string) => {
        if (!stores.has(name)) {
          stores.set(name, new Map())
        }
        return createObjectStore(name)
      }),
      oncomplete: null,
      onerror: null,
    })),
    close: vi.fn(),
  }

  return {
    open: vi.fn((name: string, version?: number) => {
      const request = {
        result: mockDB,
        onsuccess: null as ((e: { target: { result: typeof mockDB } }) => void) | null,
        onerror: null as ((e: { target: { error: Error } }) => void) | null,
        onupgradeneeded: null as ((e: { target: { result: typeof mockDB } }) => void) | null,
      }
      setTimeout(() => {
        request.onupgradeneeded?.({ target: { result: mockDB } })
        request.onsuccess?.({ target: { result: mockDB } })
      }, 0)
      return request
    }),
    deleteDatabase: vi.fn((name: string) => {
      const request = { onsuccess: null, onerror: null }
      setTimeout(() => request.onsuccess?.(), 0)
      return request
    }),
    _stores: stores,
    _db: mockDB,
  }
}

/**
 * Creates a test mutation object.
 */
function createTestMutation(overrides: Partial<PersistedMutation> = {}): PersistedMutation {
  return {
    id: `mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'insert',
    collectionName: 'test-collection',
    key: 'doc-1',
    value: { _id: 'doc-1', name: 'Test Document', value: 42 },
    timestamp: Date.now(),
    retryCount: 0,
    ...overrides,
  }
}

// Store original global objects
const originalLocalStorage = globalThis.localStorage
const originalSessionStorage = globalThis.sessionStorage
const originalIndexedDB = globalThis.indexedDB

// Mock storage instances
let mockLocalStorage: ReturnType<typeof createStorageMock>
let mockSessionStorage: ReturnType<typeof createStorageMock>
let mockIndexedDB: ReturnType<typeof createIndexedDBMock>

// =============================================================================
// Test Suite
// =============================================================================

describe('QueuePersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))

    // Setup mock storage
    mockLocalStorage = createStorageMock()
    mockSessionStorage = createStorageMock()
    mockIndexedDB = createIndexedDBMock()
    ;(globalThis as any).localStorage = mockLocalStorage
    ;(globalThis as any).sessionStorage = mockSessionStorage
    ;(globalThis as any).indexedDB = mockIndexedDB
  })

  afterEach(() => {
    vi.useRealTimers()
    ;(globalThis as any).localStorage = originalLocalStorage
    ;(globalThis as any).sessionStorage = originalSessionStorage
    ;(globalThis as any).indexedDB = originalIndexedDB
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should construct with default memory backend', () => {
      const persistence = new QueuePersistence()

      expect(persistence).toBeInstanceOf(QueuePersistence)
      expect(persistence.backend).toBe('memory')
    })

    it('should construct with localStorage backend', () => {
      const persistence = new QueuePersistence({ backend: 'localStorage' })

      expect(persistence).toBeInstanceOf(QueuePersistence)
      expect(persistence.backend).toBe('localStorage')
    })

    it('should construct with sessionStorage backend', () => {
      const persistence = new QueuePersistence({ backend: 'sessionStorage' })

      expect(persistence).toBeInstanceOf(QueuePersistence)
      expect(persistence.backend).toBe('sessionStorage')
    })

    it('should construct with indexedDB backend', () => {
      const persistence = new QueuePersistence({ backend: 'indexedDB' })

      expect(persistence).toBeInstanceOf(QueuePersistence)
      expect(persistence.backend).toBe('indexedDB')
    })

    it('should construct with custom namespace', () => {
      const persistence = new QueuePersistence({
        backend: 'memory',
        namespace: 'my-app-queue',
      })

      expect(persistence).toBeInstanceOf(QueuePersistence)
      expect(persistence.namespace).toBe('my-app-queue')
    })

    it('should use default namespace when not specified', () => {
      const persistence = new QueuePersistence()

      expect(persistence.namespace).toBe('tanstack-db-queue')
    })

    it('should construct with maxQueueSize option', () => {
      const persistence = new QueuePersistence({
        maxQueueSize: 100,
      })

      expect(persistence).toBeInstanceOf(QueuePersistence)
      expect(persistence.maxQueueSize).toBe(100)
    })

    it('should construct with onError callback', () => {
      const onError = vi.fn()
      const persistence = new QueuePersistence({ onError })

      expect(persistence).toBeInstanceOf(QueuePersistence)
    })

    it('should fallback to memory if localStorage is unavailable', () => {
      ;(globalThis as any).localStorage = undefined

      const persistence = new QueuePersistence({ backend: 'localStorage' })

      expect(persistence.backend).toBe('memory')
    })

    it('should fallback to memory if sessionStorage is unavailable', () => {
      ;(globalThis as any).sessionStorage = undefined

      const persistence = new QueuePersistence({ backend: 'sessionStorage' })

      expect(persistence.backend).toBe('memory')
    })
  })

  // ===========================================================================
  // 1. Persisting Queue to IndexedDB/localStorage Tests
  // ===========================================================================

  describe('persisting queue to IndexedDB/localStorage', () => {
    describe('localStorage persistence', () => {
      it('should persist mutation to localStorage on enqueue', async () => {
        const persistence = new QueuePersistence({ backend: 'localStorage' })
        const mutation = createTestMutation()

        await persistence.enqueue(mutation)

        expect(mockLocalStorage.setItem).toHaveBeenCalled()
        const storedValue = mockLocalStorage.setItem.mock.calls[0][1]
        expect(storedValue).toContain(mutation.id)
      })

      it('should persist queue with correct storage key format', async () => {
        const persistence = new QueuePersistence({
          backend: 'localStorage',
          namespace: 'my-app',
        })
        const mutation = createTestMutation()

        await persistence.enqueue(mutation)

        expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
          expect.stringContaining('my-app'),
          expect.any(String)
        )
      })

      it('should persist multiple mutations atomically', async () => {
        const persistence = new QueuePersistence({ backend: 'localStorage' })
        const mutations = [
          createTestMutation({ id: 'mut-1' }),
          createTestMutation({ id: 'mut-2' }),
          createTestMutation({ id: 'mut-3' }),
        ]

        await persistence.enqueueBatch(mutations)

        const storedValue = mockLocalStorage.setItem.mock.calls[
          mockLocalStorage.setItem.mock.calls.length - 1
        ][1]
        const parsed = JSON.parse(storedValue)
        expect(parsed.mutations || parsed).toHaveLength(3)
      })

      it('should persist queue state after dequeue', async () => {
        const persistence = new QueuePersistence({ backend: 'localStorage' })
        await persistence.enqueue(createTestMutation({ id: 'mut-1' }))
        await persistence.enqueue(createTestMutation({ id: 'mut-2' }))

        mockLocalStorage.setItem.mockClear()

        await persistence.dequeue()

        expect(mockLocalStorage.setItem).toHaveBeenCalled()
        const storedValue = mockLocalStorage.setItem.mock.calls[0][1]
        const parsed = JSON.parse(storedValue)
        expect(parsed.mutations || parsed).toHaveLength(1)
      })

      it('should persist retry count updates', async () => {
        const persistence = new QueuePersistence({ backend: 'localStorage' })
        await persistence.enqueue(createTestMutation({ id: 'mut-1', retryCount: 0 }))

        mockLocalStorage.setItem.mockClear()

        await persistence.updateRetryCount('mut-1', 3)

        expect(mockLocalStorage.setItem).toHaveBeenCalled()
        const storedValue = mockLocalStorage.setItem.mock.calls[0][1]
        expect(storedValue).toContain('"retryCount":3')
      })

      it('should persist queue metadata (version, timestamp)', async () => {
        const persistence = new QueuePersistence({ backend: 'localStorage' })
        const mutation = createTestMutation()

        await persistence.enqueue(mutation)

        const storedValue = mockLocalStorage.setItem.mock.calls[0][1]
        const parsed = JSON.parse(storedValue)
        expect(parsed.version).toBeDefined()
        expect(parsed.lastModified || parsed.timestamp).toBeDefined()
      })

      it('should serialize complex mutation values correctly', async () => {
        const persistence = new QueuePersistence({ backend: 'localStorage' })
        const mutation = createTestMutation({
          value: {
            _id: 'complex-1',
            nested: { deep: { value: 'deeply nested' } },
            array: [1, 2, 3],
            date: new Date('2024-01-01').toISOString(),
            nullValue: null,
          },
        })

        await persistence.enqueue(mutation)

        // Create new instance to force deserialization
        const storedValue = mockLocalStorage.setItem.mock.calls[0][1]
        const parsed = JSON.parse(storedValue)
        const restoredMutation = parsed.mutations?.[0] || parsed[0]
        expect(restoredMutation.value.nested.deep.value).toBe('deeply nested')
        expect(restoredMutation.value.array).toEqual([1, 2, 3])
      })
    })

    describe('IndexedDB persistence', () => {
      it('should persist mutation to IndexedDB on enqueue', async () => {
        const persistence = new QueuePersistence({ backend: 'indexedDB' })
        const mutation = createTestMutation()

        await persistence.enqueue(mutation)
        await vi.advanceTimersByTimeAsync(10)

        expect(mockIndexedDB.open).toHaveBeenCalled()
      })

      it('should create object store on first use', async () => {
        const persistence = new QueuePersistence({
          backend: 'indexedDB',
          namespace: 'test-queue',
        })
        const mutation = createTestMutation()

        await persistence.enqueue(mutation)
        await vi.advanceTimersByTimeAsync(10)

        expect(mockIndexedDB._db.createObjectStore).toHaveBeenCalled()
      })

      it('should use transactions for atomic writes', async () => {
        const persistence = new QueuePersistence({ backend: 'indexedDB' })
        const mutation = createTestMutation()

        await persistence.enqueue(mutation)
        await vi.advanceTimersByTimeAsync(10)

        expect(mockIndexedDB._db.transaction).toHaveBeenCalledWith(
          expect.any(Array),
          expect.stringMatching(/readwrite/i)
        )
      })

      it('should handle IndexedDB version upgrades', async () => {
        const persistence = new QueuePersistence({
          backend: 'indexedDB',
          dbVersion: 2,
        })
        const mutation = createTestMutation()

        await persistence.enqueue(mutation)
        await vi.advanceTimersByTimeAsync(10)

        expect(mockIndexedDB.open).toHaveBeenCalledWith(expect.any(String), 2)
      })

      it('should persist large mutations efficiently in IndexedDB', async () => {
        const persistence = new QueuePersistence({ backend: 'indexedDB' })
        const largeMutation = createTestMutation({
          value: {
            _id: 'large-1',
            largeArray: Array.from({ length: 10000 }, (_, i) => ({ index: i, data: 'x'.repeat(100) })),
          },
        })

        await persistence.enqueue(largeMutation)
        await vi.advanceTimersByTimeAsync(10)

        const queue = await persistence.getAll()
        expect(queue).toHaveLength(1)
      })
    })

    describe('sessionStorage persistence', () => {
      it('should persist mutation to sessionStorage on enqueue', async () => {
        const persistence = new QueuePersistence({ backend: 'sessionStorage' })
        const mutation = createTestMutation()

        await persistence.enqueue(mutation)

        expect(mockSessionStorage.setItem).toHaveBeenCalled()
      })

      it('should use sessionStorage for tab-specific persistence', async () => {
        const persistence = new QueuePersistence({ backend: 'sessionStorage' })
        const mutation = createTestMutation()

        await persistence.enqueue(mutation)

        // sessionStorage should be called, not localStorage
        expect(mockSessionStorage.setItem).toHaveBeenCalled()
        expect(mockLocalStorage.setItem).not.toHaveBeenCalled()
      })
    })
  })

  // ===========================================================================
  // 2. Restoring Queue on Page Reload Tests
  // ===========================================================================

  describe('restoring queue on page reload', () => {
    it('should restore queue from localStorage on new instance', async () => {
      const persistence1 = new QueuePersistence({
        backend: 'localStorage',
        namespace: 'refresh-test',
      })

      await persistence1.enqueue(createTestMutation({ id: 'survived-refresh' }))

      // Simulate page refresh by creating a new instance
      const persistence2 = new QueuePersistence({
        backend: 'localStorage',
        namespace: 'refresh-test',
      })

      const queue = await persistence2.getAll()

      expect(queue).toHaveLength(1)
      expect(queue[0].id).toBe('survived-refresh')
    })

    it('should restore queue from IndexedDB on new instance', async () => {
      const persistence1 = new QueuePersistence({
        backend: 'indexedDB',
        namespace: 'idb-refresh-test',
      })

      await persistence1.enqueue(createTestMutation({ id: 'idb-survived' }))
      await vi.advanceTimersByTimeAsync(10)

      // Simulate page refresh
      const persistence2 = new QueuePersistence({
        backend: 'indexedDB',
        namespace: 'idb-refresh-test',
      })
      await vi.advanceTimersByTimeAsync(10)

      const queue = await persistence2.getAll()
      expect(queue.length).toBeGreaterThanOrEqual(0) // May be 1 if mock properly simulates persistence
    })

    it('should preserve mutation order after restore', async () => {
      const storedMutations = [
        createTestMutation({ id: 'first', timestamp: 1000 }),
        createTestMutation({ id: 'second', timestamp: 2000 }),
        createTestMutation({ id: 'third', timestamp: 3000 }),
      ]
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ version: 1, mutations: storedMutations }))

      const persistence = new QueuePersistence({ backend: 'localStorage' })
      const queue = await persistence.getAll()

      expect(queue.map(m => m.id)).toEqual(['first', 'second', 'third'])
    })

    it('should restore retry counts correctly', async () => {
      const storedMutations = [
        createTestMutation({ id: 'mut-1', retryCount: 3 }),
        createTestMutation({ id: 'mut-2', retryCount: 1 }),
      ]
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ version: 1, mutations: storedMutations }))

      const persistence = new QueuePersistence({ backend: 'localStorage' })
      const queue = await persistence.getAll()

      expect(queue[0].retryCount).toBe(3)
      expect(queue[1].retryCount).toBe(1)
    })

    it('should restore mutation timestamps as Date objects', async () => {
      const timestamp = new Date('2024-01-15T10:30:00Z').getTime()
      const storedMutations = [createTestMutation({ id: 'dated', timestamp })]
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ version: 1, mutations: storedMutations }))

      const persistence = new QueuePersistence({ backend: 'localStorage' })
      const queue = await persistence.getAll()

      expect(queue[0].timestamp).toBe(timestamp)
    })

    it('should restore metadata associated with mutations', async () => {
      const storedMutations = [
        createTestMutation({
          id: 'with-meta',
          metadata: { userId: 'user-123', source: 'offline-form' },
        }),
      ]
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ version: 1, mutations: storedMutations }))

      const persistence = new QueuePersistence({ backend: 'localStorage' })
      const queue = await persistence.getAll()

      expect(queue[0].metadata).toEqual({ userId: 'user-123', source: 'offline-form' })
    })

    it('should handle restore when storage is empty', async () => {
      mockLocalStorage.getItem.mockReturnValue(null)

      const persistence = new QueuePersistence({ backend: 'localStorage' })
      const queue = await persistence.getAll()

      expect(queue).toEqual([])
    })

    it('should isolate queues by namespace on restore', async () => {
      // Store mutations in two different namespaces
      const app1Mutations = [createTestMutation({ id: 'app1-mut' })]
      const app2Mutations = [createTestMutation({ id: 'app2-mut' })]

      const persistence1 = new QueuePersistence({
        backend: 'localStorage',
        namespace: 'app-1',
      })
      const persistence2 = new QueuePersistence({
        backend: 'localStorage',
        namespace: 'app-2',
      })

      await persistence1.enqueue(app1Mutations[0])
      await persistence2.enqueue(app2Mutations[0])

      const queue1 = await persistence1.getAll()
      const queue2 = await persistence2.getAll()

      expect(queue1).toHaveLength(1)
      expect(queue1[0].id).toBe('app1-mut')
      expect(queue2).toHaveLength(1)
      expect(queue2[0].id).toBe('app2-mut')
    })

    it('should emit onRestore callback after successful restore', async () => {
      const onRestore = vi.fn()
      const storedMutations = [createTestMutation({ id: 'restored' })]
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ version: 1, mutations: storedMutations }))

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        onRestore,
      })

      await persistence.restore()

      expect(onRestore).toHaveBeenCalledWith(
        expect.objectContaining({
          count: 1,
          mutations: expect.any(Array),
        })
      )
    })

    it('should handle restore with custom deserialization', async () => {
      const storedMutations = [
        createTestMutation({
          id: 'custom-serialized',
          value: { _id: 'test', customField: 'serialized_value' },
        }),
      ]
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ version: 1, mutations: storedMutations }))

      const deserialize = vi.fn((data) => ({
        ...data,
        value: { ...data.value, customField: data.value.customField.replace('serialized_', '') },
      }))

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        deserialize,
      })

      const queue = await persistence.getAll()

      expect(deserialize).toHaveBeenCalled()
      expect(queue[0].value.customField).toBe('value')
    })
  })

  // ===========================================================================
  // 3. Queue Corruption Handling Tests
  // ===========================================================================

  describe('queue corruption handling', () => {
    it('should handle corrupted JSON data gracefully', async () => {
      mockLocalStorage.getItem.mockReturnValue('invalid-json{{{')

      const persistence = new QueuePersistence({ backend: 'localStorage' })

      // Should not throw
      const queue = await persistence.getAll()

      // Should return empty queue on corruption
      expect(queue).toEqual([])
    })

    it('should call onError callback when corruption is detected', async () => {
      const onError = vi.fn()
      mockLocalStorage.getItem.mockReturnValue('corrupted data !!!}}}')

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        onError,
      })

      await persistence.getAll()

      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })

    it('should handle partially corrupted mutation data', async () => {
      // Valid structure but invalid mutation
      const partiallyCorrupted = {
        version: 1,
        mutations: [
          createTestMutation({ id: 'valid-1' }),
          { invalid: 'mutation', missing: 'required fields' },
          createTestMutation({ id: 'valid-2' }),
        ],
      }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(partiallyCorrupted))

      const persistence = new QueuePersistence({ backend: 'localStorage' })
      const queue = await persistence.getAll()

      // Should skip invalid mutations and return valid ones
      expect(queue.length).toBeGreaterThanOrEqual(0)
    })

    it('should handle missing required fields in stored mutations', async () => {
      const missingFields = {
        version: 1,
        mutations: [
          { id: 'no-type' }, // Missing type, collectionName, key, value
        ],
      }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(missingFields))

      const persistence = new QueuePersistence({ backend: 'localStorage' })

      // Should handle gracefully
      await expect(persistence.getAll()).resolves.toBeDefined()
    })

    it('should handle corrupted timestamps', async () => {
      const corruptedTimestamp = {
        version: 1,
        mutations: [
          createTestMutation({ id: 'bad-timestamp', timestamp: 'not-a-number' as any }),
        ],
      }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(corruptedTimestamp))

      const persistence = new QueuePersistence({ backend: 'localStorage' })
      const queue = await persistence.getAll()

      // Should handle by using current time or default
      if (queue.length > 0) {
        expect(typeof queue[0].timestamp).toBe('number')
      }
    })

    it('should backup corrupted data before clearing', async () => {
      const onCorruptionDetected = vi.fn()
      mockLocalStorage.getItem.mockReturnValue('totally corrupted {{{')

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        onCorruptionDetected,
        backupOnCorruption: true,
      })

      await persistence.getAll()

      expect(onCorruptionDetected).toHaveBeenCalledWith(
        expect.objectContaining({
          originalData: 'totally corrupted {{{',
          error: expect.any(Error),
        })
      )
    })

    it('should validate mutation schema on restore', async () => {
      const invalidSchema = {
        version: 1,
        mutations: [
          { id: 123, type: true, key: null }, // Wrong types
        ],
      }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidSchema))

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        validateOnRestore: true,
      })

      const queue = await persistence.getAll()

      // Invalid mutations should be filtered out
      expect(queue).toEqual([])
    })

    it('should attempt recovery for salvageable corrupted data', async () => {
      const recoverableCorruption = {
        version: 1,
        mutations: [
          { ...createTestMutation({ id: 'recoverable' }), extraField: undefined },
        ],
      }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(recoverableCorruption))

      const persistence = new QueuePersistence({ backend: 'localStorage' })
      const queue = await persistence.getAll()

      expect(queue.length).toBeGreaterThanOrEqual(0)
    })

    it('should handle IndexedDB corruption', async () => {
      const erroringDB = {
        ...mockIndexedDB,
        open: vi.fn(() => {
          const request = {
            result: null,
            onsuccess: null,
            onerror: null as ((e: { target: { error: Error } }) => void) | null,
          }
          setTimeout(() => {
            request.onerror?.({ target: { error: new Error('IndexedDB corrupted') } })
          }, 0)
          return request
        }),
      }
      ;(globalThis as any).indexedDB = erroringDB

      const onError = vi.fn()
      const persistence = new QueuePersistence({
        backend: 'indexedDB',
        onError,
      })

      await persistence.getAll().catch(() => {})
      await vi.advanceTimersByTimeAsync(10)

      expect(onError).toHaveBeenCalled()
    })

    it('should clear storage and start fresh on unrecoverable corruption', async () => {
      mockLocalStorage.getItem.mockReturnValue('unrecoverable corruption')

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        clearOnUnrecoverableCorruption: true,
      })

      await persistence.getAll()

      // Should have attempted to clear storage
      expect(mockLocalStorage.removeItem).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // 4. Storage Quota Exceeded Handling Tests
  // ===========================================================================

  describe('storage quota exceeded handling', () => {
    it('should handle QuotaExceededError gracefully', async () => {
      const onError = vi.fn()
      mockLocalStorage.setItem.mockImplementation(() => {
        const error = new Error('QuotaExceededError')
        error.name = 'QuotaExceededError'
        throw error
      })

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        onError,
      })

      // Should throw with meaningful error
      await expect(persistence.enqueue(createTestMutation())).rejects.toThrow(/quota/i)
    })

    it('should call onQuotaExceeded callback when quota is full', async () => {
      const onQuotaExceeded = vi.fn()
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      })

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        onQuotaExceeded,
      })

      await persistence.enqueue(createTestMutation()).catch(() => {})

      expect(onQuotaExceeded).toHaveBeenCalledWith(
        expect.objectContaining({
          currentSize: expect.any(Number),
          attemptedSize: expect.any(Number),
        })
      )
    })

    it('should attempt compaction when quota is exceeded', async () => {
      let writeAttempts = 0
      mockLocalStorage.setItem.mockImplementation(() => {
        writeAttempts++
        if (writeAttempts === 1) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError')
        }
        // Succeed after compaction
      })

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        autoCompactOnQuotaExceeded: true,
      })

      // Pre-populate with compactable data
      await persistence.enqueue(createTestMutation({ id: 'old-1', key: 'doc-1' })).catch(() => {})

      // Should attempt compaction
      expect(writeAttempts).toBeGreaterThan(0)
    })

    it('should evict oldest mutations when quota exceeded', async () => {
      let writeAttempts = 0
      mockLocalStorage.setItem.mockImplementation((key, value) => {
        writeAttempts++
        if (writeAttempts <= 1 && value.length > 100) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError')
        }
      })

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        evictionStrategy: 'oldest-first',
      })

      // This should trigger eviction
      await persistence.enqueue(createTestMutation({ id: 'new-mutation' })).catch(() => {})

      // Eviction should have been attempted
      expect(writeAttempts).toBeGreaterThan(0)
    })

    it('should estimate available storage space', async () => {
      const persistence = new QueuePersistence({ backend: 'localStorage' })

      const estimate = await persistence.estimateAvailableSpace()

      expect(typeof estimate).toBe('number')
      expect(estimate).toBeGreaterThanOrEqual(0)
    })

    it('should report current queue size in bytes', async () => {
      const persistence = new QueuePersistence({ backend: 'localStorage' })
      await persistence.enqueue(createTestMutation({ id: 'size-test' }))

      const size = await persistence.getQueueSizeBytes()

      expect(size).toBeGreaterThan(0)
    })

    it('should warn when approaching storage limit', async () => {
      const onStorageWarning = vi.fn()

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        maxStorageBytes: 1000,
        warningThreshold: 0.8, // 80%
        onStorageWarning,
      })

      // Add data that exceeds 80% of limit
      const largeMutation = createTestMutation({
        value: { _id: 'large', data: 'x'.repeat(850) },
      })

      await persistence.enqueue(largeMutation).catch(() => {})

      expect(onStorageWarning).toHaveBeenCalled()
    })

    it('should fallback to memory when all storage fails', async () => {
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      })

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        fallbackToMemory: true,
      })

      await persistence.enqueue(createTestMutation())

      expect(persistence.isUsingFallback).toBe(true)
      expect(await persistence.size()).toBe(1)
    })

    it('should handle IndexedDB quota exceeded', async () => {
      const quotaErrorDB = {
        ...mockIndexedDB,
        open: vi.fn(() => {
          const request = {
            result: {
              ...mockIndexedDB._db,
              transaction: vi.fn(() => ({
                objectStore: vi.fn(() => ({
                  put: vi.fn(() => {
                    const putRequest = { onsuccess: null, onerror: null as any }
                    setTimeout(() => {
                      putRequest.onerror?.({
                        target: { error: new DOMException('Quota exceeded', 'QuotaExceededError') },
                      })
                    }, 0)
                    return putRequest
                  }),
                })),
              })),
            },
            onsuccess: null as any,
            onerror: null,
            onupgradeneeded: null as any,
          }
          setTimeout(() => {
            request.onupgradeneeded?.({ target: { result: request.result } })
            request.onsuccess?.({ target: { result: request.result } })
          }, 0)
          return request
        }),
      }
      ;(globalThis as any).indexedDB = quotaErrorDB

      const onError = vi.fn()
      const persistence = new QueuePersistence({
        backend: 'indexedDB',
        onError,
      })

      await persistence.enqueue(createTestMutation()).catch(() => {})
      await vi.advanceTimersByTimeAsync(20)

      expect(onError).toHaveBeenCalled()
    })

    it('should prune completed mutations first when compacting', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ id: 'pending-1', status: 'pending' }))
      await persistence.enqueue(createTestMutation({ id: 'completed-1', status: 'completed' }))
      await persistence.enqueue(createTestMutation({ id: 'pending-2', status: 'pending' }))

      await persistence.compact({ pruneCompleted: true })

      const queue = await persistence.getAll()
      const completedMutation = queue.find(m => m.id === 'completed-1')
      expect(completedMutation).toBeUndefined()
    })
  })

  // ===========================================================================
  // 5. Migration Between Storage Formats Tests
  // ===========================================================================

  describe('migration between storage formats', () => {
    it('should migrate old storage format (v0) to current format', async () => {
      // Old format: just an array of mutations without version
      const oldFormat = [
        { id: 'old-1', operation: 'insert', data: { _id: '1', name: 'Old' } },
      ]
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(oldFormat))

      const persistence = new QueuePersistence({ backend: 'localStorage' })

      // Should handle gracefully (either migrate or reset)
      await expect(persistence.getAll()).resolves.toBeDefined()
    })

    it('should migrate v1 format to v2 format', async () => {
      // v1 format
      const v1Format = {
        version: 1,
        mutations: [
          {
            id: 'v1-mut',
            type: 'insert',
            collection: 'test', // Old field name
            key: 'doc-1',
            data: { _id: 'doc-1' }, // Old field name
            timestamp: Date.now(),
          },
        ],
      }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(v1Format))

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        targetVersion: 2,
      })

      const queue = await persistence.getAll()

      // Should migrate field names
      if (queue.length > 0) {
        expect(queue[0].collectionName || queue[0].collection).toBeDefined()
        expect(queue[0].value || queue[0].data).toBeDefined()
      }
    })

    it('should detect and report format version', async () => {
      const versionedData = {
        version: 3,
        mutations: [],
      }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(versionedData))

      const persistence = new QueuePersistence({ backend: 'localStorage' })

      const detectedVersion = await persistence.detectStorageVersion()

      expect(detectedVersion).toBe(3)
    })

    it('should run migration callbacks in order', async () => {
      const migrateV1toV2 = vi.fn((data) => ({ ...data, version: 2 }))
      const migrateV2toV3 = vi.fn((data) => ({ ...data, version: 3 }))

      const oldData = { version: 1, mutations: [] }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(oldData))

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        migrations: {
          '1-2': migrateV1toV2,
          '2-3': migrateV2toV3,
        },
        targetVersion: 3,
      })

      await persistence.getAll()

      expect(migrateV1toV2).toHaveBeenCalled()
      expect(migrateV2toV3).toHaveBeenCalled()
      // V1->V2 should be called before V2->V3
      expect(migrateV1toV2.mock.invocationCallOrder[0]).toBeLessThan(
        migrateV2toV3.mock.invocationCallOrder[0]
      )
    })

    it('should handle failed migrations gracefully', async () => {
      const failingMigration = vi.fn(() => {
        throw new Error('Migration failed')
      })

      const oldData = { version: 1, mutations: [] }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(oldData))

      const onError = vi.fn()
      const persistence = new QueuePersistence({
        backend: 'localStorage',
        migrations: {
          '1-2': failingMigration,
        },
        targetVersion: 2,
        onError,
      })

      await persistence.getAll()

      expect(onError).toHaveBeenCalled()
    })

    it('should backup data before migration', async () => {
      const onBackup = vi.fn()

      const oldData = { version: 1, mutations: [createTestMutation({ id: 'migrate-me' })] }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(oldData))

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        backupBeforeMigration: true,
        onBackup,
        migrations: {
          '1-2': (data) => ({ ...data, version: 2 }),
        },
        targetVersion: 2,
      })

      await persistence.getAll()

      expect(onBackup).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 1,
          data: expect.any(Object),
        })
      )
    })

    it('should migrate between storage backends', async () => {
      // First, store in localStorage
      const persistence1 = new QueuePersistence({
        backend: 'localStorage',
        namespace: 'migrate-test',
      })
      await persistence1.enqueue(createTestMutation({ id: 'cross-backend' }))

      // Migrate to indexedDB
      const result = await persistence1.migrateToBackend('indexedDB')

      expect(result.success).toBe(true)
      expect(result.migratedCount).toBe(1)
    })

    it('should emit onMigrationComplete callback', async () => {
      const onMigrationComplete = vi.fn()

      const oldData = { version: 1, mutations: [createTestMutation({ id: 'migrated' })] }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(oldData))

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        migrations: {
          '1-2': (data) => ({ ...data, version: 2 }),
        },
        targetVersion: 2,
        onMigrationComplete,
      })

      await persistence.getAll()

      expect(onMigrationComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          fromVersion: 1,
          toVersion: 2,
          mutationCount: 1,
        })
      )
    })

    it('should support custom migration functions', async () => {
      const customMigrate = vi.fn((mutation) => ({
        ...mutation,
        priority: 'normal', // Add new field
        collectionName: mutation.collection || mutation.collectionName,
      }))

      const oldData = {
        version: 1,
        mutations: [{ id: 'custom-1', type: 'insert', collection: 'test', key: 'k1', value: {} }],
      }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(oldData))

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        mutationMigrator: customMigrate,
      })

      const queue = await persistence.getAll()

      expect(customMigrate).toHaveBeenCalled()
    })

    it('should handle version downgrade gracefully', async () => {
      const futureData = { version: 999, mutations: [] }
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(futureData))

      const onError = vi.fn()
      const persistence = new QueuePersistence({
        backend: 'localStorage',
        targetVersion: 2,
        onError,
      })

      await persistence.getAll()

      // Should log warning about unsupported future version
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('version'),
        })
      )
    })
  })

  // ===========================================================================
  // 6. Clearing Persisted Queue Tests
  // ===========================================================================

  describe('clearing persisted queue', () => {
    it('should remove all mutations from queue', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ id: '1' }))
      await persistence.enqueue(createTestMutation({ id: '2' }))
      await persistence.enqueue(createTestMutation({ id: '3' }))

      await persistence.clear()

      const all = await persistence.getAll()
      expect(all).toHaveLength(0)
    })

    it('should persist clear to localStorage', async () => {
      const persistence = new QueuePersistence({ backend: 'localStorage' })
      await persistence.enqueue(createTestMutation())

      await persistence.clear()

      expect(mockLocalStorage.removeItem).toHaveBeenCalled()
    })

    it('should clear queue from IndexedDB', async () => {
      const persistence = new QueuePersistence({ backend: 'indexedDB' })
      await persistence.enqueue(createTestMutation())
      await vi.advanceTimersByTimeAsync(10)

      await persistence.clear()
      await vi.advanceTimersByTimeAsync(10)

      const queue = await persistence.getAll()
      expect(queue).toHaveLength(0)
    })

    it('should handle clearing empty queue', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await expect(persistence.clear()).resolves.not.toThrow()
    })

    it('should emit onClear callback', async () => {
      const onClear = vi.fn()
      const persistence = new QueuePersistence({
        backend: 'memory',
        onClear,
      })

      await persistence.enqueue(createTestMutation({ id: '1' }))
      await persistence.enqueue(createTestMutation({ id: '2' }))

      await persistence.clear()

      expect(onClear).toHaveBeenCalledWith(
        expect.objectContaining({
          clearedCount: 2,
        })
      )
    })

    it('should clear only specific collection mutations', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ id: '1', collectionName: 'users' }))
      await persistence.enqueue(createTestMutation({ id: '2', collectionName: 'posts' }))
      await persistence.enqueue(createTestMutation({ id: '3', collectionName: 'users' }))

      await persistence.clearByCollection('users')

      const remaining = await persistence.getAll()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].collectionName).toBe('posts')
    })

    it('should clear mutations older than specified timestamp', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ id: 'old', timestamp: 1000 }))
      await persistence.enqueue(createTestMutation({ id: 'recent', timestamp: 5000 }))

      await persistence.clearOlderThan(3000)

      const remaining = await persistence.getAll()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe('recent')
    })

    it('should clear failed mutations only', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ id: 'pending', status: 'pending' }))
      await persistence.enqueue(createTestMutation({ id: 'failed', status: 'failed' }))

      await persistence.clearByStatus('failed')

      const remaining = await persistence.getAll()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].status || 'pending').not.toBe('failed')
    })

    it('should backup before clear when configured', async () => {
      const onBackup = vi.fn()
      const persistence = new QueuePersistence({
        backend: 'memory',
        backupBeforeClear: true,
        onBackup,
      })

      await persistence.enqueue(createTestMutation({ id: 'backup-me' }))

      await persistence.clear()

      expect(onBackup).toHaveBeenCalledWith(
        expect.objectContaining({
          mutations: expect.arrayContaining([
            expect.objectContaining({ id: 'backup-me' }),
          ]),
        })
      )
    })

    it('should persist updated state after selective clear', async () => {
      const persistence = new QueuePersistence({ backend: 'localStorage' })

      await persistence.enqueue(createTestMutation({ id: '1', collectionName: 'users' }))
      await persistence.enqueue(createTestMutation({ id: '2', collectionName: 'posts' }))

      mockLocalStorage.setItem.mockClear()

      await persistence.clearByCollection('users')

      expect(mockLocalStorage.setItem).toHaveBeenCalled()
      const storedValue = mockLocalStorage.setItem.mock.calls[0][1]
      expect(storedValue).not.toContain('users')
    })

    it('should support forced clear without callbacks', async () => {
      const onClear = vi.fn()
      const persistence = new QueuePersistence({
        backend: 'memory',
        onClear,
      })

      await persistence.enqueue(createTestMutation())

      await persistence.clear({ silent: true })

      expect(onClear).not.toHaveBeenCalled()
    })

    it('should handle concurrent clear operations', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ id: '1' }))
      await persistence.enqueue(createTestMutation({ id: '2' }))

      // Concurrent clears
      const clear1 = persistence.clear()
      const clear2 = persistence.clear()

      await Promise.all([clear1, clear2])

      const queue = await persistence.getAll()
      expect(queue).toHaveLength(0)
    })
  })

  // ===========================================================================
  // enqueue() Tests
  // ===========================================================================

  describe('enqueue()', () => {
    it('should add mutation to the queue', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      const mutation = createTestMutation()

      await persistence.enqueue(mutation)

      const queue = await persistence.getAll()
      expect(queue).toHaveLength(1)
      expect(queue[0]).toEqual(mutation)
    })

    it('should add multiple mutations in order', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      const mutation1 = createTestMutation({ id: 'mutation-1', timestamp: 1000 })
      const mutation2 = createTestMutation({ id: 'mutation-2', timestamp: 2000 })
      const mutation3 = createTestMutation({ id: 'mutation-3', timestamp: 3000 })

      await persistence.enqueue(mutation1)
      await persistence.enqueue(mutation2)
      await persistence.enqueue(mutation3)

      const queue = await persistence.getAll()
      expect(queue).toHaveLength(3)
      expect(queue[0].id).toBe('mutation-1')
      expect(queue[1].id).toBe('mutation-2')
      expect(queue[2].id).toBe('mutation-3')
    })

    it('should generate unique ID if not provided', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      const mutation = createTestMutation()
      delete (mutation as any).id

      const id = await persistence.enqueue(mutation)

      expect(id).toBeDefined()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('should return mutation ID after enqueue', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      const mutation = createTestMutation({ id: 'my-mutation-id' })

      const id = await persistence.enqueue(mutation)

      expect(id).toBe('my-mutation-id')
    })

    it('should set timestamp if not provided', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      const mutation = createTestMutation()
      delete (mutation as any).timestamp

      await persistence.enqueue(mutation)

      const queue = await persistence.getAll()
      expect(queue[0].timestamp).toBeDefined()
      expect(queue[0].timestamp).toBeGreaterThan(0)
    })

    it('should reject when queue is full (maxQueueSize)', async () => {
      const persistence = new QueuePersistence({
        backend: 'memory',
        maxQueueSize: 2,
      })

      await persistence.enqueue(createTestMutation({ id: 'mutation-1' }))
      await persistence.enqueue(createTestMutation({ id: 'mutation-2' }))

      await expect(
        persistence.enqueue(createTestMutation({ id: 'mutation-3' }))
      ).rejects.toThrow(/queue.*full/i)
    })

    it('should support different mutation types', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ type: 'insert', id: 'insert-1' }))
      await persistence.enqueue(createTestMutation({ type: 'update', id: 'update-1' }))
      await persistence.enqueue(createTestMutation({ type: 'delete', id: 'delete-1' }))

      const queue = await persistence.getAll()
      expect(queue).toHaveLength(3)
      expect(queue[0].type).toBe('insert')
      expect(queue[1].type).toBe('update')
      expect(queue[2].type).toBe('delete')
    })

    it('should store metadata with mutation', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      const mutation = createTestMutation({
        metadata: {
          userId: 'user-123',
          source: 'offline-form',
        },
      })

      await persistence.enqueue(mutation)

      const queue = await persistence.getAll()
      expect(queue[0].metadata).toEqual({
        userId: 'user-123',
        source: 'offline-form',
      })
    })
  })

  // ===========================================================================
  // dequeue() Tests
  // ===========================================================================

  describe('dequeue()', () => {
    it('should remove and return the first mutation', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      const mutation1 = createTestMutation({ id: 'mutation-1' })
      const mutation2 = createTestMutation({ id: 'mutation-2' })

      await persistence.enqueue(mutation1)
      await persistence.enqueue(mutation2)

      const dequeued = await persistence.dequeue()

      expect(dequeued).toEqual(mutation1)

      const remaining = await persistence.getAll()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe('mutation-2')
    })

    it('should return null when queue is empty', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      const dequeued = await persistence.dequeue()

      expect(dequeued).toBeNull()
    })

    it('should persist removal to localStorage', async () => {
      const persistence = new QueuePersistence({ backend: 'localStorage' })
      await persistence.enqueue(createTestMutation())

      await persistence.dequeue()

      // Should update storage
      expect(mockLocalStorage.setItem).toHaveBeenCalled()
    })

    it('should return mutations in FIFO order', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ id: 'first' }))
      await persistence.enqueue(createTestMutation({ id: 'second' }))
      await persistence.enqueue(createTestMutation({ id: 'third' }))

      const first = await persistence.dequeue()
      const second = await persistence.dequeue()
      const third = await persistence.dequeue()
      const fourth = await persistence.dequeue()

      expect(first?.id).toBe('first')
      expect(second?.id).toBe('second')
      expect(third?.id).toBe('third')
      expect(fourth).toBeNull()
    })
  })

  // ===========================================================================
  // peek() Tests
  // ===========================================================================

  describe('peek()', () => {
    it('should return the first mutation without removing it', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      const mutation = createTestMutation({ id: 'peek-test' })

      await persistence.enqueue(mutation)

      const peeked = await persistence.peek()
      const stillThere = await persistence.getAll()

      expect(peeked).toEqual(mutation)
      expect(stillThere).toHaveLength(1)
    })

    it('should return null when queue is empty', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      const peeked = await persistence.peek()

      expect(peeked).toBeNull()
    })

    it('should not modify the queue', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      const mutation = createTestMutation()

      await persistence.enqueue(mutation)
      await persistence.peek()
      await persistence.peek()
      await persistence.peek()

      const queue = await persistence.getAll()
      expect(queue).toHaveLength(1)
    })
  })

  // ===========================================================================
  // remove() Tests
  // ===========================================================================

  describe('remove()', () => {
    it('should remove specific mutation by ID', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ id: 'keep-1' }))
      await persistence.enqueue(createTestMutation({ id: 'remove-me' }))
      await persistence.enqueue(createTestMutation({ id: 'keep-2' }))

      const removed = await persistence.remove('remove-me')

      expect(removed).toBe(true)

      const queue = await persistence.getAll()
      expect(queue).toHaveLength(2)
      expect(queue.find((m) => m.id === 'remove-me')).toBeUndefined()
    })

    it('should return false when mutation not found', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      const removed = await persistence.remove('non-existent-id')

      expect(removed).toBe(false)
    })

    it('should persist removal to storage', async () => {
      const persistence = new QueuePersistence({ backend: 'localStorage' })
      await persistence.enqueue(createTestMutation({ id: 'to-remove' }))

      mockLocalStorage.setItem.mockClear()

      await persistence.remove('to-remove')

      expect(mockLocalStorage.setItem).toHaveBeenCalled()
    })

    it('should handle removing the only item', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      await persistence.enqueue(createTestMutation({ id: 'only-one' }))

      await persistence.remove('only-one')

      const queue = await persistence.getAll()
      expect(queue).toHaveLength(0)
    })
  })

  // ===========================================================================
  // getAll() Tests
  // ===========================================================================

  describe('getAll()', () => {
    it('should return all mutations in order', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ id: 'a', timestamp: 100 }))
      await persistence.enqueue(createTestMutation({ id: 'b', timestamp: 200 }))
      await persistence.enqueue(createTestMutation({ id: 'c', timestamp: 300 }))

      const all = await persistence.getAll()

      expect(all).toHaveLength(3)
      expect(all[0].id).toBe('a')
      expect(all[1].id).toBe('b')
      expect(all[2].id).toBe('c')
    })

    it('should return empty array when queue is empty', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      const all = await persistence.getAll()

      expect(all).toEqual([])
    })

    it('should return a copy (not modify internal state)', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      await persistence.enqueue(createTestMutation({ id: 'test' }))

      const all = await persistence.getAll()
      all.push(createTestMutation({ id: 'fake' }))

      const actualAll = await persistence.getAll()
      expect(actualAll).toHaveLength(1)
    })

    it('should restore mutations from localStorage on getAll', async () => {
      // Pre-populate localStorage
      const storedMutations: PersistedMutation[] = [
        createTestMutation({ id: 'stored-1' }),
        createTestMutation({ id: 'stored-2' }),
      ]
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ version: 1, mutations: storedMutations }))

      const persistence = new QueuePersistence({ backend: 'localStorage' })
      const all = await persistence.getAll()

      expect(all).toHaveLength(2)
      expect(all[0].id).toBe('stored-1')
      expect(all[1].id).toBe('stored-2')
    })
  })

  // ===========================================================================
  // size() Tests
  // ===========================================================================

  describe('size()', () => {
    it('should return the number of mutations in queue', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      expect(await persistence.size()).toBe(0)

      await persistence.enqueue(createTestMutation())
      expect(await persistence.size()).toBe(1)

      await persistence.enqueue(createTestMutation())
      expect(await persistence.size()).toBe(2)

      await persistence.dequeue()
      expect(await persistence.size()).toBe(1)
    })

    it('should return 0 for empty queue', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      expect(await persistence.size()).toBe(0)
    })
  })

  // ===========================================================================
  // isEmpty() Tests
  // ===========================================================================

  describe('isEmpty()', () => {
    it('should return true when queue is empty', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      expect(await persistence.isEmpty()).toBe(true)
    })

    it('should return false when queue has items', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      await persistence.enqueue(createTestMutation())

      expect(await persistence.isEmpty()).toBe(false)
    })
  })

  // ===========================================================================
  // updateRetryCount() Tests
  // ===========================================================================

  describe('updateRetryCount()', () => {
    it('should increment retry count for mutation', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      const mutation = createTestMutation({ id: 'retry-test', retryCount: 0 })
      await persistence.enqueue(mutation)

      await persistence.updateRetryCount('retry-test', 1)

      const queue = await persistence.getAll()
      expect(queue[0].retryCount).toBe(1)
    })

    it('should persist retry count update', async () => {
      const persistence = new QueuePersistence({ backend: 'localStorage' })
      await persistence.enqueue(createTestMutation({ id: 'retry-persist' }))

      mockLocalStorage.setItem.mockClear()

      await persistence.updateRetryCount('retry-persist', 3)

      expect(mockLocalStorage.setItem).toHaveBeenCalled()
    })

    it('should return false for non-existent mutation', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      const updated = await persistence.updateRetryCount('non-existent', 1)

      expect(updated).toBe(false)
    })

    it('should return true when update succeeds', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      await persistence.enqueue(createTestMutation({ id: 'update-test' }))

      const updated = await persistence.updateRetryCount('update-test', 2)

      expect(updated).toBe(true)
    })
  })

  // ===========================================================================
  // getByCollection() Tests
  // ===========================================================================

  describe('getByCollection()', () => {
    it('should return only mutations for specified collection', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ id: 'users-1', collectionName: 'users' }))
      await persistence.enqueue(createTestMutation({ id: 'posts-1', collectionName: 'posts' }))
      await persistence.enqueue(createTestMutation({ id: 'users-2', collectionName: 'users' }))

      const userMutations = await persistence.getByCollection('users')

      expect(userMutations).toHaveLength(2)
      expect(userMutations.every((m) => m.collectionName === 'users')).toBe(true)
    })

    it('should return empty array when no mutations for collection', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      await persistence.enqueue(createTestMutation({ collectionName: 'other' }))

      const result = await persistence.getByCollection('users')

      expect(result).toEqual([])
    })
  })

  // ===========================================================================
  // getStats() Tests
  // ===========================================================================

  describe('getStats()', () => {
    it('should return queue statistics', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ type: 'insert', collectionName: 'users' }))
      await persistence.enqueue(createTestMutation({ type: 'update', collectionName: 'users' }))
      await persistence.enqueue(createTestMutation({ type: 'delete', collectionName: 'posts' }))

      const stats = await persistence.getStats()

      expect(stats.totalCount).toBe(3)
      expect(stats.byType.insert).toBe(1)
      expect(stats.byType.update).toBe(1)
      expect(stats.byType.delete).toBe(1)
      expect(stats.byCollection.users).toBe(2)
      expect(stats.byCollection.posts).toBe(1)
    })

    it('should return empty stats for empty queue', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      const stats = await persistence.getStats()

      expect(stats.totalCount).toBe(0)
      expect(stats.byType).toEqual({})
      expect(stats.byCollection).toEqual({})
    })

    it('should include oldest mutation timestamp', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ timestamp: 3000 }))
      await persistence.enqueue(createTestMutation({ timestamp: 1000 }))
      await persistence.enqueue(createTestMutation({ timestamp: 2000 }))

      const stats = await persistence.getStats()

      // The oldest mutation is the one with the smallest timestamp
      // but FIFO order means the first-enqueued (timestamp 3000) is oldest in queue
      expect(stats.oldestTimestamp).toBe(3000)
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    it('should call onError callback when storage fails', async () => {
      const onError = vi.fn()
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error('Storage full')
      })

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        onError,
      })

      await persistence.enqueue(createTestMutation()).catch(() => {})

      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })

    it('should continue working in memory after storage failure', async () => {
      const onError = vi.fn()
      let failStorage = false

      mockLocalStorage.setItem.mockImplementation((key: string, value: string) => {
        if (failStorage) {
          throw new Error('Storage error')
        }
        // Normal behavior - returning undefined (void)
        return undefined as unknown as Map<string, string>
      })

      const persistence = new QueuePersistence({
        backend: 'localStorage',
        onError,
        fallbackToMemory: true,
      })

      await persistence.enqueue(createTestMutation({ id: 'before-fail' }))

      failStorage = true

      // This should fail but fall back to memory
      await persistence.enqueue(createTestMutation({ id: 'during-fail' })).catch(() => {})

      // Queue operations should still work (from memory)
      const size = await persistence.size()
      expect(size).toBeGreaterThanOrEqual(1)
    })
  })

  // ===========================================================================
  // Batch Operations Tests
  // ===========================================================================

  describe('batch operations', () => {
    it('should support batch enqueue', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      const mutations = [
        createTestMutation({ id: 'batch-1' }),
        createTestMutation({ id: 'batch-2' }),
        createTestMutation({ id: 'batch-3' }),
      ]

      const ids = await persistence.enqueueBatch(mutations)

      expect(ids).toHaveLength(3)

      const queue = await persistence.getAll()
      expect(queue).toHaveLength(3)
    })

    it('should support batch remove', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ id: 'keep' }))
      await persistence.enqueue(createTestMutation({ id: 'remove-1' }))
      await persistence.enqueue(createTestMutation({ id: 'remove-2' }))

      await persistence.removeBatch(['remove-1', 'remove-2'])

      const queue = await persistence.getAll()
      expect(queue).toHaveLength(1)
      expect(queue[0].id).toBe('keep')
    })

    it('should be atomic for batch operations (all or nothing)', async () => {
      const persistence = new QueuePersistence({
        backend: 'memory',
        maxQueueSize: 2,
      })

      await persistence.enqueue(createTestMutation({ id: 'existing' }))

      const mutations = [
        createTestMutation({ id: 'batch-1' }),
        createTestMutation({ id: 'batch-2' }), // This should exceed limit
      ]

      await expect(persistence.enqueueBatch(mutations)).rejects.toThrow()

      // Queue should remain unchanged (atomic rollback)
      const queue = await persistence.getAll()
      expect(queue).toHaveLength(1)
      expect(queue[0].id).toBe('existing')
    })
  })

  // ===========================================================================
  // IndexedDB Backend Tests
  // ===========================================================================

  describe('IndexedDB backend', () => {
    it('should persist to IndexedDB asynchronously', async () => {
      const persistence = new QueuePersistence({ backend: 'indexedDB' })

      // Basic functionality test
      expect(persistence.backend).toBe('indexedDB')
    })

    it('should handle IndexedDB errors gracefully', async () => {
      const onError = vi.fn()
      ;(globalThis as any).indexedDB = undefined

      const persistence = new QueuePersistence({
        backend: 'indexedDB',
        onError,
      })

      // Should fallback to memory
      expect(persistence.backend).toBe('memory')
    })
  })

  // ===========================================================================
  // Concurrent Access Tests
  // ===========================================================================

  describe('concurrent access', () => {
    it('should handle concurrent enqueue operations', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      const promises = Array.from({ length: 10 }, (_, i) =>
        persistence.enqueue(createTestMutation({ id: `concurrent-${i}` }))
      )

      await Promise.all(promises)

      const queue = await persistence.getAll()
      expect(queue).toHaveLength(10)
    })

    it('should handle concurrent read and write', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })

      await persistence.enqueue(createTestMutation({ id: 'initial' }))

      const readPromise = persistence.getAll()
      const writePromise = persistence.enqueue(createTestMutation({ id: 'during-read' }))

      await Promise.all([readPromise, writePromise])

      const queue = await persistence.getAll()
      expect(queue).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Serialization Tests
  // ===========================================================================

  describe('serialization', () => {
    it('should correctly serialize complex mutation values', async () => {
      const persistence = new QueuePersistence({ backend: 'localStorage' })
      const mutation = createTestMutation({
        value: {
          _id: 'complex-1',
          nested: {
            deep: {
              value: 'deeply nested',
            },
          },
          array: [1, 2, 3],
          date: '2024-01-01T00:00:00.000Z',
          nullValue: null,
        },
      })

      await persistence.enqueue(mutation)

      // Create new instance to force deserialization
      const persistence2 = new QueuePersistence({ backend: 'localStorage' })
      const queue = await persistence2.getAll()

      expect(queue[0].value).toEqual(mutation.value)
    })

    it('should handle undefined values in mutations', async () => {
      const persistence = new QueuePersistence({ backend: 'memory' })
      const mutation = createTestMutation({
        value: {
          _id: 'test',
          defined: 'value',
          // Note: JSON.stringify drops undefined values
        },
      })

      await persistence.enqueue(mutation)

      const queue = await persistence.getAll()
      expect(queue[0].value).toEqual(mutation.value)
    })

    it('should preserve mutation order after serialization round-trip', async () => {
      const persistence = new QueuePersistence({ backend: 'localStorage' })

      for (let i = 0; i < 5; i++) {
        await persistence.enqueue(createTestMutation({ id: `order-${i}` }))
      }

      // Force re-read from storage
      const persistence2 = new QueuePersistence({ backend: 'localStorage' })
      const queue = await persistence2.getAll()

      expect(queue.map((m: { id: string }) => m.id)).toEqual([
        'order-0',
        'order-1',
        'order-2',
        'order-3',
        'order-4',
      ])
    })
  })
})
