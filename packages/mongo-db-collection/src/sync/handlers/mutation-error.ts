/**
 * @file Mutation Error Handler
 *
 * Handles Layer 7 mutation errors with error classification, recovery strategies,
 * retry logic, and user-friendly error messages.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/handlers/mutation-error
 *
 * @remarks
 * The mutation error handler:
 * - Classifies errors into semantic categories (network, validation, duplicate_key, etc.)
 * - Determines appropriate recovery strategies (retry, abort, rollback, manual_intervention)
 * - Provides exponential backoff retry logic
 * - Generates user-friendly error messages
 * - Supports hooks for custom error handling
 * - Integrates with TanStack DB's error handling system
 *
 * @example Basic usage
 * ```typescript
 * import { createMutationErrorHandler } from '@tanstack/mongo-db-collection'
 *
 * const handler = createMutationErrorHandler({
 *   database: 'myapp',
 *   collection: 'users',
 *   maxRetries: 3,
 * })
 *
 * // Use with TanStack DB collection config
 * const collectionConfig = {
 *   onError: handler,
 * }
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Error classification types.
 */
export type MutationErrorType =
  | 'duplicate_key'
  | 'validation'
  | 'network'
  | 'timeout'
  | 'authentication'
  | 'authorization'
  | 'write_conflict'
  | 'not_found'
  | 'server'
  | 'unknown'

/**
 * Recovery strategy types.
 */
export type ErrorRecoveryStrategy =
  | 'retry'
  | 'abort'
  | 'rollback'
  | 'manual_intervention'

/**
 * Mutation types.
 */
export type MutationType = 'insert' | 'update' | 'delete'

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
 * Error classification result.
 */
export interface MutationErrorClassification {
  /** The type of error */
  type: MutationErrorType
  /** Whether the error is retryable */
  isRetryable: boolean
  /** Whether the error is caused by user input */
  isUserError: boolean
  /** Error code (if available from MongoDB) */
  errorCode?: number
  /** Original error message */
  message: string
}

/**
 * Context passed to the mutation error handler.
 * @typeParam T - The document type
 */
export interface MutationErrorContext<T> {
  /** The error that occurred */
  error: Error
  /** The mutation that failed */
  mutation: PendingMutation<T>
  /** The transaction containing the mutation */
  transaction: Transaction<T>
  /** The type of mutation that failed */
  mutationType: MutationType
  /** Current retry count */
  retryCount?: number
  /** Index of the failed mutation in the transaction */
  failedMutationIndex?: number
  /** Mutations that completed before the failure */
  completedMutations?: PendingMutation<T>[]
}

/**
 * Error log entry for structured logging.
 */
export interface ErrorLogEntry {
  /** Mutation ID */
  mutationId: string
  /** Mutation type */
  mutationType: MutationType
  /** Document key */
  documentKey: string | number
  /** Error classification */
  classification: MutationErrorType
  /** Whether the error is retryable */
  isRetryable: boolean
  /** Error message */
  message: string
  /** Stack trace */
  stack?: string
  /** Timestamp */
  timestamp: Date
}

/**
 * Result of mutation error handling.
 * @typeParam T - The document type
 */
export interface MutationErrorResult<T = unknown> {
  /** Whether the error was handled */
  handled: boolean
  /** Error classification */
  classification: MutationErrorClassification
  /** Suggested recovery strategy */
  recoveryStrategy: ErrorRecoveryStrategy
  /** Whether to retry the operation */
  shouldRetry: boolean
  /** Delay before retry in milliseconds */
  retryDelayMs?: number
  /** Next retry count */
  nextRetryCount?: number
  /** User-friendly error message */
  userMessage: string
  /** Mutations to rollback (if rollback strategy) */
  rollbackMutations?: PendingMutation<T>[]
  /** Structured error log */
  errorLog?: ErrorLogEntry
}

/**
 * Hook context for onError callback.
 * @typeParam T - The document type
 */
export interface OnErrorContext<T> {
  /** The error that occurred */
  error: Error
  /** The mutation that failed */
  mutation: PendingMutation<T>
  /** The transaction */
  transaction: Transaction<T>
  /** Error classification */
  classification: MutationErrorClassification
}

/**
 * Hook context for onRetry callback.
 */
export interface OnRetryContext {
  /** The error that occurred */
  error: Error
  /** Current retry count (after increment) */
  retryCount: number
  /** Delay before retry in milliseconds */
  delayMs: number
}

/**
 * Hook context for onMaxRetriesExceeded callback.
 * @typeParam T - The document type
 */
export interface OnMaxRetriesExceededContext<T> {
  /** The error that occurred */
  error: Error
  /** The mutation that failed */
  mutation: PendingMutation<T>
  /** Total number of retries attempted */
  totalRetries: number
}

