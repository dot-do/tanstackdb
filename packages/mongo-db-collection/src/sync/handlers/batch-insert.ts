/**
 * @file Batch Insert Handler
 *
 * Handles client-side batch insert mutations and persists them to MongoDB via RPC.
 * This handler is optimized for bulk insert operations with configurable batch sizes,
 * parallel processing, and progress tracking.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/handlers/batch-insert
 *
 * @remarks
 * The batch insert handler:
 * - Processes insert mutations in configurable batch sizes
 * - Supports parallel batch processing for improved throughput
 * - Provides progress callbacks for monitoring large operations
 * - Handles partial failures with configurable error behavior
 * - Provides hooks for batch-level customization
 *
 * @example Basic usage
 * ```typescript
 * import { createBatchInsertHandler } from '@tanstack/mongo-db-collection'
 *
 * const handler = createBatchInsertHandler({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   batchSize: 100,
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
 * Context passed to the batch insert handler by TanStack DB.
 * @typeParam T - The document type
 */
export interface BatchInsertContext<T> {
  /** The transaction containing insert mutations */
  transaction: Transaction<T>
  /** Optional collection reference */
  collection?: unknown
}

/**
 * Progress information for batch processing.
 */
export interface BatchInsertProgress {
  /** Current batch number (1-indexed) */
  batchNumber: number
  /** Total number of batches */
  totalBatches: number
  /** Number of documents processed so far */
  documentsProcessed: number
  /** Total number of documents to process */
  totalDocuments: number
  /** Percentage complete (0-100) */
  percentComplete: number
}

/**
 * Result for a single batch operation.
 */
export interface BatchResult {
  /** Batch number (1-indexed) */
  batchNumber: number
  /** Whether the batch succeeded */
  success: boolean
  /** Number of documents inserted in this batch */
  insertedCount: number
  /** Inserted document IDs */
  insertedIds?: string[]
  /** Error if batch failed */
  error?: Error
  /** Duration of this batch in milliseconds */
  durationMs?: number
}

/**
 * Failed batch information.
 */
export interface FailedBatch<T> {
  /** Batch number (1-indexed) */
  batchNumber: number
  /** The error that occurred */
  error: Error
  /** Documents in the failed batch */
  documents: T[]
}

/**
 * Statistics about the batch insert operation.
 */
export interface BatchInsertStatistics {
  /** Total number of batches */
  totalBatches: number
  /** Number of successful batches */
  successfulBatches: number
  /** Number of failed batches */
  failedBatches: number
  /** Total number of documents */
  totalDocuments: number
  /** Number of documents inserted */
  insertedDocuments: number
  /** Total duration in milliseconds */
  durationMs: number
  /** Documents processed per second */
  documentsPerSecond: number
}

/**
 * Validation error details.
 */
export interface ValidationError {
  /** Index of the invalid document */
  documentIndex: number
  /** Document ID if available */
  documentId?: string
  /** Error message */
  message: string
  /** Validation rule that failed */
  rule?: string
}

/**
 * Result of a batch insert operation.
 */
export interface BatchInsertResult<T = unknown> {
  /** Whether all batches succeeded */
  success: boolean
  /** Total number of documents inserted */
  insertedCount: number
  /** All inserted document IDs */
  insertedIds?: string[]
  /** Results for each batch */
  batchResults?: BatchResult[]
  /** Failed batches (if continueOnError is true) */
  failedBatches?: FailedBatch<T>[]
  /** Error if operation failed */
  error?: Error
  /** Processing statistics */
  statistics?: BatchInsertStatistics
  /** Whether this was a write concern error */
  isWriteConcernError?: boolean
  /** Whether the operation was cancelled */
  cancelled?: boolean
  /** Validation errors */
  validationErrors?: ValidationError[]
  /** Number of documents skipped due to validation */
  skippedDocuments?: number
  /** Duplicate IDs found */
  duplicateIds?: string[]
  /** Number of duplicates removed */
  deduplicatedCount?: number
}

/**
 * Retry configuration for transient errors.
 */
export interface RetryConfig {
  /** Maximum number of retries (default: 0) */
  maxRetries?: number
  /** Initial delay between retries in ms (default: 100) */
  initialDelayMs?: number
  /** Maximum delay between retries in ms (default: 5000) */
  maxDelayMs?: number
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number
  /** Whether to add jitter to delays (default: false) */
  jitter?: boolean
}

