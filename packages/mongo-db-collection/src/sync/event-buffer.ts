/**
 * Event Buffer for MongoDB Change Stream Events
 *
 * This module provides a memory-bounded buffer for MongoDB change events
 * during initial sync operations. It supports:
 * - Buffering events with FIFO ordering
 * - Memory and size limits with overflow handling
 * - Flush and clear operations
 * - Statistics tracking
 *
 * @module @tanstack/mongo-db-collection/sync/event-buffer
 */

import type { MongoChangeEvent } from '../types.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Information about overflow events
 */
export interface OverflowInfo {
  /** Number of events that were dropped */
  droppedCount: number
  /** The events that were dropped */
  droppedEvents: MongoChangeEvent<unknown>[]
}

/**
 * Statistics about buffer operations
 */
export interface EventBufferStats {
  /** Total number of events buffered since creation or last reset */
  totalEventsBuffered: number
  /** Current number of events in the buffer */
  currentSize: number
  /** Maximum size the buffer reached */
  peakSize: number
  /** Number of events dropped due to overflow */
  droppedEvents: number
  /** Number of times flush was called */
  flushCount: number
}

/**
 * Configuration options for EventBuffer
 */
export interface EventBufferOptions<T = unknown> {
  /** Maximum number of events to buffer. Defaults to 10000 */
  maxSize?: number
  /** Maximum memory in bytes. Defaults to 10MB */
  maxMemoryBytes?: number
  /** Whether to start in buffering mode. Defaults to true */
  startBuffering?: boolean
  /** Enable statistics tracking. Defaults to false */
  enableStats?: boolean
  /** Callback when events are flushed */
  onFlush?: (events: MongoChangeEvent<T>[]) => void
  /** Callback when events are dropped due to overflow */
  onOverflow?: (info: OverflowInfo) => void
  /** Callback when events are passed through (not buffered) */
  onPassThrough?: (event: MongoChangeEvent<T>) => void
}

// ============================================================================
// EventBuffer Implementation
// ============================================================================

/**
 * A memory-bounded buffer for MongoDB change stream events.
 *
 * Used during initial sync to buffer change events that arrive while
 * the initial data load is in progress. Once the initial load completes,
 * the buffered events can be flushed and applied.
 *
 * @typeParam T - The document type for events in the buffer
 *
 * @example
 * ```typescript
 * const buffer = new EventBuffer<User>({ maxSize: 1000 })
 *
 * // Buffer events during initial sync
 * buffer.add(insertEvent)
 * buffer.add(updateEvent)
 *
 * // After initial sync completes, flush and apply
 * const events = buffer.flush()
 * events.forEach(event => applyEvent(event))
 * ```
 */
export class EventBuffer<T = unknown> {
  private events: MongoChangeEvent<T>[] = []
  private _isBuffering: boolean
  private _disposed = false
  private _memoryUsage = 0
  private _enableStats: boolean

  // Statistics
  private _totalEventsBuffered = 0
  private _droppedEvents = 0
  private _peakSize = 0
  private _flushCount = 0

  // Configuration
  private readonly _maxSize: number
  private readonly _maxMemoryBytes: number
  private readonly _onFlush?: (events: MongoChangeEvent<T>[]) => void
  private readonly _onOverflow?: (info: OverflowInfo) => void
  private readonly _onPassThrough?: (event: MongoChangeEvent<T>) => void

  /**
   * Creates a new EventBuffer instance.
   *
   * @param options - Configuration options
   * @throws Error if maxSize is not positive
   * @throws Error if maxMemoryBytes is not positive
   */
  constructor(options: EventBufferOptions<T> = {}) {
    const {
      maxSize = 10000,
      maxMemoryBytes = 10 * 1024 * 1024, // 10MB default
      startBuffering = true,
      enableStats = false,
      onFlush,
      onOverflow,
      onPassThrough,
    } = options

    // Validate configuration
    if (maxSize <= 0) {
      throw new Error('maxSize must be a positive number')
    }
    if (maxMemoryBytes <= 0) {
      throw new Error('maxMemoryBytes must be a positive number')
    }

    this._maxSize = maxSize
    this._maxMemoryBytes = maxMemoryBytes
    this._isBuffering = startBuffering
    this._enableStats = enableStats
    this._onFlush = onFlush
    this._onOverflow = onOverflow
    this._onPassThrough = onPassThrough
  }

  // ============================================================================
  // Properties
  // ============================================================================

  /**
   * Maximum number of events the buffer can hold.
   */
  get maxSize(): number {
    return this._maxSize
  }

  /**
   * Maximum memory in bytes the buffer can use.
   */
  get maxMemoryBytes(): number {
    return this._maxMemoryBytes
  }

  /**
   * Current number of events in the buffer.
   */
  get size(): number {
    return this.events.length
  }

  /**
   * Whether the buffer is empty.
   */
  get isEmpty(): boolean {
    return this.events.length === 0
  }

  /**
   * Whether the buffer is currently accepting events.
   */
  get isBuffering(): boolean {
    return this._isBuffering
  }

  /**
   * Current estimated memory usage in bytes.
   */
  get memoryUsage(): number {
    return this._memoryUsage
  }

  // ============================================================================
  // Buffer Operations
  // ============================================================================

