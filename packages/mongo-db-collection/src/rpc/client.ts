/**
 * @file MongoDoClient - RPC Client for mongo.do API
 *
 * This module provides the core RPC client for communicating with the mongo.do
 * API endpoint. It handles:
 * - WebSocket connection management (connect/disconnect)
 * - JSON-RPC 2.0 request/response handling
 * - Database reference creation and caching
 * - Event emission for connection status and errors
 * - Timeout handling for connections and requests
 * - Debug logging with customizable logger interface
 * - Connection pool support for high-throughput applications
 *
 * @module @tanstack/mongo-db-collection/rpc
 * @see https://www.jsonrpc.org/specification
 * @see https://tanstack.com/db/latest/docs
 *
 * @example Basic Usage
 * ```typescript
 * import { MongoDoClient } from '@tanstack/mongo-db-collection'
 *
 * // Create client with authentication
 * const client = new MongoDoClient('https://api.mongo.do', {
 *   token: 'your-api-token'
 * })
 *
 * // Connect to the server
 * await client.connect()
 *
 * // Get database and collection references
 * const db = client.db('myDatabase')
 * const users = db.collection('users')
 *
 * // Make RPC calls
 * const result = await client.rpc('collection.find', {
 *   database: 'myDatabase',
 *   collection: 'users',
 *   filter: { active: true }
 * })
 *
 * // Disconnect when done
 * await client.disconnect()
 * ```
 *
 * @example With Debug Logging
 * ```typescript
 * const client = new MongoDoClient(
 *   'https://api.mongo.do',
 *   { token: 'your-token' },
 *   {
 *     debug: true,
 *     logger: {
 *       debug: (msg, data) => console.debug(`[MongoDB Debug] ${msg}`, data),
 *       info: (msg, data) => console.info(`[MongoDB] ${msg}`, data),
 *       warn: (msg, data) => console.warn(`[MongoDB Warning] ${msg}`, data),
 *       error: (msg, data) => console.error(`[MongoDB Error] ${msg}`, data),
 *     }
 *   }
 * )
 * ```
 *
 * @example Event Handling
 * ```typescript
 * const client = new MongoDoClient('https://api.mongo.do', { token: 'token' })
 *
 * client.on('connected', () => {
 *   console.log('Connected to MongoDB server')
 * })
 *
 * client.on('disconnected', () => {
 *   console.log('Disconnected from MongoDB server')
 * })
 *
 * client.on('error', (error) => {
 *   console.error('Connection error:', error)
 * })
 *
 * client.on('request', (data) => {
 *   console.log('Request sent:', data)
 * })
 *
 * client.on('response', (data) => {
 *   console.log('Response received:', data)
 * })
 * ```
 */

import type {
  MongoDoAuthOptions,
  MongoDoClientConfig,
  MongoDoClientEventType,
  MongoDoClientEventHandler,
  ClientPendingRequest,
  MongoDoLogger,
  ConnectionPoolStats,
  JsonRpcRequest,
  JsonRpcResponse,
  MongoDoErrorCode,
} from './types.js'

