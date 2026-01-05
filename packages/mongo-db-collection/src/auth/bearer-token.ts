/**
 * @file Bearer Token Authentication Provider
 *
 * Handles bearer token authentication for the mongo.do API.
 * Supports both static API keys and JWT tokens with automatic refresh.
 *
 * Features:
 * - Token storage and retrieval
 * - Authorization header generation
 * - JWT token expiry detection with configurable buffer
 * - Automatic token refresh scheduling
 * - Token change notifications via callbacks and events
 * - Token introspection helpers
 * - Decoded payload caching for performance
 * - Token validation hooks for custom validation logic
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6750 - Bearer Token Usage
 * @see https://datatracker.ietf.org/doc/html/rfc7519 - JSON Web Tokens
 *
 * @example Basic Usage with Static Token
 * ```typescript
 * import { BearerTokenAuthProvider } from '@tanstack/mongo-db-collection'
 *
 * const auth = new BearerTokenAuthProvider('my-api-key-12345')
 *
 * // Use in fetch requests
 * const response = await fetch('https://api.mongo.do/v1/data', {
 *   headers: {
 *     Authorization: auth.getAuthHeader(),
 *   },
 * })
 * ```
 *
 * @example JWT Token with Auto-Refresh
 * ```typescript
 * import { BearerTokenAuthProvider } from '@tanstack/mongo-db-collection'
 *
 * const auth = new BearerTokenAuthProvider(jwtToken, {
 *   refreshEndpoint: 'https://api.mongo.do/auth/refresh',
 *   refreshToken: 'my-refresh-token',
 *   expiryBufferSeconds: 300, // Refresh 5 minutes before expiry
 *   onTokenChange: (newToken) => {
 *     // Persist new token to storage
 *     localStorage.setItem('accessToken', newToken)
 *   },
 * })
 *
 * // Start automatic refresh
 * auth.startAutoRefresh()
 *
 * // Later, clean up when done
 * auth.stopAutoRefresh()
 * auth.dispose()
 * ```
 *
 * @example Event-Based Token Lifecycle Monitoring
 * ```typescript
 * const auth = new BearerTokenAuthProvider(jwtToken, {
 *   refreshEndpoint: 'https://api.mongo.do/auth/refresh',
 * })
 *
 * // Listen for token lifecycle events
 * auth.on('tokenRefreshed', ({ oldToken, newToken }) => {
 *   console.log('Token refreshed successfully')
 * })
 *
 * auth.on('tokenExpiring', ({ expiresIn }) => {
 *   console.log(`Token expires in ${expiresIn} seconds`)
 * })
 *
 * auth.on('refreshFailed', ({ error }) => {
 *   console.error('Token refresh failed:', error)
 * })
 * ```
 *
 * @example Custom Token Validation Hook
 * ```typescript
 * const auth = new BearerTokenAuthProvider(jwtToken, {
 *   refreshEndpoint: 'https://api.mongo.do/auth/refresh',
 *   validationHook: async (token, payload) => {
 *     // Custom validation logic
 *     if (payload?.scope !== 'read:data') {
 *       return { valid: false, reason: 'Insufficient scope' }
 *     }
 *     return { valid: true }
 *   },
 * })
 *
 * const validation = await auth.validate()
 * if (!validation.valid) {
 *   console.error('Token invalid:', validation.reason)
 * }
 * ```
 */

/**
 * Token lifecycle event types for the event emitter.
 *
 * @example Listening to Events
 * ```typescript
 * auth.on('tokenRefreshed', (event) => {
 *   console.log('New token:', event.newToken)
 * })
 * ```
 */
export type TokenEventType =
  | 'tokenRefreshed'
  | 'tokenExpiring'
  | 'tokenExpired'
  | 'refreshStarted'
  | 'refreshFailed'
  | 'disposed'

/**
 * Event data for the 'tokenRefreshed' event.
 * Emitted when a token has been successfully refreshed.
 */
export interface TokenRefreshedEvent {
  /** The previous token that was replaced */
  oldToken: string
  /** The new token received from refresh */
  newToken: string
  /** Timestamp when the refresh occurred */
  timestamp: number
}

/**
 * Event data for the 'tokenExpiring' event.
 * Emitted when a token is about to expire (within the buffer period).
 */
export interface TokenExpiringEvent {
  /** Seconds until the token expires */
  expiresIn: number
  /** Whether auto-refresh is enabled */
  willAutoRefresh: boolean
}

/**
 * Event data for the 'tokenExpired' event.
 * Emitted when a token has expired.
 */
export interface TokenExpiredEvent {
  /** Timestamp when the token expired */
  expiredAt: number
}

/**
 * Event data for the 'refreshStarted' event.
 * Emitted when a token refresh operation begins.
 */
export interface RefreshStartedEvent {
  /** Whether this was triggered automatically */
  isAutoRefresh: boolean
}

/**
 * Event data for the 'refreshFailed' event.
 * Emitted when a token refresh operation fails.
 */
export interface RefreshFailedEvent {
  /** The error that caused the failure */
  error: Error
  /** Whether this was an auto-refresh attempt */
  isAutoRefresh: boolean
  /** Number of retry attempts remaining (if retry is configured) */
  retriesRemaining?: number
}

/**
 * Event data for the 'disposed' event.
 * Emitted when the provider is disposed.
 */
export interface DisposedEvent {
  /** Timestamp when disposal occurred */
  timestamp: number
}

/**
 * Map of event types to their corresponding event data types.
 */
export interface TokenEventMap {
  tokenRefreshed: TokenRefreshedEvent
  tokenExpiring: TokenExpiringEvent
  tokenExpired: TokenExpiredEvent
  refreshStarted: RefreshStartedEvent
  refreshFailed: RefreshFailedEvent
  disposed: DisposedEvent
}

