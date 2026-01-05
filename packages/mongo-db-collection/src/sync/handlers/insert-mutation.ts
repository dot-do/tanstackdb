/**
 * @file Insert Mutation Handler
 *
 * Handles client-side insert mutations and persists them to MongoDB via RPC.
 * This is the handler that is called when `collection.insert()` is invoked
 * and needs to persist the data to MongoDB.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/handlers/insert-mutation
 *
 * @remarks
 * The insert mutation handler:
 * - Receives pending insert mutations from TanStack DB transactions
 * - Transforms them to MongoDB insertOne/insertMany operations
 * - Handles errors and retry logic
 * - Provides hooks for customization
 *
 * @example Basic usage
 * ```typescript
 * import { createInsertMutationHandler } from '@tanstack/mongo-db-collection'
 *
 * const handler = createInsertMutationHandler({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 * })
 *
 * // Use with TanStack DB collection config
 * const collectionConfig = {
 *   onInsert: handler,
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
 * Context passed to the insert mutation handler by TanStack DB.
 * @typeParam T - The document type
 */
export interface InsertMutationContext<T> {
  /** The transaction containing insert mutations */
  transaction: Transaction<T>
  /** Optional collection reference */
  collection?: unknown
}

/**
 * Result of an insert mutation operation.
 */
export interface InsertMutationResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Inserted document ID (for single insert) */
  insertedId?: string
  /** Inserted document IDs (for bulk insert) */
  insertedIds?: string[]
  /** Number of documents inserted */
  insertedCount?: number
  /** Error if operation failed */
  error?: Error
  /** Whether this was a duplicate key error */
  isDuplicateKeyError?: boolean
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
 * Hook context for onBeforeInsert.
 * @typeParam T - The document type
 */
export interface BeforeInsertContext<T> {
  /** Documents to be inserted */
  documents: T[]
  /** The transaction containing mutations */
  transaction: Transaction<T>
}

/**
 * Hook context for onAfterInsert.
 * @typeParam T - The document type
 */
export interface AfterInsertContext<T> {
  /** Documents that were inserted */
  documents: T[]
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
  /** Documents that failed to insert */
  documents: T[]
  /** The transaction containing mutations */
  transaction: Transaction<T>
}

/**
 * Configuration for the insert mutation handler factory.
 * @typeParam T - The document type
 */
export interface InsertMutationHandlerConfig<T = unknown> {
  /** RPC client for MongoDB operations */
  rpcClient: RpcClient
  /** Target database name */
  database: string
  /** Target collection name */
  collection: string
  /** Retry configuration for transient errors */
  retryConfig?: RetryConfig
  /** Hook called before inserting documents (can transform documents) */
  onBeforeInsert?: (context: BeforeInsertContext<T>) => T[] | void | Promise<T[] | void>
  /** Hook called after successful insert */
  onAfterInsert?: (context: AfterInsertContext<T>) => void | Promise<void>
  /** Hook called on error */
  onError?: (context: ErrorContext<T>) => void | Promise<void>
}

/**
 * Configuration for direct insert mutation call.
 * @typeParam T - The document type
 */