// Re-export types for convenience
export type {
  MongoDoAuthOptions,
  MongoDoClientConfig,
  MongoDoClientEventType,
  MongoDoClientEventHandler,
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Default timeout for connection attempts in milliseconds.
 * @internal
 */
const DEFAULT_CONNECT_TIMEOUT = 30000

/**
 * Default timeout for individual RPC requests in milliseconds.
 * @internal
 */
const DEFAULT_REQUEST_TIMEOUT = 30000

// =============================================================================
// MongoDoError Class
// =============================================================================

/**
 * Custom error class for MongoDoClient errors.
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
 *     console.error('Context:', error.data)
 *     if (error.cause) {
 *       console.error('Caused by:', error.cause)
 *     }
 *   }
 * }
 * ```
 */
export class MongoDoError extends Error {
  /**
   * Numeric error code from MongoDoErrorCode enum or JSON-RPC error codes.
   */
  public readonly code: number

  /**
   * Additional context data about the error.
   */
  public readonly data?: Record<string, unknown>

  /**
   * Creates a new MongoDoError instance.
   *
   * @param message - Human-readable error message
   * @param code - Error code from MongoDoErrorCode or JSON-RPC codes
   * @param options - Optional error options including cause and data
   */
  constructor(
    message: string,
    code: number,
    options?: { cause?: Error; data?: Record<string, unknown> }
  ) {
    super(message, { cause: options?.cause })
    this.name = 'MongoDoError'
    this.code = code
    this.data = options?.data
  }

  /**
   * Creates a connection error.
   *
   * @param message - Error message
   * @param cause - Optional underlying error
   * @returns A new MongoDoError with CONNECTION_FAILED code
   */
  static connectionFailed(message: string, cause?: Error): MongoDoError {
    return new MongoDoError(message, -32000, { cause })
  }

  /**
   * Creates a connection timeout error.
   *
   * @param timeoutMs - The timeout value that was exceeded
   * @returns A new MongoDoError with CONNECTION_TIMEOUT code
   */
  static connectionTimeout(timeoutMs: number): MongoDoError {
    return new MongoDoError(
      `Connection timeout after ${timeoutMs}ms`,
      -32001,
      { data: { timeoutMs } }
    )
  }

  /**
   * Creates a request timeout error.
   *
   * @param method - The RPC method that timed out
   * @param timeoutMs - The timeout value that was exceeded
   * @returns A new MongoDoError with REQUEST_TIMEOUT code
   */
  static requestTimeout(method: string, timeoutMs: number): MongoDoError {
    return new MongoDoError(
      `Request timeout for method '${method}' after ${timeoutMs}ms`,
      -32010,
      { data: { method, timeoutMs } }
    )
  }

  /**
   * Creates a not connected error.
   *
   * @returns A new MongoDoError with CONNECTION_CLOSED code
   */
  static notConnected(): MongoDoError {
    return new MongoDoError('Not connected to server', -32002)
  }

  /**
   * Creates an already connected error.
   *
   * @returns A new MongoDoError with CONNECTION_FAILED code
   */
  static alreadyConnected(): MongoDoError {
    return new MongoDoError('Already connected to server', -32000)
  }
}

// =============================================================================
// MongoDoClient Class
// =============================================================================

/**
 * RPC client for communicating with the mongo.do API.
 *
 * Provides WebSocket-based JSON-RPC communication with support for:
 * - Connection management with automatic cleanup
 * - Request/response correlation via unique IDs
 * - Event emission for connection state changes
 * - Timeout handling for connections and requests
 * - Debug logging with customizable logger
 * - Connection pool statistics
 *
 * @example Basic Connection
 * ```typescript
 * const client = new MongoDoClient('https://api.mongo.do', {
 *   token: 'my-auth-token'
 * })
 *
 * await client.connect()
 *
 * const db = client.db('myDatabase')
 * const result = await client.rpc('find', {
 *   database: 'myDatabase',
 *   collection: 'users',
 *   filter: { active: true }
 * })
 *
 * await client.disconnect()
 * ```
 *
 * @example With Configuration
 * ```typescript
 * const client = new MongoDoClient(
 *   'https://api.mongo.do',
 *   { token: 'my-auth-token' },
 *   {
 *     connectTimeout: 10000,
 *     requestTimeout: 30000,
 *     debug: true,
 *   }
 * )
 * ```
 *
 * @example Error Handling
 * ```typescript
 * try {
 *   await client.connect()
 * } catch (error) {
 *   if (error instanceof MongoDoError) {
 *     switch (error.code) {
 *       case -32001: // CONNECTION_TIMEOUT
 *         console.error('Connection timed out')
 *         break
 *       case -32000: // CONNECTION_FAILED
 *         console.error('Connection failed:', error.message)
 *         break
 *       default:
 *         console.error('Unknown error:', error)
 *     }
 *   }
 * }
 * ```
 */
export class MongoDoClient {
  /**
   * The mongo.do API endpoint URL.
   *
   * @example
   * ```typescript
   * const client = new MongoDoClient('https://api.mongo.do', { token: 'token' })
   * console.log(client.endpoint) // 'https://api.mongo.do'
   * ```
   */
  public readonly endpoint: string

  // Private state
  private authOptions?: MongoDoAuthOptions
  private config: MongoDoClientConfig
  private connected = false
  private ws: WebSocket | null = null
  private databases = new Map<string, DatabaseReference>()
  private pendingRequests = new Map<string, ClientPendingRequest>()
  private eventListeners = new Map<MongoDoClientEventType, Set<MongoDoClientEventHandler>>()
  private requestIdCounter = 0
  private logger: MongoDoLogger | null = null

  /**
   * Creates a new MongoDoClient instance.
   *
   * @param endpoint - The mongo.do API endpoint URL (e.g., 'https://api.mongo.do')
   * @param auth - Optional authentication options (token or credentials)
   * @param config - Optional client configuration (timeouts, logging, etc.)
   *
   * @example Token Authentication
   * ```typescript
   * const client = new MongoDoClient('https://api.mongo.do', {
   *   token: 'your-api-token'
   * })
   * ```
   *
   * @example Credentials Authentication
   * ```typescript
   * const client = new MongoDoClient('https://api.mongo.do', {
   *   credentials: {
   *     username: 'user',
   *     password: 'pass'
   *   }
   * })
   * ```
   *
   * @example Full Configuration
   * ```typescript
   * const client = new MongoDoClient(
   *   'https://api.mongo.do',
   *   { token: 'token' },
   *   {
   *     connectTimeout: 10000,
   *     requestTimeout: 30000,
   *     debug: true,
   *     logger: customLogger
   *   }
   * )
   * ```
   */
  constructor(endpoint: string, auth?: MongoDoAuthOptions, config?: MongoDoClientConfig) {
    this.endpoint = endpoint
    this.authOptions = auth
    this.config = config ?? {}

    // Initialize logger if debug mode is enabled
    if (this.config.debug) {
      this.logger = this.config.logger ?? this.createDefaultLogger()
    }

    this.log('debug', 'Client created', { endpoint })
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Connects to the mongo.do API endpoint via WebSocket.
   *
   * Establishes a WebSocket connection to the configured endpoint. The connection
   * timeout can be configured via the `connectTimeout` option. If authentication
   * is provided, the token will be included in the connection URL.
   *
   * @returns Promise that resolves when connected
   * @throws {MongoDoError} If already connected (code: -32000)
   * @throws {MongoDoError} If connection times out (code: -32001)
   * @throws {MongoDoError} If connection fails (code: -32000)
   *
   * @example Basic Connection
   * ```typescript
   * const client = new MongoDoClient('https://api.mongo.do', { token: 'token' })
   * await client.connect()
   * console.log('Connected!')
   * ```
   *
   * @example With Error Handling
   * ```typescript
   * try {
   *   await client.connect()
   * } catch (error) {
   *   if (error instanceof MongoDoError && error.code === -32001) {
   *     console.error('Connection timed out, retrying...')
   *     await client.connect()
   *   }
   * }
   * ```
   */
  async connect(): Promise<void> {
    if (this.connected) {
      throw MongoDoError.alreadyConnected()
    }

    const connectTimeout = this.config.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT

    this.log('info', 'Connecting to server', { endpoint: this.endpoint, timeout: connectTimeout })

    return new Promise<void>((resolve, reject) => {
      // Build WebSocket URL
      let wsUrl = this.endpoint.replace(/^http/, 'ws')
      if (this.authOptions?.token) {
        const separator = wsUrl.includes('?') ? '&' : '?'
        wsUrl = `${wsUrl}${separator}token=${encodeURIComponent(this.authOptions.token)}`
      }

      // Set up connection timeout
      const timeoutId = setTimeout(() => {
        this.log('error', 'Connection timeout', { timeoutMs: connectTimeout })
        if (this.ws) {
          this.ws.close()
          this.ws = null
        }
        reject(MongoDoError.connectionTimeout(connectTimeout))
      }, connectTimeout)

      // Create WebSocket connection
      try {
        this.ws = new WebSocket(wsUrl)
      } catch (error) {
        clearTimeout(timeoutId)
        this.log('error', 'Failed to create WebSocket', { error })
        reject(MongoDoError.connectionFailed('Failed to create WebSocket connection', error as Error))
        return
      }

      this.ws.onopen = () => {
        clearTimeout(timeoutId)
        this.connected = true
        this.log('info', 'Connected successfully')
        this.emit('connected')
        resolve()
      }

      this.ws.onerror = (error: Event) => {
        clearTimeout(timeoutId)
        this.connected = false
        this.log('error', 'Connection error', { error })
        this.emit('error', error)
        reject(MongoDoError.connectionFailed('WebSocket connection failed'))
      }

      this.ws.onclose = () => {
        this.connected = false
        this.log('info', 'Connection closed')
        this.cancelAllPendingRequests(MongoDoError.notConnected())
        this.emit('disconnected')
      }

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data as string)
      }
    })
  }

  /**
   * Disconnects from the mongo.do API endpoint.
   *
   * Gracefully closes the WebSocket connection, canceling any pending requests
   * and clearing database references. If already disconnected, resolves immediately.
   *
   * @returns Promise that resolves when disconnected
   *
   * @example
   * ```typescript
   * await client.disconnect()
   * console.log('Disconnected!')
   * ```
   *
   * @example Cleanup Pattern
   * ```typescript
   * try {
   *   await client.connect()
   *   // ... do work ...
   * } finally {
   *   await client.disconnect()
   * }
   * ```
   */
  async disconnect(): Promise<void> {
    if (!this.ws || !this.connected) {
      this.log('debug', 'Already disconnected, skipping')
      return
    }

    this.log('info', 'Disconnecting from server')

    // Cancel pending requests before closing
    this.cancelAllPendingRequests(MongoDoError.notConnected())

    // Close the WebSocket
    this.ws.close()
    this.ws = null
    this.connected = false

    // Clear database references
    this.databases.clear()

    this.log('info', 'Disconnected successfully')
  }

  /**
   * Returns the current connection state.
   *
   * @returns `true` if connected, `false` otherwise
   *
   * @example
   * ```typescript
   * if (client.isConnected()) {
   *   const db = client.db('myDatabase')
   * } else {
   *   await client.connect()
   * }
   * ```
   */
  isConnected(): boolean {
    return this.connected
  }

  // ===========================================================================
  // Database Access
  // ===========================================================================

  /**
   * Gets or creates a database reference.
   *
   * Database references are cached for efficiency. Multiple calls with the same
   * database name will return the same reference instance.
   *
   * @param name - The database name
   * @returns A DatabaseReference instance for the specified database
   * @throws {MongoDoError} If not connected (code: -32002)
   *
   * @example
   * ```typescript
   * const db = client.db('myDatabase')
   * const users = db.collection('users')
   * ```
   *
   * @example Multiple Databases
   * ```typescript
   * const primaryDb = client.db('primary')
   * const analyticsDb = client.db('analytics')
   * ```
   */
  db(name: string): DatabaseReference {
    if (!this.connected) {
      throw MongoDoError.notConnected()
    }

    let dbRef = this.databases.get(name)
    if (!dbRef) {
      this.log('debug', 'Creating database reference', { database: name })
      dbRef = new DatabaseReference(this, name)
      this.databases.set(name, dbRef)
    }
    return dbRef
  }

  // ===========================================================================
  // RPC Methods
  // ===========================================================================

  /**
   * Sends a JSON-RPC request to the server.
   *
   * This is the core method for making remote procedure calls. It handles
   * request/response correlation, timeout management, and error handling.
   *
   * @typeParam T - The expected result type
   * @param method - The RPC method name (e.g., 'collection.find', 'collection.insertOne')
   * @param params - Optional parameters for the method
   * @returns Promise that resolves with the result
   * @throws {MongoDoError} If not connected (code: -32002)
   * @throws {MongoDoError} If request times out (code: -32010)
   * @throws {MongoDoError} If server returns an error
   *
   * @example Find Documents
   * ```typescript
   * interface User {
   *   id: string
   *   name: string
   *   email: string
   * }
   *
   * const users = await client.rpc<User[]>('collection.find', {
   *   database: 'myDatabase',
   *   collection: 'users',
   *   filter: { active: true },
   *   limit: 10
   * })
   * ```
   *
   * @example Insert Document
   * ```typescript
   * const result = await client.rpc<{ insertedId: string }>('collection.insertOne', {
   *   database: 'myDatabase',
   *   collection: 'users',
   *   document: { name: 'Alice', email: 'alice@example.com' }
   * })
   * console.log('Inserted:', result.insertedId)
   * ```
   *
   * @example Error Handling
   * ```typescript
   * try {
   *   await client.rpc('collection.find', params)
   * } catch (error) {
   *   if (error instanceof MongoDoError) {
   *     if (error.code === -32010) {
   *       console.error('Request timed out')
   *     } else {
   *       console.error('RPC error:', error.message)
   *     }
   *   }
   * }
   * ```
   */
  async rpc<T>(method: string, params?: unknown): Promise<T> {
    if (!this.connected || !this.ws) {
      throw MongoDoError.notConnected()
    }

    const requestTimeout = this.config.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT
    const id = this.generateRequestId()
    const startTime = Date.now()

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    }

    this.log('debug', 'Sending request', { id, method, params })
    this.emit('request', { id, method, params })

    return new Promise<T>((resolve, reject) => {
      // Set up request timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id)
        const error = MongoDoError.requestTimeout(method, requestTimeout)
        this.log('error', 'Request timeout', { id, method, timeoutMs: requestTimeout })
        reject(error)
      }, requestTimeout)

      // Store pending request with metadata for logging
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
        startTime,
        method,
      })

      // Send the request
      try {
        this.ws!.send(JSON.stringify(request))
      } catch (error) {
        clearTimeout(timeoutId)
        this.pendingRequests.delete(id)
        const mongoError = MongoDoError.connectionFailed('Failed to send request', error as Error)
        this.log('error', 'Failed to send request', { id, method, error })
        reject(mongoError)
      }
    })
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  /**
   * Registers an event listener.
   *
   * Supported events:
   * - `'connected'` - Emitted when connection is established
   * - `'disconnected'` - Emitted when connection is closed
   * - `'error'` - Emitted on connection or WebSocket errors
   * - `'reconnecting'` - Emitted when attempting to reconnect
   * - `'request'` - Emitted when a request is sent (debug mode)
   * - `'response'` - Emitted when a response is received (debug mode)
   *
   * @param event - The event type to listen for
   * @param handler - The handler function to call when the event occurs
   *
   * @example
   * ```typescript
   * client.on('connected', () => {
   *   console.log('Connected!')
   * })
   *
   * client.on('error', (error) => {
   *   console.error('Error:', error)
   * })
   *
   * client.on('request', (data) => {
   *   console.log('Request:', data.method)
   * })
   * ```
   */
  on(event: MongoDoClientEventType, handler: MongoDoClientEventHandler): void {
    let listeners = this.eventListeners.get(event)
    if (!listeners) {
      listeners = new Set()
      this.eventListeners.set(event, listeners)
    }
    listeners.add(handler)
    this.log('debug', 'Event listener registered', { event })
  }

  /**
   * Removes an event listener.
   *
   * @param event - The event type
   * @param handler - The handler function to remove
   *
   * @example
   * ```typescript
   * const handler = () => console.log('Connected!')
   * client.on('connected', handler)
   *
   * // Later, remove the listener
   * client.off('connected', handler)
   * ```
   */
  off(event: MongoDoClientEventType, handler: MongoDoClientEventHandler): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.delete(handler)
      this.log('debug', 'Event listener removed', { event })
    }
  }

  // ===========================================================================
  // Debug & Statistics Methods
  // ===========================================================================

  /**
   * Enables or disables debug mode at runtime.
   *
   * When debug mode is enabled, the client will log detailed information
   * about connections, requests, and responses.
   *
   * @param enabled - Whether to enable debug mode
   * @param logger - Optional custom logger to use
   *
   * @example
   * ```typescript
   * // Enable debug mode with default console logger
   * client.setDebugMode(true)
   *
   * // Enable with custom logger
   * client.setDebugMode(true, {
   *   debug: (msg, data) => myLogger.debug(msg, data),
   *   error: (msg, data) => myLogger.error(msg, data),
   * })
   *
   * // Disable debug mode
   * client.setDebugMode(false)
   * ```
   */
  setDebugMode(enabled: boolean, logger?: MongoDoLogger): void {
    this.config.debug = enabled
    if (enabled) {
      this.logger = logger ?? this.config.logger ?? this.createDefaultLogger()
      this.log('info', 'Debug mode enabled')
    } else {
      this.log('info', 'Debug mode disabled')
      this.logger = null
    }
  }

  /**
   * Gets connection pool statistics.
   *
   * Returns statistics about the connection pool, including active connections,
   * idle connections, and waiting requests. Returns null if connection pooling
   * is not enabled.
   *
   * @returns Pool statistics or null if pooling is not enabled
   *
   * @example
   * ```typescript
   * const stats = client.getPoolStats()
   * if (stats) {
   *   console.log(`Active: ${stats.activeConnections}`)
   *   console.log(`Idle: ${stats.idleConnections}`)
   *   console.log(`Waiting: ${stats.waitingRequests}`)
   * }
   * ```
   */
  getPoolStats(): ConnectionPoolStats | null {
    // Connection pooling is not implemented in this basic client
    // This method is a placeholder for future implementation
    if (!this.config.connectionPool) {
      return null
    }

    // Return basic stats for the single connection
    return {
      totalConnections: this.connected ? 1 : 0,
      activeConnections: this.pendingRequests.size > 0 ? 1 : 0,
      idleConnections: this.connected && this.pendingRequests.size === 0 ? 1 : 0,
      waitingRequests: 0,
      connectionsCreated: 1,
      connectionsDestroyed: 0,
      avgAcquireTime: 0,
    }
  }

  /**
   * Gets the number of pending requests.
   *
   * @returns The number of requests currently awaiting responses
   *
   * @example
   * ```typescript
   * console.log(`Pending requests: ${client.getPendingRequestCount()}`)
   * ```
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generates a unique request ID.
   * @internal
   */
  private generateRequestId(): string {
    return `req_${++this.requestIdCounter}_${Date.now()}`
  }

  /**
   * Creates a default console-based logger.
   * @internal
   */
  private createDefaultLogger(): MongoDoLogger {
    return {
      debug: (msg, data) => console.debug(`[MongoDoClient] ${msg}`, data ?? ''),
      info: (msg, data) => console.info(`[MongoDoClient] ${msg}`, data ?? ''),
      warn: (msg, data) => console.warn(`[MongoDoClient] ${msg}`, data ?? ''),
      error: (msg, data) => console.error(`[MongoDoClient] ${msg}`, data ?? ''),
    }
  }

  /**
   * Logs a message using the configured logger.
   * @internal
   */
  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>
  ): void {
    if (this.logger && this.logger[level]) {
      this.logger[level]!(message, data)
    }
  }

  /**
   * Handles incoming WebSocket messages.
   * @internal
   */
  private handleMessage(data: string): void {
    let response: JsonRpcResponse
    try {
      response = JSON.parse(data) as JsonRpcResponse
    } catch (error) {
      this.log('warn', 'Failed to parse response', { data, error })
      return
    }

    this.log('debug', 'Received response', { id: response.id, hasError: !!response.error })

    // Validate JSON-RPC response format
    if (response.jsonrpc !== '2.0') {
      const pending = this.pendingRequests.get(String(response.id))
      if (pending) {
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId)
        }
        this.pendingRequests.delete(String(response.id))
        pending.reject(new MongoDoError('Invalid JSON-RPC response: missing version', -32600))
      }
      return
    }

    // Find and resolve the pending request
    const pending = this.pendingRequests.get(String(response.id))
    if (!pending) {
      this.log('warn', 'Received response for unknown request', { id: response.id })
      return
    }

    // Calculate duration for logging
    const duration = pending.startTime ? Date.now() - pending.startTime : undefined

    // Clear timeout
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId)
    }

    // Remove from pending
    this.pendingRequests.delete(String(response.id))

    // Emit response event
    this.emit('response', {
      id: response.id,
      method: pending.method,
      duration,
      hasError: !!response.error,
    })

    // Resolve or reject based on response
    if (response.error) {
      const error = new MongoDoError(
        response.error.message,
        response.error.code,
        { data: response.error.data as Record<string, unknown> | undefined }
      )
      this.log('error', 'Request failed', {
        id: response.id,
        method: pending.method,
        error: response.error,
        duration,
      })
      pending.reject(error)
    } else {
      this.log('debug', 'Request succeeded', {
        id: response.id,
        method: pending.method,
        duration,
      })
      pending.resolve(response.result)
    }
  }

  /**
   * Cancels all pending requests with an error.
   * @internal
   */
  private cancelAllPendingRequests(error: MongoDoError): void {
    const count = this.pendingRequests.size
    if (count > 0) {
      this.log('warn', 'Canceling pending requests', { count, reason: error.message })
    }

    for (const [id, pending] of this.pendingRequests) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId)
      }
      pending.reject(error)
      this.pendingRequests.delete(id)
    }
  }

  /**
   * Emits an event to all registered listeners.
   * @internal
   */
  private emit(event: MongoDoClientEventType, data?: Error | Event | unknown): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      for (const handler of listeners) {
        try {
          handler(data)
        } catch (error) {
          this.log('error', 'Event handler threw error', { event, error })
        }
      }
    }
  }
}

