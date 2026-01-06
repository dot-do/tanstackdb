/**
 * @file Load Subset Handler
 *
 * Handles on-demand loading of document subsets from MongoDB via RPC.
 * This handler is used in 'on-demand' and 'progressive' sync modes to fetch
 * specific subsets of data based on query parameters, pagination, and filtering.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/handlers/load-subset
 *
 * @remarks
 * The load subset handler:
 * - Receives LoadSubsetOptions from TanStack DB queries
 * - Transforms them to MongoDB find operations
 * - Handles pagination (offset/cursor-based)
 * - Provides filtering and sorting
 * - Writes loaded documents to the collection via sync params
 * - Supports deduplication to avoid re-loading existing documents
 *
 * @example Basic usage
 * ```typescript
 * import { createLoadSubsetHandler } from '@tanstack/mongo-db-collection'
 *
 * const loadSubset = createLoadSubsetHandler({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   getKey: (user) => user._id,
 *   syncParams: params,
 * })
 *
 * // Use with TanStack DB collection config
 * const syncReturn = {
 *   cleanup: () => { ... },
 *   loadSubset,
 * }
 * ```
 *
 * Bead ID: po0.110 (GREEN implementation)
 */

import type { LoadSubsetOptions, SortSpec, SortDirection, MongoFilterQuery } from '../../types.js'
import { compilePredicate, type BasicExpression } from '../../query/predicate-compiler.js'

// =============================================================================
// Types
// =============================================================================

/**
 * RPC client interface for making MongoDB operations.
 * Must provide an `rpc` method for making remote procedure calls.
 */
export interface RpcClient {
  /** Execute an RPC call to MongoDB */
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  /** Connect to the RPC server */
  connect?: () => Promise<void>
  /** Disconnect from the RPC server */
  disconnect?: () => Promise<void>
  /** Check if connected */
  isConnected?: () => boolean
}

/**
 * Sync parameters for writing documents to the collection.
 * @typeParam T - The document type
 */
export interface SyncParams<T> {
  /** Begin a sync transaction */
  begin: () => void
  /** Write a change message */
  write: (message: ChangeMessage<T>) => void
  /** Commit the transaction */
  commit: () => void
  /** Mark the collection as ready */
  markReady?: () => void
  /** Collection reference */
  collection: {
    id: string
    state: () => Map<string, T>
  }
}

/**
 * Change message for writing to the collection.
 * @typeParam T - The document type
 */
export interface ChangeMessage<T> {
  /** Type of change */
  type: 'insert' | 'update' | 'delete'
  /** Document key */
  key: string
  /** Document value */
  value: T
}

/**
 * Context for load subset operations.
 * @typeParam T - The document type
 */
export interface LoadSubsetContext<T = unknown> {
  /** Options for the subset load */
  options: LoadSubsetOptions<T>
}

/**
 * Result of a load subset operation.
 * @typeParam T - The document type
 */
export interface LoadSubsetResult<T = unknown> {
  /** Whether the operation succeeded */
  success: boolean
  /** Loaded documents */
  documents?: T[]
  /** Number of documents loaded */
  count?: number
  /** Error if operation failed */
  error?: Error
}

/**
 * Retry configuration for transient error handling.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries?: number
  /** Initial delay between retries in milliseconds */
  initialDelayMs?: number
  /** Maximum delay between retries in milliseconds */
  maxDelayMs?: number
  /** Backoff multiplier */
  backoffMultiplier?: number
}

/**
 * Hook context for onBeforeLoad.
 * @typeParam T - The document type
 */
export interface BeforeLoadContext<T = unknown> {
  /** Options for the subset load */
  options: LoadSubsetOptions<T>
}

/**
 * Hook context for onAfterLoad.
 * @typeParam T - The document type
 */
export interface AfterLoadContext<T = unknown> {
  /** Documents that were loaded */
  documents: T[]
  /** Number of documents loaded */
  count: number
}

/**
 * Hook context for onError.
 * @typeParam T - The document type
 */
export interface ErrorContext<T = unknown> {
  /** The error that occurred */
  error: Error
  /** Options that were used for the load */
  options?: LoadSubsetOptions<T>
}

