/**
 * @file WebSocket Transport Implementation
 *
 * WebSocket transport for real-time bidirectional communication with MongoDB servers.
 * Supports RPC calls, push messages (change events), auto-reconnection, heartbeat
 * keep-alive, backpressure handling, and offline message queueing.
 *
 * @module @tanstack/mongo-db-collection/rpc/ws-transport
 * @see https://tanstack.com/db/latest/docs
 *
 * @example Basic Usage
 * ```typescript
 * import { WebSocketTransport } from '@tanstack/mongo-db-collection/rpc'
 *
 * const transport = new WebSocketTransport('wss://api.mongo.do/realtime')
 *
 * // Listen for events
 * transport.on('connect', () => console.log('Connected!'))
 * transport.on('push', (msg) => console.log('Push:', msg))
 *
 * // Connect and send requests
 * await transport.connect()
 * const result = await transport.send('find', { collection: 'users' })
 * ```
 *
 * @example With Full Configuration
 * ```typescript
 * const transport = new WebSocketTransport({
 *   url: 'wss://api.mongo.do/realtime',
 *   reconnect: true,
 *   reconnectInterval: 2000,
 *   maxReconnectAttempts: 10,
 *   heartbeatInterval: 30000,
 *   requestTimeout: 60000,
 *   maxQueueSize: 100,
 *   highWaterMark: 50,
 *   lowWaterMark: 10,
 * })
 * ```
 *
 * ## Connection State Machine
 *
 * The transport follows a finite state machine pattern for connection management:
 *
 * ```
 *                                  connect()
 *     +-------------+  --------------------------->  +-------------+
 *     | DISCONNECTED|                                | CONNECTING  |
 *     +-------------+  <---------------------------  +-------------+
 *           ^                  connection failed           |
 *           |                                              | onopen
 *           |                                              v
 *           |         disconnect()               +-------------+
 *           +------------------------------------| CONNECTED   |
 *           |                                    +-------------+
 *           |                                          |
 *           |                              unexpected close
 *           |                              (reconnect enabled)
 *           |                                          |
 *           |                                          v
 *           |     max attempts reached           +-------------+
 *           +------------------------------------| RECONNECTING|
 *                                                +-------------+
 *                                                      |
 *                                                      | onopen
 *                                                      v
 *                                                +-------------+
 *                                                | CONNECTED   |
 *                                                +-------------+
 * ```
 *
 * ## Event Flow
 *
 * ```
 *                     WebSocket Events                    Transport Events
 *                     ----------------                    ----------------
 *
 *     [WebSocket]                                           [Transport]
 *         |                                                      |
 *         |-- onopen -----------------------------------------> emit('connect')
 *         |                                                      emit('stateChange', 'connected')
 *         |
 *         |-- onmessage (response) --------------------------> resolve(pending request)
 *         |
 *         |-- onmessage (push) ------------------------------> emit('push', message)
 *         |                                                      emit(method, params)
 *         |
 *         |-- onclose ----------------------------------------> emit('close', {code, reason})
 *         |                                                      emit('disconnect')
 *         |                                                      emit('stateChange', 'reconnecting'|'disconnected')
 *         |
 *         |-- onerror ----------------------------------------> emit('error', error)
 * ```
 */

import { EventEmitter } from 'events'

// Global type declarations for WebSocket events (Node.js compatibility)
declare global {
  interface CloseEvent extends Event {
    readonly code: number
    readonly reason: string
    readonly wasClean: boolean
  }
  interface ErrorEvent extends Event {
    readonly error: any
    readonly message: string
  }
}

// Re-export types for backward compatibility
export type {
  TransportState,
  WebSocketTransportOptions,
  RPCMessage,
  RPCResponse,
  RPCError,
  PushMessage,
  TransportStats,
  PendingRequest,
  Subscription,
  QueuedMessage,
  TransportEventMap,
  BackpressureInfo,
} from './ws-transport-types.js'