// =============================================================================
// DatabaseReference Class
// =============================================================================

/**
 * Reference to a database within the mongo.do API.
 *
 * Provides access to collections within the database. Database references
 * are obtained via {@link MongoDoClient.db} and are cached for efficiency.
 *
 * @example
 * ```typescript
 * const db = client.db('myDatabase')
 *
 * // Get collection references
 * const users = db.collection('users')
 * const posts = db.collection('posts')
 *
 * // Access database name
 * console.log(db.name) // 'myDatabase'
 * ```
 */
export class DatabaseReference {
  /**
   * The database name.
   *
   * @example
   * ```typescript
   * const db = client.db('analytics')
   * console.log(db.name) // 'analytics'
   * ```
   */
  public readonly name: string

  private client: MongoDoClient
  private collections = new Map<string, CollectionReference>()

  /**
   * Creates a new DatabaseReference.
   *
   * @param client - The parent MongoDoClient instance
   * @param name - The database name
   * @internal This constructor is used internally by MongoDoClient
   */
  constructor(client: MongoDoClient, name: string) {
    this.client = client
    this.name = name
  }

  /**
   * Gets or creates a collection reference.
   *
   * Collection references are cached for efficiency. Multiple calls with the
   * same collection name will return the same reference instance.
   *
   * @param name - The collection name
   * @returns A CollectionReference instance for the specified collection
   *
   * @example
   * ```typescript
   * const users = db.collection('users')
   * const posts = db.collection('posts')
   *
   * // Same reference is returned
   * const users2 = db.collection('users')
   * console.log(users === users2) // true
   * ```
   */
  collection(name: string): CollectionReference {
    let collRef = this.collections.get(name)
    if (!collRef) {
      collRef = new CollectionReference(this, name)
      this.collections.set(name, collRef)
    }
    return collRef
  }

