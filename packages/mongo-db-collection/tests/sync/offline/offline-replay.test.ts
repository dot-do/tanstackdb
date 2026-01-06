/**
 * @file Offline Replay Tests - TDD (RED Phase)
 *
 * This test file verifies the Offline Replay functionality for MongoDB collections.
 * Offline Replay handles queuing mutations when offline and replaying them when
 * the connection is restored. This is part of Layer 10: Offline Support.
 *
 * Key behaviors tested:
 * 1. Queue mutations when offline
 * 2. Replay queued mutations when connection is restored
 * 3. Handle replay failures and retries
 * 4. Maintain mutation order during replay
 * 5. Emit events for replay progress and completion
 * 6. Support conflict resolution during replay
 *
 * RED PHASE: These tests define expected behavior before implementation
 * Bead ID: po0.200
 *
 * @module @tanstack/mongo-db-collection/tests/sync/offline/offline-replay
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createOfflineReplayQueue,
  OfflineReplayQueue,
  OfflineReplayConfig,
  QueuedMutation,
  ReplayResult,
  ReplayProgress,
  ReplayEventType,
} from '../../../src/sync/offline/offline-replay'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing mutations.
 */
interface TestDocument {
  _id: string
  name: string
  value: number
  updatedAt?: Date
}

/**
 * Mock RPC client for testing.
 */
interface MockRpcClient {
  rpc: ReturnType<typeof vi.fn>
  isConnected: ReturnType<typeof vi.fn>
}

function createMockRpcClient(): MockRpcClient {
  return {
    rpc: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  }
}

// =============================================================================
// Queue Creation Tests
// =============================================================================

describe('Offline Replay Queue - Creation', () => {
  describe('createOfflineReplayQueue factory', () => {
    it('should be a function', () => {
      expect(typeof createOfflineReplayQueue).toBe('function')
    })

    it('should return an OfflineReplayQueue instance', () => {
      const queue = createOfflineReplayQueue()
      expect(queue).toBeDefined()
      expect(queue.enqueue).toBeInstanceOf(Function)
      expect(queue.replay).toBeInstanceOf(Function)
      expect(queue.getQueuedMutations).toBeInstanceOf(Function)
    })

    it('should accept configuration options', () => {
      const config: OfflineReplayConfig = {
        maxQueueSize: 100,
        retryAttempts: 3,
        retryDelayMs: 1000,
      }
      const queue = createOfflineReplayQueue(config)
      expect(queue).toBeDefined()
    })

    it('should create queue with default configuration when no options provided', () => {
      const queue = createOfflineReplayQueue()
      const config = queue.getConfig()
      expect(config.maxQueueSize).toBeGreaterThan(0)
      expect(config.retryAttempts).toBeGreaterThanOrEqual(0)
    })
  })
})

// =============================================================================
// Enqueueing Mutations Tests
// =============================================================================