/**
 * Event listener function type.
 *
 * @typeParam T - The event type from TokenEventType
 */
export type TokenEventListener<T extends TokenEventType> = (
  event: TokenEventMap[T]
) => void

/**
 * Result of token validation, either from built-in checks or custom hooks.
 *
 * @example
 * ```typescript
 * const result = await auth.validate()
 * if (!result.valid) {
 *   console.error('Validation failed:', result.reason)
 * }
 * ```
 */
export interface TokenValidationResult {
  /** Whether the token passed validation */
  valid: boolean
  /** Reason for validation failure (only present if valid is false) */
  reason?: string
  /** Additional metadata from validation */
  metadata?: Record<string, unknown>
}

/**
 * Custom validation hook function type.
 * Called during token validation to perform custom checks.
 *
 * @param token - The current token string
 * @param payload - The decoded JWT payload (null for non-JWT tokens)
 * @returns Validation result, either sync or async
 *
 * @example
 * ```typescript
 * const validateScope: TokenValidationHook = async (token, payload) => {
 *   if (!payload?.scope?.includes('read:data')) {
 *     return { valid: false, reason: 'Missing required scope' }
 *   }
 *   return { valid: true }
 * }
 * ```
 */
export type TokenValidationHook = (
  token: string,
  payload: Record<string, unknown> | null
) => TokenValidationResult | Promise<TokenValidationResult>

/**
 * Token introspection information.
 * Provides detailed information about the current token.
 *
 * @example
 * ```typescript
 * const info = auth.introspect()
 * console.log('Token type:', info.type)
 * console.log('Expires at:', info.expiresAt)
 * console.log('Claims:', info.claims)
 * ```
 */
export interface TokenIntrospection {
  /** Type of token: 'jwt' or 'static' */
  type: 'jwt' | 'static'
  /** Whether the token is currently valid */
  isValid: boolean
  /** Expiration timestamp in milliseconds (null for static tokens) */
  expiresAt: number | null
  /** Seconds until expiration (null for static tokens, negative if expired) */
  expiresIn: number | null
  /** Whether the token is within the expiry buffer */
  isExpiring: boolean
  /** Whether the token has expired */
  isExpired: boolean
  /** Decoded JWT claims (null for static tokens) */
  claims: Record<string, unknown> | null
  /** Token subject from 'sub' claim */
  subject: string | null
  /** Token issuer from 'iss' claim */
  issuer: string | null
  /** Token audience from 'aud' claim */
  audience: string | string[] | null
  /** Token issued-at timestamp from 'iat' claim */
  issuedAt: number | null
  /** Token scopes (if present in claims) */
  scopes: string[] | null
}

/**
 * Configuration options for the BearerTokenAuthProvider.
 *
 * @example Minimal Configuration
 * ```typescript
 * const config: BearerTokenConfig = {
 *   refreshEndpoint: 'https://api.mongo.do/auth/refresh',
 * }
 * ```
 *
 * @example Full Configuration
 * ```typescript
 * const config: BearerTokenConfig = {
 *   refreshEndpoint: 'https://api.mongo.do/auth/refresh',
 *   refreshToken: 'refresh-token-xyz',
 *   expiryBufferSeconds: 300,
 *   autoRefresh: true,
 *   onTokenChange: (token) => console.log('Token changed'),
 *   refreshResponseParser: (data) => data.access_token,
 *   validationHook: async (token, payload) => ({ valid: true }),
 *   enablePayloadCache: true,
 * }
 * ```
 */
export interface BearerTokenConfig {
  /**
   * Endpoint URL for token refresh.
   * Required for refresh() and auto-refresh functionality.
   *
   * @example
   * ```typescript
   * refreshEndpoint: 'https://api.mongo.do/auth/refresh'
   * ```
   */
  refreshEndpoint?: string

  /**
   * Refresh token to send in the request body.
   * Used alongside the access token for refresh requests.
   *
   * @example
   * ```typescript
   * refreshToken: 'rt_abc123xyz'
   * ```
   */
  refreshToken?: string

  /**
   * Seconds before expiry to consider token invalid.
   * Used for proactive refresh before actual expiration.
   *
   * @default 60
   *
   * @example
   * ```typescript
   * // Refresh 5 minutes before expiry
   * expiryBufferSeconds: 300
   * ```
   */
  expiryBufferSeconds?: number

  /**
   * Callback invoked when token changes after refresh.
   * Useful for persisting new tokens to storage.
   *
   * @param token - The new token value
   *
   * @example
   * ```typescript
   * onTokenChange: (token) => {
   *   localStorage.setItem('accessToken', token)
   * }
   * ```
   */
  onTokenChange?: (token: string) => void

  /**
   * Enable automatic token refresh before expiry.
   * When true, call startAutoRefresh() to begin automatic refresh.
   *
   * @default false
   *
   * @example
   * ```typescript
   * autoRefresh: true
   * ```
   */
  autoRefresh?: boolean

  /**
   * Custom parser for refresh response.
   * Use when the refresh endpoint returns a non-standard response format.
   *
   * @param data - The parsed JSON response from the refresh endpoint
   * @returns The new token string
   *
   * @default Expects { token: string }
   *
   * @example
   * ```typescript
   * // For OAuth2-style responses
   * refreshResponseParser: (data) => data.access_token
   * ```
   */
  refreshResponseParser?: (data: unknown) => string

  /**
   * Custom validation hook for additional token validation logic.
   * Called during validate() to perform custom checks.
   *
   * @example
   * ```typescript
   * validationHook: async (token, payload) => {
   *   // Check custom claims
   *   if (payload?.tenant !== 'my-tenant') {
   *     return { valid: false, reason: 'Invalid tenant' }
   *   }
   *   return { valid: true }
   * }
   * ```
   */
  validationHook?: TokenValidationHook

