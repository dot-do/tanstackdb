/**
 * Batch Event Transformer Tests (TDD RED Phase)
 *
 * These tests verify the BatchEventTransformer class which:
 * 1. Collects MongoDB change events within a configurable time window
 * 2. Coalesces multiple events for the same document into optimized batches
 * 3. Transforms MongoDB change events to TanStack DB ChangeMessage format
 * 4. Preserves event ordering within batches
 * 5. Supports configurable batch size limits
 * 6. Handles partial flushes when size limit is reached
 * 7. Provides hooks for batch lifecycle (begin, commit, etc.)
 *
 * RED PHASE: These tests will fail until BatchEventTransformer is implemented
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BatchEventTransformer } from '../../../src/sync/transforms/batch'
import type {
  MongoChangeEvent,
  MongoInsertEvent,
  MongoUpdateEvent,
  MongoDeleteEvent,
  ChangeMessage,
} from '../../../src/types'

// Test document type
interface TestDocument {
  _id: string
  name: string
  value: number
  updatedAt?: Date
}

describe('BatchEventTransformer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('constructor and configuration', () => {
    it('should create transformer with default configuration', () => {
      const transformer = new BatchEventTransformer<TestDocument>()

      expect(transformer).toBeInstanceOf(BatchEventTransformer)
      expect(transformer.batchTimeMs).toBe(50) // Default batch window
      expect(transformer.maxBatchSize).toBe(100) // Default max size
    })

    it('should accept custom batch time configuration', () => {
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 200,
      })

      expect(transformer.batchTimeMs).toBe(200)
    })

    it('should accept custom max batch size configuration', () => {
      const transformer = new BatchEventTransformer<TestDocument>({
        maxBatchSize: 50,
      })

      expect(transformer.maxBatchSize).toBe(50)
    })

    it('should reject invalid batch time (zero or negative)', () => {
      expect(() => new BatchEventTransformer<TestDocument>({ batchTimeMs: 0 })).toThrow(
        /batchTimeMs/i
      )
      expect(() => new BatchEventTransformer<TestDocument>({ batchTimeMs: -10 })).toThrow(
        /batchTimeMs/i
      )
    })

    it('should reject invalid max batch size (zero or negative)', () => {
      expect(() => new BatchEventTransformer<TestDocument>({ maxBatchSize: 0 })).toThrow(
        /maxBatchSize/i
      )
      expect(() => new BatchEventTransformer<TestDocument>({ maxBatchSize: -1 })).toThrow(
        /maxBatchSize/i
      )
    })
  })

  describe('event collection within time window', () => {
    it('should collect events within the batch time window', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
        onBatch,
      })

      const event1: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'First', value: 1 },
        documentKey: { _id: 'doc1' },
      }

      const event2: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: { _id: 'doc2', name: 'Second', value: 2 },
        documentKey: { _id: 'doc2' },
      }

      transformer.push(event1)
      transformer.push(event2)

      // Before time window expires
      await vi.advanceTimersByTimeAsync(50)
      expect(onBatch).not.toHaveBeenCalled()

      // After time window expires
      await vi.advanceTimersByTimeAsync(50)
      expect(onBatch).toHaveBeenCalledTimes(1)
      expect(onBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ key: 'doc1', type: 'insert' }),
          expect.objectContaining({ key: 'doc2', type: 'insert' }),
        ])
      )
    })

    it('should start new time window after batch is emitted', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onBatch,
      })

      // First batch
      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'First', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      await vi.advanceTimersByTimeAsync(50)
      expect(onBatch).toHaveBeenCalledTimes(1)

      // Second batch after new time window
      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc2', name: 'Second', value: 2 },
        documentKey: { _id: 'doc2' },
      })

      await vi.advanceTimersByTimeAsync(50)
      expect(onBatch).toHaveBeenCalledTimes(2)
    })
  })

  describe('event transformation', () => {
    it('should transform insert events to ChangeMessage format', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onBatch,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Test', value: 42 },
        documentKey: { _id: 'doc1' },
      })

      await vi.advanceTimersByTimeAsync(50)

      const batch = onBatch.mock.calls[0]?.[0] as ChangeMessage<TestDocument>[]
      expect(batch).toHaveLength(1)
      expect(batch[0]).toEqual({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 42 },
      })
    })

    it('should transform update events to ChangeMessage format', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onBatch,
      })

      transformer.push({
        operationType: 'update',
        fullDocument: { _id: 'doc1', name: 'Updated', value: 100 },
        documentKey: { _id: 'doc1' },
        updateDescription: {
          updatedFields: { name: 'Updated', value: 100 },
          removedFields: [],
        },
      })

      await vi.advanceTimersByTimeAsync(50)

      const batch = onBatch.mock.calls[0]?.[0] as ChangeMessage<TestDocument>[]
      expect(batch).toHaveLength(1)
      expect(batch[0]).toEqual({
        type: 'update',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Updated', value: 100 },
        metadata: expect.objectContaining({
          updatedFields: { name: 'Updated', value: 100 },
          removedFields: [],
        }),
      })
    })

    it('should transform delete events to ChangeMessage format', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onBatch,
      })

      transformer.push({
        operationType: 'delete',
        documentKey: { _id: 'doc1' },
      } as MongoDeleteEvent<TestDocument>)

      await vi.advanceTimersByTimeAsync(50)

      const batch = onBatch.mock.calls[0]?.[0] as ChangeMessage<TestDocument>[]
      expect(batch).toHaveLength(1)
      expect(batch[0]).toEqual({
        type: 'delete',
        key: 'doc1',
        value: undefined,
      })
    })

    it('should transform replace events to update ChangeMessage format', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onBatch,
      })

      transformer.push({
        operationType: 'replace',
        fullDocument: { _id: 'doc1', name: 'Replaced', value: 999 },
        documentKey: { _id: 'doc1' },
      })

      await vi.advanceTimersByTimeAsync(50)

      const batch = onBatch.mock.calls[0]?.[0] as ChangeMessage<TestDocument>[]
      expect(batch).toHaveLength(1)
      expect(batch[0]).toEqual({
        type: 'update',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Replaced', value: 999 },
      })
    })
  })

  describe('event coalescing', () => {
    it('should coalesce multiple updates to the same document', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
        onBatch,
        coalesce: true,
      })

      // Multiple updates to the same document within batch window
      transformer.push({
        operationType: 'update',
        fullDocument: { _id: 'doc1', name: 'Update 1', value: 1 },
        documentKey: { _id: 'doc1' },
        updateDescription: { updatedFields: { value: 1 }, removedFields: [] },
      })

      transformer.push({
        operationType: 'update',
        fullDocument: { _id: 'doc1', name: 'Update 2', value: 2 },
        documentKey: { _id: 'doc1' },
        updateDescription: { updatedFields: { value: 2 }, removedFields: [] },
      })

      transformer.push({
        operationType: 'update',
        fullDocument: { _id: 'doc1', name: 'Update 3', value: 3 },
        documentKey: { _id: 'doc1' },
        updateDescription: { updatedFields: { value: 3 }, removedFields: [] },
      })

      await vi.advanceTimersByTimeAsync(100)

      const batch = onBatch.mock.calls[0]?.[0] as ChangeMessage<TestDocument>[]
      // Should coalesce to single update with final value
      expect(batch).toHaveLength(1)
      expect(batch[0]).toEqual(
        expect.objectContaining({
          type: 'update',
          key: 'doc1',
          value: { _id: 'doc1', name: 'Update 3', value: 3 },
        })
      )
    })

    it('should coalesce insert followed by updates to single insert', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
        onBatch,
        coalesce: true,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Initial', value: 0 },
        documentKey: { _id: 'doc1' },
      })

      transformer.push({
        operationType: 'update',
        fullDocument: { _id: 'doc1', name: 'Updated', value: 10 },
        documentKey: { _id: 'doc1' },
        updateDescription: { updatedFields: { name: 'Updated', value: 10 }, removedFields: [] },
      })

      await vi.advanceTimersByTimeAsync(100)

      const batch = onBatch.mock.calls[0]?.[0] as ChangeMessage<TestDocument>[]
      // Insert + Update should coalesce to Insert with final value
      expect(batch).toHaveLength(1)
      expect(batch[0]).toEqual({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Updated', value: 10 },
      })
    })

    it('should coalesce insert followed by delete to no-op (empty batch)', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
        onBatch,
        coalesce: true,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Temp', value: 0 },
        documentKey: { _id: 'doc1' },
      })

      transformer.push({
        operationType: 'delete',
        documentKey: { _id: 'doc1' },
      } as MongoDeleteEvent<TestDocument>)

      await vi.advanceTimersByTimeAsync(100)

      // Insert followed by delete for same doc should cancel out
      expect(onBatch).not.toHaveBeenCalled() // or called with empty array
    })

    it('should preserve events for different documents during coalescing', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
        onBatch,
        coalesce: true,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc2', name: 'Doc 2', value: 2 },
        documentKey: { _id: 'doc2' },
      })

      transformer.push({
        operationType: 'update',
        fullDocument: { _id: 'doc1', name: 'Doc 1 Updated', value: 11 },
        documentKey: { _id: 'doc1' },
        updateDescription: { updatedFields: { name: 'Doc 1 Updated', value: 11 }, removedFields: [] },
      })

      await vi.advanceTimersByTimeAsync(100)

      const batch = onBatch.mock.calls[0]?.[0] as ChangeMessage<TestDocument>[]
      expect(batch).toHaveLength(2)
      expect(batch).toContainEqual(
        expect.objectContaining({
          type: 'insert',
          key: 'doc1',
          value: { _id: 'doc1', name: 'Doc 1 Updated', value: 11 },
        })
      )
      expect(batch).toContainEqual(
        expect.objectContaining({
          type: 'insert',
          key: 'doc2',
          value: { _id: 'doc2', name: 'Doc 2', value: 2 },
        })
      )
    })

    it('should disable coalescing when configured', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
        onBatch,
        coalesce: false,
      })

      transformer.push({
        operationType: 'update',
        fullDocument: { _id: 'doc1', name: 'Update 1', value: 1 },
        documentKey: { _id: 'doc1' },
        updateDescription: { updatedFields: { value: 1 }, removedFields: [] },
      })

      transformer.push({
        operationType: 'update',
        fullDocument: { _id: 'doc1', name: 'Update 2', value: 2 },
        documentKey: { _id: 'doc1' },
        updateDescription: { updatedFields: { value: 2 }, removedFields: [] },
      })

      await vi.advanceTimersByTimeAsync(100)

      const batch = onBatch.mock.calls[0]?.[0] as ChangeMessage<TestDocument>[]
      // Without coalescing, should have both updates
      expect(batch).toHaveLength(2)
    })
  })

  describe('batch size limit', () => {
    it('should flush immediately when max batch size is reached', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 1000, // Long window
        maxBatchSize: 3,
        onBatch,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })
      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc2', name: 'Doc 2', value: 2 },
        documentKey: { _id: 'doc2' },
      })

      // Not yet at limit
      expect(onBatch).not.toHaveBeenCalled()

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc3', name: 'Doc 3', value: 3 },
        documentKey: { _id: 'doc3' },
      })

      // Should flush immediately at size limit
      await vi.advanceTimersByTimeAsync(0)
      expect(onBatch).toHaveBeenCalledTimes(1)

      const batch = onBatch.mock.calls[0]?.[0] as ChangeMessage<TestDocument>[]
      expect(batch).toHaveLength(3)
    })

    it('should continue collecting after size-triggered flush', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
        maxBatchSize: 2,
        onBatch,
      })

      // First batch (triggers at size 2)
      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })
      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc2', name: 'Doc 2', value: 2 },
        documentKey: { _id: 'doc2' },
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(onBatch).toHaveBeenCalledTimes(1)

      // Additional events go into new batch
      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc3', name: 'Doc 3', value: 3 },
        documentKey: { _id: 'doc3' },
      })

      // Wait for time-based flush
      await vi.advanceTimersByTimeAsync(100)
      expect(onBatch).toHaveBeenCalledTimes(2)

      const secondBatch = onBatch.mock.calls[1]?.[0] as ChangeMessage<TestDocument>[]
      expect(secondBatch).toHaveLength(1)
      expect(secondBatch[0]).toMatchObject({ key: 'doc3' })
    })
  })

  describe('manual flush', () => {
    it('should support manual flush before time window expires', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 10000, // Very long window
        onBatch,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      // Manual flush
      await transformer.flush()

      expect(onBatch).toHaveBeenCalledTimes(1)
    })

    it('should return empty array when flushing with no pending events', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
        onBatch,
      })

      await transformer.flush()

      // Should not call onBatch with empty array
      expect(onBatch).not.toHaveBeenCalled()
    })

    it('should cancel pending timer after manual flush', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
        onBatch,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      await transformer.flush()
      expect(onBatch).toHaveBeenCalledTimes(1)

      // Advance past original timer - should not trigger again
      await vi.advanceTimersByTimeAsync(100)
      expect(onBatch).toHaveBeenCalledTimes(1) // Still 1, not 2
    })
  })

  describe('lifecycle hooks', () => {
    it('should call onBegin before processing batch', async () => {
      const callOrder: string[] = []
      const onBegin = vi.fn(() => { callOrder.push('onBegin') })
      const onBatch = vi.fn(() => { callOrder.push('onBatch') })
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onBegin,
        onBatch,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      await vi.advanceTimersByTimeAsync(50)

      expect(onBegin).toHaveBeenCalledTimes(1)
      expect(callOrder).toEqual(['onBegin', 'onBatch'])
    })

    it('should call onCommit after batch is processed', async () => {
      const callOrder: string[] = []
      const onBatch = vi.fn(() => { callOrder.push('onBatch') })
      const onCommit = vi.fn(() => { callOrder.push('onCommit') })
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onBatch,
        onCommit,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      await vi.advanceTimersByTimeAsync(50)

      expect(onCommit).toHaveBeenCalledTimes(1)
      expect(callOrder).toEqual(['onBatch', 'onCommit'])
    })

    it('should provide batch statistics to onCommit', async () => {
      const onCommit = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onCommit,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })
      transformer.push({
        operationType: 'update',
        fullDocument: { _id: 'doc2', name: 'Doc 2', value: 2 },
        documentKey: { _id: 'doc2' },
        updateDescription: { updatedFields: { value: 2 }, removedFields: [] },
      })

      await vi.advanceTimersByTimeAsync(50)

      expect(onCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventCount: 2,
          insertCount: 1,
          updateCount: 1,
          deleteCount: 0,
          batchDurationMs: expect.any(Number),
        })
      )
    })
  })

  describe('ordering preservation', () => {
    it('should preserve order of events for different documents', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
        onBatch,
        coalesce: false, // Disable coalescing to see all events
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })
      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc2', name: 'Doc 2', value: 2 },
        documentKey: { _id: 'doc2' },
      })
      transformer.push({
        operationType: 'update',
        fullDocument: { _id: 'doc1', name: 'Doc 1 Updated', value: 11 },
        documentKey: { _id: 'doc1' },
        updateDescription: { updatedFields: { value: 11 }, removedFields: [] },
      })
      transformer.push({
        operationType: 'delete',
        documentKey: { _id: 'doc2' },
      } as MongoDeleteEvent<TestDocument>)

      await vi.advanceTimersByTimeAsync(100)

      const batch = onBatch.mock.calls[0]?.[0] as ChangeMessage<TestDocument>[]
      expect(batch).toHaveLength(4)
      expect(batch[0]).toMatchObject({ key: 'doc1', type: 'insert' })
      expect(batch[1]).toMatchObject({ key: 'doc2', type: 'insert' })
      expect(batch[2]).toMatchObject({ key: 'doc1', type: 'update' })
      expect(batch[3]).toMatchObject({ key: 'doc2', type: 'delete' })
    })
  })

  describe('error handling', () => {
    it('should handle errors in onBatch callback gracefully', async () => {
      const onError = vi.fn()
      const onBatch = vi.fn().mockImplementation(() => {
        throw new Error('Batch processing failed')
      })
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onBatch,
        onError,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      await vi.advanceTimersByTimeAsync(50)

      expect(onError).toHaveBeenCalledWith(expect.any(Error))
      expect(onError.mock.calls[0]?.[0]?.message).toBe('Batch processing failed')
    })

    it('should continue processing after error in batch callback', async () => {
      let callCount = 0
      const onBatch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          throw new Error('First batch failed')
        }
      })
      const onError = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onBatch,
        onError,
      })

      // First batch (will fail)
      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      await vi.advanceTimersByTimeAsync(50)
      expect(onError).toHaveBeenCalledTimes(1)

      // Second batch (should succeed)
      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc2', name: 'Doc 2', value: 2 },
        documentKey: { _id: 'doc2' },
      })

      await vi.advanceTimersByTimeAsync(50)
      expect(onBatch).toHaveBeenCalledTimes(2)
    })
  })

  describe('disposal and cleanup', () => {
    it('should cancel pending timer on dispose', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 1000,
        onBatch,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      transformer.dispose()

      await vi.advanceTimersByTimeAsync(1000)

      // Should not have been called because transformer was disposed
      expect(onBatch).not.toHaveBeenCalled()
    })

    it('should reject new events after disposal', () => {
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
      })

      transformer.dispose()

      expect(() => {
        transformer.push({
          operationType: 'insert',
          fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
          documentKey: { _id: 'doc1' },
        })
      }).toThrow(/disposed|closed/i)
    })

    it('should flush pending events before disposal when requested', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 10000,
        onBatch,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      await transformer.dispose({ flush: true })

      expect(onBatch).toHaveBeenCalledTimes(1)
    })
  })

  describe('pending state', () => {
    it('should report pending event count', () => {
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
      })

      expect(transformer.pendingCount).toBe(0)

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      expect(transformer.pendingCount).toBe(1)

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc2', name: 'Doc 2', value: 2 },
        documentKey: { _id: 'doc2' },
      })

      expect(transformer.pendingCount).toBe(2)
    })

    it('should report whether batch is pending', () => {
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 100,
      })

      expect(transformer.hasPending).toBe(false)

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      expect(transformer.hasPending).toBe(true)
    })

    it('should reset pending count after flush', async () => {
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      expect(transformer.pendingCount).toBe(1)

      await vi.advanceTimersByTimeAsync(50)

      expect(transformer.pendingCount).toBe(0)
      expect(transformer.hasPending).toBe(false)
    })
  })

  describe('async batch processing', () => {
    it('should support async onBatch callback', async () => {
      const processedBatches: ChangeMessage<TestDocument>[][] = []
      const onBatch = vi.fn().mockImplementation(async (batch: ChangeMessage<TestDocument>[]) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        processedBatches.push(batch)
      })

      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onBatch,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      await vi.advanceTimersByTimeAsync(50)
      await vi.advanceTimersByTimeAsync(10) // Wait for async processing

      expect(processedBatches).toHaveLength(1)
      expect(processedBatches[0]).toHaveLength(1)
    })

    it('should handle async errors in onBatch', async () => {
      const onError = vi.fn()
      const onBatch = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        throw new Error('Async processing failed')
      })

      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onBatch,
        onError,
      })

      transformer.push({
        operationType: 'insert',
        fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
        documentKey: { _id: 'doc1' },
      })

      await vi.advanceTimersByTimeAsync(50)
      await vi.advanceTimersByTimeAsync(10) // Wait for async processing

      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('metadata passthrough', () => {
    it('should include custom metadata in transformed messages', async () => {
      const onBatch = vi.fn()
      const transformer = new BatchEventTransformer<TestDocument>({
        batchTimeMs: 50,
        onBatch,
        includeMetadata: true,
      })

      transformer.push(
        {
          operationType: 'insert',
          fullDocument: { _id: 'doc1', name: 'Doc 1', value: 1 },
          documentKey: { _id: 'doc1' },
        },
        { source: 'change-stream', timestamp: 1234567890 }
      )

      await vi.advanceTimersByTimeAsync(50)

      const batch = onBatch.mock.calls[0]?.[0] as ChangeMessage<TestDocument>[] | undefined
      expect(batch?.[0]?.metadata).toEqual(
        expect.objectContaining({
          source: 'change-stream',
          timestamp: 1234567890,
        })
      )
    })
  })
})