describe('Offline Replay Queue - Enqueueing Mutations', () => {
  let queue: OfflineReplayQueue

  beforeEach(() => {
    queue = createOfflineReplayQueue()
  })

  describe('enqueue method', () => {
    it('should enqueue an insert mutation', () => {
      const mutation: QueuedMutation = {
        id: 'mut-1',
        type: 'insert',
        collection: 'users',
        document: { _id: 'doc-1', name: 'Test', value: 1 },
        timestamp: new Date(),
      }

      queue.enqueue(mutation)

      const queued = queue.getQueuedMutations()
      expect(queued).toHaveLength(1)
      expect(queued[0].id).toBe('mut-1')
    })

    it('should enqueue an update mutation', () => {
      const mutation: QueuedMutation = {
        id: 'mut-2',
        type: 'update',
        collection: 'users',
        filter: { _id: 'doc-1' },
        update: { $set: { name: 'Updated' } },
        timestamp: new Date(),
      }

      queue.enqueue(mutation)

      const queued = queue.getQueuedMutations()
      expect(queued).toHaveLength(1)
      expect(queued[0].type).toBe('update')
    })

    it('should enqueue a delete mutation', () => {
      const mutation: QueuedMutation = {
        id: 'mut-3',
        type: 'delete',
        collection: 'users',
        filter: { _id: 'doc-1' },
        timestamp: new Date(),
      }

      queue.enqueue(mutation)

      const queued = queue.getQueuedMutations()
      expect(queued).toHaveLength(1)
      expect(queued[0].type).toBe('delete')
    })

    it('should maintain FIFO order for multiple mutations', () => {
      const mutations: QueuedMutation[] = [
        { id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() },
        { id: 'mut-2', type: 'update', collection: 'users', filter: { _id: '1' }, update: { $set: { x: 1 } }, timestamp: new Date() },
        { id: 'mut-3', type: 'delete', collection: 'users', filter: { _id: '1' }, timestamp: new Date() },
      ]

      mutations.forEach((m) => queue.enqueue(m))

      const queued = queue.getQueuedMutations()
      expect(queued.map((m) => m.id)).toEqual(['mut-1', 'mut-2', 'mut-3'])
    })

    it('should assign a unique ID if not provided', () => {
      const mutation: Partial<QueuedMutation> = {
        type: 'insert',
        collection: 'users',
        document: { _id: 'doc-1' },
      }

      queue.enqueue(mutation as QueuedMutation)

      const queued = queue.getQueuedMutations()
      expect(queued[0].id).toBeDefined()
      expect(typeof queued[0].id).toBe('string')
    })

    it('should assign timestamp if not provided', () => {
      const mutation: Partial<QueuedMutation> = {
        id: 'mut-1',
        type: 'insert',
        collection: 'users',
        document: { _id: 'doc-1' },
      }

      queue.enqueue(mutation as QueuedMutation)

      const queued = queue.getQueuedMutations()
      expect(queued[0].timestamp).toBeInstanceOf(Date)
    })

    it('should respect maxQueueSize limit', () => {
      const smallQueue = createOfflineReplayQueue({ maxQueueSize: 3 })

      for (let i = 0; i < 5; i++) {
        smallQueue.enqueue({
          id: `mut-${i}`,
          type: 'insert',
          collection: 'users',
          document: { _id: `doc-${i}` },
          timestamp: new Date(),
        })
      }

      const queued = smallQueue.getQueuedMutations()
      expect(queued).toHaveLength(3)
    })

    it('should drop oldest mutations when queue is full', () => {
      const smallQueue = createOfflineReplayQueue({ maxQueueSize: 2 })

      smallQueue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })
      smallQueue.enqueue({ id: 'mut-2', type: 'insert', collection: 'users', document: { _id: '2' }, timestamp: new Date() })
      smallQueue.enqueue({ id: 'mut-3', type: 'insert', collection: 'users', document: { _id: '3' }, timestamp: new Date() })

      const queued = smallQueue.getQueuedMutations()
      expect(queued.map((m) => m.id)).toEqual(['mut-2', 'mut-3'])
    })

    it('should emit queueOverflow event when dropping mutations', () => {
      const smallQueue = createOfflineReplayQueue({ maxQueueSize: 1 })
      const listener = vi.fn()

      smallQueue.on('queueOverflow', listener)

      smallQueue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })
      smallQueue.enqueue({ id: 'mut-2', type: 'insert', collection: 'users', document: { _id: '2' }, timestamp: new Date() })

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        droppedMutation: expect.objectContaining({ id: 'mut-1' }),
      }))
    })
  })

  describe('queue state', () => {
    it('should report isEmpty correctly', () => {
      expect(queue.isEmpty()).toBe(true)

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      expect(queue.isEmpty()).toBe(false)
    })

    it('should report size correctly', () => {
      expect(queue.size()).toBe(0)

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })
      queue.enqueue({ id: 'mut-2', type: 'insert', collection: 'users', document: { _id: '2' }, timestamp: new Date() })

      expect(queue.size()).toBe(2)
    })

    it('should clear all mutations', () => {
      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })
      queue.enqueue({ id: 'mut-2', type: 'insert', collection: 'users', document: { _id: '2' }, timestamp: new Date() })

      queue.clear()

      expect(queue.isEmpty()).toBe(true)
      expect(queue.size()).toBe(0)
    })
  })
})

// =============================================================================
// Replay Mutations Tests
// =============================================================================

