/**
 * @file BatchExecutor - JSON-RPC Batch Request Handler
 *
 * A high-performance JSON-RPC batch executor that optimizes network usage by
 * collecting multiple RPC calls within a configurable time window and sending
 * them as batch arrays. This significantly reduces HTTP overhead for applications
 * making frequent API calls.
 *
 * ## Key Features
 *
 * ### Core Batching
 * - **Time-based batching**: Collects calls within a configurable time window (batchTimeMs)
 * - **Size-based flushing**: Sends immediately when batch size limit is reached (maxBatchSize)
 * - **Response correlation**: Maps responses back to original requests by ID
 * - **Partial failure handling**: Individual requests can fail independently
 * - **Manual flush**: Allows immediate sending of pending requests
 * - **Cleanup**: Proper disposal with pending request cancellation
 *
 * ### Advanced Features
 * - **Priority Queue**: Urgent requests can be prioritized or trigger immediate flush
 * - **Batch Grouping**: Configurable batch key function for separate concurrent batches
 * - **Compression**: Optional gzip/deflate compression for large payloads
 * - **Backpressure**: Memory protection with configurable limits and state callbacks
 * - **Statistics**: Detailed metrics for monitoring and debugging
 * - **Logging**: Optional structured logging for observability
 *
 * ## Architecture
 *
 * ```
 * call() ──┬──> PendingRequest ──┬──> BatchQueue[key] ──> Timer
 *          │                     │                          │
 *          │    (priority sort)  │    (batch key fn)        │ (batchTimeMs)
 *          │                     │                          ▼
 *          │                     │                     executeFlush()
 *          │                     │                          │
 *          │    (immediate)      │    (maxBatchSize)        │
 *          └─────────────────────┴──────────────────────────┘
 *                                          │
 *                                          ▼
 *                                    doFlush(requests)
 *                                          │
 *                                    (compression?)
 *                                          │
 *                                          ▼
 *                                    HTTP POST (fetch)
 *                                          │
 *                                          ▼
 *                                    correlateResponses()
 *                                          │
 *                                  ┌───────┴───────┐
 *                                  ▼               ▼
 *                            resolve()        reject()
 * ```
 *
 * ## Performance Considerations
 *
 * - Batching reduces connection overhead by ~10-50x for frequent small requests
 * - Priority queue adds minimal overhead (O(n) insertion, but n is typically small)
 * - Compression is only applied above threshold to avoid overhead on small batches
 * - Statistics collection has negligible impact on performance
 *
 * ## Thread Safety
 *
 * This class is designed for single-threaded JavaScript environments. In Node.js
 * with worker threads, each thread should have its own BatchExecutor instance.
 *
 * @see https://www.jsonrpc.org/specification#batch
 * @module @tanstack/mongo-db-collection/rpc/batch
 *
 * @example Basic Usage
 * ```typescript
 * const executor = new BatchExecutor({
 *   endpoint: 'https://api.mongo.do/rpc',
 *   batchTimeMs: 50,
 *   maxBatchSize: 100,
 *   authToken: 'your-token',
 * })
 *
 * // These calls will be batched together
 * const [users, count] = await Promise.all([
 *   executor.call('users.find', { query: { active: true } }),
 *   executor.call('users.count', { query: { active: true } }),
 * ])
 *
 * // Clean up when done
 * executor.dispose()
 * ```
 *
 * @example Priority Requests
 * ```typescript
 * const executor = new BatchExecutor({
 *   endpoint: 'https://api.mongo.do/rpc',
 *   batchTimeMs: 100,
 *   maxBatchSize: 50,
 *   enablePriorityQueue: true,
 * })
 *
 * // Critical requests flush immediately
 * const result = await executor.call(
 *   'auth.validate',
 *   { token: 'xyz' },
 *   { priority: 'critical' }
 * )
 * ```
 *
 * @example Multi-Tenant Batching
 * ```typescript
 * const executor = new BatchExecutor({
 *   endpoint: 'https://api.mongo.do/rpc',
 *   batchTimeMs: 50,
 *   maxBatchSize: 100,
 *   batchKeyFn: (method, params) => {
 *     const p = params as { tenant?: string }
 *     return p?.tenant ?? 'default'
 *   },
 * })
 *
 * // Requests for different tenants go in separate batches
 * executor.call('data.query', { tenant: 'acme', query: {} })
 * executor.call('data.query', { tenant: 'globex', query: {} })
 * ```
 */

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  BatchExecutorConfig,
  BatchStatistics,
  RequestPriority,
  CallOptions,
  BackpressureState,
  CompressionConfig,
  BackpressureCallback,
  BatchKeyFunction,
} from './types.js'
import { PRIORITY_VALUES } from './types.js'

// =============================================================================
// Constants
// =============================================================================