import type {
  TransportState,
  WebSocketTransportOptions,
  RPCMessage,
  RPCResponse,
  PushMessage,
  TransportStats,
  PendingRequest,
  Subscription,
  QueuedMessage,
  BackpressureInfo,
} from './ws-transport-types.js'

// =============================================================================
// Constants
// =============================================================================

/**
 * Default configuration values for WebSocket transport.
 *
 * @internal
 */
const DEFAULT_OPTIONS = {
  reconnect: true,
  reconnectInterval: 1000,
  maxReconnectAttempts: 5,
  heartbeatInterval: 30000,
  requestTimeout: 30000,
  maxQueueSize: 100,
  highWaterMark: 50,
  lowWaterMark: 10,
} as const

/**
 * Maximum number of consecutive missed heartbeats before disconnecting.
 *
 * @internal
 */
const MAX_MISSED_HEARTBEATS = 3

// =============================================================================
// WebSocketTransport Class
// =============================================================================

/**
 * WebSocket transport class for MongoDB RPC communication.
 *
 * Provides a robust WebSocket client with:
 * - Request/response correlation via message IDs
 * - Push message handling for server-initiated events
 * - Automatic reconnection with exponential backoff
 * - Heartbeat/ping-pong keep-alive mechanism
 * - Offline message queueing
 * - Backpressure detection and signaling
 * - Comprehensive event emission
 *
 * @extends EventEmitter
 *
 * @fires WebSocketTransport#connect - When connection is established
 * @fires WebSocketTransport#disconnect - When connection is lost
 * @fires WebSocketTransport#close - When WebSocket closes with code/reason
 * @fires WebSocketTransport#error - When an error occurs
 * @fires WebSocketTransport#warning - For non-critical issues
 * @fires WebSocketTransport#stateChange - When transport state changes
 * @fires WebSocketTransport#push - When a push message is received
 * @fires WebSocketTransport#binary - When binary data is received
 * @fires WebSocketTransport#reconnecting - When reconnection attempt starts
 * @fires WebSocketTransport#reconnected - When reconnection succeeds
 * @fires WebSocketTransport#reconnectFailed - When all reconnection attempts fail
 * @fires WebSocketTransport#subscription - When subscription data arrives
 * @fires WebSocketTransport#backpressure - When backpressure state changes
 * @fires WebSocketTransport#queueFull - When offline queue is full and messages are dropped
 *
 * @example
 * ```typescript
 * const transport = new WebSocketTransport('wss://api.mongo.do/realtime')
 *
 * transport.on('connect', () => {
 *   console.log('Connected!')
 * })
 *
 * transport.on('push', (message) => {
 *   console.log('Received push:', message.method, message.params)
 * })
 *
 * transport.on('backpressure', ({ active }) => {
 *   if (active) {
 *     console.log('Slow down! Message queue is backing up.')
 *   } else {
 *     console.log('Backpressure relieved.')
 *   }
 * })
 *
 * await transport.connect()
 * const users = await transport.send<User[]>('find', { collection: 'users' })
 * ```
 */
export class WebSocketTransport extends EventEmitter {
  // -------------------------------------------------------------------------
  // Private Properties
  // -------------------------------------------------------------------------

  /** The WebSocket URL to connect to. */
  private _url: string

  /** Transport configuration options. */
  private _options: Required<Omit<WebSocketTransportOptions, 'url' | 'binaryType' | 'encoding' | 'authToken'>> & {
    binaryType?: 'blob' | 'arraybuffer'
    encoding?: 'json' | 'bson'
  }

  /** Bearer token for authentication. */
  private authToken?: string

  /** Current connection state. */
  private _state: TransportState = 'disconnected'

  /** The underlying WebSocket instance. */
  private ws: WebSocket | null = null

  /** Map of pending RPC requests awaiting responses. */
  private pendingRequests = new Map<string | number, PendingRequest>()

  /** Counter for generating unique request IDs. */
  private requestIdCounter = 0

