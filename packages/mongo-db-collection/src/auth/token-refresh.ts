/**
 * @file Token Refresh Manager
 * @module @tanstack/mongo-db-collection/auth/token-refresh
 *
 * Handles automatic token refresh for authenticated connections to mongo.do.
 *
 * Features:
 * - Automatic refresh scheduling before token expiry
 * - Retry logic with exponential backoff
 * - Jitter to prevent thundering herd problem
 * - Prevention of concurrent refresh attempts
 * - Callback notifications for new tokens and errors
 * - Lifecycle hooks (beforeRefresh, afterRefresh)
 * - Custom refresh request builder support
 * - Refresh metrics tracking (success/failure counts)
 * - Proper AbortController cleanup for cancellation
 *
 * @example
 * ```typescript
 * const manager = new TokenRefreshManager({
 *   refreshUrl: 'https://api.mongo.do/auth/refresh',
 *   refreshBeforeExpiry: 60000, // 1 minute before expiry
 *   maxRetries: 3,
 *   jitterMs: 5000, // Add up to 5s of jitter
 *   beforeRefresh: async () => console.log('Starting refresh'),
 *   afterRefresh: async (token) => console.log('Got new token'),
 *   onRefresh: (token) => updateStoredToken(token),
 *   onError: (error) => handleRefreshError(error),
 * })
 *
 * // Schedule automatic refresh based on token expiry
 * manager.scheduleRefresh({
 *   accessToken: 'current-token',
 *   expiresAt: Date.now() + 3600000,
 * })
 *
 * // Get refresh metrics
 * console.log(manager.getMetrics())
 * // { successCount: 5, failureCount: 1, lastRefreshAt: 1234567890 }
 * ```
 *
 * @see https://tools.ietf.org/html/rfc6749#section-6 (OAuth 2.0 Token Refresh)
 */

/**
 * Refresh metrics tracking success and failure counts.
 *
 * @remarks
 * Use these metrics to monitor the health of token refresh operations
 * and detect potential issues with the authentication infrastructure.
 */
export interface RefreshMetrics {
  /** Total number of successful token refreshes */
  successCount: number
  /** Total number of failed token refreshes (after all retries exhausted) */
  failureCount: number
  /** Timestamp of the last successful refresh, or undefined if never refreshed */
  lastRefreshAt?: number
  /** Timestamp of the last failed refresh attempt, or undefined if never failed */
  lastFailureAt?: number
  /** Total number of retry attempts across all refresh operations */
  totalRetryAttempts: number
}

/**
 * Options for building a custom refresh request.
 *
 * @remarks
 * Use this interface when implementing a custom refresh request builder
 * to have full control over the request sent to the refresh endpoint.
 */
export interface RefreshRequestOptions {
  /** The current access token being refreshed */
  accessToken: string
  /** The refresh token, if available */
  refreshToken?: string
  /** The configured refresh URL endpoint */
  refreshUrl: string
}

/**
 * Result from a custom refresh request builder.
 *
 * @remarks
 * Return this structure from your custom request builder to specify
 * the exact URL, method, headers, and body for the refresh request.
 */
export interface RefreshRequestConfig {
  /** The URL to send the refresh request to */
  url: string
  /** HTTP method (defaults to 'POST') */
  method?: string
  /** HTTP headers to include in the request */
  headers: Record<string, string>
  /** Request body as a string (typically JSON) */
  body?: string
}

/**
 * Context passed to lifecycle hooks.
 *
 * @remarks
 * This context provides information about the current refresh operation
 * and allows hooks to access relevant state.
 */
export interface RefreshHookContext {
  /** The current access token being refreshed */
  accessToken: string
  /** The refresh token, if available */
  refreshToken?: string
  /** Whether this is a retry attempt */
  isRetry: boolean
  /** Current attempt number (0-based) */
  attemptNumber: number
  /** Abort signal for cancellation */
  signal: AbortSignal
}

