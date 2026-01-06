/**
 * @file Graceful Degradation - Stub Implementation
 *
 * This is a stub implementation for the GracefulDegradation module.
 * The graceful degradation system allows the application to continue
 * working with cached data when the connection fails.
 *
 * Features:
 * - Offline mode detection and signaling
 * - Cached data serving when connection fails
 * - Request queueing during offline periods
 * - Automatic retry with exponential backoff
 * - State synchronization after reconnection
 * - Configurable degradation strategies
 * - Event emission for degradation state changes
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Represents the current degradation state
 */
export type DegradationState = 'online' | 'degraded' | 'offline'

/**
 * Degradation strategy
 */
export type DegradationStrategy =
  | 'cache-first'
  | 'network-first'
  | 'stale-while-revalidate'

/**
 * Cache entry type
 */
export interface CacheEntry {
  data: unknown
  timestamp: number
  ttl: number
  key: string
}

/**
 * Queued request during offline
 */
export interface QueuedRequest {
  id: string
  method: string
  params: unknown
  timestamp: number
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  options?: RequestOptions
}

/**
 * Cache interface for graceful degradation
 */
export interface DegradationCache {
  get(key: string): Promise<unknown | null>
  set(key: string, data: unknown, ttl?: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  has(key: string): Promise<boolean>
}

/**
 * Transport interface for graceful degradation
 */
export interface DegradationTransport {
  isConnected: boolean
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
  send<T>(method: string, params: unknown): Promise<T>
}

/**
 * Configuration for GracefulDegradation
 */
export interface GracefulDegradationConfig {
  transport: DegradationTransport
  cache?: DegradationCache
  maxRetries?: number
  retryBaseDelay?: number
  retryMaxDelay?: number
  cacheDefaultTTL?: number
  maxQueueSize?: number
  queueTimeout?: number
  enableOfflineQueue?: boolean
  offlineMethods?: string[]
  strategy?: DegradationStrategy
}

/**
 * Options for individual requests
 */
export interface RequestOptions {
  retry?: boolean
  maxRetries?: number
  retryCondition?: (error: Error) => boolean
  cacheKey?: string
  bypassCache?: boolean
  staleWhileRevalidate?: boolean
  queueable?: boolean
  invalidates?: string[]
  strategy?: DegradationStrategy
}

/**
 * Statistics for monitoring
 */
export interface DegradationStats {
  cacheHits: number
  cacheMisses: number
  cacheHitRate: number
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  totalDegradedTime: number
  totalRetries: number
  queuedRequests: number
  currentQueueSize: number
}

/**
 * Retry event data
 */
export interface RetryEvent {
  method: string
  params: unknown
  attempt: number
  delay: number
}

/**
 * Sync complete event data
 */
export interface SyncCompleteEvent {
  processed: number
  failed: number
}

/**
 * Sync failed event data
 */
export interface SyncFailedEvent {
  method: string
  params: unknown
  error: Error
}

/**
 * Request queued event data
 */
export interface RequestQueuedEvent {
  method: string
  params: unknown
}

/**
 * Error event data
 */
export interface DegradationErrorEvent extends Error {
  method?: string
  params?: unknown
}

// =============================================================================
// Implementation
// =============================================================================

type EventHandler = (...args: unknown[]) => void

/**
 * GracefulDegradation class manages connection resilience
 */
export class GracefulDegradation {
  private _state: DegradationState = 'online'
  private _disposed = false
  private _config: Required<GracefulDegradationConfig>
  private _eventListeners: Map<string, Set<EventHandler>> = new Map()
  private _queue: QueuedRequest[] = []
  private _degradedStartTime: number | null = null
  private _totalDegradedTime = 0
  private _stats: DegradationStats = {
    cacheHits: 0,
    cacheMisses: 0,
    cacheHitRate: 0,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalDegradedTime: 0,
    totalRetries: 0,
    queuedRequests: 0,
    currentQueueSize: 0,
  }
  private _internalCache: Map<string, CacheEntry> = new Map()

  constructor(options: GracefulDegradationConfig) {
    this._config = {
      transport: options.transport,
      cache: options.cache || this._createInternalCache(),
      maxRetries: options.maxRetries ?? 3,
      retryBaseDelay: options.retryBaseDelay ?? 1000,
      retryMaxDelay: options.retryMaxDelay ?? 30000,
      cacheDefaultTTL: options.cacheDefaultTTL ?? 300000,
      maxQueueSize: options.maxQueueSize ?? 100,
      queueTimeout: options.queueTimeout ?? 60000,
      enableOfflineQueue: options.enableOfflineQueue ?? false,
      offlineMethods: options.offlineMethods ?? ['find', 'findOne', 'aggregate'],
      strategy: options.strategy ?? 'network-first',
    }

    // Set up transport event listeners
    this._config.transport.on('disconnect', this._handleDisconnect.bind(this))
    this._config.transport.on('connect', this._handleReconnect.bind(this))

    // Initialize state based on transport
    this._state = this._config.transport.isConnected ? 'online' : 'degraded'
  }

