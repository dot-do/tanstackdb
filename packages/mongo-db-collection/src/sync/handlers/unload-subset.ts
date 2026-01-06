/**
 * @file Unload Subset Handler
 *
 * Handles notifications when a data subset is no longer needed by the client.
 * This is the handler that is called when a TanStack DB subscription is cleaned up
 * and the data it loaded is no longer needed.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/handlers/unload-subset
 *
 * @remarks
 * The unload subset handler:
 * - Receives notifications when subsets are no longer needed
 * - Optionally notifies the server to stop sending updates for that subset
 * - Provides hooks for cleanup operations
 * - Supports tracking of unloaded subsets for debugging/analytics
 *
 * @example Basic usage
 * ```typescript
 * import { createUnloadSubsetHandler } from '@tanstack/mongo-db-collection'
 *
 * const handler = createUnloadSubsetHandler({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 * })
 *
 * // Use with TanStack DB collection config
 * const syncResult = {
 *   unloadSubset: handler,
 * }
 * ```
 */

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
 * Sort direction values for orderBy.
 */
type SortDirection = 'asc' | 'desc' | 1 | -1

/**
 * Sort specification for ordering results.
 */
type SortSpec = Record<string, SortDirection>

/**
 * Cursor value type for pagination.
 */
type CursorValue = string | number | Date

/**
 * Options identifying the subset being unloaded.
 * These should match the options used when the subset was loaded.
 * @typeParam T - The document type (optional, defaults to Record<string, unknown>)
 */
export interface UnloadSubsetOptions<T = Record<string, unknown>> {
  /** Filter conditions that identified the loaded subset */
  where?: Record<string, unknown>
  /** Sort order used when loading the subset */
  orderBy?: SortSpec
  /** Limit used when loading the subset */
  limit?: number
  /** Offset used when loading the subset */
  offset?: number
  /** Cursor used for pagination */
  cursor?: CursorValue
  /** Field used for cursor-based pagination */
  cursorField?: string
  /** Reference to the subscription that loaded this subset */
  subscription?: unknown
}

/**
 * Context passed to the unload subset handler.
 * @typeParam T - The document type
 */
export interface UnloadSubsetContext<T = Record<string, unknown>> {
  /** Options identifying the subset being unloaded */
  options: UnloadSubsetOptions<T>
}

/**
 * Hook context for onBeforeUnload.
 * @typeParam T - The document type
 */
export interface BeforeUnloadContext<T = Record<string, unknown>> {
  /** Options identifying the subset being unloaded */
  options: UnloadSubsetOptions<T>
}

/**
 * Hook context for onAfterUnload.
 * @typeParam T - The document type
 */
export interface AfterUnloadContext<T = Record<string, unknown>> {
  /** Options identifying the subset being unloaded */
  options: UnloadSubsetOptions<T>
}

/**
 * Hook context for onError.
 * @typeParam T - The document type
 */
export interface ErrorContext<T = Record<string, unknown>> {
  /** The error that occurred */
  error: Error
  /** Options identifying the subset being unloaded */
  options: UnloadSubsetOptions<T>
}

/**
 * Configuration for the unload subset handler factory.
 * @typeParam T - The document type
 */
export interface UnloadSubsetHandlerConfig<T = Record<string, unknown>> {
  /** RPC client for MongoDB operations */
  rpcClient: RpcClient
  /** Target database name */
  database: string
  /** Target collection name */
  collection: string
  /** Hook called before unloading the subset (can cancel by throwing) */
  onBeforeUnload?: (context: BeforeUnloadContext<T>) => void
  /** Hook called after successful unload */
  onAfterUnload?: (context: AfterUnloadContext<T>) => void
  /** Hook called on error */
  onError?: (context: ErrorContext<T>) => void
  /** Whether to notify the server about the unload (default: false) */
  notifyServer?: boolean
  /** Whether to track unloaded subsets for debugging (default: false) */
  trackSubsets?: boolean
}

/**
 * Configuration for direct unload subset call.
 * @typeParam T - The document type
 */
export interface HandleUnloadSubsetConfig<T = Record<string, unknown>> {
  /** RPC client for MongoDB operations */
  rpcClient: RpcClient
  /** Target database name */
  database: string
  /** Target collection name */
  collection: string
  /** Options identifying the subset being unloaded */
  options: UnloadSubsetOptions<T>
}

/**
 * Extended handler type with tracking capabilities.
 */
export interface UnloadSubsetHandler<T = Record<string, unknown>> {
  /** Handle the unload subset notification */
  (options: UnloadSubsetOptions<T>): void
  /** Get all tracked unloaded subsets (only when trackSubsets is enabled) */
  getUnloadedSubsets?: () => UnloadSubsetOptions<T>[]
  /** Clear all tracked subsets (only when trackSubsets is enabled) */
  clearTracking?: () => void
}