  /**
   * Gets the parent client instance.
   *
   * @returns The MongoDoClient that owns this database reference
   * @internal Used by CollectionReference for RPC calls
   */
  getClient(): MongoDoClient {
    return this.client
  }
}

// =============================================================================
// CollectionReference Class
// =============================================================================

/**
 * Reference to a collection within a database.
 *
 * Provides MongoDB-like methods for interacting with the collection.
 * Collection references are obtained via {@link DatabaseReference.collection}
 * and are cached for efficiency.
 *
 * @remarks
 * Collection operation methods (find, insertOne, etc.) will be added in future
 * versions. Currently, you can use the client's {@link MongoDoClient.rpc} method
 * directly to perform collection operations.
 *
 * @example
 * ```typescript
 * const db = client.db('myDatabase')
 * const users = db.collection('users')
 *
 * // Access collection info
 * console.log(users.name) // 'users'
 * console.log(users.getDatabase().name) // 'myDatabase'
 *
 * // Use RPC directly for operations
 * const results = await client.rpc('collection.find', {
 *   database: db.name,
 *   collection: users.name,
 *   filter: { active: true }
 * })
 * ```
 */
export class CollectionReference {
  /**
   * The collection name.
   *
   * @example
   * ```typescript
   * const users = db.collection('users')
   * console.log(users.name) // 'users'
   * ```
   */
  public readonly name: string

