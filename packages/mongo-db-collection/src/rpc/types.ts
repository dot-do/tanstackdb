/**
 * @file RPC Types
 *
 * Shared types for RPC communication with the mongo.do API.
 * Includes JSON-RPC 2.0 types and configuration interfaces.
 */

// =============================================================================
// JSON-RPC 2.0 Types
// =============================================================================

/**
 * JSON-RPC 2.0 request structure.
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id: number | string
}

/**
 * JSON-RPC 2.0 error structure.
 */
export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

/**
 * JSON-RPC 2.0 response structure.
 */
export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: number | string
  result?: T
  error?: JsonRpcError
}

// =============================================================================
// BatchExecutor Types
// =============================================================================

// =============================================================================
// Priority Types
// =============================================================================

/**
 * Priority level for RPC requests.
 * Higher priority requests are processed first within a batch and may
 * trigger immediate flush for critical operations.
 *
 * @see {@link BatchExecutorConfig.enablePriorityQueue}
 */
export type RequestPriority = 'low' | 'normal' | 'high' | 'critical'

/**
 * Numeric values for priority levels (higher = more urgent).
 * Used internally for priority queue ordering.
 */
export const PRIORITY_VALUES: Record<RequestPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
}

// =============================================================================
// Statistics Types
// =============================================================================

/**
 * Batch execution statistics for monitoring and debugging.
 * Tracks performance metrics over the lifetime of a BatchExecutor instance.
 *
 * @example
 * ```typescript
 * const executor = new BatchExecutor(config)
 * // ... make some calls ...
 * const stats = executor.getStatistics()
 * console.log(`Average batch size: ${stats.averageBatchSize}`)
 * console.log(`Total requests: ${stats.totalRequests}`)
 * ```
 */
export interface BatchStatistics {
  /**
   * Total number of batches sent since creation.
   */
  totalBatches: number

  /**
   * Total number of individual requests processed.
   */
  totalRequests: number

  /**
   * Total number of requests that failed (rejected).
   */
  totalErrors: number

  /**
   * Average number of requests per batch.
   * Calculated as totalRequests / totalBatches.
   */
  averageBatchSize: number

  /**
   * Minimum batch size observed.
   */
  minBatchSize: number

  /**
   * Maximum batch size observed.
   */
  maxBatchSize: number

  /**
   * Number of batches triggered by time window expiration.
   */
  timeTriggeredFlushes: number

  /**
   * Number of batches triggered by reaching max batch size.
   */
  sizeTriggeredFlushes: number

  /**
   * Number of batches triggered by priority escalation (critical requests).
   */
  priorityTriggeredFlushes: number

  /**
   * Number of manual flush() calls.
   */
  manualFlushes: number

  /**
   * Average time between flushes in milliseconds.
   */
  averageFlushIntervalMs: number

  /**
   * Total bytes sent (uncompressed).
   */
  totalBytesSent: number

  /**
   * Total bytes sent after compression (if enabled).
   */
  totalBytesCompressed: number

  /**
   * Number of times backpressure was applied.
   */
  backpressureEvents: number

  /**
   * Timestamp when the executor was created.
   */
  createdAt: number

  /**
   * Timestamp of the last flush operation.
   */
  lastFlushAt: number | null
}

// =============================================================================
// Backpressure Types
// =============================================================================

/**
 * Backpressure state indicating the current load on the executor.
 * Used to signal callers when they should slow down request submission.
 */
export type BackpressureState = 'ok' | 'warning' | 'critical'

/**
 * Callback invoked when backpressure state changes.
 *
 * @param state - The new backpressure state
 * @param pendingCount - Current number of pending requests
 * @param maxPending - Maximum allowed pending requests
 */
export type BackpressureCallback = (
  state: BackpressureState,
  pendingCount: number,
  maxPending: number
) => void

// =============================================================================
// Compression Types
// =============================================================================

/**
 * Compression algorithm to use for large batches.
 * - 'gzip': Standard gzip compression (widely supported)
 * - 'deflate': Raw deflate compression
 * - 'none': No compression (default)
 */
export type CompressionAlgorithm = 'gzip' | 'deflate' | 'none'

/**
 * Compression configuration options.
 */
