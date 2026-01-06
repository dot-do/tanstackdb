/**
 * @file Delete Mutation Handler
 *
 * Handles client-side delete mutations and persists them to MongoDB via RPC.
 * This is the handler that is called when `collection.delete()` is invoked
 * and needs to persist the data to MongoDB.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/handlers/delete-mutation
 *
 * @remarks
 * The delete mutation handler:
 * - Receives pending delete mutations from TanStack DB transactions
 * - Transforms them to MongoDB deleteOne/deleteMany operations
 * - Handles errors and retry logic
 * - Provides hooks for customization
 *
 * @example Basic usage
 * ```typescript
 * import { createDeleteMutationHandler } from '@tanstack/mongo-db-collection'
 *
 * const handler = createDeleteMutationHandler({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 * })
 *
 * // Use with TanStack DB collection config
 * const collectionConfig = {
 *   onDelete: handler,
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
 * Pending mutation from TanStack DB transaction.
 * @typeParam T - The document type
 */
export interface PendingMutation<T> {
  /** Unique mutation identifier */
  mutationId: string
  /** Type of mutation */
  type: 'insert' | 'update' | 'delete'
  /** Document key */
  key: string | number
  /** Global key (includes collection prefix) */
  globalKey?: string
  /** Modified document state */
  modified: T
  /** Original document state */
  original: Partial<T>
  /** Changes made */
  changes: Partial<T>
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Sync metadata */
  syncMetadata?: Record<string, unknown>
  /** Whether this is an optimistic update */
  optimistic?: boolean
  /** Creation timestamp */
  createdAt?: Date
  /** Last update timestamp */
  updatedAt?: Date
}

/**
 * Transaction containing pending mutations.
 * @typeParam T - The document type
 */
export interface Transaction<T> {
  /** Transaction identifier */
  id: string
  /** Get all pending mutations */
  getMutations?: () => PendingMutation<T>[]
  /** Direct access to mutations array */
  mutations?: PendingMutation<T>[]
}

/**
 * Context passed to the delete mutation handler by TanStack DB.
 * @typeParam T - The document type
 */
export interface DeleteMutationContext<T> {
  /** The transaction containing delete mutations */
  transaction: Transaction<T>
  /** Optional collection reference */
  collection?: unknown
}

/**
 * Result of a delete mutation operation.
 */
export interface DeleteMutationResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Deleted document ID (for single delete) */
  deletedId?: string
  /** Deleted document IDs (for bulk delete) */
  deletedIds?: string[]
  /** Number of documents deleted */
  deletedCount?: number
  /** Error if operation failed */
  error?: Error
  /** Whether the document was not found */
  isNotFoundError?: boolean
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
 * Hook context for onBeforeDelete.
 * @typeParam T - The document type
 */
export interface BeforeDeleteContext<T> {
  /** Document keys to be deleted */
  keys: (string | number)[]
  /** Documents to be deleted (original state) */
  documents: Partial<T>[]
  /** The transaction containing mutations */
  transaction: Transaction<T>
}

/**
 * Hook context for onAfterDelete.
 * @typeParam T - The document type
 */
export interface AfterDeleteContext<T> {
  /** Document keys that were deleted */
  keys: (string | number)[]
  /** Documents that were deleted (original state) */
  documents: Partial<T>[]
  /** Result from MongoDB */
  result: unknown
  /** The transaction containing mutations */
  transaction: Transaction<T>
}

/**
 * Hook context for onError.
 * @typeParam T - The document type
 */
export interface ErrorContext<T> {
  /** The error that occurred */
  error: Error
  /** Document keys that failed to delete */
  keys: (string | number)[]
  /** Documents that failed to delete */
  documents: Partial<T>[]
  /** The transaction containing mutations */
  transaction: Transaction<T>
}

/**
 * Configuration for the delete mutation handler factory.
 * @typeParam T - The document type
 */
