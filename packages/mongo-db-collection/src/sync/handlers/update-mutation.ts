/**
 * @file Update Mutation Handler
 *
 * Handles client-side update mutations and persists them to MongoDB via RPC.
 * This is the handler that is called when `collection.update()` is invoked
 * and needs to persist the data to MongoDB.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/handlers/update-mutation
 *
 * @remarks
 * The update mutation handler:
 * - Receives pending update mutations from TanStack DB
 * - Transforms them to MongoDB updateOne/bulkWrite operations
 * - Handles $set/$unset and array operators
 * - Provides optimistic update callbacks
 * - Supports retry logic with exponential backoff
 * - Manages batching for efficiency
 *
 * @example Basic usage
 * ```typescript
 * import { createUpdateMutationHandler } from '@tanstack/mongo-db-collection'
 *
 * const handler = createUpdateMutationHandler({
 *   endpoint: 'https://api.mongo.do',
 *   database: 'myapp',
 *   collectionName: 'users',
 * }, rpcClient)
 *
 * await handler.update(mutation)
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/**
 * RPC client interface for making MongoDB operations.
 */
interface RpcClient {
  /** Execute an RPC call to MongoDB */
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  /** Check if connected */
  isConnected?: () => boolean
}

/**
 * Update mutation from the client.
 * @typeParam T - The document type
 */
export interface UpdateMutation<T> {
  /** Document key */
  key: string
  /** Previous document value */
  previousValue: T
  /** New document value */
  newValue: T
  /** Fields that were updated */
  updatedFields: Partial<T>
  /** Field names that were removed */
  removedFields: string[]
  /** Timestamp of the mutation */
  timestamp: number
  /** Optional array operations */
  arrayOperations?: Record<string, ArrayOperation>
}

/**
 * Array operation types for MongoDB update operators.
 */
interface ArrayOperation {
  $push?: unknown
  $addToSet?: unknown
  $pull?: unknown
  $pop?: number
}

/**
 * Result of an update mutation operation.
 */
export interface UpdateResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Document key */
  key: string
  /** Whether the operation was acknowledged */
  acknowledged: boolean
  /** Number of documents modified */
  modifiedCount: number
  /** Error if operation failed */
  error?: Error
}

/**
 * Retry configuration for transient error handling.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number
  /** Initial delay between retries in milliseconds */
  retryDelayMs: number
  /** Backoff multiplier */
  backoffMultiplier: number
}

/**
 * Configuration for the update mutation handler.
 * @typeParam T - The document type
 */
export interface UpdateMutationHandlerConfig<T> {
  /** API endpoint */
  endpoint: string
  /** Target database name */
  database: string
  /** Target collection name */
  collectionName: string
  /** Auth token for API requests */
  authToken?: string
  /** Maximum batch size before auto-flush */
  batchSize?: number
  /** Timeout before auto-flush in milliseconds */
  batchTimeoutMs?: number
  /** Retry configuration */
  retryConfig?: RetryConfig
  /** Callback for optimistic updates */
  onOptimisticUpdate?: (mutation: UpdateMutation<T>) => void
  /** Callback when update is confirmed */
  onUpdateConfirmed?: (result: UpdateResult) => void
  /** Callback when update fails */
  onUpdateFailed?: (mutation: UpdateMutation<T>, error: Error) => void
  /** Callback for conflict resolution */
  onConflict?: (mutation: UpdateMutation<T>, serverValue: T) => T | null
}

/**
 * Update mutation handler interface.
 * @typeParam T - The document type
 */