export interface CompressionConfig {
  /**
   * Compression algorithm to use.
   * @default 'none'
   */
  algorithm: CompressionAlgorithm

  /**
   * Minimum batch size in bytes before compression is applied.
   * Compression overhead may not be worth it for small payloads.
   * @default 1024 (1KB)
   */
  threshold: number

  /**
   * Compression level (1-9). Higher = better compression but slower.
   * Only applicable for gzip and deflate.
   * @default 6
   */
  level?: number
}

// =============================================================================
// Batch Key Function Types
// =============================================================================

/**
 * Function to determine the batch key for a request.
 * Requests with the same key are batched together; different keys create
 * separate batches that may be sent concurrently.
 *
 * @param method - The RPC method name
 * @param params - The request parameters
 * @returns A string key for batch grouping, or undefined for default batch
 *
 * @example
 * ```typescript
 * // Separate batches by database name
 * const batchKeyFn: BatchKeyFunction = (method, params) => {
 *   if (params && typeof params === 'object' && 'database' in params) {
 *     return (params as { database: string }).database
 *   }
 *   return 'default'
 * }
 * ```
 */
export type BatchKeyFunction = (method: string, params: unknown) => string | undefined

// =============================================================================
// Call Options Types
// =============================================================================

/**
 * Options for individual RPC calls.
 * Allows per-request configuration of priority and batching behavior.
 */
export interface CallOptions {
  /**
   * Priority level for this request.
   * Higher priority requests may trigger immediate flush.
   * @default 'normal'
   */
  priority?: RequestPriority

  /**
   * Custom batch key for this request.
   * Overrides the default batch key function.
   */
  batchKey?: string

  /**
   * Skip batching and send immediately as a single request.
   * Useful for time-sensitive operations.
   * @default false
   */
  immediate?: boolean

  /**
   * Request timeout in milliseconds.
   * If not specified, uses the executor's default timeout.
   */
  timeout?: number
}

// =============================================================================
// BatchExecutor Configuration
// =============================================================================

/**
 * Configuration options for the BatchExecutor.
 *
 * The BatchExecutor collects multiple RPC calls within a time window and sends
 * them as a single JSON-RPC batch request, reducing network overhead and
 * improving throughput for high-volume applications.
 *
 * @example
 * ```typescript
 * const config: BatchExecutorConfig = {
 *   endpoint: 'https://api.mongo.do/rpc',
 *   batchTimeMs: 50,
 *   maxBatchSize: 100,
 *   authToken: 'your-api-token',
 *   enablePriorityQueue: true,
 *   compression: {
 *     algorithm: 'gzip',
 *     threshold: 4096,
 *   },
 *   backpressure: {
 *     maxPendingRequests: 1000,
 *     warningThreshold: 0.8,
 *   },
 * }
 * ```
 */
export interface BatchExecutorConfig {
  /**
   * The RPC endpoint URL to send batch requests to.
   * Must be a valid HTTP or HTTPS URL.
   *
   * @example 'https://api.mongo.do/rpc'
   */
  endpoint: string

  /**
   * Time window in milliseconds to collect requests before sending.
   * Requests will be batched together within this window.
   * Lower values reduce latency; higher values improve batching efficiency.
   *
   * @minimum 1
   * @example 50
   */
  batchTimeMs: number

  /**
   * Maximum number of requests in a single batch.
   * When reached, the batch is sent immediately without waiting for the time window.
   * Should be tuned based on server limits and typical request sizes.
   *
   * @minimum 1
   * @example 100
   */
  maxBatchSize: number

  /**
   * Custom fetch function for making HTTP requests.
   * Defaults to global fetch if not provided.
   * Useful for testing or custom HTTP client configurations.
   *
   * @default globalThis.fetch
   */
  fetch?: typeof fetch

  /**
   * Optional authentication token (Bearer token).
   * Will be included as 'Authorization: Bearer {token}' header.
   */
  authToken?: string

  /**
   * Optional custom headers to include in all requests.
   * These are merged with default headers (Content-Type, Authorization).
   *
   * @example { 'X-Request-ID': 'unique-id', 'X-Tenant': 'tenant-123' }
   */
  headers?: Record<string, string>

  // =========================================================================
  // Advanced Configuration Options
  // =========================================================================

