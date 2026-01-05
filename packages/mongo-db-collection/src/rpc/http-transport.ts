/**
 * @file HTTP Transport Implementation
 *
 * HTTP transport for JSON-RPC 2.0 communication with the mongo.do API.
 * Supports request/response handling, authentication, retry logic, custom headers,
 * request/response interceptors, AbortController cancellation, and request metrics.
 *
 * @example Basic Usage
 * ```typescript
 * import { HttpTransport } from '@tanstack/mongo-db-collection/rpc'
 *
 * const transport = new HttpTransport('https://api.mongo.do', {
 *   authToken: 'my-auth-token',
 *   timeout: 30000,
 *   retries: 3,
 * })
 *
 * const result = await transport.send('collection.find', {
 *   collection: 'users',
 *   filter: { active: true },
 * })
 * ```
 *
 * @example With Request Cancellation
 * ```typescript
 * const controller = new AbortController()
 *
 * // Cancel after 5 seconds
 * setTimeout(() => controller.abort(), 5000)
 *
 * try {
 *   const result = await transport.send('collection.find', params, {
 *     signal: controller.signal,
 *   })
 * } catch (error) {
 *   if (error instanceof RequestAbortedError) {
 *     console.log('Request was cancelled')
 *   }
 * }
 * ```
 *
 * @example With Interceptors
 * ```typescript
 * transport.addRequestInterceptor((request) => {
 *   console.log('Sending:', request.method)
 *   return request
 * })
 *
 * transport.addResponseInterceptor((response, request) => {
 *   console.log('Received:', response)
 *   return response
 * })
 * ```
 *
 * @see https://www.jsonrpc.org/specification
 * @see https://tanstack.com/db/latest/docs
 */

import {
  JsonRpcResponseError,
  HttpStatusError,
  RequestTimeoutError,
  RequestAbortedError,
  NetworkError,
} from './errors.js'

// Re-export error classes for convenience
export {
  JsonRpcResponseError,
  HttpStatusError,
  RequestTimeoutError,
  RequestAbortedError,
  NetworkError,
} from './errors.js'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration options for HttpTransport.
 *
 * @example
 * ```typescript
 * const options: HttpTransportOptions = {
 *   authToken: 'bearer-token',
 *   timeout: 30000,
 *   retries: 3,
 *   retryDelay: 1000,
 *   exponentialBackoff: true,
 *   headers: {
 *     'X-Custom-Header': 'value',
 *   },
 * }
 * ```
 */
export interface HttpTransportOptions {
  /**
   * Bearer token for authentication.
   * Will be sent as `Authorization: Bearer <token>` header.
   *
   * @example
   * ```typescript
   * { authToken: 'my-secret-token' }
   * ```
   */
  authToken?: string

  /**
   * Request timeout in milliseconds.
   * If not specified, requests will not timeout (controlled by fetch defaults).
   *
   * @default undefined (no timeout)
   * @example
   * ```typescript
   * { timeout: 30000 } // 30 second timeout
   * ```
   */
  timeout?: number

  /**
   * Number of retry attempts for retryable errors (5xx and network errors).
   * The total number of requests will be `retries + 1`.
   *
   * @default 0 (no retries)
   * @example
   * ```typescript
   * { retries: 3 } // Up to 4 total attempts
   * ```
   */
  retries?: number

  /**
   * Base delay between retries in milliseconds.
   * With exponential backoff, delay doubles after each attempt.
   *
   * @default 1000
   * @example
   * ```typescript
   * { retryDelay: 500 } // 500ms between retries
   * ```
   */
  retryDelay?: number

  /**
   * Whether to use exponential backoff for retries.
   * When enabled, delay = retryDelay * 2^attempt.
   *
   * @default false
   * @example
   * ```typescript
   * // With retryDelay: 1000 and exponentialBackoff: true
   * // Attempt 1: 1000ms delay
   * // Attempt 2: 2000ms delay
   * // Attempt 3: 4000ms delay
   * { exponentialBackoff: true }
   * ```
   */
  exponentialBackoff?: boolean