describe('Offline Replay Queue - Replaying Mutations', () => {
  let queue: OfflineReplayQueue
  let mockRpc: MockRpcClient

  beforeEach(() => {
    queue = createOfflineReplayQueue()
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ success: true })
  })

  describe('replay method', () => {
    it('should replay all queued mutations', async () => {
      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1', name: 'Test' }, timestamp: new Date() })
      queue.enqueue({ id: 'mut-2', type: 'update', collection: 'users', filter: { _id: '1' }, update: { $set: { name: 'Updated' } }, timestamp: new Date() })

      const result = await queue.replay(mockRpc)

      expect(result.success).toBe(true)
      expect(result.replayed).toBe(2)
      expect(result.failed).toBe(0)
      expect(mockRpc.rpc).toHaveBeenCalledTimes(2)
    })

    it('should replay insert mutations with insertOne RPC call', async () => {
      queue.enqueue({
        id: 'mut-1',
        type: 'insert',
        collection: 'users',
        database: 'testdb',
        document: { _id: '1', name: 'Test' },
        timestamp: new Date(),
      })

      await queue.replay(mockRpc)

      expect(mockRpc.rpc).toHaveBeenCalledWith('insertOne', expect.objectContaining({
        database: 'testdb',
        collection: 'users',
        document: { _id: '1', name: 'Test' },
      }))
    })

    it('should replay update mutations with updateOne RPC call', async () => {
      queue.enqueue({
        id: 'mut-1',
        type: 'update',
        collection: 'users',
        database: 'testdb',
        filter: { _id: '1' },
        update: { $set: { name: 'Updated' } },
        timestamp: new Date(),
      })

      await queue.replay(mockRpc)

      expect(mockRpc.rpc).toHaveBeenCalledWith('updateOne', expect.objectContaining({
        database: 'testdb',
        collection: 'users',
        filter: { _id: '1' },
        update: { $set: { name: 'Updated' } },
      }))
    })

    it('should replay delete mutations with deleteOne RPC call', async () => {
      queue.enqueue({
        id: 'mut-1',
        type: 'delete',
        collection: 'users',
        database: 'testdb',
        filter: { _id: '1' },
        timestamp: new Date(),
      })

      await queue.replay(mockRpc)

      expect(mockRpc.rpc).toHaveBeenCalledWith('deleteOne', expect.objectContaining({
        database: 'testdb',
        collection: 'users',
        filter: { _id: '1' },
      }))
    })

    it('should maintain mutation order during replay', async () => {
      const callOrder: string[] = []
      mockRpc.rpc.mockImplementation(async (method: string) => {
        callOrder.push(method)
        return { success: true }
      })

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })
      queue.enqueue({ id: 'mut-2', type: 'update', collection: 'users', filter: { _id: '1' }, update: { $set: { x: 1 } }, timestamp: new Date() })
      queue.enqueue({ id: 'mut-3', type: 'delete', collection: 'users', filter: { _id: '1' }, timestamp: new Date() })

      await queue.replay(mockRpc)

      expect(callOrder).toEqual(['insertOne', 'updateOne', 'deleteOne'])
    })

    it('should clear queue after successful replay', async () => {
      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      await queue.replay(mockRpc)

      expect(queue.isEmpty()).toBe(true)
    })

    it('should return early with success when queue is empty', async () => {
      const result = await queue.replay(mockRpc)

      expect(result.success).toBe(true)
      expect(result.replayed).toBe(0)
      expect(mockRpc.rpc).not.toHaveBeenCalled()
    })

    it('should throw error if not connected', async () => {
      mockRpc.isConnected.mockReturnValue(false)
      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      await expect(queue.replay(mockRpc)).rejects.toThrow(/not connected/i)
    })
  })

  describe('replay failure handling', () => {
    it('should handle individual mutation failures', async () => {
      mockRpc.rpc
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ success: true })

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })
      queue.enqueue({ id: 'mut-2', type: 'insert', collection: 'users', document: { _id: '2' }, timestamp: new Date() })
      queue.enqueue({ id: 'mut-3', type: 'insert', collection: 'users', document: { _id: '3' }, timestamp: new Date() })

      const result = await queue.replay(mockRpc)

      expect(result.success).toBe(false)
      expect(result.replayed).toBe(2)
      expect(result.failed).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors![0].mutationId).toBe('mut-2')
    })

    it('should retry failed mutations according to config', async () => {
      const retryQueue = createOfflineReplayQueue({
        retryAttempts: 3,
        retryDelayMs: 10,
      })

      mockRpc.rpc
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValueOnce({ success: true })

      retryQueue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      const result = await retryQueue.replay(mockRpc)

      expect(result.success).toBe(true)
      expect(mockRpc.rpc).toHaveBeenCalledTimes(3)
    })

    it('should fail after max retries exceeded', async () => {
      const retryQueue = createOfflineReplayQueue({
        retryAttempts: 2,
        retryDelayMs: 10,
      })

      mockRpc.rpc.mockRejectedValue(new Error('Persistent error'))

      retryQueue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      const result = await retryQueue.replay(mockRpc)

      expect(result.success).toBe(false)
      expect(result.failed).toBe(1)
      // Initial attempt + 2 retries = 3 calls
      expect(mockRpc.rpc).toHaveBeenCalledTimes(3)
    })

    it('should not retry non-retryable errors', async () => {
      const retryQueue = createOfflineReplayQueue({
        retryAttempts: 3,
        retryDelayMs: 10,
      })

      // Duplicate key error should not be retried
      mockRpc.rpc.mockRejectedValue(new Error('E11000 duplicate key error'))

      retryQueue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      const result = await retryQueue.replay(mockRpc)

      expect(result.success).toBe(false)
      expect(mockRpc.rpc).toHaveBeenCalledTimes(1)
    })

    it('should keep failed mutations in queue when configured', async () => {
      const keepFailedQueue = createOfflineReplayQueue({
        keepFailedMutations: true,
        retryAttempts: 0,
      })

      mockRpc.rpc.mockRejectedValue(new Error('Error'))

      keepFailedQueue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      await keepFailedQueue.replay(mockRpc)

      expect(keepFailedQueue.size()).toBe(1)
    })

    it('should stop replay on stopOnError config', async () => {
      const stopOnErrorQueue = createOfflineReplayQueue({
        stopOnError: true,
      })

      mockRpc.rpc
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('Error'))
        .mockResolvedValueOnce({ success: true })

      stopOnErrorQueue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })
      stopOnErrorQueue.enqueue({ id: 'mut-2', type: 'insert', collection: 'users', document: { _id: '2' }, timestamp: new Date() })
      stopOnErrorQueue.enqueue({ id: 'mut-3', type: 'insert', collection: 'users', document: { _id: '3' }, timestamp: new Date() })

      const result = await stopOnErrorQueue.replay(mockRpc)

      expect(result.replayed).toBe(1)
      expect(result.failed).toBe(1)
      // mut-3 should not have been attempted
      expect(mockRpc.rpc).toHaveBeenCalledTimes(2)
    })
  })
})