/**
 * Context passed to afterRefresh hook.
 *
 * @remarks
 * Extends RefreshHookContext with the new token information
 * after a successful refresh.
 */
export interface AfterRefreshHookContext extends RefreshHookContext {
  /** The newly obtained token response */
  newToken: TokenResponse
  /** Duration of the refresh operation in milliseconds */
  durationMs: number
}

/**
 * Configuration options for the TokenRefreshManager.
 *
 * @remarks
 * All time values are in milliseconds unless otherwise specified.
 * The manager uses sensible defaults for most options.
 *
 * @example
 * ```typescript
 * const config: TokenRefreshConfig = {
 *   refreshUrl: 'https://api.example.com/auth/refresh',
 *   refreshBeforeExpiry: 300000, // 5 minutes
 *   maxRetries: 5,
 *   jitterMs: 10000, // Up to 10 seconds of random jitter
 *   onRefresh: (token) => saveToken(token),
 * }
 * ```
 */
export interface TokenRefreshConfig {
  /**
   * The URL endpoint for token refresh requests.
   *
   * @remarks
   * This should be the full URL to your authentication server's
   * token refresh endpoint.
   *
   * @example 'https://api.mongo.do/auth/refresh'
   */
  refreshUrl: string

  /**
   * Time in milliseconds before token expiry to trigger refresh.
   *
   * @remarks
   * A higher value provides more buffer time for retries but may
   * result in more frequent refreshes. A lower value maximizes
   * token lifetime but leaves less room for error recovery.
   *
   * @default 60000 (1 minute)
   */
  refreshBeforeExpiry?: number

  /**
   * Maximum number of retry attempts on failure.
   *
   * @remarks
   * After the initial attempt fails, the manager will retry up to
   * this many additional times with exponential backoff.
   *
   * @default 3
   */
  maxRetries?: number

  /**
   * Initial delay in milliseconds between retry attempts.
   *
   * @remarks
   * This is the base delay that will be multiplied by the backoff
   * multiplier for subsequent retries.
   *
   * @default 1000 (1 second)
   */
  initialRetryDelay?: number

  /**
   * Maximum delay in milliseconds between retry attempts.
   *
   * @remarks
   * The exponential backoff will cap at this value to prevent
   * excessively long delays between retries.
   *
   * @default 30000 (30 seconds)
   */
  maxRetryDelay?: number

  /**
   * Multiplier for exponential backoff.
   *
   * @remarks
   * Each retry delay is calculated as:
   * `min(previousDelay * backoffMultiplier, maxRetryDelay)`
   *
   * @default 2
   */
  backoffMultiplier?: number

  /**
   * Maximum jitter in milliseconds to add to refresh timing.
   *
   * @remarks
   * Jitter helps prevent the "thundering herd" problem when many
   * clients try to refresh tokens at the same time. A random value
   * between 0 and jitterMs is added to the scheduled refresh time.
   *
   * Set to 0 to disable jitter.
   *
   * @default 0 (no jitter)
   */
  jitterMs?: number

  /**
   * Callback invoked when a new token is successfully obtained.
   *
   * @remarks
   * This callback is called after both scheduled and manual refreshes.
   * Use it to update your stored token and trigger any necessary
   * side effects.
   *
   * @param token - The new token response from the server
   */
  onRefresh?: (token: TokenResponse) => void | Promise<void>

  /**
   * Callback invoked when token refresh fails after all retries.
   *
   * @remarks
   * This callback indicates that the token could not be refreshed
   * and the user may need to re-authenticate. Use it to trigger
   * logout flows or show error messages.
   *
   * @param error - The error that caused the final failure
   */
  onError?: (error: Error) => void