/**
 * Hook context for onRollback callback.
 * @typeParam T - The document type
 */
export interface OnRollbackContext<T> {
  /** Mutations that completed and need rollback */
  completedMutations: PendingMutation<T>[]
  /** The error that triggered rollback */
  error: Error
}

/**
 * Configuration for the mutation error handler factory.
 * @typeParam T - The document type
 */
export interface MutationErrorHandlerConfig<T = unknown> {
  /** Target database name */
  database: string
  /** Target collection name */
  collection: string
  /** Maximum number of retry attempts */
  maxRetries?: number
  /** Initial delay between retries in milliseconds */
  initialDelayMs?: number
  /** Maximum delay between retries in milliseconds */
  maxDelayMs?: number
  /** Backoff multiplier for retry delays */
  backoffMultiplier?: number
  /** Enable rollback for partial transaction failures */
  enableRollback?: boolean
  /** Hook called on any error */
  onError?: (context: OnErrorContext<T>) => void | Promise<void>
  /** Hook called when retry is suggested */
  onRetry?: (context: OnRetryContext) => void | Promise<void>
  /** Hook called when max retries exceeded */
  onMaxRetriesExceeded?: (context: OnMaxRetriesExceededContext<T>) => void | Promise<void>
  /** Hook called when rollback is triggered */
  onRollback?: (context: OnRollbackContext<T>) => void | Promise<void>
}

/**
 * Configuration for direct error handling.
 */
export interface HandleMutationErrorConfig {
  /** The error to handle */
  error: Error
  /** Mutation ID */
  mutationId: string
  /** Mutation type */
  mutationType: MutationType
  /** Document key */
  documentKey: string | number
  /** Current retry count */
  retryCount?: number
  /** Maximum retries */
  maxRetries?: number
}

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Pattern matchers for error classification.
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp | ((msg: string) => boolean)
  type: MutationErrorType
  isRetryable: boolean
  isUserError: boolean
}> = [
  // Duplicate key errors (highest priority)
  {
    pattern: /E11000|duplicate key/i,
    type: 'duplicate_key',
    isRetryable: false,
    isUserError: true,
  },
  // Permanent connection errors (non-retryable - must come before network)
  {
    pattern: /connection closed permanently|permanently closed/i,
    type: 'network',
    isRetryable: false,
    isUserError: false,
  },
  // Authentication errors (before validation - "invalid credentials" should not match "invalid")
  {
    pattern: /authentication|auth failed|invalid credentials/i,
    type: 'authentication',
    isRetryable: false,
    isUserError: false,
  },
  // Authorization errors
  {
    pattern: /not authorized|unauthorized|permission denied|forbidden/i,
    type: 'authorization',
    isRetryable: false,
    isUserError: false,
  },
  // Write conflict errors (including optimistic lock failures)
  {
    pattern: /write ?conflict|version mismatch|optimistic lock/i,
    type: 'write_conflict',
    isRetryable: true,
    isUserError: false,
  },
  // Not found errors
  {
    pattern: /not found|does not exist/i,
    type: 'not_found',
    isRetryable: false,
    isUserError: false,
  },
  // Validation errors
  {
    pattern: /validation|invalid|schema/i,
    type: 'validation',
    isRetryable: false,
    isUserError: true,
  },
  // Timeout errors
  {
    pattern: /timeout|timed out|ETIMEDOUT/i,
    type: 'timeout',
    isRetryable: true,
    isUserError: false,
  },
  // Network errors (transient/retryable)
  {
    pattern: /network|connection|ECONNRESET|ECONNREFUSED|ENOTFOUND|temporarily unavailable/i,
    type: 'network',
    isRetryable: true,
    isUserError: false,
  },
  // Server errors
  {
    pattern: /internal server|server error|server busy|5\d\d/i,
    type: 'server',
    isRetryable: true,
    isUserError: false,
  },
]

/**
 * Classifies a mutation error into a semantic category.
 *
 * @param error - The error to classify
 * @returns The error classification
 *
 * @example
 * ```typescript
 * const classification = classifyMutationError(new Error('E11000 duplicate key'))
 * console.log(classification.type) // 'duplicate_key'
 * console.log(classification.isRetryable) // false
 * ```
 */
export function classifyMutationError(error: Error): MutationErrorClassification {
  const message = error.message
  const errorWithCode = error as Error & { code?: number }
  const errorCode = errorWithCode.code

  // Check each pattern
  for (const { pattern, type, isRetryable, isUserError } of ERROR_PATTERNS) {
    const matches =
      typeof pattern === 'function' ? pattern(message) : pattern.test(message)

    if (matches) {
      return {
        type,
        isRetryable,
        isUserError,
        errorCode,
        message,
      }
    }
  }

  // Default to unknown
  return {
    type: 'unknown',
    isRetryable: false,
    isUserError: false,
    errorCode,
    message,
  }
}