export interface UpdateMutationHandler<T> {
  /** Update a single document */
  update(mutation: UpdateMutation<T>): Promise<UpdateResult>
  /** Update multiple documents */
  updateMany(mutations: UpdateMutation<T>[]): Promise<UpdateResult[]>
  /** Get pending updates */
  getPendingUpdates(): UpdateMutation<T>[]
  /** Check if there are pending updates */
  hasPendingUpdates(): boolean
  /** Flush pending updates immediately */
  flush(): Promise<UpdateResult[]>
  /** Cancel a pending update */
  cancel(key: string): boolean
  /** Cancel all pending updates */
  cancelAll(): void
  /** Destroy the handler */
  destroy(): void
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Creates an update mutation handler for TanStack DB.
 *
 * @typeParam T - The document type
 * @param config - Handler configuration
 * @param rpcClient - Optional RPC client for MongoDB operations
 * @returns An update mutation handler
 *
 * @throws {Error} If endpoint is not provided
 * @throws {Error} If database is not provided
 * @throws {Error} If collectionName is not provided
 */
export function createUpdateMutationHandler<T extends { _id: string }>(
  config: UpdateMutationHandlerConfig<T>,
  rpcClient?: RpcClient
): UpdateMutationHandler<T> {
  // Validate configuration
  if (!config.endpoint) {
    throw new Error('endpoint is required')
  }
  if (!config.database) {
    throw new Error('database is required')
  }
  if (!config.collectionName) {
    throw new Error('collectionName is required')
  }

  const {
    database,
    collectionName,
    authToken,
    batchSize = 1,
    batchTimeoutMs = 0,
    retryConfig,
    onOptimisticUpdate,
    onUpdateConfirmed,
    onUpdateFailed,
    onConflict,
  } = config

  // Internal state
  let isDestroyed = false
  const pendingUpdates: Map<string, {
    mutation: UpdateMutation<T>
    resolve: (result: UpdateResult) => void
    reject: (error: Error) => void
    cancelled?: boolean
  }> = new Map()
  // Track in-flight updates for immediate mode
  const inFlightUpdates: Map<string, UpdateMutation<T>> = new Map()
  let batchTimeout: ReturnType<typeof setTimeout> | null = null

  /**
   * Build MongoDB update document from mutation.
   */
  function buildUpdateDocument(mutation: UpdateMutation<T>): Record<string, unknown> {
    const update: Record<string, unknown> = {}

    // Handle $set for updated fields
    if (Object.keys(mutation.updatedFields).length > 0) {
      update.$set = mutation.updatedFields
    }

    // Handle $unset for removed fields
    if (mutation.removedFields.length > 0) {
      const unset: Record<string, string> = {}
      for (const field of mutation.removedFields) {
        unset[field] = ''
      }
      update.$unset = unset
    }

    // Handle array operations
    const mutationWithArrayOps = mutation as UpdateMutation<T> & { arrayOperations?: Record<string, ArrayOperation> }
    if (mutationWithArrayOps.arrayOperations) {
      for (const [field, ops] of Object.entries(mutationWithArrayOps.arrayOperations)) {
        if (ops.$push !== undefined) {
          update.$push = update.$push ?? {}
          ;(update.$push as Record<string, unknown>)[field] = ops.$push
        }
        if (ops.$addToSet !== undefined) {
          update.$addToSet = update.$addToSet ?? {}
          ;(update.$addToSet as Record<string, unknown>)[field] = ops.$addToSet
        }
        if (ops.$pull !== undefined) {
          update.$pull = update.$pull ?? {}
          ;(update.$pull as Record<string, unknown>)[field] = ops.$pull
        }
        if (ops.$pop !== undefined) {
          update.$pop = update.$pop ?? {}
          ;(update.$pop as Record<string, unknown>)[field] = ops.$pop
        }
      }
    }

    return update
  }

  /**
   * Delay execution for a specified duration.
   */
  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Execute a single update with retry logic.
   */
  async function executeUpdateWithRetry(mutation: UpdateMutation<T>): Promise<UpdateResult> {
    if (!rpcClient) {
      return {
        success: false,
        key: mutation.key,
        acknowledged: false,
        modifiedCount: 0,
        error: new Error('RPC client not available'),
      }
    }

    const maxRetries = retryConfig?.maxRetries ?? 0
    const retryDelayMs = retryConfig?.retryDelayMs ?? 100
    const backoffMultiplier = retryConfig?.backoffMultiplier ?? 2

    let lastError: Error | undefined
    let currentDelay = retryDelayMs

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const updateDoc = buildUpdateDocument(mutation)
        const params: Record<string, unknown> = {
          database,
          collection: collectionName,
          filter: { _id: mutation.key },
          update: updateDoc,
        }

        if (authToken) {
          params.authToken = authToken
        }

        const result = await rpcClient.rpc('updateOne', params) as {
          acknowledged?: boolean
          modifiedCount?: number
        }

        // Check for conflict (modifiedCount === 0 and we have onConflict handler)
        if (result.modifiedCount === 0 && onConflict) {
          // Fetch current server value
          const serverDoc = await rpcClient.rpc('findOne', {
            database,
            collection: collectionName,
            filter: { _id: mutation.key },
          }) as T | null

          if (serverDoc) {
            const resolved = onConflict(mutation, serverDoc)
            if (resolved === null) {
              // Abort the update
              return {
                success: false,
                key: mutation.key,
                acknowledged: true,
                modifiedCount: 0,
              }
            }
            // Retry with resolved value (not implemented in this version)
          }
        }

        return {
          success: true,
          key: mutation.key,
          acknowledged: result.acknowledged ?? true,
          modifiedCount: result.modifiedCount ?? 0,
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        lastError = err

        // Don't retry if we've exhausted retries
        if (attempt >= maxRetries) {
          break
        }

        // Wait before retrying
        await delay(currentDelay)
        currentDelay = currentDelay * backoffMultiplier
      }
    }

    return {
      success: false,
      key: mutation.key,
      acknowledged: false,
      modifiedCount: 0,
      error: lastError,
    }
  }

