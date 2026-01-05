/**
 * Ready Signal Handler Tests (TDD RED Phase)
 *
 * These tests verify the ReadySignalHandler class which manages the
 * synchronization "ready" state for MongoDB change stream sync operations.
 *
 * The ReadySignalHandler is responsible for:
 * 1. Tracking when initial sync is complete
 * 2. Buffering events received during initial sync
 * 3. Processing buffered events before signaling ready
 * 4. Ensuring ready is only signaled once
 * 5. Handling errors that occur before ready state
 *
 * RED PHASE: These tests will fail until ReadySignalHandler is implemented
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ReadySignalHandler } from '../../src/sync/ready-signal'
import type { ChangeMessage } from '../../src/types'

// Test document type
interface TestDocument {
  _id: string
  name: string
  value: number
}

describe('ReadySignalHandler', () => {
  let handler: ReadySignalHandler<TestDocument>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (handler) {
      handler.dispose()
    }
  })

  describe('construction', () => {
    it('should create handler with default configuration', () => {
      handler = new ReadySignalHandler<TestDocument>()

      expect(handler).toBeInstanceOf(ReadySignalHandler)
    })

    it('should accept custom configuration', () => {
      const onReady = vi.fn()
      const onError = vi.fn()

      handler = new ReadySignalHandler<TestDocument>({
        onReady,
        onError,
      })

      expect(handler).toBeInstanceOf(ReadySignalHandler)
    })

    it('should start in not-ready state', () => {
      handler = new ReadySignalHandler<TestDocument>()

      expect(handler.isReady).toBe(false)
    })
  })

  describe('calls markReady after initial sync', () => {
    it('should call onReady callback when markReady is invoked', () => {
      const onReady = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({ onReady })

      handler.markReady()

      expect(onReady).toHaveBeenCalledTimes(1)
    })

    it('should set isReady to true after markReady', () => {
      handler = new ReadySignalHandler<TestDocument>()

      expect(handler.isReady).toBe(false)

      handler.markReady()

      expect(handler.isReady).toBe(true)
    })

    it('should emit ready event when markReady is called', () => {
      handler = new ReadySignalHandler<TestDocument>()

      const readyListener = vi.fn()
      handler.on('ready', readyListener)

      handler.markReady()

      expect(readyListener).toHaveBeenCalledTimes(1)
    })

    it('should allow awaiting ready state via promise', async () => {
      handler = new ReadySignalHandler<TestDocument>()

      // Start waiting for ready
      const readyPromise = handler.waitForReady()

      // Mark ready after a short delay
      setTimeout(() => handler.markReady(), 10)

      await expect(readyPromise).resolves.toBeUndefined()
      expect(handler.isReady).toBe(true)
    })

    it('should immediately resolve waitForReady if already ready', async () => {
      handler = new ReadySignalHandler<TestDocument>()
      handler.markReady()

      const start = Date.now()
      await handler.waitForReady()
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(10)
    })
  })

  describe('processes buffered events first', () => {
    it('should buffer events received before ready', () => {
      handler = new ReadySignalHandler<TestDocument>()

      const event: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 42 },
      }

      handler.bufferEvent(event)

      expect(handler.bufferedEventCount).toBe(1)
    })

    it('should buffer multiple events in order', () => {
      handler = new ReadySignalHandler<TestDocument>()

      const events: ChangeMessage<TestDocument>[] = [
        { type: 'insert', key: 'doc-1', value: { _id: 'doc-1', name: 'First', value: 1 } },
        { type: 'insert', key: 'doc-2', value: { _id: 'doc-2', name: 'Second', value: 2 } },
        { type: 'update', key: 'doc-1', value: { _id: 'doc-1', name: 'Updated', value: 10 } },
      ]

      events.forEach((event) => handler.bufferEvent(event))

      expect(handler.bufferedEventCount).toBe(3)
    })

    it('should process all buffered events when markReady is called', () => {
      const eventProcessor = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({
        eventProcessor,
      })

      const events: ChangeMessage<TestDocument>[] = [
        { type: 'insert', key: 'doc-1', value: { _id: 'doc-1', name: 'First', value: 1 } },
        { type: 'insert', key: 'doc-2', value: { _id: 'doc-2', name: 'Second', value: 2 } },
        { type: 'update', key: 'doc-1', value: { _id: 'doc-1', name: 'Updated', value: 10 } },
      ]

      events.forEach((event) => handler.bufferEvent(event))

      handler.markReady()

      expect(eventProcessor).toHaveBeenCalledTimes(3)
      expect(eventProcessor).toHaveBeenNthCalledWith(1, events[0])
      expect(eventProcessor).toHaveBeenNthCalledWith(2, events[1])
      expect(eventProcessor).toHaveBeenNthCalledWith(3, events[2])
    })

    it('should process buffered events before calling onReady', () => {
      const callOrder: string[] = []

      handler = new ReadySignalHandler<TestDocument>({
        eventProcessor: () => {
          callOrder.push('event')
        },
        onReady: () => {
          callOrder.push('ready')
        },
      })

      handler.bufferEvent({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 1 },
      })

      handler.bufferEvent({
        type: 'insert',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Test', value: 2 },
      })

      handler.markReady()

      expect(callOrder).toEqual(['event', 'event', 'ready'])
    })

    it('should clear buffer after processing', () => {
      const eventProcessor = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({ eventProcessor })

      handler.bufferEvent({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 1 },
      })

      expect(handler.bufferedEventCount).toBe(1)

      handler.markReady()

      expect(handler.bufferedEventCount).toBe(0)
    })

    it('should process events directly after ready (no buffering)', () => {
      const eventProcessor = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({ eventProcessor })

      handler.markReady()

      const event: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 1 },
      }

      handler.processEvent(event)

      expect(eventProcessor).toHaveBeenCalledWith(event)
      expect(handler.bufferedEventCount).toBe(0)
    })

    it('should buffer events when using processEvent before ready', () => {
      const eventProcessor = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({ eventProcessor })

      const event: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 1 },
      }

      handler.processEvent(event)

      // Event should be buffered, not processed
      expect(eventProcessor).not.toHaveBeenCalled()
      expect(handler.bufferedEventCount).toBe(1)

      handler.markReady()

      // Now it should be processed
      expect(eventProcessor).toHaveBeenCalledWith(event)
    })
  })

  describe('only signals ready once', () => {
    it('should only call onReady callback once on multiple markReady calls', () => {
      const onReady = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({ onReady })

      handler.markReady()
      handler.markReady()
      handler.markReady()

      expect(onReady).toHaveBeenCalledTimes(1)
    })

    it('should only emit ready event once', () => {
      handler = new ReadySignalHandler<TestDocument>()

      const readyListener = vi.fn()
      handler.on('ready', readyListener)

      handler.markReady()
      handler.markReady()
      handler.markReady()

      expect(readyListener).toHaveBeenCalledTimes(1)
    })

    it('should log warning on subsequent markReady calls', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      handler = new ReadySignalHandler<TestDocument>()

      handler.markReady()
      handler.markReady()

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already ready')
      )

      warnSpy.mockRestore()
    })

    it('should not reprocess buffered events on subsequent markReady calls', () => {
      const eventProcessor = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({ eventProcessor })

      handler.bufferEvent({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 1 },
      })

      handler.markReady()
      handler.markReady()

      expect(eventProcessor).toHaveBeenCalledTimes(1)
    })

    it('should remain in ready state after multiple markReady calls', () => {
      handler = new ReadySignalHandler<TestDocument>()

      handler.markReady()
      expect(handler.isReady).toBe(true)

      handler.markReady()
      expect(handler.isReady).toBe(true)

      handler.markReady()
      expect(handler.isReady).toBe(true)
    })
  })

  describe('handles errors before ready', () => {
    it('should call onError callback when error occurs before ready', () => {
      const onError = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({ onError })

      const error = new Error('Initial sync failed')
      handler.handleError(error)

      expect(onError).toHaveBeenCalledWith(error)
    })

    it('should emit error event when error occurs', () => {
      handler = new ReadySignalHandler<TestDocument>()

      const errorListener = vi.fn()
      handler.on('error', errorListener)

      const error = new Error('Connection lost')
      handler.handleError(error)

      expect(errorListener).toHaveBeenCalledWith(error)
    })

    it('should set error state when error occurs before ready', () => {
      handler = new ReadySignalHandler<TestDocument>()

      expect(handler.hasError).toBe(false)

      handler.handleError(new Error('Failed'))

      expect(handler.hasError).toBe(true)
    })

    it('should store the error for later retrieval', () => {
      handler = new ReadySignalHandler<TestDocument>()

      const error = new Error('Specific error message')
      handler.handleError(error)

      expect(handler.lastError).toBe(error)
    })

    it('should reject waitForReady promise when error occurs', async () => {
      handler = new ReadySignalHandler<TestDocument>()

      const readyPromise = handler.waitForReady()

      const error = new Error('Sync failed')
      handler.handleError(error)

      await expect(readyPromise).rejects.toThrow('Sync failed')
    })

    it('should clear buffered events on error', () => {
      handler = new ReadySignalHandler<TestDocument>()

      handler.bufferEvent({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 1 },
      })

      expect(handler.bufferedEventCount).toBe(1)

      handler.handleError(new Error('Failed'))

      expect(handler.bufferedEventCount).toBe(0)
    })

    it('should not call onReady after error', () => {
      const onReady = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({ onReady })

      handler.handleError(new Error('Failed'))
      handler.markReady()

      expect(onReady).not.toHaveBeenCalled()
    })

    it('should not process buffered events after error', () => {
      const eventProcessor = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({ eventProcessor })

      handler.bufferEvent({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 1 },
      })

      handler.handleError(new Error('Failed'))
      handler.markReady()

      expect(eventProcessor).not.toHaveBeenCalled()
    })

    it('should allow reset after error', () => {
      const onReady = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({ onReady })

      handler.handleError(new Error('Failed'))
      expect(handler.hasError).toBe(true)
      expect(handler.isReady).toBe(false)

      handler.reset()

      expect(handler.hasError).toBe(false)
      expect(handler.isReady).toBe(false)
      expect(handler.lastError).toBeUndefined()

      handler.markReady()
      expect(onReady).toHaveBeenCalledTimes(1)
    })

    it('should handle errors thrown during event processing', () => {
      const onError = vi.fn()
      const eventProcessor = vi.fn().mockImplementation(() => {
        throw new Error('Processing failed')
      })

      handler = new ReadySignalHandler<TestDocument>({
        eventProcessor,
        onError,
      })

      handler.bufferEvent({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 1 },
      })

      handler.markReady()

      expect(onError).toHaveBeenCalledWith(expect.any(Error))
      expect(handler.hasError).toBe(true)
    })
  })

  describe('lifecycle and disposal', () => {
    it('should clean up resources on dispose', () => {
      handler = new ReadySignalHandler<TestDocument>()

      handler.bufferEvent({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 1 },
      })

      handler.dispose()

      expect(handler.bufferedEventCount).toBe(0)
    })

    it('should remove all event listeners on dispose', () => {
      handler = new ReadySignalHandler<TestDocument>()

      const readyListener = vi.fn()
      const errorListener = vi.fn()

      handler.on('ready', readyListener)
      handler.on('error', errorListener)

      handler.dispose()

      handler.markReady()
      handler.handleError(new Error('Test'))

      expect(readyListener).not.toHaveBeenCalled()
      expect(errorListener).not.toHaveBeenCalled()
    })

    it('should reject pending waitForReady promises on dispose', async () => {
      handler = new ReadySignalHandler<TestDocument>()

      const readyPromise = handler.waitForReady()

      handler.dispose()

      await expect(readyPromise).rejects.toThrow(/disposed/i)
    })

    it('should return disposed state', () => {
      handler = new ReadySignalHandler<TestDocument>()

      expect(handler.isDisposed).toBe(false)

      handler.dispose()

      expect(handler.isDisposed).toBe(true)
    })

    it('should be idempotent on multiple dispose calls', () => {
      handler = new ReadySignalHandler<TestDocument>()

      expect(() => {
        handler.dispose()
        handler.dispose()
        handler.dispose()
      }).not.toThrow()
    })
  })

  describe('timeout handling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should timeout waitForReady if ready is never called', async () => {
      handler = new ReadySignalHandler<TestDocument>({
        readyTimeout: 5000,
      })

      const readyPromise = handler.waitForReady()

      vi.advanceTimersByTime(5000)

      await expect(readyPromise).rejects.toThrow(/timeout/i)
    })

    it('should not timeout if ready is called before timeout', async () => {
      handler = new ReadySignalHandler<TestDocument>({
        readyTimeout: 5000,
      })

      const readyPromise = handler.waitForReady()

      vi.advanceTimersByTime(2500)
      handler.markReady()

      await expect(readyPromise).resolves.toBeUndefined()
    })

    it('should cancel timeout when ready is called', async () => {
      const onError = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({
        readyTimeout: 5000,
        onError,
      })

      handler.waitForReady().catch(() => {})

      handler.markReady()

      vi.advanceTimersByTime(10000)

      expect(onError).not.toHaveBeenCalled()
      expect(handler.hasError).toBe(false)
    })

    it('should cancel timeout on dispose', async () => {
      const onError = vi.fn()
      handler = new ReadySignalHandler<TestDocument>({
        readyTimeout: 5000,
        onError,
      })

      handler.waitForReady().catch(() => {})

      handler.dispose()

      vi.advanceTimersByTime(10000)

      // onError should not be called for timeout after dispose
      expect(onError).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('timeout') })
      )
    })
  })

  describe('statistics and debugging', () => {
    it('should track number of buffered events', () => {
      handler = new ReadySignalHandler<TestDocument>()

      expect(handler.bufferedEventCount).toBe(0)

      handler.bufferEvent({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 1 },
      })

      expect(handler.bufferedEventCount).toBe(1)

      handler.bufferEvent({
        type: 'insert',
        key: 'doc-2',
        value: { _id: 'doc-2', name: 'Test', value: 2 },
      })

      expect(handler.bufferedEventCount).toBe(2)
    })

    it('should provide stats snapshot', () => {
      handler = new ReadySignalHandler<TestDocument>()

      handler.bufferEvent({
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', value: 1 },
      })

      handler.bufferEvent({
        type: 'update',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Updated', value: 10 },
      })

      const stats = handler.getStats()

      expect(stats).toEqual(
        expect.objectContaining({
          isReady: false,
          hasError: false,
          bufferedEventCount: 2,
        })
      )
    })

    it('should track time spent waiting for ready', () => {
      vi.useFakeTimers()

      handler = new ReadySignalHandler<TestDocument>()

      vi.advanceTimersByTime(1000)

      handler.markReady()

      const stats = handler.getStats()

      expect(stats.readyAfterMs).toBeGreaterThanOrEqual(1000)

      vi.useRealTimers()
    })
  })
})
