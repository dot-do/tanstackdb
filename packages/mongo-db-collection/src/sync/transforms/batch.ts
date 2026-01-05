/**
 * Batch Event Transformer
 *
 * A high-performance transformer that collects MongoDB change events within a configurable
 * time window, optionally coalesces multiple events for the same document, and transforms
 * them to TanStack DB ChangeMessage format.
 *
 * ## Features
 *
 * - **Time-windowed batching**: Collects events within a configurable time window before processing
 * - **Size-limited batching**: Forces immediate flush when batch reaches maximum size
 * - **Event coalescing**: Optionally combines multiple events for the same document
 * - **Backpressure handling**: Prevents memory overflow during high-throughput scenarios
 * - **Parallel transform**: Optional parallel processing of event transformations
 * - **Detailed statistics**: Comprehensive metrics for monitoring and debugging
 * - **Lifecycle hooks**: Callbacks for batch begin, commit, and error events
 *
 * ## Architecture
 *
 * ```
 * MongoDB Change Stream
 *         │
 *         ▼
 * ┌───────────────────┐
 * │  BatchEventTransformer  │
 * │  ┌─────────────┐  │
 * │  │ Event Queue │  │  ◄── Backpressure monitored
 * │  └─────────────┘  │
 * │         │         │
 * │    ┌────┴────┐    │
 * │    ▼         ▼    │
 * │  Timer   Size Limit│
 * │    │         │    │
 * │    └────┬────┘    │
 * │         ▼         │
 * │  ┌─────────────┐  │
 * │  │  Coalesce   │  │  ◄── Optional
 * │  └─────────────┘  │
 * │         │         │
 * │         ▼         │
 * │  ┌─────────────┐  │
 * │  │  Transform  │  │  ◄── Sequential or Parallel
 * │  └─────────────┘  │
 * └─────────│─────────┘
 *           ▼
 *   ChangeMessage[]
 * ```
 *
 * ## Coalescing Logic
 *
 * When coalescing is enabled, multiple events for the same document are combined:
 *
 * | First Event | Subsequent Events | Result |
 * |-------------|-------------------|--------|
 * | insert      | update(s)         | insert with final value |
 * | insert      | delete            | no-op (events cancel out) |
 * | update      | update(s)         | single update with final value |
 * | update      | delete            | delete |
 * | delete      | (none expected)   | delete |
 *
 * @module @tanstack/mongo-db-collection/sync/transforms/batch
 * @see {@link BatchEventTransformer} - Main transformer class
 * @see {@link BatchEventTransformerOptions} - Configuration options
 * @see {@link BatchStatistics} - Statistics interface
 * @see {@link DetailedBatchStatistics} - Extended statistics with detailed metrics
 */

import type { MongoChangeEvent, ChangeMessage } from '../../types.js'

/**
 * Basic statistics about a processed batch.
 *
 * These statistics are provided to the `onCommit` callback after each batch
 * is successfully processed.
 *
 * @example
 * ```typescript
 * const transformer = new BatchEventTransformer({
 *   onCommit: (stats) => {
 *     console.log(`Processed ${stats.eventCount} events in ${stats.batchDurationMs}ms`)
 *     console.log(`  Inserts: ${stats.insertCount}`)
 *     console.log(`  Updates: ${stats.updateCount}`)
 *     console.log(`  Deletes: ${stats.deleteCount}`)
 *   }
 * })
 * ```
 */
export interface BatchStatistics {
  /** Total number of events in the batch after coalescing (if enabled) */
  eventCount: number
  /** Number of insert events in the final batch */
  insertCount: number
  /** Number of update events in the final batch */
  updateCount: number
  /** Number of delete events in the final batch */
  deleteCount: number
  /** Duration from first event arrival to batch completion in milliseconds */
  batchDurationMs: number
}

/**
 * Extended statistics with detailed performance metrics.
 *
 * Provides comprehensive metrics for monitoring batch processing performance,
 * including timing breakdowns, coalescing effectiveness, and throughput data.
 *
 * @example
 * ```typescript
 * const transformer = new BatchEventTransformer({
 *   detailedStats: true,
 *   onCommit: (stats: DetailedBatchStatistics) => {
 *     console.log(`Coalesced ${stats.rawEventCount} -> ${stats.eventCount} events`)
 *     console.log(`Transform time: ${stats.transformDurationMs}ms`)
 *     console.log(`Throughput: ${stats.eventsPerSecond.toFixed(2)} events/sec`)
 *   }
 * })
 * ```
 */
export interface DetailedBatchStatistics extends BatchStatistics {
  /** Number of raw events before coalescing */
  rawEventCount: number
  /** Number of unique documents affected */
  uniqueDocumentCount: number
  /** Events that were eliminated by coalescing (insert+delete pairs) */
  coalescedNoOpCount: number
  /** Time spent in transform phase (milliseconds) */
  transformDurationMs: number
  /** Time spent in coalescing phase (milliseconds), 0 if disabled */
  coalesceDurationMs: number
  /** Average events per second throughput */
  eventsPerSecond: number
  /** Memory estimate of the batch in bytes (approximate) */
  memoryEstimateBytes: number
  /** Whether this batch was triggered by size limit vs timer */
  triggeredBy: 'timer' | 'size' | 'manual' | 'backpressure'
  /** Peak queue size during this batch window */
  peakQueueSize: number
}

/**
 * Options for disposing the transformer.
 *
 * @example
 * ```typescript
 * // Dispose without flushing (discard pending events)
 * await transformer.dispose()
 *
 * // Dispose with flush (process pending events first)
 * await transformer.dispose({ flush: true })
 * ```
 */
export interface DisposeOptions {
  /** Whether to flush pending events before disposal. Defaults to false. */
  flush?: boolean
}