  /**
   * Execute batch update using bulkWrite.
   */
  async function executeBatchUpdate(mutations: UpdateMutation<T>[]): Promise<UpdateResult[]> {
    if (!rpcClient || mutations.length === 0) {
      return []
    }

    const operations = mutations.map((mutation) => ({
      updateOne: {
        filter: { _id: mutation.key },
        update: buildUpdateDocument(mutation),
      },
    }))

    try {
      const params: Record<string, unknown> = {
        database,
        collection: collectionName,
        operations,
      }

      if (authToken) {
        params.authToken = authToken
      }

      const result = await rpcClient.rpc('bulkWrite', params) as {
        acknowledged?: boolean
        modifiedCount?: number
      }

      // Return success for all mutations
      return mutations.map((mutation) => ({
        success: true,
        key: mutation.key,
        acknowledged: result.acknowledged ?? true,
        modifiedCount: 1,
      }))
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // Return failure for all mutations
      return mutations.map((mutation) => ({
        success: false,
        key: mutation.key,
        acknowledged: false,
        modifiedCount: 0,
        error: err,
      }))
    }
  }

  /**
   * Process pending updates.
   */
  async function processPendingUpdates(): Promise<void> {
    if (pendingUpdates.size === 0) {
      return
    }

    const entries = Array.from(pendingUpdates.entries())
    pendingUpdates.clear()

    if (batchTimeout) {
      clearTimeout(batchTimeout)
      batchTimeout = null
    }

    const mutations = entries.map(([, entry]) => entry.mutation)

    if (mutations.length === 1) {
      // Single update
      const result = await executeUpdateWithRetry(mutations[0]!)
      const entry = entries[0]!

      if (result.success) {
        onUpdateConfirmed?.(result)
        entry[1].resolve(result)
      } else {
        onUpdateFailed?.(entry[1].mutation, result.error ?? new Error('Update failed'))
        entry[1].resolve(result)
      }
    } else {
      // Batch update
      const results = await executeBatchUpdate(mutations)

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!
        const result = results[i]!

        if (result.success) {
          onUpdateConfirmed?.(result)
          entry[1].resolve(result)
        } else {
          onUpdateFailed?.(entry[1].mutation, result.error ?? new Error('Update failed'))
          entry[1].resolve(result)
        }
      }
    }
  }

  /**
   * Schedule batch processing.
   */
  function scheduleBatchProcessing(): void {
    if (batchTimeout || pendingUpdates.size === 0) {
      return
    }

    batchTimeout = setTimeout(() => {
      batchTimeout = null
      processPendingUpdates()
    }, batchTimeoutMs)
  }

  // Handler implementation
  const handler: UpdateMutationHandler<T> = {
    async update(mutation: UpdateMutation<T>): Promise<UpdateResult> {
      if (isDestroyed) {
        throw new Error('Handler has been destroyed')
      }

      // Call optimistic update callback
      onOptimisticUpdate?.(mutation)

      // If batching is configured, use batch mode
      if (batchTimeoutMs > 0 && batchSize > 1) {
        return new Promise((resolve, reject) => {
          pendingUpdates.set(mutation.key, { mutation, resolve, reject })

          // Check if we should flush immediately
          if (pendingUpdates.size >= batchSize) {
            processPendingUpdates()
          } else {
            scheduleBatchProcessing()
          }
        })
      }

      // Execute immediately without batching
      // Track as in-flight
      inFlightUpdates.set(mutation.key, mutation)

      try {
        const result = await executeUpdateWithRetry(mutation)

        // Remove from in-flight if not cancelled
        if (inFlightUpdates.has(mutation.key)) {
          inFlightUpdates.delete(mutation.key)

          if (result.success) {
            onUpdateConfirmed?.(result)
          } else {
            onUpdateFailed?.(mutation, result.error ?? new Error('Update failed'))
          }
        }

        return result
      } catch (error) {
        inFlightUpdates.delete(mutation.key)
        throw error
      }
    },

    async updateMany(mutations: UpdateMutation<T>[]): Promise<UpdateResult[]> {
      if (isDestroyed) {
        throw new Error('Handler has been destroyed')
      }

      return executeBatchUpdate(mutations)
    },

    getPendingUpdates(): UpdateMutation<T>[] {
      const batchedMutations = Array.from(pendingUpdates.values()).map((entry) => entry.mutation)
      const inFlightMutations = Array.from(inFlightUpdates.values())
      return [...batchedMutations, ...inFlightMutations]
    },

    hasPendingUpdates(): boolean {
      return pendingUpdates.size > 0 || inFlightUpdates.size > 0
    },

    async flush(): Promise<UpdateResult[]> {
      const entries = Array.from(pendingUpdates.entries())
      const mutations = entries.map(([, entry]) => entry.mutation)

      if (mutations.length === 0) {
        return []
      }

      pendingUpdates.clear()

      if (batchTimeout) {
        clearTimeout(batchTimeout)
        batchTimeout = null
      }

      const results = await executeBatchUpdate(mutations)

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!
        const result = results[i]!

        if (result.success) {
          onUpdateConfirmed?.(result)
        } else {
          onUpdateFailed?.(entry[1].mutation, result.error ?? new Error('Update failed'))
        }

        entry[1].resolve(result)
      }

      return results
    },

    cancel(key: string): boolean {
      // Check batched updates first
      const batchEntry = pendingUpdates.get(key)
      if (batchEntry) {
        pendingUpdates.delete(key)
        return true
      }
      // Check in-flight updates
      if (inFlightUpdates.has(key)) {
        inFlightUpdates.delete(key)
        return true
      }
      return false
    },

    cancelAll(): void {
      pendingUpdates.clear()
      inFlightUpdates.clear()

      if (batchTimeout) {
        clearTimeout(batchTimeout)
        batchTimeout = null
      }
    },

    destroy(): void {
      isDestroyed = true
      this.cancelAll()
    },
  }

  return handler
}