/**
 * Configuration for the load subset handler factory.
 * @typeParam T - The document type
 */
export interface LoadSubsetHandlerConfig<T = unknown> {
  /** RPC client for MongoDB operations */
  rpcClient: RpcClient
  /** Target database name */
  database: string
  /** Target collection name */
  collection: string
  /** Function to extract document key */
  getKey: (doc: T) => string
  /** Sync parameters for writing to collection */
  syncParams?: SyncParams<T>
  /** Retry configuration for transient errors */
  retryConfig?: RetryConfig
  /** Hook called before loading documents (can transform options) */
  onBeforeLoad?: (context: BeforeLoadContext<T>) => LoadSubsetOptions<T> | void | Promise<LoadSubsetOptions<T> | void>
  /** Hook called after successful load */
  onAfterLoad?: (context: AfterLoadContext<T>) => void | Promise<void>
  /** Hook called on error */
  onError?: (context: ErrorContext<T>) => void | Promise<void>
  /** Function to check if subset is already loaded (returns true to skip loading) */
  isSubsetLoaded?: (options: LoadSubsetOptions<T>) => boolean
  /** Skip documents that already exist in the collection state */
  skipExisting?: boolean
}

/**
 * Configuration for direct load subset call.
 * @typeParam T - The document type
 */