/**
 * Checks if an error is retryable.
 *
 * @param error - The error to check
 * @returns True if the error is retryable
 *
 * @example
 * ```typescript
 * isRetryableError(new Error('Network error')) // true
 * isRetryableError(new Error('E11000 duplicate key')) // false
 * ```
 */
export function isRetryableError(error: Error): boolean {
  return classifyMutationError(error).isRetryable
}

// =============================================================================
// User-Friendly Messages
// =============================================================================

/**
 * Generates a user-friendly error message based on the error classification.
 */
function getUserFriendlyMessage(
  classification: MutationErrorClassification,
  mutationType: MutationType
): string {
  switch (classification.type) {
    case 'duplicate_key':
      return `The document already exists. Please use a different identifier.`

    case 'validation':
      return `The document data is invalid. Please check the fields and try again.`

    case 'not_found':
      return mutationType === 'update'
        ? `The document you're trying to update no longer exists.`
        : `The document you're trying to delete was not found.`

    case 'authentication':
      return `Authentication failed. Please sign in again.`

    case 'authorization':
      return `You don't have permission to perform this action.`

    case 'write_conflict':
      return `The document was modified by another user. Please refresh and try again.`

    case 'timeout':
      return `The operation timed out. Please try again.`

    case 'network':
      return `Unable to connect to the server. Please check your connection and try again.`

    case 'server':
      return `A server error occurred. Please try again later.`

    case 'unknown':
    default:
      return `An unexpected error occurred. Please try again or contact support.`
  }
}

// =============================================================================
// Recovery Strategy Determination
// =============================================================================

/**
 * Determines the appropriate recovery strategy for an error.
 */
function determineRecoveryStrategy(
  classification: MutationErrorClassification,
  retryCount: number,
  maxRetries: number,
  hasCompletedMutations: boolean,
  enableRollback: boolean
): ErrorRecoveryStrategy {
  // If we have completed mutations and rollback is enabled, suggest rollback
  if (hasCompletedMutations && enableRollback) {
    return 'rollback'
  }

  // If error is retryable and we haven't exceeded max retries
  if (classification.isRetryable && retryCount < maxRetries) {
    return 'retry'
  }

  // If we've exceeded retries or hit a non-retryable error
  switch (classification.type) {
    case 'duplicate_key':
    case 'validation':
    case 'not_found':
    case 'authentication':
      return 'abort'

    case 'authorization':
      return 'manual_intervention'

    default:
      // If retryable but exceeded retries
      if (classification.isRetryable && retryCount >= maxRetries) {
        return 'manual_intervention'
      }
      return 'abort'
  }
}

/**
 * Calculates the retry delay using exponential backoff.
 */
function calculateRetryDelay(
  retryCount: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number
): number {
  const delay = initialDelayMs * Math.pow(backoffMultiplier, retryCount)
  return Math.min(delay, maxDelayMs)
}

// =============================================================================
// Handler Factory
// =============================================================================

/**
 * Creates a mutation error handler for TanStack DB.
 *
 * @typeParam T - The document type
 * @param config - Handler configuration
 * @returns A handler function compatible with TanStack DB's onError
 *
 * @throws {Error} If database is not provided or empty
 * @throws {Error} If collection is not provided or empty
 *
 * @example Basic usage
 * ```typescript
 * const handler = createMutationErrorHandler<User>({
 *   database: 'myapp',
 *   collection: 'users',
 *   maxRetries: 3,
 * })
 *
 * // The handler is called by TanStack DB when errors occur
 * const result = await handler({ error, mutation, transaction, mutationType: 'insert' })
 * ```
 *
 * @example With hooks
 * ```typescript
 * const handler = createMutationErrorHandler<User>({
 *   database: 'myapp',
 *   collection: 'users',
 *   maxRetries: 3,
 *   onError: ({ error, classification }) => {
 *     console.error('Error:', classification.type, error.message)
 *   },
 *   onRetry: ({ retryCount, delayMs }) => {
 *     console.log(`Retrying in ${delayMs}ms (attempt ${retryCount})`)
 *   },
 * })
 * ```
 */