  /**
   * Additional custom headers to include in requests.
   * Note: Content-Type cannot be overridden (always application/json).
   *
   * @example
   * ```typescript
   * {
   *   headers: {
   *     'X-Request-ID': 'unique-id',
   *     'X-Client-Version': '1.0.0',
   *   }
   * }
   * ```
   */
  headers?: Record<string, string>
}

/**
 * Options for individual send() requests.
 *
 * @example
 * ```typescript
 * const controller = new AbortController()
 * const result = await transport.send('method', params, {
 *   signal: controller.signal,
 * })
 * ```
 */
export interface SendOptions {
  /**
   * AbortSignal for cancelling the request.
   * When aborted, throws RequestAbortedError.
   *
   * @example
   * ```typescript
   * const controller = new AbortController()
   * setTimeout(() => controller.abort('timeout'), 5000)
   *
   * await transport.send('method', params, {
   *   signal: controller.signal,
   * })
   * ```
   */
  signal?: AbortSignal
}

/**
 * JSON-RPC 2.0 request structure.
 *
 * @see https://www.jsonrpc.org/specification#request_object
 */
interface JsonRpcRequest {
  /** JSON-RPC protocol version, always "2.0" */
  jsonrpc: '2.0'
  /** The method to be invoked */
  method: string
  /** Parameters for the method */
  params?: unknown
  /** Unique request identifier */
  id: number
}

/**
 * JSON-RPC 2.0 response structure.
 *
 * @see https://www.jsonrpc.org/specification#response_object
 */
interface JsonRpcResponse<T = unknown> {
  /** JSON-RPC protocol version, always "2.0" */
  jsonrpc: '2.0'
  /** Request identifier (null for parse errors) */
  id: number | null
  /** The result on success */
  result?: T
  /** The error on failure */
  error?: JsonRpcError
}

/**
 * JSON-RPC 2.0 error structure.
 *
 * @see https://www.jsonrpc.org/specification#error_object
 */
interface JsonRpcError {
  /** Error code (see JSON-RPC specification for standard codes) */
  code: number
  /** Human-readable error message */
  message: string
  /** Additional error data */
  data?: unknown
}

/**
 * Request interceptor function type.
 * Called before each request is sent. Can modify the request or throw to cancel.
 *
 * @example
 * ```typescript
 * const interceptor: RequestInterceptor = (request) => {
 *   console.log('Sending request:', request.method)
 *   return { ...request, params: { ...request.params, timestamp: Date.now() } }
 * }
 * ```
 */
export type RequestInterceptor = (
  request: JsonRpcRequest
) => JsonRpcRequest | Promise<JsonRpcRequest>

/**
 * Response interceptor function type.
 * Called after each response is received. Can modify the response or throw to reject.
 *
 * @example
 * ```typescript
 * const interceptor: ResponseInterceptor = (response, request) => {
 *   console.log(`Response for ${request.method}:`, response)
 *   return response
 * }
 * ```
 */
export type ResponseInterceptor<T = unknown> = (
  response: JsonRpcResponse<T>,
  request: JsonRpcRequest
) => JsonRpcResponse<T> | Promise<JsonRpcResponse<T>>

/**
 * Error interceptor function type.
 * Called when an error occurs. Can modify the error, recover, or rethrow.
 *
 * @example
 * ```typescript
 * const interceptor: ErrorInterceptor = (error, request, attempt) => {
 *   console.log(`Error on attempt ${attempt}:`, error.message)
 *   throw error // rethrow to continue error handling
 * }
 * ```
 */
export type ErrorInterceptor = (
  error: Error,
  request: JsonRpcRequest,
  attempt: number
) => void | Promise<void>

/**
 * Request timing metrics for a single request.
 *
 * @example
 * ```typescript
 * transport.on('requestComplete', (metrics) => {
 *   console.log(`Request ${metrics.requestId} took ${metrics.duration}ms`)
 *   if (metrics.retryCount > 0) {
 *     console.log(`Required ${metrics.retryCount} retries`)
 *   }
 * })
 * ```
 */
