/**
 * Event Buffer Tests (TDD RED Phase)
 *
 * These tests verify the EventBuffer class which:
 * 1. Buffers change events during initial sync
 * 2. Returns buffered events on flush
 * 3. Clears after flush
 * 4. Handles high volume
 * 5. Memory bounded
 *
 * RED PHASE: These tests will fail until EventBuffer is implemented
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventBuffer } from '../../src/sync/event-buffer'
import type { MongoChangeEvent, MongoInsertEvent, MongoUpdateEvent, MongoDeleteEvent } from '../../src/types'

// Test document type
interface TestDocument {
  _id: string
  name: string
  value: number
  tags?: string[]
}

describe('EventBuffer', () => {
  let buffer: EventBuffer<TestDocument>

  afterEach(() => {
    if (buffer) {
      buffer.dispose()
    }
  })

  // Helper to create test events
  function createInsertEvent(id: string, name: string, value: number): MongoInsertEvent<TestDocument> {
    return {
      operationType: 'insert',
      fullDocument: { _id: id, name, value },
      documentKey: { _id: id },
    }
  }

  function createUpdateEvent(id: string, name: string, value: number): MongoUpdateEvent<TestDocument> {
    return {
      operationType: 'update',
      fullDocument: { _id: id, name, value },
      documentKey: { _id: id },
      updateDescription: {
        updatedFields: { name, value },
        removedFields: [],
      },
    }
  }

  function createDeleteEvent(id: string): MongoDeleteEvent<TestDocument> {
    return {
      operationType: 'delete',
      documentKey: { _id: id },
    }
  }

  describe('construction and configuration', () => {
    it('should create buffer with default configuration', () => {
      buffer = new EventBuffer<TestDocument>()

      expect(buffer).toBeInstanceOf(EventBuffer)
    })

    it('should create buffer with custom max size', () => {
      buffer = new EventBuffer<TestDocument>({ maxSize: 100 })

      expect(buffer).toBeInstanceOf(EventBuffer)
      expect(buffer.maxSize).toBe(100)
    })

    it('should create buffer with custom max memory', () => {
      buffer = new EventBuffer<TestDocument>({ maxMemoryBytes: 1024 * 1024 })

      expect(buffer).toBeInstanceOf(EventBuffer)
      expect(buffer.maxMemoryBytes).toBe(1024 * 1024)
    })

    it('should validate maxSize is positive', () => {
      expect(() => new EventBuffer<TestDocument>({ maxSize: 0 })).toThrow(/maxSize/i)
      expect(() => new EventBuffer<TestDocument>({ maxSize: -1 })).toThrow(/maxSize/i)
    })

    it('should validate maxMemoryBytes is positive', () => {
      expect(() => new EventBuffer<TestDocument>({ maxMemoryBytes: 0 })).toThrow(/maxMemoryBytes/i)
      expect(() => new EventBuffer<TestDocument>({ maxMemoryBytes: -1 })).toThrow(/maxMemoryBytes/i)
    })
  })

  describe('buffering change events during initial sync', () => {
    beforeEach(() => {
      buffer = new EventBuffer<TestDocument>()
    })

    it('should buffer insert events', () => {
      const event = createInsertEvent('doc-1', 'Test', 42)

      buffer.add(event)

      expect(buffer.size).toBe(1)
    })

    it('should buffer update events', () => {
      const event = createUpdateEvent('doc-1', 'Updated', 100)

      buffer.add(event)

      expect(buffer.size).toBe(1)
    })

    it('should buffer delete events', () => {
      const event = createDeleteEvent('doc-1')

      buffer.add(event)

      expect(buffer.size).toBe(1)
    })

    it('should buffer multiple events of different types', () => {
      buffer.add(createInsertEvent('doc-1', 'First', 1))
      buffer.add(createUpdateEvent('doc-2', 'Second', 2))
      buffer.add(createDeleteEvent('doc-3'))
      buffer.add(createInsertEvent('doc-4', 'Fourth', 4))

      expect(buffer.size).toBe(4)
    })

    it('should preserve event order', () => {
      buffer.add(createInsertEvent('doc-1', 'First', 1))
      buffer.add(createInsertEvent('doc-2', 'Second', 2))
      buffer.add(createInsertEvent('doc-3', 'Third', 3))

      const events = buffer.peek()

      expect(events).toHaveLength(3)
      expect(events[0].documentKey._id).toBe('doc-1')
      expect(events[1].documentKey._id).toBe('doc-2')
      expect(events[2].documentKey._id).toBe('doc-3')
    })

    it('should accept events while in buffering state', () => {
      expect(buffer.isBuffering).toBe(true)

      buffer.add(createInsertEvent('doc-1', 'Test', 42))

      expect(buffer.size).toBe(1)
    })

    it('should track empty state correctly', () => {
      expect(buffer.isEmpty).toBe(true)

      buffer.add(createInsertEvent('doc-1', 'Test', 42))

      expect(buffer.isEmpty).toBe(false)
    })
  })

  describe('returning buffered events on flush', () => {
    beforeEach(() => {
      buffer = new EventBuffer<TestDocument>()
    })

    it('should return all buffered events on flush', () => {
      buffer.add(createInsertEvent('doc-1', 'First', 1))
      buffer.add(createUpdateEvent('doc-2', 'Second', 2))
      buffer.add(createDeleteEvent('doc-3'))

      const flushed = buffer.flush()

      expect(flushed).toHaveLength(3)
      expect(flushed[0].operationType).toBe('insert')
      expect(flushed[1].operationType).toBe('update')
      expect(flushed[2].operationType).toBe('delete')
    })

    it('should return events in FIFO order', () => {
      buffer.add(createInsertEvent('doc-1', 'First', 1))
      buffer.add(createInsertEvent('doc-2', 'Second', 2))
      buffer.add(createInsertEvent('doc-3', 'Third', 3))

      const flushed = buffer.flush()

      expect(flushed[0].documentKey._id).toBe('doc-1')
      expect(flushed[1].documentKey._id).toBe('doc-2')
      expect(flushed[2].documentKey._id).toBe('doc-3')
    })

    it('should return empty array when buffer is empty', () => {
      const flushed = buffer.flush()

      expect(flushed).toEqual([])
    })

    it('should return typed events', () => {
      const insertEvent = createInsertEvent('doc-1', 'Test', 42)
      buffer.add(insertEvent)

      const flushed = buffer.flush()

      expect(flushed[0]).toEqual(insertEvent)
    })

    it('should call onFlush callback if provided', () => {
      const onFlush = vi.fn()
      buffer = new EventBuffer<TestDocument>({ onFlush })

      buffer.add(createInsertEvent('doc-1', 'Test', 42))
      buffer.flush()

      expect(onFlush).toHaveBeenCalledTimes(1)
      expect(onFlush).toHaveBeenCalledWith(expect.any(Array))
    })
  })

  describe('clearing after flush', () => {
    beforeEach(() => {
      buffer = new EventBuffer<TestDocument>()
    })

    it('should clear buffer after flush', () => {
      buffer.add(createInsertEvent('doc-1', 'Test', 42))
      expect(buffer.size).toBe(1)

      buffer.flush()

      expect(buffer.size).toBe(0)
      expect(buffer.isEmpty).toBe(true)
    })

    it('should allow adding new events after flush', () => {
      buffer.add(createInsertEvent('doc-1', 'First', 1))
      buffer.flush()

      buffer.add(createInsertEvent('doc-2', 'Second', 2))

      expect(buffer.size).toBe(1)
      const events = buffer.peek()
      expect(events[0].documentKey._id).toBe('doc-2')
    })

    it('should support multiple flush cycles', () => {
      // First cycle
      buffer.add(createInsertEvent('doc-1', 'First', 1))
      const first = buffer.flush()
      expect(first).toHaveLength(1)

      // Second cycle
      buffer.add(createInsertEvent('doc-2', 'Second', 2))
      buffer.add(createInsertEvent('doc-3', 'Third', 3))
      const second = buffer.flush()
      expect(second).toHaveLength(2)

      // Third cycle
      buffer.add(createInsertEvent('doc-4', 'Fourth', 4))
      const third = buffer.flush()
      expect(third).toHaveLength(1)
    })

    it('should support explicit clear without returning events', () => {
      buffer.add(createInsertEvent('doc-1', 'Test', 42))

      buffer.clear()

      expect(buffer.size).toBe(0)
      expect(buffer.isEmpty).toBe(true)
    })

    it('should reset memory usage after clear', () => {
      buffer.add(createInsertEvent('doc-1', 'Test', 42))
      expect(buffer.memoryUsage).toBeGreaterThan(0)

      buffer.clear()

      expect(buffer.memoryUsage).toBe(0)
    })
  })

  describe('handling high volume', () => {
    it('should handle 10,000 events without issue', () => {
      buffer = new EventBuffer<TestDocument>()

      for (let i = 0; i < 10000; i++) {
        buffer.add(createInsertEvent(`doc-${i}`, `Name ${i}`, i))
      }

      expect(buffer.size).toBe(10000)

      const flushed = buffer.flush()
      expect(flushed).toHaveLength(10000)
      expect(buffer.size).toBe(0)
    })

    it('should maintain event order with high volume', () => {
      buffer = new EventBuffer<TestDocument>()

      for (let i = 0; i < 1000; i++) {
        buffer.add(createInsertEvent(`doc-${i}`, `Name ${i}`, i))
      }

      const flushed = buffer.flush()

      // Check first, middle, and last events
      expect(flushed[0].documentKey._id).toBe('doc-0')
      expect(flushed[499].documentKey._id).toBe('doc-499')
      expect(flushed[999].documentKey._id).toBe('doc-999')
    })

    it('should handle rapid add/flush cycles', () => {
      buffer = new EventBuffer<TestDocument>()

      for (let cycle = 0; cycle < 100; cycle++) {
        for (let i = 0; i < 100; i++) {
          buffer.add(createInsertEvent(`doc-${cycle}-${i}`, `Name`, i))
        }
        const flushed = buffer.flush()
        expect(flushed).toHaveLength(100)
      }

      expect(buffer.size).toBe(0)
    })

    it('should handle mixed operation types at high volume', () => {
      buffer = new EventBuffer<TestDocument>()

      for (let i = 0; i < 3000; i++) {
        const mod = i % 3
        if (mod === 0) {
          buffer.add(createInsertEvent(`doc-${i}`, `Name ${i}`, i))
        } else if (mod === 1) {
          buffer.add(createUpdateEvent(`doc-${i}`, `Updated ${i}`, i * 10))
        } else {
          buffer.add(createDeleteEvent(`doc-${i}`))
        }
      }

      expect(buffer.size).toBe(3000)

      const flushed = buffer.flush()
      expect(flushed).toHaveLength(3000)

      // Verify distribution
      const inserts = flushed.filter((e) => e.operationType === 'insert')
      const updates = flushed.filter((e) => e.operationType === 'update')
      const deletes = flushed.filter((e) => e.operationType === 'delete')

      expect(inserts).toHaveLength(1000)
      expect(updates).toHaveLength(1000)
      expect(deletes).toHaveLength(1000)
    })

    it('should track statistics for high volume', () => {
      buffer = new EventBuffer<TestDocument>({ enableStats: true })

      for (let i = 0; i < 5000; i++) {
        buffer.add(createInsertEvent(`doc-${i}`, `Name ${i}`, i))
      }

      const stats = buffer.getStats()

      expect(stats.totalEventsBuffered).toBe(5000)
      expect(stats.currentSize).toBe(5000)
    })
  })

  describe('memory bounded', () => {
    it('should track memory usage', () => {
      buffer = new EventBuffer<TestDocument>()

      buffer.add(createInsertEvent('doc-1', 'Test', 42))

      expect(buffer.memoryUsage).toBeGreaterThan(0)
    })

    it('should enforce max size limit', () => {
      buffer = new EventBuffer<TestDocument>({ maxSize: 5 })

      for (let i = 0; i < 10; i++) {
        buffer.add(createInsertEvent(`doc-${i}`, `Name ${i}`, i))
      }

      // Should only keep maxSize events
      expect(buffer.size).toBe(5)
    })

    it('should drop oldest events when size limit exceeded', () => {
      buffer = new EventBuffer<TestDocument>({ maxSize: 3 })

      buffer.add(createInsertEvent('doc-1', 'First', 1))
      buffer.add(createInsertEvent('doc-2', 'Second', 2))
      buffer.add(createInsertEvent('doc-3', 'Third', 3))
      buffer.add(createInsertEvent('doc-4', 'Fourth', 4))
      buffer.add(createInsertEvent('doc-5', 'Fifth', 5))

      const events = buffer.peek()

      // Should have dropped doc-1 and doc-2
      expect(events).toHaveLength(3)
      expect(events[0].documentKey._id).toBe('doc-3')
      expect(events[1].documentKey._id).toBe('doc-4')
      expect(events[2].documentKey._id).toBe('doc-5')
    })

    it('should enforce memory limit', () => {
      // Set a small memory limit
      buffer = new EventBuffer<TestDocument>({ maxMemoryBytes: 1000 })

      // Add events until memory limit is exceeded
      for (let i = 0; i < 100; i++) {
        buffer.add(createInsertEvent(`doc-${i}`, `Name with some content ${i}`, i))
      }

      // Memory usage should be at or below limit
      expect(buffer.memoryUsage).toBeLessThanOrEqual(1000)
    })

    it('should call onOverflow callback when events are dropped', () => {
      const onOverflow = vi.fn()
      buffer = new EventBuffer<TestDocument>({ maxSize: 3, onOverflow })

      buffer.add(createInsertEvent('doc-1', 'First', 1))
      buffer.add(createInsertEvent('doc-2', 'Second', 2))
      buffer.add(createInsertEvent('doc-3', 'Third', 3))
      buffer.add(createInsertEvent('doc-4', 'Fourth', 4)) // This should trigger overflow

      expect(onOverflow).toHaveBeenCalledTimes(1)
      expect(onOverflow).toHaveBeenCalledWith(
        expect.objectContaining({
          droppedCount: 1,
          droppedEvents: expect.any(Array),
        })
      )
    })

    it('should report overflow in stats', () => {
      buffer = new EventBuffer<TestDocument>({ maxSize: 3, enableStats: true })

      for (let i = 0; i < 10; i++) {
        buffer.add(createInsertEvent(`doc-${i}`, `Name ${i}`, i))
      }

      const stats = buffer.getStats()

      expect(stats.droppedEvents).toBe(7) // 10 added, 3 kept, 7 dropped
    })

    it('should estimate memory per event correctly', () => {
      buffer = new EventBuffer<TestDocument>()

      const smallEvent = createInsertEvent('1', 'a', 1)
      buffer.add(smallEvent)
      const smallMemory = buffer.memoryUsage

      buffer.clear()

      const largeEvent = createInsertEvent(
        'doc-with-long-id-12345',
        'This is a much longer name with more characters',
        999999
      )
      buffer.add(largeEvent)
      const largeMemory = buffer.memoryUsage

      // Larger event should use more memory
      expect(largeMemory).toBeGreaterThan(smallMemory)
    })

    it('should support both size and memory limits together', () => {
      buffer = new EventBuffer<TestDocument>({
        maxSize: 100,
        maxMemoryBytes: 500,
      })

      for (let i = 0; i < 100; i++) {
        buffer.add(createInsertEvent(`doc-${i}`, `Name ${i}`, i))
      }

      // Should be constrained by either limit
      expect(buffer.size).toBeLessThanOrEqual(100)
      expect(buffer.memoryUsage).toBeLessThanOrEqual(500)
    })
  })

  describe('buffering state management', () => {
    it('should start in buffering state by default', () => {
      buffer = new EventBuffer<TestDocument>()

      expect(buffer.isBuffering).toBe(true)
    })

    it('should allow starting in non-buffering state', () => {
      buffer = new EventBuffer<TestDocument>({ startBuffering: false })

      expect(buffer.isBuffering).toBe(false)
    })

    it('should transition from buffering to non-buffering', () => {
      buffer = new EventBuffer<TestDocument>()
      expect(buffer.isBuffering).toBe(true)

      buffer.stopBuffering()

      expect(buffer.isBuffering).toBe(false)
    })

    it('should transition from non-buffering to buffering', () => {
      buffer = new EventBuffer<TestDocument>({ startBuffering: false })
      expect(buffer.isBuffering).toBe(false)

      buffer.startBuffering()

      expect(buffer.isBuffering).toBe(true)
    })

    it('should reject events when not buffering', () => {
      buffer = new EventBuffer<TestDocument>({ startBuffering: false })

      expect(() => buffer.add(createInsertEvent('doc-1', 'Test', 42))).toThrow(/not buffering/i)
    })

    it('should optionally pass through events when not buffering', () => {
      const onPassThrough = vi.fn()
      buffer = new EventBuffer<TestDocument>({
        startBuffering: false,
        onPassThrough,
      })

      buffer.passThrough(createInsertEvent('doc-1', 'Test', 42))

      expect(onPassThrough).toHaveBeenCalledTimes(1)
      expect(buffer.size).toBe(0) // Should not buffer
    })
  })

  describe('peek functionality', () => {
    beforeEach(() => {
      buffer = new EventBuffer<TestDocument>()
    })

    it('should peek without removing events', () => {
      buffer.add(createInsertEvent('doc-1', 'First', 1))
      buffer.add(createInsertEvent('doc-2', 'Second', 2))

      const peeked = buffer.peek()

      expect(peeked).toHaveLength(2)
      expect(buffer.size).toBe(2) // Events should still be in buffer
    })

    it('should return a copy of events on peek', () => {
      buffer.add(createInsertEvent('doc-1', 'Test', 42))

      const peeked1 = buffer.peek()
      const peeked2 = buffer.peek()

      expect(peeked1).not.toBe(peeked2) // Should be different array instances
      expect(peeked1).toEqual(peeked2) // But with same content
    })

    it('should support peeking with limit', () => {
      buffer.add(createInsertEvent('doc-1', 'First', 1))
      buffer.add(createInsertEvent('doc-2', 'Second', 2))
      buffer.add(createInsertEvent('doc-3', 'Third', 3))
      buffer.add(createInsertEvent('doc-4', 'Fourth', 4))

      const peeked = buffer.peek(2)

      expect(peeked).toHaveLength(2)
      expect(peeked[0].documentKey._id).toBe('doc-1')
      expect(peeked[1].documentKey._id).toBe('doc-2')
    })
  })

  describe('statistics and monitoring', () => {
    it('should track total events buffered', () => {
      buffer = new EventBuffer<TestDocument>({ enableStats: true })

      buffer.add(createInsertEvent('doc-1', 'First', 1))
      buffer.add(createInsertEvent('doc-2', 'Second', 2))
      buffer.flush()
      buffer.add(createInsertEvent('doc-3', 'Third', 3))

      const stats = buffer.getStats()

      expect(stats.totalEventsBuffered).toBe(3)
    })

    it('should track flush count', () => {
      buffer = new EventBuffer<TestDocument>({ enableStats: true })

      buffer.add(createInsertEvent('doc-1', 'Test', 42))
      buffer.flush()
      buffer.add(createInsertEvent('doc-2', 'Test', 42))
      buffer.flush()
      buffer.flush() // Empty flush

      const stats = buffer.getStats()

      expect(stats.flushCount).toBe(3)
    })

    it('should track peak size', () => {
      buffer = new EventBuffer<TestDocument>({ enableStats: true })

      buffer.add(createInsertEvent('doc-1', 'First', 1))
      buffer.add(createInsertEvent('doc-2', 'Second', 2))
      buffer.add(createInsertEvent('doc-3', 'Third', 3))
      buffer.flush()
      buffer.add(createInsertEvent('doc-4', 'Fourth', 4))

      const stats = buffer.getStats()

      expect(stats.peakSize).toBe(3)
    })

    it('should reset stats on demand', () => {
      buffer = new EventBuffer<TestDocument>({ enableStats: true })

      buffer.add(createInsertEvent('doc-1', 'Test', 42))
      buffer.flush()

      buffer.resetStats()
      const stats = buffer.getStats()

      expect(stats.totalEventsBuffered).toBe(0)
      expect(stats.flushCount).toBe(0)
    })

    it('should return empty stats when stats disabled', () => {
      buffer = new EventBuffer<TestDocument>({ enableStats: false })

      buffer.add(createInsertEvent('doc-1', 'Test', 42))

      const stats = buffer.getStats()

      expect(stats.totalEventsBuffered).toBe(0)
    })
  })

  describe('disposal and cleanup', () => {
    it('should clear buffer on dispose', () => {
      buffer = new EventBuffer<TestDocument>()

      buffer.add(createInsertEvent('doc-1', 'Test', 42))
      buffer.dispose()

      expect(buffer.size).toBe(0)
    })

    it('should reject operations after dispose', () => {
      buffer = new EventBuffer<TestDocument>()

      buffer.dispose()

      expect(() => buffer.add(createInsertEvent('doc-1', 'Test', 42))).toThrow(/disposed/i)
    })

    it('should be safe to dispose multiple times', () => {
      buffer = new EventBuffer<TestDocument>()

      buffer.dispose()
      expect(() => buffer.dispose()).not.toThrow()
    })

    it('should return empty array on flush after dispose', () => {
      buffer = new EventBuffer<TestDocument>()

      buffer.add(createInsertEvent('doc-1', 'Test', 42))
      buffer.dispose()

      expect(buffer.flush()).toEqual([])
    })
  })
})
