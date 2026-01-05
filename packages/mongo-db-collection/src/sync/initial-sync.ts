/**
 * Initial Sync Executor
 *
 * This module provides the InitialSyncExecutor class which handles the initial
 * synchronization of MongoDB collections to TanStack DB. It fetches all documents
 * from a MongoDB collection and writes them as insert messages.
 *
 * @module @tanstack/mongo-db-collection/sync/initial-sync
 */

import type { ChangeMessage, SyncParams, MongoFilterQuery } from '../types.js'

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Progress event emitted during sync.
 */
export interface SyncProgressEvent {
  phase: 'starting' | 'fetching' | 'writing' | 'completed' | 'error'
  totalDocuments?: number
  processedDocuments: number
  percentage: number
  currentBatch?: number
  totalBatches?: number
  error?: Error
}

/**
 * Progress callback function type.
 */
export type ProgressCallback = (event: SyncProgressEvent) => void

/**
 * RPC client interface for MongoDB operations.
 */
export interface RpcClient {
  find: (params: FindParams) => Promise<FindResult<unknown>>
  count: (params: CountParams) => Promise<number>
}

/**
 * Parameters for find operation.
 */
export interface FindParams {
  database: string
  collection: string
  filter?: Record<string, unknown>
  projection?: Record<string, unknown>
  sort?: Record<string, number>
  limit?: number
  cursor?: string
}

/**
 * Parameters for count operation.
 */
export interface CountParams {
  database: string
  collection: string
  filter?: Record<string, unknown>
}

/**
 * Result from find operation.
 */
export interface FindResult<T> {
  documents: T[]
  hasMore: boolean
  cursor?: string
}

/**
 * Configuration options for InitialSyncExecutor.
 */
export interface InitialSyncExecutorConfig<T extends object = object> {
  /** RPC client for MongoDB operations */
  rpcClient: RpcClient
  /** Database name */
  database: string
  /** Collection name */
  collection: string
  /** Batch size for pagination (default: 1000) */
  batchSize?: number
  /** Function to extract document key (default: doc._id) */
  getKey?: (doc: T) => string
  /** Number of retries on failure (default: 3) */
  retries?: number
  /** Delay between retries in milliseconds (default: 1000) */
  retryDelayMs?: number
  /** Use exponential backoff for retries */
  useExponentialBackoff?: boolean
  /** Progress callback */
  onProgress?: ProgressCallback
  /** Filter query for initial sync */
  filter?: MongoFilterQuery<T>
  /** Projection for fetched documents */
  projection?: Record<string, unknown>
}

/**
 * Options for execute method.
 */
export interface ExecuteOptions {
  /** AbortSignal for cancellation */
  signal?: AbortSignal
}

/**
 * Result from execute method.
 */
export interface ExecuteResult {
  /** Total number of documents synced */
  totalDocuments: number
  /** Number of batches processed */
  batchCount: number
  /** Duration in milliseconds */
  durationMs: number
  /** Whether sync completed successfully */
  success: boolean
}

// =============================================================================
// Default Key Extractor
// =============================================================================

/**
 * Default function to extract key from document.
 */
function defaultGetKey<T extends object>(doc: T): string {
  return (doc as { _id?: string })._id ?? ''
}

// =============================================================================
// InitialSyncExecutor Class
// =============================================================================

/**
 * Handles initial synchronization of MongoDB collections to TanStack DB.
 *
 * This class fetches all documents from a MongoDB collection and writes them
 * as insert messages to TanStack DB, handling pagination and reporting progress.
 *
 * @typeParam T - The document type
 *
 * @example
 * ```typescript
 * const executor = new InitialSyncExecutor<User>({
 *   rpcClient: client,
 *   database: 'mydb',
 *   collection: 'users',
 *   batchSize: 500,
 *   onProgress: (event) => console.log(`${event.percentage}% complete`),
 * })
 *
 * await executor.execute(syncParams)
 * ```
 */
export class InitialSyncExecutor<T extends object = object> {
  private readonly rpcClient: RpcClient
  private readonly _database: string
  private readonly _collection: string
  private readonly _batchSize: number
  private readonly _getKey: (doc: T) => string
  private readonly _retries: number
  private readonly _retryDelayMs: number
  private readonly useExponentialBackoff: boolean
  private readonly onProgress?: ProgressCallback
  private readonly filter?: MongoFilterQuery<T>
  private readonly projection?: Record<string, unknown>
  private _isRunning: boolean = false

  /**
   * Creates a new InitialSyncExecutor instance.
   *
   * @param config - Configuration options
   * @throws Error if batchSize is zero or negative
   */
  constructor(config: InitialSyncExecutorConfig<T>) {
    if (config.batchSize !== undefined && config.batchSize <= 0) {
      throw new Error('batchSize must be a positive number')
    }

    this.rpcClient = config.rpcClient
    this._database = config.database
    this._collection = config.collection
    this._batchSize = config.batchSize ?? 1000
    this._getKey = config.getKey ?? defaultGetKey
    this._retries = config.retries ?? 3
    this._retryDelayMs = config.retryDelayMs ?? 1000
    this.useExponentialBackoff = config.useExponentialBackoff ?? false
    this.onProgress = config.onProgress
    this.filter = config.filter
    this.projection = config.projection
  }

  // ===========================================================================
  // Public Properties
  // ===========================================================================

  /** The database name */
  get database(): string {
    return this._database
  }