/**
 * Hook context for onBeforeBatch.
 * @typeParam T - The document type
 */
export interface BeforeBatchContext<T> {
  /** Batch number (1-indexed) */
  batchNumber: number
  /** Documents to be inserted in this batch */
  documents: T[]
  /** The transaction containing mutations */
  transaction: Transaction<T>
}

/**
 * Hook context for onAfterBatch.
 * @typeParam T - The document type
 */
export interface AfterBatchContext<T> {
  /** Batch number (1-indexed) */
  batchNumber: number
  /** Documents that were inserted */
  documents: T[]
  /** Result from MongoDB */
  result: unknown
  /** The transaction containing mutations */
  transaction: Transaction<T>
}

/**
 * Hook context for onBatchError.
 * @typeParam T - The document type
 */
export interface BatchErrorContext<T> {
  /** Batch number (1-indexed) */
  batchNumber: number
  /** Documents in the failed batch */
  documents: T[]
  /** The error that occurred */
  error: Error
  /** The transaction containing mutations */
  transaction: Transaction<T>
}

/**
 * Configuration for the batch insert handler factory.
 * @typeParam T - The document type
 */
export interface BatchInsertHandlerConfig<T = unknown> {
  /** RPC client for MongoDB operations */
  rpcClient: RpcClient
  /** Target database name */
  database: string
  /** Target collection name */
  collection: string
  /** Number of documents per batch (default: 100) */
  batchSize?: number
  /** Number of batches to process in parallel (default: 1) */
  concurrency?: number
  /** Whether to use insertOne for single documents (default: true) */
  useSingleInsertForOne?: boolean
  /** Whether to continue processing on batch error (default: false) */
  continueOnError?: boolean
  /** Whether to throw aggregate error after all batches complete (default: false) */
  throwAggregateError?: boolean
  /** Progress callback called after each batch */
  onProgress?: (progress: BatchInsertProgress) => void
  /** Hook called before each batch (can transform documents) */
  onBeforeBatch?: (context: BeforeBatchContext<T>) => T[] | void | Promise<T[] | void>
  /** Hook called after each successful batch */
  onAfterBatch?: (context: AfterBatchContext<T>) => void | Promise<void>
  /** Hook called on batch error */
  onBatchError?: (context: BatchErrorContext<T>) => void | Promise<void>
  /** Retry configuration for transient errors */
  retryConfig?: RetryConfig
  /** Enable streaming mode for large datasets */
  streamingMode?: boolean
  /** Maximum documents to keep in memory */
  maxDocumentsInMemory?: number
  /** Include sync metadata in documents */
  includeSyncMetadata?: boolean
}

/**
 * Validation result from custom validation function.
 */
export interface ValidationResult {
  /** Whether the document is valid */
  valid: boolean
  /** Error message if invalid */
  error?: string
}

/**
 * Configuration for direct batch insert call.
 * @typeParam T - The document type
 */
export interface HandleBatchInsertConfig<T = unknown> {
  /** RPC client for MongoDB operations */
  rpcClient: RpcClient
  /** Target database name */
  database: string
  /** Target collection name */
  collection: string
  /** Documents to insert */
  documents: T[]
  /** Number of documents per batch (default: 100) */
  batchSize?: number
  /** Number of batches to process in parallel (default: 1) */
  concurrency?: number
  /** Whether to use insertOne for single documents (default: true) */
  useSingleInsertForOne?: boolean
  /** Whether to continue processing on batch error (default: false) */
  continueOnError?: boolean
  /** Whether to throw aggregate error after all batches complete (default: false) */
  throwAggregateError?: boolean
  /** Progress callback called after each batch */
  onProgress?: (progress: BatchInsertProgress) => void
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
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Return partial results on cancellation */
  returnPartialOnCancel?: boolean
  /** JSON Schema for validation */
  validationSchema?: Record<string, unknown>
  /** Custom validation function */
  validateDocument?: (doc: T) => ValidationResult
  /** Skip invalid documents instead of failing */
  skipInvalidDocuments?: boolean
  /** Detect duplicate IDs within the batch */
  detectDuplicates?: boolean
  /** Remove duplicates automatically */
  deduplicateById?: boolean
  /** Strategy for deduplication: 'keepFirst' or 'keepLast' */
  deduplicationStrategy?: 'keepFirst' | 'keepLast'
  /** Transform each document before insert */
  transformDocument?: (doc: T) => T | Record<string, unknown>
  /** Add _createdAt and _updatedAt timestamps */
  addTimestamps?: boolean
  /** Generate _id if missing */
  generateId?: boolean
}