export interface RequestMetrics {
  /** Unique request identifier */
  requestId: number
  /** RPC method name */
  method: string
  /** Request start timestamp (ms since epoch) */
  startTime: number
  /** Request end timestamp (ms since epoch) */
  endTime: number
  /** Total duration in milliseconds */
  duration: number
  /** Number of retry attempts (0 if succeeded on first try) */
  retryCount: number
  /** Whether the request succeeded */
  success: boolean
  /** HTTP status code (if available) */
  httpStatus?: number
  /** Error message (if failed) */
  error?: string
}

/**
 * Callback type for request completion events.
 */
export type RequestCompleteCallback = (metrics: RequestMetrics) => void

// ============================================================================
// HttpTransport Class
// ============================================================================

/**
 * HTTP transport for JSON-RPC 2.0 communication.
 *
 * Provides HTTP-based JSON-RPC communication with comprehensive features:
 * - JSON-RPC 2.0 request/response structure
 * - Bearer token authentication
 * - Configurable retry logic with exponential backoff
 * - Custom headers
 * - Request timeout via AbortController
 * - Request/response interceptors for middleware-style processing
 * - Request cancellation via AbortSignal
 * - Request timing metrics
 * - Proper cleanup on errors
 *
 * @example Basic usage
 * ```typescript
 * const transport = new HttpTransport('https://api.mongo.do', {
 *   authToken: 'my-auth-token',
 *   retries: 3,
 *   retryDelay: 1000,
 * })
 *
 * const result = await transport.send('collection.find', {
 *   collection: 'users',
 *   filter: { active: true },
 * })
 * ```
 *
 * @example With interceptors and metrics
 * ```typescript
 * const transport = new HttpTransport('https://api.mongo.do')
 *
 * // Add request logging
 * transport.addRequestInterceptor((request) => {
 *   console.log(`[${Date.now()}] -> ${request.method}`)
 *   return request
 * })
 *
 * // Add response logging
 * transport.addResponseInterceptor((response, request) => {
 *   console.log(`[${Date.now()}] <- ${request.method}`)
 *   return response
 * })
 *
 * // Track metrics
 * transport.onRequestComplete((metrics) => {
 *   analytics.track('rpc_request', {
 *     method: metrics.method,
 *     duration: metrics.duration,
 *     success: metrics.success,
 *   })
 * })
 * ```
 *
 * @example With request cancellation
 * ```typescript
 * const controller = new AbortController()
 *
 * // Cancel after 10 seconds
 * const timeout = setTimeout(() => controller.abort('timeout'), 10000)
 *
 * try {
 *   const result = await transport.send('slow.method', params, {
 *     signal: controller.signal,
 *   })
 *   clearTimeout(timeout)
 * } catch (error) {
 *   if (error instanceof RequestAbortedError) {
 *     console.log('Request was cancelled')
 *   }
 * }
 * ```
 */
export class HttpTransport {
  /** The base URL for the API (without trailing slash) */
  public readonly baseUrl: string

  /** Transport configuration options */
  private options: HttpTransportOptions

  /** Counter for generating unique request IDs */
  private requestIdCounter = 0

  /** Current authentication token */
  private authToken?: string

  /** Request interceptor chain */
  private requestInterceptors: RequestInterceptor[] = []

  /** Response interceptor chain */
  private responseInterceptors: ResponseInterceptor[] = []

  /** Error interceptor chain */
  private errorInterceptors: ErrorInterceptor[] = []

  /** Request completion callbacks */
  private requestCompleteCallbacks: RequestCompleteCallback[] = []

  /** Active abort controllers for cleanup */
  private activeControllers = new Set<AbortController>()