  /**
   * Adds an event to the buffer.
   *
   * @param event - The change event to buffer
   * @throws Error if the buffer is disposed
   * @throws Error if not in buffering mode
   */
  add(event: MongoChangeEvent<T>): void {
    if (this._disposed) {
      throw new Error('Cannot add to disposed buffer')
    }
    if (!this._isBuffering) {
      throw new Error('Buffer is not buffering - call startBuffering() first or use passThrough()')
    }

    const eventSize = this.estimateEventSize(event)

    // Check if we need to drop events to stay within limits
    this.enforceMemoryLimit(eventSize)
    this.enforceSizeLimit()

    // Add the event
    this.events.push(event)
    this._memoryUsage += eventSize

    // Update statistics
    if (this._enableStats) {
      this._totalEventsBuffered++
      if (this.events.length > this._peakSize) {
        this._peakSize = this.events.length
      }
    }
  }

  /**
   * Pass an event through without buffering (when not in buffering mode).
   *
   * @param event - The change event to pass through
   */
  passThrough(event: MongoChangeEvent<T>): void {
    if (this._onPassThrough) {
      this._onPassThrough(event)
    }
  }

  /**
   * Returns all buffered events and clears the buffer.
   *
   * @returns Array of buffered events in FIFO order
   */
  flush(): MongoChangeEvent<T>[] {
    if (this._disposed) {
      return []
    }

    const flushed = [...this.events]
    this.events = []
    this._memoryUsage = 0

    if (this._enableStats) {
      this._flushCount++
    }

    if (this._onFlush) {
      this._onFlush(flushed)
    }

    return flushed
  }

  /**
   * Returns a copy of the buffered events without removing them.
   *
   * @param limit - Optional limit on number of events to return
   * @returns Array of buffered events
   */
  peek(limit?: number): MongoChangeEvent<T>[] {
    if (limit !== undefined && limit > 0) {
      return this.events.slice(0, limit)
    }
    return [...this.events]
  }

  /**
   * Clears all events from the buffer.
   */
  clear(): void {
    this.events = []
    this._memoryUsage = 0
  }

  // ============================================================================
  // Buffering State Management
  // ============================================================================

  /**
   * Start accepting events into the buffer.
   */
  startBuffering(): void {
    this._isBuffering = true
  }

  /**
   * Stop accepting events into the buffer.
   */
  stopBuffering(): void {
    this._isBuffering = false
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get current buffer statistics.
   *
   * @returns Statistics object
   */
  getStats(): EventBufferStats {
    if (!this._enableStats) {
      return {
        totalEventsBuffered: 0,
        currentSize: this.events.length,
        peakSize: 0,
        droppedEvents: 0,
        flushCount: 0,
      }
    }

    return {
      totalEventsBuffered: this._totalEventsBuffered,
      currentSize: this.events.length,
      peakSize: this._peakSize,
      droppedEvents: this._droppedEvents,
      flushCount: this._flushCount,
    }
  }

  /**
   * Reset statistics counters.
   */
  resetStats(): void {
    this._totalEventsBuffered = 0
    this._droppedEvents = 0
    this._peakSize = this.events.length
    this._flushCount = 0
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Dispose the buffer and release resources.
   */
  dispose(): void {
    if (this._disposed) {
      return
    }
    this._disposed = true
    this.clear()
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Estimate the memory size of an event in bytes.
   */
  private estimateEventSize(event: MongoChangeEvent<T>): number {
    // Simple estimation based on JSON stringification
    // This is approximate but sufficient for memory bounding
    try {
      return JSON.stringify(event).length * 2 // UTF-16 characters
    } catch {
      // If stringification fails, use a default size
      return 500
    }
  }

  /**
   * Enforce the memory limit by dropping oldest events if needed.
   */
  private enforceMemoryLimit(incomingSize: number): void {
    const droppedEvents: MongoChangeEvent<T>[] = []

    while (
      this.events.length > 0 &&
      this._memoryUsage + incomingSize > this._maxMemoryBytes
    ) {
      const dropped = this.events.shift()
      if (dropped) {
        const droppedSize = this.estimateEventSize(dropped)
        this._memoryUsage -= droppedSize
        droppedEvents.push(dropped)
        if (this._enableStats) {
          this._droppedEvents++
        }
      }
    }

    if (droppedEvents.length > 0 && this._onOverflow) {
      this._onOverflow({
        droppedCount: droppedEvents.length,
        droppedEvents: droppedEvents as MongoChangeEvent<unknown>[],
      })
    }
  }

  /**
   * Enforce the size limit by dropping oldest events if needed.
   */
  private enforceSizeLimit(): void {
    if (this.events.length < this._maxSize) {
      return
    }

    const droppedEvents: MongoChangeEvent<T>[] = []

    while (this.events.length >= this._maxSize) {
      const dropped = this.events.shift()
      if (dropped) {
        const droppedSize = this.estimateEventSize(dropped)
        this._memoryUsage -= droppedSize
        droppedEvents.push(dropped)
        if (this._enableStats) {
          this._droppedEvents++
        }
      }
    }

    if (droppedEvents.length > 0 && this._onOverflow) {
      this._onOverflow({
        droppedCount: droppedEvents.length,
        droppedEvents: droppedEvents as MongoChangeEvent<unknown>[],
      })
    }
  }
}
