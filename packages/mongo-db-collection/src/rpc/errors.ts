/**
 * @file HTTP Transport Error Classes
 *
 * Custom error classes for HTTP transport operations, providing structured
 * error handling for JSON-RPC communication, network failures, and timeouts.
 *
 * @example
 * ```typescript
 * import {
 *   JsonRpcResponseError,
 *   HttpTransportError,
 *   RequestTimeoutError,
 *   RequestAbortedError,
 * } from './errors'
 *
 * try {
 *   await transport.send('method', params)
 * } catch (error) {
 *   if (error instanceof JsonRpcResponseError) {
 *     console.log('RPC Error:', error.code, error.message)
 *   } else if (error instanceof RequestTimeoutError) {
 *     console.log('Request timed out after', error.timeout, 'ms')
 *   }
 * }
 * ```
 *
 * @see https://www.jsonrpc.org/specification#error_object
 */

// =============================================================================
// Base Transport Error
// =============================================================================

/**
 * Base error class for all HTTP transport errors.
 *
 * Provides common functionality for transport-related errors including
 * request context and cause chaining.
 *
 * @example
 * ```typescript
 * if (error instanceof HttpTransportError) {
 *   console.log('Transport error for request:', error.requestId)
 *   console.log('Method:', error.method)
 * }
 * ```
 */
export class HttpTransportError extends Error {
  /** The request ID associated with this error, if available */
  readonly requestId?: number

  /** The RPC method that was being called */
  readonly method?: string

  /** The original cause of this error, if any */
  override readonly cause?: Error

  /**
   * Creates a new HttpTransportError.
   *
   * @param message - Human-readable error message
   * @param options - Additional error context
   *
   * @example
   * ```typescript
   * throw new HttpTransportError('Connection failed', {
   *   requestId: 123,
   *   method: 'collection.find',
   *   cause: originalError,
   * })
   * ```
   */
  constructor(
    message: string,
    options?: {
      requestId?: number
      method?: string
      cause?: Error
    }
  ) {
    super(message)
    this.name = 'HttpTransportError'
    this.requestId = options?.requestId
    this.method = options?.method
    this.cause = options?.cause

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpTransportError)
    }
  }
}

// =============================================================================
// JSON-RPC Errors
// =============================================================================

/**
 * Error thrown when the server returns a JSON-RPC 2.0 error response.
 *
 * Contains the error code, message, and optional data from the server response.
 * Standard JSON-RPC error codes are in the range -32768 to -32000.
 *
 * Standard error codes:
 * - -32700: Parse error
 * - -32600: Invalid Request
 * - -32601: Method not found
 * - -32602: Invalid params
 * - -32603: Internal error
 * - -32000 to -32099: Server error (reserved for implementation-defined errors)
 *
 * @example
 * ```typescript
 * try {
 *   await transport.send('unknown.method', {})
 * } catch (error) {
 *   if (error instanceof JsonRpcResponseError) {
 *     switch (error.code) {
 *       case -32601:
 *         console.log('Method not found')
 *         break
 *       case -32602:
 *         console.log('Invalid params:', error.data)
 *         break
 *       default:
 *         console.log('RPC error:', error.message)
 *     }
 *   }
 * }
 * ```
 *
 * @see https://www.jsonrpc.org/specification#error_object
 */
export class JsonRpcResponseError extends HttpTransportError {
  /** The JSON-RPC error code */
  readonly code: number

  /** Additional error data from the server */
  readonly data?: unknown

  /**
   * Creates a new JsonRpcResponseError.
   *
   * @param message - The error message from the server
   * @param code - The JSON-RPC error code
   * @param data - Optional additional error data
   * @param options - Additional context (requestId, method)
   *
   * @example
   * ```typescript
   * throw new JsonRpcResponseError(
   *   'Invalid params',
   *   -32602,
   *   { field: 'filter', reason: 'must be an object' },
   *   { requestId: 1, method: 'collection.find' }
   * )
   * ```
   */
  constructor(
    message: string,
    code: number,
    data?: unknown,
    options?: {
      requestId?: number
      method?: string
    }
  ) {
    super(message, options)
    this.name = 'JsonRpcResponseError'
    this.code = code
    this.data = data
  }

  /**
   * Creates a JsonRpcResponseError from a JSON-RPC error object.
   *
   * @param error - The error object from JSON-RPC response
   * @param options - Additional context
   * @returns A new JsonRpcResponseError instance
   *
   * @example
   * ```typescript
   * const error = JsonRpcResponseError.fromResponse(
   *   { code: -32601, message: 'Method not found' },
   *   { requestId: 1 }
   * )
   * ```
   */
  static fromResponse(
    error: { code: number; message: string; data?: unknown },
    options?: { requestId?: number; method?: string }
  ): JsonRpcResponseError {
    return new JsonRpcResponseError(error.message, error.code, error.data, options)
  }
}

// =============================================================================
// HTTP Errors
// =============================================================================

/**
 * Error thrown when the HTTP request fails with a non-2xx status code.
 *
 * Includes the HTTP status code and status text for debugging and retry logic.
 *
 * @example
 * ```typescript
 * try {
 *   await transport.send('method', {})
 * } catch (error) {
 *   if (error instanceof HttpStatusError) {
 *     if (error.status === 401) {
 *       // Handle authentication error
 *       await refreshToken()
 *     } else if (error.status >= 500) {
 *       // Server error, might retry
 *       console.log('Server error:', error.statusText)
 *     }
 *   }
 * }
 * ```
 */