// =============================================================================
// Replay Events Tests
// =============================================================================

describe('Offline Replay Queue - Events', () => {
  let queue: OfflineReplayQueue
  let mockRpc: MockRpcClient

  beforeEach(() => {
    queue = createOfflineReplayQueue()
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ success: true })
  })

  describe('replay progress events', () => {
    it('should emit replayStart event', async () => {
      const listener = vi.fn()
      queue.on('replayStart', listener)

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      await queue.replay(mockRpc)

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        totalMutations: 1,
      }))
    })

    it('should emit replayProgress events', async () => {
      const listener = vi.fn()
      queue.on('replayProgress', listener)

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })
      queue.enqueue({ id: 'mut-2', type: 'insert', collection: 'users', document: { _id: '2' }, timestamp: new Date() })

      await queue.replay(mockRpc)

      expect(listener).toHaveBeenCalledTimes(2)
      expect(listener).toHaveBeenNthCalledWith(1, expect.objectContaining({
        current: 1,
        total: 2,
        mutationId: 'mut-1',
        success: true,
      }))
      expect(listener).toHaveBeenNthCalledWith(2, expect.objectContaining({
        current: 2,
        total: 2,
        mutationId: 'mut-2',
        success: true,
      }))
    })

    it('should emit replayComplete event on success', async () => {
      const listener = vi.fn()
      queue.on('replayComplete', listener)

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      await queue.replay(mockRpc)

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        replayed: 1,
        failed: 0,
      }))
    })

    it('should emit replayComplete event on failure', async () => {
      const listener = vi.fn()
      mockRpc.rpc.mockRejectedValue(new Error('Error'))
      queue.on('replayComplete', listener)

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      await queue.replay(mockRpc)

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        replayed: 0,
        failed: 1,
      }))
    })

    it('should emit replayError event on mutation failure', async () => {
      const listener = vi.fn()
      const error = new Error('RPC Error')
      mockRpc.rpc.mockRejectedValue(error)
      queue.on('replayError', listener)

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      await queue.replay(mockRpc)

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        mutationId: 'mut-1',
        error: expect.any(Error),
        attempt: 1,
      }))
    })

    it('should emit replayRetry event before retry attempt', async () => {
      const retryQueue = createOfflineReplayQueue({
        retryAttempts: 2,
        retryDelayMs: 10,
      })
      const listener = vi.fn()
      retryQueue.on('replayRetry', listener)

      mockRpc.rpc
        .mockRejectedValueOnce(new Error('Transient'))
        .mockResolvedValueOnce({ success: true })

      retryQueue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      await retryQueue.replay(mockRpc)

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        mutationId: 'mut-1',
        attempt: 2,
        maxAttempts: 3, // 1 initial + 2 retries
      }))
    })
  })

  describe('event listener management', () => {
    it('should support on/off methods', () => {
      const listener = vi.fn()

      queue.on('replayStart', listener)
      queue.off('replayStart', listener)

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      queue.replay(mockRpc)

      expect(listener).not.toHaveBeenCalled()
    })

    it('should support once method', async () => {
      const listener = vi.fn()

      queue.once('replayProgress', listener)

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })
      queue.enqueue({ id: 'mut-2', type: 'insert', collection: 'users', document: { _id: '2' }, timestamp: new Date() })

      await queue.replay(mockRpc)

      // Only called once even though there were 2 mutations
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })
})