/**
 * Backpressure configuration options.
 *
 * Backpressure prevents memory overflow during high-throughput scenarios by
 * pausing event acceptance when the queue grows too large.
 *
 * @example
 * ```typescript
 * const transformer = new BatchEventTransformer({
 *   backpressure: {
 *     highWaterMark: 1000,
 *     lowWaterMark: 100,
 *     strategy: 'block'
 *   }
 * })
 * ```
 */
export interface BackpressureOptions {
  /**
   * Maximum number of pending events before triggering backpressure.
   * When this threshold is reached, the transformer will take action
   * based on the configured strategy.
   * @default 10000
   */
  highWaterMark?: number

  /**
   * Number of pending events at which backpressure is released.
   * Once the queue drains to this level, normal operation resumes.
   * @default 1000
   */
  lowWaterMark?: number

  /**
   * Strategy to use when backpressure is triggered:
   * - `'block'`: The `push()` method becomes async and waits for queue to drain
   * - `'drop'`: New events are silently dropped until queue drains
   * - `'error'`: Throws an error when trying to push during backpressure
   * @default 'block'
   */
  strategy?: 'block' | 'drop' | 'error'
}

/**
 * Parallel transform configuration options.
 *
 * Enables concurrent processing of event transformations for improved throughput
 * on multi-core systems.
 *
 * @example
 * ```typescript
 * const transformer = new BatchEventTransformer({
 *   parallel: {
 *     enabled: true,
 *     concurrency: 4,
 *     chunkSize: 25
 *   }
 * })
 * ```
 */
export interface ParallelTransformOptions {
  /**
   * Whether parallel transform is enabled.
   * @default false
   */
  enabled?: boolean

  /**
   * Maximum number of concurrent transform operations.
   * @default 4
   */
  concurrency?: number

  /**
   * Number of events to process per parallel chunk.
   * Larger chunks reduce overhead but may increase latency.
   * @default 25
   */
  chunkSize?: number
}

/**
 * Configuration options for BatchEventTransformer.
 *
 * These options control batching behavior, coalescing, backpressure handling,
 * parallel processing, and lifecycle callbacks.
 *
 * @typeParam T - The document type being transformed
 *
 * @example Basic configuration
 * ```typescript
 * const transformer = new BatchEventTransformer<User>({
 *   batchTimeMs: 100,
 *   maxBatchSize: 50,
 *   coalesce: true,
 *   onBatch: (messages) => collection.applyChanges(messages)
 * })
 * ```
 *
 * @example Full configuration with all options
 * ```typescript
 * const transformer = new BatchEventTransformer<User>({
 *   // Batching options
 *   batchTimeMs: 100,
 *   maxBatchSize: 1000,
 *   coalesce: true,
 *   includeMetadata: true,
 *   detailedStats: true,
 *
 *   // Backpressure configuration
 *   backpressure: {
 *     highWaterMark: 10000,
 *     lowWaterMark: 1000,
 *     strategy: 'block'
 *   },
 *
 *   // Parallel processing
 *   parallel: {
 *     enabled: true,
 *     concurrency: 4,
 *     chunkSize: 25
 *   },
 *
 *   // Lifecycle callbacks
 *   onBegin: () => console.log('Batch starting'),
 *   onBatch: async (messages) => {
 *     await collection.applyChanges(messages)
 *   },
 *   onCommit: (stats) => {
 *     metrics.recordBatch(stats)
 *   },
 *   onError: (error) => {
 *     logger.error('Batch processing failed', error)
 *   },
 *   onBackpressure: (state) => {
 *     logger.warn(`Backpressure ${state}`)
 *   }
 * })
 * ```
 */
export interface BatchEventTransformerOptions<T> {
  /**
   * Time window for collecting events in milliseconds.
   * Events arriving within this window will be batched together.
   * @default 50
   */
  batchTimeMs?: number

  /**
   * Maximum number of events before forcing a flush.
   * When the queue reaches this size, a flush is triggered immediately
   * regardless of the time window.
   * @default 100
   */
  maxBatchSize?: number

  /**
   * Whether to coalesce multiple events for the same document.
   * When enabled, multiple updates to the same document within a batch
   * window are combined into a single event with the final value.
   * @default false
   */
  coalesce?: boolean

  /**
   * Whether to include custom metadata in transformed messages.
   * Metadata passed to `push()` will be included in the output messages.
   * @default false
   */
  includeMetadata?: boolean

  /**
   * Whether to collect and report detailed statistics.
   * When enabled, `onCommit` receives `DetailedBatchStatistics` instead
   * of basic `BatchStatistics`.
   * @default false
   */
  detailedStats?: boolean

  /**
   * Backpressure configuration for handling high-throughput scenarios.
   * When not provided, backpressure handling is disabled.
   */
  backpressure?: BackpressureOptions

  /**
   * Parallel transform configuration for concurrent processing.
   * When not provided or disabled, transforms are processed sequentially.
   */
  parallel?: ParallelTransformOptions

  /**
   * Callback invoked before processing a batch.
   * Useful for acquiring locks, starting transactions, or logging.
   * Can be async - batch processing will wait for it to complete.
   */
  onBegin?: () => void | Promise<void>

  /**
   * Callback invoked with the transformed batch.
   * This is where you typically apply the changes to your collection.
   * Can be async - commit callback will wait for it to complete.
   *
   * @param messages - Array of transformed change messages
   */
  onBatch?: (messages: ChangeMessage<T>[]) => void | Promise<void>

  /**
   * Callback invoked after batch is processed with statistics.
   * Receives `DetailedBatchStatistics` if `detailedStats` is enabled,
   * otherwise receives basic `BatchStatistics`.
   *
   * @param stats - Batch processing statistics
   */
  onCommit?: (stats: BatchStatistics | DetailedBatchStatistics) => void | Promise<void>