  /**
   * Enable caching of decoded JWT payloads.
   * Improves performance when payload is accessed frequently.
   *
   * @default true
   *
   * @example
   * ```typescript
   * enablePayloadCache: true
   * ```
   */
  enablePayloadCache?: boolean

  /**
   * Default headers to include with getAuthHeaders().
   * These headers are merged with the Authorization header.
   *
   * @example
   * ```typescript
   * defaultHeaders: {
   *   'X-API-Version': 'v1',
   *   'X-Client-ID': 'my-client',
   * }
   * ```
   */
  defaultHeaders?: Record<string, string>
}

/**
 * Internal cache entry for decoded JWT payloads.
 */
interface PayloadCacheEntry {
  /** The token this payload was decoded from */
  token: string
  /** The decoded payload */
  payload: Record<string, unknown> | null
  /** Timestamp when this entry was cached */
  cachedAt: number
}

/**
 * Bearer Token Authentication Provider
 *
 * Manages bearer token authentication including:
 * - Token storage and retrieval
 * - Authorization header generation
 * - JWT token expiry detection
 * - Automatic token refresh
 * - Token change notifications
 * - Event-based lifecycle monitoring
 * - Token introspection and validation
 *
 * @example Basic Usage
 * ```typescript
 * // Static API key
 * const auth = new BearerTokenAuthProvider('my-api-key')
 * const header = auth.getAuthHeader() // "Bearer my-api-key"
 *
 * // JWT token with refresh
 * const auth = new BearerTokenAuthProvider(jwtToken, {
 *   refreshEndpoint: 'https://api.example.com/refresh',
 * })
 *
 * if (!auth.isValid()) {
 *   await auth.refresh()
 * }
 * ```
 *
 * @example With Event Listeners
 * ```typescript
 * const auth = new BearerTokenAuthProvider(token, config)
 *
 * auth.on('tokenRefreshed', ({ newToken }) => {
 *   console.log('Got new token:', newToken)
 * })
 *
 * auth.on('refreshFailed', ({ error }) => {
 *   console.error('Refresh failed:', error)
 * })
 *
 * auth.startAutoRefresh()
 * ```
 *
 * @example Token Introspection
 * ```typescript
 * const auth = new BearerTokenAuthProvider(jwtToken)
 * const info = auth.introspect()
 *
 * console.log('Token type:', info.type)
 * console.log('Subject:', info.subject)
 * console.log('Expires in:', info.expiresIn, 'seconds')
 * console.log('Scopes:', info.scopes)
 * ```
 */
export class BearerTokenAuthProvider {
  /**
   * Current bearer token.
   * Updated automatically after successful refresh operations.
   *
   * @example
   * ```typescript
   * const auth = new BearerTokenAuthProvider('my-token')
   * console.log(auth.token) // "my-token"
   *
   * await auth.refresh()
   * console.log(auth.token) // New token from refresh
   * ```
   */
  public token: string

  private config: BearerTokenConfig
  private refreshTimer?: ReturnType<typeof setTimeout>
  private expiryCheckTimer?: ReturnType<typeof setTimeout>
  private disposed = false

  // Event emitter storage
  private eventListeners: Map<TokenEventType, Set<TokenEventListener<TokenEventType>>> =
    new Map()

  // Payload cache for performance
  private payloadCache: PayloadCacheEntry | null = null

  /**
   * Creates a new BearerTokenAuthProvider.
   *
   * @param token - The bearer token (string or JWT)
   * @param config - Optional configuration for refresh and callbacks
   * @throws Error if token is empty, null, or undefined
   *
   * @example Static Token
   * ```typescript
   * const auth = new BearerTokenAuthProvider('api-key-12345')
   * ```
   *
   * @example JWT with Refresh Configuration
   * ```typescript
   * const auth = new BearerTokenAuthProvider(jwtToken, {
   *   refreshEndpoint: 'https://api.example.com/auth/refresh',
   *   refreshToken: 'refresh-token-xyz',
   *   expiryBufferSeconds: 300,
   *   onTokenChange: (newToken) => {
   *     localStorage.setItem('token', newToken)
   *   },
   * })
   * ```
   *
   * @example With Custom Response Parser
   * ```typescript
   * const auth = new BearerTokenAuthProvider(jwtToken, {
   *   refreshEndpoint: 'https://oauth.example.com/token',
   *   refreshResponseParser: (response) => response.access_token,
   * })
   * ```
   */
  constructor(token: string, config: BearerTokenConfig = {}) {
    if (!token) {
      throw new Error('Token cannot be empty')
    }

    this.token = token
    this.config = {
      enablePayloadCache: true,
      ...config,
    }
  }

  /**
   * Returns the Authorization header value.
   * Formats the token as a standard Bearer authentication header.
   *
   * @returns The bearer token formatted as "Bearer {token}"
   *
   * @example
   * ```typescript
   * const auth = new BearerTokenAuthProvider('my-token')
   * const header = auth.getAuthHeader()
   * // Returns: "Bearer my-token"
   *
   * // Use in fetch
   * fetch('/api/data', {
   *   headers: {
   *     Authorization: auth.getAuthHeader(),
   *   },
   * })
   * ```
   */
  getAuthHeader(): string {
    return `Bearer ${this.token}`
  }

