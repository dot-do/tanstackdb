/**
 * @file WebSocket Transport Types
 *
 * Type definitions for WebSocket transport communication, including RPC messages,
 * push notifications, transport options, and event payloads.
 *
 * @module @tanstack/mongo-db-collection/rpc/ws-transport-types
 * @see {@link WebSocketTransport} for the main transport implementation
 */

// =============================================================================
// Transport State Types
// =============================================================================

/**
 * Possible states for the WebSocket transport connection.
 *
 * The transport follows a state machine pattern with these transitions:
 * - `disconnected` -> `connecting`: When `connect()` is called
 * - `connecting` -> `connected`: When WebSocket opens successfully
 * - `connecting` -> `disconnected`: When connection fails
 * - `connected` -> `disconnected`: When `disconnect()` is called intentionally
 * - `connected` -> `reconnecting`: When connection drops unexpectedly (if reconnect enabled)
 * - `reconnecting` -> `connected`: When reconnection succeeds
 * - `reconnecting` -> `disconnected`: When max reconnect attempts exhausted
 *
 * @example
 * ```typescript
 * transport.on('stateChange', (state: TransportState) => {
 *   console.log(`Transport state changed to: ${state}`)
 * })
 * ```
 */
export type TransportState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration options for creating a WebSocket transport instance.
 *
 * @example Basic usage with URL only
 * ```typescript
 * const transport = new WebSocketTransport('wss://mongo.do/ws')
 * ```
 *
 * @example Full configuration
 * ```typescript
 * const transport = new WebSocketTransport({
 *   url: 'wss://mongo.do/ws',
 *   reconnect: true,
 *   reconnectInterval: 2000,
 *   maxReconnectAttempts: 10,
 *   heartbeatInterval: 30000,
 *   requestTimeout: 60000,
 *   binaryType: 'arraybuffer',
 *   encoding: 'bson',
 * })
 * ```
 */
export interface WebSocketTransportOptions {
  /**
   * The WebSocket URL to connect to.
   *
   * Must use `ws://` or `wss://` scheme.
   *
   * @example 'wss://api.mongo.do/realtime'
   */
  url: string

  /**
   * Whether to automatically reconnect on connection loss.
   *
   * When enabled, the transport will attempt to reconnect using exponential
   * backoff after an unexpected disconnection. Intentional disconnects via
   * `disconnect()` will not trigger reconnection.
   *
   * @defaultValue true
   */
  reconnect?: boolean

  /**
   * Base interval in milliseconds between reconnection attempts.
   *
   * Actual delay uses exponential backoff: `reconnectInterval * 2^(attempt-1)`
   *
   * @defaultValue 1000
   * @example 2000 // Start with 2 second delay, then 4s, 8s, etc.
   */
  reconnectInterval?: number

  /**
   * Maximum number of reconnection attempts before giving up.
   *
   * After this many failed attempts, the transport emits `reconnectFailed`
   * and transitions to `disconnected` state.
   *
   * @defaultValue 5
   */
  maxReconnectAttempts?: number

  /**
   * Interval in milliseconds between heartbeat (ping) messages.
   *
   * Heartbeats help detect stale connections. If the server doesn't respond
   * to 3 consecutive heartbeats, the connection is considered dead.
   *
   * Set to 0 to disable heartbeats.
   *
   * @defaultValue 30000
   */
  heartbeatInterval?: number

  /**
   * Timeout in milliseconds for RPC request/response cycles.
   *
   * If a response is not received within this time, the request promise
   * is rejected with a timeout error.
   *
   * @defaultValue 30000
   */
  requestTimeout?: number

  /**
   * Binary data type for WebSocket messages.
   *
   * @defaultValue 'blob'
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/binaryType
   */
  binaryType?: 'blob' | 'arraybuffer'

  /**
   * Message encoding format.
   *
   * - `'json'`: Standard JSON encoding (default)
   * - `'bson'`: Binary JSON for more efficient binary data handling
   *
   * @defaultValue 'json'
   */
  encoding?: 'json' | 'bson'

  /**
   * Maximum number of messages to queue when disconnected.
   *
   * When the transport is offline, outgoing messages are queued up to this
   * limit. Once reconnected, queued messages are sent in order.
   *
   * Set to 0 to disable offline queueing (messages will fail immediately).
   *
   * @defaultValue 100
   */
  maxQueueSize?: number