/**
 * Default batch key used when no batch key function is provided
 * or when the function returns undefined.
 */
const DEFAULT_BATCH_KEY = '__default__'

/**
 * Default timeout for requests in milliseconds.
 */
const DEFAULT_TIMEOUT_MS = 30000

/**
 * Default maximum pending requests for backpressure.
 */
const DEFAULT_MAX_PENDING = 10000

/**
 * Default warning threshold as a percentage of max pending.
 */
const DEFAULT_WARNING_THRESHOLD = 0.8

/**
 * Default compression threshold in bytes.
 */
const DEFAULT_COMPRESSION_THRESHOLD = 1024

// =============================================================================
// Types
// =============================================================================

/**
 * Internal representation of a pending request with its promise resolvers
 * and metadata for priority ordering and batching.
 *
 * @internal
 * @typeParam T - The expected result type of the request
 */
interface PendingRequest<T = unknown> {
  /** Unique request ID for response correlation */
  readonly id: number

  /** The RPC method name */
  readonly method: string

  /** Method parameters (may be undefined for parameterless methods) */
  readonly params: unknown

  /** Priority level for queue ordering */
  readonly priority: RequestPriority

  /** Batch key for grouping requests */
  readonly batchKey: string

  /** Timestamp when the request was created (for statistics) */
  readonly createdAt: number

  /** Optional timeout timer handle */
  timeoutTimer?: ReturnType<typeof setTimeout>

  /** Promise resolve function */
  resolve: (value: T) => void

  /** Promise reject function */
  reject: (error: Error) => void
}

/**
 * Represents a batch queue with its timer and pending requests.
 *
 * @internal
 */
interface BatchQueue {
  /** Pending requests in this batch */
  requests: PendingRequest[]

  /** Timer handle for time-based flushing */
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * Flush trigger type for statistics tracking.
 *
 * @internal
 */
type FlushTrigger = 'time' | 'size' | 'priority' | 'manual'

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Creates an initial empty statistics object.
 *
 * @returns A new BatchStatistics object with zero/empty values
 * @internal
 */
function createInitialStatistics(): BatchStatistics {
  return {
    totalBatches: 0,
    totalRequests: 0,
    totalErrors: 0,
    averageBatchSize: 0,
    minBatchSize: Infinity,
    maxBatchSize: 0,
    timeTriggeredFlushes: 0,
    sizeTriggeredFlushes: 0,
    priorityTriggeredFlushes: 0,
    manualFlushes: 0,
    averageFlushIntervalMs: 0,
    totalBytesSent: 0,
    totalBytesCompressed: 0,
    backpressureEvents: 0,
    createdAt: Date.now(),
    lastFlushAt: null,
  }
}

/**
 * Compares two pending requests by priority for sorting.
 * Higher priority requests come first (descending order).
 *
 * @param a - First request to compare
 * @param b - Second request to compare
 * @returns Negative if a should come first, positive if b should come first
 * @internal
 */
function comparePriority(a: PendingRequest, b: PendingRequest): number {
  return PRIORITY_VALUES[b.priority] - PRIORITY_VALUES[a.priority]
}

/**
 * Compresses data using the specified algorithm.
 * Falls back to uncompressed data if CompressionStream is not available.
 *
 * @param data - The string data to compress
 * @param algorithm - The compression algorithm to use
 * @returns Compressed data as Uint8Array, or original string if compression unavailable
 * @internal
 */
async function compressData(
  data: string,
  algorithm: 'gzip' | 'deflate'
): Promise<{ compressed: Uint8Array | string; isCompressed: boolean }> {
  // Check if CompressionStream is available (modern browsers and Node.js 18+)
  if (typeof CompressionStream === 'undefined') {
    return { compressed: data, isCompressed: false }
  }

  try {
    const encoder = new TextEncoder()
    const inputBytes = encoder.encode(data)

    const compressionStream = new CompressionStream(algorithm)
    const writer = compressionStream.writable.getWriter()
    const reader = compressionStream.readable.getReader()

    // Write and close
    writer.write(inputBytes)
    writer.close()

    // Read compressed chunks
    const chunks: Uint8Array[] = []
    let totalLength = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalLength += value.length
    }

    // Combine chunks
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return { compressed: result, isCompressed: true }
  } catch {
    // Compression failed, return original
    return { compressed: data, isCompressed: false }
  }
}

// =============================================================================
// BatchExecutor Class
// =============================================================================