  private db: DatabaseReference

  /**
   * Creates a new CollectionReference.
   *
   * @param db - The parent DatabaseReference instance
   * @param name - The collection name
   * @internal This constructor is used internally by DatabaseReference
   */
  constructor(db: DatabaseReference, name: string) {
    this.db = db
    this.name = name
  }

  /**
   * Gets the parent database reference.
   *
   * @returns The DatabaseReference that owns this collection
   *
   * @example
   * ```typescript
   * const users = db.collection('users')
   * const parentDb = users.getDatabase()
   * console.log(parentDb.name) // 'myDatabase'
   * ```
   */
  getDatabase(): DatabaseReference {
    return this.db
  }

  // ===========================================================================
  // Future MongoDB-like Methods
  // ===========================================================================

  // The following methods will be added in future phases:
  //
  // find(filter?: Filter, options?: FindOptions): Promise<Document[]>
  // findOne(filter?: Filter, options?: FindOptions): Promise<Document | null>
  // insertOne(document: Document, options?: InsertOptions): Promise<InsertResult>
  // insertMany(documents: Document[], options?: InsertOptions): Promise<InsertManyResult>
  // updateOne(filter: Filter, update: Update, options?: UpdateOptions): Promise<UpdateResult>
  // updateMany(filter: Filter, update: Update, options?: UpdateOptions): Promise<UpdateResult>
  // deleteOne(filter: Filter, options?: DeleteOptions): Promise<DeleteResult>
  // deleteMany(filter: Filter, options?: DeleteOptions): Promise<DeleteResult>
  // aggregate(pipeline: AggregateStage[], options?: AggregateOptions): Promise<Document[]>
  // watch(pipeline?: AggregateStage[], options?: WatchOptions): ChangeStream
  // countDocuments(filter?: Filter, options?: CountOptions): Promise<number>
  // estimatedDocumentCount(options?: EstimatedCountOptions): Promise<number>
}