// =============================================================================
// Constants
// =============================================================================

/** Default batch size */
const DEFAULT_BATCH_SIZE = 100

/** Default concurrency */
const DEFAULT_CONCURRENCY = 1

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Splits an array into chunks of specified size.
 * @param array - The array to split
 * @param size - The chunk size
 * @returns Array of chunks
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * Processes items in parallel with limited concurrency.
 * @param items - Items to process
 * @param fn - Async function to process each item
 * @param concurrency - Maximum concurrent operations
 * @returns Results in order
 */
async function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  if (concurrency <= 1) {
    // Sequential processing
    const results: R[] = []
    for (let i = 0; i < items.length; i++) {
      results.push(await fn(items[i]!, i))
    }
    return results
  }

  // Parallel processing with limited concurrency
  const results: R[] = new Array(items.length)
  const executing: Promise<void>[] = []

  for (let i = 0; i < items.length; i++) {
    const promise = fn(items[i]!, i).then((result) => {
      results[i] = result
    })

    executing.push(promise)

    if (executing.length >= concurrency) {
      await Promise.race(executing)
      // Remove completed promises
      for (let j = executing.length - 1; j >= 0; j--) {
        if (executing[j] !== undefined) {
          // Check if promise is resolved
          const isResolved = await Promise.race([
            executing[j]!.then(() => true),
            Promise.resolve(false),
          ])
          if (isResolved) {
            executing.splice(j, 1)
          }
        }
      }
    }
  }

  // Wait for remaining promises
  await Promise.all(executing)

  return results
}

/**
 * Checks if an error is a non-retryable error (like duplicate key).
 */
function isNonRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase()
  // E11000 is MongoDB's duplicate key error code
  return message.includes('e11000') || message.includes('duplicate key')
}

/**
 * Checks if an error is a write concern error.
 */
function isWriteConcernError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return message.includes('write concern error') || message.includes('not enough data-bearing nodes')
}

/**
 * Calculates delay with optional exponential backoff and jitter.
 */
function calculateDelay(
  attempt: number,
  config: RetryConfig
): number {
  const {
    initialDelayMs = 100,
    maxDelayMs = 5000,
    backoffMultiplier = 2,
    jitter = false,
  } = config

  let delay = initialDelayMs * Math.pow(backoffMultiplier, attempt)
  delay = Math.min(delay, maxDelayMs)

  if (jitter) {
    // Add random jitter between 0 and 50% of the delay
    delay = delay + Math.random() * delay * 0.5
  }

  return delay
}

/**
 * Executes a function with retry logic.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  const maxRetries = config.maxRetries ?? 0
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry non-retryable errors
      if (isNonRetryableError(lastError)) {
        throw lastError
      }

      // Don't retry if this was the last attempt
      if (attempt === maxRetries) {
        throw lastError
      }

      // Wait before retrying
      const delay = calculateDelay(attempt, config)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError ?? new Error('Unknown error')
}

/**
 * Simple JSON Schema validation.
 */
function validateWithSchema<T>(
  doc: T,
  schema: Record<string, unknown>,
  index: number
): ValidationError | null {
  const properties = schema.properties as Record<string, { type?: string; minLength?: number }> | undefined
  const required = schema.required as string[] | undefined

  const docAny = doc as Record<string, unknown>

  // Check required fields
  if (required) {
    for (const field of required) {
      if (docAny[field] === undefined || docAny[field] === null) {
        return {
          documentIndex: index,
          documentId: docAny._id as string | undefined,
          message: `Missing required field: ${field}`,
          rule: 'required',
        }
      }
    }
  }

  // Check property constraints
  if (properties) {
    for (const [field, constraints] of Object.entries(properties)) {
      const value = docAny[field]
      if (value !== undefined && value !== null) {
        // Check type
        if (constraints.type === 'string' && typeof value !== 'string') {
          return {
            documentIndex: index,
            documentId: docAny._id as string | undefined,
            message: `Field ${field} must be a string`,
            rule: 'type',
          }
        }
        // Check minLength
        if (
          constraints.minLength !== undefined &&
          typeof value === 'string' &&
          value.length < constraints.minLength
        ) {
          return {
            documentIndex: index,
            documentId: docAny._id as string | undefined,
            message: `Field ${field} must have minimum length of ${constraints.minLength}`,
            rule: 'minLength',
          }
        }
      }
    }
  }

  return null
}