// =============================================================================
// Handler Factory
// =============================================================================

/**
 * Creates an unload subset handler for TanStack DB.
 *
 * The handler is called when a TanStack DB subscription is cleaned up
 * and the data it loaded is no longer needed. This allows the sync layer
 * to optionally notify the server to stop sending updates for that subset.
 *
 * @typeParam T - The document type
 * @param config - Handler configuration
 * @returns A handler function compatible with TanStack DB's unloadSubset
 *
 * @throws {Error} If rpcClient is not provided
 * @throws {Error} If database is not provided or empty
 * @throws {Error} If collection is not provided or empty
 *
 * @example Basic usage
 * ```typescript
 * const handler = createUnloadSubsetHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 * })
 *
 * // Called by TanStack DB when a subscription is cleaned up
 * handler({ where: { status: 'active' } })
 * ```
 *
 * @example With server notification
 * ```typescript
 * const handler = createUnloadSubsetHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   notifyServer: true, // Tell server to stop change stream for this subset
 *   onAfterUnload: ({ options }) => {
 *     console.log('Unloaded subset:', options.where)
 *   },
 * })
 * ```
 *
 * @example With subset tracking
 * ```typescript
 * const handler = createUnloadSubsetHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   trackSubsets: true,
 * })
 *
 * handler({ where: { status: 'active' } })
 * handler({ where: { status: 'inactive' } })
 *
 * // Get all tracked unloads
 * const unloaded = handler.getUnloadedSubsets()
 * console.log('Unloaded subsets:', unloaded)
 * ```
 */
export function createUnloadSubsetHandler<T extends Record<string, unknown> = Record<string, unknown>>(
  config: UnloadSubsetHandlerConfig<T>
): UnloadSubsetHandler<T> {
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

  const {
    rpcClient,
    database,
    collection,
    onBeforeUnload,
    onAfterUnload,
    onError,
    notifyServer = false,
    trackSubsets = false,
  } = config

  // Tracking storage for unloaded subsets
  const unloadedSubsets: UnloadSubsetOptions<T>[] = []

  /**
   * The handler function called by TanStack DB on unload subset.
   */
  function unloadSubsetHandler(options: UnloadSubsetOptions<T>): void {
    // Handle null/undefined options gracefully
    const safeOptions: UnloadSubsetOptions<T> = options ?? {}

    // Call onBeforeUnload hook (can cancel by throwing)
    if (onBeforeUnload) {
      onBeforeUnload({ options: safeOptions })
    }

    // Track the unloaded subset if tracking is enabled
    if (trackSubsets) {
      unloadedSubsets.push({ ...safeOptions })
    }

    // Optionally notify the server about the unload
    if (notifyServer) {
      // Fire-and-forget: don't wait for the RPC to complete
      rpcClient
        .rpc('unsubscribeSubset', {
          database,
          collection,
          ...safeOptions,
        })
        .catch((error) => {
          // Handle error asynchronously
          const err = error instanceof Error ? error : new Error(String(error))
          if (onError) {
            // Call error hook asynchronously
            queueMicrotask(() => {
              onError({ error: err, options: safeOptions })
            })
          }
        })
    }

    // Call onAfterUnload hook
    if (onAfterUnload) {
      onAfterUnload({ options: safeOptions })
    }
  }

  // Add tracking methods if tracking is enabled
  if (trackSubsets) {
    ;(unloadSubsetHandler as UnloadSubsetHandler<T>).getUnloadedSubsets = () => {
      return [...unloadedSubsets]
    }

    ;(unloadSubsetHandler as UnloadSubsetHandler<T>).clearTracking = () => {
      unloadedSubsets.length = 0
    }
  }

  return unloadSubsetHandler as UnloadSubsetHandler<T>
}

// =============================================================================
// Direct Handler Function
// =============================================================================

/**
 * Directly handles an unload subset notification.
 *
 * This function provides a lower-level API for unloading subsets when
 * you don't have a handler instance configured.
 *
 * @typeParam T - The document type
 * @param config - Configuration including the subset options
 *
 * @example
 * ```typescript
 * handleUnloadSubset<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   options: { where: { status: 'active' } },
 * })
 * ```
 */
export function handleUnloadSubset<T extends Record<string, unknown> = Record<string, unknown>>(
  config: HandleUnloadSubsetConfig<T>
): void {
  const { rpcClient, database, collection, options } = config

  // Handle null/undefined options gracefully
  const safeOptions: UnloadSubsetOptions<T> = options ?? {}

  // This is a synchronous no-op unless there's something specific to do
  // The main purpose is to provide a direct API for unloading
  // In this simple implementation, we don't do anything special
  // More advanced implementations might track unloaded subsets or notify servers
}