  private _createInternalCache(): DegradationCache {
    return {
      get: async (key: string) => {
        const entry = this._internalCache.get(key)
        if (!entry) return null
        if (Date.now() > entry.timestamp + entry.ttl) {
          this._internalCache.delete(key)
          return null
        }
        return entry.data
      },
      set: async (key: string, data: unknown, ttl?: number) => {
        this._internalCache.set(key, {
          key,
          data,
          timestamp: Date.now(),
          ttl: ttl ?? this._config.cacheDefaultTTL,
        })
      },
      delete: async (key: string) => {
        this._internalCache.delete(key)
      },
      clear: async () => {
        this._internalCache.clear()
      },
      has: async (key: string) => this._internalCache.has(key),
    }
  }

  get state(): DegradationState {
    return this._state
  }

  get isOnline(): boolean {
    return this._state === 'online'
  }

  get config(): Required<GracefulDegradationConfig> {
    return this._config
  }

  get queueSize(): number {
    return this._queue.length
  }

  get degradedDuration(): number {
    if (this._degradedStartTime !== null) {
      return this._totalDegradedTime + (Date.now() - this._degradedStartTime)
    }
    return this._totalDegradedTime
  }

  get stats(): DegradationStats {
    const totalRequests = this._stats.cacheHits + this._stats.cacheMisses
    return {
      ...this._stats,
      cacheHitRate: totalRequests > 0 ? this._stats.cacheHits / totalRequests : 0,
      currentQueueSize: this._queue.length,
      totalDegradedTime: this.degradedDuration,
    }
  }

  private _handleDisconnect(): void {
    if (this._state !== 'degraded') {
      this._state = 'degraded'
      this._degradedStartTime = Date.now()
      this._emit('stateChange', 'degraded')
    }
  }

  private async _handleReconnect(): Promise<void> {
    if (this._state !== 'online') {
      // Update degraded time
      if (this._degradedStartTime !== null) {
        this._totalDegradedTime += Date.now() - this._degradedStartTime
        this._degradedStartTime = null
      }

      this._state = 'online'
      this._emit('stateChange', 'online')

      // Process queued requests
      await this._processQueue()
    }
  }

  private async _processQueue(): Promise<void> {
    if (this._queue.length === 0) return

    this._emit('syncStart')

    let processed = 0
    let failed = 0

    const queueCopy = [...this._queue]
    this._queue = []

    for (const request of queueCopy) {
      try {
        const result = await this._config.transport.send(request.method, request.params)
        request.resolve(result)
        processed++

        // Invalidate cache entries if specified
        if (request.options?.invalidates) {
          for (const key of request.options.invalidates) {
            await this._config.cache.delete(key)
          }
        }
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error(String(error)))
        failed++
        this._emit('syncFailed', {
          method: request.method,
          params: request.params,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    }

    this._emit('syncComplete', { processed, failed })
    this._emit('queueProcessed')
  }

  on(event: string, handler: EventHandler): void {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set())
    }
    this._eventListeners.get(event)!.add(handler)
  }

  off(event: string, handler: EventHandler): void {
    this._eventListeners.get(event)?.delete(handler)
  }

  private _emit(event: string, ...args: unknown[]): void {
    this._eventListeners.get(event)?.forEach((handler) => handler(...args))
  }

  getCacheKey(method: string, params: unknown): string {
    return `${method}:${JSON.stringify(params)}`
  }