export function createMutationErrorHandler<T extends { _id?: string } = { _id?: string }>(
  config: MutationErrorHandlerConfig<T>
): (context: MutationErrorContext<T>) => Promise<MutationErrorResult<T>> {
  // Validate configuration
  if (!config.database) {
    throw new Error('database is required')
  }
  if (!config.collection) {
    throw new Error('collection is required')
  }

  const {
    maxRetries = 3,
    initialDelayMs = 100,
    maxDelayMs = 5000,
    backoffMultiplier = 2,
    enableRollback = false,
    onError,
    onRetry,
    onMaxRetriesExceeded,
    onRollback,
  } = config

  /**
   * The handler function called by TanStack DB on mutation errors.
   */
  return async function mutationErrorHandler(
    context: MutationErrorContext<T>
  ): Promise<MutationErrorResult<T>> {
    const {
      error,
      mutation,
      transaction,
      mutationType,
      retryCount = 0,
      completedMutations = [],
    } = context

    // Classify the error
    const classification = classifyMutationError(error)

    // Call onError hook
    if (onError) {
      await onError({ error, mutation, transaction, classification })
    }

    // Determine recovery strategy
    const hasCompletedMutations = completedMutations.length > 0
    const recoveryStrategy = determineRecoveryStrategy(
      classification,
      retryCount,
      maxRetries,
      hasCompletedMutations,
      enableRollback
    )

    // Calculate retry info
    const shouldRetry = recoveryStrategy === 'retry'
    const nextRetryCount = shouldRetry ? retryCount + 1 : undefined
    const retryDelayMs = shouldRetry
      ? calculateRetryDelay(retryCount, initialDelayMs, maxDelayMs, backoffMultiplier)
      : undefined

    // Call onRetry hook if retrying
    if (shouldRetry && onRetry) {
      await onRetry({ error, retryCount: nextRetryCount!, delayMs: retryDelayMs! })
    }

    // Call onMaxRetriesExceeded hook if exceeded
    if (
      classification.isRetryable &&
      retryCount >= maxRetries &&
      onMaxRetriesExceeded
    ) {
      await onMaxRetriesExceeded({ error, mutation, totalRetries: maxRetries })
    }

    // Handle rollback
    let rollbackMutations: PendingMutation<T>[] | undefined
    if (recoveryStrategy === 'rollback') {
      rollbackMutations = completedMutations

      if (onRollback) {
        await onRollback({ completedMutations, error })
      }
    }

    // Generate user-friendly message
    const userMessage = getUserFriendlyMessage(classification, mutationType)

    // Generate error log
    const errorLog: ErrorLogEntry = {
      mutationId: mutation.mutationId,
      mutationType,
      documentKey: mutation.key,
      classification: classification.type,
      isRetryable: classification.isRetryable,
      message: error.message,
      stack: error.stack,
      timestamp: new Date(),
    }

    return {
      handled: true,
      classification,
      recoveryStrategy,
      shouldRetry,
      retryDelayMs,
      nextRetryCount,
      userMessage,
      rollbackMutations,
      errorLog,
    }
  }
}

// =============================================================================
// Direct Handler Function
// =============================================================================

/**
 * Directly handles a mutation error without a TanStack DB context.
 *
 * This function provides a simpler API for handling errors when
 * you don't have the full TanStack DB transaction context.
 *
 * @param config - Configuration including the error to handle
 * @returns Result of the error handling
 *
 * @example
 * ```typescript
 * const result = await handleMutationError({
 *   error: new Error('E11000 duplicate key'),
 *   mutationId: 'mut-1',
 *   mutationType: 'insert',
 *   documentKey: 'doc-123',
 * })
 *
 * if (result.shouldRetry) {
 *   console.log(`Retrying in ${result.retryDelayMs}ms`)
 * } else {
 *   console.error(result.userMessage)
 * }
 * ```
 */
export async function handleMutationError(
  config: HandleMutationErrorConfig
): Promise<MutationErrorResult> {
  const {
    error,
    mutationId,
    mutationType,
    documentKey,
    retryCount = 0,
    maxRetries = 3,
  } = config

  // Classify the error
  const classification = classifyMutationError(error)

  // Determine recovery strategy
  const recoveryStrategy = determineRecoveryStrategy(
    classification,
    retryCount,
    maxRetries,
    false,
    false
  )

  // Calculate retry info
  const shouldRetry = recoveryStrategy === 'retry'
  const nextRetryCount = shouldRetry ? retryCount + 1 : undefined
  const retryDelayMs = shouldRetry
    ? calculateRetryDelay(retryCount, 100, 5000, 2)
    : undefined

  // Generate user-friendly message
  const userMessage = getUserFriendlyMessage(classification, mutationType)

  // Generate error log
  const errorLog: ErrorLogEntry = {
    mutationId,
    mutationType,
    documentKey,
    classification: classification.type,
    isRetryable: classification.isRetryable,
    message: error.message,
    stack: error.stack,
    timestamp: new Date(),
  }

  return {
    handled: true,
    classification,
    recoveryStrategy,
    shouldRetry,
    retryDelayMs,
    nextRetryCount,
    userMessage,
    errorLog,
  }
}