  /**
   * Callback invoked when an error occurs during batch processing.
   * Errors in `onBegin`, `onBatch`, or `onCommit` will trigger this callback.
   *
   * @param error - The error that occurred
   */
  onError?: (error: Error) => void

  /**
   * Callback invoked when backpressure state changes.
   * Only called when backpressure handling is configured.
   *
   * @param state - 'active' when backpressure is triggered, 'released' when it's released
   */
  onBackpressure?: (state: 'active' | 'released') => void
}

/**
 * Internal representation of a pending event with metadata.
 *
 * This structure wraps incoming MongoDB change events with additional
 * tracking information needed for batching and statistics.
 *
 * @internal
 * @typeParam T - The document type
 */
interface PendingEvent<T> {
  /** The original MongoDB change event */
  event: MongoChangeEvent<T>
  /** Optional user-provided metadata to attach to the transformed message */
  metadata?: Record<string, unknown>
  /** Timestamp when this event was received (for statistics) */
  timestamp: number
}

/**
 * Coalesced event state for a document.
 *
 * When coalescing is enabled, multiple events for the same document are
 * tracked in this structure, which maintains the information needed to
 * produce the final coalesced event.
 *
 * @internal
 * @typeParam T - The document type
 */
interface CoalescedState<T> {
  /** The original operation type (first event for this document in the batch) */
  originalType: 'insert' | 'update' | 'delete' | 'replace'
  /** Whether the document was deleted after the original operation */
  wasDeleted: boolean
  /** The latest full document value (undefined for deletes) */
  latestValue?: T
  /** The latest metadata to include in the output message */
  metadata?: Record<string, unknown>
  /** Order index for preserving document ordering in output */
  orderIndex: number
}

/**
 * Internal statistics tracking during batch processing.
 *
 * @internal
 */
interface InternalStats {
  /** Peak queue size during this batch window */
  peakQueueSize: number
  /** What triggered this flush */
  triggeredBy: 'timer' | 'size' | 'manual' | 'backpressure'
  /** Number of no-op coalesced events (insert+delete) */
  coalescedNoOpCount: number
}

/**
 * Collects MongoDB change events within a time window and transforms them
 * to TanStack DB ChangeMessage format with optional coalescing.
 *
 * This is the main class for batch event transformation. It provides:
 *
 * - **Time-windowed batching**: Events are collected for a configurable duration
 * - **Size-limited batching**: Immediate flush when max size is reached
 * - **Event coalescing**: Combine multiple events for the same document
 * - **Backpressure handling**: Prevent memory overflow during high throughput
 * - **Parallel transforms**: Concurrent processing for improved performance
 * - **Detailed statistics**: Comprehensive metrics for monitoring
 *
 * @typeParam T - The document type, must have an `_id` field of type `string`
 *
 * @example Basic usage with a change stream
 * ```typescript
 * const transformer = new BatchEventTransformer<User>({
 *   batchTimeMs: 100,
 *   coalesce: true,
 *   onBatch: (messages) => {
 *     collection.applyChanges(messages)
 *   }
 * })
 *
 * // Push events from change stream
 * changeStream.on('change', (event) => transformer.push(event))
 *
 * // Clean up when done
 * await transformer.dispose({ flush: true })
 * ```
 *
 * @example With backpressure and parallel processing
 * ```typescript
 * const transformer = new BatchEventTransformer<Product>({
 *   batchTimeMs: 50,
 *   maxBatchSize: 1000,
 *   coalesce: true,
 *   backpressure: {
 *     highWaterMark: 10000,
 *     lowWaterMark: 1000,
 *     strategy: 'block'
 *   },
 *   parallel: {
 *     enabled: true,
 *     concurrency: 4
 *   },
 *   detailedStats: true,
 *   onBatch: async (messages) => {
 *     await database.bulkWrite(messages)
 *   },
 *   onCommit: (stats) => {
 *     metrics.recordBatchStats(stats)
 *   }
 * })
 * ```
 *
 * @example Handling backpressure with async push
 * ```typescript
 * const transformer = new BatchEventTransformer<Order>({
 *   backpressure: { strategy: 'block' },
 *   onBackpressure: (state) => {
 *     logger.warn(`Backpressure ${state}`)
 *   }
 * })
 *
 * // With backpressure 'block' strategy, push returns a promise
 * for (const event of events) {
 *   await transformer.push(event) // Will wait if under backpressure
 * }
 * ```
 */
export class BatchEventTransformer<T extends { _id: string }> {
  // ============================================================================
  // Public readonly configuration properties
  // ============================================================================

  /**
   * Time window for collecting events in milliseconds.
   * Events will be batched for this duration before processing.
   * @readonly
   */
  readonly batchTimeMs: number

  /**
   * Maximum batch size before forcing a flush.
   * When the queue reaches this size, processing begins immediately.
   * @readonly
   */
  readonly maxBatchSize: number

  // ============================================================================
  // Private configuration
  // ============================================================================

  /** Whether event coalescing is enabled */
  private readonly _coalesce: boolean
  /** Whether to include user-provided metadata in output */
  private readonly _includeMetadata: boolean
  /** Whether to collect detailed statistics */
  private readonly _detailedStats: boolean

  // Backpressure configuration
  /** High water mark for backpressure (undefined = disabled) */
  private readonly _backpressureHighWaterMark?: number
  /** Low water mark for backpressure */
  private readonly _backpressureLowWaterMark: number
  /** Backpressure strategy */
  private readonly _backpressureStrategy: 'block' | 'drop' | 'error'