  /** Current reconnection attempt number. */
  private reconnectAttempts = 0

  /** Timer handle for scheduling heartbeat pings. */
  private heartbeatTimer?: ReturnType<typeof setTimeout>

  /** Timer handle for heartbeat response timeout. */
  private heartbeatTimeoutTimer?: ReturnType<typeof setTimeout>

  /** Timer handle for reconnection delay. */
  private reconnectTimer?: ReturnType<typeof setTimeout>

  /** Number of consecutive missed heartbeat responses. */
  private missedHeartbeats = 0

  /** Flag indicating an intentional disconnect (vs unexpected). */
  private intentionalDisconnect = false

  /** Promise for the current connection attempt. */
  private connectPromise: Promise<void> | null = null

  /** Resolver for the connect promise. */
  private connectResolve: (() => void) | null = null

  /** Rejector for the connect promise. */
  private connectReject: ((error: Error) => void) | null = null

  /** List of active subscriptions for restoration after reconnect. */
  private subscriptions: Subscription[] = []

  /** Timestamp when connection was established. */
  private connectedAt: number = 0

  /** Queue of messages to send when reconnected. */
  private messageQueue: QueuedMessage[] = []

  /** Flag indicating if backpressure is currently active. */
  private backpressureActive = false

  /** Connection statistics. */
  private _stats: TransportStats = {
    messagesSent: 0,
    messagesReceived: 0,
    bytesSent: 0,
    bytesReceived: 0,
    connectionTime: 0,
  }

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Creates a new WebSocketTransport instance.
   *
   * @param urlOrOptions - WebSocket URL string or full configuration object
   *
   * @throws {Error} If URL scheme is not ws:// or wss://
   *
   * @example With URL string
   * ```typescript
   * const transport = new WebSocketTransport('wss://api.mongo.do/realtime')
   * ```
   *
   * @example With options object
   * ```typescript
   * const transport = new WebSocketTransport({
   *   url: 'wss://api.mongo.do/realtime',
   *   reconnect: true,
   *   maxReconnectAttempts: 10,
   * })
   * ```
   */
  constructor(urlOrOptions: string | WebSocketTransportOptions) {
    super()

    if (typeof urlOrOptions === 'string') {
      this._url = urlOrOptions
      this._options = { ...DEFAULT_OPTIONS }
    } else {
      this._url = urlOrOptions.url
      this._options = {
        ...DEFAULT_OPTIONS,
        ...urlOrOptions,
      }
      if (urlOrOptions.binaryType) {
        this._options.binaryType = urlOrOptions.binaryType
      }
      if (urlOrOptions.encoding) {
        this._options.encoding = urlOrOptions.encoding
      }
      if (urlOrOptions.authToken) {
        this.authToken = urlOrOptions.authToken
      }
    }

    // Validate URL scheme
    if (!this._url.startsWith('ws://') && !this._url.startsWith('wss://')) {
      throw new Error(`Invalid WebSocket URL scheme. Expected ws:// or wss://, got: ${this._url}`)
    }
  }

  // -------------------------------------------------------------------------
  // Public Getters
  // -------------------------------------------------------------------------

  /**
   * Gets the WebSocket URL.
   *
   * @returns The URL string used for WebSocket connections
   */
  get url(): string {
    return this._url
  }

  /**
   * Gets the transport configuration options.
   *
   * @returns A copy of the transport options including the URL
   */
  get options(): WebSocketTransportOptions & {
    binaryType?: 'blob' | 'arraybuffer'
    encoding?: 'json' | 'bson'
  } {
    return { url: this._url, ...this._options }
  }

  /**
   * Gets the current connection state.
   *
   * @returns The current transport state
   *
   * @example
   * ```typescript
   * if (transport.state === 'connected') {
   *   await transport.send('find', { collection: 'users' })
   * }
   * ```
   */
  get state(): TransportState {
    return this._state
  }