  /**
   * Custom function to build the refresh request.
   *
   * @remarks
   * Override this to customize how the refresh request is built.
   * Useful for APIs that require different authentication schemes
   * or request formats.
   *
   * @param options - Options containing tokens and URL
   * @returns The request configuration to use for the refresh
   *
   * @example
   * ```typescript
   * buildRefreshRequest: (options) => ({
   *   url: options.refreshUrl,
   *   method: 'POST',
   *   headers: {
   *     'Content-Type': 'application/x-www-form-urlencoded',
   *     'Authorization': `Basic ${btoa('client:secret')}`,
   *   },
   *   body: `grant_type=refresh_token&refresh_token=${options.refreshToken}`,
   * })
   * ```
   */
  buildRefreshRequest?: (options: RefreshRequestOptions) => RefreshRequestConfig

  /**
   * Hook called before each refresh attempt.
   *
   * @remarks
   * Use this hook to perform actions before the refresh request is sent,
   * such as logging, analytics, or conditional logic. Throwing an error
   * from this hook will abort the refresh attempt.
   *
   * @param context - Context information about the refresh operation
   */
  beforeRefresh?: (context: RefreshHookContext) => void | Promise<void>

  /**
   * Hook called after a successful refresh.
   *
   * @remarks
   * Use this hook to perform actions after a successful refresh,
   * such as logging metrics or updating UI state. This is called
   * before the onRefresh callback.
   *
   * @param context - Context with the new token and timing information
   */
  afterRefresh?: (context: AfterRefreshHookContext) => void | Promise<void>
}

/**
 * Token information for scheduling refresh.
 *
 * @remarks
 * Provide either `expiresAt` (absolute timestamp) or `expiresIn`
 * (relative seconds). If both are provided, `expiresAt` takes precedence.
 * If neither is provided, a default of 1 hour is assumed.
 */
export interface TokenInfo {
  /**
   * The access token string.
   *
   * @remarks
   * This token will be used for the Authorization header when
   * calling the refresh endpoint.
   */
  accessToken: string

  /**
   * Absolute timestamp in milliseconds when the token expires.
   *
   * @remarks
   * Takes precedence over `expiresIn` if both are provided.
   *
   * @example Date.now() + 3600000 // 1 hour from now
   */
  expiresAt?: number

  /**
   * Time in seconds until the token expires.
   *
   * @remarks
   * Used only if `expiresAt` is not provided.
   *
   * @example 3600 // 1 hour
   */
  expiresIn?: number
}

/**
 * Response from the token refresh endpoint.
 *
 * @remarks
 * This interface matches the typical OAuth 2.0 token response format.
 * The manager will normalize `expiresIn` to `expiresAt` if needed.
 */
export interface TokenResponse {
  /**
   * The new access token.
   *
   * @remarks
   * This token should be used for subsequent API requests.
   */
  accessToken: string

  /**
   * Absolute timestamp in milliseconds when the token expires.
   *
   * @remarks
   * Calculated from `expiresIn` if not directly provided.
   */
  expiresAt?: number

  /**
   * Time in seconds until the token expires.
   *
   * @remarks
   * As returned by the server, before conversion to `expiresAt`.
   */
  expiresIn?: number

  /**
   * Optional refresh token for the next refresh.
   *
   * @remarks
   * Some OAuth implementations rotate refresh tokens with each use.
   * If provided, this should be stored and used for the next refresh.
   */
  refreshToken?: string
}

/**
 * Error class for token refresh failures.
 *
 * @remarks
 * This error provides additional context about HTTP failures,
 * including status codes and whether the error is retryable.
 *
 * @example
 * ```typescript
 * try {
 *   await manager.refresh(token)
 * } catch (error) {
 *   if (error instanceof TokenRefreshError) {
 *     if (error.isClientError) {
 *       // 4xx error - don't retry, user needs to re-auth
 *       redirectToLogin()
 *     } else {
 *       // 5xx or network error - may be worth retrying
 *       scheduleRetry()
 *     }
 *   }
 * }
 * ```
 */