  /**
   * Checks if the current token is valid.
   *
   * For JWT tokens, validates against expiry time with buffer.
   * Static tokens (non-JWT or JWT without exp claim) are always considered valid.
   *
   * Note: This performs basic expiry validation only. For custom validation
   * logic, use the validate() method with a validationHook.
   *
   * @returns true if token is valid, false if expired or expiring within buffer
   *
   * @example
   * ```typescript
   * const auth = new BearerTokenAuthProvider(jwtToken, {
   *   expiryBufferSeconds: 60,
   * })
   *
   * if (!auth.isValid()) {
   *   await auth.refresh()
   * }
   *
   * // Static tokens are always valid
   * const staticAuth = new BearerTokenAuthProvider('api-key')
   * staticAuth.isValid() // Always true
   * ```
   */
  isValid(): boolean {
    const payload = this.getTokenPayload()

    // Static token or JWT without exp claim - always valid
    if (!payload?.exp) {
      return true
    }

    const buffer = this.config.expiryBufferSeconds ?? 60
    const expiryMs = (payload.exp as number) * 1000
    const bufferMs = buffer * 1000

    return expiryMs > Date.now() + bufferMs
  }

  /**
   * Performs comprehensive token validation.
   *
   * Runs both built-in expiry checks and any custom validation hook.
   * Use this method when you need to perform custom validation logic
   * beyond simple expiry checking.
   *
   * @returns Validation result with valid status and optional reason
   *
   * @example Basic Validation
   * ```typescript
   * const result = await auth.validate()
   * if (!result.valid) {
   *   console.error('Token invalid:', result.reason)
   *   await auth.refresh()
   * }
   * ```
   *
   * @example With Custom Validation Hook
   * ```typescript
   * const auth = new BearerTokenAuthProvider(token, {
   *   validationHook: async (token, payload) => {
   *     // Validate against external service
   *     const isRevoked = await checkTokenRevocation(token)
   *     if (isRevoked) {
   *       return { valid: false, reason: 'Token has been revoked' }
   *     }
   *     return { valid: true }
   *   },
   * })
   *
   * const result = await auth.validate()
   * ```
   */
  async validate(): Promise<TokenValidationResult> {
    // Check built-in expiry validation first
    if (!this.isValid()) {
      return {
        valid: false,
        reason: 'Token has expired or is expiring within buffer period',
      }
    }

    // Run custom validation hook if provided
    if (this.config.validationHook) {
      const payload = this.getTokenPayload()
      try {
        const hookResult = await this.config.validationHook(this.token, payload)
        return hookResult
      } catch (error) {
        return {
          valid: false,
          reason: `Validation hook error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        }
      }
    }

    return { valid: true }
  }

  /**
   * Refreshes the token using the configured refresh endpoint.
   *
   * Sends a POST request to the refresh endpoint with the current token
   * in the Authorization header and optional refresh token in the body.
   *
   * @throws Error if refresh endpoint is not configured
   * @throws Error if refresh request fails
   * @throws Error if response doesn't contain a token
   *
   * @example Manual Refresh
   * ```typescript
   * const auth = new BearerTokenAuthProvider(token, {
   *   refreshEndpoint: 'https://api.example.com/auth/refresh',
   * })
   *
   * try {
   *   await auth.refresh()
   *   console.log('Token refreshed:', auth.token)
   * } catch (error) {
   *   console.error('Refresh failed:', error)
   * }
   * ```
   *
   * @example With Refresh Token
   * ```typescript
   * const auth = new BearerTokenAuthProvider(accessToken, {
   *   refreshEndpoint: 'https://api.example.com/auth/refresh',
   *   refreshToken: 'rt_xyz123',
   * })
   *
   * await auth.refresh()
   * // POST body includes { refreshToken: 'rt_xyz123' }
   * ```
   *
   * @example Custom Response Format
   * ```typescript
   * const auth = new BearerTokenAuthProvider(token, {
   *   refreshEndpoint: 'https://oauth.example.com/token',
   *   refreshResponseParser: (data) => data.access_token,
   * })
   *
   * await auth.refresh()
   * // Parses { access_token: '...' } instead of { token: '...' }
   * ```
   */
  async refresh(): Promise<void> {
    if (!this.config.refreshEndpoint) {
      throw new Error('Refresh endpoint not configured')
    }

    // Emit refresh started event
    this.emit('refreshStarted', { isAutoRefresh: false })

    const body: Record<string, string> = {}
    if (this.config.refreshToken) {
      body.refreshToken = this.config.refreshToken
    }

    const response = await fetch(this.config.refreshEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = new Error(`Token refresh failed: ${response.status}`)
      this.emit('refreshFailed', { error, isAutoRefresh: false })
      throw error
    }

    const data = await response.json()

    let newToken: string
    if (this.config.refreshResponseParser) {
      newToken = this.config.refreshResponseParser(data)
    } else {
      newToken = data.token
    }

    if (!newToken) {
      const error = new Error('Refresh response missing token')
      this.emit('refreshFailed', { error, isAutoRefresh: false })
      throw error
    }

    const oldToken = this.token
    this.token = newToken

    // Invalidate payload cache when token changes
    if (oldToken !== newToken) {
      this.invalidatePayloadCache()
    }

    // Notify callback if token actually changed
    if (oldToken !== newToken && this.config.onTokenChange) {
      try {
        this.config.onTokenChange(newToken)
      } catch {
        // Swallow callback errors - token update should succeed regardless
      }
    }

    // Emit token refreshed event
    if (oldToken !== newToken) {
      this.emit('tokenRefreshed', {
        oldToken,
        newToken,
        timestamp: Date.now(),
      })
    }
  }

  /**
   * Decodes and returns the JWT token payload.
   *
   * Uses caching by default for improved performance when the payload
   * is accessed frequently. Cache is automatically invalidated when
   * the token changes.
   *
   * @returns The decoded payload object, or null if not a valid JWT
   *
   * @example
   * ```typescript
   * const auth = new BearerTokenAuthProvider(jwtToken)
   * const payload = auth.getTokenPayload()
   *
   * if (payload) {
   *   console.log('Subject:', payload.sub)
   *   console.log('Expires:', new Date(payload.exp * 1000))
   *   console.log('Custom claim:', payload.customClaim)
   * } else {
   *   console.log('Not a valid JWT')
   * }
   * ```
   *
   * @example Static Token Returns Null
   * ```typescript
   * const auth = new BearerTokenAuthProvider('api-key-12345')
   * const payload = auth.getTokenPayload()
   * // payload is null (not a JWT)
   * ```
   */
  getTokenPayload(): Record<string, unknown> | null {
    // Check cache first if enabled
    if (
      this.config.enablePayloadCache &&
      this.payloadCache &&
      this.payloadCache.token === this.token
    ) {
      return this.payloadCache.payload
    }

    const payload = this.decodeTokenPayload()

    // Cache the result if caching is enabled
    if (this.config.enablePayloadCache) {
      this.payloadCache = {
        token: this.token,
        payload,
        cachedAt: Date.now(),
      }
    }

    return payload
  }

  /**
   * Internal method to decode JWT payload without caching.
   */
  private decodeTokenPayload(): Record<string, unknown> | null {
    try {
      const parts = this.token.split('.')
      if (parts.length !== 3) {
        return null
      }

      const payload = parts[1]
      const decoded = atob(payload)
      return JSON.parse(decoded) as Record<string, unknown>
    } catch {
      return null
    }
  }

  /**
   * Invalidates the payload cache.
   * Called automatically when the token changes.
   */
  private invalidatePayloadCache(): void {
    this.payloadCache = null
  }

  /**
   * Clears the payload cache manually.
   * Use this if you need to force a fresh decode on the next access.
   *
   * @example
   * ```typescript
   * auth.clearPayloadCache()
   * const freshPayload = auth.getTokenPayload()
   * ```
   */
  clearPayloadCache(): void {
    this.invalidatePayloadCache()
  }

  /**
   * Calculates the time remaining until token expiry.
   *
   * @returns Seconds until expiry, negative if expired, or null for static tokens
   *
   * @example
   * ```typescript
   * const auth = new BearerTokenAuthProvider(jwtToken)
   * const secondsRemaining = auth.getTimeUntilExpiry()
   *
   * if (secondsRemaining === null) {
   *   console.log('Static token - no expiry')
   * } else if (secondsRemaining < 0) {
   *   console.log('Token expired', Math.abs(secondsRemaining), 'seconds ago')
   * } else {
   *   console.log('Token expires in', secondsRemaining, 'seconds')
   * }
   * ```
   */
  getTimeUntilExpiry(): number | null {
    const payload = this.getTokenPayload()

    if (!payload?.exp) {
      return null
    }

    const expiryMs = (payload.exp as number) * 1000
    const nowMs = Date.now()

    return (expiryMs - nowMs) / 1000
  }

  /**
   * Returns comprehensive introspection information about the token.
   *
   * Provides detailed information including token type, validity status,
   * expiration details, and decoded claims for JWT tokens.
   *
   * @returns Token introspection data
   *
   * @example
   * ```typescript
   * const auth = new BearerTokenAuthProvider(jwtToken)
   * const info = auth.introspect()
   *
   * console.log('Token type:', info.type)
   * console.log('Is valid:', info.isValid)
   * console.log('Expires at:', info.expiresAt ? new Date(info.expiresAt) : 'Never')
   * console.log('Expires in:', info.expiresIn, 'seconds')
   * console.log('Subject:', info.subject)
   * console.log('Issuer:', info.issuer)
   * console.log('Scopes:', info.scopes?.join(', '))
   * ```
   *
   * @example Check Token Status
   * ```typescript
   * const info = auth.introspect()
   *
   * if (info.isExpired) {
   *   console.log('Token has expired')
   * } else if (info.isExpiring) {
   *   console.log('Token is expiring soon')
   * } else {
   *   console.log('Token is valid')
   * }
   * ```
   */
  introspect(): TokenIntrospection {
    const payload = this.getTokenPayload()
    const isJwt = payload !== null

    if (!isJwt) {
      return {
        type: 'static',
        isValid: true,
        expiresAt: null,
        expiresIn: null,
        isExpiring: false,
        isExpired: false,
        claims: null,
        subject: null,
        issuer: null,
        audience: null,
        issuedAt: null,
        scopes: null,
      }
    }

    const expiresIn = this.getTimeUntilExpiry()
    const buffer = this.config.expiryBufferSeconds ?? 60
    const isExpired = expiresIn !== null && expiresIn < 0
    const isExpiring = expiresIn !== null && expiresIn >= 0 && expiresIn <= buffer

    // Extract common claims
    const exp = payload.exp as number | undefined
    const sub = payload.sub as string | undefined
    const iss = payload.iss as string | undefined
    const aud = payload.aud as string | string[] | undefined
    const iat = payload.iat as number | undefined
    const scope = payload.scope as string | undefined
    const scopes = payload.scopes as string[] | undefined

    // Parse scopes from string or array
    let parsedScopes: string[] | null = null
    if (scopes && Array.isArray(scopes)) {
      parsedScopes = scopes
    } else if (scope && typeof scope === 'string') {
      parsedScopes = scope.split(' ').filter(Boolean)
    }

    return {
      type: 'jwt',
      isValid: this.isValid(),
      expiresAt: exp ? exp * 1000 : null,
      expiresIn,
      isExpiring,
      isExpired,
      claims: payload,
      subject: sub ?? null,
      issuer: iss ?? null,
      audience: aud ?? null,
      issuedAt: iat ? iat * 1000 : null,
      scopes: parsedScopes,
    }
  }

  /**
   * Checks if the token has a specific claim.
   *
   * @param claim - The claim name to check
   * @returns true if the claim exists, false otherwise
   *
   * @example
   * ```typescript
   * if (auth.hasClaim('admin')) {
   *   console.log('User has admin claim')
   * }
   * ```
   */
  hasClaim(claim: string): boolean {
    const payload = this.getTokenPayload()
    return payload !== null && claim in payload
  }

  /**
   * Gets the value of a specific claim.
   *
   * @param claim - The claim name to retrieve
   * @returns The claim value, or undefined if not present
   *
   * @example
   * ```typescript
   * const userId = auth.getClaim('sub')
   * const email = auth.getClaim('email')
   * const roles = auth.getClaim('roles') as string[]
   * ```
   */
  getClaim<T = unknown>(claim: string): T | undefined {
    const payload = this.getTokenPayload()
    return payload?.[claim] as T | undefined
  }

  /**
   * Checks if the token has a specific scope.
   *
   * Scopes can be stored as a space-delimited string in 'scope' claim
   * or as an array in 'scopes' claim.
   *
   * @param scope - The scope to check for
   * @returns true if the scope is present, false otherwise
   *
   * @example
   * ```typescript
   * if (auth.hasScope('read:users')) {
   *   console.log('Can read users')
   * }
   *
   * if (auth.hasScope('write:data') && auth.hasScope('read:data')) {
   *   console.log('Has full data access')
   * }
   * ```
   */
  hasScope(scope: string): boolean {
    const info = this.introspect()
    return info.scopes?.includes(scope) ?? false
  }

  /**
   * Checks if the token is a JWT.
   *
   * @returns true if the token is a valid JWT, false otherwise
   *
   * @example
   * ```typescript
   * if (auth.isJwt()) {
   *   console.log('Token is a JWT')
   *   const payload = auth.getTokenPayload()
   * } else {
   *   console.log('Token is a static API key')
   * }
   * ```
   */
  isJwt(): boolean {
    return this.getTokenPayload() !== null
  }

  /**
   * Starts automatic token refresh before expiry.
   *
   * Schedules refresh to occur when the token enters the expiry buffer zone.
   * Does nothing for static tokens (tokens without expiry).
   *
   * After refresh, automatically reschedules for the next refresh cycle.
   * Call stopAutoRefresh() to cancel automatic refresh.
   *
   * @example
   * ```typescript
   * const auth = new BearerTokenAuthProvider(jwtToken, {
   *   refreshEndpoint: 'https://api.example.com/auth/refresh',
   *   expiryBufferSeconds: 300, // Refresh 5 minutes before expiry
   * })
   *
   * // Start auto-refresh
   * auth.startAutoRefresh()
   *
   * // ... application runs ...
   *
   * // Clean up when done
   * auth.stopAutoRefresh()
   * ```
   */
  startAutoRefresh(): void {
    // Clear any existing timer
    this.stopAutoRefresh()

    const timeUntilExpiry = this.getTimeUntilExpiry()

    // Static token - nothing to refresh
    if (timeUntilExpiry === null) {
      return
    }

    // No refresh endpoint configured
    if (!this.config.refreshEndpoint) {
      return
    }

    const buffer = this.config.expiryBufferSeconds ?? 60
    const refreshInSeconds = timeUntilExpiry - buffer

    // If already within buffer or expired, refresh immediately
    if (refreshInSeconds <= 0) {
      this.performAutoRefresh()
      return
    }

    // Emit expiring event if within 2x buffer
    if (refreshInSeconds <= buffer * 2) {
      this.emit('tokenExpiring', {
        expiresIn: timeUntilExpiry,
        willAutoRefresh: true,
      })
    }

    // Schedule refresh
    this.refreshTimer = setTimeout(() => {
      this.performAutoRefresh()
    }, refreshInSeconds * 1000)
  }

  /**
   * Stops automatic token refresh.
   *
   * Cancels any scheduled refresh operations. Safe to call multiple times
   * or when no auto-refresh is active.
   *
   * @example
   * ```typescript
   * auth.startAutoRefresh()
   *
   * // Later...
   * auth.stopAutoRefresh()
   * ```
   */
  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }
  }

  /**
   * Internal method to perform auto-refresh and reschedule.
   */
  private async performAutoRefresh(): Promise<void> {
    // Emit refresh started event for auto-refresh
    this.emit('refreshStarted', { isAutoRefresh: true })

    try {
      // Temporarily remove the event emission from refresh() to avoid duplicates
      if (!this.config.refreshEndpoint) {
        throw new Error('Refresh endpoint not configured')
      }

      const body: Record<string, string> = {}
      if (this.config.refreshToken) {
        body.refreshToken = this.config.refreshToken
      }

      const response = await fetch(this.config.refreshEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`)
      }

      const data = await response.json()

      let newToken: string
      if (this.config.refreshResponseParser) {
        newToken = this.config.refreshResponseParser(data)
      } else {
        newToken = data.token
      }

      if (!newToken) {
        throw new Error('Refresh response missing token')
      }

      const oldToken = this.token
      this.token = newToken

      // Invalidate payload cache when token changes
      if (oldToken !== newToken) {
        this.invalidatePayloadCache()
      }

      // Notify callback if token actually changed
      if (oldToken !== newToken && this.config.onTokenChange) {
        try {
          this.config.onTokenChange(newToken)
        } catch {
          // Swallow callback errors
        }
      }

      // Emit token refreshed event
      if (oldToken !== newToken) {
        this.emit('tokenRefreshed', {
          oldToken,
          newToken,
          timestamp: Date.now(),
        })
      }

      // Reschedule for next refresh
      this.startAutoRefresh()
    } catch (error) {
      // Emit refresh failed event
      this.emit('refreshFailed', {
        error: error instanceof Error ? error : new Error(String(error)),
        isAutoRefresh: true,
      })
      // Auto-refresh failed - could implement retry logic here
    }
  }

