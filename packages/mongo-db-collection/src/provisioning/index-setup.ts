/**
 * @file Index Setup - TDD (RED Phase Stub)
 *
 * This file provides stub implementations for the Index Setup functionality.
 * Index Setup creates necessary MongoDB indexes for efficient querying during user provisioning.
 *
 * @module @tanstack/mongo-db-collection/provisioning/index-setup
 */

// =============================================================================
// Types
// =============================================================================

export interface IndexDefinition {
  key: Record<string, number | string>
  options?: IndexOptions
}

export interface IndexOptions {
  unique?: boolean
  sparse?: boolean
  expireAfterSeconds?: number
  background?: boolean
  name?: string
  partialFilterExpression?: Record<string, unknown>
}

export interface IndexSetupConfig {
  rpcClient: RpcClient
  database: string
  collection: string
  indexes?: IndexDefinition[]
  options?: SetupOptions
  hooks?: IndexSetupHooks
}

export interface RpcClient {
  rpc: (method: string, params: unknown) => Promise<unknown>
  connect?: () => Promise<void>
  disconnect?: () => Promise<void>
  isConnected?: () => boolean
}

export interface SetupOptions {
  skipExisting?: boolean
  concurrency?: number
  listExisting?: boolean
}

export interface IndexSetupHooks {
  onBeforeCreate?: (info: IndexHookInfo) => void
  onAfterCreate?: (info: IndexAfterCreateInfo) => void
  onError?: (info: IndexErrorInfo) => void
  onComplete?: (summary: IndexCompleteSummary) => void
}

export interface IndexHookInfo {
  database: string
  collection: string
  index: IndexDefinition
}

export interface IndexAfterCreateInfo extends IndexHookInfo {
  result: unknown
}

export interface IndexErrorInfo extends IndexHookInfo {
  error: Error
}

export interface IndexCompleteSummary {
  success: boolean
  indexesCreated: number
  indexesSkipped: number
  indexesFailed: number
}

export interface IndexSetupResult {
  success: boolean
  indexesCreated: number
  indexesSkipped?: number
  error?: Error
  isDuplicateIndexError?: boolean
  existingIndexes?: Array<{ name: string; key: Record<string, number | string>; unique?: boolean }>
}

export type IndexSetupHandler = () => Promise<IndexSetupResult>

// =============================================================================
// Factory Function
// =============================================================================

export function createIndexSetup(config: IndexSetupConfig): IndexSetupHandler {
  // Validate required config
  if (!config.rpcClient) {
    throw new Error('rpcClient is required')
  }
  if (!config.database) {
    throw new Error('database is required')
  }
  if (!config.collection) {
    throw new Error('collection is required')
  }

  return async (): Promise<IndexSetupResult> => {
    return setupIndexes(config)
  }
}

// =============================================================================
// Direct Setup Function
// =============================================================================

export async function setupIndexes(config: IndexSetupConfig): Promise<IndexSetupResult> {
  // Validate required config
  if (!config.rpcClient) {
    throw new Error('rpcClient is required')
  }
  if (!config.database) {
    throw new Error('database is required')
  }
  if (!config.collection) {
    throw new Error('collection is required')
  }
  if (config.indexes === undefined) {
    throw new Error('indexes is required')
  }

  // Validate index keys are not empty
  for (const index of config.indexes) {
    if (Object.keys(index.key).length === 0) {
      throw new Error('index key cannot be empty')
    }
  }

  // Check if client is connected
  if (config.rpcClient.isConnected && !config.rpcClient.isConnected()) {
    return {
      success: false,
      indexesCreated: 0,
      error: new Error('RPC client is not connected'),
    }
  }

  const { rpcClient, database, collection, indexes, options, hooks } = config

  let indexesCreated = 0
  let indexesSkipped = 0
  let indexesFailed = 0
  let lastError: Error | undefined
  let isDuplicateIndexError = false
  let existingIndexes: Array<{ name: string; key: Record<string, number | string>; unique?: boolean }> | undefined

  // Handle listExisting option
  if (options?.listExisting) {
    try {
      existingIndexes = await rpcClient.rpc('listIndexes', {
        database,
        collection,
      }) as Array<{ name: string; key: Record<string, number | string>; unique?: boolean }>
    } catch (error) {
      return {
        success: false,
        indexesCreated: 0,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  // Handle empty indexes array
  if (indexes.length === 0) {
    hooks?.onComplete?.({
      success: true,
      indexesCreated: 0,
      indexesSkipped: 0,
      indexesFailed: 0,
    })
    return {
      success: true,
      indexesCreated: 0,
      indexesSkipped: 0,
      existingIndexes,
    }
  }

  // Helper function to create a single index
  const createSingleIndex = async (index: IndexDefinition): Promise<{ created: boolean; skipped: boolean; error?: Error }> => {
    // Call onBeforeCreate hook
    hooks?.onBeforeCreate?.({
      database,
      collection,
      index,
    })

    try {
      const result = await rpcClient.rpc('createIndex', {
        database,
        collection,
        keys: index.key,
        options: index.options,
      })

      // Call onAfterCreate hook
      hooks?.onAfterCreate?.({
        database,
        collection,
        index,
        result,
      })

      return { created: true, skipped: false }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // Call onError hook
      hooks?.onError?.({
        error: err,
        database,
        collection,
        index,
      })

      // Check if this is a duplicate index error
      const isDuplicate = err.message.includes('Index already exists')

      if (isDuplicate && options?.skipExisting) {
        return { created: false, skipped: true }
      }

      return { created: false, skipped: false, error: err }
    }
  }

  // Process indexes based on concurrency option
  const concurrency = options?.concurrency ?? 1

  if (concurrency === 1) {
    // Sequential processing
    for (const index of indexes) {
      const result = await createSingleIndex(index)
      if (result.created) {
        indexesCreated++
      } else if (result.skipped) {
        indexesSkipped++
      } else if (result.error) {
        indexesFailed++
        lastError = result.error
        isDuplicateIndexError = result.error.message.includes('Index already exists') ||
                                 result.error.message.includes('different options')

        // If skipExisting is not enabled, stop on first error
        if (!options?.skipExisting) {
          break
        }
      }
    }
  } else {
    // Concurrent processing with limited concurrency
    const queue = [...indexes]
    const inProgress: Promise<void>[] = []

    const processNext = async (): Promise<void> => {
      while (queue.length > 0) {
        const index = queue.shift()!
        const result = await createSingleIndex(index)
        if (result.created) {
          indexesCreated++
        } else if (result.skipped) {
          indexesSkipped++
        } else if (result.error) {
          indexesFailed++
          lastError = result.error
          isDuplicateIndexError = result.error.message.includes('Index already exists') ||
                                   result.error.message.includes('different options')
        }
      }
    }

    // Start workers up to concurrency limit
    for (let i = 0; i < Math.min(concurrency, indexes.length); i++) {
      inProgress.push(processNext())
    }

    await Promise.all(inProgress)
  }

  const success = lastError === undefined || (options?.skipExisting === true && indexesCreated > 0) || (options?.skipExisting === true && indexesSkipped === indexes.length)

  // Call onComplete hook
  hooks?.onComplete?.({
    success,
    indexesCreated,
    indexesSkipped,
    indexesFailed,
  })

  const finalResult: IndexSetupResult = {
    success,
    indexesCreated,
    indexesSkipped,
  }

  if (lastError) {
    finalResult.error = lastError
    finalResult.isDuplicateIndexError = isDuplicateIndexError
  }

  if (existingIndexes !== undefined) {
    finalResult.existingIndexes = existingIndexes
  }

  return finalResult
}
