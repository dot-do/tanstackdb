/**
 * @file Batch Update Handler
 *
 * Handles batch update mutations from TanStack DB and persists them to MongoDB via RPC.
 * Supports single updateOne, updateMany, and bulkWrite operations.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/handlers/batch-update-mutation
 */

// =============================================================================
// Types
// =============================================================================

/**
 * RPC client interface for making MongoDB operations.
 */
export interface RpcClient {
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  connect?: () => Promise<void>
  disconnect?: () => Promise<void>
  isConnected?: () => boolean
}

/**
 * Pending mutation from TanStack DB transaction.
 */
export interface PendingMutation<T> {
  mutationId: string
  type: 'insert' | 'update' | 'delete'
  key: string | number
  globalKey?: string
  modified: T
  original: Partial<T>
  changes: Partial<T>
  metadata?: Record<string, unknown>
  syncMetadata?: Record<string, unknown>
  optimistic?: boolean
  createdAt?: Date
  updatedAt?: Date
}

/**
 * Transaction containing pending mutations.
 */
export interface Transaction<T> {
  id: string
  getMutations?: () => PendingMutation<T>[]
  mutations?: PendingMutation<T>[]
}

/**
 * Context passed to the batch update handler by TanStack DB.
 */
export interface BatchUpdateMutationContext<T> {
  transaction: Transaction<T>
  collection?: unknown
}

/**
 * Single batch update operation.
 */
export interface BatchUpdateOperation {
  filter: Record<string, unknown>
  update: Record<string, unknown>
  updateMany?: boolean
  upsert?: boolean
  arrayFilters?: Record<string, unknown>[]
}

/**
 * Result of a batch update operation.
 */
export interface BatchUpdateMutationResult {
  success: boolean
  modifiedCount?: number
  matchedCount?: number
  upsertedCount?: number
  upsertedIds?: string[]
  error?: Error
  isWriteConcernError?: boolean
  hasWriteErrors?: boolean
  writeErrors?: Array<{ index: number; code: number; errmsg: string }>
}

/**
 * Retry configuration for transient error handling.
 */
export interface RetryConfig {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
}

/**
 * Hook context for onBeforeUpdate.
 */
export interface BeforeUpdateContext<T> {
  operations: BatchUpdateOperation[]
  transaction: Transaction<T>
}

/**
 * Hook context for onAfterUpdate.
 */
export interface AfterUpdateContext<T> {
  operations: BatchUpdateOperation[]
  result: unknown
  transaction: Transaction<T>
}

/**
 * Hook context for onError.
 */
export interface ErrorContext<T> {
  error: Error
  operations: BatchUpdateOperation[]
  transaction: Transaction<T>
}

/**
 * Configuration for the batch update mutation handler factory.
 */
export interface BatchUpdateMutationHandlerConfig<T = unknown> {
  rpcClient: RpcClient
  database: string
  collection: string
  retryConfig?: RetryConfig
  onBeforeUpdate?: (context: BeforeUpdateContext<T>) => BatchUpdateOperation[] | void | Promise<BatchUpdateOperation[] | void>
  onAfterUpdate?: (context: AfterUpdateContext<T>) => void | Promise<void>
  onError?: (context: ErrorContext<T>) => void | Promise<void>
}

/**
 * Configuration for direct batch update call.
 */