  /**
   * Checks if the transport is currently connected.
   *
   * @returns `true` if state is 'connected', `false` otherwise
   *
   * @example
   * ```typescript
   * if (!transport.isConnected) {
   *   await transport.connect()
   * }
   * ```
   */
  get isConnected(): boolean {
    return this._state === 'connected'
  }

  /**
   * Gets connection and message statistics.
   *
   * @returns Current transport statistics
   *
   * @example
   * ```typescript
   * const stats = transport.stats
   * console.log(`Messages: ${stats.messagesSent} sent, ${stats.messagesReceived} received`)
   * console.log(`Bytes: ${stats.bytesSent} out, ${stats.bytesReceived} in`)
   * console.log(`Connected for: ${Math.round(stats.connectionTime / 1000)}s`)
   * ```
   */
  get stats(): TransportStats {
    return {
      ...this._stats,
      connectionTime: this.connectedAt > 0 ? Date.now() - this.connectedAt : 0,
    }
  }

  /**
   * Gets current backpressure information.
   *
   * @returns Information about backpressure state and queue size
   *
   * @example
   * ```typescript
   * const info = transport.backpressure
   * if (info.active) {
   *   console.log(`Backpressure active: ${info.queueSize} messages queued`)
   * }
   * ```
   */
  get backpressure(): BackpressureInfo {
    return {
      active: this.backpressureActive,
      queueSize: this.messageQueue.length,
      highWaterMark: this._options.highWaterMark,
      lowWaterMark: this._options.lowWaterMark,
    }
  }

  // -------------------------------------------------------------------------
  // Public Methods - Connection Management
  // -------------------------------------------------------------------------