export class HttpStatusError extends HttpTransportError {
  /** The HTTP status code */
  readonly status: number

  /** The HTTP status text */
  readonly statusText: string

  /**
   * Creates a new HttpStatusError.
   *
   * @param status - The HTTP status code
   * @param statusText - The HTTP status text
   * @param options - Additional context
   *
   * @example
   * ```typescript
   * throw new HttpStatusError(503, 'Service Unavailable', {
   *   requestId: 1,
   *   method: 'collection.find',
   * })
   * ```
   */
  constructor(
    status: number,
    statusText: string,
    options?: {
      requestId?: number
      method?: string
    }
  ) {
    super(`HTTP ${status}: ${statusText}`, options)
    this.name = 'HttpStatusError'
    this.status = status
    this.statusText = statusText
  }

  /**
   * Returns true if this is a client error (4xx status code).
   *
   * @example
   * ```typescript
   * if (error.isClientError()) {
   *   // Don't retry client errors
   *   throw error
   * }
   * ```
   */
  isClientError(): boolean {
    return this.status >= 400 && this.status < 500
  }

  /**
   * Returns true if this is a server error (5xx status code).
   *
   * @example
   * ```typescript
   * if (error.isServerError()) {
   *   // Might want to retry server errors
   *   await retryRequest()
   * }
   * ```
   */
  isServerError(): boolean {
    return this.status >= 500 && this.status < 600
  }

  /**
   * Returns true if this error should trigger a retry.
   *
   * Server errors (5xx) are typically retryable, client errors (4xx) are not.
   *
   * @example
   * ```typescript
   * if (error.isRetryable()) {
   *   await delay(1000)
   *   await retryRequest()
   * }
   * ```
   */
  isRetryable(): boolean {
    return this.isServerError()
  }
}

// =============================================================================
// Timeout and Abort Errors
// =============================================================================

/**
 * Error thrown when a request times out.
 *
 * Includes the timeout duration for debugging and configuration tuning.
 *
 * @example
 * ```typescript
 * try {
 *   await transport.send('slow.method', {})
 * } catch (error) {
 *   if (error instanceof RequestTimeoutError) {
 *     console.log(`Request timed out after ${error.timeout}ms`)
 *     // Consider increasing timeout for this operation
 *   }
 * }
 * ```
 */
export class RequestTimeoutError extends HttpTransportError {
  /** The timeout duration in milliseconds */
  readonly timeout: number

  /**
   * Creates a new RequestTimeoutError.
   *
   * @param timeout - The timeout duration in milliseconds
   * @param options - Additional context
   *
   * @example
   * ```typescript
   * throw new RequestTimeoutError(30000, {
   *   requestId: 1,
   *   method: 'collection.aggregate',
   * })
   * ```
   */
  constructor(
    timeout: number,
    options?: {
      requestId?: number
      method?: string
    }
  ) {
    super(`Request timed out after ${timeout}ms`, options)
    this.name = 'RequestTimeoutError'
    this.timeout = timeout
  }
}

/**
 * Error thrown when a request is aborted via AbortController.
 *
 * This occurs when the caller explicitly cancels a request using an AbortSignal.
 *
 * @example
 * ```typescript
 * const controller = new AbortController()
 *
 * // Abort after 5 seconds
 * setTimeout(() => controller.abort(), 5000)
 *
 * try {
 *   await transport.send('method', params, { signal: controller.signal })
 * } catch (error) {
 *   if (error instanceof RequestAbortedError) {
 *     console.log('Request was cancelled:', error.reason)
 *   }
 * }
 * ```
 */
export class RequestAbortedError extends HttpTransportError {
  /** The abort reason, if provided */
  readonly reason?: string

  /**
   * Creates a new RequestAbortedError.
   *
   * @param reason - The reason for aborting, if any
   * @param options - Additional context
   *
   * @example
   * ```typescript
   * throw new RequestAbortedError('User cancelled', {
   *   requestId: 1,
   *   method: 'collection.find',
   * })
   * ```
   */
  constructor(
    reason?: string,
    options?: {
      requestId?: number
      method?: string
    }
  ) {
    super(reason ? `Request aborted: ${reason}` : 'Request aborted', options)
    this.name = 'RequestAbortedError'
    this.reason = reason
  }
}

// =============================================================================
// Network Errors
// =============================================================================

/**
 * Error thrown when a network error occurs (e.g., no internet connection).
 *
 * These errors are typically retryable as they may be transient.
 *
 * @example
 * ```typescript
 * try {
 *   await transport.send('method', {})
 * } catch (error) {
 *   if (error instanceof NetworkError) {
 *     console.log('Network error:', error.message)
 *     // Wait for network to recover and retry
 *   }
 * }
 * ```
 */
export class NetworkError extends HttpTransportError {
  /**
   * Creates a new NetworkError.
   *
   * @param message - Description of the network error
   * @param options - Additional context including the original error
   *
   * @example
   * ```typescript
   * throw new NetworkError('Failed to fetch', {
   *   cause: originalTypeError,
   *   requestId: 1,
   *   method: 'collection.find',
   * })
   * ```
   */
  constructor(
    message: string,
    options?: {
      requestId?: number
      method?: string
      cause?: Error
    }
  ) {
    super(message, options)
    this.name = 'NetworkError'
  }
}