  // Parallel transform configuration
  /** Whether parallel transform is enabled */
  private readonly _parallelEnabled: boolean
  /** Concurrency level for parallel transforms */
  private readonly _parallelConcurrency: number
  /** Chunk size for parallel transforms */
  private readonly _parallelChunkSize: number

  // Lifecycle callbacks
  private readonly _onBegin?: () => void | Promise<void>
  private readonly _onBatch?: (messages: ChangeMessage<T>[]) => void | Promise<void>
  private readonly _onCommit?: (stats: BatchStatistics | DetailedBatchStatistics) => void | Promise<void>
  private readonly _onError?: (error: Error) => void
  private readonly _onBackpressure?: (state: 'active' | 'released') => void

  // ============================================================================
  // Private state
  // ============================================================================

  /** Queue of pending events awaiting processing */
  private _pendingEvents: PendingEvent<T>[] = []
  /** Active batch timer */
  private _timer: ReturnType<typeof setTimeout> | null = null
  /** Timestamp when current batch started */
  private _batchStartTime: number | null = null
  /** Whether the transformer has been disposed */
  private _disposed = false
  /** Whether backpressure is currently active */
  private _backpressureActive = false
  /** Resolvers for blocked push calls (backpressure 'block' strategy) */
  private _backpressureWaiters: Array<() => void> = []
  /** Internal statistics tracking for current batch */
  private _currentStats: InternalStats = {
    peakQueueSize: 0,
    triggeredBy: 'timer',
    coalescedNoOpCount: 0,
  }

  // ============================================================================
  // Cumulative statistics (lifetime of transformer)
  // ============================================================================

  /** Total number of batches processed */
  private _totalBatchesProcessed = 0
  /** Total number of events processed */
  private _totalEventsProcessed = 0
  /** Total number of events dropped due to backpressure */
  private _totalEventsDropped = 0

  /**
   * Creates a new BatchEventTransformer.
   *
   * @param options - Configuration options for the transformer
   * @throws Error if batchTimeMs is zero or negative
   * @throws Error if maxBatchSize is zero or negative
   * @throws Error if backpressure lowWaterMark >= highWaterMark
   *
   * @example
   * ```typescript
   * const transformer = new BatchEventTransformer<User>({
   *   batchTimeMs: 100,
   *   maxBatchSize: 500,
   *   coalesce: true
   * })
   * ```
   */
  constructor(options: BatchEventTransformerOptions<T> = {}) {
    const batchTimeMs = options.batchTimeMs ?? 50
    const maxBatchSize = options.maxBatchSize ?? 100

    // Validate basic options
    if (batchTimeMs <= 0) {
      throw new Error('batchTimeMs must be a positive number')
    }
    if (maxBatchSize <= 0) {
      throw new Error('maxBatchSize must be a positive number')
    }

    // Store basic configuration
    this.batchTimeMs = batchTimeMs
    this.maxBatchSize = maxBatchSize
    this._coalesce = options.coalesce ?? false
    this._includeMetadata = options.includeMetadata ?? false
    this._detailedStats = options.detailedStats ?? false

    // Configure backpressure
    if (options.backpressure) {
      const bp = options.backpressure
      this._backpressureHighWaterMark = bp.highWaterMark ?? 10000
      this._backpressureLowWaterMark = bp.lowWaterMark ?? 1000
      this._backpressureStrategy = bp.strategy ?? 'block'

      // Validate backpressure settings
      if (this._backpressureLowWaterMark >= this._backpressureHighWaterMark) {
        throw new Error('backpressure.lowWaterMark must be less than highWaterMark')
      }
    } else {
      this._backpressureLowWaterMark = 1000
      this._backpressureStrategy = 'block'
    }

    // Configure parallel transform
    if (options.parallel?.enabled) {
      this._parallelEnabled = true
      this._parallelConcurrency = options.parallel.concurrency ?? 4
      this._parallelChunkSize = options.parallel.chunkSize ?? 25
    } else {
      this._parallelEnabled = false
      this._parallelConcurrency = 1
      this._parallelChunkSize = 25
    }

    // Store callbacks
    this._onBegin = options.onBegin
    this._onBatch = options.onBatch
    this._onCommit = options.onCommit
    this._onError = options.onError
    this._onBackpressure = options.onBackpressure
  }

  // ============================================================================
  // Public getters - State inspection
  // ============================================================================

  /**
   * Number of pending events waiting to be processed.
   *
   * This count includes all events in the queue, regardless of whether
   * they will be coalesced during processing.
   *
   * @example
   * ```typescript
   * transformer.push(event1)
   * transformer.push(event2)
   * console.log(transformer.pendingCount) // 2
   * ```
   */
  get pendingCount(): number {
    return this._pendingEvents.length
  }

  /**
   * Whether there are any pending events waiting to be processed.
   *
   * @example
   * ```typescript
   * if (transformer.hasPending) {
   *   await transformer.flush()
   * }
   * ```
   */
  get hasPending(): boolean {
    return this._pendingEvents.length > 0
  }

  /**
   * Whether backpressure is currently active.
   *
   * When true, the transformer is under memory pressure and may be
   * blocking, dropping, or rejecting new events depending on the
   * configured strategy.
   *
   * @example
   * ```typescript
   * if (transformer.isBackpressured) {
   *   // Maybe slow down the upstream source
   *   await pauseChangeStream()
   * }
   * ```
   */
  get isBackpressured(): boolean {
    return this._backpressureActive
  }

  /**
   * Whether the transformer has been disposed.
   *
   * Once disposed, the transformer will reject any new events.
   */
  get isDisposed(): boolean {
    return this._disposed
  }

  /**
   * Total number of batches processed since creation.
   *
   * Useful for monitoring and debugging.
   */
  get totalBatchesProcessed(): number {
    return this._totalBatchesProcessed
  }