/**
 * Batches multiple RPC calls together for efficient network usage.
 *
 * The BatchExecutor implements the JSON-RPC 2.0 batch specification, collecting
 * multiple RPC calls within a time window and sending them as a single HTTP
 * request. This reduces network overhead and improves throughput for applications
 * that make frequent API calls.
 *
 * ## Lifecycle
 *
 * 1. **Creation**: Instantiate with configuration options
 * 2. **Operation**: Make calls using `call()` method
 * 3. **Flushing**: Automatic (timer/size) or manual via `flush()`
 * 4. **Disposal**: Call `dispose()` to clean up resources
 *
 * ## Error Handling
 *
 * - **Network errors**: All requests in the batch are rejected
 * - **HTTP errors**: All requests in the batch are rejected with status info
 * - **JSON-RPC errors**: Individual requests are rejected with error details
 * - **Missing responses**: Individual requests are rejected with descriptive error
 * - **Timeouts**: Individual requests are rejected when timeout expires
 * - **Disposal**: Pending requests are rejected with disposal error
 *
 * @example
 * ```typescript
 * const executor = new BatchExecutor({
 *   endpoint: 'https://api.mongo.do/rpc',
 *   batchTimeMs: 50,
 *   maxBatchSize: 100,
 *   authToken: 'your-token',
 *   enablePriorityQueue: true,
 *   enableStatistics: true,
 * })
 *
 * // Make batched calls
 * const results = await Promise.all([
 *   executor.call('users.find', { query: {} }),
 *   executor.call('users.count', { query: {} }),
 * ])
 *
 * // Check statistics
 * const stats = executor.getStatistics()
 * console.log(`Processed ${stats.totalRequests} requests in ${stats.totalBatches} batches`)
 *
 * // Clean up
 * executor.dispose()
 * ```
 *
 * @see {@link BatchExecutorConfig} for configuration options
 * @see {@link BatchStatistics} for available statistics
 * @see {@link CallOptions} for per-call options
 */
export class BatchExecutor {
  // ===========================================================================
  // Private Fields - Configuration (Immutable)
  // ===========================================================================

  /** RPC endpoint URL */
  private readonly endpoint: string

  /** Time window in milliseconds for collecting requests */
  private readonly batchTimeMs: number

  /** Maximum requests per batch */
  private readonly maxBatchSize: number

  /** HTTP fetch function (injectable for testing) */
  private readonly fetchFn: typeof fetch

  /** Optional Bearer token for authentication */
  private readonly authToken?: string

  /** Custom headers to include in requests */
  private readonly customHeaders?: Record<string, string>

  /** Whether priority queue is enabled */
  private readonly enablePriorityQueue: boolean

  /** Batch key function for request grouping */
  private readonly batchKeyFn?: BatchKeyFunction

  /** Compression configuration */
  private readonly compressionConfig: CompressionConfig

  /** Maximum pending requests (0 = unlimited) */
  private readonly maxPendingRequests: number

  /** Warning threshold as percentage of max pending */
  private readonly warningThreshold: number

  /** Backpressure state change callback */
  private readonly onBackpressureChange?: BackpressureCallback

  /** Default request timeout in milliseconds */
  private readonly defaultTimeout: number

  /** Whether statistics collection is enabled */
  private readonly statisticsEnabled: boolean

  /** Optional logger for debugging */
  private readonly logger?: BatchExecutorConfig['logger']

  // ===========================================================================
  // Private Fields - Mutable State
  // ===========================================================================

  /**
   * Map of batch queues keyed by batch key.
   * Each queue contains pending requests and a timer.
   */
  private batchQueues: Map<string, BatchQueue> = new Map()

  /**
   * Total count of pending requests across all queues.
   * Used for backpressure calculations.
   */
  private totalPendingCount = 0

  /**
   * Auto-incrementing request ID counter.
   * Ensures unique IDs within this executor instance.
   */
  private requestIdCounter = 0

  /**
   * Whether this executor has been disposed.
   * After disposal, new calls are rejected.
   */
  private disposed = false

  /**
   * Current backpressure state.
   * Used to avoid redundant callbacks.
   */
  private currentBackpressureState: BackpressureState = 'ok'

  /**
   * Statistics accumulator.
   * Only populated if statisticsEnabled is true.
   */
  private statistics: BatchStatistics

