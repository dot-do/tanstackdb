/**
 * @file Sync Function Implementation
 *
 * This module provides the main `createMongoDoSync` function that creates
 * a sync function matching the TanStack DB interface.
 *
 * The sync function is responsible for:
 * 1. Connecting to the mongo.do API and establishing synchronization
 * 2. Transforming MongoDB change events to TanStack DB format
 * 3. Managing the sync lifecycle (begin/write/commit/markReady)
 * 4. Providing cleanup and optional subset loading capabilities
 *
 * @module @tanstack/mongo-db-collection/sync/sync-function
 */

import type {
  MongoDoCollectionConfig,
  SyncParams,
  SyncReturn,
  ChangeMessage,
  LoadSubsetOptions,
  MongoChangeEvent,
} from '../types.js'

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Internal interface for the RPC client used for testing.
 * @internal
 */
interface RpcClient {
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  isConnected: () => boolean
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  on: (event: string, handler: (...args: unknown[]) => void) => void
  off: (event: string, handler: (...args: unknown[]) => void) => void
}

/**
 * Extended config interface with optional internal RPC client for testing.
 * @internal
 */
interface ExtendedConfig<T> extends MongoDoCollectionConfig<T> {
  _rpcClient?: RpcClient
  connectionTimeout?: number
  batchSize?: number
}

/**
 * MongoDB change stream event structure.
 * @internal
 */
