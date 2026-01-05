/**
 * Request Deduplication Module
 *
 * Provides a sophisticated request deduplication mechanism that prevents
 * duplicate network calls for identical concurrent requests. When multiple
 * callers request the same data simultaneously, only one network call is
 * made and all callers receive the same result.
 *
 * Key features:
 * - Identical concurrent requests share a single network call
 * - Cache keys generated from method + params with configurable serializer
 * - Optional TTL-based result caching with LRU eviction
 * - Comprehensive statistics tracking (hits, misses, pending count)
 * - Debug logging support for troubleshooting
 * - Errors are not cached (failed requests can be retried)
 *
 * @module deduplication
 * @packageDocumentation
 */

/**
 * Function type for serializing cache keys.
 * Allows custom serialization strategies for different use cases.
 *
 * @param method - The RPC method name
 * @param params - The method parameters (can be any value)
 * @returns A string key that uniquely identifies the method+params combination
 *
 * @example
 * ```typescript
 * // Custom serializer using a hash function
 * const hashSerializer: KeySerializer = (method, params) => {
 *   return `${method}:${myHashFunction(params)}`;
 * };
 * ```
 */
export type KeySerializer = (method: string, params: unknown) => string

/**
 * Debug logger function type.
 * Compatible with console.log or any custom logging implementation.
 *
 * @param message - The log message
 * @param data - Optional additional data to log
 *
 * @example
 * ```typescript
 * // Using console.log
 * const logger: DebugLogger = console.log;
 *
 * // Using a custom logger
 * const logger: DebugLogger = (msg, data) => {
 *   myLogger.debug('[Deduplicator]', msg, data);
 * };
 * ```
 */
export type DebugLogger = (message: string, data?: Record<string, unknown>) => void

/**
 * Statistics about cache operations.
 * Useful for monitoring and performance analysis.
 *
 * @property hits - Number of times a cached result was returned
 * @property misses - Number of times a cache lookup found no entry
 * @property pendingHits - Number of times an existing pending request was reused
 * @property evictions - Number of entries evicted due to LRU policy
 */
export interface CacheStatistics {
  /** Number of successful cache hits (cached result returned) */
  hits: number
  /** Number of cache misses (no cached result available) */
  misses: number
  /** Number of times an in-flight request was reused */
  pendingHits: number
  /** Number of entries evicted due to LRU policy (only when maxCacheSize is set) */
  evictions: number
}

/**
 * Configuration options for the RequestDeduplicator.
 *
 * @example
 * ```typescript
 * // Basic TTL configuration
 * const config: DeduplicatorConfig = { ttl: 5000 };
 *
 * // Full configuration with all options
 * const config: DeduplicatorConfig = {
 *   ttl: 5000,
 *   maxCacheSize: 100,
 *   keySerializer: (method, params) => `${method}:${JSON.stringify(params)}`,
 *   debug: console.log
 * };
 * ```
 */
export interface DeduplicatorConfig {
  /**
   * Optional TTL (in milliseconds) for result caching.
   * When set, successful results are cached for this duration.
   * When not set, only in-flight deduplication occurs.
   *
   * @defaultValue undefined (no caching, only deduplication)
   */
  ttl?: number

  /**
   * Maximum number of entries to keep in the result cache.
   * When set and the cache exceeds this size, the least recently
   * used entries will be evicted (LRU eviction policy).
   * Only applicable when TTL is also set.
   *
   * @defaultValue undefined (unlimited cache size)
   */
  maxCacheSize?: number

  /**
   * Custom function for generating cache keys from method and params.
   * By default, uses JSON.stringify for serialization.
   *
   * Use cases for custom serializers:
   * - Faster hashing for large payloads
   * - Ignoring certain fields in the params
   * - Using a deterministic serialization for objects with varying key order
   *
   * @defaultValue Default serializer using JSON.stringify
   */
  keySerializer?: KeySerializer

  /**
   * Optional debug logger for troubleshooting.
   * When set, detailed information about cache operations will be logged.
   *
   * @defaultValue undefined (no logging)
   *
   * @example
   * ```typescript
   * // Enable debug logging
   * const deduplicator = new RequestDeduplicator({
   *   debug: (msg, data) => console.log(`[Dedup] ${msg}`, data)
   * });
   * ```
   */
  debug?: DebugLogger
}

/**
 * Internal cache entry structure with LRU tracking.
 * Stores the cached result along with expiration and access timing.
 */
interface CacheEntry {
  /** The cached result value */
  result: unknown
  /** Timestamp when this entry expires (ms since epoch) */
  expires: number
  /** Timestamp of last access for LRU eviction (ms since epoch) */
  lastAccess: number
}