  /** The collection name */
  get collection(): string {
    return this._collection
  }

  /** The batch size for pagination */
  get batchSize(): number {
    return this._batchSize
  }

  /** The key extraction function */
  get getKey(): (doc: T) => string {
    return this._getKey
  }

  /** The number of retries on failure */
  get retries(): number {
    return this._retries
  }

  /** The delay between retries in milliseconds */
  get retryDelayMs(): number {
    return this._retryDelayMs
  }

  /** Whether the executor is currently running */
  get isRunning(): boolean {
    return this._isRunning
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Executes the initial sync process.
   *
   * @param params - Sync parameters with begin, write, commit, and markReady functions
   * @param options - Optional execution options including AbortSignal
   * @returns Promise resolving to execution result with statistics
   * @throws Error if sync fails after all retries
   * @throws Error if already running
   */
  async execute(params: SyncParams<T>, options?: ExecuteOptions): Promise<ExecuteResult> {
    if (this._isRunning) {
      throw new Error('Initial sync is already running. Cannot run concurrent executions.')
    }

    this._isRunning = true
    const startTime = Date.now()
    let totalDocuments = 0
    let batchCount = 0

    try {
      // Check for cancellation
      this.checkAborted(options?.signal)

      // Report starting phase
      this.reportProgress({
        phase: 'starting',
        processedDocuments: 0,
        percentage: 0,
      })

      // Try to get total count for progress reporting
      let estimatedTotal: number | undefined
      try {
        estimatedTotal = await this.rpcClient.count({
          database: this._database,
          collection: this._collection,
          filter: this.filter as Record<string, unknown>,
        })
      } catch {
        // Count not supported or failed - continue without total
      }

      // Begin transaction
      params.begin()

      // Fetch and write documents
      let cursor: string | undefined
      let hasMore = true

      while (hasMore) {
        // Check for cancellation
        this.checkAborted(options?.signal)

        // Report fetching phase
        batchCount++
        this.reportProgress({
          phase: 'fetching',
          totalDocuments: estimatedTotal,
          processedDocuments: totalDocuments,
          percentage: this.calculatePercentage(totalDocuments, estimatedTotal),
          currentBatch: batchCount,
        })

        // Fetch batch with retries
        const result = await this.fetchWithRetries(cursor, options?.signal)

        // Check for cancellation before processing
        this.checkAborted(options?.signal)

        // Write documents as insert messages
        for (const doc of result.documents as T[]) {
          const message: ChangeMessage<T> = {
            type: 'insert',
            key: this._getKey(doc),
            value: doc,
          }
          params.write(message)
          totalDocuments++
        }

        // Report writing phase
        if (result.documents.length > 0) {
          this.reportProgress({
            phase: 'writing',
            totalDocuments: estimatedTotal,
            processedDocuments: totalDocuments,
            percentage: this.calculatePercentage(totalDocuments, estimatedTotal),
            currentBatch: batchCount,
          })
        }

        hasMore = result.hasMore
        cursor = result.cursor
      }

      // Commit transaction
      params.commit()

      // Mark ready
      params.markReady()

      // Report completion
      this.reportProgress({
        phase: 'completed',
        totalDocuments: totalDocuments,
        processedDocuments: totalDocuments,
        percentage: 100,
        currentBatch: batchCount,
        totalBatches: batchCount,
      })

      return {
        totalDocuments,
        batchCount,
        durationMs: Date.now() - startTime,
        success: true,
      }
    } catch (error) {
      // Report error phase
      this.reportProgress({
        phase: 'error',
        processedDocuments: totalDocuments,
        percentage: this.calculatePercentage(totalDocuments, totalDocuments || 100),
        error: error instanceof Error ? error : new Error(String(error)),
      })

      throw error
    } finally {
      this._isRunning = false
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Fetches a batch of documents with retry logic.
   */
  private async fetchWithRetries(
    cursor: string | undefined,
    signal?: AbortSignal
  ): Promise<FindResult<unknown>> {
    let lastError: Error | undefined
    let attempt = 0
    const maxAttempts = this._retries + 1

    while (attempt < maxAttempts) {
      try {
        this.checkAborted(signal)

        const findParams: FindParams = {
          database: this._database,
          collection: this._collection,
          limit: this._batchSize,
          sort: { _id: 1 },
        }

        if (this.filter) {
          findParams.filter = this.filter as Record<string, unknown>
        }

        if (this.projection) {
          findParams.projection = this.projection
        }

        if (cursor) {
          findParams.cursor = cursor
        }

        return await this.rpcClient.find(findParams)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        attempt++

        if (attempt < maxAttempts) {
          // Wait before retrying
          const delay = this.useExponentialBackoff
            ? this._retryDelayMs * Math.pow(2, attempt - 1)
            : this._retryDelayMs

          await this.delay(delay)
        }
      }
    }

    throw lastError
  }

  /**
   * Checks if the operation has been aborted.
   */
  private checkAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('Initial sync was aborted')
    }
  }

  /**
   * Reports progress through the callback.
   */
  private reportProgress(event: SyncProgressEvent): void {
    if (this.onProgress) {
      this.onProgress(event)
    }
  }

  /**
   * Calculates progress percentage.
   */
  private calculatePercentage(processed: number, total: number | undefined): number {
    if (!total || total === 0) {
      return 0
    }
    return Math.round((processed / total) * 100)
  }

  /**
   * Delays execution for specified milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
