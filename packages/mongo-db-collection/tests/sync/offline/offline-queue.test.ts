/**
 * Offline Queue Tests (RED Phase - TDD)
 *
 * These tests verify the OfflineQueue class for Layer 10 Offline Support.
 * The OfflineQueue is responsible for:
 * 1. Storing mutations when the device is offline
 * 2. Persisting queued mutations to survive app restarts
 * 3. Replaying mutations when back online
 * 4. Handling conflicts and errors during replay
 * 5. Tracking queue state and statistics
 * 6. Priority-based queue processing
 * 7. Batch processing for efficiency
 *
 * RED PHASE: These tests will fail until OfflineQueue is implemented
 * in src/sync/offline/offline-queue.ts
 *
 * Bead ID: tanstackdb-po0.150
 *
 * @see https://tanstack.com/db/latest/docs/offline
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  OfflineQueue,
  createOfflineQueue,
  type OfflineQueueConfig,
  type QueuedMutation,
  type MutationPriority,
  type QueueProcessingOptions,
  type BatchProcessResult,
} from '../../../src/sync/offline/offline-queue'
import type { ChangeMessage } from '../../../src/types'

// Test document type
interface TestDocument {
  _id: string
  name: string
  value: number
  updatedAt?: Date
}

// Mock storage for testing persistence
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

// Mock network status provider
interface NetworkStatus {
  isOnline: boolean
  onStatusChange: (callback: (online: boolean) => void) => () => void
}

function createMockNetworkStatus(initialOnline = true): NetworkStatus & { setOnline: (online: boolean) => void } {
  const listeners: Set<(online: boolean) => void> = new Set()
  let isOnline = initialOnline

  return {
    get isOnline() {
      return isOnline
    },
    onStatusChange: (callback: (online: boolean) => void) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    setOnline: (online: boolean) => {
      isOnline = online
      listeners.forEach((cb) => cb(online))
    },
  }
}

describe('OfflineQueue', () => {
  let mockStorage: MockStorage
  let mockNetworkStatus: ReturnType<typeof createMockNetworkStatus>

  beforeEach(() => {
    vi.useFakeTimers()
    mockStorage = new MockStorage()
    mockNetworkStatus = createMockNetworkStatus(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mockStorage.clear()
  })

  describe('construction and configuration', () => {
    it('should create queue with default configuration', () => {
      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
      })

      expect(queue).toBeInstanceOf(OfflineQueue)
    })

    it('should create queue with custom configuration', () => {
      const config: OfflineQueueConfig<TestDocument> = {
        collectionId: 'test-collection',
        storage: mockStorage,
        networkStatus: mockNetworkStatus,
        maxQueueSize: 500,
        retryAttempts: 5,
        retryDelayMs: 2000,
      }

      const queue = new OfflineQueue<TestDocument>(config)

      expect(queue).toBeInstanceOf(OfflineQueue)
      expect(queue.maxQueueSize).toBe(500)
      expect(queue.retryAttempts).toBe(5)
      expect(queue.retryDelayMs).toBe(2000)
    })

    it('should have sensible default configuration values', () => {
      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
      })

      expect(queue.maxQueueSize).toBe(1000) // Default max queue size
      expect(queue.retryAttempts).toBe(3) // Default retry attempts
      expect(queue.retryDelayMs).toBe(1000) // Default retry delay
    })

    it('should require collectionId in config', () => {
      expect(
        () =>
          new OfflineQueue<TestDocument>({
            collectionId: '',
          })
      ).toThrow(/collectionId/i)
    })

    it('should reject invalid maxQueueSize (zero or negative)', () => {
      expect(
        () =>
          new OfflineQueue<TestDocument>({
            collectionId: 'test',
            maxQueueSize: 0,
          })
      ).toThrow(/maxQueueSize/i)

      expect(
        () =>
          new OfflineQueue<TestDocument>({
            collectionId: 'test',
            maxQueueSize: -10,
          })
      ).toThrow(/maxQueueSize/i)
    })

    it('should reject invalid retryAttempts (negative)', () => {
      expect(
        () =>
          new OfflineQueue<TestDocument>({
            collectionId: 'test',
            retryAttempts: -1,
          })
      ).toThrow(/retryAttempts/i)
    })
  })

  describe('enqueue mutations when offline', () => {
    it('should enqueue mutation when offline', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      const mutation: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      }

      await queue.enqueue(mutation)

      expect(queue.length).toBe(1)
      expect(queue.isEmpty).toBe(false)
    })

    it('should preserve mutation order (FIFO)', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      const mutation1: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'First', value: 1 },
      }
      const mutation2: ChangeMessage<TestDocument> = {
        type: 'update',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Second', value: 2 },
      }
      const mutation3: ChangeMessage<TestDocument> = {
        type: 'delete',
        key: 'doc-3',
        value: { _id: 'doc-3', name: 'Third', value: 3 },
      }

      await queue.enqueue(mutation1)
      await queue.enqueue(mutation2)
      await queue.enqueue(mutation3)

      const queued = queue.getAll()

      expect(queued).toHaveLength(3)
      expect(queued[0].mutation.key).toBe('doc-1')
      expect(queued[1].mutation.key).toBe('doc-2')
      expect(queued[2].mutation.key).toBe('doc-3')
    })

    it('should assign unique IDs to queued mutations', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      const mutation: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      }

      await queue.enqueue(mutation)
      await queue.enqueue(mutation) // Same mutation, different queue entry

      const queued = queue.getAll()

      expect(queued[0].id).toBeDefined()
      expect(queued[1].id).toBeDefined()
      expect(queued[0].id).not.toBe(queued[1].id)
    })

    it('should record timestamp when mutation is enqueued', async () => {
      mockNetworkStatus.setOnline(false)
      const now = new Date('2025-01-05T12:00:00Z')
      vi.setSystemTime(now)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      const mutation: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      }

      await queue.enqueue(mutation)

      const queued = queue.getAll()

      expect(queued[0].timestamp).toEqual(now)
    })

    it('should reject mutations when queue is full', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        maxQueueSize: 2,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'First', value: 1 },
      })
      await queue.enqueue({
        type: 'insert',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Second', value: 2 },
      })

      await expect(
        queue.enqueue({
          type: 'insert',
          key: 'doc-3',
          value: { _id: 'doc-3', name: 'Third', value: 3 },
        })
      ).rejects.toThrow(/queue.*full/i)
    })

    it('should not enqueue mutations when online by default', async () => {
      mockNetworkStatus.setOnline(true)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      const mutation: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      }

      // When online, mutation should be processed immediately, not queued
      const result = await queue.enqueue(mutation)

      expect(result.queued).toBe(false)
      expect(queue.isEmpty).toBe(true)
    })

    it('should optionally force-queue mutations even when online', async () => {
      mockNetworkStatus.setOnline(true)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      const mutation: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      }

      const result = await queue.enqueue(mutation, { forceQueue: true })

      expect(result.queued).toBe(true)
      expect(queue.length).toBe(1)
    })
  })

  describe('persistence', () => {
    it('should persist queued mutations to storage', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        storage: mockStorage,
        networkStatus: mockNetworkStatus,
      })

      const mutation: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      }

      await queue.enqueue(mutation)

      // Verify storage was called
      const stored = await mockStorage.getItem('offline-queue:test-collection')
      expect(stored).toBeDefined()

      const parsed = JSON.parse(stored!)
      expect(parsed.mutations).toHaveLength(1)
      expect(parsed.mutations[0].mutation.key).toBe('doc-1')
    })

    it('should restore queued mutations from storage on initialization', async () => {
      // Pre-populate storage
      const storedData = {
        version: 1,
        mutations: [
          {
            id: 'mut-1',
            mutation: {
              type: 'insert',
              key: 'doc-1',
              value: { _id: 'doc-1', name: 'Stored', value: 100 },
            },
            timestamp: '2025-01-05T10:00:00Z',
            status: 'pending',
          },
        ],
      }
      await mockStorage.setItem('offline-queue:test-collection', JSON.stringify(storedData))

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        storage: mockStorage,
        networkStatus: mockNetworkStatus,
      })

      await queue.initialize()

      expect(queue.length).toBe(1)
      expect(queue.getAll()[0].mutation.key).toBe('doc-1')
    })

    it('should handle corrupted storage data gracefully', async () => {
      await mockStorage.setItem('offline-queue:test-collection', 'not valid json')

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        storage: mockStorage,
        networkStatus: mockNetworkStatus,
      })

      // Should not throw
      await expect(queue.initialize()).resolves.not.toThrow()

      // Queue should be empty but functional
      expect(queue.length).toBe(0)
    })

    it('should clear storage when queue is cleared', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        storage: mockStorage,
        networkStatus: mockNetworkStatus,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      expect(queue.length).toBe(1)

      await queue.clear()

      expect(queue.length).toBe(0)

      const stored = await mockStorage.getItem('offline-queue:test-collection')
      expect(stored).toBeNull()
    })
  })

  describe('replay mutations when online', () => {
    it('should replay queued mutations when coming back online', async () => {
      mockNetworkStatus.setOnline(false)

      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      expect(queue.length).toBe(1)

      // Come back online
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(replayHandler).toHaveBeenCalledTimes(1)
      expect(replayHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          mutation: expect.objectContaining({ key: 'doc-1' }),
        })
      )
    })

    it('should replay mutations in order', async () => {
      mockNetworkStatus.setOnline(false)

      const replayOrder: string[] = []
      const replayHandler = vi.fn().mockImplementation(async (queuedMutation: QueuedMutation<TestDocument>) => {
        replayOrder.push(queuedMutation.mutation.key)
        return { success: true }
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'First', value: 1 },
      })
      await queue.enqueue({
        type: 'update',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Second', value: 2 },
      })
      await queue.enqueue({
        type: 'delete',
        key: 'doc-3',
        value: { _id: 'doc-3', name: 'Third', value: 3 },
      })

      // Come back online
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(replayOrder).toEqual(['doc-1', 'doc-2', 'doc-3'])
    })

    it('should remove successfully replayed mutations from queue', async () => {
      mockNetworkStatus.setOnline(false)

      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      expect(queue.length).toBe(1)

      // Come back online
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(queue.length).toBe(0)
      expect(queue.isEmpty).toBe(true)
    })

    it('should trigger manual replay', async () => {
      mockNetworkStatus.setOnline(false)

      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      // Stay offline but trigger manual replay
      await queue.replay()

      expect(replayHandler).toHaveBeenCalledTimes(1)
    })
  })

  describe('retry logic', () => {
    it('should retry failed mutations up to configured attempts', async () => {
      mockNetworkStatus.setOnline(false)

      let attemptCount = 0
      const replayHandler = vi.fn().mockImplementation(async () => {
        attemptCount++
        if (attemptCount < 3) {
          return { success: false, error: new Error('Network error') }
        }
        return { success: true }
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        retryAttempts: 3,
        retryDelayMs: 100,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      // Come back online
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0) // First attempt

      expect(replayHandler).toHaveBeenCalledTimes(1)
      expect(queue.length).toBe(1) // Still in queue

      await vi.advanceTimersByTimeAsync(100) // Second attempt after retry delay
      expect(replayHandler).toHaveBeenCalledTimes(2)
      expect(queue.length).toBe(1) // Still in queue

      await vi.advanceTimersByTimeAsync(100) // Third attempt
      expect(replayHandler).toHaveBeenCalledTimes(3)
      expect(queue.length).toBe(0) // Success, removed from queue
    })

    it('should mark mutation as failed after exhausting retries', async () => {
      mockNetworkStatus.setOnline(false)

      const replayHandler = vi.fn().mockResolvedValue({
        success: false,
        error: new Error('Permanent failure'),
      })

      const onFailure = vi.fn()

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        onFailure,
        retryAttempts: 2,
        retryDelayMs: 100,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      // Come back online
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0) // First attempt
      await vi.advanceTimersByTimeAsync(100) // Second attempt

      expect(replayHandler).toHaveBeenCalledTimes(2)
      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          mutation: expect.objectContaining({ key: 'doc-1' }),
        }),
        expect.any(Error)
      )
    })

    it('should track retry attempts per mutation', async () => {
      mockNetworkStatus.setOnline(false)

      const replayHandler = vi.fn().mockResolvedValue({
        success: false,
        error: new Error('Network error'),
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        retryAttempts: 3,
        retryDelayMs: 100,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      // Come back online
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      const queued = queue.getAll()
      expect(queued[0].attempts).toBe(1)

      await vi.advanceTimersByTimeAsync(100)

      const queuedAfter = queue.getAll()
      expect(queuedAfter[0].attempts).toBe(2)
    })

    it('should use exponential backoff for retries when configured', async () => {
      mockNetworkStatus.setOnline(false)

      const replayTimestamps: number[] = []
      const replayHandler = vi.fn().mockImplementation(async () => {
        replayTimestamps.push(Date.now())
        return { success: false, error: new Error('Network error') }
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        retryAttempts: 4,
        retryDelayMs: 100,
        useExponentialBackoff: true,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      // Come back online
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0) // Attempt 1 at 0
      await vi.advanceTimersByTimeAsync(100) // Attempt 2 at 100 (100 * 1)
      await vi.advanceTimersByTimeAsync(200) // Attempt 3 at 300 (100 * 2)
      await vi.advanceTimersByTimeAsync(400) // Attempt 4 at 700 (100 * 4)

      expect(replayHandler).toHaveBeenCalledTimes(4)
    })
  })

  describe('conflict handling', () => {
    it('should call conflict handler when replay returns conflict', async () => {
      mockNetworkStatus.setOnline(false)

      const conflictHandler = vi.fn().mockResolvedValue({
        resolved: { _id: 'doc-1', name: 'Resolved', value: 999 },
      })

      const serverVersion: TestDocument = { _id: 'doc-1', name: 'Server', value: 50 }

      const replayHandler = vi.fn().mockResolvedValue({
        success: false,
        conflict: true,
        serverVersion,
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        onConflict: conflictHandler,
      })

      await queue.enqueue({
        type: 'update',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Client', value: 42 },
      })

      // Come back online
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(conflictHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          mutation: expect.objectContaining({ key: 'doc-1' }),
        }),
        serverVersion
      )
    })

    it('should use resolved value from conflict handler', async () => {
      mockNetworkStatus.setOnline(false)

      const resolvedDoc: TestDocument = { _id: 'doc-1', name: 'Merged', value: 150 }

      const conflictHandler = vi.fn().mockResolvedValue({
        resolved: resolvedDoc,
      })

      let callCount = 0
      let finalMutation: ChangeMessage<TestDocument> | undefined
      const replayHandler = vi.fn().mockImplementation(async (queuedMutation: QueuedMutation<TestDocument>) => {
        callCount++
        if (callCount === 1) {
          // First call returns conflict
          return {
            success: false,
            conflict: true,
            serverVersion: { _id: 'doc-1', name: 'Server', value: 50 },
          }
        }
        // Second call after conflict resolution
        finalMutation = queuedMutation.mutation
        return { success: true }
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        onConflict: conflictHandler,
      })

      await queue.enqueue({
        type: 'update',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Client', value: 42 },
      })

      // Come back online
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(finalMutation?.value).toEqual(resolvedDoc)
    })
  })

  describe('queue state and statistics', () => {
    it('should track queue length', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      expect(queue.length).toBe(0)

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'First', value: 1 },
      })

      expect(queue.length).toBe(1)

      await queue.enqueue({
        type: 'insert',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Second', value: 2 },
      })

      expect(queue.length).toBe(2)
    })

    it('should report if queue is empty', async () => {
      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      expect(queue.isEmpty).toBe(true)

      mockNetworkStatus.setOnline(false)
      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      expect(queue.isEmpty).toBe(false)
    })

    it('should track pending, replaying, and failed counts', async () => {
      mockNetworkStatus.setOnline(false)

      const replayHandler = vi.fn().mockImplementation(async (queuedMutation: QueuedMutation<TestDocument>) => {
        if (queuedMutation.mutation.key === 'doc-2') {
          return { success: false, error: new Error('Failed') }
        }
        return { success: true }
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        retryAttempts: 1,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Success', value: 1 },
      })
      await queue.enqueue({
        type: 'insert',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Failure', value: 2 },
      })

      const statsBefore = queue.getStats()
      expect(statsBefore.pending).toBe(2)
      expect(statsBefore.failed).toBe(0)

      // Come back online
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      const statsAfter = queue.getStats()
      expect(statsAfter.pending).toBe(0)
      expect(statsAfter.failed).toBe(1)
      expect(statsAfter.replayed).toBe(1)
    })

    it('should track total mutations processed', async () => {
      mockNetworkStatus.setOnline(false)

      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'First', value: 1 },
      })
      await queue.enqueue({
        type: 'update',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Second', value: 2 },
      })

      // Come back online
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      const stats = queue.getStats()
      expect(stats.totalProcessed).toBe(2)
    })

    it('should reset statistics', async () => {
      mockNetworkStatus.setOnline(false)

      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(queue.getStats().totalProcessed).toBe(1)

      queue.resetStats()

      expect(queue.getStats().totalProcessed).toBe(0)
    })
  })

  describe('event callbacks', () => {
    it('should emit onEnqueue event', async () => {
      mockNetworkStatus.setOnline(false)

      const onEnqueue = vi.fn()

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onEnqueue,
      })

      const mutation: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      }

      await queue.enqueue(mutation)

      expect(onEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          mutation: expect.objectContaining({ key: 'doc-1' }),
        })
      )
    })

    it('should emit onReplayStart event', async () => {
      mockNetworkStatus.setOnline(false)

      const onReplayStart = vi.fn()
      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        onReplayStart,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(onReplayStart).toHaveBeenCalled()
    })

    it('should emit onReplayComplete event', async () => {
      mockNetworkStatus.setOnline(false)

      const onReplayComplete = vi.fn()
      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        onReplayComplete,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })
      await queue.enqueue({
        type: 'insert',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Test 2', value: 100 },
      })

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(onReplayComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          successful: 2,
          failed: 0,
        })
      )
    })

    it('should emit onQueueCleared event', async () => {
      mockNetworkStatus.setOnline(false)

      const onQueueCleared = vi.fn()

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onQueueCleared,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      await queue.clear()

      expect(onQueueCleared).toHaveBeenCalled()
    })
  })

  describe('disposal and cleanup', () => {
    it('should stop listening to network changes on dispose', async () => {
      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      // Manually set replay handler since it was not set in constructor
      ;(queue as any).config.onReplay = replayHandler

      mockNetworkStatus.setOnline(false)
      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      queue.dispose()

      // Coming online should not trigger replay
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(replayHandler).not.toHaveBeenCalled()
    })

    it('should persist queue before dispose when configured', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        storage: mockStorage,
        networkStatus: mockNetworkStatus,
        persistOnDispose: true,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      await queue.dispose()

      // Verify storage has the data
      const stored = await mockStorage.getItem('offline-queue:test-collection')
      expect(stored).toBeDefined()
    })

    it('should reject new operations after dispose', async () => {
      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      queue.dispose()

      await expect(
        queue.enqueue({
          type: 'insert',
          key: 'doc-1',
          value: { _id: 'doc-1', name: 'Test', value: 42 },
        })
      ).rejects.toThrow(/disposed/i)
    })
  })

  describe('query and inspection', () => {
    it('should get all queued mutations', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'First', value: 1 },
      })
      await queue.enqueue({
        type: 'update',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Second', value: 2 },
      })

      const all = queue.getAll()

      expect(all).toHaveLength(2)
      expect(all.map((m) => m.mutation.key)).toEqual(['doc-1', 'doc-2'])
    })

    it('should get mutation by ID', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      const queued = queue.getAll()
      const id = queued[0].id

      const found = queue.getById(id)

      expect(found).toBeDefined()
      expect(found?.mutation.key).toBe('doc-1')
    })

    it('should return undefined for non-existent ID', () => {
      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      const found = queue.getById('non-existent')

      expect(found).toBeUndefined()
    })

    it('should get mutations by document key', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'First', value: 1 },
      })
      await queue.enqueue({
        type: 'update',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Updated', value: 10 },
      })
      await queue.enqueue({
        type: 'insert',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Second', value: 2 },
      })

      const forDoc1 = queue.getByKey('doc-1')

      expect(forDoc1).toHaveLength(2)
      expect(forDoc1.map((m) => m.mutation.type)).toEqual(['insert', 'update'])
    })

    it('should remove specific mutation by ID', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'First', value: 1 },
      })
      await queue.enqueue({
        type: 'insert',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Second', value: 2 },
      })

      const queued = queue.getAll()
      const idToRemove = queued[0].id

      await queue.remove(idToRemove)

      expect(queue.length).toBe(1)
      expect(queue.getAll()[0].mutation.key).toBe('doc-2')
    })
  })

  // =========================================================================
  // dequeue() and peek() Tests
  // =========================================================================

  describe('dequeue operations', () => {
    it('should dequeue mutations in FIFO order', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'First', value: 1 },
      })
      await queue.enqueue({
        type: 'insert',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Second', value: 2 },
      })

      const first = await queue.dequeue()
      expect(first?.mutation.key).toBe('doc-1')
      expect(queue.length).toBe(1)

      const second = await queue.dequeue()
      expect(second?.mutation.key).toBe('doc-2')
      expect(queue.length).toBe(0)
    })

    it('should return null when dequeue from empty queue', async () => {
      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      const result = await queue.dequeue()
      expect(result).toBeNull()
    })

    it('should peek at next mutation without removing', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      const peeked = queue.peek()
      expect(peeked?.mutation.key).toBe('doc-1')
      expect(queue.length).toBe(1) // Still in queue

      const peekedAgain = queue.peek()
      expect(peekedAgain?.mutation.key).toBe('doc-1')
      expect(queue.length).toBe(1) // Still in queue
    })

    it('should return null when peek on empty queue', () => {
      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      const result = queue.peek()
      expect(result).toBeNull()
    })

    it('should update storage after dequeue', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        storage: mockStorage,
        networkStatus: mockNetworkStatus,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      await queue.dequeue()

      const stored = await mockStorage.getItem('offline-queue:test-collection')
      const parsed = JSON.parse(stored!)
      expect(parsed.mutations).toHaveLength(0)
    })
  })

  // =========================================================================
  // Storage Quota Handling Tests
  // =========================================================================

  describe('storage quota handling', () => {
    it('should handle storage quota exceeded error', async () => {
      mockNetworkStatus.setOnline(false)

      const failingStorage = {
        ...mockStorage,
        setItem: vi.fn().mockRejectedValue(new DOMException('QuotaExceededError')),
      }

      const onStorageError = vi.fn()

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        storage: failingStorage,
        networkStatus: mockNetworkStatus,
        onStorageError,
      })

      await expect(
        queue.enqueue({
          type: 'insert',
          key: 'doc-1',
          value: { _id: 'doc-1', name: 'Test', value: 42 },
        })
      ).rejects.toThrow(/quota/i)

      expect(onStorageError).toHaveBeenCalled()
    })

    it('should continue with in-memory queue on storage failure', async () => {
      mockNetworkStatus.setOnline(false)

      const failingStorage = {
        ...mockStorage,
        setItem: vi.fn().mockRejectedValue(new Error('Storage error')),
      }

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        storage: failingStorage,
        networkStatus: mockNetworkStatus,
        fallbackToMemory: true,
      })

      // Should not throw with fallback enabled
      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      expect(queue.length).toBe(1)
      expect(queue.isUsingFallbackStorage).toBe(true)
    })

    it('should estimate queue size in bytes', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      const sizeInBytes = queue.estimatedSizeBytes
      expect(sizeInBytes).toBeGreaterThan(0)
    })

    it('should compact queue when approaching quota limit', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        maxStorageBytes: 1000,
        autoCompact: true,
      })

      // Enqueue multiple mutations for the same document
      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'First', value: 1 },
      })
      await queue.enqueue({
        type: 'update',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Second', value: 2 },
      })
      await queue.enqueue({
        type: 'update',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Third', value: 3 },
      })

      await queue.compact()

      // After compaction, should have a single merged mutation
      const queued = queue.getAll()
      expect(queued.length).toBeLessThanOrEqual(2) // Merged or compacted
    })
  })

  // =========================================================================
  // Pause/Resume Processing Tests
  // =========================================================================

  describe('pause and resume processing', () => {
    it('should pause queue processing', async () => {
      mockNetworkStatus.setOnline(false)

      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      queue.pause()
      expect(queue.isPaused).toBe(true)

      // Coming online should not trigger replay when paused
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(replayHandler).not.toHaveBeenCalled()
    })

    it('should resume queue processing after pause', async () => {
      mockNetworkStatus.setOnline(false)

      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      queue.pause()
      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(replayHandler).not.toHaveBeenCalled()

      queue.resume()
      await vi.advanceTimersByTimeAsync(0)

      expect(replayHandler).toHaveBeenCalled()
    })

    it('should not enqueue during pause when configured', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        blockEnqueueWhenPaused: true,
      })

      queue.pause()

      await expect(
        queue.enqueue({
          type: 'insert',
          key: 'doc-1',
          value: { _id: 'doc-1', name: 'Test', value: 42 },
        })
      ).rejects.toThrow(/paused/i)
    })

    it('should emit onPause and onResume events', async () => {
      const onPause = vi.fn()
      const onResume = vi.fn()

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onPause,
        onResume,
      })

      queue.pause()
      expect(onPause).toHaveBeenCalled()

      queue.resume()
      expect(onResume).toHaveBeenCalled()
    })
  })

  // =========================================================================
  // Batch Processing Tests
  // =========================================================================

  describe('batch processing', () => {
    it('should process mutations in batches', async () => {
      mockNetworkStatus.setOnline(false)

      const batchReplayHandler = vi.fn().mockResolvedValue({
        results: [
          { success: true, key: 'doc-1' },
          { success: true, key: 'doc-2' },
          { success: true, key: 'doc-3' },
        ],
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onBatchReplay: batchReplayHandler,
        batchSize: 3,
      })

      for (let i = 1; i <= 5; i++) {
        await queue.enqueue({
          type: 'insert',
          key: `doc-${i}`,
          value: { _id: `doc-${i}`, name: `Doc ${i}`, value: i },
        })
      }

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      // Should be called twice: batch of 3 + batch of 2
      expect(batchReplayHandler).toHaveBeenCalledTimes(2)
    })

    it('should handle partial batch success', async () => {
      mockNetworkStatus.setOnline(false)

      const batchReplayHandler = vi.fn().mockResolvedValue({
        results: [
          { success: true, key: 'doc-1' },
          { success: false, key: 'doc-2', error: new Error('Failed') },
          { success: true, key: 'doc-3' },
        ],
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onBatchReplay: batchReplayHandler,
        batchSize: 3,
      })

      for (let i = 1; i <= 3; i++) {
        await queue.enqueue({
          type: 'insert',
          key: `doc-${i}`,
          value: { _id: `doc-${i}`, name: `Doc ${i}`, value: i },
        })
      }

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      // doc-2 should remain in queue (failed)
      expect(queue.length).toBe(1)
      expect(queue.getAll()[0].mutation.key).toBe('doc-2')
    })

    it('should configure batch size dynamically', async () => {
      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        batchSize: 5,
      })

      expect(queue.batchSize).toBe(5)

      queue.setBatchSize(10)
      expect(queue.batchSize).toBe(10)
    })

    it('should process batches with configurable delay between', async () => {
      mockNetworkStatus.setOnline(false)

      const batchReplayHandler = vi.fn().mockResolvedValue({
        results: [{ success: true, key: 'doc-1' }],
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onBatchReplay: batchReplayHandler,
        batchSize: 1,
        batchDelayMs: 100,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'First', value: 1 },
      })
      await queue.enqueue({
        type: 'insert',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Second', value: 2 },
      })

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(batchReplayHandler).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(100)
      expect(batchReplayHandler).toHaveBeenCalledTimes(2)
    })
  })

  // =========================================================================
  // Enhanced Conflict Handling Tests
  // =========================================================================

  describe('enhanced conflict handling', () => {
    it('should rollback local changes on unresolvable conflict', async () => {
      mockNetworkStatus.setOnline(false)

      const onRollback = vi.fn()
      const replayHandler = vi.fn().mockResolvedValue({
        success: false,
        conflict: true,
        unresolvable: true,
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        onRollback,
      })

      await queue.enqueue({
        type: 'update',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Client', value: 42 },
      })

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(onRollback).toHaveBeenCalledWith(
        expect.objectContaining({
          mutation: expect.objectContaining({ key: 'doc-1' }),
        })
      )
    })

    it('should handle partial success in batch with conflicts', async () => {
      mockNetworkStatus.setOnline(false)

      const onPartialSuccess = vi.fn()
      const batchReplayHandler = vi.fn().mockResolvedValue({
        results: [
          { success: true, key: 'doc-1' },
          { success: false, key: 'doc-2', conflict: true },
          { success: true, key: 'doc-3' },
        ],
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onBatchReplay: batchReplayHandler,
        onPartialSuccess,
        batchSize: 3,
      })

      for (let i = 1; i <= 3; i++) {
        await queue.enqueue({
          type: 'insert',
          key: `doc-${i}`,
          value: { _id: `doc-${i}`, name: `Doc ${i}`, value: i },
        })
      }

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(onPartialSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          successful: 2,
          failed: 1,
          conflicts: 1,
        })
      )
    })

    it('should merge server and client changes on conflict resolution', async () => {
      mockNetworkStatus.setOnline(false)

      const serverVersion = { _id: 'doc-1', name: 'Server', value: 100 }
      const clientVersion = { _id: 'doc-1', name: 'Client', value: 42 }
      const mergedVersion = { _id: 'doc-1', name: 'Server', value: 42 } // Example merge

      const conflictResolver = vi.fn().mockResolvedValue({
        resolution: 'merge',
        mergedValue: mergedVersion,
      })

      const replayHandler = vi.fn().mockImplementation(async (queuedMutation: QueuedMutation<TestDocument>) => {
        if (queuedMutation.mutation.value.name === 'Client') {
          return { success: false, conflict: true, serverVersion }
        }
        return { success: true }
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        onConflict: conflictResolver,
      })

      await queue.enqueue({
        type: 'update',
        key: 'doc-1',
        value: clientVersion,
      })

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(conflictResolver).toHaveBeenCalledWith(
        expect.objectContaining({
          mutation: expect.objectContaining({ key: 'doc-1' }),
        }),
        serverVersion
      )
    })
  })

  // =========================================================================
  // Additional Event Hooks Tests
  // =========================================================================

  describe('additional event hooks', () => {
    it('should emit onProcessStart event', async () => {
      mockNetworkStatus.setOnline(false)

      const onProcessStart = vi.fn()
      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        onProcessStart,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(onProcessStart).toHaveBeenCalledWith(
        expect.objectContaining({
          queueLength: 1,
        })
      )
    })

    it('should emit onProcessEnd event', async () => {
      mockNetworkStatus.setOnline(false)

      const onProcessEnd = vi.fn()
      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        onProcessEnd,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(onProcessEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          processed: 1,
          successful: 1,
          failed: 0,
        })
      )
    })

    it('should emit onError event on replay failure', async () => {
      mockNetworkStatus.setOnline(false)

      const onError = vi.fn()
      const replayHandler = vi.fn().mockResolvedValue({
        success: false,
        error: new Error('Replay failed'),
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        onError,
        retryAttempts: 1,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          mutation: expect.objectContaining({ key: 'doc-1' }),
        }),
        expect.any(Error)
      )
    })

    it('should emit onQueueEmpty event when queue becomes empty', async () => {
      mockNetworkStatus.setOnline(false)

      const onQueueEmpty = vi.fn()
      const replayHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        onQueueEmpty,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(onQueueEmpty).toHaveBeenCalled()
    })

    it('should emit onDequeue event', async () => {
      mockNetworkStatus.setOnline(false)

      const onDequeue = vi.fn()

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onDequeue,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      await queue.dequeue()

      expect(onDequeue).toHaveBeenCalledWith(
        expect.objectContaining({
          mutation: expect.objectContaining({ key: 'doc-1' }),
        })
      )
    })
  })

  // =========================================================================
  // Priority Queue Tests
  // =========================================================================

  describe('priority queue', () => {
    it('should process high priority mutations first', async () => {
      mockNetworkStatus.setOnline(false)

      const replayOrder: string[] = []
      const replayHandler = vi.fn().mockImplementation(async (queuedMutation: QueuedMutation<TestDocument>) => {
        replayOrder.push(queuedMutation.mutation.key)
        return { success: true }
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        usePriorityQueue: true,
      })

      await queue.enqueue(
        { type: 'insert', key: 'low-1', value: { _id: 'low-1', name: 'Low', value: 1 } },
        { priority: 'low' }
      )
      await queue.enqueue(
        { type: 'insert', key: 'high-1', value: { _id: 'high-1', name: 'High', value: 2 } },
        { priority: 'high' }
      )
      await queue.enqueue(
        { type: 'insert', key: 'normal-1', value: { _id: 'normal-1', name: 'Normal', value: 3 } },
        { priority: 'normal' }
      )

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(replayOrder[0]).toBe('high-1')
      expect(replayOrder[1]).toBe('normal-1')
      expect(replayOrder[2]).toBe('low-1')
    })

    it('should support critical priority', async () => {
      mockNetworkStatus.setOnline(false)

      const replayOrder: string[] = []
      const replayHandler = vi.fn().mockImplementation(async (queuedMutation: QueuedMutation<TestDocument>) => {
        replayOrder.push(queuedMutation.mutation.key)
        return { success: true }
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        usePriorityQueue: true,
      })

      await queue.enqueue(
        { type: 'insert', key: 'high-1', value: { _id: 'high-1', name: 'High', value: 1 } },
        { priority: 'high' }
      )
      await queue.enqueue(
        { type: 'insert', key: 'critical-1', value: { _id: 'critical-1', name: 'Critical', value: 2 } },
        { priority: 'critical' }
      )

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(replayOrder[0]).toBe('critical-1')
      expect(replayOrder[1]).toBe('high-1')
    })

    it('should apply time-based priority decay', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        usePriorityQueue: true,
        priorityDecayMs: 1000, // Priority increases after 1 second
      })

      const now = new Date('2025-01-05T12:00:00Z')
      vi.setSystemTime(now)

      await queue.enqueue(
        { type: 'insert', key: 'old', value: { _id: 'old', name: 'Old', value: 1 } },
        { priority: 'low' }
      )

      vi.setSystemTime(new Date('2025-01-05T12:00:02Z')) // 2 seconds later

      await queue.enqueue(
        { type: 'insert', key: 'new', value: { _id: 'new', name: 'New', value: 2 } },
        { priority: 'low' }
      )

      const queued = queue.getAll()
      // Old mutation should have higher effective priority due to decay
      expect(queued[0].effectivePriority).toBeGreaterThan(queued[1].effectivePriority)
    })

    it('should distinguish user-initiated vs background mutations', async () => {
      mockNetworkStatus.setOnline(false)

      const replayOrder: string[] = []
      const replayHandler = vi.fn().mockImplementation(async (queuedMutation: QueuedMutation<TestDocument>) => {
        replayOrder.push(queuedMutation.mutation.key)
        return { success: true }
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        usePriorityQueue: true,
      })

      await queue.enqueue(
        { type: 'insert', key: 'background', value: { _id: 'background', name: 'Background', value: 1 } },
        { source: 'background', priority: 'normal' }
      )
      await queue.enqueue(
        { type: 'insert', key: 'user', value: { _id: 'user', name: 'User', value: 2 } },
        { source: 'user', priority: 'normal' }
      )

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      // User-initiated should be processed before background
      expect(replayOrder[0]).toBe('user')
      expect(replayOrder[1]).toBe('background')
    })

    it('should maintain FIFO within same priority level', async () => {
      mockNetworkStatus.setOnline(false)

      const replayOrder: string[] = []
      const replayHandler = vi.fn().mockImplementation(async (queuedMutation: QueuedMutation<TestDocument>) => {
        replayOrder.push(queuedMutation.mutation.key)
        return { success: true }
      })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        onReplay: replayHandler,
        usePriorityQueue: true,
      })

      await queue.enqueue(
        { type: 'insert', key: 'high-1', value: { _id: 'high-1', name: 'High 1', value: 1 } },
        { priority: 'high' }
      )
      await queue.enqueue(
        { type: 'insert', key: 'high-2', value: { _id: 'high-2', name: 'High 2', value: 2 } },
        { priority: 'high' }
      )
      await queue.enqueue(
        { type: 'insert', key: 'high-3', value: { _id: 'high-3', name: 'High 3', value: 3 } },
        { priority: 'high' }
      )

      mockNetworkStatus.setOnline(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(replayOrder).toEqual(['high-1', 'high-2', 'high-3'])
    })

    it('should allow changing mutation priority after enqueue', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        usePriorityQueue: true,
      })

      await queue.enqueue(
        { type: 'insert', key: 'doc-1', value: { _id: 'doc-1', name: 'Test', value: 1 } },
        { priority: 'low' }
      )

      const queued = queue.getAll()
      expect(queued[0].priority).toBe('low')

      await queue.updatePriority(queued[0].id, 'critical')

      const updated = queue.getAll()
      expect(updated[0].priority).toBe('critical')
    })

    it('should get mutations by priority level', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
        usePriorityQueue: true,
      })

      await queue.enqueue(
        { type: 'insert', key: 'high-1', value: { _id: 'high-1', name: 'High', value: 1 } },
        { priority: 'high' }
      )
      await queue.enqueue(
        { type: 'insert', key: 'low-1', value: { _id: 'low-1', name: 'Low', value: 2 } },
        { priority: 'low' }
      )
      await queue.enqueue(
        { type: 'insert', key: 'high-2', value: { _id: 'high-2', name: 'High 2', value: 3 } },
        { priority: 'high' }
      )

      const highPriority = queue.getByPriority('high')
      expect(highPriority).toHaveLength(2)
      expect(highPriority.every((m) => m.priority === 'high')).toBe(true)
    })
  })

  // =========================================================================
  // Factory Function Tests
  // =========================================================================

  describe('createOfflineQueue factory', () => {
    it('should create queue using factory function', () => {
      const queue = createOfflineQueue<TestDocument>({
        collectionId: 'test-collection',
      })

      expect(queue).toBeInstanceOf(OfflineQueue)
    })

    it('should create queue with all options via factory', () => {
      const queue = createOfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        storage: mockStorage,
        networkStatus: mockNetworkStatus,
        maxQueueSize: 100,
        retryAttempts: 5,
        usePriorityQueue: true,
      })

      expect(queue.maxQueueSize).toBe(100)
      expect(queue.retryAttempts).toBe(5)
    })
  })

  // =========================================================================
  // processQueue() Direct Call Tests
  // =========================================================================

  describe('processQueue direct call', () => {
    it('should process queue with provided connection', async () => {
      mockNetworkStatus.setOnline(false)

      const processHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      const mockConnection = { isConnected: true, send: processHandler }

      const result = await queue.processQueue(mockConnection)

      expect(result.processed).toBe(1)
      expect(result.successful).toBe(1)
      expect(processHandler).toHaveBeenCalled()
    })

    it('should handle connection errors during process', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      const mockConnection = {
        isConnected: false,
        send: vi.fn(),
      }

      await expect(queue.processQueue(mockConnection)).rejects.toThrow(/not connected/i)
    })

    it('should process with custom options', async () => {
      mockNetworkStatus.setOnline(false)

      const processHandler = vi.fn().mockResolvedValue({ success: true })

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        networkStatus: mockNetworkStatus,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'First', value: 1 },
      })
      await queue.enqueue({
        type: 'insert',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Second', value: 2 },
      })

      const mockConnection = { isConnected: true, send: processHandler }

      const options: QueueProcessingOptions = {
        maxItems: 1,
        stopOnError: true,
      }

      const result = await queue.processQueue(mockConnection, options)

      expect(result.processed).toBe(1)
      expect(queue.length).toBe(1) // One still remaining
    })
  })

  // =========================================================================
  // persistQueue() and restoreQueue() Tests
  // =========================================================================

  describe('explicit persist and restore', () => {
    it('should manually persist queue to storage', async () => {
      mockNetworkStatus.setOnline(false)

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        storage: mockStorage,
        networkStatus: mockNetworkStatus,
        autoPersist: false, // Disable auto-persist
      })

      await queue.enqueue({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      })

      // Storage should be empty without auto-persist
      let stored = await mockStorage.getItem('offline-queue:test-collection')
      expect(stored).toBeNull()

      await queue.persistQueue()

      stored = await mockStorage.getItem('offline-queue:test-collection')
      expect(stored).toBeDefined()
    })

    it('should manually restore queue from storage', async () => {
      const storedData = {
        version: 1,
        mutations: [
          {
            id: 'mut-1',
            mutation: {
              type: 'insert',
              key: 'doc-1',
              value: { _id: 'doc-1', name: 'Stored', value: 100 },
            },
            timestamp: '2025-01-05T10:00:00Z',
            status: 'pending',
            priority: 'normal',
          },
        ],
      }
      await mockStorage.setItem('offline-queue:test-collection', JSON.stringify(storedData))

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        storage: mockStorage,
        networkStatus: mockNetworkStatus,
        autoRestore: false, // Disable auto-restore
      })

      expect(queue.length).toBe(0) // Not restored yet

      await queue.restoreQueue()

      expect(queue.length).toBe(1)
      expect(queue.getAll()[0].mutation.key).toBe('doc-1')
    })

    it('should merge restored queue with existing mutations', async () => {
      mockNetworkStatus.setOnline(false)

      const storedData = {
        version: 1,
        mutations: [
          {
            id: 'mut-stored',
            mutation: {
              type: 'insert',
              key: 'stored-doc',
              value: { _id: 'stored-doc', name: 'Stored', value: 100 },
            },
            timestamp: '2025-01-05T10:00:00Z',
            status: 'pending',
            priority: 'normal',
          },
        ],
      }
      await mockStorage.setItem('offline-queue:test-collection', JSON.stringify(storedData))

      const queue = new OfflineQueue<TestDocument>({
        collectionId: 'test-collection',
        storage: mockStorage,
        networkStatus: mockNetworkStatus,
        autoRestore: false,
      })

      await queue.enqueue({
        type: 'insert',
        key: 'new-doc',
        value: { _id: 'new-doc', name: 'New', value: 42 },
      })

      await queue.restoreQueue({ mergeStrategy: 'prepend' })

      expect(queue.length).toBe(2)
      // Stored should be first (prepended)
      expect(queue.getAll()[0].mutation.key).toBe('stored-doc')
      expect(queue.getAll()[1].mutation.key).toBe('new-doc')
    })
  })
})