  /**
   * Timestamps of recent flushes for calculating average interval.
   * Keeps last 100 timestamps.
   */
  private flushTimestamps: number[] = []

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Creates a new BatchExecutor instance.
   *
   * @param config - Configuration options for the executor
   * @throws {Error} If endpoint is empty or invalid
   * @throws {Error} If batchTimeMs is not a positive number
   * @throws {Error} If maxBatchSize is not a positive number
   *
   * @example
   * ```typescript
   * const executor = new BatchExecutor({
   *   endpoint: 'https://api.mongo.do/rpc',
   *   batchTimeMs: 50,
   *   maxBatchSize: 100,
   * })
   * ```
   */
  constructor(config: BatchExecutorConfig) {
    // =========================================================================
    // Validate Required Configuration
    // =========================================================================

    if (!config.endpoint || config.endpoint.trim() === '') {
      throw new Error('BatchExecutor: endpoint is required and must be a non-empty string')
    }
    if (!config.batchTimeMs || config.batchTimeMs <= 0) {
      throw new Error('BatchExecutor: batchTimeMs must be a positive number')
    }
    if (!config.maxBatchSize || config.maxBatchSize <= 0) {
      throw new Error('BatchExecutor: maxBatchSize must be a positive number')
    }

    // =========================================================================
    // Initialize Core Configuration
    // =========================================================================

    this.endpoint = config.endpoint
    this.batchTimeMs = config.batchTimeMs
    this.maxBatchSize = config.maxBatchSize
    this.fetchFn = config.fetch ?? globalThis.fetch
    this.authToken = config.authToken
    this.customHeaders = config.headers

    // =========================================================================
    // Initialize Advanced Configuration
    // =========================================================================

    this.enablePriorityQueue = config.enablePriorityQueue ?? false
    this.batchKeyFn = config.batchKeyFn
    this.defaultTimeout = config.defaultTimeout ?? DEFAULT_TIMEOUT_MS
    this.statisticsEnabled = config.enableStatistics ?? true
    this.logger = config.logger

    // Compression configuration with defaults
    this.compressionConfig = {
      algorithm: config.compression?.algorithm ?? 'none',
      threshold: config.compression?.threshold ?? DEFAULT_COMPRESSION_THRESHOLD,
      level: config.compression?.level ?? 6,
    }

    // Backpressure configuration with defaults
    this.maxPendingRequests = config.backpressure?.maxPendingRequests ?? DEFAULT_MAX_PENDING
    this.warningThreshold = config.backpressure?.warningThreshold ?? DEFAULT_WARNING_THRESHOLD
    this.onBackpressureChange = config.backpressure?.onBackpressureChange

    // Initialize statistics
    this.statistics = createInitialStatistics()

    this.logger?.debug?.('BatchExecutor created', {
      endpoint: this.endpoint,
      batchTimeMs: this.batchTimeMs,
      maxBatchSize: this.maxBatchSize,
      enablePriorityQueue: this.enablePriorityQueue,
      compression: this.compressionConfig.algorithm,
      maxPendingRequests: this.maxPendingRequests,
    })
  }

  // ===========================================================================
  // Public Methods - Core API
  // ===========================================================================

  /**
   * Queues an RPC call to be batched with other pending calls.
   *
   * The call will be sent as part of a batch when either:
   * - The batch time window expires (batchTimeMs)
   * - The batch size limit is reached (maxBatchSize)
   * - A critical priority request triggers immediate flush
   * - `flush()` is called manually
   *
   * @typeParam T - The expected result type
   * @param method - The RPC method name (e.g., 'users.find', 'db.count')
   * @param params - Optional parameters for the method
   * @param options - Optional call configuration (priority, batch key, timeout)
   * @returns Promise that resolves with the result or rejects with an error
   *
   * @throws {Error} If executor has been disposed (rejects the promise)
   * @throws {Error} If backpressure limit is exceeded (rejects the promise)
   * @throws {Error} If request times out (rejects the promise)
   *
   * @example Basic call
   * ```typescript
   * const users = await executor.call<User[]>('users.find', { query: { active: true } })
   * ```
   *
   * @example With priority
   * ```typescript
   * const result = await executor.call('auth.validate', { token }, { priority: 'critical' })
   * ```
   *
   * @example With custom batch key
   * ```typescript
   * const result = await executor.call('query', params, { batchKey: 'tenant-123' })
   * ```
   *
   * @example Immediate (skip batching)
   * ```typescript
   * const result = await executor.call('urgent.operation', params, { immediate: true })
   * ```
   */
  call<T = unknown>(method: string, params?: unknown, options?: CallOptions): Promise<T> {
    // =========================================================================
    // Pre-flight Checks
    // =========================================================================

    // Check if disposed
    if (this.disposed) {
      const rejection = Promise.reject<T>(
        new Error('BatchExecutor has been disposed - cannot accept new calls')
      )
      rejection.catch(() => {}) // Prevent unhandled rejection warning
      return rejection
    }

    // Check backpressure
    if (this.maxPendingRequests > 0 && this.totalPendingCount >= this.maxPendingRequests) {
      this.updateBackpressureState()
      if (this.statisticsEnabled) {
        this.statistics.backpressureEvents++
      }
      const rejection = Promise.reject<T>(
        new Error(
          `BatchExecutor backpressure: ${this.totalPendingCount} pending requests exceeds limit of ${this.maxPendingRequests}`
        )
      )
      rejection.catch(() => {})
      this.logger?.warn?.('Backpressure limit reached, rejecting call', {
        method,
        pending: this.totalPendingCount,
        max: this.maxPendingRequests,
      })
      return rejection
    }

    // =========================================================================
    // Handle Immediate Mode
    // =========================================================================

    if (options?.immediate) {
      return this.executeImmediate<T>(method, params, options)
    }

    // =========================================================================
    // Create and Queue Request
    // =========================================================================

    const promise = new Promise<T>((resolve, reject) => {
      const id = ++this.requestIdCounter
      const priority = options?.priority ?? 'normal'
      const batchKey = options?.batchKey ?? this.batchKeyFn?.(method, params) ?? DEFAULT_BATCH_KEY
      const timeout = options?.timeout ?? this.defaultTimeout

      const pendingRequest: PendingRequest = {
        id,
        method,
        params,
        priority,
        batchKey,
        createdAt: Date.now(),
        resolve: resolve as (value: unknown) => void,
        reject,
      }

      // Set up timeout if configured
      if (timeout > 0) {
        pendingRequest.timeoutTimer = setTimeout(() => {
          this.handleRequestTimeout(pendingRequest)
        }, timeout)
      }

      // Add to appropriate batch queue
      this.addToQueue(pendingRequest)

      this.logger?.debug?.('Request queued', { id, method, priority, batchKey })
    })

    // Prevent unhandled rejection warnings
    promise.catch(() => {})

    return promise
  }

