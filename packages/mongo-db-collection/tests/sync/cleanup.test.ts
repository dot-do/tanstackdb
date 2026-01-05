/**
 * Sync Cleanup Function Tests (TDD RED Phase)
 *
 * These tests verify the cleanup function for MongoDB sync operations which:
 * 1. Closes the change stream connection
 * 2. Disconnects from mongo.do service
 * 3. Clears the event buffer to free memory
 * 4. Cancels all pending operations (in-flight requests)
 * 5. Can be called multiple times safely (idempotent)
 *
 * The cleanup function is essential for proper resource management when
 * unmounting components, shutting down services, or switching collections.
 *
 * RED PHASE: These tests will fail until the cleanup function is implemented
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSyncCleanup, SyncCleanupManager } from '../../src/sync/cleanup'
import type {
  SyncCleanupOptions,
  SyncCleanupState,
  CleanupResult,
  PendingOperation,
} from '../../src/sync/cleanup'

// Mock change stream interface
interface MockChangeStream {
  close: () => Promise<void>
  isClosed: () => boolean
}

// Mock mongo.do client interface
interface MockMongoDoClient {
  disconnect: () => Promise<void>
  isConnected: () => boolean
}

// Mock event buffer interface
interface MockEventBuffer<T = unknown> {
  clear: () => void
  size: () => number
  getEvents: () => T[]
}

// Mock pending operation interface
interface MockPendingOperations {
  cancel: (reason: string) => void
  getPending: () => PendingOperation[]
  hasPending: () => boolean
}

describe('SyncCleanupManager', () => {
  let mockChangeStream: MockChangeStream
  let mockClient: MockMongoDoClient
  let mockEventBuffer: MockEventBuffer
  let mockPendingOperations: MockPendingOperations
  let cleanupManager: SyncCleanupManager

  beforeEach(() => {
    // Create mocks
    mockChangeStream = {
      close: vi.fn().mockResolvedValue(undefined),
      isClosed: vi.fn().mockReturnValue(false),
    }

    mockClient = {
      disconnect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    }

    mockEventBuffer = {
      clear: vi.fn(),
      size: vi.fn().mockReturnValue(10),
      getEvents: vi.fn().mockReturnValue([]),
    }

    mockPendingOperations = {
      cancel: vi.fn(),
      getPending: vi.fn().mockReturnValue([
        { id: 'op-1', type: 'find', startedAt: Date.now() },
        { id: 'op-2', type: 'update', startedAt: Date.now() },
      ]),
      hasPending: vi.fn().mockReturnValue(true),
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('construction', () => {
    it('should create cleanup manager with required options', () => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
      })

      expect(cleanupManager).toBeInstanceOf(SyncCleanupManager)
    })

    it('should accept optional configuration', () => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
        timeoutMs: 5000,
        onProgress: vi.fn(),
        onError: vi.fn(),
      })

      expect(cleanupManager).toBeInstanceOf(SyncCleanupManager)
    })

    it('should initialize in idle state', () => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
      })

      expect(cleanupManager.state).toBe('idle')
      expect(cleanupManager.isCleanedUp).toBe(false)
    })
  })

  describe('change stream closure', () => {
    beforeEach(() => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
      })
    })

    it('should close the change stream during cleanup', async () => {
      await cleanupManager.cleanup()

      expect(mockChangeStream.close).toHaveBeenCalledTimes(1)
    })

    it('should handle change stream already closed', async () => {
      mockChangeStream.isClosed = vi.fn().mockReturnValue(true)

      const result = await cleanupManager.cleanup()

      expect(mockChangeStream.close).not.toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('should handle change stream close error gracefully', async () => {
      const closeError = new Error('Failed to close change stream')
      mockChangeStream.close = vi.fn().mockRejectedValue(closeError)
      const onError = vi.fn()

      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
        onError,
      })

      const result = await cleanupManager.cleanup()

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'changeStream',
          error: closeError,
        })
      )
      // Cleanup should continue despite the error
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].phase).toBe('changeStream')
    })

    it('should timeout if change stream close takes too long', async () => {
      mockChangeStream.close = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000))
      )

      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
        timeoutMs: 100,
      })

      vi.useFakeTimers()

      const cleanupPromise = cleanupManager.cleanup()
      await vi.advanceTimersByTimeAsync(100)

      const result = await cleanupPromise

      expect(result.timedOut).toBe(true)
      expect(result.errors.some((e) => e.phase === 'changeStream')).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('mongo.do disconnection', () => {
    beforeEach(() => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
      })
    })

    it('should disconnect from mongo.do during cleanup', async () => {
      await cleanupManager.cleanup()

      expect(mockClient.disconnect).toHaveBeenCalledTimes(1)
    })

    it('should handle client already disconnected', async () => {
      mockClient.isConnected = vi.fn().mockReturnValue(false)

      const result = await cleanupManager.cleanup()

      expect(mockClient.disconnect).not.toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('should handle disconnection error gracefully', async () => {
      const disconnectError = new Error('Disconnection failed')
      mockClient.disconnect = vi.fn().mockRejectedValue(disconnectError)
      const onError = vi.fn()

      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
        onError,
      })

      const result = await cleanupManager.cleanup()

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'client',
          error: disconnectError,
        })
      )
      expect(result.errors).toContainEqual(
        expect.objectContaining({ phase: 'client' })
      )
    })

    it('should disconnect after closing change stream', async () => {
      const callOrder: string[] = []

      mockChangeStream.close = vi.fn().mockImplementation(async () => {
        callOrder.push('changeStream.close')
      })

      mockClient.disconnect = vi.fn().mockImplementation(async () => {
        callOrder.push('client.disconnect')
      })

      await cleanupManager.cleanup()

      expect(callOrder).toEqual(['changeStream.close', 'client.disconnect'])
    })
  })

  describe('event buffer clearing', () => {
    beforeEach(() => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
      })
    })

    it('should clear the event buffer during cleanup', async () => {
      await cleanupManager.cleanup()

      expect(mockEventBuffer.clear).toHaveBeenCalledTimes(1)
    })

    it('should report cleared event count in result', async () => {
      mockEventBuffer.size = vi.fn().mockReturnValue(25)

      const result = await cleanupManager.cleanup()

      expect(result.clearedEvents).toBe(25)
    })

    it('should handle empty event buffer', async () => {
      mockEventBuffer.size = vi.fn().mockReturnValue(0)

      const result = await cleanupManager.cleanup()

      expect(mockEventBuffer.clear).toHaveBeenCalled()
      expect(result.clearedEvents).toBe(0)
    })

    it('should handle event buffer clear error gracefully', async () => {
      mockEventBuffer.clear = vi.fn().mockImplementation(() => {
        throw new Error('Buffer clear failed')
      })
      const onError = vi.fn()

      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
        onError,
      })

      const result = await cleanupManager.cleanup()

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'eventBuffer' })
      )
      expect(result.errors).toContainEqual(
        expect.objectContaining({ phase: 'eventBuffer' })
      )
    })
  })

  describe('pending operations cancellation', () => {
    beforeEach(() => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
      })
    })

    it('should cancel all pending operations during cleanup', async () => {
      await cleanupManager.cleanup()

      expect(mockPendingOperations.cancel).toHaveBeenCalledTimes(1)
      expect(mockPendingOperations.cancel).toHaveBeenCalledWith(
        expect.stringMatching(/cleanup|cancelled|aborted/i)
      )
    })

    it('should report cancelled operation count in result', async () => {
      mockPendingOperations.getPending = vi.fn().mockReturnValue([
        { id: 'op-1', type: 'find', startedAt: Date.now() },
        { id: 'op-2', type: 'update', startedAt: Date.now() },
        { id: 'op-3', type: 'insert', startedAt: Date.now() },
      ])

      const result = await cleanupManager.cleanup()

      expect(result.cancelledOperations).toBe(3)
    })

    it('should handle no pending operations', async () => {
      mockPendingOperations.hasPending = vi.fn().mockReturnValue(false)
      mockPendingOperations.getPending = vi.fn().mockReturnValue([])

      const result = await cleanupManager.cleanup()

      expect(mockPendingOperations.cancel).not.toHaveBeenCalled()
      expect(result.cancelledOperations).toBe(0)
    })

    it('should cancel operations before disconnecting', async () => {
      const callOrder: string[] = []

      mockPendingOperations.cancel = vi.fn().mockImplementation(() => {
        callOrder.push('operations.cancel')
      })

      mockClient.disconnect = vi.fn().mockImplementation(async () => {
        callOrder.push('client.disconnect')
      })

      await cleanupManager.cleanup()

      const cancelIndex = callOrder.indexOf('operations.cancel')
      const disconnectIndex = callOrder.indexOf('client.disconnect')
      expect(cancelIndex).toBeLessThan(disconnectIndex)
    })

    it('should handle operation cancellation error gracefully', async () => {
      mockPendingOperations.cancel = vi.fn().mockImplementation(() => {
        throw new Error('Cancellation failed')
      })
      const onError = vi.fn()

      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
        onError,
      })

      const result = await cleanupManager.cleanup()

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'pendingOperations' })
      )
      expect(result.errors).toContainEqual(
        expect.objectContaining({ phase: 'pendingOperations' })
      )
    })
  })

  describe('idempotent cleanup (multiple calls)', () => {
    beforeEach(() => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
      })
    })

    it('should be safe to call cleanup multiple times', async () => {
      await cleanupManager.cleanup()
      await cleanupManager.cleanup()
      await cleanupManager.cleanup()

      // Should only perform cleanup once
      expect(mockChangeStream.close).toHaveBeenCalledTimes(1)
      expect(mockClient.disconnect).toHaveBeenCalledTimes(1)
      expect(mockEventBuffer.clear).toHaveBeenCalledTimes(1)
      expect(mockPendingOperations.cancel).toHaveBeenCalledTimes(1)
    })

    it('should return same result for subsequent cleanup calls', async () => {
      const result1 = await cleanupManager.cleanup()
      const result2 = await cleanupManager.cleanup()
      const result3 = await cleanupManager.cleanup()

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      expect(result3.success).toBe(true)
      expect(result2.alreadyCleanedUp).toBe(true)
      expect(result3.alreadyCleanedUp).toBe(true)
    })

    it('should update state to cleaned_up after first cleanup', async () => {
      expect(cleanupManager.state).toBe('idle')

      await cleanupManager.cleanup()

      expect(cleanupManager.state).toBe('cleaned_up')
      expect(cleanupManager.isCleanedUp).toBe(true)
    })

    it('should not throw when cleanup is called during cleanup', async () => {
      // Simulate slow cleanup
      mockChangeStream.close = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      )

      vi.useFakeTimers()

      const cleanup1 = cleanupManager.cleanup()
      await vi.advanceTimersByTimeAsync(50)

      // Call cleanup again while first is in progress
      const cleanup2 = cleanupManager.cleanup()

      await vi.advanceTimersByTimeAsync(100)

      const [result1, result2] = await Promise.all([cleanup1, cleanup2])

      // Both should succeed without throwing
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)

      vi.useRealTimers()
    })

    it('should handle concurrent cleanup calls', async () => {
      const results = await Promise.all([
        cleanupManager.cleanup(),
        cleanupManager.cleanup(),
        cleanupManager.cleanup(),
      ])

      // All should succeed
      results.forEach((result) => {
        expect(result.success).toBe(true)
      })

      // But only one should have actually performed the cleanup
      expect(mockChangeStream.close).toHaveBeenCalledTimes(1)
    })
  })

  describe('cleanup state tracking', () => {
    beforeEach(() => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
      })
    })

    it('should track cleanup state transitions', async () => {
      const states: SyncCleanupState[] = []

      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
        onStateChange: (state) => states.push(state),
      })

      await cleanupManager.cleanup()

      expect(states).toContain('cleaning_up')
      expect(states).toContain('cleaned_up')
    })

    it('should expose current cleanup phase', async () => {
      const phases: string[] = []

      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
        onProgress: (phase) => phases.push(phase),
      })

      await cleanupManager.cleanup()

      expect(phases).toContain('changeStream')
      expect(phases).toContain('client')
      expect(phases).toContain('eventBuffer')
      expect(phases).toContain('pendingOperations')
    })
  })

  describe('cleanup result', () => {
    beforeEach(() => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
      })
    })

    it('should return comprehensive cleanup result', async () => {
      const result = await cleanupManager.cleanup()

      expect(result).toMatchObject({
        success: true,
        durationMs: expect.any(Number),
        clearedEvents: expect.any(Number),
        cancelledOperations: expect.any(Number),
        errors: [],
        timedOut: false,
        alreadyCleanedUp: false,
      })
    })

    it('should report partial success when some phases fail', async () => {
      mockChangeStream.close = vi.fn().mockRejectedValue(new Error('Close failed'))

      const result = await cleanupManager.cleanup()

      expect(result.success).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      // Other cleanup steps should still have been attempted
      expect(mockClient.disconnect).toHaveBeenCalled()
      expect(mockEventBuffer.clear).toHaveBeenCalled()
    })

    it('should measure cleanup duration', async () => {
      mockChangeStream.close = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 50))
      )

      vi.useFakeTimers()

      const cleanupPromise = cleanupManager.cleanup()
      await vi.advanceTimersByTimeAsync(50)

      const result = await cleanupPromise

      expect(result.durationMs).toBeGreaterThanOrEqual(50)

      vi.useRealTimers()
    })
  })

  describe('optional resources', () => {
    it('should handle missing change stream', async () => {
      cleanupManager = new SyncCleanupManager({
        changeStream: undefined,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
      })

      const result = await cleanupManager.cleanup()

      expect(result.success).toBe(true)
      expect(mockClient.disconnect).toHaveBeenCalled()
    })

    it('should handle missing client', async () => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: undefined,
        eventBuffer: mockEventBuffer,
        pendingOperations: mockPendingOperations,
      })

      const result = await cleanupManager.cleanup()

      expect(result.success).toBe(true)
      expect(mockChangeStream.close).toHaveBeenCalled()
    })

    it('should handle missing event buffer', async () => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: undefined,
        pendingOperations: mockPendingOperations,
      })

      const result = await cleanupManager.cleanup()

      expect(result.success).toBe(true)
      expect(result.clearedEvents).toBe(0)
    })

    it('should handle missing pending operations manager', async () => {
      cleanupManager = new SyncCleanupManager({
        changeStream: mockChangeStream,
        client: mockClient,
        eventBuffer: mockEventBuffer,
        pendingOperations: undefined,
      })

      const result = await cleanupManager.cleanup()

      expect(result.success).toBe(true)
      expect(result.cancelledOperations).toBe(0)
    })

    it('should handle all resources missing', async () => {
      cleanupManager = new SyncCleanupManager({})

      const result = await cleanupManager.cleanup()

      expect(result.success).toBe(true)
      expect(result.clearedEvents).toBe(0)
      expect(result.cancelledOperations).toBe(0)
    })
  })
})

describe('createSyncCleanup', () => {
  let mockChangeStream: MockChangeStream
  let mockClient: MockMongoDoClient
  let mockEventBuffer: MockEventBuffer
  let mockPendingOperations: MockPendingOperations

  beforeEach(() => {
    mockChangeStream = {
      close: vi.fn().mockResolvedValue(undefined),
      isClosed: vi.fn().mockReturnValue(false),
    }

    mockClient = {
      disconnect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    }

    mockEventBuffer = {
      clear: vi.fn(),
      size: vi.fn().mockReturnValue(5),
      getEvents: vi.fn().mockReturnValue([]),
    }

    mockPendingOperations = {
      cancel: vi.fn(),
      getPending: vi.fn().mockReturnValue([]),
      hasPending: vi.fn().mockReturnValue(false),
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should create a cleanup function', () => {
    const cleanup = createSyncCleanup({
      changeStream: mockChangeStream,
      client: mockClient,
      eventBuffer: mockEventBuffer,
      pendingOperations: mockPendingOperations,
    })

    expect(cleanup).toBeInstanceOf(Function)
  })

  it('should return cleanup function that performs all cleanup steps', async () => {
    const cleanup = createSyncCleanup({
      changeStream: mockChangeStream,
      client: mockClient,
      eventBuffer: mockEventBuffer,
      pendingOperations: mockPendingOperations,
    })

    await cleanup()

    expect(mockChangeStream.close).toHaveBeenCalled()
    expect(mockClient.disconnect).toHaveBeenCalled()
    expect(mockEventBuffer.clear).toHaveBeenCalled()
  })

  it('should be idempotent', async () => {
    const cleanup = createSyncCleanup({
      changeStream: mockChangeStream,
      client: mockClient,
      eventBuffer: mockEventBuffer,
      pendingOperations: mockPendingOperations,
    })

    await cleanup()
    await cleanup()
    await cleanup()

    expect(mockChangeStream.close).toHaveBeenCalledTimes(1)
  })

  it('should not throw on errors', async () => {
    mockChangeStream.close = vi.fn().mockRejectedValue(new Error('Failed'))

    const cleanup = createSyncCleanup({
      changeStream: mockChangeStream,
      client: mockClient,
      eventBuffer: mockEventBuffer,
      pendingOperations: mockPendingOperations,
    })

    // Should not throw
    await expect(cleanup()).resolves.toBeUndefined()
  })
})