  /**
   * Registers an event listener for token lifecycle events.
   *
   * @param event - The event type to listen for
   * @param listener - The callback function to invoke when the event occurs
   * @returns A function to remove the listener (for convenience)
   *
   * @example
   * ```typescript
   * // Listen for token refresh
   * const removeListener = auth.on('tokenRefreshed', ({ oldToken, newToken }) => {
   *   console.log('Token refreshed')
   *   localStorage.setItem('token', newToken)
   * })
   *
   * // Listen for refresh failures
   * auth.on('refreshFailed', ({ error, isAutoRefresh }) => {
   *   console.error('Refresh failed:', error.message)
   *   if (isAutoRefresh) {
   *     // Handle auto-refresh failure
   *     redirectToLogin()
   *   }
   * })
   *
   * // Later, remove the listener
   * removeListener()
   * ```
   */
  on<T extends TokenEventType>(
    event: T,
    listener: TokenEventListener<T>
  ): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)!.add(listener as TokenEventListener<TokenEventType>)

    // Return unsubscribe function
    return () => this.off(event, listener)
  }

  /**
   * Removes an event listener.
   *
   * @param event - The event type
   * @param listener - The listener to remove
   *
   * @example
   * ```typescript
   * const handler = (event) => console.log(event)
   * auth.on('tokenRefreshed', handler)
   *
   * // Later...
   * auth.off('tokenRefreshed', handler)
   * ```
   */
  off<T extends TokenEventType>(
    event: T,
    listener: TokenEventListener<T>
  ): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.delete(listener as TokenEventListener<TokenEventType>)
    }
  }

  /**
   * Registers a one-time event listener.
   *
   * The listener will be automatically removed after being called once.
   *
   * @param event - The event type to listen for
   * @param listener - The callback function to invoke once
   *
   * @example
   * ```typescript
   * // Wait for first refresh
   * auth.once('tokenRefreshed', ({ newToken }) => {
   *   console.log('First refresh completed:', newToken)
   * })
   * ```
   */
  once<T extends TokenEventType>(
    event: T,
    listener: TokenEventListener<T>
  ): void {
    const wrappedListener: TokenEventListener<T> = (eventData) => {
      this.off(event, wrappedListener)
      listener(eventData)
    }
    this.on(event, wrappedListener)
  }

  /**
   * Emits an event to all registered listeners.
   *
   * @param event - The event type
   * @param data - The event data
   */
  private emit<T extends TokenEventType>(
    event: T,
    data: TokenEventMap[T]
  ): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(data)
        } catch {
          // Swallow listener errors to prevent disrupting other listeners
        }
      })
    }
  }

  /**
   * Removes all event listeners for all events.
   *
   * @example
   * ```typescript
   * // Clean up all listeners
   * auth.removeAllListeners()
   * ```
   */
  removeAllListeners(): void {
    this.eventListeners.clear()
  }

  /**
   * Disposes of the provider and cleans up all resources.
   *
   * This method:
   * - Stops automatic token refresh
   * - Clears all event listeners
   * - Clears the payload cache
   * - Marks the provider as disposed
   *
   * After calling dispose(), the provider should not be used.
   *
   * @example
   * ```typescript
   * const auth = new BearerTokenAuthProvider(token, config)
   * auth.startAutoRefresh()
   *
   * // When done with the provider
   * auth.dispose()
   * ```
   */
  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true

    // Stop auto-refresh timer
    this.stopAutoRefresh()

    // Clear expiry check timer if present
    if (this.expiryCheckTimer) {
      clearTimeout(this.expiryCheckTimer)
      this.expiryCheckTimer = undefined
    }

    // Emit disposed event before clearing listeners
    this.emit('disposed', { timestamp: Date.now() })

    // Clear all event listeners
    this.removeAllListeners()

    // Clear payload cache
    this.invalidatePayloadCache()
  }

  /**
   * Checks if the provider has been disposed.
   *
   * @returns true if dispose() has been called, false otherwise
   *
   * @example
   * ```typescript
   * if (auth.isDisposed()) {
   *   throw new Error('Cannot use disposed auth provider')
   * }
   * ```
   */
  isDisposed(): boolean {
    return this.disposed
  }

  /**
   * Returns a headers object containing the Authorization header.
   *
   * If defaultHeaders are configured, they will be included in the result.
   * Each call returns a fresh object, so mutations won't affect future calls.
   *
   * @returns Object with Authorization header and any configured default headers
   *
   * @example Basic Usage
   * ```typescript
   * const auth = new BearerTokenAuthProvider('my-token')
   * const headers = auth.getAuthHeaders()
   * // Returns: { Authorization: 'Bearer my-token' }
   *
   * // Use in fetch
   * fetch('/api/data', { headers: auth.getAuthHeaders() })
   * ```
   *
   * @example With Default Headers
   * ```typescript
   * const auth = new BearerTokenAuthProvider('my-token', {
   *   defaultHeaders: {
   *     'X-API-Version': 'v1',
   *     'X-Client-ID': 'my-client',
   *   },
   * })
   * const headers = auth.getAuthHeaders()
   * // Returns: {
   * //   Authorization: 'Bearer my-token',
   * //   'X-API-Version': 'v1',
   * //   'X-Client-ID': 'my-client',
   * // }
   * ```
   */
  getAuthHeaders(): Record<string, string> {
    return {
      ...this.config.defaultHeaders,
      Authorization: this.getAuthHeader(),
    }
  }

  /**
   * Injects the Authorization header into a headers object.
   *
   * Supports multiple header formats:
   * - Plain objects: Returns a new object with Authorization added
   * - Headers instances: Returns a new Headers instance with Authorization set
   * - Array of tuples: Returns a new array with Authorization tuple appended
   *
   * The original headers object is not mutated.
   *
   * @param headers - The headers to inject Authorization into
   * @returns A new headers object/instance/array with Authorization included
   *
   * @example Plain Object
   * ```typescript
   * const auth = new BearerTokenAuthProvider('my-token')
   * const headers = auth.injectAuthHeader({
   *   'Content-Type': 'application/json',
   * })
   * // Returns: {
   * //   'Content-Type': 'application/json',
   * //   Authorization: 'Bearer my-token',
   * // }
   * ```
   *
   * @example Headers Instance
   * ```typescript
   * const headers = new Headers({ 'Content-Type': 'application/json' })
   * const authHeaders = auth.injectAuthHeader(headers)
   * authHeaders.get('Authorization') // 'Bearer my-token'
   * ```
   *
   * @example Array of Tuples
   * ```typescript
   * const headers: [string, string][] = [
   *   ['Content-Type', 'application/json'],
   * ]
   * const authHeaders = auth.injectAuthHeader(headers)
   * // Includes ['Authorization', 'Bearer my-token']
   * ```
   */
  injectAuthHeader(headers: Record<string, string>): Record<string, string>
  injectAuthHeader(headers: Headers): Headers
  injectAuthHeader(headers: [string, string][]): [string, string][]
  injectAuthHeader(
    headers: Record<string, string> | Headers | [string, string][]
  ): Record<string, string> | Headers | [string, string][] {
    const authValue = this.getAuthHeader()

    // Handle Headers instance
    if (headers instanceof Headers) {
      const newHeaders = new Headers(headers)
      newHeaders.set('Authorization', authValue)
      return newHeaders
    }

    // Handle array of tuples
    if (Array.isArray(headers)) {
      // Filter out existing Authorization headers and add new one
      const filtered = headers.filter(
        ([key]) => key.toLowerCase() !== 'authorization'
      )
      return [...filtered, ['Authorization', authValue] as [string, string]]
    }

    // Handle plain object
    return {
      ...headers,
      Authorization: authValue,
    }
  }

  /**
   * Injects the Authorization header into a fetch RequestInit object.
   *
   * Creates a new RequestInit with the Authorization header added to the
   * existing headers. The original RequestInit is not mutated.
   *
   * @param requestInit - The fetch RequestInit to enhance with Authorization
   * @returns A new RequestInit with Authorization header included
   *
   * @example Basic Usage
   * ```typescript
   * const auth = new BearerTokenAuthProvider('my-token')
   * const init = auth.injectAuthIntoRequestInit({ method: 'GET' })
   * // Returns: { method: 'GET', headers: { Authorization: 'Bearer my-token' } }
   * ```
   *
   * @example With Existing Headers
   * ```typescript
   * const init = auth.injectAuthIntoRequestInit({
   *   method: 'POST',
   *   headers: { 'Content-Type': 'application/json' },
   *   body: JSON.stringify({ data: 'test' }),
   * })
   * // Returns: {
   * //   method: 'POST',
   * //   headers: {
   * //     'Content-Type': 'application/json',
   * //     Authorization: 'Bearer my-token',
   * //   },
   * //   body: '{"data":"test"}',
   * // }
   * ```
   */
  injectAuthIntoRequestInit(requestInit: RequestInit): RequestInit {
    const existingHeaders = requestInit.headers

    let newHeaders: Record<string, string> | Headers

    if (existingHeaders instanceof Headers) {
      // Clone the Headers and add Authorization
      newHeaders = new Headers(existingHeaders)
      newHeaders.set('Authorization', this.getAuthHeader())
    } else if (Array.isArray(existingHeaders)) {
      // Convert array to object and add Authorization
      const headersObj: Record<string, string> = {}
      for (const [key, value] of existingHeaders) {
        headersObj[key] = value
      }
      headersObj.Authorization = this.getAuthHeader()
      newHeaders = headersObj
    } else if (existingHeaders) {
      // Plain object
      newHeaders = {
        ...existingHeaders,
        Authorization: this.getAuthHeader(),
      }
    } else {
      // No existing headers
      newHeaders = {
        Authorization: this.getAuthHeader(),
      }
    }

    return {
      ...requestInit,
      headers: newHeaders,
    }
  }

  /**
   * Creates a fetch function that automatically includes the Authorization header.
   *
   * The returned function has the same signature as the global fetch function
   * but automatically adds the current token to the Authorization header.
   *
   * If the token is refreshed, subsequent calls will use the new token.
   *
   * @param customFetch - Optional custom fetch implementation to wrap.
   *                      Defaults to the global fetch function.
   * @returns A fetch function with automatic Authorization header injection
   *
   * @example Basic Usage
   * ```typescript
   * const auth = new BearerTokenAuthProvider('my-token')
   * const authFetch = auth.createAuthenticatedFetch()
   *
   * const response = await authFetch('https://api.example.com/data')
   * // Request includes: Authorization: Bearer my-token
   * ```
   *
   * @example With Request Options
   * ```typescript
   * const authFetch = auth.createAuthenticatedFetch()
   *
   * const response = await authFetch('https://api.example.com/data', {
   *   method: 'POST',
   *   headers: { 'Content-Type': 'application/json' },
   *   body: JSON.stringify({ key: 'value' }),
   * })
   * // Request includes both Content-Type and Authorization headers
   * ```
   *
   * @example With Custom Fetch Implementation
   * ```typescript
   * import nodeFetch from 'node-fetch'
   *
   * const auth = new BearerTokenAuthProvider('my-token')
   * const authFetch = auth.createAuthenticatedFetch(nodeFetch)
   *
   * // Uses node-fetch with Authorization header
   * const response = await authFetch('https://api.example.com/data')
   * ```
   */
  createAuthenticatedFetch(
    customFetch?: typeof fetch
  ): typeof fetch {
    const fetchFn = customFetch ?? fetch

    return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const enhancedInit = this.injectAuthIntoRequestInit(init ?? {})
      return fetchFn(input, enhancedInit)
    }
  }
}