export class TokenRefreshError extends Error {
  /**
   * Creates a new TokenRefreshError.
   *
   * @param message - Human-readable error message
   * @param status - HTTP status code, if available
   * @param statusText - HTTP status text, if available
   */
  constructor(
    message: string,
    public readonly status?: number,
    public readonly statusText?: string
  ) {
    super(message)
    this.name = 'TokenRefreshError'
  }

  /**
   * Whether this error is a client error (4xx) that should not be retried.
   *
   * @remarks
   * Client errors indicate that the request itself is invalid and
   * retrying with the same parameters will not succeed. This typically
   * means the refresh token is invalid or expired.
   *
   * @returns true if status is 4xx, false otherwise
   */
  get isClientError(): boolean {
    return this.status !== undefined && this.status >= 400 && this.status < 500
  }

  /**
   * Whether this error is potentially retryable.
   *
   * @remarks
   * Server errors (5xx) and network errors (no status) may succeed
   * on retry if the issue is transient.
   *
   * @returns true if the error may be worth retrying
   */
  get isRetryable(): boolean {
    return !this.isClientError
  }
}

/**
 * Creates the default refresh metrics object.
 *
 * @returns A new RefreshMetrics object with all counts at zero
 * @internal
 */
function createInitialMetrics(): RefreshMetrics {
  return {
    successCount: 0,
    failureCount: 0,
    lastRefreshAt: undefined,
    lastFailureAt: undefined,
    totalRetryAttempts: 0,
  }
}

/**
 * Calculates a random jitter value.
 *
 * @param maxJitterMs - Maximum jitter in milliseconds
 * @returns Random value between 0 and maxJitterMs
 * @internal
 */
function calculateJitter(maxJitterMs: number): number {
  if (maxJitterMs <= 0) {
    return 0
  }
  return Math.floor(Math.random() * maxJitterMs)
}

/**
 * Manages automatic token refresh for authenticated API connections.
 *
 * @remarks
 * The TokenRefreshManager handles:
 * - Scheduling refresh operations before token expiry
 * - Calling the refresh endpoint with proper authentication
 * - Retrying failed refresh attempts with exponential backoff
 * - Adding jitter to prevent thundering herd problems
 * - Preventing concurrent refresh operations
 * - Notifying the application of new tokens or errors
 * - Tracking refresh metrics for monitoring
 *
 * @example
 * Basic usage with automatic refresh:
 * ```typescript
 * const manager = new TokenRefreshManager({
 *   refreshUrl: 'https://api.mongo.do/auth/refresh',
 *   onRefresh: (token) => {
 *     // Store the new token
 *     localStorage.setItem('token', JSON.stringify(token))
 *   },
 *   onError: (error) => {
 *     // Handle refresh failure - user may need to re-login
 *     console.error('Token refresh failed:', error)
 *     redirectToLogin()
 *   },
 * })
 *
 * // Start automatic refresh based on current token
 * manager.scheduleRefresh({
 *   accessToken: currentToken,
 *   expiresAt: tokenExpiresAt,
 * })
 *
 * // Clean up when done
 * manager.destroy()
 * ```
 *
 * @example
 * Manual refresh with error handling:
 * ```typescript
 * try {
 *   const newToken = await manager.refresh(currentAccessToken, refreshToken)
 *   // Use newToken.accessToken for subsequent requests
 * } catch (error) {
 *   if (error instanceof TokenRefreshError && error.isClientError) {
 *     // Invalid credentials - need to re-authenticate
 *     redirectToLogin()
 *   } else {
 *     // Transient error - may retry
 *     console.error('Refresh failed:', error)
 *   }
 * }
 * ```
 *
 * @example
 * With lifecycle hooks and metrics:
 * ```typescript
 * const manager = new TokenRefreshManager({
 *   refreshUrl: 'https://api.mongo.do/auth/refresh',
 *   jitterMs: 5000,
 *   beforeRefresh: async (ctx) => {
 *     console.log(`Starting refresh attempt ${ctx.attemptNumber}`)
 *   },
 *   afterRefresh: async (ctx) => {
 *     console.log(`Refresh completed in ${ctx.durationMs}ms`)
 *     analytics.track('token_refreshed', { duration: ctx.durationMs })
 *   },
 *   onRefresh: (token) => storeToken(token),
 * })
 *
 * // Monitor refresh health
 * setInterval(() => {
 *   const metrics = manager.getMetrics()
 *   console.log('Refresh stats:', metrics)
 * }, 60000)
 * ```
 */