/**
 * Default key serializer that uses JSON.stringify.
 * Handles undefined/null params gracefully.
 *
 * @param method - The method name
 * @param params - The method parameters
 * @returns A string key in format "method:serialized_params"
 */
const defaultKeySerializer: KeySerializer = (method: string, params: unknown): string => {
  return `${method}:${JSON.stringify(params ?? null)}`
}

/**
 * Request deduplicator that prevents duplicate network calls for identical
 * concurrent requests and optionally caches results with TTL and LRU eviction.
 *
 * This class is designed to be used with RPC-style APIs where the same
 * request (method + params) may be made multiple times concurrently.
 *
 * ## Features
 *
 * - **Deduplication**: Concurrent identical requests share a single network call
 * - **Result Caching**: Optional TTL-based caching of successful results
 * - **LRU Eviction**: Optional size-limited cache with LRU eviction
 * - **Statistics**: Track cache hits, misses, and pending request reuse
 * - **Debug Logging**: Optional logging for troubleshooting
 * - **Custom Serialization**: Pluggable key serialization strategy
 *
 * ## Usage
 *
 * @example Basic usage (deduplication only)
 * ```typescript
 * const deduplicator = new RequestDeduplicator();
 *
 * // Multiple concurrent calls share one network request
 * const [result1, result2] = await Promise.all([
 *   deduplicator.execute('find', { filter: { id: 1 } }, () => fetch(...)),
 *   deduplicator.execute('find', { filter: { id: 1 } }, () => fetch(...))
 * ]);
 * // Only one fetch call was made
 * ```
 *
 * @example With TTL caching
 * ```typescript
 * const deduplicator = new RequestDeduplicator({ ttl: 5000 });
 *
 * // First call makes network request
 * const result1 = await deduplicator.execute('find', { id: 1 }, fetchData);
 *
 * // Second call within 5 seconds returns cached result
 * const result2 = await deduplicator.execute('find', { id: 1 }, fetchData);
 * ```
 *
 * @example With LRU eviction and statistics
 * ```typescript
 * const deduplicator = new RequestDeduplicator({
 *   ttl: 5000,
 *   maxCacheSize: 100,
 *   debug: console.log
 * });
 *
 * // ... perform requests ...
 *
 * const stats = deduplicator.getStatistics();
 * console.log(`Cache hit rate: ${stats.hits / (stats.hits + stats.misses) * 100}%`);
 * ```
 */
export class RequestDeduplicator {
  /**
   * Map of pending (in-flight) requests.
   * Key: cache key, Value: Promise that resolves when request completes
   */
  private pending = new Map<string, Promise<unknown>>()

  /**
   * Map of cached results with TTL and LRU metadata.
   * Only populated when TTL is configured.
   * Uses insertion order for LRU tracking (Map maintains insertion order).
   */
  private cache = new Map<string, CacheEntry>()

  /**
   * TTL duration in milliseconds for result caching.
   * undefined means no caching (deduplication only).
   */
  private readonly ttl?: number

  /**
   * Maximum cache size for LRU eviction.
   * undefined means unlimited cache size.
   */
  private readonly maxCacheSize?: number

  /**
   * Key serializer function for generating cache keys.
   */
  private readonly keySerializer: KeySerializer

  /**
   * Optional debug logger function.
   */
  private readonly debug?: DebugLogger

  /**
   * Statistics tracking for cache operations.
   */
  private stats: CacheStatistics = {
    hits: 0,
    misses: 0,
    pendingHits: 0,
    evictions: 0,
  }

  /**
   * Creates a new RequestDeduplicator instance.
   *
   * @param config - Optional configuration options
   *
   * @example
   * ```typescript
   * // Deduplication only
   * const deduplicator = new RequestDeduplicator();
   *
   * // With 5 second TTL caching
   * const deduplicator = new RequestDeduplicator({ ttl: 5000 });
   *
   * // With TTL, LRU limit, and debug logging
   * const deduplicator = new RequestDeduplicator({
   *   ttl: 5000,
   *   maxCacheSize: 100,
   *   debug: console.log
   * });
   * ```
   */
  constructor(config?: DeduplicatorConfig) {
    this.ttl = config?.ttl
    this.maxCacheSize = config?.maxCacheSize
    this.keySerializer = config?.keySerializer ?? defaultKeySerializer
    this.debug = config?.debug
    this.log('Initialized', { ttl: this.ttl, maxCacheSize: this.maxCacheSize })
  }

  /**
   * Logs a debug message if debug logging is enabled.
   *
   * @param message - The message to log
   * @param data - Optional additional data to include
   */
  private log(message: string, data?: Record<string, unknown>): void {
    if (this.debug) {
      this.debug(`[RequestDeduplicator] ${message}`, data)
    }
  }