  async request<T>(
    method: string,
    params: unknown,
    options?: RequestOptions
  ): Promise<T> {
    if (this._disposed) {
      throw Object.assign(new Error('GracefulDegradation has been disposed'), {
        method,
        params,
      })
    }

    this._stats.totalRequests++

    const strategy = options?.strategy ?? this._config.strategy
    const cacheKey = options?.cacheKey ?? this.getCacheKey(method, params)

    // Handle different strategies
    if (strategy === 'cache-first' && !options?.bypassCache) {
      try {
        const cached = await this._config.cache.get(cacheKey)
        if (cached !== null) {
          this._stats.cacheHits++
          this._stats.successfulRequests++
          return cached as T
        }
      } catch {
        // Cache read failed, continue to network
      }
      this._stats.cacheMisses++
    }

    // Handle stale-while-revalidate
    if (strategy === 'stale-while-revalidate' || options?.staleWhileRevalidate) {
      try {
        const cached = await this._config.cache.get(cacheKey)
        if (cached !== null) {
          this._stats.cacheHits++
          this._stats.successfulRequests++

          // Revalidate in background
          this._revalidateInBackground(method, params, cacheKey)

          return cached as T
        }
      } catch {
        // Cache read failed, continue to network
      }
      this._stats.cacheMisses++
    }

    // If offline
    if (!this._config.transport.isConnected) {
      // Try to serve from cache
      if (!options?.bypassCache) {
        try {
          const cached = await this._config.cache.get(cacheKey)
          if (cached !== null) {
            this._stats.cacheHits++
            this._stats.successfulRequests++
            return cached as T
          }
        } catch {
          // Cache read failed
        }
      }

      // Queue the request if allowed
      if (this._config.enableOfflineQueue && options?.queueable) {
        return this._queueRequest(method, params, options) as Promise<T>
      }

      this._stats.failedRequests++
      throw Object.assign(new Error('Request failed: offline with no cached data'), {
        method,
        params,
      })
    }

    // Make the network request
    try {
      const result = await this._executeWithRetry<T>(method, params, options)

      // Cache the result
      try {
        await this._config.cache.set(cacheKey, result, this._config.cacheDefaultTTL)
      } catch {
        // Cache write failed, continue anyway
      }

      this._stats.successfulRequests++
      return result
    } catch (error) {
      // If network fails and we're using network-first, try cache
      if (strategy === 'network-first' && !options?.bypassCache) {
        try {
          const cached = await this._config.cache.get(cacheKey)
          if (cached !== null) {
            this._stats.cacheHits++
            this._stats.successfulRequests++
            return cached as T
          }
        } catch {
          // Cache read failed
        }
      }

      this._stats.failedRequests++
      this._emit('error', Object.assign(error instanceof Error ? error : new Error(String(error)), {
        method,
        params,
      }))
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        method,
        params,
      })
    }
  }

  private async _revalidateInBackground(
    method: string,
    params: unknown,
    cacheKey: string
  ): Promise<void> {
    try {
      if (this._config.transport.isConnected) {
        const result = await this._config.transport.send(method, params)
        await this._config.cache.set(cacheKey, result, this._config.cacheDefaultTTL)
      }
    } catch {
      // Revalidation failed silently
    }
  }

  private async _executeWithRetry<T>(
    method: string,
    params: unknown,
    options?: RequestOptions
  ): Promise<T> {
    const maxRetries = options?.retry ? (options.maxRetries ?? this._config.maxRetries) : 0
    const retryCondition = options?.retryCondition

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._config.transport.send<T>(method, params)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Check if we should retry
        if (attempt < maxRetries) {
          if (retryCondition && !retryCondition(lastError)) {
            throw lastError
          }

          const delay = Math.min(
            this._config.retryBaseDelay * Math.pow(2, attempt),
            this._config.retryMaxDelay
          )

          this._stats.totalRetries++
          this._emit('retry', {
            method,
            params,
            attempt: attempt + 1,
            delay,
          })

          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError!
  }

  private _queueRequest(
    method: string,
    params: unknown,
    options?: RequestOptions
  ): Promise<unknown> {
    if (this._queue.length >= this._config.maxQueueSize) {
      throw new Error('Request queue is full')
    }

    return new Promise((resolve, reject) => {
      const request: QueuedRequest = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        method,
        params,
        timestamp: Date.now(),
        resolve,
        reject,
        options,
      }

      this._queue.push(request)
      this._stats.queuedRequests++

      this._emit('requestQueued', { method, params })

      // Set up timeout
      const timeoutId = setTimeout(() => {
        const index = this._queue.findIndex((r) => r.id === request.id)
        if (index !== -1) {
          this._queue.splice(index, 1)
          reject(new Error('Request timed out while queued'))
        }
      }, this._config.queueTimeout)

      // Clear timeout if resolved/rejected
      const originalResolve = request.resolve
      const originalReject = request.reject

      request.resolve = (value: unknown) => {
        clearTimeout(timeoutId)
        originalResolve(value)
      }

      request.reject = (error: Error) => {
        clearTimeout(timeoutId)
        originalReject(error)
      }
    })
  }

  clearQueue(): void {
    for (const request of this._queue) {
      request.reject(new Error('Queue cleared'))
    }
    this._queue = []
  }

  async dispose(): Promise<void> {
    this._disposed = true

    // Clear the queue and reject pending requests
    for (const request of this._queue) {
      request.reject(new Error('GracefulDegradation disposed'))
    }
    this._queue = []

    // Remove transport listeners
    this._config.transport.off('disconnect', this._handleDisconnect.bind(this))
    this._config.transport.off('connect', this._handleReconnect.bind(this))

    // Clear event listeners
    this._eventListeners.clear()
  }
}