// =============================================================================
// Persistence Tests
// =============================================================================

describe('Offline Replay Queue - Persistence', () => {
  describe('serialization', () => {
    it('should serialize queue to JSON', () => {
      const queue = createOfflineReplayQueue()

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1', name: 'Test' }, timestamp: new Date('2024-01-01') })

      const serialized = queue.serialize()

      expect(typeof serialized).toBe('string')
      expect(() => JSON.parse(serialized)).not.toThrow()
    })

    it('should deserialize queue from JSON', () => {
      const queue = createOfflineReplayQueue()
      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1', name: 'Test' }, timestamp: new Date('2024-01-01') })

      const serialized = queue.serialize()

      const restoredQueue = createOfflineReplayQueue({
        initialState: serialized,
      })

      const mutations = restoredQueue.getQueuedMutations()
      expect(mutations).toHaveLength(1)
      expect(mutations[0].id).toBe('mut-1')
      expect(mutations[0].document).toEqual({ _id: '1', name: 'Test' })
    })

    it('should handle invalid serialized state gracefully', () => {
      const queue = createOfflineReplayQueue({
        initialState: 'invalid json',
      })

      expect(queue.isEmpty()).toBe(true)
    })

    it('should restore timestamps as Date objects', () => {
      const queue = createOfflineReplayQueue()
      const timestamp = new Date('2024-01-15T10:30:00Z')
      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp })

      const serialized = queue.serialize()
      const restoredQueue = createOfflineReplayQueue({ initialState: serialized })

      const mutations = restoredQueue.getQueuedMutations()
      expect(mutations[0].timestamp).toBeInstanceOf(Date)
      expect(mutations[0].timestamp.toISOString()).toBe(timestamp.toISOString())
    })
  })
})

// =============================================================================
// Conflict Resolution Tests
// =============================================================================