export interface HandleBatchUpdateMutationConfig<T = unknown> {
  rpcClient: RpcClient
  database: string
  collection: string
  operations: BatchUpdateOperation[]
  options?: {
    ordered?: boolean
    writeConcern?: {
      w?: string | number
      j?: boolean
      wtimeout?: number
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get mutations from a transaction (handles both getMutations() method and mutations array).
 */
function getMutationsFromTransaction<T>(transaction: Transaction<T>): PendingMutation<T>[] {
  if (typeof transaction.getMutations === 'function') {
    return transaction.getMutations()
  }
  return transaction.mutations || []
}

/**
 * Check if an error is transient and can be retried.
 */
function isTransientError(error: Error): boolean {
  const message = error.message.toLowerCase()
  // Network-related errors are transient
  if (message.includes('network') ||
      message.includes('timeout') ||
      message.includes('unavailable') ||
      message.includes('connection')) {
    return true
  }
  // Validation errors are NOT transient
  if (message.includes('validation') ||
      message.includes('duplicate') ||
      message.includes('schema')) {
    return false
  }
  return false
}

/**
 * Check if an error is a write concern error.
 */
function isWriteConcernError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return message.includes('write concern')
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Convert a TanStack DB mutation to a batch update operation.
 */
function mutationToOperation<T extends { _id?: string }>(mutation: PendingMutation<T>): BatchUpdateOperation {
  return {
    filter: { _id: mutation.key },
    update: { $set: mutation.changes },
  }
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Creates a batch update mutation handler for TanStack DB.
 *
 * @param config - Configuration options for the handler
 * @returns A handler function that processes batch update mutations
 * @throws Error if required configuration is missing
 */
export function createBatchUpdateMutationHandler<T extends { _id?: string } = { _id?: string }>(
  config: BatchUpdateMutationHandlerConfig<T>
): (context: BatchUpdateMutationContext<T>) => Promise<void> {
  // Validate required configuration
  if (!config.rpcClient) {
    throw new Error('rpcClient is required')
  }
  if (!config.database) {
    throw new Error('database is required')
  }
  if (!config.collection) {
    throw new Error('collection is required')
  }

  const { rpcClient, database, collection, retryConfig, onBeforeUpdate, onAfterUpdate, onError } = config
  const maxRetries = retryConfig?.maxRetries ?? 0
  const initialDelayMs = retryConfig?.initialDelayMs ?? 100

  return async (context: BatchUpdateMutationContext<T>): Promise<void> => {
    const { transaction } = context

    // Get mutations from transaction
    const allMutations = getMutationsFromTransaction(transaction)

    // Filter only update mutations
    const updateMutations = allMutations.filter(m => m.type === 'update')

    // If no update mutations, return early
    if (updateMutations.length === 0) {
      return
    }

    // Convert mutations to operations
    let operations = updateMutations.map(mutationToOperation)

    // Call onBeforeUpdate hook
    if (onBeforeUpdate) {
      const transformed = await onBeforeUpdate({ operations, transaction })
      if (transformed) {
        operations = transformed
      }
    }

    // Execute with retry logic
    let lastError: Error | null = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        let result: unknown

        if (operations.length === 1) {
          // Single update - use updateOne
          const op = operations[0]
          result = await rpcClient.rpc('updateOne', {
            database,
            collection,
            filter: op.filter,
            update: op.update,
          })
        } else {
          // Multiple updates - use bulkWrite
          const bulkOperations = operations.map(op => ({
            updateOne: {
              filter: op.filter,
              update: op.update,
            },
          }))

          result = await rpcClient.rpc('bulkWrite', {
            database,
            collection,
            operations: bulkOperations,
          })
        }

        // Call onAfterUpdate hook
        if (onAfterUpdate) {
          await onAfterUpdate({ operations, result, transaction })
        }

        return
      } catch (error) {
        lastError = error as Error

        // Don't retry non-transient errors
        if (!isTransientError(lastError)) {
          break
        }

        // If we have more retries, wait and try again
        if (attempt < maxRetries) {
          await sleep(initialDelayMs * Math.pow(2, attempt))
        }
      }
    }

    // Call onError hook
    if (onError && lastError) {
      await onError({ error: lastError, operations, transaction })
    }

    // Re-throw the last error
    if (lastError) {
      throw lastError
    }
  }
}

/**
 * Directly handles a batch update operation.
 *
 * @param config - Configuration including RPC client and operations
 * @returns Result of the batch update operation
 */
export async function handleBatchUpdateMutation<T extends { _id?: string } = { _id?: string }>(
  config: HandleBatchUpdateMutationConfig<T>
): Promise<BatchUpdateMutationResult> {
  const { rpcClient, database, collection, operations, options } = config

  // Validate required configuration
  if (!operations) {
    throw new Error('operations is required')
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('operations array cannot be empty')
  }

  // Validate each operation
  for (const op of operations) {
    if (!op.filter) {
      throw new Error('filter is required for each operation')
    }
    if (!op.update) {
      throw new Error('update is required for each operation')
    }
  }

  // Check if client is connected
  if (rpcClient.isConnected && !rpcClient.isConnected()) {
    return {
      success: false,
      error: new Error('RPC client is not connected'),
    }
  }

  try {
    let result: Record<string, unknown>

    if (operations.length === 1) {
      // Single operation
      const op = operations[0]

      if (op.updateMany) {
        // Use updateMany
        result = await rpcClient.rpc('updateMany', {
          database,
          collection,
          filter: op.filter,
          update: op.update,
        }) as Record<string, unknown>
      } else {
        // Use updateOne
        const rpcParams: Record<string, unknown> = {
          database,
          collection,
          filter: op.filter,
          update: op.update,
        }

        // Add upsert if specified
        if (op.upsert !== undefined) {
          rpcParams.upsert = op.upsert
        }

        // Add arrayFilters if specified
        if (op.arrayFilters) {
          rpcParams.arrayFilters = op.arrayFilters
        }

        // Add options if specified
        if (options) {
          rpcParams.options = options
        }

        result = await rpcClient.rpc('updateOne', rpcParams) as Record<string, unknown>
      }
    } else {
      // Multiple operations - use bulkWrite
      const bulkOperations = operations.map(op => {
        const updateOp: Record<string, unknown> = {
          filter: op.filter,
          update: op.update,
        }

        // Add upsert if specified
        if (op.upsert !== undefined) {
          updateOp.upsert = op.upsert
        }

        return { updateOne: updateOp }
      })

      const rpcParams: Record<string, unknown> = {
        database,
        collection,
        operations: bulkOperations,
      }

      // Add options if specified
      if (options) {
        rpcParams.options = options
      }

      result = await rpcClient.rpc('bulkWrite', rpcParams) as Record<string, unknown>
    }

    // Build result
    const batchResult: BatchUpdateMutationResult = {
      success: true,
      modifiedCount: result.modifiedCount as number | undefined,
      matchedCount: result.matchedCount as number | undefined,
      upsertedCount: result.upsertedCount as number | undefined,
    }

    // Check for write errors
    if (result.writeErrors && Array.isArray(result.writeErrors) && result.writeErrors.length > 0) {
      batchResult.hasWriteErrors = true
      batchResult.writeErrors = result.writeErrors as Array<{ index: number; code: number; errmsg: string }>
    }

    return batchResult
  } catch (error) {
    const err = error as Error
    return {
      success: false,
      error: err,
      isWriteConcernError: isWriteConcernError(err),
    }
  }
}