export class TokenRefreshManager {
  /**
   * Resolved configuration with defaults applied.
   * @internal
   */
  private config: Required<
    Pick<
      TokenRefreshConfig,
      | 'refreshUrl'
      | 'refreshBeforeExpiry'
      | 'maxRetries'
      | 'initialRetryDelay'
      | 'maxRetryDelay'
      | 'backoffMultiplier'
      | 'jitterMs'
    >
  > &
    Pick<TokenRefreshConfig, 'onRefresh' | 'onError' | 'buildRefreshRequest' | 'beforeRefresh' | 'afterRefresh'>

  /**
   * Timer ID for the scheduled refresh.
   * @internal
   */
  private refreshTimer?: ReturnType<typeof setTimeout>

  /**
   * The current access token to use for refresh.
   * @internal
   */
  private currentToken?: string

  /**
   * Flag indicating if a refresh is in progress.
   * @internal
   */
  private isRefreshing = false

  /**
   * Promise for the current refresh operation, used to dedupe concurrent requests.
   * @internal
   */
  private pendingRefresh?: Promise<TokenResponse>

  /**
   * AbortController for cancelling in-flight requests.
   * @internal
   */
  private abortController?: AbortController

  /**
   * Metrics tracking refresh success/failure.
   * @internal
   */
  private metrics: RefreshMetrics = createInitialMetrics()

  /**
   * Creates a new TokenRefreshManager.
   *
   * @param config - Configuration options for the manager
   *
   * @example
   * ```typescript
   * const manager = new TokenRefreshManager({
   *   refreshUrl: 'https://api.mongo.do/auth/refresh',
   *   refreshBeforeExpiry: 300000, // 5 minutes
   *   maxRetries: 5,
   *   jitterMs: 10000, // Up to 10 seconds of jitter
   *   onRefresh: (token) => updateToken(token),
   *   onError: (error) => handleError(error),
   * })
   * ```
   */
  constructor(config: TokenRefreshConfig) {
    this.config = {
      refreshUrl: config.refreshUrl,
      refreshBeforeExpiry: config.refreshBeforeExpiry ?? 60000,
      maxRetries: config.maxRetries ?? 3,
      initialRetryDelay: config.initialRetryDelay ?? 1000,
      maxRetryDelay: config.maxRetryDelay ?? 30000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      jitterMs: config.jitterMs ?? 0,
      onRefresh: config.onRefresh,
      onError: config.onError,
      buildRefreshRequest: config.buildRefreshRequest,
      beforeRefresh: config.beforeRefresh,
      afterRefresh: config.afterRefresh,
    }
  }