  /**
   * High water mark for backpressure detection.
   *
   * When the outgoing message queue exceeds this size, the transport
   * emits a `backpressure` event with `{ active: true }`.
   *
   * @defaultValue 50
   */
  highWaterMark?: number

  /**
   * Low water mark for backpressure recovery.
   *
   * When the outgoing message queue drops below this size after being
   * above the high water mark, the transport emits a `backpressure`
   * event with `{ active: false }`.
   *
   * @defaultValue 10
   */
  lowWaterMark?: number
}

// =============================================================================
// RPC Message Types
// =============================================================================

/**
 * Outgoing RPC request message structure.
 *
 * Follows a simplified JSON-RPC-like format for bidirectional communication.
 *
 * @example
 * ```typescript
 * const message: RPCMessage = {
 *   id: '123',
 *   method: 'find',
 *   params: { collection: 'users', filter: { active: true } },
 * }
 * ```
 */
export interface RPCMessage {
  /**
   * Unique identifier for request/response correlation.
   *
   * Optional for fire-and-forget messages, required for request-response.
   */
  id?: string | number

  /**
   * The RPC method name to invoke.
   *
   * @example 'find', 'insert', 'update', 'delete', 'subscribe', 'ping'
   */
  method: string

  /**
   * Method parameters.
   *
   * Structure depends on the method being called.
   */
  params?: unknown
}

/**
 * Incoming RPC response message structure.
 *
 * Every response includes the original request ID for correlation.
 * Contains either a `result` for success or an `error` for failure.
 *
 * @example Successful response
 * ```typescript
 * const response: RPCResponse = {
 *   id: '123',
 *   result: [{ _id: '1', name: 'Alice' }],
 * }
 * ```
 *
 * @example Error response
 * ```typescript
 * const response: RPCResponse = {
 *   id: '123',
 *   error: { code: -32600, message: 'Invalid request' },
 * }
 * ```
 */
export interface RPCResponse {
  /**
   * The request ID this response corresponds to.
   */
  id: string | number

  /**
   * The successful result payload.
   *
   * Present when the RPC call succeeded.
   */
  result?: unknown

  /**
   * Error details when the RPC call failed.
   *
   * Present when the RPC call encountered an error.
   */
  error?: RPCError
}

/**
 * RPC error structure.
 *
 * Follows JSON-RPC 2.0 error format.
 *
 * @example
 * ```typescript
 * const error: RPCError = {
 *   code: -32600,
 *   message: 'Invalid request',
 *   data: { field: 'collection', reason: 'required' },
 * }
 * ```
 */
export interface RPCError {
  /**
   * Numeric error code.
   *
   * Standard codes (JSON-RPC 2.0):
   * - `-32700`: Parse error
   * - `-32600`: Invalid request
   * - `-32601`: Method not found
   * - `-32602`: Invalid params
   * - `-32603`: Internal error
   * - `-32000` to `-32099`: Server error (reserved)
   */
  code: number

  /**
   * Human-readable error message.
   */
  message: string

  /**
   * Additional error data.
   *
   * Structure is application-specific.
   */
  data?: unknown
}

// =============================================================================
// Push Message Types
// =============================================================================

/**
 * Server-initiated push message (no request ID).
 *
 * Used for real-time notifications like change stream events,
 * subscription updates, and server-side broadcasts.
 *
 * @example Change stream event
 * ```typescript
 * const push: PushMessage = {
 *   method: 'changeEvent',
 *   params: {
 *     operationType: 'insert',
 *     fullDocument: { _id: '1', name: 'New Doc' },
 *     ns: { db: 'mydb', coll: 'users' },
 *   },
 * }
 * ```
 *
 * @example Subscription notification
 * ```typescript
 * const push: PushMessage = {
 *   method: 'subscription.data',
 *   params: {
 *     subscriptionId: 'sub-123',
 *     data: [{ _id: '1', name: 'Alice' }],
 *   },
 * }
 * ```
 */
export interface PushMessage {
  /**
   * The type/name of the push notification.
   *
   * Common methods:
   * - `'changeEvent'`: MongoDB change stream event
   * - `'subscription.data'`: Subscription data update
   * - `'insert'`, `'update'`, `'delete'`: CRUD event notifications
   */
  method: string