  /**
   * Total number of events processed since creation.
   *
   * This is the count after coalescing (if enabled).
   */
  get totalEventsProcessed(): number {
    return this._totalEventsProcessed
  }

  /**
   * Total number of events dropped due to backpressure.
   *
   * Only applicable when using the 'drop' backpressure strategy.
   */
  get totalEventsDropped(): number {
    return this._totalEventsDropped
  }

  // ============================================================================
  // Public methods - Event handling
  // ============================================================================

  /**
   * Pushes a new event into the batch queue.
   *
   * Events are queued and processed in batches based on the configured
   * time window and size limits. The method behavior depends on the
   * backpressure configuration:
   *
   * - **No backpressure**: Always synchronous, always accepts
   * - **'block' strategy**: Returns a Promise that resolves when queue drains
   * - **'drop' strategy**: Silently drops the event if under pressure
   * - **'error' strategy**: Throws an error if under pressure
   *
   * @param event - The MongoDB change event to process
   * @param metadata - Optional metadata to attach to the transformed message
   * @returns A Promise if backpressure 'block' strategy is active, void otherwise
   *
   * @throws Error if the transformer has been disposed
   * @throws Error if backpressure 'error' strategy is active and queue is full
   *
   * @example Basic usage (synchronous)
   * ```typescript
   * changeStream.on('change', (event) => {
   *   transformer.push(event)
   * })
   * ```
   *
   * @example With metadata
   * ```typescript
   * transformer.push(event, {
   *   source: 'primary-cluster',
   *   receivedAt: Date.now()
   * })
   * ```
   *
   * @example With backpressure (async)
   * ```typescript
   * for (const event of events) {
   *   await transformer.push(event) // Waits if under pressure
   * }
   * ```
   */
  push(event: MongoChangeEvent<T>, metadata?: Record<string, unknown>): void | Promise<void> {
    if (this._disposed) {
      throw new Error('BatchEventTransformer has been disposed')
    }

    // Check backpressure
    if (this._backpressureActive) {
      return this._handleBackpressuredPush(event, metadata)
    }

    // Check if we need to trigger backpressure
    if (this._backpressureHighWaterMark !== undefined &&
        this._pendingEvents.length >= this._backpressureHighWaterMark) {
      this._activateBackpressure()
      return this._handleBackpressuredPush(event, metadata)
    }

    // Normal push
    this._enqueuEvent(event, metadata)
  }

  /**
   * Manually flushes all pending events.
   *
   * This method immediately processes all queued events, regardless of
   * whether the time window has expired. Useful for:
   *
   * - Ensuring all events are processed before shutdown
   * - Forcing immediate processing during testing
   * - Implementing custom flush triggers
   *
   * @returns Promise that resolves when the batch has been processed
   *
   * @example
   * ```typescript
   * // Process pending events immediately
   * await transformer.flush()
   *
   * // Or in cleanup code
   * process.on('SIGTERM', async () => {
   *   await transformer.flush()
   *   process.exit(0)
   * })
   * ```
   */
  async flush(): Promise<void> {
    this._cancelTimer()
    this._currentStats.triggeredBy = 'manual'
    await this._executeFlush()
  }

  /**
   * Disposes the transformer and releases all resources.
   *
   * After disposal:
   * - New events will be rejected with an error
   * - Pending timers are cancelled
   * - The event queue is cleared
   *
   * @param options - Disposal options
   * @param options.flush - If true, pending events are processed before disposal
   *
   * @example
   * ```typescript
   * // Dispose immediately (discard pending events)
   * await transformer.dispose()
   *
   * // Process pending events before disposal
   * await transformer.dispose({ flush: true })
   * ```
   */
  async dispose(options: DisposeOptions = {}): Promise<void> {
    if (this._disposed) {
      return
    }

    this._disposed = true
    this._cancelTimer()

    // Release any blocked pushes
    for (const resolve of this._backpressureWaiters) {
      resolve()
    }
    this._backpressureWaiters = []

    if (options.flush && this._pendingEvents.length > 0) {
      this._currentStats.triggeredBy = 'manual'
      await this._executeFlush()
    }

    this._pendingEvents = []
  }

  // ============================================================================
  // Private methods - Event enqueueing
  // ============================================================================

  /**
   * Enqueues an event and manages batch timing.
   *
   * @internal
   */
  private _enqueuEvent(event: MongoChangeEvent<T>, metadata?: Record<string, unknown>): void {
    const now = Date.now()

    // Start batch timing on first event
    if (this._batchStartTime === null) {
      this._batchStartTime = now
      this._currentStats = {
        peakQueueSize: 0,
        triggeredBy: 'timer',
        coalescedNoOpCount: 0,
      }
    }

    this._pendingEvents.push({
      event,
      metadata,
      timestamp: now,
    })

    // Update peak queue size
    if (this._pendingEvents.length > this._currentStats.peakQueueSize) {
      this._currentStats.peakQueueSize = this._pendingEvents.length
    }

    // Check if we need to flush due to size limit
    if (this._pendingEvents.length >= this.maxBatchSize) {
      this._currentStats.triggeredBy = 'size'
      this._scheduleFlush(true)
    } else if (this._timer === null) {
      // Start the batch timer
      this._timer = setTimeout(() => {
        this._executeFlush()
      }, this.batchTimeMs)
    }
  }