export interface DeleteMutationHandlerConfig<T = unknown> {
  /** RPC client for MongoDB operations */
  rpcClient: RpcClient
  /** Target database name */
  database: string
  /** Target collection name */
  collection: string
  /** Retry configuration for transient errors */
  retryConfig?: RetryConfig
  /** Hook called before deleting documents (can prevent deletion by throwing) */
  onBeforeDelete?: (context: BeforeDeleteContext<T>) => void | Promise<void>
  /** Hook called after successful delete */
  onAfterDelete?: (context: AfterDeleteContext<T>) => void | Promise<void>
  /** Hook called on error */
  onError?: (context: ErrorContext<T>) => void | Promise<void>
}

/**
 * Configuration for direct delete mutation call.
 * @typeParam T - The document type
 */
export interface HandleDeleteMutationConfig<T = unknown> {
  /** RPC client for MongoDB operations */
  rpcClient: RpcClient
  /** Target database name */
  database: string
  /** Target collection name */
  collection: string
  /** Single document key to delete */
  key?: string | number
  /** Multiple document keys to delete */
  keys?: (string | number)[]
  /** Delete options */
  options?: {
    /** Write concern settings */
    writeConcern?: {
      w?: string | number
      j?: boolean
      wtimeout?: number
    }
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Checks if an error is a not found error.
 * @param error - The error to check
 * @returns True if this is a not found error
 */
function isNotFoundError(error: Error): boolean {
  return error.message.includes('not found') || error.message.includes('does not exist')
}

/**
 * Checks if an error is retryable (transient network error, etc.).
 * @param error - The error to check
 * @returns True if the error is retryable
 */
function isRetryableError(error: Error): boolean {
  // Don't retry not found errors
  if (isNotFoundError(error)) {
    return false
  }

  // Don't retry validation errors
  if (error.message.includes('validation')) {
    return false
  }

  // Retry network-related errors
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

// =============================================================================
// Handler Factory
// =============================================================================

/**
 * Creates a delete mutation handler for TanStack DB.
 *
 * The handler is called when `collection.delete()` is invoked on the client
 * and receives a transaction containing pending delete mutations. It
 * transforms these mutations into MongoDB deleteOne/deleteMany operations.
 *
 * @typeParam T - The document type
 * @param config - Handler configuration
 * @returns A handler function compatible with TanStack DB's onDelete
 *
 * @throws {Error} If rpcClient is not provided
 * @throws {Error} If database is not provided or empty
 * @throws {Error} If collection is not provided or empty
 *
 * @example Basic usage
 * ```typescript
 * const handler = createDeleteMutationHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 * })
 *
 * // The handler is called by TanStack DB when deletes happen
 * await handler({ transaction })
 * ```
 *
 * @example With hooks
 * ```typescript
 * const handler = createDeleteMutationHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   onBeforeDelete: ({ keys, documents }) => {
 *     // Log deletion
 *     console.log('Deleting users:', keys)
 *   },
 *   onAfterDelete: ({ result }) => {
 *     console.log('Deleted:', result)
 *   },
 * })
 * ```
 *
 * @example With retry configuration
 * ```typescript
 * const handler = createDeleteMutationHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   retryConfig: {
 *     maxRetries: 3,
 *     initialDelayMs: 100,
 *   },
 * })
 * ```
 */
export function createDeleteMutationHandler<T extends { _id?: string } = { _id?: string }>(
  config: DeleteMutationHandlerConfig<T>
): (context: DeleteMutationContext<T>) => Promise<void> {
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

  const { rpcClient, database, collection, retryConfig, onBeforeDelete, onAfterDelete, onError } =
    config

  /**
   * The handler function called by TanStack DB on delete mutations.
   */
  return async function deleteMutationHandler(
    context: DeleteMutationContext<T>
  ): Promise<void> {
    const { transaction } = context

    // Get mutations from transaction
    const allMutations = transaction.getMutations?.() ?? transaction.mutations ?? []

    // Filter to only delete mutations
    const deleteMutations = allMutations.filter(
      (m): m is PendingMutation<T> & { type: 'delete' } => m.type === 'delete'
    )

    // If no delete mutations, return early
    if (deleteMutations.length === 0) {
      return
    }

    // Extract keys and documents to delete
    const keys = deleteMutations.map((m) => m.key)
    const documents = deleteMutations.map((m) => m.original)

    // Call onBeforeDelete hook (can prevent deletion by throwing)
    if (onBeforeDelete) {
      await onBeforeDelete({ keys, documents, transaction })
    }

    const executeDelete = async (): Promise<unknown> => {
      if (keys.length === 1) {
        // Single document - use deleteOne
        return rpcClient.rpc('deleteOne', {
          database,
          collection,
          filter: { _id: keys[0] },
        })
      } else {
        // Multiple documents - use deleteMany
        return rpcClient.rpc('deleteMany', {
          database,
          collection,
          filter: { _id: { $in: keys } },
        })
      }
    }

    try {
      const result = await withRetry(executeDelete, retryConfig)

      // Call onAfterDelete hook
      if (onAfterDelete) {
        await onAfterDelete({ keys, documents, result, transaction })
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // Call onError hook
      if (onError) {
        await onError({ error: err, keys, documents, transaction })
      }

      throw err
    }
  }
}

// =============================================================================
// Direct Handler Function
// =============================================================================

/**
 * Directly handles a delete mutation without a TanStack DB transaction.
 *
 * This function provides a lower-level API for deleting documents when
 * you don't have a TanStack DB transaction context.
 *
 * @typeParam T - The document type
 * @param config - Configuration including document keys to delete
 * @returns Result of the delete operation
 *
 * @throws {Error} If neither key nor keys is provided
 * @throws {Error} If keys array is empty
 *
 * @example Delete single document
 * ```typescript
 * const result = await handleDeleteMutation<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   key: '123',
 * })
 *
 * if (result.success) {
 *   console.log('Deleted:', result.deletedId)
 * }
 * ```
 *
 * @example Delete multiple documents
 * ```typescript
 * const result = await handleDeleteMutation<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   keys: ['1', '2', '3'],
 * })
 *
 * if (result.success) {
 *   console.log('Deleted:', result.deletedCount, 'documents')
 * }
 * ```
 */
export async function handleDeleteMutation<T extends { _id?: string } = { _id?: string }>(
  config: HandleDeleteMutationConfig<T>
): Promise<DeleteMutationResult> {
  const { rpcClient, database, collection, key, keys, options } = config

  // Check connection status if available
  if (rpcClient.isConnected && !rpcClient.isConnected()) {
    return {
      success: false,
      error: new Error('RPC client is not connected'),
    }
  }

  // Validate input
  const keysToDelete = keys ?? (key !== undefined ? [key] : null)

  if (!keysToDelete) {
    throw new Error('key or keys is required')
  }

  if (keysToDelete.length === 0) {
    throw new Error('keys array cannot be empty')
  }

  try {
    if (keysToDelete.length === 1) {
      // Single document - use deleteOne
      const params: Record<string, unknown> = {
        database,
        collection,
        filter: { _id: keysToDelete[0] },
      }

      if (options) {
        params.options = options
      }

      const result = (await rpcClient.rpc('deleteOne', params)) as {
        deletedCount?: number
        acknowledged?: boolean
      }

      return {
        success: true,
        deletedId: String(keysToDelete[0]),
        deletedCount: result.deletedCount ?? 1,
      }
    } else {
      // Multiple documents - use deleteMany
      const params: Record<string, unknown> = {
        database,
        collection,
        filter: { _id: { $in: keysToDelete } },
      }

      if (options) {
        params.options = options
      }

      const result = (await rpcClient.rpc('deleteMany', params)) as {
        deletedCount?: number
        acknowledged?: boolean
      }

      return {
        success: true,
        deletedIds: keysToDelete.map(String),
        deletedCount: result.deletedCount ?? keysToDelete.length,
      }
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    return {
      success: false,
      error: err,
      isNotFoundError: isNotFoundError(err),
    }
  }
}