  /**
   * Establishes a WebSocket connection.
   *
   * If already connecting, returns the existing connection promise.
   * If already connected, resolves immediately.
   *
   * @returns Promise that resolves when connection is established
   *
   * @throws {Error} If connection fails to establish
   *
   * @example
   * ```typescript
   * try {
   *   await transport.connect()
   *   console.log('Connected successfully!')
   * } catch (error) {
   *   console.error('Connection failed:', error.message)
   * }
   * ```
   */
  async connect(): Promise<void> {
    // If already connecting, return existing promise
    if (this.connectPromise && this._state === 'connecting') {
      return this.connectPromise
    }

    // If already connected, resolve immediately
    if (this._state === 'connected') {
      return Promise.resolve()
    }

    this.intentionalDisconnect = false
    this.setState('connecting')

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject

      try {
        // Create WebSocket with optional Bearer token in protocols
        // This is more secure than passing token in URL query params
        if (this.authToken) {
          this.ws = new WebSocket(this._url, [`Bearer.${this.authToken}`])
        } else {
          this.ws = new WebSocket(this._url)
        }

        if (this._options.binaryType) {
          this.ws.binaryType = this._options.binaryType
        }

        this.ws.onopen = this.handleOpen.bind(this)
        this.ws.onclose = (event: CloseEvent) => this.handleClose(event.code, event.reason)
        this.ws.onmessage = (event: MessageEvent) => this.handleMessage(event.data)
        this.ws.onerror = (event: Event) => {
          const errorEvent = event as ErrorEvent
          this.handleError(
            errorEvent.error || new Error(errorEvent.message || 'WebSocket error')
          )
        }
      } catch (error) {
        this.setState('disconnected')
        reject(error)
      }
    })

    return this.connectPromise
  }

  /**
   * Closes the WebSocket connection gracefully.
   *
   * Rejects all pending requests, stops heartbeat, clears timers,
   * and closes the underlying WebSocket.
   *
   * @returns Promise that resolves when disconnected
   *
   * @example
   * ```typescript
   * await transport.disconnect()
   * console.log('Disconnected cleanly')
   * ```
   */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true
    this.cleanup()

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Disconnected'))
    }
    this.pendingRequests.clear()

    // Reject all queued messages
    for (const queued of this.messageQueue) {
      queued.reject(new Error('Disconnected'))
    }
    this.messageQueue = []

    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      return new Promise<void>((resolve) => {
        const onClose = () => {
          this.setState('disconnected')
          resolve()
        }

        this.ws!.onclose = onClose

        this.ws!.close(1000, 'Client disconnect')

        // Set a timeout in case close event doesn't fire
        setTimeout(() => {
          this.setState('disconnected')
          resolve()
        }, 100)
      })
    }

    this.setState('disconnected')
    return Promise.resolve()
  }

  // -------------------------------------------------------------------------
  // Public Methods - Messaging
  // -------------------------------------------------------------------------

  /**
   * Sends an RPC message and waits for response.
   *
   * The message is queued if offline and queueing is enabled.
   *
   * @typeParam T - Expected response type
   * @param method - RPC method name to invoke
   * @param params - Method parameters (optional)
   * @param metadata - Optional request metadata (e.g., custom requestId)
   *
   * @returns Promise resolving to the response result
   *
   * @throws {Error} If not connected and queueing is disabled
   * @throws {Error} If request times out
   * @throws {Error} If server returns an RPC error
   *
   * @example Basic request
   * ```typescript
   * const users = await transport.send<User[]>('find', {
   *   collection: 'users',
   *   filter: { active: true },
   * })
   * ```
   *
   * @example With custom request ID
   * ```typescript
   * const result = await transport.send('update', { ... }, {
   *   requestId: 'my-custom-id',
   * })
   * ```
   */
  async send<T>(
    method: string,
    params?: unknown,
    metadata?: { requestId?: string | number }
  ): Promise<T> {
    if (this._state !== 'connected') {
      throw new Error('WebSocket is not connected')
    }

    const id = metadata?.requestId ?? this.generateRequestId()

    const message: RPCMessage = {
      id,
      method,
      params,
    }

    // Track subscriptions for reconnect restoration
    if (method === 'subscribe') {
      this.subscriptions.push({ method, params: params as unknown })
    }

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout for method: ${method}`))
      }, this._options.requestTimeout)

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      })

      this.sendRaw(JSON.stringify(message))
    })
  }

  /**
   * Sends binary data over the WebSocket.
   *
   * @param data - Binary data to send (ArrayBuffer)
   *
   * @returns Promise that resolves when a binary response is received
   *
   * @throws {Error} If not connected
   *
   * @example
   * ```typescript
   * const encoder = new TextEncoder()
   * const data = encoder.encode('Hello, World!').buffer
   * await transport.sendBinary(data)
   * ```
   */
  async sendBinary(data: ArrayBuffer): Promise<void> {
    if (this._state !== 'connected') {
      throw new Error('WebSocket is not connected')
    }

    return new Promise<void>((resolve) => {
      this.ws!.send(data)
      this._stats.bytesSent += data.byteLength

      // For binary sends, resolve after receiving any binary response
      const binaryHandler = () => {
        this.off('binary', binaryHandler)
        resolve()
      }
      this.once('binary', binaryHandler)
    })
  }

  /**
   * Queues a message for sending when online.
   *
   * If currently connected, sends immediately. Otherwise, adds to the
   * offline queue (if queueing is enabled and queue isn't full).
   *
   * @param method - RPC method name
   * @param params - Method parameters
   *
   * @returns Promise that resolves when message is sent (not when response received)
   *
   * @example
   * ```typescript
   * // Queue messages even when offline
   * await transport.queue('log', { event: 'user_action', data: {...} })
   * ```
   */
  async queue(method: string, params?: unknown): Promise<void> {
    if (this._state === 'connected') {
      const message: RPCMessage = { method, params }
      this.sendRaw(JSON.stringify(message))
      return
    }

    if (this._options.maxQueueSize === 0) {
      throw new Error('Offline queueing is disabled')
    }

    return new Promise<void>((resolve, reject) => {
      // Check queue size limit
      if (this.messageQueue.length >= this._options.maxQueueSize) {
        // Drop oldest message
        const dropped = this.messageQueue.shift()
        if (dropped) {
          dropped.reject(new Error('Message dropped due to queue overflow'))
          this.emit('queueFull', { dropped: 1 })
        }
      }

      const message: RPCMessage = { method, params }
      this.messageQueue.push({
        data: JSON.stringify(message),
        resolve,
        reject,
        queuedAt: Date.now(),
      })

      this.checkBackpressure()
    })
  }

  // -------------------------------------------------------------------------
  // Public Methods - Event Emitter Extensions
  // -------------------------------------------------------------------------

  /**
   * Removes an event listener.
   *
   * Alias for `removeListener` for consistency with browser EventTarget API.
   *
   * @param event - Event name
   * @param listener - Event handler function
   *
   * @returns This transport instance for chaining
   *
   * @example
   * ```typescript
   * const handler = (msg) => console.log(msg)
   * transport.on('push', handler)
   * // Later...
   * transport.off('push', handler)
   * ```
   */
  override off(event: string, listener: (...args: unknown[]) => void): this {
    return this.removeListener(event, listener)
  }

  // -------------------------------------------------------------------------
  // Private Methods - State Management
  // -------------------------------------------------------------------------

  /**
   * Updates the transport state and emits state change event.
   *
   * @param newState - The new state to transition to
   *
   * @internal
   */
  private setState(newState: TransportState): void {
    if (this._state !== newState) {
      this._state = newState
      this.emit('stateChange', newState)
    }
  }

  /**
   * Generates a unique request ID.
   *
   * @returns A unique string ID for request/response correlation
   *
   * @internal
   */
  private generateRequestId(): string {
    return `${++this.requestIdCounter}`
  }

  // -------------------------------------------------------------------------
  // Private Methods - Messaging
  // -------------------------------------------------------------------------

  /**
   * Sends raw data over the WebSocket.
   *
   * @param data - String data to send
   *
   * @internal
   */
  private sendRaw(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data)
      this._stats.messagesSent++
      this._stats.bytesSent += data.length
      this.checkBackpressure()
    }
  }

  /**
   * Flushes the offline message queue.
   *
   * Sends all queued messages in order and clears the queue.
   *
   * @internal
   */
  private flushQueue(): void {
    const queue = [...this.messageQueue]
    this.messageQueue = []

    for (const item of queue) {
      try {
        this.sendRaw(item.data)
        item.resolve()
      } catch (error) {
        item.reject(error as Error)
      }
    }

    this.checkBackpressure()
  }

  /**
   * Checks and updates backpressure state.
   *
   * @internal
   */
  private checkBackpressure(): void {
    const queueSize = this.messageQueue.length

    if (!this.backpressureActive && queueSize >= this._options.highWaterMark) {
      this.backpressureActive = true
      this.emit('backpressure', { active: true })
    } else if (this.backpressureActive && queueSize <= this._options.lowWaterMark) {
      this.backpressureActive = false
      this.emit('backpressure', { active: false })
    }
  }

  // -------------------------------------------------------------------------
  // Private Methods - Event Handlers
  // -------------------------------------------------------------------------

  /**
   * Handles WebSocket open event.
   *
   * @internal
   */
  private handleOpen(): void {
    this.connectedAt = Date.now()
    this.reconnectAttempts = 0
    this.missedHeartbeats = 0

    const wasReconnecting = this._state === 'reconnecting'
    this.setState('connected')
    this.emit('connect')

    if (wasReconnecting) {
      this.emit('reconnected')
      this.restoreSubscriptions()
    }

    // Flush any queued messages
    this.flushQueue()

    this.startHeartbeat()

    if (this.connectResolve) {
      this.connectResolve()
      this.connectResolve = null
      this.connectReject = null
    }
  }

  /**
   * Handles incoming WebSocket messages.
   *
   * Distinguishes between RPC responses (have id) and push messages (no id).
   *
   * @param data - Raw message data (string or ArrayBuffer)
   *
   * @internal
   */
  private handleMessage(data: string | ArrayBuffer): void {
    // Reset heartbeat timer on any message
    this.resetHeartbeatTimer()
    this.missedHeartbeats = 0

    // Handle binary messages
    if (data instanceof ArrayBuffer) {
      this._stats.messagesReceived++
      this._stats.bytesReceived += data.byteLength
      this.emit('binary', data)
      return
    }

    this._stats.messagesReceived++
    this._stats.bytesReceived += data.length

    let parsed: RPCResponse | PushMessage
    try {
      parsed = JSON.parse(data)
    } catch {
      this.emit('error', new Error('Failed to parse JSON message'))
      return
    }

    // Check if it's a response (has id field)
    if ('id' in parsed && parsed.id !== undefined) {
      const response = parsed as RPCResponse
      const pending = this.pendingRequests.get(response.id)

      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(response.id)

        if (response.error) {
          const error = Object.assign(new Error(response.error.message), response.error)
          pending.reject(error)
        } else {
          // Update subscription ID if this was a subscribe response
          if (
            response.result &&
            typeof response.result === 'object' &&
            'subscriptionId' in response.result
          ) {
            const lastSub = this.subscriptions[this.subscriptions.length - 1]
            if (lastSub) {
              lastSub.subscriptionId = (response.result as { subscriptionId: string }).subscriptionId
            }
          }
          pending.resolve(response.result)
        }
      } else {
        // Response for unknown request
        this.emit(
          'warning',
          new Error(`Received response for unknown request ID: ${response.id}`)
        )
      }
    } else if ('method' in parsed) {
      // It's a push message (no id, has method)
      const push = parsed as PushMessage
      this.emit('push', push)

      // Emit typed events based on method
      this.emit(push.method, push.params)

      // Special handling for subscription data
      if (push.method === 'subscription.data') {
        this.emit('subscription', push.params)
      }
    }
  }

  /**
   * Handles WebSocket close event.
   *
   * @param code - WebSocket close code
   * @param reason - WebSocket close reason
   *
   * @internal
   */
  private handleClose(code: number, reason: string): void {
    this.cleanup()
    const wasConnected = this._state === 'connected' || this._state === 'reconnecting'
    this.connectedAt = 0

    this.emit('close', { code, reason })
    this.emit('disconnect')

    // Reject connect promise if still pending
    if (this.connectReject) {
      this.connectReject(new Error(`WebSocket closed with code ${code}: ${reason}`))
      this.connectResolve = null
      this.connectReject = null
      this.connectPromise = null
    }

    // Attempt reconnection only if we were connected (not during initial connection)
    // and it was not an intentional disconnect
    if (!this.intentionalDisconnect && this._options.reconnect && wasConnected) {
      this.attemptReconnect()
    } else {
      this.setState('disconnected')
      // Reject pending requests
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('Connection closed'))
      }
      this.pendingRequests.clear()
    }
  }

  /**
   * Handles WebSocket error event.
   *
   * @param error - The error that occurred
   *
   * @internal
   */
  private handleError(error: Error): void {
    // Only emit if there are listeners, otherwise EventEmitter throws on 'error'
    if (this.listenerCount('error') > 0) {
      this.emit('error', error)
    }
  }

  // -------------------------------------------------------------------------
  // Private Methods - Heartbeat
  // -------------------------------------------------------------------------

  /**
   * Starts the heartbeat timer.
   *
   * @internal
   */
  private startHeartbeat(): void {
    this.stopHeartbeat()

    if (this._options.heartbeatInterval > 0) {
      this.scheduleHeartbeat()
    }
  }

  /**
   * Schedules the next heartbeat ping.
   *
   * @internal
   */
  private scheduleHeartbeat(): void {
    this.heartbeatTimer = setTimeout(() => {
      this.sendHeartbeat()
    }, this._options.heartbeatInterval)
  }

  /**
   * Sends a heartbeat ping message.
   *
   * @internal
   */
  private sendHeartbeat(): void {
    if (this._state !== 'connected') return

    const id = this.generateRequestId()
    const pingMessage: RPCMessage = {
      id,
      method: 'ping',
    }

    // Track the heartbeat request
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(id)
      this.missedHeartbeats++

      // Disconnect after too many missed heartbeats
      if (this.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
        this.emit('disconnect')
        this.ws?.close(1000, 'Heartbeat timeout')
      } else {
        this.scheduleHeartbeat()
      }
    }, this._options.heartbeatInterval)

    this.pendingRequests.set(id, {
      resolve: () => {
        this.missedHeartbeats = 0
        this.scheduleHeartbeat()
      },
      reject: () => {
        this.missedHeartbeats++
      },
      timeout,
    })

    this.sendRaw(JSON.stringify(pingMessage))
  }

  /**
   * Resets the heartbeat timer (called on any incoming message).
   *
   * @internal
   */
  private resetHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.scheduleHeartbeat()
    }
  }

  /**
   * Stops all heartbeat timers.
   *
   * @internal
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer)
      this.heartbeatTimeoutTimer = undefined
    }
  }

  // -------------------------------------------------------------------------
  // Private Methods - Reconnection
  // -------------------------------------------------------------------------

  /**
   * Attempts to reconnect to the WebSocket server.
   *
   * Uses exponential backoff for retry delays.
   *
   * @internal
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this._options.maxReconnectAttempts) {
      this.setState('disconnected')
      this.emit('reconnectFailed')
      // Reject pending requests
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('Reconnection failed'))
      }
      this.pendingRequests.clear()
      return
    }

    this.setState('reconnecting')
    this.emit('reconnecting')
    this.reconnectAttempts++

    // Exponential backoff
    const delay = this._options.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1)

    this.reconnectTimer = setTimeout(() => {
      if (this.intentionalDisconnect) return

      // Create WebSocket with optional Bearer token in protocols
      if (this.authToken) {
        this.ws = new WebSocket(this._url, [`Bearer.${this.authToken}`])
      } else {
        this.ws = new WebSocket(this._url)
      }

      if (this._options.binaryType) {
        this.ws.binaryType = this._options.binaryType
      }

      this.ws.onopen = this.handleOpen.bind(this)
      this.ws.onclose = (event: CloseEvent) => this.handleClose(event.code, event.reason)
      this.ws.onmessage = (event: MessageEvent) => this.handleMessage(event.data)
      this.ws.onerror = (event: Event) => {
        const errorEvent = event as ErrorEvent
        this.handleError(
          errorEvent.error || new Error(errorEvent.message || 'WebSocket error')
        )
      }
    }, delay)
  }

  /**
   * Restores active subscriptions after reconnection.
   *
   * @internal
   */
  private restoreSubscriptions(): void {
    for (const sub of this.subscriptions) {
      const id = this.generateRequestId()
      const message: RPCMessage = {
        id,
        method: sub.method,
        params: sub.params,
      }

      // Set up pending request for re-subscription
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
      }, this._options.requestTimeout)

      this.pendingRequests.set(id, {
        resolve: (result) => {
          if (result && typeof result === 'object' && 'subscriptionId' in result) {
            sub.subscriptionId = (result as { subscriptionId: string }).subscriptionId
          }
        },
        reject: () => {
          // Silently fail subscription restoration
        },
        timeout,
      })

      this.sendRaw(JSON.stringify(message))
    }
  }

  // -------------------------------------------------------------------------
  // Private Methods - Cleanup
  // -------------------------------------------------------------------------

  /**
   * Cleans up all timers and internal state.
   *
   * Called during disconnect and before reconnection attempts.
   *
   * @internal
   */
  private cleanup(): void {
    // Stop heartbeat timers
    this.stopHeartbeat()

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }

    // Clear pending request timeouts
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
    }
  }
}