  /**
   * Manually flushes all pending requests immediately.
   *
   * This method is useful when you need results right away without waiting
   * for the time window to expire. It flushes all batch queues concurrently.
   *
   * @returns Promise that resolves when all batches have been sent and processed
   *
   * @example
   * ```typescript
   * // Queue some calls
   * const promise1 = executor.call('method1', params1)
   * const promise2 = executor.call('method2', params2)
   *
   * // Flush immediately
   * await executor.flush()
   *
   * // Results are now available
   * const [result1, result2] = await Promise.all([promise1, promise2])
   * ```
   */
  async flush(): Promise<void> {
    if (this.batchQueues.size === 0) {
      return
    }

    this.logger?.debug?.('Manual flush triggered', { queueCount: this.batchQueues.size })

    // Collect all queues to flush
    const queuesToFlush: Array<{ key: string; requests: PendingRequest[] }> = []

    for (const [key, queue] of this.batchQueues) {
      // Cancel the timer if running
      if (queue.timer !== null) {
        clearTimeout(queue.timer)
      }

      if (queue.requests.length > 0) {
        queuesToFlush.push({ key, requests: queue.requests })
      }
    }

    // Clear all queues
    this.batchQueues.clear()
    this.totalPendingCount = 0
    this.updateBackpressureState()

    // Update statistics
    if (this.statisticsEnabled) {
      this.statistics.manualFlushes += queuesToFlush.length
    }

    // Flush all queues concurrently
    await Promise.all(queuesToFlush.map(({ requests }) => this.doFlush(requests, 'manual')))
  }

  /**
   * Disposes the executor, cancelling all pending requests and timers.
   *
   * After disposal:
   * - All pending requests are rejected with a disposal error
   * - New calls will be rejected immediately
   * - All timers are cleared
   * - Statistics remain available via `getStatistics()`
   *
   * This method is idempotent - calling it multiple times has no additional effect.
   *
   * @example
   * ```typescript
   * const executor = new BatchExecutor(config)
   *
   * // ... use executor ...
   *
   * // Clean up when done
   * executor.dispose()
   *
   * // New calls will be rejected
   * await executor.call('method', {}) // Throws: "BatchExecutor has been disposed"
   * ```
   */
  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.logger?.info?.('BatchExecutor disposing', { pendingCount: this.totalPendingCount })

    const error = new Error('BatchExecutor disposed - all pending requests cancelled')

    // Reject all pending requests and clear timers
    for (const [, queue] of this.batchQueues) {
      if (queue.timer !== null) {
        clearTimeout(queue.timer)
      }

      for (const request of queue.requests) {
        if (request.timeoutTimer) {
          clearTimeout(request.timeoutTimer)
        }
        request.reject(error)
      }
    }

