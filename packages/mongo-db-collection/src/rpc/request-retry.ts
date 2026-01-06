/**
 * @file Request Retry - Stub Implementation
 *
 * This is a stub implementation for the RequestRetry module.
 * The request retry module provides automatic retry functionality
 * for failed requests with configurable backoff strategies.
 *
 * Features:
 * - Automatic retry of failed requests
 * - Exponential backoff with configurable parameters
 * - Maximum retry limits
 * - Retry condition customization
 * - Jitter for distributed system friendliness
 * - Retry event callbacks for monitoring
 * - Abort signal support
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Error that may be retryable
 */
export interface RetryableError extends Error {
  retryable?: boolean
  code?: string
}

/**
 * Configuration for request retry
 */
export interface RequestRetryConfig {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  exponentialBackoff?: boolean
  jitterFactor?: number
  shouldRetry?: (error: Error, attempt: number) => boolean
  onRetry?: (event: { attempt: number; error: Error; delay: number }) => void
  onSuccess?: (event: { result: unknown; attempts: number }) => void
  onExhausted?: (event: { error: Error; attempts: number }) => void
}

/**
 * Options for execute method
 */
export interface ExecuteOptions {
  signal?: AbortSignal
}

/**
 * Operation function type
 */
export type Operation<T> = (attempt: number) => Promise<T>

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates default retry configuration
 */
export function createDefaultRetryConfig(): Required<
  Omit<RequestRetryConfig, 'shouldRetry' | 'onRetry' | 'onSuccess' | 'onExhausted'>
> {
  return {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    exponentialBackoff: true,
    jitterFactor: 0.1,
  }
}

/**
 * Determines if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const retryableError = error as RetryableError

  // Check explicit retryable property
  if (retryableError.retryable === false) {
    return false
  }
  if (retryableError.retryable === true) {
    return true
  }

  // Check error codes
  const code = retryableError.code
  if (code) {
    const retryableCodes = ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND']
    if (retryableCodes.includes(code)) {
      return true
    }
  }

  // Check for network errors (TypeError with 'fetch' in message)
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    return true
  }

  return false
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * RequestRetry class provides automatic retry functionality
 */
export class RequestRetry {
  private _config: Required<RequestRetryConfig>

  constructor(config?: RequestRetryConfig) {
    const defaults = createDefaultRetryConfig()
    this._config = {
      ...defaults,
      ...config,
      shouldRetry: config?.shouldRetry ?? (() => true),
      onRetry: config?.onRetry ?? (() => {}),
      onSuccess: config?.onSuccess ?? (() => {}),
      onExhausted: config?.onExhausted ?? (() => {}),
    }
  }

  getConfig(): Required<RequestRetryConfig> {
    return { ...this._config }
  }

  updateConfig(config: Partial<RequestRetryConfig>): void {
    this._config = {
      ...this._config,
      ...config,
    }
  }

  calculateDelay(attempt: number): number {
    let delay: number

    if (this._config.exponentialBackoff) {
      delay = this._config.baseDelayMs * Math.pow(2, attempt)
    } else {
      delay = this._config.baseDelayMs
    }

    // Apply jitter
    if (this._config.jitterFactor > 0) {
      const jitter = delay * this._config.jitterFactor
      const jitterOffset = -jitter / 2 + Math.random() * jitter
      delay = delay + jitterOffset
    }

    // Cap at max delay
    return Math.min(delay, this._config.maxDelayMs)
  }

  async execute<T>(
    operation: Operation<T>,
    options?: ExecuteOptions
  ): Promise<T> {
    const signal = options?.signal
    let lastError: Error | null = null
    let attempts = 0

    // Check if already aborted
    if (signal?.aborted) {
      throw new Error('Aborted')
    }

    for (let attempt = 0; attempt <= this._config.maxRetries; attempt++) {
      attempts++

      // Check abort signal
      if (signal?.aborted) {
        throw new Error('Aborted')
      }

      try {
        const result = await operation(attempt)
        this._config.onSuccess({ result, attempts })
        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Check if we should retry
        if (attempt < this._config.maxRetries) {
          // Check abort signal
          if (signal?.aborted) {
            throw new Error('Aborted')
          }

          // Check retry condition
          if (!this._config.shouldRetry(lastError, attempt)) {
            throw lastError
          }

          const delay = this.calculateDelay(attempt)

          this._config.onRetry({
            attempt: attempt + 1,
            error: lastError,
            delay,
          })

          // Wait with abort support
          await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(resolve, delay)

            if (signal) {
              const abortHandler = () => {
                clearTimeout(timeoutId)
                reject(new Error('Aborted'))
              }
              signal.addEventListener('abort', abortHandler, { once: true })
            }
          })
        }
      }
    }

    this._config.onExhausted({ error: lastError!, attempts })
    throw lastError!
  }

  /**
   * Static helper for quick one-off retries
   */
  static async withRetry<T>(
    operation: Operation<T>,
    config?: RequestRetryConfig
  ): Promise<T> {
    const retry = new RequestRetry(config)
    return retry.execute(operation)
  }
}