  /**
   * Schedule a token refresh before the token expires.
   *
   * @remarks
   * The refresh will be scheduled to occur `refreshBeforeExpiry` milliseconds
   * before the token's expiration time, plus any configured jitter.
   *
   * If the token is already expired or will expire within the buffer time,
   * the refresh will be triggered immediately (with minimal delay for jitter).
   *
   * Calling this method cancels any previously scheduled refresh.
   *
   * @param token - Token information including expiry time
   *
   * @example
   * ```typescript
   * // Schedule based on absolute expiry time
   * manager.scheduleRefresh({
   *   accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
   *   expiresAt: Date.now() + 3600000, // 1 hour from now
   * })
   *
   * // Schedule based on relative expiry time
   * manager.scheduleRefresh({
   *   accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
   *   expiresIn: 3600, // 1 hour in seconds
   * })
   * ```
   */
  scheduleRefresh(token: TokenInfo): void {
    this.cancel()
    this.currentToken = token.accessToken

    // Calculate when the token expires
    const expiresAt = token.expiresAt ?? Date.now() + (token.expiresIn ?? 3600) * 1000

    // Calculate when to refresh (before expiry)
    const refreshTime = expiresAt - this.config.refreshBeforeExpiry

    // Add jitter to prevent thundering herd
    const jitter = calculateJitter(this.config.jitterMs)

    // Calculate delay from now (minimum 0 to trigger immediately if expired)
    const delay = Math.max(0, refreshTime - Date.now() + jitter)

    this.refreshTimer = setTimeout(() => {
      this.performScheduledRefresh()
    }, delay)
  }

  /**
   * Manually trigger a token refresh.
   *
   * @remarks
   * This method can be used to force a refresh outside of the scheduled
   * refresh cycle. It respects the concurrent refresh prevention - if a
   * refresh is already in progress, it returns the same promise.
   *
   * Unlike scheduled refreshes, manual refreshes do not retry automatically.
   * Handle the error and retry manually if needed.
   *
   * @param accessToken - The current access token
   * @param refreshToken - Optional refresh token
   * @returns Promise resolving to the new token response
   * @throws {TokenRefreshError} If the refresh request fails
   *
   * @example
   * ```typescript
   * try {
   *   const newToken = await manager.refresh(
   *     currentAccessToken,
   *     storedRefreshToken
   *   )
   *   console.log('New token expires at:', newToken.expiresAt)
   * } catch (error) {
   *   console.error('Refresh failed:', error)
   * }
   * ```
   */
  async refresh(accessToken: string, refreshToken?: string): Promise<TokenResponse> {
    // Prevent concurrent refresh attempts - return the pending promise
    if (this.isRefreshing && this.pendingRefresh) {
      return this.pendingRefresh
    }

    this.isRefreshing = true

    // Create new AbortController for this refresh
    this.abortController = new AbortController()

    this.pendingRefresh = this.doRefresh(accessToken, refreshToken, this.abortController.signal, 0)

    try {
      const result = await this.pendingRefresh

      // Update metrics
      this.metrics.successCount++
      this.metrics.lastRefreshAt = Date.now()

      // Call the onRefresh callback for manual refresh too
      if (this.config.onRefresh) {
        await Promise.resolve(this.config.onRefresh(result))
      }

      return result
    } finally {
      this.isRefreshing = false
      this.pendingRefresh = undefined
      this.cleanupAbortController()
    }
  }

  /**
   * Cancel any scheduled refresh operation.
   *
   * @remarks
   * This stops the scheduled refresh timer and aborts any in-flight
   * refresh request. It does not affect the ability to schedule
   * future refreshes.
   *
   * Safe to call multiple times or when no refresh is scheduled.
   *
   * @example
   * ```typescript
   * // Cancel scheduled refresh when navigating away
   * window.addEventListener('beforeunload', () => {
   *   manager.cancel()
   * })
   * ```
   */
  cancel(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }

    // Abort any in-flight request
    if (this.abortController) {
      this.abortController.abort()
      this.cleanupAbortController()
    }
  }

  /**
   * Destroy the manager and clean up all resources.
   *
   * @remarks
   * Call this when the manager is no longer needed to prevent memory leaks.
   * After destruction, the manager should not be used again.
   *
   * This method:
   * - Cancels any scheduled refresh
   * - Aborts any in-flight request
   * - Clears all internal state
   *
   * @example
   * ```typescript
   * // Clean up on component unmount
   * useEffect(() => {
   *   const manager = new TokenRefreshManager({ ... })
   *   return () => manager.destroy()
   * }, [])
   * ```
   */
  destroy(): void {
    this.cancel()
    this.currentToken = undefined
    this.isRefreshing = false
    this.pendingRefresh = undefined
  }

  /**
   * Check if a refresh is currently scheduled.
   *
   * @remarks
   * Returns true if there is a pending scheduled refresh, false if
   * no refresh is scheduled or the manager has been cancelled/destroyed.
   *
   * Note: This does not indicate if a refresh is currently in progress,
   * only if one is scheduled for the future.
   *
   * @returns true if a refresh is scheduled, false otherwise
   *
   * @example
   * ```typescript
   * if (!manager.isScheduled()) {
   *   console.log('No refresh scheduled - token may have been cleared')
   * }
   * ```
   */
  isScheduled(): boolean {
    return this.refreshTimer !== undefined
  }

  /**
   * Get current refresh metrics.
   *
   * @remarks
   * Returns a snapshot of the current refresh metrics. Use these
   * metrics for monitoring and alerting on token refresh health.
   *
   * @returns A copy of the current metrics
   *
   * @example
   * ```typescript
   * const metrics = manager.getMetrics()
   * console.log(`Success rate: ${metrics.successCount}/${metrics.successCount + metrics.failureCount}`)
   *
   * if (metrics.failureCount > 5) {
   *   alertOps('High token refresh failure rate')
   * }
   * ```
   */
  getMetrics(): RefreshMetrics {
    return { ...this.metrics }
  }

  /**
   * Reset refresh metrics to initial values.
   *
   * @remarks
   * Use this to reset metrics after a significant event, such as
   * a new user login or at the start of a monitoring period.
   *
   * @example
   * ```typescript
   * // Reset metrics after user login
   * manager.resetMetrics()
   * ```
   */
  resetMetrics(): void {
    this.metrics = createInitialMetrics()
  }

  /**
   * Clean up the AbortController after use.
   * @internal
   */
  private cleanupAbortController(): void {
    this.abortController = undefined
  }

  /**
   * Build the default refresh request.
   *
   * @param options - Request options
   * @returns Request configuration
   * @internal
   */
  private buildDefaultRefreshRequest(options: RefreshRequestOptions): RefreshRequestConfig {
    const body: Record<string, string> = {}
    if (options.refreshToken) {
      body.refreshToken = options.refreshToken
    }

    return {
      url: options.refreshUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.accessToken}`,
      },
      body: JSON.stringify(body),
    }
  }

  /**
   * Perform the actual token refresh request.
   *
   * @param accessToken - Current access token
   * @param refreshToken - Optional refresh token
   * @param signal - Abort signal for cancellation
   * @param attemptNumber - Current attempt number (0-based)
   * @returns Promise resolving to the new token
   * @throws {TokenRefreshError} If the request fails
   * @internal
   */
  private async doRefresh(
    accessToken: string,
    refreshToken?: string,
    signal?: AbortSignal,
    attemptNumber: number = 0
  ): Promise<TokenResponse> {
    const startTime = Date.now()
    const isRetry = attemptNumber > 0

    // Create hook context
    const hookContext: RefreshHookContext = {
      accessToken,
      refreshToken,
      isRetry,
      attemptNumber,
      signal: signal ?? new AbortController().signal,
    }

    // Call beforeRefresh hook
    if (this.config.beforeRefresh) {
      await Promise.resolve(this.config.beforeRefresh(hookContext))
    }

    // Build the request (use custom builder if provided)
    const requestOptions: RefreshRequestOptions = {
      accessToken,
      refreshToken,
      refreshUrl: this.config.refreshUrl,
    }

    const requestConfig = this.config.buildRefreshRequest
      ? this.config.buildRefreshRequest(requestOptions)
      : this.buildDefaultRefreshRequest(requestOptions)

    const response = await fetch(requestConfig.url, {
      method: requestConfig.method ?? 'POST',
      headers: requestConfig.headers,
      body: requestConfig.body,
      signal,
    })

    if (!response.ok) {
      throw new TokenRefreshError(
        `Token refresh failed: ${response.statusText}`,
        response.status,
        response.statusText
      )
    }

    const data = (await response.json()) as {
      accessToken: string
      expiresAt?: number
      expiresIn?: number
      refreshToken?: string
    }

    // Normalize the response - convert expiresIn to expiresAt if needed
    const result: TokenResponse = {
      accessToken: data.accessToken,
      expiresAt: data.expiresAt,
      expiresIn: data.expiresIn,
      refreshToken: data.refreshToken,
    }

    // If we have expiresIn but not expiresAt, calculate expiresAt
    if (result.expiresIn !== undefined && result.expiresAt === undefined) {
      result.expiresAt = Date.now() + result.expiresIn * 1000
    }

    // Call afterRefresh hook
    if (this.config.afterRefresh) {
      const afterContext: AfterRefreshHookContext = {
        ...hookContext,
        newToken: result,
        durationMs: Date.now() - startTime,
      }
      await Promise.resolve(this.config.afterRefresh(afterContext))
    }

    return result
  }

  /**
   * Perform a scheduled refresh with retry logic.
   *
   * @remarks
   * This method implements the full retry logic with exponential backoff
   * and jitter. It tracks metrics and calls the appropriate callbacks.
   *
   * @internal
   */
  private async performScheduledRefresh(): Promise<void> {
    if (!this.currentToken) {
      return
    }

    // Clear the timer reference since we're executing now
    this.refreshTimer = undefined

    let lastError: Error | undefined
    let attemptCount = 0
    let currentDelay = this.config.initialRetryDelay
    const maxAttempts = this.config.maxRetries + 1 // initial attempt + retries

    while (attemptCount < maxAttempts) {
      try {
        // Prevent concurrent refresh attempts
        if (this.isRefreshing && this.pendingRefresh) {
          await this.pendingRefresh
          return
        }

        this.isRefreshing = true

        // Create new AbortController for this attempt
        this.abortController = new AbortController()

        this.pendingRefresh = this.doRefresh(
          this.currentToken,
          undefined,
          this.abortController.signal,
          attemptCount
        )

        const result = await this.pendingRefresh

        this.isRefreshing = false
        this.pendingRefresh = undefined
        this.cleanupAbortController()

        // Update metrics on success
        this.metrics.successCount++
        this.metrics.lastRefreshAt = Date.now()

        // Success - call the callback
        if (this.config.onRefresh) {
          await Promise.resolve(this.config.onRefresh(result))
        }

        return
      } catch (error) {
        this.isRefreshing = false
        this.pendingRefresh = undefined
        this.cleanupAbortController()

        lastError = error instanceof Error ? error : new Error(String(error))

        // Don't retry on client errors (4xx) or abort
        if (error instanceof TokenRefreshError && error.isClientError) {
          break
        }

        // Check if aborted
        if (error instanceof Error && error.name === 'AbortError') {
          break
        }

        attemptCount++

        // Track retry attempts
        if (attemptCount > 1) {
          this.metrics.totalRetryAttempts++
        }

        // If we haven't exhausted attempts, wait and try again
        if (attemptCount < maxAttempts) {
          // Add jitter to retry delay
          const jitter = calculateJitter(Math.min(this.config.jitterMs, currentDelay / 2))
          await this.delay(currentDelay + jitter)

          currentDelay = Math.min(currentDelay * this.config.backoffMultiplier, this.config.maxRetryDelay)
        }
      }
    }

    // Update failure metrics
    this.metrics.failureCount++
    this.metrics.lastFailureAt = Date.now()

    // All retries exhausted - call error callback
    if (this.config.onError && lastError) {
      this.config.onError(lastError)
    }
  }

  /**
   * Delay for a specified number of milliseconds.
   *
   * @param ms - Milliseconds to delay
   * @returns Promise that resolves after the delay
   * @internal
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