export interface HandleLoadSubsetConfig<T = unknown> {
  /** RPC client for MongoDB operations */
  rpcClient: RpcClient
  /** Target database name */
  database: string
  /** Target collection name */
  collection: string
  /** Load subset options */
  options: LoadSubsetOptions<T>
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Checks if an error is retryable (transient network error, etc.).
 * @param error - The error to check
 * @returns True if the error is retryable
 */
function isRetryableError(error: Error): boolean {
  const retryablePatterns = [
    'network',
    'connection',
    'timeout',
    'temporarily unavailable',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
  ]

  const lowerMessage = error.message.toLowerCase()
  return retryablePatterns.some((pattern) => lowerMessage.includes(pattern.toLowerCase()))
}

/**
 * Delays execution for a specified duration.
 * @param ms - Milliseconds to delay
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Executes an operation with retry logic.
 * @param operation - The operation to execute
 * @param config - Retry configuration
 * @returns The operation result
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const maxRetries = config.maxRetries ?? 0
  const initialDelayMs = config.initialDelayMs ?? 100
  const maxDelayMs = config.maxDelayMs ?? 5000
  const backoffMultiplier = config.backoffMultiplier ?? 2

  let lastError: Error | undefined
  let currentDelay = initialDelayMs

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      lastError = err

      // Don't retry non-retryable errors
      if (!isRetryableError(err)) {
        throw err
      }

      // Don't retry if we've exhausted retries
      if (attempt >= maxRetries) {
        throw err
      }

      // Wait before retrying
      await delay(currentDelay)
      currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs)
    }
  }

  throw lastError ?? new Error('Unknown error during retry')
}

/**
 * Converts SortSpec to MongoDB sort format.
 * @param orderBy - Sort specification
 * @returns MongoDB sort object
 */
function convertSortSpec(orderBy: SortSpec): Record<string, number> {
  const sort: Record<string, number> = {}

  for (const [field, direction] of Object.entries(orderBy)) {
    if (direction === 'asc' || direction === 1) {
      sort[field] = 1
    } else if (direction === 'desc' || direction === -1) {
      sort[field] = -1
    }
  }

  return sort
}

/**
 * Gets the sort direction for the primary sort field.
 * @param orderBy - Sort specification
 * @returns 1 for ascending, -1 for descending
 */
function getPrimarySortDirection(orderBy?: SortSpec): number {
  if (!orderBy) return 1

  const firstEntry = Object.entries(orderBy)[0]
  if (!firstEntry) return 1

  const [, direction] = firstEntry
  return direction === 'desc' || direction === -1 ? -1 : 1
}

/**
 * Builds the filter for cursor-based pagination.
 * @param options - Load subset options
 * @returns Filter object for cursor pagination
 */
function buildCursorFilter<T>(options: LoadSubsetOptions<T>): Record<string, unknown> | null {
  if (options.cursor === undefined) {
    return null
  }

  const cursorField = options.cursorField ?? '_id'
  const sortDirection = getPrimarySortDirection(options.orderBy)

  // For ascending sort, use $gt; for descending, use $lt
  const operator = sortDirection === 1 ? '$gt' : '$lt'

  return {
    [cursorField]: { [operator]: options.cursor },
  }
}

/**
 * Merges cursor filter with existing where conditions.
 * @param where - Existing where conditions
 * @param cursorFilter - Cursor filter to merge
 * @returns Merged filter object
 */
function mergeFilters<T>(
  where?: MongoFilterQuery<T>,
  cursorFilter?: Record<string, unknown> | null
): Record<string, unknown> | undefined {
  if (!where && !cursorFilter) {
    return undefined
  }

  if (!cursorFilter) {
    return where as Record<string, unknown>
  }

  if (!where) {
    return cursorFilter
  }

  return {
    ...where,
    ...cursorFilter,
  }
}

// =============================================================================
// Handler Factory
// =============================================================================

/**
 * Creates a load subset handler for TanStack DB.
 *
 * The handler is used in 'on-demand' and 'progressive' sync modes to load
 * specific subsets of data based on query parameters.
 *
 * @typeParam T - The document type
 * @param config - Handler configuration
 * @returns A handler function compatible with TanStack DB's loadSubset
 *
 * @throws {Error} If rpcClient is not provided
 * @throws {Error} If database is not provided or empty
 * @throws {Error} If collection is not provided or empty
 * @throws {Error} If getKey is not provided
 *
 * @example Basic usage
 * ```typescript
 * const loadSubset = createLoadSubsetHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   getKey: (user) => user._id,
 *   syncParams: params,
 * })
 *
 * // Load users with filters
 * await loadSubset({
 *   where: { status: 'active' },
 *   orderBy: { createdAt: 'desc' },
 *   limit: 20,
 * })
 * ```
 *
 * @example With hooks
 * ```typescript
 * const loadSubset = createLoadSubsetHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   getKey: (user) => user._id,
 *   syncParams: params,
 *   onBeforeLoad: ({ options }) => {
 *     console.log('Loading subset:', options)
 *     // Can transform options
 *     return { ...options, limit: Math.min(options.limit ?? 100, 50) }
 *   },
 *   onAfterLoad: ({ documents, count }) => {
 *     console.log(`Loaded ${count} documents`)
 *   },
 * })
 * ```
 *
 * @example With retry configuration
 * ```typescript
 * const loadSubset = createLoadSubsetHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   getKey: (user) => user._id,
 *   syncParams: params,
 *   retryConfig: {
 *     maxRetries: 3,
 *     initialDelayMs: 100,
 *   },
 * })
 * ```
 */
export function createLoadSubsetHandler<T extends { _id?: string } = { _id?: string }>(
  config: LoadSubsetHandlerConfig<T>
): (options: LoadSubsetOptions<T>) => true | Promise<void> {
  // Validate configuration
  if (!config.rpcClient) {
    throw new Error('rpcClient is required')
  }
  if (!config.database) {
    throw new Error('database is required')
  }
  if (!config.collection) {
    throw new Error('collection is required')
  }
  if (!config.getKey) {
    throw new Error('getKey is required')
  }

  const {
    rpcClient,
    database,
    collection,
    getKey,
    syncParams,
    retryConfig,
    onBeforeLoad,
    onAfterLoad,
    onError,
    isSubsetLoaded,
    skipExisting,
  } = config

  /**
   * The handler function for loading subsets.
   */
  return async function loadSubsetHandler(
    options: LoadSubsetOptions<T>
  ): Promise<void> | true {
    // Check if subset is already loaded
    if (isSubsetLoaded && isSubsetLoaded(options)) {
      return true
    }

    // Transform options via hook
    let effectiveOptions = options
    if (onBeforeLoad) {
      const transformed = await onBeforeLoad({ options })
      if (transformed) {
        effectiveOptions = transformed
      }
    }

    // Build query parameters
    // If predicate is provided, compile it (takes precedence over where)
    let whereFilter: MongoFilterQuery<T> | undefined
    if (effectiveOptions.predicate) {
      whereFilter = compilePredicate<T>(effectiveOptions.predicate)
    } else if (effectiveOptions.where) {
      whereFilter = effectiveOptions.where
    }

    const cursorFilter = buildCursorFilter(effectiveOptions)
    const filter = mergeFilters(whereFilter, cursorFilter)
    const sort = effectiveOptions.orderBy ? convertSortSpec(effectiveOptions.orderBy) : undefined

    const queryParams: Record<string, unknown> = {
      database,
      collection,
    }

    if (filter) {
      queryParams.filter = filter
    }

    if (sort) {
      queryParams.sort = sort
    }

    if (effectiveOptions.limit !== undefined) {
      queryParams.limit = effectiveOptions.limit
    }

    if (effectiveOptions.offset !== undefined) {
      queryParams.skip = effectiveOptions.offset
    }

    const executeLoad = async (): Promise<T[]> => {
      const result = await rpcClient.rpc('find', queryParams)
      return (result as T[]) ?? []
    }

    try {
      const documents = await withRetry(executeLoad, retryConfig)

      // Write documents to collection via syncParams
      if (syncParams) {
        syncParams.begin()

        const existingState = syncParams.collection.state()

        for (const doc of documents) {
          const key = getKey(doc)
          const exists = existingState.has(key)

          // Skip existing documents if configured
          if (skipExisting && exists) {
            continue
          }

          const messageType = exists && !skipExisting ? 'update' : 'insert'

          syncParams.write({
            type: messageType,
            key,
            value: doc,
          })
        }

        syncParams.commit()
      }

      // Call onAfterLoad hook
      if (onAfterLoad) {
        await onAfterLoad({
          documents,
          count: documents.length,
        })
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // Call onError hook
      if (onError) {
        await onError({
          error: err,
          options: effectiveOptions,
        })
      }

      throw err
    }
  }
}

// =============================================================================
// Direct Handler Function
// =============================================================================

/**
 * Directly handles a load subset operation without TanStack DB integration.
 *
 * This function provides a lower-level API for loading documents when
 * you don't have a TanStack DB sync context.
 *
 * @typeParam T - The document type
 * @param config - Configuration including load options
 * @returns Result of the load operation
 *
 * @example Load documents with filters
 * ```typescript
 * const result = await handleLoadSubset<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   options: {
 *     where: { status: 'active' },
 *     orderBy: { createdAt: 'desc' },
 *     limit: 20,
 *   },
 * })
 *
 * if (result.success) {
 *   console.log('Loaded:', result.count, 'documents')
 *   console.log('Documents:', result.documents)
 * }
 * ```
 *
 * @example With pagination
 * ```typescript
 * const result = await handleLoadSubset<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   options: {
 *     limit: 20,
 *     offset: 40, // Skip first 40 documents
 *   },
 * })
 * ```
 */
export async function handleLoadSubset<T extends { _id?: string } = { _id?: string }>(
  config: HandleLoadSubsetConfig<T>
): Promise<LoadSubsetResult<T>> {
  const { rpcClient, database, collection, options } = config

  // Check connection status if available
  if (rpcClient.isConnected && !rpcClient.isConnected()) {
    return {
      success: false,
      error: new Error('RPC client is not connected'),
    }
  }

  // Build query parameters
  // If predicate is provided, compile it (takes precedence over where)
  let whereFilter: MongoFilterQuery<T> | undefined
  if (options.predicate) {
    whereFilter = compilePredicate<T>(options.predicate)
  } else if (options.where) {
    whereFilter = options.where
  }

  const cursorFilter = buildCursorFilter(options)
  const filter = mergeFilters(whereFilter, cursorFilter)
  const sort = options.orderBy ? convertSortSpec(options.orderBy) : undefined

  const queryParams: Record<string, unknown> = {
    database,
    collection,
  }

  if (filter) {
    queryParams.filter = filter
  }

  if (sort) {
    queryParams.sort = sort
  }

  if (options.limit !== undefined) {
    queryParams.limit = options.limit
  }

  if (options.offset !== undefined) {
    queryParams.skip = options.offset
  }

  try {
    const result = await rpcClient.rpc('find', queryParams)
    const documents = (result as T[]) ?? []

    return {
      success: true,
      documents,
      count: documents.length,
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    return {
      success: false,
      error: err,
    }
  }
}