export interface HandleInsertMutationConfig<T = unknown> {
  /** RPC client for MongoDB operations */
  rpcClient: RpcClient
  /** Target database name */
  database: string
  /** Target collection name */
  collection: string
  /** Single document to insert */
  document?: T
  /** Multiple documents to insert */
  documents?: T[]
  /** Insert options */
  options?: {
    /** Whether to stop on first error (for insertMany) */
    ordered?: boolean
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
 * Checks if an error is a duplicate key error.
 * @param error - The error to check
 * @returns True if this is a duplicate key error
 */
function isDuplicateKeyError(error: Error): boolean {
  return error.message.includes('E11000') || error.message.includes('duplicate key')
}

/**
 * Checks if an error is retryable (transient network error, etc.).
 * @param error - The error to check
 * @returns True if the error is retryable
 */
function isRetryableError(error: Error): boolean {
  // Don't retry duplicate key errors
  if (isDuplicateKeyError(error)) {
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
 * Creates an insert mutation handler for TanStack DB.
 *
 * The handler is called when `collection.insert()` is invoked on the client
 * and receives a transaction containing pending insert mutations. It
 * transforms these mutations into MongoDB insertOne/insertMany operations.
 *
 * @typeParam T - The document type
 * @param config - Handler configuration
 * @returns A handler function compatible with TanStack DB's onInsert
 *
 * @throws {Error} If rpcClient is not provided
 * @throws {Error} If database is not provided or empty
 * @throws {Error} If collection is not provided or empty
 *
 * @example Basic usage
 * ```typescript
 * const handler = createInsertMutationHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 * })
 *
 * // The handler is called by TanStack DB when inserts happen
 * await handler({ transaction })
 * ```
 *
 * @example With hooks
 * ```typescript
 * const handler = createInsertMutationHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   onBeforeInsert: ({ documents }) => {
 *     // Add timestamps
 *     return documents.map(doc => ({
 *       ...doc,
 *       createdAt: new Date(),
 *     }))
 *   },
 *   onAfterInsert: ({ result }) => {
 *     console.log('Inserted:', result)
 *   },
 * })
 * ```
 *
 * @example With retry configuration
 * ```typescript
 * const handler = createInsertMutationHandler<User>({
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
export function createInsertMutationHandler<T extends { _id?: string } = { _id?: string }>(
  config: InsertMutationHandlerConfig<T>
): (context: InsertMutationContext<T>) => Promise<void> {
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

  const { rpcClient, database, collection, retryConfig, onBeforeInsert, onAfterInsert, onError } =
    config

  /**
   * The handler function called by TanStack DB on insert mutations.
   */
  return async function insertMutationHandler(
    context: InsertMutationContext<T>
  ): Promise<void> {
    const { transaction } = context

    // Get mutations from transaction
    const allMutations = transaction.getMutations?.() ?? transaction.mutations ?? []

    // Filter to only insert mutations
    const insertMutations = allMutations.filter(
      (m): m is PendingMutation<T> & { type: 'insert' } => m.type === 'insert'
    )

    // If no insert mutations, return early
    if (insertMutations.length === 0) {
      return
    }

    // Extract documents to insert
    let documents = insertMutations.map((m) => m.modified)

    // Call onBeforeInsert hook (can transform documents)
    if (onBeforeInsert) {
      const transformed = await onBeforeInsert({ documents, transaction })
      if (transformed) {
        documents = transformed
      }
    }

    const executeInsert = async (): Promise<unknown> => {
      if (documents.length === 1) {
        // Single document - use insertOne
        return rpcClient.rpc('insertOne', {
          database,
          collection,
          document: documents[0],
        })
      } else {
        // Multiple documents - use insertMany
        return rpcClient.rpc('insertMany', {
          database,
          collection,
          documents,
        })
      }
    }

    try {
      const result = await withRetry(executeInsert, retryConfig)

      // Call onAfterInsert hook
      if (onAfterInsert) {
        await onAfterInsert({ documents, result, transaction })
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // Call onError hook
      if (onError) {
        await onError({ error: err, documents, transaction })
      }

      throw err
    }
  }
}

// =============================================================================
// Direct Handler Function
// =============================================================================

/**
 * Directly handles an insert mutation without a TanStack DB transaction.
 *
 * This function provides a lower-level API for inserting documents when
 * you don't have a TanStack DB transaction context.
 *
 * @typeParam T - The document type
 * @param config - Configuration including documents to insert
 * @returns Result of the insert operation
 *
 * @throws {Error} If neither document nor documents is provided
 * @throws {Error} If documents array is empty
 *
 * @example Insert single document
 * ```typescript
 * const result = await handleInsertMutation<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   document: { _id: '123', name: 'John' },
 * })
 *
 * if (result.success) {
 *   console.log('Inserted:', result.insertedId)
 * }
 * ```
 *
 * @example Insert multiple documents
 * ```typescript
 * const result = await handleInsertMutation<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   documents: [
 *     { _id: '1', name: 'John' },
 *     { _id: '2', name: 'Jane' },
 *   ],
 * })
 *
 * if (result.success) {
 *   console.log('Inserted:', result.insertedCount, 'documents')
 * }
 * ```
 */
export async function handleInsertMutation<T extends { _id?: string } = { _id?: string }>(
  config: HandleInsertMutationConfig<T>
): Promise<InsertMutationResult> {
  const { rpcClient, database, collection, document, documents, options } = config

  // Check connection status if available
  if (rpcClient.isConnected && !rpcClient.isConnected()) {
    return {
      success: false,
      error: new Error('RPC client is not connected'),
    }
  }

  // Validate input
  const docsToInsert = documents ?? (document ? [document] : null)

  if (!docsToInsert) {
    throw new Error('document or documents is required')
  }

  if (docsToInsert.length === 0) {
    throw new Error('documents array cannot be empty')
  }

  try {
    if (docsToInsert.length === 1) {
      // Single document - use insertOne
      const params: Record<string, unknown> = {
        database,
        collection,
        document: docsToInsert[0],
      }

      if (options) {
        params.options = options
      }

      const result = (await rpcClient.rpc('insertOne', params)) as { insertedId?: string }

      return {
        success: true,
        insertedId: result.insertedId ?? (docsToInsert[0] as { _id?: string })._id,
        insertedCount: 1,
      }
    } else {
      // Multiple documents - use insertMany
      const params: Record<string, unknown> = {
        database,
        collection,
        documents: docsToInsert,
      }

      if (options) {
        params.options = options
      }

      const result = (await rpcClient.rpc('insertMany', params)) as {
        insertedIds?: string[]
        insertedCount?: number
      }

      return {
        success: true,
        insertedIds: result.insertedIds,
        insertedCount: result.insertedCount ?? docsToInsert.length,
      }
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    return {
      success: false,
      error: err,
      isDuplicateKeyError: isDuplicateKeyError(err),
    }
  }
}