  /**
   * Generates a cache key from method name and parameters.
   * Same method + same params = same key.
   *
   * Uses the configured keySerializer, which defaults to JSON.stringify.
   *
   * @param method - The RPC method name
   * @param params - The method parameters
   * @returns A string key that uniquely identifies this method+params combination
   *
   * @example
   * ```typescript
   * const key = deduplicator.generateCacheKey('find', { filter: { id: 1 } });
   * // Returns: 'find:{"filter":{"id":1}}'
   * ```
   */
  generateCacheKey(method: string, params?: unknown): string {
    return this.keySerializer(method, params)
  }

  /**
   * Evicts the least recently used cache entries to enforce maxCacheSize.
   * Uses Map's insertion order property - entries are re-inserted on access
   * to maintain LRU ordering.
   *
   * @param targetSize - The target cache size after eviction
   */
  private evictLRU(targetSize: number): void {
    if (!this.maxCacheSize) return

    while (this.cache.size > targetSize) {
      // Map iterates in insertion order, so first entry is oldest
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
        this.stats.evictions++
        this.log('Evicted LRU entry', { key: firstKey })
      }
    }
  }

  /**
   * Updates the LRU position of a cache entry by re-inserting it.
   * This moves the entry to the end of the Map's iteration order.
   *
   * @param key - The cache key to update
   * @param entry - The cache entry
   */
  private touchCacheEntry(key: string, entry: CacheEntry): void {
    // Delete and re-insert to move to end of iteration order (most recent)
    this.cache.delete(key)
    entry.lastAccess = Date.now()
    this.cache.set(key, entry)
  }

  /**
   * Executes a request with deduplication.
   *
   * If an identical request (same method + params) is already in flight,
   * returns the existing promise instead of making a new network call.
   *
   * When TTL is configured, successful results are cached for the specified
   * duration. Cached results are returned immediately without executing
   * the provided executor function.
   *
   * Errors are never cached - if a request fails, subsequent requests
   * will attempt a new network call.
   *
   * @typeParam T - The expected return type of the executor
   * @param method - The RPC method name
   * @param params - The method parameters
   * @param executor - Function that performs the actual network call
   * @returns Promise resolving to the request result
   *
   * @throws Re-throws any error from the executor function
   *
   * @example
   * ```typescript
   * const result = await deduplicator.execute(
   *   'find',
   *   { filter: { status: 'active' } },
   *   () => rpcClient.call('find', { filter: { status: 'active' } })
   * );
   * ```
   */
  async execute<T>(
    method: string,
    params: unknown,
    executor: () => Promise<T>
  ): Promise<T> {
    const key = this.generateCacheKey(method, params)

    // Check result cache first (if TTL enabled)
    if (this.ttl !== undefined) {
      const cached = this.cache.get(key)
      if (cached && cached.expires > Date.now()) {
        this.stats.hits++
        this.touchCacheEntry(key, cached)
        this.log('Cache hit', { key, method, expires: cached.expires })
        return cached.result as T
      } else if (cached) {
        // Entry expired, remove it
        this.cache.delete(key)
        this.log('Cache entry expired', { key, method })
      }
      this.stats.misses++
    }

    // Check if there's already a pending request for this key
    const existing = this.pending.get(key)
    if (existing) {
      this.stats.pendingHits++
      this.log('Reusing pending request', { key, method })
      return existing as Promise<T>
    }

    this.log('Executing new request', { key, method })

    // Execute the request and track it
    const promise = executor()
      .then((result) => {
        this.pending.delete(key)
        // Cache successful results if TTL is configured
        if (this.ttl !== undefined) {
          // Evict entries if we're at capacity
          if (this.maxCacheSize && this.cache.size >= this.maxCacheSize) {
            this.evictLRU(this.maxCacheSize - 1)
          }
          const now = Date.now()
          this.cache.set(key, {
            result,
            expires: now + this.ttl,
            lastAccess: now,
          })
          this.log('Cached result', { key, method, ttl: this.ttl })
        }
        return result
      })
      .catch((err) => {
        // Clear pending on error but don't cache errors
        this.pending.delete(key)
        this.log('Request failed', { key, method, error: String(err) })
        throw err
      })

    this.pending.set(key, promise)
    return promise
  }

  /**
   * Gets the number of currently pending (in-flight) requests.
   *
   * @returns The count of pending requests
   *
   * @example
   * ```typescript
   * console.log(`${deduplicator.getPendingCount()} requests in flight`);
   * ```
   */
  getPendingCount(): number {
    return this.pending.size
  }

  /**
   * Gets the number of entries currently in the result cache.
   * Note: This may include expired entries that haven't been cleaned up yet.
   *
   * @returns The count of cached entries
   *
   * @example
   * ```typescript
   * console.log(`${deduplicator.getCacheSize()} entries cached`);
   * ```
   */
  getCacheSize(): number {
    return this.cache.size
  }

  /**
   * Checks if there's a pending request for the given method and params.
   *
   * @param method - The RPC method name
   * @param params - The method parameters
   * @returns true if a matching request is in flight
   *
   * @example
   * ```typescript
   * if (deduplicator.hasPending('find', { id: 1 })) {
   *   console.log('Request already in progress');
   * }
   * ```
   */
  hasPending(method: string, params?: unknown): boolean {
    const key = this.generateCacheKey(method, params)
    return this.pending.has(key)
  }

  /**
   * Checks if there's a valid (non-expired) cache entry for the given
   * method and params.
   *
   * @param method - The RPC method name
   * @param params - The method parameters
   * @returns true if a valid cached result exists
   *
   * @example
   * ```typescript
   * if (deduplicator.hasCached('find', { id: 1 })) {
   *   console.log('Result is cached');
   * }
   * ```
   */
  hasCached(method: string, params?: unknown): boolean {
    const key = this.generateCacheKey(method, params)
    const cached = this.cache.get(key)
    return cached !== undefined && cached.expires > Date.now()
  }

  /**
   * Gets a snapshot of the current cache statistics.
   *
   * Statistics include:
   * - `hits`: Number of times a cached result was returned
   * - `misses`: Number of cache misses (no cached result)
   * - `pendingHits`: Number of times an in-flight request was reused
   * - `evictions`: Number of entries evicted due to LRU policy
   *
   * @returns A copy of the current statistics
   *
   * @example
   * ```typescript
   * const stats = deduplicator.getStatistics();
   * const hitRate = stats.hits / (stats.hits + stats.misses) * 100;
   * console.log(`Cache hit rate: ${hitRate.toFixed(1)}%`);
   * console.log(`Pending reuse rate: ${stats.pendingHits}`);
   * ```
   */
  getStatistics(): CacheStatistics {
    return { ...this.stats }
  }

  /**
   * Resets all statistics counters to zero.
   *
   * @example
   * ```typescript
   * deduplicator.resetStatistics();
   * // Run some operations...
   * const stats = deduplicator.getStatistics();
   * // stats reflect only operations since reset
   * ```
   */
  resetStatistics(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      pendingHits: 0,
      evictions: 0,
    }
    this.log('Statistics reset')
  }

  /**
   * Clears all pending requests from the deduplication tracking.
   *
   * **Warning**: This doesn't cancel the actual network calls, just removes
   * them from the deduplication tracking. New requests with the same
   * method+params will not deduplicate with previously tracked requests.
   *
   * @example
   * ```typescript
   * // Clear pending requests (e.g., on navigation/cleanup)
   * deduplicator.clear();
   * ```
   */
  clear(): void {
    this.pending.clear()
    this.log('Cleared all pending requests')
  }

  /**
   * Clears all cached results.
   * Only relevant when TTL-based caching is enabled.
   *
   * Use this to force fresh data to be fetched on the next request,
   * for example after a mutation that may have invalidated cached data.
   *
   * @example
   * ```typescript
   * // After updating data, clear the cache to ensure fresh reads
   * await updateDocument({ id: 1, status: 'completed' });
   * deduplicator.clearCache();
   * ```
   */
  clearCache(): void {
    this.cache.clear()
    this.log('Cleared all cached results')
  }

  /**
   * Clears both pending requests and cached results.
   * Equivalent to calling clear() and clearCache().
   *
   * @example
   * ```typescript
   * // Full reset of deduplicator state
   * deduplicator.clearAll();
   * ```
   */
  clearAll(): void {
    this.clear()
    this.clearCache()
    this.log('Cleared all pending requests and cached results')
  }

  /**
   * Removes expired entries from the cache.
   * This is an optional maintenance operation - expired entries are also
   * cleaned up lazily when accessed.
   *
   * @returns The number of entries removed
   *
   * @example
   * ```typescript
   * // Periodically clean up expired entries
   * setInterval(() => {
   *   const removed = deduplicator.pruneExpired();
   *   if (removed > 0) {
   *     console.log(`Pruned ${removed} expired cache entries`);
   *   }
   * }, 60000);
   * ```
   */
  pruneExpired(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires <= now) {
        this.cache.delete(key)
        removed++
      }
    }
    if (removed > 0) {
      this.log('Pruned expired entries', { count: removed })
    }
    return removed
  }
}
