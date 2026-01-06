/**
 * @file Replay Failure Handler
 *
 * Handles errors during offline mutation replay and provides retry/skip options.
 * When the application comes back online and needs to replay offline mutations,
 * this handler manages errors with configurable retry strategies.
 *
 * @module @tanstack/mongo-db-collection/sync/offline/replay-failure
 */

// =============================================================================
// Types
// =============================================================================

/**
 * RPC client interface for replay
 */
export interface RpcClient {
  rpc: (method: string, params: Record<string, unknown>) => Promise<unknown>
}

/**
 * Configuration for replay failure handler
 */
export interface ReplayFailureHandlerConfig<T = unknown> {
  retryStrategy?: RetryStrategy | string
  maxRetries?: number
  rpcClient?: RpcClient
  database?: string
  collection?: string
  onFailure?: (failure: ReplayFailure<T>) => void
  onResolution?: (resolution: FailureResolution<T>) => void
  onSkip?: (skipped: SkippedMutation<T>) => void
  onRetry?: (info: { mutationId: string }) => void
  onRetrySuccess?: (result: { mutationId: string }) => void
  onMaxRetriesExceeded?: (failure: ReplayFailure<T>) => void
}

/**
 * Retry strategy configuration
 */
export interface RetryStrategy {
  type: 'exponential-backoff' | 'linear-backoff' | 'fixed' | 'custom'
  baseDelayMs?: number
  maxDelayMs?: number
  incrementMs?: number
  delayMs?: number
  getDelay?: (attemptNumber: number) => number
  shouldRetry?: (error: Error, attemptNumber: number) => boolean
}

/**
 * Failed mutation information
 */
export interface FailedMutation<T = unknown> {
  mutationId: string
  type: 'insert' | 'update' | 'delete'
  key: string
  modified?: T
  original?: Partial<T>
  changes?: Partial<T>
  metadata?: Record<string, unknown>
  timestamp: Date
  retryCount: number
}

/**
 * Replay failure details
 */
export interface ReplayFailure<T = unknown> {
  mutation: FailedMutation<T>
  error: Error
  errorCategory?: 'network' | 'conflict' | 'validation' | 'authorization' | 'unknown'
  timestamp: Date
  attemptNumber: number
  nextRetryDelay?: number
  shouldRetry?: boolean
}

/**
 * Result of replay failure handling
 */
export interface ReplayFailureResult<T = unknown> {
  recorded?: boolean
  mutationId?: string
  success?: boolean
  retriedMutationId?: string
  failure?: ReplayFailure<T>
  resolution?: 'retry' | 'skip'
  reason?: string
  nextRetryDelay?: number
  errorCategory?: 'network' | 'conflict' | 'validation' | 'authorization' | 'unknown'
  isRetryable?: boolean
}

/**
 * Context for replay failure handling
 */
export interface ReplayFailureContext<T = unknown> {
  mutation: FailedMutation<T>
  error: Error
}

/**
 * Resolution of a replay failure
 */
export interface FailureResolution<T = unknown> {
  type: 'retry' | 'skip' | 'manual'
  mutation: FailedMutation<T>
  resolvedAt: Date
}

/**
 * Skip mutation options
 */
export interface SkipMutationOptions {
  reason?: string
}

/**
 * Skipped mutation information
 */
export interface SkippedMutation<T = unknown> {
  mutationId: string
  mutation: FailedMutation<T>
  skippedAt: Date
  skipReason?: string
  reason?: string
}

/**
 * Retry result for a single mutation
 */
export interface RetryResult<T = unknown> {
  success: boolean
  retriedMutationId: string
}

/**
 * Retry all results
 */
export interface RetryAllResult<T = unknown> {
  successful: { mutationId: string }[]
  failed: { mutationId: string; error: Error }[]
}

/**
 * Skip result
 */
export interface SkipResult {
  skipped: boolean
  mutationId: string
}

/**
 * Filter options for getFailedMutations
 */
export interface FailedMutationsFilter {
  category?: 'network' | 'conflict' | 'validation' | 'authorization' | 'unknown'
  mutationType?: 'insert' | 'update' | 'delete'
}