  /**
   * Handles a push when backpressure is active.
   *
   * @internal
   */
  private _handleBackpressuredPush(
    event: MongoChangeEvent<T>,
    metadata?: Record<string, unknown>
  ): void | Promise<void> {
    switch (this._backpressureStrategy) {
      case 'drop':
        this._totalEventsDropped++
        return

      case 'error':
        throw new Error(
          `BatchEventTransformer backpressure: queue size (${this._pendingEvents.length}) ` +
          `exceeds high water mark (${this._backpressureHighWaterMark})`
        )

      case 'block':
        // Return a promise that resolves when backpressure is released
        return new Promise<void>((resolve) => {
          this._backpressureWaiters.push(() => {
            if (!this._disposed) {
              this._enqueuEvent(event, metadata)
            }
            resolve()
          })
        })
    }
  }

  /**
   * Activates backpressure and notifies callback.
   *
   * @internal
   */
  private _activateBackpressure(): void {
    if (!this._backpressureActive) {
      this._backpressureActive = true
      this._onBackpressure?.('active')
    }
  }

  /**
   * Releases backpressure if queue is below low water mark.
   *
   * @internal
   */
  private _maybeReleaseBackpressure(): void {
    if (this._backpressureActive &&
        this._pendingEvents.length <= this._backpressureLowWaterMark) {
      this._backpressureActive = false
      this._onBackpressure?.('released')

      // Release blocked pushes
      const waiters = this._backpressureWaiters
      this._backpressureWaiters = []
      for (const resolve of waiters) {
        resolve()
      }
    }
  }

  // ============================================================================
  // Private methods - Timer management
  // ============================================================================

  /**
   * Schedules a flush, either immediately (for size limit) or via timer.
   *
   * @internal
   * @param immediate - If true, schedules for immediate execution
   */
  private _scheduleFlush(immediate: boolean): void {
    if (immediate) {
      this._cancelTimer()
      // Use setImmediate-like behavior with setTimeout(0)
      this._timer = setTimeout(() => {
        this._executeFlush()
      }, 0)
    }
  }

