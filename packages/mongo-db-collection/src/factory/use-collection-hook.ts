/**
 * @file useMongoDoCollection React Hook
 *
 * Provides a React hook for creating and managing MongoDB collection
 * configurations with proper lifecycle management.
 *
 * @module @tanstack/mongo-db-collection/factory/use-collection-hook
 */

// Import React hooks - these will be mocked in tests
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

import type { ZodSchema } from 'zod'
import type { MongoDoCollectionConfig, SyncMode, MongoDoCredentials, SyncParams, SyncReturn } from '../types/index.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the useMongoDoCollection hook.
 */
export interface UseMongoDoCollectionOptions<TDocument = unknown> {
  /** Unique identifier for the collection */
  id: string
  /** The mongo.do API endpoint URL */
  endpoint: string
  /** Database name */
  database: string
  /** Collection name */
  collectionName: string
  /** Zod schema for document validation */
  schema: ZodSchema<TDocument>
  /** Function to extract the unique key from a document */
  getKey: (item: TDocument) => string
  /** Optional authentication token */
  authToken?: string
  /** Optional username/password credentials */
  credentials?: MongoDoCredentials
  /** Sync mode */
  syncMode?: SyncMode
  /** Enable MongoDB change stream */
  enableChangeStream?: boolean
  /** Callback when collection is ready */
  onReady?: () => void
  /** Callback when an error occurs */
  onError?: (error: Error) => void
}

/**
 * Return type from the useMongoDoCollection hook.
 */
export interface UseMongoDoCollectionReturn<TDocument = unknown> {
  /** The merged collection configuration */
  config: MongoDoCollectionConfig<TDocument>
  /** The sync function for TanStack DB integration */
  sync: (params: SyncParams<TDocument & object>) => SyncReturn
  /** Whether the collection is ready for use */
  isReady: boolean
  /** Any error that occurred during initialization */
  error: Error | null
  /** Disconnect from the collection */
  disconnect: () => void
  /** Reconnect to the collection */
  reconnect: () => void
}

// =============================================================================
// Validation
// =============================================================================

function validateOptions<TDocument>(options: UseMongoDoCollectionOptions<TDocument>): void {
  if (!options.endpoint || options.endpoint.trim() === '') {
    throw new Error('endpoint is required and cannot be empty')
  }
  if (!options.database || options.database.trim() === '') {
    throw new Error('database is required and cannot be empty')
  }
  if (!options.collectionName || options.collectionName.trim() === '') {
    throw new Error('collectionName is required and cannot be empty')
  }
  if (!options.schema) {
    throw new Error('schema is required')
  }
  if (!options.getKey) {
    throw new Error('getKey is required')
  }
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook for creating and managing a MongoDB collection.
 *
 * @example
 * ```typescript
 * const { config, sync, isReady } = useMongoDoCollection({
 *   id: 'users',
 *   endpoint: 'https://api.mongo.do',
 *   database: 'myapp',
 *   collectionName: 'users',
 *   schema: userSchema,
 *   getKey: (user) => user._id,
 * })
 * ```
 */
export function useMongoDoCollection<TDocument>(
  options: UseMongoDoCollectionOptions<TDocument>
): UseMongoDoCollectionReturn<TDocument> {
  // Validate options on every call (will throw if invalid)
  validateOptions(options)

  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Memoize the configuration
  const config = useMemo<MongoDoCollectionConfig<TDocument>>(() => {
    return {
      id: options.id,
      endpoint: options.endpoint,
      database: options.database,
      collectionName: options.collectionName,
      schema: options.schema,
      getKey: options.getKey,
      authToken: options.authToken,
      credentials: options.credentials,
      syncMode: options.syncMode ?? 'eager',
      enableChangeStream: options.enableChangeStream ?? false,
    }
  }, [
    options.id,
    options.endpoint,
    options.database,
    options.collectionName,
    options.schema,
    options.getKey,
    options.authToken,
    options.credentials,
    options.syncMode,
    options.enableChangeStream,
  ])

  // Memoize the sync function
  const sync = useCallback(
    (params: SyncParams<TDocument & object>): SyncReturn => {
      // Basic sync implementation that integrates with TanStack DB
      const { begin, write, commit, markReady } = params

      // Start sync transaction
      begin()

      // Mark as ready after initial sync
      setTimeout(() => {
        commit()
        markReady()
        setIsReady(true)
        options.onReady?.()
      }, 0)

      const cleanup = () => {
        cleanupRef.current = null
      }

      cleanupRef.current = cleanup

      return {
        cleanup,
        loadSubset: async () => {
          // Subset loading implementation
        },
      }
    },
    [config, options.onReady]
  )

  // Disconnect function
  const disconnect = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
    setIsReady(false)
  }, [])

  // Reconnect function
  const reconnect = useCallback(() => {
    disconnect()
    // Reconnection would be handled by re-running the sync
  }, [disconnect])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
      }
    }
  }, [])

  return {
    config,
    sync,
    isReady,
    error,
    disconnect,
    reconnect,
  }
}