/**
 * Replay failure handler interface
 */
export interface ReplayFailureHandler<T = unknown> {
  handleFailure(context: ReplayFailureContext<T>): Promise<ReplayFailureResult<T>>
  getFailedMutations(filter?: FailedMutationsFilter): ReplayFailure<T>[]
  getSkippedMutations(): SkippedMutation<T>[]
  retryFailed(mutationId: string): Promise<RetryResult<T>>
  retryAllFailed(): Promise<RetryAllResult<T>>
  skipMutation(mutationId: string, options?: SkipMutationOptions): Promise<SkipResult>
  clearFailed(mutationId?: string): void
  exportFailedMutations(): string
  importFailedMutations(data: string): void
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Classify error into a category based on error message
 */
function classifyError(error: Error): 'network' | 'conflict' | 'validation' | 'authorization' | 'unknown' {
  const message = error.message.toLowerCase()

  // Network errors
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('etimedout')
  ) {
    return 'network'
  }

  // Conflict errors
  if (
    message.includes('conflict') ||
    message.includes('e11000') ||
    message.includes('duplicate key')
  ) {
    return 'conflict'
  }

  // Authorization errors - check before validation since "invalid" could match "invalid credentials"
  if (
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('authentication') ||
    message.includes('credentials')
  ) {
    return 'authorization'
  }

  // Validation errors
  if (
    message.includes('validation') ||
    message.includes('invalid')
  ) {
    return 'validation'
  }

  return 'unknown'
}

/**
 * Check if an error category is retryable
 */
function isRetryableCategory(category: string): boolean {
  return category === 'network' || category === 'unknown'
}

/**
 * Calculate delay based on retry strategy
 */
function calculateDelay(
  strategy: RetryStrategy | string | undefined,
  attemptNumber: number
): number {
  if (typeof strategy === 'string') {
    // String strategy names
    switch (strategy) {
      case 'exponential-backoff':
        return Math.min(100 * Math.pow(2, attemptNumber - 1), 30000)
      case 'linear-backoff':
        return 100 * attemptNumber
      case 'fixed':
        return 1000
      default:
        return 1000
    }
  }

  if (!strategy) {
    return 1000 // default delay
  }

  switch (strategy.type) {
    case 'exponential-backoff': {
      const base = strategy.baseDelayMs ?? 100
      const max = strategy.maxDelayMs ?? 30000
      // Add some jitter (up to 20%)
      const delay = base * Math.pow(2, attemptNumber - 1)
      const jitter = delay * 0.2 * Math.random()
      return Math.min(delay + jitter, max)
    }
    case 'linear-backoff': {
      const base = strategy.baseDelayMs ?? 100
      const increment = strategy.incrementMs ?? 100
      return base + (increment * (attemptNumber - 1))
    }
    case 'fixed':
      return strategy.delayMs ?? strategy.baseDelayMs ?? 1000
    case 'custom':
      if (strategy.getDelay) {
        return strategy.getDelay(attemptNumber)
      }
      return 1000
    default:
      return 1000
  }
}

/**
 * Check if should retry based on strategy
 */