  /**
   * Enable priority queue for request ordering.
   * When enabled, higher priority requests are processed first within a batch,
   * and critical priority requests trigger immediate flush.
   *
   * @default false
   */
  enablePriorityQueue?: boolean

  /**
   * Custom function to determine batch grouping.
   * Requests returning the same key are batched together.
   * Different keys result in separate concurrent batches.
   *
   * @example
   * ```typescript
   * // Group by database name for multi-tenant scenarios
   * batchKeyFn: (method, params) => {
   *   const p = params as { db?: string }
   *   return p?.db ?? 'default'
   * }
   * ```
   */
  batchKeyFn?: BatchKeyFunction

  /**
   * Compression configuration for large batches.
   * When enabled, batches exceeding the threshold are compressed before sending.
   *
   * @default { algorithm: 'none', threshold: 1024 }
   */
  compression?: Partial<CompressionConfig>

  /**
   * Backpressure configuration to prevent memory exhaustion.
   * Limits the number of pending requests and signals callers to slow down.
   */
  backpressure?: {
    /**
     * Maximum number of pending requests before rejecting new calls.
     * Set to 0 to disable backpressure.
     *
     * @default 10000
     */
    maxPendingRequests?: number

    /**
     * Threshold (0-1) at which to emit warning state.
     * When pending requests exceed this percentage of max, warning is emitted.
     *
     * @default 0.8
     */
    warningThreshold?: number

    /**
     * Callback invoked when backpressure state changes.
     */
    onBackpressureChange?: BackpressureCallback
  }

  /**
   * Default timeout for requests in milliseconds.
   * Individual calls can override this with CallOptions.timeout.
   *
   * @default 30000 (30 seconds)
   */
  defaultTimeout?: number

  /**
   * Enable detailed statistics collection.
   * Has minimal performance overhead but uses additional memory.
   *
   * @default true
   */
  enableStatistics?: boolean

  /**
   * Custom logger for debugging and monitoring.
   * If not provided, no logging is performed.
   */
  logger?: {
    debug?: (message: string, data?: unknown) => void
    info?: (message: string, data?: unknown) => void
    warn?: (message: string, data?: unknown) => void
    error?: (message: string, data?: unknown) => void
  }
}

// =============================================================================
// MongoDoClient Types
// =============================================================================

/**
 * Authentication options for the MongoDoClient.
 *
 * Supports two authentication methods:
 * 1. Bearer token authentication (recommended for API access)
 * 2. Username/password credentials (for direct database access)
 *
 * @remarks
 * Only one authentication method should be provided. If both are provided,
 * the token takes precedence.
 *
 * @example
 * ```typescript
 * // Using bearer token (recommended)
 * const authWithToken: MongoDoAuthOptions = {
 *   token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
 * }
 *
 * // Using credentials
 * const authWithCredentials: MongoDoAuthOptions = {
 *   credentials: {
 *     username: 'myuser',
 *     password: 'mypassword'
 *   }
 * }
 * ```
 */
export interface MongoDoAuthOptions {
  /** Bearer token for authentication */
  token?: string
  /** Username/password credentials */
  credentials?: {
    username: string
    password: string
  }
}

/**
 * Configuration options for the MongoDoClient.
 *
 * All timeout values are in milliseconds. If not specified, sensible defaults
 * are used (30 seconds for most operations).
 *
 * @example
 * ```typescript
 * const config: MongoDoClientConfig = {
 *   timeout: 60000,        // 60 second general timeout
 *   connectTimeout: 10000, // 10 second connection timeout
 *   requestTimeout: 30000, // 30 second per-request timeout
 *   debug: true,           // Enable debug logging
 *   logger: {
 *     debug: (msg, data) => console.debug(`[MongoDB] ${msg}`, data),
 *     info: (msg, data) => console.info(`[MongoDB] ${msg}`, data),
 *     warn: (msg, data) => console.warn(`[MongoDB] ${msg}`, data),
 *     error: (msg, data) => console.error(`[MongoDB] ${msg}`, data),
 *   }
 * }
 * ```
 */