    // Clear all queues
    this.batchQueues.clear()
    this.totalPendingCount = 0
  }

  // ===========================================================================
  // Public Methods - Statistics & Monitoring
  // ===========================================================================

  /**
   * Returns a snapshot of the current batch execution statistics.
   *
   * Statistics are only collected if `enableStatistics` is true in config
   * (default: true). The returned object is a copy and can be safely modified.
   *
   * @returns Current statistics snapshot
   *
   * @example
   * ```typescript
   * const stats = executor.getStatistics()
   *
   * console.log(`Total batches: ${stats.totalBatches}`)
   * console.log(`Average batch size: ${stats.averageBatchSize.toFixed(2)}`)
   * console.log(`Time-triggered flushes: ${stats.timeTriggeredFlushes}`)
   * console.log(`Size-triggered flushes: ${stats.sizeTriggeredFlushes}`)
   *
   * if (stats.totalBytesCompressed > 0) {
   *   const ratio = stats.totalBytesCompressed / stats.totalBytesSent
   *   console.log(`Compression ratio: ${(ratio * 100).toFixed(1)}%`)
   * }
   * ```
   */
  getStatistics(): BatchStatistics {
    // Return a copy to prevent external modification
    return { ...this.statistics }
  }

  /**
   * Resets all statistics to initial values.
   *
   * Useful for monitoring specific time periods or after configuration changes.
   * The `createdAt` timestamp is updated to the current time.
   *
   * @example
   * ```typescript
   * // Start monitoring
   * executor.resetStatistics()
   *
   * // ... perform operations ...
   *
   * // Check results
   * const stats = executor.getStatistics()
   * console.log(`Processed ${stats.totalRequests} requests since reset`)
   * ```
   */
  resetStatistics(): void {
    this.statistics = createInitialStatistics()
    this.flushTimestamps = []
    this.logger?.debug?.('Statistics reset')
  }

  /**
   * Returns the current backpressure state.
   *
   * @returns Current backpressure state ('ok', 'warning', or 'critical')
   *
   * @example
   * ```typescript
   * const state = executor.getBackpressureState()
   *
   * if (state === 'warning') {
   *   console.log('Consider slowing down request rate')
   * } else if (state === 'critical') {
   *   console.log('Request queue full - requests will be rejected')
   * }
   * ```
   */
  getBackpressureState(): BackpressureState {
    return this.currentBackpressureState
  }

  /**
   * Returns the current count of pending (queued) requests.
   *
   * @returns Number of requests waiting to be sent
   *
   * @example
   * ```typescript
   * const pending = executor.getPendingCount()
   * console.log(`${pending} requests in queue`)
   * ```
   */
  getPendingCount(): number {
    return this.totalPendingCount
  }

  /**
   * Returns whether the executor has been disposed.
   *
   * @returns true if dispose() has been called
   */
  isDisposed(): boolean {
    return this.disposed
  }

  // ===========================================================================
  // Private Methods - Queue Management
  // ===========================================================================

  /**
   * Adds a request to the appropriate batch queue.
   *
   * @param request - The pending request to queue
   * @internal
   */
  private addToQueue(request: PendingRequest): void {
    const { batchKey, priority } = request

    // Get or create the queue for this batch key
    let queue = this.batchQueues.get(batchKey)
    if (!queue) {
      queue = { requests: [], timer: null }
      this.batchQueues.set(batchKey, queue)
    }

    // Add request to queue
    queue.requests.push(request)
    this.totalPendingCount++

    // Sort by priority if enabled
    if (this.enablePriorityQueue && queue.requests.length > 1) {
      queue.requests.sort(comparePriority)
    }

    // Update backpressure state
    this.updateBackpressureState()

    // Check for immediate flush triggers
    const shouldFlushImmediately =
      queue.requests.length >= this.maxBatchSize ||
      (this.enablePriorityQueue && priority === 'critical')

    if (shouldFlushImmediately) {
      // Clear existing timer
      if (queue.timer !== null) {
        clearTimeout(queue.timer)
        queue.timer = null
      }

      // Determine trigger type
      const trigger: FlushTrigger =
        this.enablePriorityQueue && priority === 'critical' ? 'priority' : 'size'

      // Execute flush
      this.executeFlush(batchKey, trigger)
    } else if (queue.timer === null) {
      // Start batch timer
      queue.timer = setTimeout(() => {
        queue!.timer = null
        this.executeFlush(batchKey, 'time')
      }, this.batchTimeMs)
    }
  }

  /**
   * Removes a request from its queue (for timeout handling).
   *
   * @param request - The request to remove
   * @returns true if the request was found and removed
   * @internal
   */
  private removeFromQueue(request: PendingRequest): boolean {
    const queue = this.batchQueues.get(request.batchKey)
    if (!queue) {
      return false
    }

    const index = queue.requests.findIndex((r) => r.id === request.id)
    if (index === -1) {
      return false
    }

    queue.requests.splice(index, 1)
    this.totalPendingCount--
    this.updateBackpressureState()

    // Clean up empty queue
    if (queue.requests.length === 0) {
      if (queue.timer !== null) {
        clearTimeout(queue.timer)
      }
      this.batchQueues.delete(request.batchKey)
    }

    return true
  }

  // ===========================================================================
  // Private Methods - Flush Operations
  // ===========================================================================

  /**
   * Executes a flush operation for a specific batch queue.
   *
   * @param batchKey - The batch key to flush
   * @param trigger - What triggered the flush (for statistics)
   * @internal
   */
  private executeFlush(batchKey: string, trigger: FlushTrigger): void {
    const queue = this.batchQueues.get(batchKey)
    if (!queue || queue.requests.length === 0) {
      return
    }

    // Take the current requests
    const requests = queue.requests
    queue.requests = []

    // Update pending count
    this.totalPendingCount -= requests.length
    this.updateBackpressureState()

    // Clean up queue if empty
    if (queue.timer !== null) {
      clearTimeout(queue.timer)
      queue.timer = null
    }
    this.batchQueues.delete(batchKey)

    this.logger?.debug?.('Executing flush', {
      batchKey,
      trigger,
      requestCount: requests.length,
    })

    // Fire and forget - let the batch be processed independently
    this.doFlush(requests, trigger).catch(() => {
      // Errors are already handled in doFlush by rejecting individual promises
    })
  }

  /**
   * Performs the actual batch HTTP request and response handling.
   *
   * @param requests - The requests to send in this batch
   * @param trigger - What triggered the flush (for statistics)
   * @internal
   */
  private async doFlush(requests: PendingRequest[], trigger: FlushTrigger): Promise<void> {
    if (requests.length === 0) {
      return
    }

    const startTime = Date.now()

    // Clear timeout timers for all requests
    for (const request of requests) {
      if (request.timeoutTimer) {
        clearTimeout(request.timeoutTimer)
        request.timeoutTimer = undefined
      }
    }

    // =========================================================================
    // Update Statistics
    // =========================================================================

    if (this.statisticsEnabled) {
      this.statistics.totalBatches++
      this.statistics.totalRequests += requests.length

      // Update min/max batch size
      if (requests.length < this.statistics.minBatchSize) {
        this.statistics.minBatchSize = requests.length
      }
      if (requests.length > this.statistics.maxBatchSize) {
        this.statistics.maxBatchSize = requests.length
      }

      // Update average batch size
      this.statistics.averageBatchSize =
        this.statistics.totalRequests / this.statistics.totalBatches

      // Update trigger-specific counters
      switch (trigger) {
        case 'time':
          this.statistics.timeTriggeredFlushes++
          break
        case 'size':
          this.statistics.sizeTriggeredFlushes++
          break
        case 'priority':
          this.statistics.priorityTriggeredFlushes++
          break
        // 'manual' is counted separately in flush()
      }

      // Update flush interval statistics
      this.flushTimestamps.push(startTime)
      if (this.flushTimestamps.length > 100) {
        this.flushTimestamps.shift()
      }
      if (this.flushTimestamps.length > 1) {
        let totalInterval = 0
        for (let i = 1; i < this.flushTimestamps.length; i++) {
          const current = this.flushTimestamps[i]
          const previous = this.flushTimestamps[i - 1]
          if (current !== undefined && previous !== undefined) {
            totalInterval += current - previous
          }
        }
        this.statistics.averageFlushIntervalMs = totalInterval / (this.flushTimestamps.length - 1)
      }
      this.statistics.lastFlushAt = startTime
    }

    // =========================================================================
    // Build Request Body
    // =========================================================================

    const batchBody: JsonRpcRequest[] = requests.map((req) => ({
      jsonrpc: '2.0' as const,
      method: req.method,
      params: req.params,
      id: req.id,
    }))

    const jsonBody = JSON.stringify(batchBody)
    const bodyBytes = new TextEncoder().encode(jsonBody).length

    if (this.statisticsEnabled) {
      this.statistics.totalBytesSent += bodyBytes
    }

    // =========================================================================
    // Apply Compression if Configured
    // =========================================================================

    let finalBody: string | Uint8Array = jsonBody
    let contentEncoding: string | undefined

    if (
      this.compressionConfig.algorithm !== 'none' &&
      bodyBytes >= this.compressionConfig.threshold
    ) {
      const { compressed, isCompressed } = await compressData(
        jsonBody,
        this.compressionConfig.algorithm
      )

      if (isCompressed && compressed instanceof Uint8Array) {
        finalBody = compressed
        contentEncoding = this.compressionConfig.algorithm
        if (this.statisticsEnabled) {
          this.statistics.totalBytesCompressed += compressed.length
        }
        this.logger?.debug?.('Batch compressed', {
          original: bodyBytes,
          compressed: compressed.length,
          ratio: (compressed.length / bodyBytes).toFixed(2),
        })
      }
    }

    // =========================================================================
    // Build Headers
    // =========================================================================

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.customHeaders,
    }

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`
    }

    if (contentEncoding) {
      headers['Content-Encoding'] = contentEncoding
    }

    // =========================================================================
    // Send HTTP Request
    // =========================================================================

    try {
      const response = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers,
        body: finalBody as BodyInit,
      })

      // =========================================================================
      // Handle HTTP Errors
      // =========================================================================

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`)
        this.logger?.error?.('HTTP error response', {
          status: response.status,
          statusText: response.statusText,
        })

        if (this.statisticsEnabled) {
          this.statistics.totalErrors += requests.length
        }

        for (const request of requests) {
          request.reject(error)
        }
        return
      }

      // =========================================================================
      // Parse and Correlate Responses
      // =========================================================================

      const batchResponse = (await response.json()) as JsonRpcResponse[]

      // Create response map for correlation
      const responseMap = new Map<number | string, JsonRpcResponse>()
      for (const resp of batchResponse) {
        responseMap.set(resp.id, resp)
      }

      // Resolve or reject each request
      for (const request of requests) {
        const resp = responseMap.get(request.id)

        if (!resp) {
          // No response for this request
          if (this.statisticsEnabled) {
            this.statistics.totalErrors++
          }
          request.reject(
            new Error(`No response received for request id ${request.id} (method: ${request.method})`)
          )
        } else if (resp.error) {
          // JSON-RPC error
          if (this.statisticsEnabled) {
            this.statistics.totalErrors++
          }
          const error = Object.assign(new Error(resp.error.message), {
            code: resp.error.code,
            data: resp.error.data,
          })
          request.reject(error)
        } else {
          // Success
          request.resolve(resp.result)
        }
      }

      this.logger?.debug?.('Batch completed', {
        requestCount: requests.length,
        responseCount: batchResponse.length,
        durationMs: Date.now() - startTime,
      })
    } catch (err) {
      // =========================================================================
      // Handle Network/Fetch Errors
      // =========================================================================

      const error = err instanceof Error ? err : new Error(String(err))
      this.logger?.error?.('Batch request failed', { error: error.message })

      if (this.statisticsEnabled) {
        this.statistics.totalErrors += requests.length
      }

      for (const request of requests) {
        request.reject(error)
      }
    }
  }

  // ===========================================================================
  // Private Methods - Special Request Handling
  // ===========================================================================

  /**
   * Executes a single request immediately without batching.
   *
   * @param method - The RPC method name
   * @param params - Optional method parameters
   * @param options - Call options
   * @returns Promise resolving to the result
   * @internal
   */
  private async executeImmediate<T>(
    method: string,
    params: unknown,
    options?: CallOptions
  ): Promise<T> {
    const id = ++this.requestIdCounter
    const timeout = options?.timeout ?? this.defaultTimeout

    this.logger?.debug?.('Executing immediate request', { id, method })

    // Build single request
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    }

    const jsonBody = JSON.stringify([request])

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.customHeaders,
    }

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`
    }

    // Create abort controller for timeout
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    if (timeout > 0) {
      timeoutId = setTimeout(() => controller.abort(), timeout)
    }

    try {
      const response = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers,
        body: jsonBody,
        signal: controller.signal,
      })

      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const batchResponse = (await response.json()) as JsonRpcResponse[]
      const resp = batchResponse[0]

      if (!resp) {
        throw new Error('No response received for immediate request')
      }

      if (resp.error) {
        const error = Object.assign(new Error(resp.error.message), {
          code: resp.error.code,
          data: resp.error.data,
        })
        throw error
      }

      return resp.result as T
    } catch (err) {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms (method: ${method})`)
      }

      throw err
    }
  }

  /**
   * Handles request timeout by removing from queue and rejecting.
   *
   * @param request - The request that timed out
   * @internal
   */
  private handleRequestTimeout(request: PendingRequest): void {
    const wasInQueue = this.removeFromQueue(request)

    if (wasInQueue) {
      if (this.statisticsEnabled) {
        this.statistics.totalErrors++
      }
      request.reject(
        new Error(`Request timeout: method=${request.method}, id=${request.id}`)
      )
      this.logger?.warn?.('Request timed out', { id: request.id, method: request.method })
    }
  }

  // ===========================================================================
  // Private Methods - Backpressure
  // ===========================================================================

  /**
   * Updates backpressure state and invokes callback if state changed.
   *
   * @internal
   */
  private updateBackpressureState(): void {
    if (this.maxPendingRequests === 0) {
      return // Backpressure disabled
    }

    const ratio = this.totalPendingCount / this.maxPendingRequests
    let newState: BackpressureState

    if (ratio >= 1) {
      newState = 'critical'
    } else if (ratio >= this.warningThreshold) {
      newState = 'warning'
    } else {
      newState = 'ok'
    }

    if (newState !== this.currentBackpressureState) {
      this.currentBackpressureState = newState

      if (this.onBackpressureChange) {
        this.onBackpressureChange(newState, this.totalPendingCount, this.maxPendingRequests)
      }

      this.logger?.debug?.('Backpressure state changed', {
        state: newState,
        pending: this.totalPendingCount,
        max: this.maxPendingRequests,
      })
    }
  }
}