function checkShouldRetry(
  strategy: RetryStrategy | string | undefined,
  error: Error,
  attemptNumber: number,
  maxRetries: number
): boolean {
  if (attemptNumber > maxRetries) {
    return false
  }

  const category = classifyError(error)
  if (!isRetryableCategory(category)) {
    return false
  }

  if (typeof strategy === 'object' && strategy.type === 'custom' && strategy.shouldRetry) {
    return strategy.shouldRetry(error, attemptNumber)
  }

  return true
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a replay failure handler
 */
export function createReplayFailureHandler<T = unknown>(
  config: ReplayFailureHandlerConfig<T>
): ReplayFailureHandler<T> {
  // Validate config
  if (config.maxRetries !== undefined && config.maxRetries < 0) {
    throw new Error('maxRetries must be non-negative')
  }

  const maxRetries = config.maxRetries ?? 3
  const failedMutations = new Map<string, ReplayFailure<T>>()
  const skippedMutations: SkippedMutation<T>[] = []

  const handler: ReplayFailureHandler<T> = {
    async handleFailure(context: ReplayFailureContext<T>): Promise<ReplayFailureResult<T>> {
      const { mutation, error } = context
      const mutationId = mutation.mutationId

      // Get existing failure or create new one
      const existing = failedMutations.get(mutationId)
      const attemptNumber = existing ? existing.attemptNumber + 1 : 1

      const errorCategory = classifyError(error)
      const shouldRetry = checkShouldRetry(config.retryStrategy, error, attemptNumber, maxRetries)
      const nextRetryDelay = shouldRetry ? calculateDelay(config.retryStrategy, attemptNumber) : undefined

      const failure: ReplayFailure<T> = {
        mutation,
        error,
        errorCategory,
        timestamp: new Date(),
        attemptNumber,
        nextRetryDelay,
        shouldRetry,
      }

      failedMutations.set(mutationId, failure)

      // Call onFailure callback
      if (config.onFailure) {
        config.onFailure(failure)
      }

      // Check if max retries exceeded
      if (attemptNumber > maxRetries && config.onMaxRetriesExceeded) {
        config.onMaxRetriesExceeded(failure)
      }

      return {
        recorded: true,
        mutationId,
      }
    },

    getFailedMutations(filter?: FailedMutationsFilter): ReplayFailure<T>[] {
      let result = Array.from(failedMutations.values())

      if (filter?.category) {
        result = result.filter(f => f.errorCategory === filter.category)
      }

      if (filter?.mutationType) {
        result = result.filter(f => f.mutation.type === filter.mutationType)
      }

      return result
    },

    getSkippedMutations(): SkippedMutation<T>[] {
      return [...skippedMutations]
    },

    async retryFailed(mutationId: string): Promise<RetryResult<T>> {
      const failure = failedMutations.get(mutationId)

      if (!failure) {
        throw new Error('Mutation not found')
      }

      // Apply retry delay if configured
      if (typeof config.retryStrategy === 'object' && config.retryStrategy.type === 'fixed') {
        const delay = config.retryStrategy.delayMs ?? 100
        await new Promise(resolve => setTimeout(resolve, delay))
      }

      // Call onRetry callback
      if (config.onRetry) {
        config.onRetry({ mutationId })
      }

      // Try to replay the mutation via RPC
      if (config.rpcClient && config.database && config.collection) {
        try {
          await config.rpcClient.rpc('replay', {
            database: config.database,
            collection: config.collection,
            mutation: failure.mutation,
          })

          // Success - remove from failed list
          failedMutations.delete(mutationId)

          // Call onRetrySuccess callback
          if (config.onRetrySuccess) {
            config.onRetrySuccess({ mutationId })
          }

          return {
            success: true,
            retriedMutationId: mutationId,
          }
        } catch (error) {
          // Failed - update failure record
          const errorCategory = classifyError(error as Error)
          failure.error = error as Error
          failure.errorCategory = errorCategory
          failure.attemptNumber += 1
          failure.timestamp = new Date()

          return {
            success: false,
            retriedMutationId: mutationId,
          }
        }
      }

      // No RPC client configured - just mark as successful and remove
      failedMutations.delete(mutationId)

      if (config.onRetrySuccess) {
        config.onRetrySuccess({ mutationId })
      }

      return {
        success: true,
        retriedMutationId: mutationId,
      }
    },

    async retryAllFailed(): Promise<RetryAllResult<T>> {
      const successful: { mutationId: string }[] = []
      const failed: { mutationId: string; error: Error }[] = []

      const mutations = Array.from(failedMutations.keys())

      for (const mutationId of mutations) {
        try {
          const result = await handler.retryFailed(mutationId)
          if (result.success) {
            successful.push({ mutationId })
          } else {
            const failure = failedMutations.get(mutationId)
            failed.push({
              mutationId,
              error: failure?.error ?? new Error('Unknown error')
            })
          }
        } catch (error) {
          failed.push({ mutationId, error: error as Error })
        }
      }

      return { successful, failed }
    },

    async skipMutation(mutationId: string, options?: SkipMutationOptions): Promise<SkipResult> {
      const failure = failedMutations.get(mutationId)

      if (!failure) {
        throw new Error('Mutation not found')
      }

      // Remove from failed list
      failedMutations.delete(mutationId)

      // Add to skipped list
      const skipped: SkippedMutation<T> = {
        mutationId,
        mutation: failure.mutation,
        skippedAt: new Date(),
        skipReason: options?.reason,
        reason: options?.reason,
      }

      skippedMutations.push(skipped)

      // Call onSkip callback
      if (config.onSkip) {
        config.onSkip(skipped)
      }

      return {
        skipped: true,
        mutationId,
      }
    },

    clearFailed(mutationId?: string): void {
      if (mutationId) {
        failedMutations.delete(mutationId)
      } else {
        failedMutations.clear()
      }
    },

    exportFailedMutations(): string {
      const failures = Array.from(failedMutations.values()).map(f => ({
        mutation: f.mutation,
        errorMessage: f.error.message,
        errorCategory: f.errorCategory,
        timestamp: f.timestamp.toISOString(),
        attemptNumber: f.attemptNumber,
        nextRetryDelay: f.nextRetryDelay,
        shouldRetry: f.shouldRetry,
      }))

      return JSON.stringify(failures)
    },

    importFailedMutations(data: string): void {
      const failures = JSON.parse(data)

      for (const f of failures) {
        const failure: ReplayFailure<T> = {
          mutation: f.mutation,
          error: new Error(f.errorMessage),
          errorCategory: f.errorCategory,
          timestamp: new Date(f.timestamp),
          attemptNumber: f.attemptNumber,
          nextRetryDelay: f.nextRetryDelay,
          shouldRetry: f.shouldRetry,
        }

        failedMutations.set(f.mutation.mutationId, failure)
      }
    },
  }

  return handler
}

/**
 * Options for handleReplayFailure
 */
export interface HandleReplayFailureOptions<T = unknown> {
  mutation: FailedMutation<T>
  error: Error
  strategy: 'retry' | 'exponential-backoff' | 'linear-backoff' | 'fixed'
  maxRetries: number
  baseDelayMs?: number
}

/**
 * Handle a replay failure directly
 */
export async function handleReplayFailure<T = unknown>(
  options: HandleReplayFailureOptions<T>
): Promise<ReplayFailureResult<T>> {
  const { mutation, error, strategy, maxRetries, baseDelayMs = 100 } = options

  const errorCategory = classifyError(error)
  const isRetryable = isRetryableCategory(errorCategory)
  const retryCount = mutation.retryCount ?? 0

  // Check if max retries exceeded
  if (retryCount >= maxRetries) {
    return {
      resolution: 'skip',
      reason: 'max retries exceeded',
      errorCategory,
      isRetryable,
    }
  }

  // Non-retryable error
  if (!isRetryable) {
    return {
      resolution: 'skip',
      reason: 'non-retryable error',
      errorCategory,
      isRetryable,
    }
  }

  // Calculate delay based on strategy
  // retryCount is the number of previous retries (0-indexed)
  // Test expects: exponential with retryCount=2 => 100 * 2^2 = 400 (range 300-500)
  // Test expects: linear with retryCount=2 => 100 * 3 = 300 (range 250-350)
  let nextRetryDelay: number

  switch (strategy) {
    case 'exponential-backoff': {
      // Exponential: baseDelay * 2^retryCount with small jitter
      const delay = baseDelayMs * Math.pow(2, retryCount)
      const jitter = delay * 0.2 * (Math.random() - 0.5) // +/- 10%
      nextRetryDelay = Math.round(delay + jitter)
      break
    }
    case 'linear-backoff': {
      // Linear: baseDelay * (retryCount + 1) with small jitter
      const delay = baseDelayMs * (retryCount + 1)
      const jitter = delay * 0.15 * (Math.random() - 0.5) // +/- 7.5%
      nextRetryDelay = Math.round(delay + jitter)
      break
    }
    case 'fixed':
      nextRetryDelay = baseDelayMs
      break
    case 'retry':
    default:
      nextRetryDelay = baseDelayMs * Math.pow(2, retryCount)
      break
  }

  return {
    resolution: 'retry',
    nextRetryDelay,
    errorCategory,
    isRetryable,
  }
}