export interface MongoDoClientConfig {
  /** Timeout for general operations in milliseconds (default: 30000) */
  timeout?: number
  /** Timeout for connection attempts in milliseconds (default: 30000) */
  connectTimeout?: number
  /** Timeout for individual RPC requests in milliseconds (default: 30000) */
  requestTimeout?: number
  /**
   * Enable debug mode for verbose logging.
   * When enabled, logs connection events, requests, responses, and errors.
   * @default false
   */
  debug?: boolean
  /**
   * Custom logger for debug output.
   * If not provided and debug is enabled, uses console methods.
   */
  logger?: MongoDoLogger
  /**
   * Connection pool configuration for managing multiple WebSocket connections.
   * Useful for high-throughput applications.
   */
  connectionPool?: ConnectionPoolConfig
}

/**
 * Event types emitted by MongoDoClient.
 *
 * @example
 * ```typescript
 * client.on('connected', () => console.log('Connected!'))
 * client.on('disconnected', () => console.log('Disconnected!'))
 * client.on('error', (err) => console.error('Error:', err))
 * ```
 */
export type MongoDoClientEventType =
  | 'error'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'request'
  | 'response'

/**
 * Event handler type for MongoDoClient events.
 *
 * @param error - Optional error or event data associated with the event
 */
export type MongoDoClientEventHandler = (error?: Error | Event | unknown) => void

/**
 * Pending RPC request tracking structure.
 *
 * Used internally to correlate responses with their original requests
 * and manage timeout handling.
 *
 * @typeParam T - The expected result type
 * @internal
 */
export interface ClientPendingRequest<T = unknown> {
  /** Resolver function to fulfill the request promise */
  resolve: (value: T) => void
  /** Rejector function to reject the request promise */
  reject: (error: Error) => void
  /** Timeout handle for request timeout cancellation */
  timeoutId?: ReturnType<typeof setTimeout>
  /** Timestamp when the request was initiated */
  startTime?: number
  /** The RPC method name (for logging) */
  method?: string
}

// =============================================================================
// Connection Pool Types
// =============================================================================

/**
 * Configuration for connection pooling.
 *
 * Connection pooling allows multiple WebSocket connections to be maintained
 * and reused, improving performance for high-throughput applications.
 *
 * @example
 * ```typescript
 * const poolConfig: ConnectionPoolConfig = {
 *   minConnections: 2,
 *   maxConnections: 10,
 *   idleTimeout: 60000,
 *   acquireTimeout: 5000,
 *   healthCheckInterval: 30000,
 * }
 * ```
 */
export interface ConnectionPoolConfig {
  /**
   * Minimum number of connections to maintain in the pool.
   * These connections are kept alive even when idle.
   * @default 1
   */
  minConnections?: number
  /**
   * Maximum number of connections allowed in the pool.
   * Additional requests will wait for a connection to become available.
   * @default 10
   */
  maxConnections?: number
  /**
   * Time in milliseconds before an idle connection is closed.
   * Set to 0 to disable idle timeout.
   * @default 30000
   */
  idleTimeout?: number
  /**
   * Maximum time to wait for a connection to become available in milliseconds.
   * If exceeded, the request will fail with a timeout error.
   * @default 10000
   */
  acquireTimeout?: number
  /**
   * Interval in milliseconds for health checks on pooled connections.
   * @default 15000
   */
  healthCheckInterval?: number
  /**
   * Whether to validate connections before use.
   * Adds latency but ensures connection is healthy.
   * @default true
   */
  validateOnAcquire?: boolean
  /**
   * Custom factory function for creating new connections.
   * Allows customization of connection initialization.
   */
  connectionFactory?: () => Promise<WebSocket>
}

/**
 * Statistics for a connection pool.
 *
 * Provides insight into pool utilization and health.
 *
 * @example
 * ```typescript
 * const stats = client.getPoolStats()
 * console.log(`Active: ${stats.activeConnections}/${stats.totalConnections}`)
 * console.log(`Waiting: ${stats.waitingRequests}`)
 * ```
 */
export interface ConnectionPoolStats {
  /** Total number of connections in the pool */
  totalConnections: number
  /** Number of connections currently in use */
  activeConnections: number
  /** Number of idle connections available */
  idleConnections: number
  /** Number of requests waiting for a connection */
  waitingRequests: number
  /** Total number of connections created since pool initialization */
  connectionsCreated: number
  /** Total number of connections destroyed since pool initialization */
  connectionsDestroyed: number
  /** Average time to acquire a connection in milliseconds */
  avgAcquireTime: number
}