describe('Offline Replay Queue - Conflict Resolution', () => {
  let queue: OfflineReplayQueue
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ success: true })
  })

  describe('duplicate handling', () => {
    it('should detect duplicate insert errors during replay', async () => {
      queue = createOfflineReplayQueue()

      mockRpc.rpc.mockRejectedValue(new Error('E11000 duplicate key error'))

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1', name: 'Test' }, timestamp: new Date() })

      const result = await queue.replay(mockRpc)

      expect(result.errors![0].isDuplicateKey).toBe(true)
    })

    it('should use onConflict handler when provided', async () => {
      const onConflict = vi.fn().mockResolvedValue('skip')

      queue = createOfflineReplayQueue({
        onConflict,
      })

      mockRpc.rpc.mockRejectedValue(new Error('E11000 duplicate key error'))

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      await queue.replay(mockRpc)

      expect(onConflict).toHaveBeenCalledWith(expect.objectContaining({
        mutation: expect.objectContaining({ id: 'mut-1' }),
        error: expect.any(Error),
      }))
    })

    it('should skip mutation when onConflict returns "skip"', async () => {
      queue = createOfflineReplayQueue({
        onConflict: async () => 'skip',
      })

      mockRpc.rpc
        .mockRejectedValueOnce(new Error('E11000 duplicate key error'))
        .mockResolvedValueOnce({ success: true })

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })
      queue.enqueue({ id: 'mut-2', type: 'insert', collection: 'users', document: { _id: '2' }, timestamp: new Date() })

      const result = await queue.replay(mockRpc)

      expect(result.skipped).toBe(1)
      expect(result.replayed).toBe(1)
    })

    it('should convert to update when onConflict returns "update"', async () => {
      queue = createOfflineReplayQueue({
        onConflict: async () => 'update',
      })

      mockRpc.rpc
        .mockRejectedValueOnce(new Error('E11000 duplicate key error'))
        .mockResolvedValueOnce({ success: true }) // The converted update call

      queue.enqueue({
        id: 'mut-1',
        type: 'insert',
        collection: 'users',
        database: 'testdb',
        document: { _id: '1', name: 'Test' },
        timestamp: new Date(),
      })

      const result = await queue.replay(mockRpc)

      // Should have tried insert first, then converted to updateOne
      expect(mockRpc.rpc).toHaveBeenLastCalledWith('updateOne', expect.objectContaining({
        filter: { _id: '1' },
        update: { $set: { name: 'Test' } },
      }))
      expect(result.replayed).toBe(1)
    })
  })
})

// =============================================================================
// Connection-Aware Replay Tests
// =============================================================================