  /**
   * Cancels the pending batch timer if one exists.
   *
   * @internal
   */
  private _cancelTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer)
      this._timer = null
    }
  }

  // ============================================================================
  // Private methods - Batch execution
  // ============================================================================

  /**
   * Executes the batch flush operation.
   *
   * This is the main processing pipeline:
   * 1. Snapshot and clear pending events
   * 2. Call onBegin hook
   * 3. Transform events (with optional coalescing and parallelization)
   * 4. Call onBatch hook
   * 5. Calculate statistics
   * 6. Call onCommit hook
   *
   * @internal
   */
  private async _executeFlush(): Promise<void> {
    this._timer = null

    if (this._pendingEvents.length === 0) {
      this._batchStartTime = null
      return
    }

    // Snapshot state
    const eventsToProcess = this._pendingEvents
    const batchStartTime = this._batchStartTime ?? Date.now()
    const currentStats = { ...this._currentStats }

    // Reset for next batch
    this._pendingEvents = []
    this._batchStartTime = null
    this._currentStats = {
      peakQueueSize: 0,
      triggeredBy: 'timer',
      coalescedNoOpCount: 0,
    }

    // Check if backpressure should be released
    this._maybeReleaseBackpressure()

    try {
      // Call onBegin hook
      if (this._onBegin) {
        await this._onBegin()
      }

      // Transform events
      const transformStartTime = Date.now()
      const { messages, noOpCount } = await this._transformEvents(eventsToProcess)
      const transformDuration = Date.now() - transformStartTime
      currentStats.coalescedNoOpCount = noOpCount

      // Update cumulative stats
      this._totalBatchesProcessed++
      this._totalEventsProcessed += messages.length

      // If coalescing resulted in no messages (e.g., insert + delete),
      // don't call onBatch
      if (messages.length === 0) {
        return
      }

      // Call onBatch hook
      if (this._onBatch) {
        await this._onBatch(messages)
      }

      // Calculate and report statistics
      const stats = this._calculateStats(
        messages,
        eventsToProcess,
        batchStartTime,
        transformDuration,
        currentStats
      )

      // Call onCommit hook
      if (this._onCommit) {
        await this._onCommit(stats)
      }
    } catch (error) {
      if (this._onError) {
        this._onError(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  // ============================================================================
  // Private methods - Event transformation
  // ============================================================================

  /**
   * Transforms pending events to ChangeMessage format.
   *
   * Routes to either coalescing or non-coalescing transform based on
   * configuration. Also applies parallel processing if enabled.
   *
   * @internal
   * @param events - The pending events to transform
   * @returns Transform result with messages and statistics
   */
  private async _transformEvents(events: PendingEvent<T>[]): Promise<{ messages: ChangeMessage<T>[]; noOpCount: number }> {
    if (this._coalesce) {
      return this._transformWithCoalescing(events)
    }

    // Non-coalescing transform with optional parallelization
    const messages = this._parallelEnabled
      ? await this._transformWithParallel(events)
      : this._transformWithoutCoalescing(events)

    return { messages, noOpCount: 0 }
  }

  /**
   * Transforms events without coalescing (preserves all events in order).
   *
   * Each event is transformed independently, maintaining the original
   * sequence of operations.
   *
   * @internal
   * @param events - The pending events to transform
   * @returns Array of transformed change messages
   */
  private _transformWithoutCoalescing(events: PendingEvent<T>[]): ChangeMessage<T>[] {
    return events.map((pending) => this._transformSingleEvent(pending))
  }

  /**
   * Transforms events with parallel processing.
   *
   * Divides events into chunks and processes them concurrently for
   * improved throughput on multi-core systems. Maintains overall
   * ordering by processing chunks in sequence order but events
   * within chunks in parallel.
   *
   * @internal
   * @param events - The pending events to transform
   * @returns Array of transformed change messages
   */
  private async _transformWithParallel(events: PendingEvent<T>[]): Promise<ChangeMessage<T>[]> {
    const chunks: PendingEvent<T>[][] = []

    // Divide events into chunks
    for (let i = 0; i < events.length; i += this._parallelChunkSize) {
      chunks.push(events.slice(i, i + this._parallelChunkSize))
    }

    // Process chunks with limited concurrency
    const results: ChangeMessage<T>[] = []
    const activePromises: Promise<ChangeMessage<T>[]>[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!

      // Create promise for this chunk
      const chunkPromise = Promise.resolve(
        chunk.map((pending) => this._transformSingleEvent(pending))
      )

      activePromises.push(chunkPromise)

      // If we've reached max concurrency, wait for one to complete
      if (activePromises.length >= this._parallelConcurrency) {
        const chunkResults = await Promise.all(activePromises)
        for (const chunkResult of chunkResults) {
          results.push(...chunkResult)
        }
        activePromises.length = 0
      }
    }

    // Wait for remaining promises
    if (activePromises.length > 0) {
      const chunkResults = await Promise.all(activePromises)
      for (const chunkResult of chunkResults) {
        results.push(...chunkResult)
      }
    }

    return results
  }

  /**
   * Transforms events with coalescing (combines events for same document).
   *
   * Multiple events for the same document within the batch window are
   * combined according to the coalescing rules:
   *
   * - insert + update(s) = insert with final value
   * - insert + delete = no-op (cancelled out)
   * - update + update(s) = single update with final value
   * - update + delete = delete
   * - delete = delete
   *
   * @internal
   * @param events - The pending events to transform
   * @returns Transform result with messages and no-op count
   */
  private _transformWithCoalescing(events: PendingEvent<T>[]): { messages: ChangeMessage<T>[]; noOpCount: number } {
    const documentStates = new Map<string, CoalescedState<T>>()
    let orderCounter = 0

    // First pass: build coalesced state for each document
    for (const pending of events) {
      const docId = pending.event.documentKey._id
      const existing = documentStates.get(docId)

      if (!existing) {
        // First event for this document in this batch
        documentStates.set(docId, {
          originalType: pending.event.operationType,
          wasDeleted: pending.event.operationType === 'delete',
          latestValue: this._getFullDocument(pending.event),
          metadata: this._buildMetadata(pending),
          orderIndex: orderCounter++,
        })
      } else {
        // Subsequent event for this document - update the state
        this._updateCoalescedState(existing, pending)
      }
    }

    // Second pass: convert coalesced states to messages, sorted by order index
    const sortedStates = Array.from(documentStates.entries()).sort(
      ([, a], [, b]) => a.orderIndex - b.orderIndex
    )

    const messages: ChangeMessage<T>[] = []
    let noOpCount = 0

    for (const [docId, state] of sortedStates) {
      const message = this._coalescedStateToMessage(docId, state)
      if (message !== null) {
        messages.push(message)
      } else {
        // This was a no-op (e.g., insert followed by delete)
        noOpCount++
      }
    }

    return { messages, noOpCount }
  }

  /**
   * Updates a coalesced state with a new event for the same document.
   *
   * Called when multiple events for the same document occur within
   * a single batch window. Updates the state to reflect the new event
   * while preserving the original operation type for coalescing logic.
   *
   * @internal
   * @param state - The existing coalesced state to update
   * @param pending - The new event to incorporate
   */
  private _updateCoalescedState(state: CoalescedState<T>, pending: PendingEvent<T>): void {
    const eventType = pending.event.operationType

    // Update latest value and track deletion
    if (eventType === 'delete') {
      state.latestValue = undefined
      state.wasDeleted = true
    } else {
      state.latestValue = this._getFullDocument(pending.event)
      state.wasDeleted = false
    }

    // Update metadata if present
    if (pending.metadata || (this._includeMetadata && pending.event.operationType === 'update')) {
      state.metadata = this._buildMetadata(pending)
    }
  }

  /**
   * Converts a coalesced state to a ChangeMessage.
   *
   * Applies the coalescing logic to determine the final operation type
   * and value based on the sequence of events that occurred for this
   * document within the batch window.
   *
   * Coalescing rules:
   * - insert + delete = no-op (return null)
   * - insert + update(s) = insert with final value
   * - update(s) = update with final value
   * - update + delete = delete
   * - delete alone = delete
   *
   * @internal
   * @param docId - The document ID
   * @param state - The coalesced state for this document
   * @returns The coalesced change message, or null for no-ops
   */
  private _coalescedStateToMessage(docId: string, state: CoalescedState<T>): ChangeMessage<T> | null {
    // If original was insert and it ended with a delete, it's a no-op
    // (document was created and deleted within the same batch)
    if (state.originalType === 'insert' && state.wasDeleted) {
      return null
    }

    // If ended with a delete (and wasn't originally an insert), emit delete
    if (state.wasDeleted) {
      return {
        type: 'delete',
        key: docId,
        value: undefined as unknown as T,
      }
    }

    // If original was delete and not updated after, emit delete
    if (state.originalType === 'delete') {
      return {
        type: 'delete',
        key: docId,
        value: undefined as unknown as T,
      }
    }

    // If original was insert and has a value, emit insert with final value
    if (state.originalType === 'insert') {
      return {
        type: 'insert',
        key: docId,
        value: state.latestValue!,
        ...(state.metadata && { metadata: state.metadata }),
      }
    }

    // update or replace - emit as update with final value
    // We know latestValue exists because wasDeleted is false
    return {
      type: 'update',
      key: docId,
      value: state.latestValue!,
      ...(state.metadata && { metadata: state.metadata }),
    }
  }

  /**
   * Transforms a single MongoDB change event to ChangeMessage format.
   *
   * This is the core transformation logic that maps MongoDB change stream
   * event types to TanStack DB change message types:
   *
   * - `insert` -> `insert`
   * - `update` -> `update` (with field-level metadata)
   * - `replace` -> `update`
   * - `delete` -> `delete`
   *
   * @internal
   * @param pending - The pending event to transform
   * @returns The transformed change message
   */
  private _transformSingleEvent(pending: PendingEvent<T>): ChangeMessage<T> {
    const { event, metadata } = pending
    const docId = event.documentKey._id

    switch (event.operationType) {
      case 'insert':
        return {
          type: 'insert',
          key: docId,
          value: event.fullDocument,
          ...(this._includeMetadata && metadata && { metadata }),
        }

      case 'update':
        return {
          type: 'update',
          key: docId,
          value: event.fullDocument,
          metadata: {
            updatedFields: event.updateDescription.updatedFields,
            removedFields: event.updateDescription.removedFields,
            ...(this._includeMetadata && metadata),
          },
        }

      case 'replace':
        return {
          type: 'update',
          key: docId,
          value: event.fullDocument,
          ...(this._includeMetadata && metadata && { metadata }),
        }

      case 'delete':
        return {
          type: 'delete',
          key: docId,
          value: undefined as unknown as T,
          ...(this._includeMetadata && metadata && { metadata }),
        }
    }
  }

  // ============================================================================
  // Private methods - Utilities
  // ============================================================================

  /**
   * Extracts the full document from an event if present.
   *
   * Delete events don't have a fullDocument, so this returns undefined
   * for those. For all other event types, returns the fullDocument field.
   *
   * @internal
   * @param event - The MongoDB change event
   * @returns The full document, or undefined for delete events
   */
  private _getFullDocument(event: MongoChangeEvent<T>): T | undefined {
    if (event.operationType === 'delete') {
      return undefined
    }
    return event.fullDocument
  }

  /**
   * Builds metadata for a pending event.
   *
   * For update events, includes the updatedFields and removedFields
   * from the updateDescription. For other events, includes user-provided
   * metadata if includeMetadata is enabled.
   *
   * @internal
   * @param pending - The pending event
   * @returns The metadata object, or undefined if none
   */
  private _buildMetadata(pending: PendingEvent<T>): Record<string, unknown> | undefined {
    const { event, metadata } = pending

    if (event.operationType === 'update') {
      return {
        updatedFields: event.updateDescription.updatedFields,
        removedFields: event.updateDescription.removedFields,
        ...(this._includeMetadata && metadata),
      }
    }

    if (this._includeMetadata && metadata) {
      return metadata
    }

    return undefined
  }

  // ============================================================================
  // Private methods - Statistics
  // ============================================================================

  /**
   * Calculates statistics for a processed batch.
   *
   * Returns either basic `BatchStatistics` or `DetailedBatchStatistics`
   * depending on the `detailedStats` configuration option.
   *
   * @internal
   * @param messages - The transformed messages
   * @param rawEvents - The original pending events (for detailed stats)
   * @param batchStartTime - When the batch started
   * @param transformDuration - How long transformation took
   * @param internalStats - Internal tracking statistics
   * @returns The batch statistics
   */
  private _calculateStats(
    messages: ChangeMessage<T>[],
    rawEvents: PendingEvent<T>[],
    batchStartTime: number,
    transformDuration: number,
    internalStats: InternalStats
  ): BatchStatistics | DetailedBatchStatistics {
    // Count message types
    let insertCount = 0
    let updateCount = 0
    let deleteCount = 0

    for (const message of messages) {
      switch (message.type) {
        case 'insert':
          insertCount++
          break
        case 'update':
          updateCount++
          break
        case 'delete':
          deleteCount++
          break
      }
    }

    const batchDurationMs = Date.now() - batchStartTime

    // Basic statistics
    const basicStats: BatchStatistics = {
      eventCount: messages.length,
      insertCount,
      updateCount,
      deleteCount,
      batchDurationMs,
    }

    // Return basic stats if detailed stats not enabled
    if (!this._detailedStats) {
      return basicStats
    }

    // Calculate unique document count
    const uniqueDocIds = new Set<string>()
    for (const event of rawEvents) {
      uniqueDocIds.add(event.event.documentKey._id)
    }

    // Estimate memory usage (rough approximation)
    const memoryEstimateBytes = this._estimateMemoryUsage(rawEvents)

    // Calculate throughput
    const eventsPerSecond = batchDurationMs > 0
      ? (rawEvents.length / batchDurationMs) * 1000
      : 0

    // Detailed statistics
    const detailedStats: DetailedBatchStatistics = {
      ...basicStats,
      rawEventCount: rawEvents.length,
      uniqueDocumentCount: uniqueDocIds.size,
      coalescedNoOpCount: internalStats.coalescedNoOpCount,
      transformDurationMs: transformDuration,
      coalesceDurationMs: this._coalesce ? transformDuration : 0,
      eventsPerSecond,
      memoryEstimateBytes,
      triggeredBy: internalStats.triggeredBy,
      peakQueueSize: internalStats.peakQueueSize,
    }

    return detailedStats
  }

  /**
   * Estimates the memory usage of pending events.
   *
   * This is a rough approximation based on JSON serialization size.
   * Actual memory usage may vary due to JavaScript object overhead.
   *
   * @internal
   * @param events - The pending events to estimate
   * @returns Estimated memory usage in bytes
   */
  private _estimateMemoryUsage(events: PendingEvent<T>[]): number {
    // Rough estimate: JSON stringify length * 2 (for UTF-16 encoding)
    // Plus overhead for object structure
    let estimate = 0
    for (const event of events) {
      try {
        estimate += JSON.stringify(event.event).length * 2
        if (event.metadata) {
          estimate += JSON.stringify(event.metadata).length * 2
        }
      } catch {
        // If serialization fails, use a default estimate
        estimate += 500
      }
    }
    return estimate
  }
}