// =============================================================================
// Logging Types
// =============================================================================

/**
 * Log levels supported by the MongoDoClient logger.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Logger interface for MongoDoClient debug output.
 *
 * Implement this interface to integrate with your logging infrastructure.
 * All methods are optional; missing methods will be no-ops.
 *
 * @example
 * ```typescript
 * // Custom logger with Winston
 * const winstonLogger: MongoDoLogger = {
 *   debug: (msg, data) => winston.debug(msg, data),
 *   info: (msg, data) => winston.info(msg, data),
 *   warn: (msg, data) => winston.warn(msg, data),
 *   error: (msg, data) => winston.error(msg, data),
 * }
 *
 * // Custom logger with structured logging
 * const structuredLogger: MongoDoLogger = {
 *   debug: (msg, data) => console.debug(JSON.stringify({ level: 'debug', msg, ...data })),
 *   info: (msg, data) => console.info(JSON.stringify({ level: 'info', msg, ...data })),
 *   warn: (msg, data) => console.warn(JSON.stringify({ level: 'warn', msg, ...data })),
 *   error: (msg, data) => console.error(JSON.stringify({ level: 'error', msg, ...data })),
 * }
 * ```
 */
export interface MongoDoLogger {
  /**
   * Log debug-level messages.
   * Use for detailed debugging information (requests, responses, state changes).
   */
  debug?: (message: string, data?: Record<string, unknown>) => void
  /**
   * Log info-level messages.
   * Use for general operational information (connection established, etc.).
   */
  info?: (message: string, data?: Record<string, unknown>) => void
  /**
   * Log warning-level messages.
   * Use for potentially problematic situations (retry attempts, fallbacks).
   */
  warn?: (message: string, data?: Record<string, unknown>) => void
  /**
   * Log error-level messages.
   * Use for errors that don't crash the client (request failures, timeouts).
   */
  error?: (message: string, data?: Record<string, unknown>) => void
}

/**
 * Log entry structure for structured logging.
 *
 * @example
 * ```typescript
 * const entry: LogEntry = {
 *   timestamp: Date.now(),
 *   level: 'info',
 *   message: 'Request sent',
 *   data: {
 *     method: 'collection.find',
 *     requestId: 'req_1_1234567890',
 *     duration: 45
 *   }
 * }
 * ```
 */
export interface LogEntry {
  /** Unix timestamp when the log entry was created */
  timestamp: number
  /** Log level */
  level: LogLevel
  /** Log message */
  message: string
  /** Optional additional data */
  data?: Record<string, unknown>
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes specific to MongoDoClient operations.
 *
 * These extend the standard JSON-RPC error codes with client-specific errors.
 */
export enum MongoDoErrorCode {
  /** Connection-related errors */
  CONNECTION_FAILED = -32000,
  CONNECTION_TIMEOUT = -32001,
  CONNECTION_CLOSED = -32002,
  /** Request-related errors */
  REQUEST_TIMEOUT = -32010,
  REQUEST_CANCELLED = -32011,
  /** Authentication errors */
  AUTH_FAILED = -32020,
  AUTH_EXPIRED = -32021,
  /** Pool-related errors */
  POOL_EXHAUSTED = -32030,
  POOL_ACQUIRE_TIMEOUT = -32031,
}

/**
 * Extended error class options for MongoDoClient errors.
 *
 * Provides structured error information including error code,
 * original cause, and additional context data.
 *
 * @example
 * ```typescript
 * try {
 *   await client.rpc('collection.find', params)
 * } catch (error) {
 *   if (error instanceof MongoDoError) {
 *     console.error(`Error ${error.code}: ${error.message}`)
 *     if (error.cause) {
 *       console.error('Caused by:', error.cause)
 *     }
 *   }
 * }
 * ```
 */
export interface MongoDoErrorOptions {
  /** Error code from MongoDoErrorCode or JSON-RPC error codes */
  code: number
  /** Human-readable error message */
  message: string
  /** Original error that caused this error */
  cause?: Error
  /** Additional context data */
  data?: Record<string, unknown>
}