describe('Offline Replay Queue - Connection-Aware Replay', () => {
  let queue: OfflineReplayQueue
  let mockRpc: MockRpcClient

  beforeEach(() => {
    queue = createOfflineReplayQueue()
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ success: true })
  })

  describe('auto-replay on connection restore', () => {
    it('should support setRpcClient method', () => {
      queue.setRpcClient(mockRpc)
      // Should not throw
      expect(true).toBe(true)
    })

    it('should auto-replay when connection is restored and autoReplay is enabled', async () => {
      const autoReplayQueue = createOfflineReplayQueue({ autoReplay: true })
      const listener = vi.fn()

      autoReplayQueue.on('replayComplete', listener)
      autoReplayQueue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      // Simulate connection restore
      autoReplayQueue.setRpcClient(mockRpc)
      autoReplayQueue.notifyConnected()

      // Wait for async replay
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(listener).toHaveBeenCalled()
    })

    it('should not auto-replay when autoReplay is disabled', async () => {
      const noAutoQueue = createOfflineReplayQueue({ autoReplay: false })
      const listener = vi.fn()

      noAutoQueue.on('replayStart', listener)
      noAutoQueue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      noAutoQueue.setRpcClient(mockRpc)
      noAutoQueue.notifyConnected()

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(listener).not.toHaveBeenCalled()
    })

    it('should debounce multiple connection events', async () => {
      const autoReplayQueue = createOfflineReplayQueue({ autoReplay: true, debounceMs: 50 })
      const listener = vi.fn()

      autoReplayQueue.on('replayStart', listener)
      autoReplayQueue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      autoReplayQueue.setRpcClient(mockRpc)

      // Multiple connection events in quick succession
      autoReplayQueue.notifyConnected()
      autoReplayQueue.notifyConnected()
      autoReplayQueue.notifyConnected()

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should only replay once
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe('pause and resume', () => {
    it('should pause replay when paused', async () => {
      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      queue.pause()

      await expect(queue.replay(mockRpc)).rejects.toThrow(/paused/i)
    })

    it('should resume replay after unpause', async () => {
      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      queue.pause()
      queue.resume()

      const result = await queue.replay(mockRpc)
      expect(result.success).toBe(true)
    })

    it('should report isPaused state correctly', () => {
      expect(queue.isPaused()).toBe(false)

      queue.pause()
      expect(queue.isPaused()).toBe(true)

      queue.resume()
      expect(queue.isPaused()).toBe(false)
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Offline Replay Queue - Edge Cases', () => {
  describe('mutation validation', () => {
    it('should reject mutations without type', () => {
      const queue = createOfflineReplayQueue()

      expect(() => {
        queue.enqueue({ collection: 'users', document: { _id: '1' } } as unknown as QueuedMutation)
      }).toThrow(/type.*required/i)
    })

    it('should reject mutations without collection', () => {
      const queue = createOfflineReplayQueue()

      expect(() => {
        queue.enqueue({ type: 'insert', document: { _id: '1' } } as unknown as QueuedMutation)
      }).toThrow(/collection.*required/i)
    })

    it('should reject insert mutations without document', () => {
      const queue = createOfflineReplayQueue()

      expect(() => {
        queue.enqueue({ type: 'insert', collection: 'users' } as unknown as QueuedMutation)
      }).toThrow(/document.*required/i)
    })

    it('should reject update mutations without filter', () => {
      const queue = createOfflineReplayQueue()

      expect(() => {
        queue.enqueue({ type: 'update', collection: 'users', update: { $set: { x: 1 } } } as unknown as QueuedMutation)
      }).toThrow(/filter.*required/i)
    })

    it('should reject update mutations without update', () => {
      const queue = createOfflineReplayQueue()

      expect(() => {
        queue.enqueue({ type: 'update', collection: 'users', filter: { _id: '1' } } as unknown as QueuedMutation)
      }).toThrow(/update.*required/i)
    })

    it('should reject delete mutations without filter', () => {
      const queue = createOfflineReplayQueue()

      expect(() => {
        queue.enqueue({ type: 'delete', collection: 'users' } as unknown as QueuedMutation)
      }).toThrow(/filter.*required/i)
    })
  })

  describe('concurrent replay prevention', () => {
    it('should prevent concurrent replay calls', async () => {
      const queue = createOfflineReplayQueue()
      const mockRpc = createMockRpcClient()

      // Slow RPC to simulate long-running replay
      mockRpc.rpc.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { success: true }
      })

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      const replay1 = queue.replay(mockRpc)
      const replay2Promise = queue.replay(mockRpc)

      await expect(replay2Promise).rejects.toThrow(/already in progress/i)
      await replay1
    })

    it('should report isReplaying state correctly', async () => {
      const queue = createOfflineReplayQueue()
      const mockRpc = createMockRpcClient()

      mockRpc.rpc.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return { success: true }
      })

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: { _id: '1' }, timestamp: new Date() })

      expect(queue.isReplaying()).toBe(false)

      const replayPromise = queue.replay(mockRpc)

      expect(queue.isReplaying()).toBe(true)

      await replayPromise

      expect(queue.isReplaying()).toBe(false)
    })
  })

  describe('memory management', () => {
    it('should limit memory usage with maxQueueSizeBytes', () => {
      const queue = createOfflineReplayQueue({
        maxQueueSizeBytes: 1000, // 1KB limit
      })

      // Add a large document
      const largeDoc = { _id: '1', data: 'x'.repeat(800) } // ~800 bytes

      queue.enqueue({ id: 'mut-1', type: 'insert', collection: 'users', document: largeDoc, timestamp: new Date() })

      // Second large doc should trigger overflow
      const listener = vi.fn()
      queue.on('queueOverflow', listener)

      queue.enqueue({ id: 'mut-2', type: 'insert', collection: 'users', document: largeDoc, timestamp: new Date() })

      expect(listener).toHaveBeenCalled()
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Offline Replay Queue - Integration', () => {
  it('should handle complete offline-to-online workflow', async () => {
    const queue = createOfflineReplayQueue({
      retryAttempts: 2,
      retryDelayMs: 10,
    })

    const mockRpc = createMockRpcClient()
    const events: string[] = []

    queue.on('replayStart', () => events.push('start'))
    queue.on('replayProgress', () => events.push('progress'))
    queue.on('replayComplete', () => events.push('complete'))

    // Phase 1: Offline - queue mutations
    queue.enqueue({
      id: 'create-user',
      type: 'insert',
      collection: 'users',
      database: 'myapp',
      document: { _id: 'user-1', name: 'Alice', email: 'alice@example.com' },
      timestamp: new Date(),
    })

    queue.enqueue({
      id: 'update-user',
      type: 'update',
      collection: 'users',
      database: 'myapp',
      filter: { _id: 'user-1' },
      update: { $set: { verified: true } },
      timestamp: new Date(),
    })

    expect(queue.size()).toBe(2)

    // Phase 2: Connection restored - replay
    mockRpc.rpc.mockResolvedValue({ success: true })

    const result = await queue.replay(mockRpc)

    // Verify results
    expect(result.success).toBe(true)
    expect(result.replayed).toBe(2)
    expect(result.failed).toBe(0)

    // Verify correct RPC calls
    expect(mockRpc.rpc).toHaveBeenNthCalledWith(1, 'insertOne', expect.objectContaining({
      database: 'myapp',
      collection: 'users',
      document: expect.objectContaining({ _id: 'user-1', name: 'Alice' }),
    }))

    expect(mockRpc.rpc).toHaveBeenNthCalledWith(2, 'updateOne', expect.objectContaining({
      database: 'myapp',
      collection: 'users',
      filter: { _id: 'user-1' },
      update: { $set: { verified: true } },
    }))

    // Verify events
    expect(events).toEqual(['start', 'progress', 'progress', 'complete'])

    // Queue should be empty after successful replay
    expect(queue.isEmpty()).toBe(true)
  })

  it('should support serialization roundtrip with pending mutations', async () => {
    const queue = createOfflineReplayQueue()

    // Queue some mutations
    queue.enqueue({
      id: 'mut-1',
      type: 'insert',
      collection: 'users',
      database: 'testdb',
      document: { _id: 'doc-1', name: 'Test User', createdAt: new Date('2024-06-15') },
      timestamp: new Date('2024-06-15T10:00:00Z'),
    })

    queue.enqueue({
      id: 'mut-2',
      type: 'update',
      collection: 'users',
      database: 'testdb',
      filter: { _id: 'doc-1' },
      update: { $set: { verified: true } },
      timestamp: new Date('2024-06-15T10:01:00Z'),
    })

    // Serialize
    const serialized = queue.serialize()

    // Restore
    const restoredQueue = createOfflineReplayQueue({ initialState: serialized })

    // Verify mutations were restored
    const mutations = restoredQueue.getQueuedMutations()
    expect(mutations).toHaveLength(2)

    // Replay the restored queue
    const mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ success: true })

    const result = await restoredQueue.replay(mockRpc)

    expect(result.success).toBe(true)
    expect(result.replayed).toBe(2)
  })
})

// =============================================================================
// Performance Tests
// =============================================================================

describe('Offline Replay Queue - Performance', () => {
  it('should handle large number of mutations efficiently', async () => {
    const queue = createOfflineReplayQueue({ maxQueueSize: 10000 })
    const mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ success: true })

    // Enqueue 1000 mutations
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      queue.enqueue({
        id: `mut-${i}`,
        type: 'insert',
        collection: 'users',
        document: { _id: `doc-${i}`, index: i },
        timestamp: new Date(),
      })
    }
    const enqueueTime = performance.now() - start

    // Enqueuing 1000 mutations should be fast
    expect(enqueueTime).toBeLessThan(100)

    // Replay all mutations
    const replayStart = performance.now()
    const result = await queue.replay(mockRpc)
    const replayTime = performance.now() - replayStart

    expect(result.success).toBe(true)
    expect(result.replayed).toBe(1000)

    // Replay should complete in reasonable time (depends on mock overhead)
    expect(replayTime).toBeLessThan(1000)
  })

  it('should serialize and deserialize large queues efficiently', () => {
    const queue = createOfflineReplayQueue({ maxQueueSize: 1000 })

    // Enqueue 500 mutations with substantial data
    for (let i = 0; i < 500; i++) {
      queue.enqueue({
        id: `mut-${i}`,
        type: 'insert',
        collection: 'users',
        document: { _id: `doc-${i}`, data: 'x'.repeat(100) },
        timestamp: new Date(),
      })
    }

    const start = performance.now()
    const serialized = queue.serialize()
    const serializeTime = performance.now() - start

    const restoreStart = performance.now()
    const restored = createOfflineReplayQueue({ initialState: serialized })
    const restoreTime = performance.now() - restoreStart

    expect(serializeTime).toBeLessThan(100)
    expect(restoreTime).toBeLessThan(100)
    expect(restored.size()).toBe(500)
  })
})
