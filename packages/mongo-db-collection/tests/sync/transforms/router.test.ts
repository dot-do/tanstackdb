/**
 * Change Event Router Tests (TDD RED Phase)
 *
 * These tests verify the ChangeEventRouter class which:
 * 1. Routes MongoDB change stream events to appropriate handlers
 * 2. Transforms MongoDB events to TanStack DB ChangeMessage format
 * 3. Supports event filtering based on operation type
 * 4. Handles event batching for bulk operations
 * 5. Manages handler registration and lifecycle
 * 6. Provides error handling and recovery
 *
 * RED PHASE: These tests will fail until ChangeEventRouter is implemented
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChangeEventRouter } from '../../../src/sync/transforms/router'
import type {
  MongoChangeEvent,
  MongoInsertEvent,
  MongoUpdateEvent,
  MongoDeleteEvent,
  MongoReplaceEvent,
  ChangeMessage,
} from '../../../src/types'
import type {
  ChangeEventRouterConfig,
  ChangeEventHandler,
  EventFilter,
  RouterStats,
} from '../../../src/sync/transforms/types'

// Test document type
interface TestDocument {
  _id: string
  name: string
  value: number
  tags?: string[]
  metadata?: Record<string, unknown>
}

describe('ChangeEventRouter', () => {
  let router: ChangeEventRouter<TestDocument>
  let mockHandler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockHandler = vi.fn()
  })

  afterEach(() => {
    if (router) {
      router.dispose()
    }
    vi.clearAllMocks()
  })

  describe('construction and configuration', () => {
    it('should create router with default configuration', () => {
      router = new ChangeEventRouter<TestDocument>({})

      expect(router).toBeInstanceOf(ChangeEventRouter)
    })

    it('should accept custom configuration', () => {
      const config: ChangeEventRouterConfig<TestDocument> = {
        batchSize: 100,
        batchTimeoutMs: 50,
        enableMetrics: true,
        errorHandler: vi.fn(),
      }

      router = new ChangeEventRouter<TestDocument>(config)

      expect(router).toBeInstanceOf(ChangeEventRouter)
    })

    it('should validate batch size is positive', () => {
      expect(
        () =>
          new ChangeEventRouter<TestDocument>({
            batchSize: 0,
          })
      ).toThrow(/batchSize/i)
    })

    it('should validate batch timeout is positive', () => {
      expect(
        () =>
          new ChangeEventRouter<TestDocument>({
            batchTimeoutMs: -1,
          })
      ).toThrow(/batchTimeout/i)
    })
  })

  describe('handler registration', () => {
    beforeEach(() => {
      router = new ChangeEventRouter<TestDocument>({})
    })

    it('should register a handler for all events', () => {
      const unsubscribe = router.onEvent(mockHandler)

      expect(unsubscribe).toBeInstanceOf(Function)
    })

    it('should register a handler for specific operation type', () => {
      const insertHandler = vi.fn()
      const unsubscribe = router.onEvent(insertHandler, { operationType: 'insert' })

      expect(unsubscribe).toBeInstanceOf(Function)
    })

    it('should register multiple handlers', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()

      router.onEvent(handler1)
      router.onEvent(handler2, { operationType: 'insert' })
      router.onEvent(handler3, { operationType: 'delete' })

      expect(router.handlerCount).toBe(3)
    })

    it('should unregister handler when unsubscribe is called', () => {
      const handler = vi.fn()
      const unsubscribe = router.onEvent(handler)

      expect(router.handlerCount).toBe(1)

      unsubscribe()

      expect(router.handlerCount).toBe(0)
    })

    it('should not fail when unsubscribe is called multiple times', () => {
      const handler = vi.fn()
      const unsubscribe = router.onEvent(handler)

      unsubscribe()
      expect(() => unsubscribe()).not.toThrow()
    })
  })

  describe('event routing - insert events', () => {
    beforeEach(() => {
      router = new ChangeEventRouter<TestDocument>({})
    })

    it('should route insert events to all-event handlers', async () => {
      router.onEvent(mockHandler)

      const insertEvent: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 42 },
        documentKey: { _id: 'doc-1' },
      }

      await router.routeEvent(insertEvent)

      expect(mockHandler).toHaveBeenCalledTimes(1)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          key: 'doc-1',
          value: { _id: 'doc-1', name: 'Test', value: 42 },
        })
      )
    })

    it('should route insert events to insert-specific handlers', async () => {
      const insertHandler = vi.fn()
      const updateHandler = vi.fn()

      router.onEvent(insertHandler, { operationType: 'insert' })
      router.onEvent(updateHandler, { operationType: 'update' })

      const insertEvent: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 42 },
        documentKey: { _id: 'doc-1' },
      }

      await router.routeEvent(insertEvent)

      expect(insertHandler).toHaveBeenCalledTimes(1)
      expect(updateHandler).not.toHaveBeenCalled()
    })

    it('should transform insert event to ChangeMessage format', async () => {
      let receivedMessage: ChangeMessage<TestDocument> | undefined

      router.onEvent((msg) => {
        receivedMessage = msg
      })

      const insertEvent: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 42 },
        documentKey: { _id: 'doc-1' },
      }

      await router.routeEvent(insertEvent)

      expect(receivedMessage).toBeDefined()
      expect(receivedMessage!.type).toBe('insert')
      expect(receivedMessage!.key).toBe('doc-1')
      expect(receivedMessage!.value).toEqual({ _id: 'doc-1', name: 'Test', value: 42 })
      expect(receivedMessage!.previousValue).toBeUndefined()
    })
  })

  describe('event routing - update events', () => {
    beforeEach(() => {
      router = new ChangeEventRouter<TestDocument>({})
    })

    it('should route update events to all-event handlers', async () => {
      router.onEvent(mockHandler)

      const updateEvent: MongoUpdateEvent<TestDocument> = {
        operationType: 'update',
        fullDocument: { _id: 'doc-1', name: 'Updated', value: 100 },
        documentKey: { _id: 'doc-1' },
        updateDescription: {
          updatedFields: { name: 'Updated', value: 100 },
          removedFields: [],
        },
      }

      await router.routeEvent(updateEvent)

      expect(mockHandler).toHaveBeenCalledTimes(1)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'update',
          key: 'doc-1',
          value: { _id: 'doc-1', name: 'Updated', value: 100 },
        })
      )
    })

    it('should route update events to update-specific handlers', async () => {
      const insertHandler = vi.fn()
      const updateHandler = vi.fn()

      router.onEvent(insertHandler, { operationType: 'insert' })
      router.onEvent(updateHandler, { operationType: 'update' })

      const updateEvent: MongoUpdateEvent<TestDocument> = {
        operationType: 'update',
        fullDocument: { _id: 'doc-1', name: 'Updated', value: 100 },
        documentKey: { _id: 'doc-1' },
        updateDescription: {
          updatedFields: { name: 'Updated', value: 100 },
          removedFields: [],
        },
      }

      await router.routeEvent(updateEvent)

      expect(updateHandler).toHaveBeenCalledTimes(1)
      expect(insertHandler).not.toHaveBeenCalled()
    })

    it('should include update description in metadata', async () => {
      let receivedMessage: ChangeMessage<TestDocument> | undefined

      router.onEvent((msg) => {
        receivedMessage = msg
      })

      const updateEvent: MongoUpdateEvent<TestDocument> = {
        operationType: 'update',
        fullDocument: { _id: 'doc-1', name: 'Updated', value: 100 },
        documentKey: { _id: 'doc-1' },
        updateDescription: {
          updatedFields: { name: 'Updated' },
          removedFields: ['tags'],
        },
      }

      await router.routeEvent(updateEvent)

      expect(receivedMessage).toBeDefined()
      expect(receivedMessage!.metadata).toBeDefined()
      expect(receivedMessage!.metadata!.updatedFields).toEqual({ name: 'Updated' })
      expect(receivedMessage!.metadata!.removedFields).toEqual(['tags'])
    })
  })

  describe('event routing - delete events', () => {
    beforeEach(() => {
      router = new ChangeEventRouter<TestDocument>({})
    })

    it('should route delete events to all-event handlers', async () => {
      router.onEvent(mockHandler)

      const deleteEvent: MongoDeleteEvent<TestDocument> = {
        operationType: 'delete',
        documentKey: { _id: 'doc-1' },
      }

      await router.routeEvent(deleteEvent)

      expect(mockHandler).toHaveBeenCalledTimes(1)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'delete',
          key: 'doc-1',
        })
      )
    })

    it('should route delete events to delete-specific handlers', async () => {
      const insertHandler = vi.fn()
      const deleteHandler = vi.fn()

      router.onEvent(insertHandler, { operationType: 'insert' })
      router.onEvent(deleteHandler, { operationType: 'delete' })

      const deleteEvent: MongoDeleteEvent<TestDocument> = {
        operationType: 'delete',
        documentKey: { _id: 'doc-1' },
      }

      await router.routeEvent(deleteEvent)

      expect(deleteHandler).toHaveBeenCalledTimes(1)
      expect(insertHandler).not.toHaveBeenCalled()
    })

    it('should create delete ChangeMessage with empty value', async () => {
      let receivedMessage: ChangeMessage<TestDocument> | undefined

      router.onEvent((msg) => {
        receivedMessage = msg
      })

      const deleteEvent: MongoDeleteEvent<TestDocument> = {
        operationType: 'delete',
        documentKey: { _id: 'doc-1' },
      }

      await router.routeEvent(deleteEvent)

      expect(receivedMessage).toBeDefined()
      expect(receivedMessage!.type).toBe('delete')
      expect(receivedMessage!.key).toBe('doc-1')
      // Delete events don't have fullDocument, so value should be a minimal placeholder
      expect(receivedMessage!.value).toBeDefined()
    })
  })

  describe('event routing - replace events', () => {
    beforeEach(() => {
      router = new ChangeEventRouter<TestDocument>({})
    })

    it('should route replace events as update type', async () => {
      router.onEvent(mockHandler)

      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: { _id: 'doc-1', name: 'Replaced', value: 999 },
        documentKey: { _id: 'doc-1' },
      }

      await router.routeEvent(replaceEvent)

      expect(mockHandler).toHaveBeenCalledTimes(1)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'update',
          key: 'doc-1',
          value: { _id: 'doc-1', name: 'Replaced', value: 999 },
        })
      )
    })

    it('should include replace indicator in metadata', async () => {
      let receivedMessage: ChangeMessage<TestDocument> | undefined

      router.onEvent((msg) => {
        receivedMessage = msg
      })

      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: { _id: 'doc-1', name: 'Replaced', value: 999 },
        documentKey: { _id: 'doc-1' },
      }

      await router.routeEvent(replaceEvent)

      expect(receivedMessage).toBeDefined()
      expect(receivedMessage!.metadata).toBeDefined()
      expect(receivedMessage!.metadata!.isReplace).toBe(true)
    })
  })

  describe('event filtering', () => {
    beforeEach(() => {
      router = new ChangeEventRouter<TestDocument>({})
    })

    it('should filter events by custom filter function', async () => {
      const handler = vi.fn()

      const filter: EventFilter<TestDocument> = (event) => {
        if (event.operationType === 'insert' || event.operationType === 'update' || event.operationType === 'replace') {
          return event.fullDocument.value > 50
        }
        return false
      }

      router.onEvent(handler, { filter })

      // Should pass filter
      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'High', value: 100 },
        documentKey: { _id: 'doc-1' },
      })

      // Should not pass filter
      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-2', name: 'Low', value: 25 },
        documentKey: { _id: 'doc-2' },
      })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'doc-1',
        })
      )
    })

    it('should support multiple operation types filter', async () => {
      const handler = vi.fn()

      router.onEvent(handler, { operationTypes: ['insert', 'update'] })

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      await router.routeEvent({
        operationType: 'update',
        fullDocument: { _id: 'doc-2', name: 'Test', value: 2 },
        documentKey: { _id: 'doc-2' },
        updateDescription: { updatedFields: {}, removedFields: [] },
      })

      await router.routeEvent({
        operationType: 'delete',
        documentKey: { _id: 'doc-3' },
      })

      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('should support document key prefix filter', async () => {
      const handler = vi.fn()

      router.onEvent(handler, { keyPrefix: 'user-' })

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'user-123', name: 'User', value: 1 },
        documentKey: { _id: 'user-123' },
      })

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'product-456', name: 'Product', value: 2 },
        documentKey: { _id: 'product-456' },
      })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'user-123',
        })
      )
    })
  })

  describe('event batching', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should batch events within time window', async () => {
      router = new ChangeEventRouter<TestDocument>({
        batchSize: 10,
        batchTimeoutMs: 50,
      })

      const batchHandler = vi.fn()
      router.onBatch(batchHandler)

      // Add events within batch window
      router.queueEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test1', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      router.queueEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-2', name: 'Test2', value: 2 },
        documentKey: { _id: 'doc-2' },
      })

      router.queueEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-3', name: 'Test3', value: 3 },
        documentKey: { _id: 'doc-3' },
      })

      // Before timeout
      expect(batchHandler).not.toHaveBeenCalled()

      // After timeout
      await vi.advanceTimersByTimeAsync(50)

      expect(batchHandler).toHaveBeenCalledTimes(1)
      expect(batchHandler).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ key: 'doc-1' }),
          expect.objectContaining({ key: 'doc-2' }),
          expect.objectContaining({ key: 'doc-3' }),
        ])
      )
    })

    it('should flush batch when size limit is reached', async () => {
      router = new ChangeEventRouter<TestDocument>({
        batchSize: 3,
        batchTimeoutMs: 1000, // Long timeout
      })

      const batchHandler = vi.fn()
      router.onBatch(batchHandler)

      // Add events up to batch size
      router.queueEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test1', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      router.queueEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-2', name: 'Test2', value: 2 },
        documentKey: { _id: 'doc-2' },
      })

      expect(batchHandler).not.toHaveBeenCalled()

      router.queueEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-3', name: 'Test3', value: 3 },
        documentKey: { _id: 'doc-3' },
      })

      // Should flush immediately when batch size reached
      await vi.advanceTimersByTimeAsync(0)

      expect(batchHandler).toHaveBeenCalledTimes(1)
      expect(batchHandler).toHaveBeenCalledWith(expect.any(Array))
      expect(batchHandler.mock.calls[0][0]).toHaveLength(3)
    })

    it('should support manual batch flush', async () => {
      router = new ChangeEventRouter<TestDocument>({
        batchSize: 100,
        batchTimeoutMs: 10000,
      })

      const batchHandler = vi.fn()
      router.onBatch(batchHandler)

      router.queueEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test1', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      expect(batchHandler).not.toHaveBeenCalled()

      await router.flushBatch()

      expect(batchHandler).toHaveBeenCalledTimes(1)
    })

    it('should not call batch handler when flushing empty batch', async () => {
      router = new ChangeEventRouter<TestDocument>({})

      const batchHandler = vi.fn()
      router.onBatch(batchHandler)

      await router.flushBatch()

      expect(batchHandler).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      router = new ChangeEventRouter<TestDocument>({})
    })

    it('should catch and report handler errors', async () => {
      const errorHandler = vi.fn()

      router = new ChangeEventRouter<TestDocument>({
        errorHandler,
      })

      const failingHandler = vi.fn().mockRejectedValue(new Error('Handler failed'))
      router.onEvent(failingHandler)

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      expect(errorHandler).toHaveBeenCalledTimes(1)
      expect(errorHandler).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          type: 'insert',
          key: 'doc-1',
        })
      )
    })

    it('should continue processing after handler error', async () => {
      const errorHandler = vi.fn()

      router = new ChangeEventRouter<TestDocument>({
        errorHandler,
      })

      const failingHandler = vi.fn().mockRejectedValueOnce(new Error('First failed'))
      const successHandler = vi.fn()

      router.onEvent(failingHandler)
      router.onEvent(successHandler)

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      expect(failingHandler).toHaveBeenCalledTimes(1)
      expect(successHandler).toHaveBeenCalledTimes(1)
      expect(errorHandler).toHaveBeenCalledTimes(1)
    })

    it('should throw by default if no error handler configured', async () => {
      router = new ChangeEventRouter<TestDocument>({})

      const failingHandler = vi.fn().mockRejectedValue(new Error('Handler failed'))
      router.onEvent(failingHandler)

      await expect(
        router.routeEvent({
          operationType: 'insert',
          fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
          documentKey: { _id: 'doc-1' },
        })
      ).rejects.toThrow('Handler failed')
    })

    it('should allow swallowing errors with silent mode', async () => {
      router = new ChangeEventRouter<TestDocument>({
        silentErrors: true,
      })

      const failingHandler = vi.fn().mockRejectedValue(new Error('Handler failed'))
      router.onEvent(failingHandler)

      // Should not throw
      await expect(
        router.routeEvent({
          operationType: 'insert',
          fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
          documentKey: { _id: 'doc-1' },
        })
      ).resolves.toBeUndefined()
    })
  })

  describe('custom key extraction', () => {
    it('should use custom key extractor function', async () => {
      router = new ChangeEventRouter<TestDocument>({
        getKey: (event) => {
          if ('fullDocument' in event && event.fullDocument) {
            return `custom-${event.fullDocument._id}`
          }
          return `custom-${event.documentKey._id}`
        },
      })

      router.onEvent(mockHandler)

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'custom-doc-1',
        })
      )
    })

    it('should use documentKey._id by default', async () => {
      router = new ChangeEventRouter<TestDocument>({})

      router.onEvent(mockHandler)

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-123', name: 'Test', value: 1 },
        documentKey: { _id: 'doc-123' },
      })

      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'doc-123',
        })
      )
    })
  })

  describe('metrics and statistics', () => {
    it('should track event counts by operation type', async () => {
      router = new ChangeEventRouter<TestDocument>({
        enableMetrics: true,
      })

      router.onEvent(mockHandler)

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-2', name: 'Test', value: 2 },
        documentKey: { _id: 'doc-2' },
      })

      await router.routeEvent({
        operationType: 'update',
        fullDocument: { _id: 'doc-1', name: 'Updated', value: 10 },
        documentKey: { _id: 'doc-1' },
        updateDescription: { updatedFields: { name: 'Updated' }, removedFields: [] },
      })

      await router.routeEvent({
        operationType: 'delete',
        documentKey: { _id: 'doc-2' },
      })

      const stats: RouterStats = router.getStats()

      expect(stats.totalEvents).toBe(4)
      expect(stats.eventsByType.insert).toBe(2)
      expect(stats.eventsByType.update).toBe(1)
      expect(stats.eventsByType.delete).toBe(1)
    })

    it('should track handler execution count', async () => {
      router = new ChangeEventRouter<TestDocument>({
        enableMetrics: true,
      })

      const handler1 = vi.fn()
      const handler2 = vi.fn()

      router.onEvent(handler1)
      router.onEvent(handler2)

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      const stats = router.getStats()

      expect(stats.handlerExecutions).toBe(2)
    })

    it('should track error count', async () => {
      const errorHandler = vi.fn()

      router = new ChangeEventRouter<TestDocument>({
        enableMetrics: true,
        errorHandler,
      })

      const failingHandler = vi.fn().mockRejectedValue(new Error('Failed'))
      router.onEvent(failingHandler)

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      const stats = router.getStats()

      expect(stats.errors).toBe(1)
    })

    it('should reset stats on demand', async () => {
      router = new ChangeEventRouter<TestDocument>({
        enableMetrics: true,
      })

      router.onEvent(mockHandler)

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      expect(router.getStats().totalEvents).toBe(1)

      router.resetStats()

      expect(router.getStats().totalEvents).toBe(0)
    })

    it('should return empty stats when metrics disabled', () => {
      router = new ChangeEventRouter<TestDocument>({
        enableMetrics: false,
      })

      const stats = router.getStats()

      expect(stats.totalEvents).toBe(0)
      expect(stats.eventsByType).toEqual({})
    })
  })

  describe('lifecycle and disposal', () => {
    it('should remove all handlers on dispose', () => {
      router = new ChangeEventRouter<TestDocument>({})

      router.onEvent(vi.fn())
      router.onEvent(vi.fn())
      router.onEvent(vi.fn())

      expect(router.handlerCount).toBe(3)

      router.dispose()

      expect(router.handlerCount).toBe(0)
    })

    it('should reject new events after disposal', async () => {
      router = new ChangeEventRouter<TestDocument>({})

      router.dispose()

      await expect(
        router.routeEvent({
          operationType: 'insert',
          fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
          documentKey: { _id: 'doc-1' },
        })
      ).rejects.toThrow(/disposed/i)
    })

    it('should reject new handler registration after disposal', () => {
      router = new ChangeEventRouter<TestDocument>({})

      router.dispose()

      expect(() => router.onEvent(vi.fn())).toThrow(/disposed/i)
    })

    it('should flush pending batch on dispose', async () => {
      vi.useFakeTimers()

      router = new ChangeEventRouter<TestDocument>({
        batchSize: 100,
        batchTimeoutMs: 10000,
      })

      const batchHandler = vi.fn()
      router.onBatch(batchHandler)

      router.queueEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      router.dispose()

      await vi.advanceTimersByTimeAsync(0)

      expect(batchHandler).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })
  })

  describe('transform customization', () => {
    it('should support custom transform function', async () => {
      router = new ChangeEventRouter<TestDocument>({
        transform: (event) => {
          const baseMessage = router.defaultTransform(event)
          return {
            ...baseMessage,
            metadata: {
              ...baseMessage.metadata,
              customField: 'custom-value',
              transformedAt: Date.now(),
            },
          }
        },
      })

      let receivedMessage: ChangeMessage<TestDocument> | undefined
      router.onEvent((msg) => {
        receivedMessage = msg
      })

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      expect(receivedMessage).toBeDefined()
      expect(receivedMessage!.metadata!.customField).toBe('custom-value')
      expect(receivedMessage!.metadata!.transformedAt).toBeDefined()
    })

    it('should provide access to default transform', () => {
      router = new ChangeEventRouter<TestDocument>({})

      expect(router.defaultTransform).toBeInstanceOf(Function)

      const message = router.defaultTransform({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'Test', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      expect(message.type).toBe('insert')
      expect(message.key).toBe('doc-1')
    })
  })

  describe('concurrent event handling', () => {
    it('should handle concurrent events correctly', async () => {
      router = new ChangeEventRouter<TestDocument>({})

      const results: string[] = []
      router.onEvent(async (msg) => {
        results.push(msg.key)
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      const events = Array.from({ length: 10 }, (_, i) => ({
        operationType: 'insert' as const,
        fullDocument: { _id: `doc-${i}`, name: `Test${i}`, value: i },
        documentKey: { _id: `doc-${i}` },
      }))

      await Promise.all(events.map((e) => router.routeEvent(e)))

      expect(results).toHaveLength(10)
    })

    it('should maintain event order when requested', async () => {
      router = new ChangeEventRouter<TestDocument>({
        preserveOrder: true,
      })

      const results: string[] = []
      router.onEvent(async (msg) => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10))
        results.push(msg.key)
      })

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-1', name: 'First', value: 1 },
        documentKey: { _id: 'doc-1' },
      })

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-2', name: 'Second', value: 2 },
        documentKey: { _id: 'doc-2' },
      })

      await router.routeEvent({
        operationType: 'insert',
        fullDocument: { _id: 'doc-3', name: 'Third', value: 3 },
        documentKey: { _id: 'doc-3' },
      })

      expect(results).toEqual(['doc-1', 'doc-2', 'doc-3'])
    })
  })
})