  /**
   * Creates a new HttpTransport instance.
   *
   * @param baseUrl - The base URL for the API endpoint (e.g., 'https://api.mongo.do')
   * @param options - Optional configuration for the transport
   *
   * @example
   * ```typescript
   * // Minimal setup
   * const transport = new HttpTransport('https://api.mongo.do')
   *
   * // With full configuration
   * const transport = new HttpTransport('https://api.mongo.do', {
   *   authToken: 'my-token',
   *   timeout: 30000,
   *   retries: 3,
   *   retryDelay: 1000,
   *   exponentialBackoff: true,
   *   headers: { 'X-Client-ID': 'my-client' },
   * })
   * ```
   */
  constructor(baseUrl: string, options: HttpTransportOptions = {}) {
    // Strip trailing slash from base URL for consistent URL construction
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.options = options
    this.authToken = options.authToken
  }

  // ===========================================================================
  // Authentication Methods
  // ===========================================================================

  /**
   * Sets the authentication token for subsequent requests.
   *
   * @param token - The bearer token for authentication, or undefined to clear
   *
   * @example
   * ```typescript
   * // Set token after login
   * transport.setAuthToken('new-token-from-login')
   *
   * // Clear token on logout
   * transport.setAuthToken(undefined)
   * ```
   */
  setAuthToken(token: string | undefined): void {
    this.authToken = token
  }

  /**
   * Gets the current authentication token.
   *
   * @returns The current auth token, or undefined if not set
   *
   * @example
   * ```typescript
   * if (!transport.getAuthToken()) {
   *   await login()
   * }
   * ```
   */
  getAuthToken(): string | undefined {
    return this.authToken
  }

  // ===========================================================================
  // Interceptor Methods
  // ===========================================================================

  /**
   * Adds a request interceptor to the chain.
   * Interceptors are called in the order they were added.
   *
   * @param interceptor - Function to process requests before sending
   * @returns Function to remove this interceptor
   *
   * @example
   * ```typescript
   * // Add logging interceptor
   * const remove = transport.addRequestInterceptor((request) => {
   *   console.log('Request:', request.method, request.params)
   *   return request
   * })
   *
   * // Later, remove the interceptor
   * remove()
   * ```
   *
   * @example Modifying requests
   * ```typescript
   * transport.addRequestInterceptor((request) => {
   *   // Add timestamp to all requests
   *   return {
   *     ...request,
   *     params: { ...request.params, timestamp: Date.now() },
   *   }
   * })
   * ```
   */
  addRequestInterceptor(interceptor: RequestInterceptor): () => void {
    this.requestInterceptors.push(interceptor)
    return () => {
      const index = this.requestInterceptors.indexOf(interceptor)
      if (index !== -1) {
        this.requestInterceptors.splice(index, 1)
      }
    }
  }

  /**
   * Adds a response interceptor to the chain.
   * Interceptors are called in the order they were added.
   *
   * @param interceptor - Function to process responses after receiving
   * @returns Function to remove this interceptor
   *
   * @example
   * ```typescript
   * // Add logging interceptor
   * transport.addResponseInterceptor((response, request) => {
   *   console.log(`Response for ${request.method}:`, response.result)
   *   return response
   * })
   * ```
   *
   * @example Transform responses
   * ```typescript
   * transport.addResponseInterceptor((response, request) => {
   *   // Unwrap nested data structure
   *   if (response.result?.data) {
   *     return { ...response, result: response.result.data }
   *   }
   *   return response
   * })
   * ```
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): () => void {
    this.responseInterceptors.push(interceptor)
    return () => {
      const index = this.responseInterceptors.indexOf(interceptor)
      if (index !== -1) {
        this.responseInterceptors.splice(index, 1)
      }
    }
  }

  /**
   * Adds an error interceptor to the chain.
   * Interceptors are called in the order they were added.
   * Can be used for logging, error transformation, or recovery.
   *
   * @param interceptor - Function to handle errors
   * @returns Function to remove this interceptor
   *
   * @example
   * ```typescript
   * // Log all errors
   * transport.addErrorInterceptor((error, request, attempt) => {
   *   console.error(`Error on ${request.method} (attempt ${attempt}):`, error)
   *   throw error // Re-throw to continue error handling
   * })
   * ```
   *
   * @example Error recovery
   * ```typescript
   * transport.addErrorInterceptor(async (error, request) => {
   *   if (error instanceof HttpStatusError && error.status === 401) {
   *     await refreshAuthToken()
   *     // Don't throw - will retry the request
   *     return
   *   }
   *   throw error
   * })
   * ```
   */
  addErrorInterceptor(interceptor: ErrorInterceptor): () => void {
    this.errorInterceptors.push(interceptor)
    return () => {
      const index = this.errorInterceptors.indexOf(interceptor)
      if (index !== -1) {
        this.errorInterceptors.splice(index, 1)
      }
    }
  }