  /**
   * Push message payload.
   *
   * Structure depends on the method.
   */
  params?: unknown
}

// =============================================================================
// Statistics Types
// =============================================================================

/**
 * Transport connection and message statistics.
 *
 * Useful for monitoring, debugging, and performance analysis.
 *
 * @example
 * ```typescript
 * const stats = transport.stats
 * console.log(`Sent: ${stats.messagesSent}, Received: ${stats.messagesReceived}`)
 * console.log(`Bytes: ${stats.bytesSent} out, ${stats.bytesReceived} in`)
 * console.log(`Connected for: ${stats.connectionTime}ms`)
 * ```
 */
export interface TransportStats {
  /**
   * Total number of messages sent since connection.
   */
  messagesSent: number

  /**
   * Total number of messages received since connection.
   */
  messagesReceived: number

  /**
   * Total bytes sent since connection.
   */
  bytesSent: number

  /**
   * Total bytes received since connection.
   */
  bytesReceived: number

  /**
   * Time in milliseconds since connection was established.
   *
   * Returns 0 if not currently connected.
   */
  connectionTime: number
}

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Internal structure for tracking pending RPC requests.
 *
 * @internal
 */
export interface PendingRequest {
  /**
   * Promise resolver for successful response.
   */
  resolve: (value: unknown) => void

  /**
   * Promise rejector for error response or timeout.
   */
  reject: (reason: unknown) => void

  /**
   * Timeout handle for request expiration.
   */
  timeout: ReturnType<typeof setTimeout>
}

/**
 * Internal structure for tracking active subscriptions.
 *
 * Used for restoring subscriptions after reconnection.
 *
 * @internal
 */
export interface Subscription {
  /**
   * The subscription method (typically 'subscribe').
   */
  method: string

  /**
   * The original subscription parameters.
   */
  params: unknown

  /**
   * Server-assigned subscription ID (after successful subscription).
   */
  subscriptionId?: string
}

/**
 * Structure for queued messages during offline state.
 *
 * @internal
 */
export interface QueuedMessage {
  /**
   * The serialized message data to send.
   */
  data: string

  /**
   * Promise resolver to call when message is sent.
   */
  resolve: () => void

  /**
   * Promise rejector to call if message fails.
   */
  reject: (error: Error) => void

  /**
   * Timestamp when the message was queued.
   */
  queuedAt: number
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Map of transport event names to their payload types.
 *
 * @example
 * ```typescript
 * transport.on('stateChange', (state: TransportEventMap['stateChange']) => {
 *   // state is typed as TransportState
 * })
 * ```
 */
export interface TransportEventMap {
  /**
   * Emitted when the transport state changes.
   */
  stateChange: TransportState

  /**
   * Emitted when connection is established.
   */
  connect: void

  /**
   * Emitted when connection is lost or closed.
   */
  disconnect: void

  /**
   * Emitted when WebSocket close event occurs.
   */
  close: { code: number; reason: string }

  /**
   * Emitted when an error occurs.
   */
  error: Error

  /**
   * Emitted for non-critical issues (e.g., unknown message IDs).
   */
  warning: Error

  /**
   * Emitted when reconnection attempt starts.
   */
  reconnecting: void

  /**
   * Emitted when reconnection succeeds.
   */
  reconnected: void

  /**
   * Emitted when all reconnection attempts fail.
   */
  reconnectFailed: void

  /**
   * Emitted when a push message is received.
   */
  push: PushMessage

  /**
   * Emitted when binary data is received.
   */
  binary: ArrayBuffer

  /**
   * Emitted when subscription data arrives.
   */
  subscription: unknown

  /**
   * Emitted when backpressure state changes.
   */
  backpressure: { active: boolean }

  /**
   * Emitted when offline queue is full.
   */
  queueFull: { dropped: number }

  // Dynamic event types for push methods (insert, update, delete, change, etc.)
  [key: string]: unknown
}

/**
 * Backpressure state information.
 */
export interface BackpressureInfo {
  /**
   * Whether backpressure is currently active.
   */
  active: boolean

  /**
   * Current queue size.
   */
  queueSize: number

  /**
   * High water mark threshold.
   */
  highWaterMark: number

  /**
   * Low water mark threshold.
   */
  lowWaterMark: number
}