interface ChangeStreamEvent<T> {
  operationType: 'insert' | 'update' | 'delete' | 'replace'
  fullDocument?: T
  documentKey: { _id: string }
  updateDescription?: {
    updatedFields?: Partial<T>
    removedFields?: string[]
  }
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validates the required configuration fields.
 *
 * @param config - The configuration to validate
 * @throws {Error} If required fields are missing
 * @internal
 */
function validateConfig<T>(config: MongoDoCollectionConfig<T>): void {
  if (!config.endpoint) {
    throw new Error('endpoint is required in MongoDoCollectionConfig')
  }
  if (!config.database) {
    throw new Error('database is required in MongoDoCollectionConfig')
  }
  if (!config.collectionName) {
    throw new Error('collectionName is required in MongoDoCollectionConfig')
  }
  if (!config.schema) {
    throw new Error('schema is required in MongoDoCollectionConfig')
  }
  if (!config.getKey) {
    throw new Error('getKey is required in MongoDoCollectionConfig')
  }
}

// =============================================================================
// Transform Functions
// =============================================================================

/**
 * Transforms a MongoDB change stream event to a TanStack DB ChangeMessage.
 *
 * @param event - The MongoDB change stream event
 * @param getKey - Function to extract the document key
 * @returns The transformed ChangeMessage
 * @internal
 */
function transformChangeEvent<T extends { _id: string }>(
  event: ChangeStreamEvent<T>,
  getKey: (doc: T) => string
): ChangeMessage<T> | null {
  const documentKey = event.documentKey._id

  switch (event.operationType) {
    case 'insert':
      if (!event.fullDocument) {
        return null
      }
      return {
        type: 'insert',
        key: getKey(event.fullDocument),
        value: event.fullDocument,
      }

    case 'update':
      if (!event.fullDocument) {
        return null
      }
      return {
        type: 'update',
        key: getKey(event.fullDocument),
        value: event.fullDocument,
      }

    case 'delete':
      return {
        type: 'delete',
        key: documentKey,
        value: { _id: documentKey } as T,
      }

    case 'replace':
      if (!event.fullDocument) {
        return null
      }
      return {
        type: 'update',
        key: getKey(event.fullDocument),
        value: event.fullDocument,
      }

    default:
      return null
  }
}

/**
 * Validates a change stream event has required fields.
 *
 * @param event - The event to validate
 * @returns True if the event is valid
 * @internal
 */
function isValidChangeEvent<T>(event: ChangeStreamEvent<T>): boolean {
  if (!event || !event.operationType || !event.documentKey) {
    return false
  }

  // Insert, update, and replace require fullDocument
  if (
    (event.operationType === 'insert' ||
      event.operationType === 'update' ||
      event.operationType === 'replace') &&
    !event.fullDocument
  ) {
    return false
  }

  return true
}

// =============================================================================
// Main Export
// =============================================================================

/**
 * Creates a sync function for TanStack DB that syncs with a MongoDB collection
 * via the mongo.do API.
 *
 * The returned sync function follows the TanStack DB sync interface:
 * - Accepts SyncParams with begin/write/commit/markReady callbacks
 * - Returns SyncReturn with cleanup and optional loadSubset functions
 *
 * @typeParam T - The document type (must have an _id field)
 *
 * @param config - Configuration for the MongoDB collection sync
 * @returns A sync function compatible with TanStack DB
 *
 * @throws {Error} If required configuration fields are missing
 *
 * @example Basic usage
 * ```typescript
 * import { createMongoDoSync } from '@tanstack/mongo-db-collection'
 *
 * const sync = createMongoDoSync({
 *   id: 'users',
 *   endpoint: 'https://api.mongo.do',
 *   database: 'myapp',
 *   collectionName: 'users',
 *   schema: userSchema,
 *   getKey: (user) => user._id,
 *   syncMode: 'eager',
 *   enableChangeStream: true,
 * })
 *
 * // Use with TanStack DB collection
 * const collection = createCollection({ sync })
 * ```
 */
export function createMongoDoSync<T extends { _id: string }>(
  config: MongoDoCollectionConfig<T>
): (params: SyncParams<T>) => SyncReturn | void {
  // Validate configuration
  validateConfig(config)

  const extendedConfig = config as ExtendedConfig<T>
  const syncMode = config.syncMode ?? 'eager'

  /**
   * The sync function that will be called by TanStack DB.
   */
  return function sync(params: SyncParams<T>): SyncReturn {
    const { begin, write, commit, markReady } = params

    // State management
    let ws: WebSocket | null = null
    let isCleanedUp = false
    let connectionTimeoutId: ReturnType<typeof setTimeout> | null = null
    let isInitialSyncComplete = false

    /**
     * Builds the WebSocket URL for the change stream.
     */
    function buildWebSocketUrl(): string {
      const baseUrl = config.endpoint.replace(/^http/, 'ws')
      const path = `${baseUrl}/changestream/${config.database}/${config.collectionName}`
      const params = new URLSearchParams()

      if (config.authToken) {
        params.set('token', config.authToken)
      }

      return params.toString() ? `${path}?${params}` : path
    }

    /**
     * Performs the initial sync by fetching all documents.
     */
    async function performInitialSync(): Promise<void> {
      if (syncMode === 'on-demand') {
        // In on-demand mode, skip initial load
        begin()
        commit()
        markReady()
        isInitialSyncComplete = true
        return
      }

      const rpcClient = extendedConfig._rpcClient

      if (!rpcClient) {
        // No RPC client provided - just mark ready
        begin()
        commit()
        markReady()
        isInitialSyncComplete = true
        return
      }

      try {
        if (syncMode === 'progressive') {
          // Progressive mode: fetch in batches
          await performProgressiveSync(rpcClient)
        } else {
          // Eager mode: fetch all at once
          await performEagerSync(rpcClient)
        }
      } catch (error) {
        // Error during initial sync - don't mark ready
        console.error('Initial sync error:', error)
        throw error
      }
    }

    /**
     * Performs eager sync - loads all documents at once.
     */
    async function performEagerSync(rpcClient: RpcClient): Promise<void> {
      const documents = (await rpcClient.rpc('find', {
        database: config.database,
        collection: config.collectionName,
      })) as T[]

      begin()

      for (const doc of documents) {
        const message: ChangeMessage<T> = {
          type: 'insert',
          key: config.getKey(doc),
          value: doc,
        }
        write(message)
      }

      commit()
      markReady()
      isInitialSyncComplete = true
    }

    /**
     * Performs progressive sync - loads documents in batches.
     */
    async function performProgressiveSync(rpcClient: RpcClient): Promise<void> {
      const batchSize = extendedConfig.batchSize ?? 100
      let hasMore = true
      let skip = 0

      begin()

      while (hasMore && !isCleanedUp) {
        const documents = (await rpcClient.rpc('find', {
          database: config.database,
          collection: config.collectionName,
          limit: batchSize,
          skip,
        })) as T[]

        for (const doc of documents) {
          const message: ChangeMessage<T> = {
            type: 'insert',
            key: config.getKey(doc),
            value: doc,
          }
          write(message)
        }

        // Advance the skip cursor for the next batch
        skip += documents.length

        // Stop if we received fewer documents than requested (end of data)
        hasMore = documents.length === batchSize

        if (hasMore) {
          // Small delay between batches
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }

      commit()
      markReady()
      isInitialSyncComplete = true
    }

    /**
     * Handles incoming WebSocket messages (change stream events).
     */
    function handleChangeEvent(event: ChangeStreamEvent<T>): void {
      if (isCleanedUp || !isInitialSyncComplete) {
        return
      }

      // Validate the event
      if (!isValidChangeEvent(event)) {
        return
      }

      // Transform and write
      const message = transformChangeEvent(event, config.getKey)
      if (message) {
        begin()
        write(message)
        commit()
      }
    }

    /**
     * Sets up the WebSocket connection for change stream.
     */
    function setupWebSocket(): void {
      if (isCleanedUp) {
        return
      }

      const url = buildWebSocketUrl()
      ws = new WebSocket(url)

      ws.onopen = () => {
        if (isCleanedUp) {
          ws?.close()
          return
        }

        // Clear connection timeout
        if (connectionTimeoutId) {
          clearTimeout(connectionTimeoutId)
          connectionTimeoutId = null
        }

        // Perform initial sync
        performInitialSync().catch((error) => {
          console.error('Initial sync failed:', error)
        })
      }

      ws.onmessage = (event) => {
        if (isCleanedUp) {
          return
        }

        try {
          const data = JSON.parse(event.data) as ChangeStreamEvent<T>
          handleChangeEvent(data)
        } catch (error) {
          console.error('Failed to parse change event:', error)
        }
      }

      ws.onerror = () => {
        // Error handling - don't mark ready on error
        if (connectionTimeoutId) {
          clearTimeout(connectionTimeoutId)
          connectionTimeoutId = null
        }
      }

      ws.onclose = () => {
        // Connection closed
        ws = null
      }

      // Set connection timeout if configured
      if (extendedConfig.connectionTimeout) {
        connectionTimeoutId = setTimeout(() => {
          if (!isInitialSyncComplete && !isCleanedUp) {
            // Connection timed out
            cleanup()
          }
        }, extendedConfig.connectionTimeout)
      }
    }

    /**
     * Cleanup function to stop sync and release resources.
     */
    function cleanup(): void {
      if (isCleanedUp) {
        return
      }

      isCleanedUp = true

      // Clear connection timeout
      if (connectionTimeoutId) {
        clearTimeout(connectionTimeoutId)
        connectionTimeoutId = null
      }

      // Close WebSocket
      if (ws) {
        ws.close()
        ws = null
      }
    }

    /**
     * Loads a subset of data based on filter options.
     * Only available in on-demand mode.
     */
    async function loadSubset(options: LoadSubsetOptions): Promise<void> {
      if (isCleanedUp) {
        return
      }

      const rpcClient = extendedConfig._rpcClient
      if (!rpcClient) {
        throw new Error('RPC client not available')
      }

      // Build RPC params from options
      const rpcParams: Record<string, unknown> = {
        database: config.database,
        collection: config.collectionName,
      }

      // Build filter with cursor support
      let filter: Record<string, unknown> = {}

      if (options.where) {
        filter = { ...options.where }
      }

      // Handle cursor-based pagination
      if (options.cursor !== undefined && options.cursorField) {
        const cursorField = options.cursorField
        // Determine cursor operator based on sort direction
        let isDescending = false
        if (options.orderBy && options.orderBy[cursorField]) {
          const direction = options.orderBy[cursorField]
          isDescending = direction === 'desc' || direction === -1
        }
        // For ascending order, use $gt; for descending, use $lt
        const cursorOperator = isDescending ? '$lt' : '$gt'
        filter[cursorField] = { [cursorOperator]: options.cursor }
      }

      if (Object.keys(filter).length > 0) {
        rpcParams.filter = filter
      }

      if (options.limit !== undefined) {
        rpcParams.limit = options.limit
      }

      if (options.offset !== undefined) {
        rpcParams.skip = options.offset
      }

      if (options.orderBy) {
        // Convert orderBy to MongoDB sort format
        const sort: Record<string, number> = {}
        for (const [field, direction] of Object.entries(options.orderBy)) {
          sort[field] = direction === 'asc' || direction === 1 ? 1 : -1
        }
        rpcParams.sort = sort
      }

      const documents = (await rpcClient.rpc('find', rpcParams)) as T[]

      // Check again after async operation
      if (isCleanedUp) {
        return
      }

      begin()

      for (const doc of documents) {
        const message: ChangeMessage<T> = {
          type: 'insert',
          key: config.getKey(doc),
          value: doc,
        }
        write(message)
      }

      commit()
    }

    // Start the sync process
    setupWebSocket()

    // Build return object
    const result: SyncReturn = {
      cleanup,
    }

    // Add loadSubset for on-demand mode
    if (syncMode === 'on-demand') {
      result.loadSubset = loadSubset
    }

    return result
  }
}