  // ===========================================================================
  // Metrics Methods
  // ===========================================================================

  /**
   * Registers a callback for request completion events.
   * Called for both successful and failed requests with timing metrics.
   *
   * @param callback - Function to receive request metrics
   * @returns Function to unregister the callback
   *
   * @example
   * ```typescript
   * const unsubscribe = transport.onRequestComplete((metrics) => {
   *   // Send to monitoring service
   *   monitor.recordMetric({
   *     name: 'rpc.request',
   *     value: metrics.duration,
   *     tags: {
   *       method: metrics.method,
   *       success: String(metrics.success),
   *     },
   *   })
   * })
   *
   * // Later, stop receiving metrics
   * unsubscribe()
   * ```
   */
  onRequestComplete(callback: RequestCompleteCallback): () => void {
    this.requestCompleteCallbacks.push(callback)
    return () => {
      const index = this.requestCompleteCallbacks.indexOf(callback)
      if (index !== -1) {
        this.requestCompleteCallbacks.splice(index, 1)
      }
    }
  }

  // ===========================================================================
  // Core Request Method
  // ===========================================================================

  /**
   * Sends a JSON-RPC 2.0 request to the server.
   *
   * This method handles the complete request lifecycle:
   * 1. Request interceptors are applied
   * 2. Request is sent with configured timeout
   * 3. Retry logic handles transient failures
   * 4. Response interceptors are applied
   * 5. Metrics are recorded
   *
   * @typeParam T - The expected result type
   * @param method - The RPC method name (e.g., 'collection.find')
   * @param params - Optional parameters for the method
   * @param sendOptions - Optional request options (e.g., abort signal)
   * @returns Promise that resolves with the result
   *
   * @throws {JsonRpcResponseError} When the server returns a JSON-RPC error
   * @throws {HttpStatusError} When the server returns a non-2xx HTTP status
   * @throws {RequestTimeoutError} When the request times out
   * @throws {RequestAbortedError} When the request is aborted via AbortSignal
   * @throws {NetworkError} When a network error occurs
   *
   * @example Basic request
   * ```typescript
   * const users = await transport.send<User[]>('collection.find', {
   *   collection: 'users',
   *   filter: { active: true },
   * })
   * ```
   *
   * @example With abort signal
   * ```typescript
   * const controller = new AbortController()
   *
   * try {
   *   const result = await transport.send('method', params, {
   *     signal: controller.signal,
   *   })
   * } catch (error) {
   *   if (error instanceof RequestAbortedError) {
   *     console.log('Cancelled')
   *   }
   * }
   *
   * // Elsewhere, cancel the request
   * controller.abort()
   * ```
   */
  async send<T>(
    method: string,
    params?: unknown,
    sendOptions?: SendOptions
  ): Promise<T> {
    const id = this.generateRequestId()
    const startTime = Date.now()
    let retryCount = 0
    let httpStatus: number | undefined
    let lastError: Error | undefined

    // Build initial request
    let request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    }