/**
 * Generates a simple unique ID.
 */
function generateUniqueId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`
}

// =============================================================================
// Handler Factory
// =============================================================================

/**
 * Creates a batch insert mutation handler for TanStack DB.
 *
 * The handler processes insert mutations in configurable batch sizes,
 * supporting parallel processing and progress tracking for large datasets.
 *
 * @typeParam T - The document type
 * @param config - Handler configuration
 * @returns A handler function compatible with TanStack DB's onInsert
 *
 * @throws {Error} If rpcClient is not provided
 * @throws {Error} If database is not provided or empty
 * @throws {Error} If collection is not provided or empty
 * @throws {Error} If batchSize is not positive
 *
 * @example Basic usage
 * ```typescript
 * const handler = createBatchInsertHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   batchSize: 50,
 * })
 *
 * // The handler is called by TanStack DB when inserts happen
 * await handler({ transaction })
 * ```
 *
 * @example With parallel processing
 * ```typescript
 * const handler = createBatchInsertHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   batchSize: 100,
 *   concurrency: 4, // Process 4 batches in parallel
 * })
 * ```
 *
 * @example With progress tracking
 * ```typescript
 * const handler = createBatchInsertHandler<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   batchSize: 100,
 *   onProgress: (progress) => {
 *     console.log(`${progress.percentComplete}% complete`)
 *   },
 * })
 * ```
 */
export function createBatchInsertHandler<T extends { _id?: string } = { _id?: string }>(
  config: BatchInsertHandlerConfig<T>
): (context: BatchInsertContext<T>) => Promise<void> {
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
  if (config.batchSize !== undefined && config.batchSize <= 0) {
    throw new Error('batchSize must be a positive number')
  }

  const {
    rpcClient,
    database,
    collection,
    batchSize = DEFAULT_BATCH_SIZE,
    concurrency = DEFAULT_CONCURRENCY,
    useSingleInsertForOne = true,
    continueOnError = false,
    throwAggregateError = false,
    onProgress,
    onBeforeBatch,
    onAfterBatch,
    onBatchError,
    retryConfig,
    streamingMode = false,
    includeSyncMetadata = false,
  } = config

  /**
   * The handler function called by TanStack DB on insert mutations.
   */
  return async function batchInsertHandler(context: BatchInsertContext<T>): Promise<void> {
    const { transaction } = context

    // Get mutations from transaction
    const allMutations = transaction.getMutations?.() ?? transaction.mutations ?? []

    // Filter to only insert mutations
    const insertMutations = allMutations.filter(
      (m): m is PendingMutation<T> & { type: 'insert' } => m.type === 'insert'
    )

    // Check if this transaction has a streaming mode document generator
    const transactionAny = transaction as { getDocumentStream?: () => AsyncGenerator<T> }

    // Handle streaming mode
    if (streamingMode && transactionAny.getDocumentStream) {
      const generator = transactionAny.getDocumentStream()
      let currentBatch: T[] = []
      let batchNumber = 0
      let documentsProcessed = 0
      let totalDocumentsEstimate = 0 // Will be updated as we process
      const errors: Error[] = []

      for await (const doc of generator) {
        currentBatch.push(doc)
        totalDocumentsEstimate++

        if (currentBatch.length >= batchSize) {
          batchNumber++
          const batchDocs = currentBatch
          currentBatch = []

          try {
            const rpcCall = async () => {
              return await rpcClient.rpc('insertMany', {
                database,
                collection,
                documents: batchDocs,
              })
            }

            if (retryConfig) {
              await withRetry(rpcCall, retryConfig)
            } else {
              await rpcCall()
            }

            documentsProcessed += batchDocs.length

            if (onProgress) {
              onProgress({
                batchNumber,
                totalBatches: Math.ceil(totalDocumentsEstimate / batchSize),
                documentsProcessed,
                totalDocuments: totalDocumentsEstimate,
                percentComplete: 100, // Unknown for streaming
              })
            }
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error))
            if (continueOnError) {
              errors.push(err)
            } else {
              throw err
            }
          }
        }
      }

      // Process remaining documents
      if (currentBatch.length > 0) {
        batchNumber++
        try {
          const rpcCall = async () => {
            if (useSingleInsertForOne && currentBatch.length === 1) {
              return await rpcClient.rpc('insertOne', {
                database,
                collection,
                document: currentBatch[0],
              })
            }
            return await rpcClient.rpc('insertMany', {
              database,
              collection,
              documents: currentBatch,
            })
          }

          if (retryConfig) {
            await withRetry(rpcCall, retryConfig)
          } else {
            await rpcCall()
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          if (continueOnError) {
            errors.push(err)
          } else {
            throw err
          }
        }
      }

      if (throwAggregateError && errors.length > 0) {
        const messages = errors.map((e) => e.message).join('; ')
        throw new Error(`Batch insert failed with ${errors.length} error(s): ${messages}`)
      }

      return
    }

    // If no insert mutations, return early
    if (insertMutations.length === 0) {
      return
    }

    // Extract documents to insert, optionally including sync metadata
    const documents = insertMutations.map((m) => {
      if (includeSyncMetadata && m.syncMetadata) {
        return {
          ...m.modified,
          _syncMetadata: m.syncMetadata,
        } as T
      }
      return m.modified
    })

    // Split into batches
    const batches = chunk(documents, batchSize)
    const totalBatches = batches.length
    const totalDocuments = documents.length

    const errors: Error[] = []
    let documentsProcessed = 0

    // Process batches
    const processBatch = async (batchDocs: T[], batchIndex: number): Promise<void> => {
      const batchNumber = batchIndex + 1
      let docsToInsert = batchDocs

      // Call onBeforeBatch hook (can transform documents)
      if (onBeforeBatch) {
        const transformed = await onBeforeBatch({
          batchNumber,
          documents: docsToInsert,
          transaction,
        })
        if (transformed) {
          docsToInsert = transformed
        }
      }

      try {
        let result: unknown

        const rpcCall = async () => {
          if (useSingleInsertForOne && docsToInsert.length === 1) {
            // Single document - use insertOne
            return await rpcClient.rpc('insertOne', {
              database,
              collection,
              document: docsToInsert[0],
            })
          } else {
            // Multiple documents - use insertMany
            return await rpcClient.rpc('insertMany', {
              database,
              collection,
              documents: docsToInsert,
            })
          }
        }

        // Execute with or without retry
        if (retryConfig) {
          result = await withRetry(rpcCall, retryConfig)
        } else {
          result = await rpcCall()
        }

        // Call onAfterBatch hook
        if (onAfterBatch) {
          await onAfterBatch({
            batchNumber,
            documents: docsToInsert,
            result,
            transaction,
          })
        }

        documentsProcessed += docsToInsert.length

        // Call progress callback
        if (onProgress) {
          onProgress({
            batchNumber,
            totalBatches,
            documentsProcessed,
            totalDocuments,
            percentComplete: Math.round((documentsProcessed / totalDocuments) * 100),
          })
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))

        // Call onBatchError hook
        if (onBatchError) {
          await onBatchError({
            batchNumber,
            documents: docsToInsert,
            error: err,
            transaction,
          })
        }

        if (continueOnError) {
          errors.push(err)
          // Still update progress even on error
          documentsProcessed += docsToInsert.length
          if (onProgress) {
            onProgress({
              batchNumber,
              totalBatches,
              documentsProcessed,
              totalDocuments,
              percentComplete: Math.round((documentsProcessed / totalDocuments) * 100),
            })
          }
        } else {
          throw err
        }
      }
    }

    // Process all batches with configured concurrency
    await parallelMap(batches, processBatch, concurrency)

    // Throw aggregate error if configured and there were errors
    if (throwAggregateError && errors.length > 0) {
      const messages = errors.map((e) => e.message).join('; ')
      throw new Error(`Batch insert failed with ${errors.length} error(s): ${messages}`)
    }
  }
}

// =============================================================================
// Direct Handler Function
// =============================================================================

/**
 * Directly handles a batch insert operation without a TanStack DB transaction.
 *
 * This function provides a lower-level API for batch inserting documents when
 * you don't have a TanStack DB transaction context.
 *
 * @typeParam T - The document type
 * @param config - Configuration including documents to insert
 * @returns Result of the batch insert operation with detailed statistics
 *
 * @throws {Error} If documents is not provided
 * @throws {Error} If documents array is empty
 *
 * @example Basic batch insert
 * ```typescript
 * const result = await handleBatchInsert<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   documents: users,
 *   batchSize: 50,
 * })
 *
 * if (result.success) {
 *   console.log(`Inserted ${result.insertedCount} documents`)
 * }
 * ```
 *
 * @example With progress tracking
 * ```typescript
 * const result = await handleBatchInsert<User>({
 *   rpcClient: myRpcClient,
 *   database: 'myapp',
 *   collection: 'users',
 *   documents: largeDataset,
 *   batchSize: 100,
 *   onProgress: (progress) => {
 *     console.log(`${progress.percentComplete}% complete`)
 *   },
 * })
 * ```
 */
export async function handleBatchInsert<T extends { _id?: string } = { _id?: string }>(
  config: HandleBatchInsertConfig<T>
): Promise<BatchInsertResult<T>> {
  const {
    rpcClient,
    database,
    collection,
    documents: inputDocuments,
    batchSize = DEFAULT_BATCH_SIZE,
    concurrency = DEFAULT_CONCURRENCY,
    continueOnError = false,
    throwAggregateError = false,
    onProgress,
    options,
    signal,
    returnPartialOnCancel = false,
    validationSchema,
    validateDocument,
    skipInvalidDocuments = false,
    detectDuplicates = false,
    deduplicateById = false,
    deduplicationStrategy = 'keepFirst',
    transformDocument,
    addTimestamps = false,
    generateId = false,
  } = config

  // When transform options are used, always use insertMany for consistency
  const useSingleInsertForOne = config.useSingleInsertForOne !== undefined
    ? config.useSingleInsertForOne
    : !(transformDocument || addTimestamps || generateId || deduplicateById)

  // Check connection status if available
  if (rpcClient.isConnected && !rpcClient.isConnected()) {
    return {
      success: false,
      insertedCount: 0,
      error: new Error('RPC client is not connected'),
    }
  }

  // Validate input
  if (!inputDocuments) {
    throw new Error('documents is required')
  }

  if (inputDocuments.length === 0) {
    throw new Error('documents array cannot be empty')
  }

  const startTime = Date.now()

  // Validation errors collection
  const validationErrors: ValidationError[] = []
  let skippedDocuments = 0

  // Process documents for validation, deduplication, and transformation
  let processedDocuments: T[] = [...inputDocuments]

  // 1. Validate documents
  if (validationSchema || validateDocument) {
    const validDocs: T[] = []
    for (let i = 0; i < processedDocuments.length; i++) {
      const doc = processedDocuments[i]!
      let isValid = true
      let errorMessage: string | undefined

      // Schema validation
      if (validationSchema) {
        const schemaError = validateWithSchema(doc, validationSchema, i)
        if (schemaError) {
          isValid = false
          errorMessage = schemaError.message
          validationErrors.push(schemaError)
        }
      }

      // Custom validation function
      if (isValid && validateDocument) {
        const result = validateDocument(doc)
        if (!result.valid) {
          isValid = false
          errorMessage = result.error || 'Validation failed'
          validationErrors.push({
            documentIndex: i,
            documentId: (doc as Record<string, unknown>)._id as string | undefined,
            message: errorMessage,
          })
        }
      }

      if (isValid) {
        validDocs.push(doc)
      } else if (skipInvalidDocuments) {
        skippedDocuments++
      }
    }

    if (!skipInvalidDocuments && validationErrors.length > 0) {
      return {
        success: false,
        insertedCount: 0,
        validationErrors,
        statistics: {
          totalBatches: 0,
          successfulBatches: 0,
          failedBatches: 0,
          totalDocuments: inputDocuments.length,
          insertedDocuments: 0,
          durationMs: Date.now() - startTime,
          documentsPerSecond: 0,
        },
      }
    }

    processedDocuments = validDocs
  }

  // 2. Handle duplicate detection and deduplication
  let duplicateIds: string[] | undefined
  let deduplicatedCount = 0

  if (detectDuplicates || deduplicateById) {
    const seenIds = new Map<string, number>()
    const duplicates: string[] = []

    for (let i = 0; i < processedDocuments.length; i++) {
      const doc = processedDocuments[i]!
      const docId = (doc as Record<string, unknown>)._id as string | undefined
      if (docId) {
        if (seenIds.has(docId)) {
          duplicates.push(docId)
        } else {
          seenIds.set(docId, i)
        }
      }
    }

    if (duplicates.length > 0) {
      duplicateIds = [...new Set(duplicates)]

      if (detectDuplicates && !deduplicateById) {
        return {
          success: false,
          insertedCount: 0,
          duplicateIds,
          statistics: {
            totalBatches: 0,
            successfulBatches: 0,
            failedBatches: 0,
            totalDocuments: inputDocuments.length,
            insertedDocuments: 0,
            durationMs: Date.now() - startTime,
            documentsPerSecond: 0,
          },
        }
      }

      if (deduplicateById) {
        // Deduplicate based on strategy
        const deduped = new Map<string, T>()
        const nonIdDocs: T[] = []

        for (const doc of processedDocuments) {
          const docId = (doc as Record<string, unknown>)._id as string | undefined
          if (docId) {
            if (deduplicationStrategy === 'keepFirst') {
              if (!deduped.has(docId)) {
                deduped.set(docId, doc)
              } else {
                deduplicatedCount++
              }
            } else {
              // keepLast
              if (deduped.has(docId)) {
                deduplicatedCount++
              }
              deduped.set(docId, doc)
            }
          } else {
            nonIdDocs.push(doc)
          }
        }

        processedDocuments = [...deduped.values(), ...nonIdDocs]
      }
    }
  }

  // 3. Transform documents
  if (transformDocument || addTimestamps || generateId) {
    const now = new Date()
    processedDocuments = processedDocuments.map((doc) => {
      let transformed: Record<string, unknown> = { ...(doc as Record<string, unknown>) }

      // Generate ID if missing
      if (generateId && !transformed._id) {
        transformed._id = generateUniqueId()
      }

      // Add timestamps
      if (addTimestamps) {
        transformed._createdAt = now
        transformed._updatedAt = now
      }

      // Custom transformation
      if (transformDocument) {
        transformed = transformDocument(doc as T) as Record<string, unknown>
      }

      return transformed as T
    })
  }

  // Now we have the final list of documents to insert
  const documents = processedDocuments

  // Split into batches
  const batches = chunk(documents, batchSize)
  const totalBatches = batches.length
  const totalDocuments = documents.length

  const batchResults: BatchResult[] = []
  const failedBatches: FailedBatch<T>[] = []
  const allInsertedIds: string[] = []
  let totalInsertedCount = 0
  let documentsProcessed = 0
  let cancelled = false

  // Process each batch
  const processBatch = async (batchDocs: T[], batchIndex: number): Promise<BatchResult> => {
    const batchNumber = batchIndex + 1
    const batchStartTime = Date.now()

    // Check for cancellation
    if (signal?.aborted) {
      cancelled = true
      const abortError = new Error('Operation aborted')
      if (returnPartialOnCancel) {
        failedBatches.push({
          batchNumber,
          error: abortError,
          documents: batchDocs,
        })
        return {
          batchNumber,
          success: false,
          insertedCount: 0,
          error: abortError,
          durationMs: Date.now() - batchStartTime,
        }
      }
      throw abortError
    }

    try {
      let result: { insertedId?: string; insertedIds?: string[]; insertedCount?: number }

      if (useSingleInsertForOne && batchDocs.length === 1) {
        // Single document - use insertOne
        const params: Record<string, unknown> = {
          database,
          collection,
          document: batchDocs[0],
        }

        if (options) {
          params.options = options
        }

        result = (await rpcClient.rpc('insertOne', params)) as {
          insertedId?: string
        }

        const insertedId = result.insertedId ?? (batchDocs[0] as { _id?: string })._id
        if (insertedId) {
          allInsertedIds.push(insertedId)
        }

        totalInsertedCount += 1
        documentsProcessed += 1
      } else {
        // Multiple documents - use insertMany
        const params: Record<string, unknown> = {
          database,
          collection,
          documents: batchDocs,
        }

        if (options) {
          params.options = options
        }

        result = (await rpcClient.rpc('insertMany', params)) as {
          insertedIds?: string[]
          insertedCount?: number
        }

        // Use batchDocs.length as the count since the call succeeded
        const count = batchDocs.length
        totalInsertedCount += count
        documentsProcessed += batchDocs.length

        if (result.insertedIds) {
          allInsertedIds.push(...result.insertedIds)
        }
      }

      // Call progress callback
      if (onProgress) {
        onProgress({
          batchNumber,
          totalBatches,
          documentsProcessed,
          totalDocuments,
          percentComplete: Math.round((documentsProcessed / totalDocuments) * 100),
        })
      }

      return {
        batchNumber,
        success: true,
        insertedCount: batchDocs.length,
        insertedIds: result.insertedIds ?? (result.insertedId ? [result.insertedId] : undefined),
        durationMs: Date.now() - batchStartTime,
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      documentsProcessed += batchDocs.length

      // Call progress callback even on error
      if (onProgress) {
        onProgress({
          batchNumber,
          totalBatches,
          documentsProcessed,
          totalDocuments,
          percentComplete: Math.round((documentsProcessed / totalDocuments) * 100),
        })
      }

      if (!continueOnError) {
        throw err
      }

      failedBatches.push({
        batchNumber,
        error: err,
        documents: batchDocs,
      })

      return {
        batchNumber,
        success: false,
        insertedCount: 0,
        error: err,
        durationMs: Date.now() - batchStartTime,
      }
    }
  }

  try {
    // Process all batches with configured concurrency
    const results = await parallelMap(batches, processBatch, concurrency)
    batchResults.push(...results)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    const durationMs = Date.now() - startTime

    // Check if it's an abort error
    if (err.message.includes('abort')) {
      cancelled = true
      if (returnPartialOnCancel) {
        return {
          success: false,
          cancelled: true,
          insertedCount: totalInsertedCount,
          insertedIds: allInsertedIds.length > 0 ? allInsertedIds : undefined,
          batchResults: batchResults.length > 0 ? batchResults : undefined,
          failedBatches: failedBatches.length > 0 ? failedBatches : undefined,
          statistics: {
            totalBatches,
            successfulBatches: batchResults.filter((b) => b.success).length,
            failedBatches: batchResults.filter((b) => !b.success).length + 1,
            totalDocuments,
            insertedDocuments: totalInsertedCount,
            durationMs,
            documentsPerSecond: durationMs > 0 ? (totalInsertedCount / durationMs) * 1000 : 0,
          },
        }
      }
      throw err
    }

    // Check for write concern error
    const writeConcernErr = isWriteConcernError(err)

    return {
      success: false,
      insertedCount: totalInsertedCount,
      insertedIds: allInsertedIds.length > 0 ? allInsertedIds : undefined,
      batchResults: batchResults.length > 0 ? batchResults : undefined,
      failedBatches: failedBatches.length > 0 ? failedBatches : undefined,
      error: err,
      isWriteConcernError: writeConcernErr || undefined,
      statistics: {
        totalBatches,
        successfulBatches: batchResults.filter((b) => b.success).length,
        failedBatches: batchResults.filter((b) => !b.success).length + 1,
        totalDocuments,
        insertedDocuments: totalInsertedCount,
        durationMs,
        documentsPerSecond: durationMs > 0 ? (totalInsertedCount / durationMs) * 1000 : 0,
      },
    }
  }

  const durationMs = Date.now() - startTime
  const hasFailures = failedBatches.length > 0

  // Check for write concern errors in failed batches
  let writeConcernError = false
  for (const batch of failedBatches) {
    if (isWriteConcernError(batch.error)) {
      writeConcernError = true
      break
    }
  }

  // Throw aggregate error if configured
  if (throwAggregateError && hasFailures) {
    const messages = failedBatches.map((b) => b.error.message).join('; ')
    throw new Error(`Batch insert failed with ${failedBatches.length} error(s): ${messages}`)
  }

  return {
    success: !hasFailures,
    insertedCount: totalInsertedCount,
    insertedIds: allInsertedIds.length > 0 ? allInsertedIds : undefined,
    batchResults,
    failedBatches: failedBatches.length > 0 ? failedBatches : undefined,
    validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    skippedDocuments: skippedDocuments > 0 ? skippedDocuments : undefined,
    duplicateIds,
    deduplicatedCount: deduplicatedCount > 0 ? deduplicatedCount : undefined,
    isWriteConcernError: writeConcernError || undefined,
    cancelled: cancelled || undefined,
    statistics: {
      totalBatches,
      successfulBatches: batchResults.filter((b) => b.success).length,
      failedBatches: batchResults.filter((b) => !b.success).length,
      totalDocuments,
      insertedDocuments: totalInsertedCount,
      durationMs,
      documentsPerSecond: durationMs > 0 ? (totalInsertedCount / durationMs) * 1000 : 0,
    },
  }
}