    try {
      // Apply request interceptors
      request = await this.applyRequestInterceptors(request)

      const maxAttempts = (this.options.retries ?? 0) + 1

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Check if already aborted before starting
        if (sendOptions?.signal?.aborted) {
          throw new RequestAbortedError(
            this.getAbortReason(sendOptions.signal),
            { requestId: id, method }
          )
        }

        try {
          const result = await this.executeRequest<T>(request, sendOptions?.signal)

          // Record successful metrics
          this.emitMetrics({
            requestId: id,
            method,
            startTime,
            endTime: Date.now(),
            duration: Date.now() - startTime,
            retryCount,
            success: true,
            httpStatus: 200,
          })

          return result
        } catch (error) {
          lastError = error as Error

          // Extract HTTP status if available
          if (error instanceof HttpStatusError) {
            httpStatus = error.status
          }

          // Run error interceptors
          await this.runErrorInterceptors(error as Error, request, attempt + 1)

          // Check if we should retry
          if (attempt < maxAttempts - 1 && this.shouldRetry(error)) {
            retryCount++
            await this.delay(this.getRetryDelay(attempt))
            continue
          }

          throw error
        }
      }

      // This should never be reached, but TypeScript needs it
      throw lastError
    } catch (error) {
      // Record failed metrics
      this.emitMetrics({
        requestId: id,
        method,
        startTime,
        endTime: Date.now(),
        duration: Date.now() - startTime,
        retryCount,
        success: false,
        httpStatus,
        error: (error as Error).message,
      })

      throw error
    }
  }

  // ===========================================================================
  // Cleanup Methods
  // ===========================================================================

  /**
   * Aborts all active requests.
   * Useful for cleanup when the transport is no longer needed.
   *
   * @param reason - Optional reason for aborting
   *
   * @example
   * ```typescript
   * // On application shutdown
   * transport.abortAll('Application shutting down')
   * ```
   */
  abortAll(reason?: string): void {
    for (const controller of this.activeControllers) {
      controller.abort(reason)
    }
    this.activeControllers.clear()
  }

  /**
   * Removes all interceptors and callbacks.
   * Call this when disposing of the transport.
   *
   * @example
   * ```typescript
   * // Clean up before disposal
   * transport.abortAll()
   * transport.clearInterceptors()
   * ```
   */
  clearInterceptors(): void {
    this.requestInterceptors = []
    this.responseInterceptors = []
    this.errorInterceptors = []
    this.requestCompleteCallbacks = []
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generates a unique request ID.
   * @internal
   */
  private generateRequestId(): number {
    return ++this.requestIdCounter
  }

  /**
   * Applies all request interceptors to a request.
   * @internal
   */
  private async applyRequestInterceptors(
    request: JsonRpcRequest
  ): Promise<JsonRpcRequest> {
    let current = request
    for (const interceptor of this.requestInterceptors) {
      current = await interceptor(current)
    }
    return current
  }

  /**
   * Applies all response interceptors to a response.
   * @internal
   */
  private async applyResponseInterceptors<T>(
    response: JsonRpcResponse<T>,
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse<T>> {
    let current = response
    for (const interceptor of this.responseInterceptors) {
      current = (await interceptor(current, request)) as JsonRpcResponse<T>
    }
    return current
  }

  /**
   * Runs all error interceptors for an error.
   * @internal
   */
  private async runErrorInterceptors(
    error: Error,
    request: JsonRpcRequest,
    attempt: number
  ): Promise<void> {
    for (const interceptor of this.errorInterceptors) {
      await interceptor(error, request, attempt)
    }
  }

  /**
   * Emits metrics to all registered callbacks.
   * @internal
   */
  private emitMetrics(metrics: RequestMetrics): void {
    for (const callback of this.requestCompleteCallbacks) {
      try {
        callback(metrics)
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Executes a single HTTP request with proper cleanup.
   * @internal
   */
  private async executeRequest<T>(
    request: JsonRpcRequest,
    externalSignal?: AbortSignal
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add custom headers (but don't allow overriding Content-Type)
    if (this.options.headers) {
      for (const [key, value] of Object.entries(this.options.headers)) {
        if (key.toLowerCase() !== 'content-type') {
          headers[key] = value
        }
      }
    }

    // Add auth header if token is set
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`
    }

    // Create abort controller for timeout and cancellation
    const controller = new AbortController()
    this.activeControllers.add(controller)

    // Track timeout for cleanup
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    // Cleanup function to ensure resources are released
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
      this.activeControllers.delete(controller)
    }

    try {
      // Set up timeout if configured
      if (this.options.timeout) {
        timeoutId = setTimeout(() => {
          controller.abort('timeout')
        }, this.options.timeout)
      }

      // Link external abort signal to our controller
      if (externalSignal) {
        if (externalSignal.aborted) {
          throw new RequestAbortedError(this.getAbortReason(externalSignal), {
            requestId: request.id,
            method: request.method,
          })
        }

        const onAbort = () => {
          controller.abort(this.getAbortReason(externalSignal))
        }
        externalSignal.addEventListener('abort', onAbort, { once: true })
      }

      const fetchOptions: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      }

      let response: Response
      try {
        response = await fetch(`${this.baseUrl}/rpc`, fetchOptions)
      } catch (error) {
        // Handle abort errors
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Check if it was a timeout or external abort
          if (
            this.options.timeout &&
            controller.signal.reason === 'timeout'
          ) {
            throw new RequestTimeoutError(this.options.timeout, {
              requestId: request.id,
              method: request.method,
            })
          }
          throw new RequestAbortedError(controller.signal.reason, {
            requestId: request.id,
            method: request.method,
          })
        }

        // Handle network errors
        if (error instanceof TypeError) {
          throw new NetworkError(error.message, {
            requestId: request.id,
            method: request.method,
            cause: error,
          })
        }

        throw error
      }

      // Handle HTTP errors
      if (!response.ok) {
        throw new HttpStatusError(response.status, response.statusText, {
          requestId: request.id,
          method: request.method,
        })
      }

      // Parse JSON response
      let jsonResponse: JsonRpcResponse<T>
      try {
        jsonResponse = (await response.json()) as JsonRpcResponse<T>
      } catch (error) {
        throw new Error('Failed to parse JSON response', { cause: error })
      }

      // Apply response interceptors
      jsonResponse = await this.applyResponseInterceptors(jsonResponse, request)

      // Handle JSON-RPC errors
      if (jsonResponse.error) {
        throw JsonRpcResponseError.fromResponse(jsonResponse.error, {
          requestId: request.id,
          method: request.method,
        })
      }

      return jsonResponse.result as T
    } finally {
      cleanup()
    }
  }

  /**
   * Determines if an error should trigger a retry.
   * @internal
   */
  private shouldRetry(error: unknown): boolean {
    // Don't retry abort errors
    if (error instanceof RequestAbortedError) {
      return false
    }

    // Don't retry timeout errors (they'll just timeout again)
    if (error instanceof RequestTimeoutError) {
      return false
    }

    // Retry network errors
    if (error instanceof NetworkError) {
      return true
    }

    // Check HTTP status for retryability
    if (error instanceof HttpStatusError) {
      return error.isRetryable()
    }

    // Retry on generic network errors (TypeError: Failed to fetch)
    if (error instanceof TypeError) {
      return true
    }

    return false
  }

  /**
   * Calculates the delay before a retry attempt.
   * @internal
   */
  private getRetryDelay(attempt: number): number {
    const baseDelay = this.options.retryDelay ?? 1000

    if (this.options.exponentialBackoff) {
      // Exponential backoff: delay * 2^attempt
      return baseDelay * Math.pow(2, attempt)
    }

    return baseDelay
  }

  /**
   * Returns a promise that resolves after the specified delay.
   * @internal
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Extracts the abort reason from an AbortSignal.
   * @internal
   */
  private getAbortReason(signal: AbortSignal): string | undefined {
    if (signal.reason) {
      if (typeof signal.reason === 'string') {
        return signal.reason
      }
      if (signal.reason instanceof Error) {
        return signal.reason.message
      }
    }
    return undefined
  }
}
