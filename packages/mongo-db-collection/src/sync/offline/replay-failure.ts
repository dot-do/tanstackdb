/**
 * @file Replay Failure Handler (Stub for TDD)
 *
 * This file provides type exports for RED phase tests.
 * Implementation will be added during the GREEN phase.
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
  retryStrategy?: RetryStrategy
  maxRetries?: number
  rpcClient?: RpcClient
  database?: string
  collection?: string
  onFailure?: (failure: ReplayFailure<T>) => void
  onResolution?: (resolution: FailureResolution<T>) => void
  onSkip?: (skipped: SkippedMutation<T>) => void
  onRetrySuccess?: (result: ReplayFailureResult<T>) => void
}

/**
 * Retry strategy configuration
 */
export interface RetryStrategy {
  type: 'exponential' | 'linear' | 'fixed' | 'custom'
  maxRetries?: number
  initialDelay?: number
  maxDelay?: number
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
  value?: T
  timestamp: number | Date
}

/**
 * Replay failure details
 */
export interface ReplayFailure<T = unknown> {
  mutation: FailedMutation<T>
  error: Error
  errorCategory?: 'network' | 'conflict' | 'validation' | 'unknown'
  retryCount: number
  firstAttempt: Date
  lastAttempt: Date
}

/**
 * Result of replay failure handling
 */
export interface ReplayFailureResult<T = unknown> {
  success: boolean
  failure?: ReplayFailure<T>
  resolution?: FailureResolution<T>
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
  mutation: FailedMutation<T>
  skippedAt: Date
  reason?: string
}

/**
 * Retry all results
 */
export interface RetryAllResult<T = unknown> {
  successful: ReplayFailureResult<T>[]
  failed: ReplayFailureResult<T>[]
}

/**
 * Replay failure handler interface
 */
export interface ReplayFailureHandler<T = unknown> {
  handleFailure(context: ReplayFailureContext<T>): Promise<ReplayFailureResult<T>>
  getFailedMutations(): ReplayFailure<T>[]
  getSkippedMutations(): SkippedMutation<T>[]
  retryFailedMutation(mutationId: string): Promise<ReplayFailureResult<T>>
  retryAllFailed(): Promise<RetryAllResult<T>>
  skipFailedMutation(mutationId: string): void
  skipMutation(mutationId: string, options?: SkipMutationOptions): Promise<void>
  clearFailedMutations(): void
  getRetryDelay(attemptNumber: number): number
  exportFailedMutations(): string
  importFailedMutations(data: string): void
}

// =============================================================================
// Factory Functions (Stubs)
// =============================================================================

/**
 * Create a replay failure handler
 */
export function createReplayFailureHandler<T = unknown>(
  _config?: ReplayFailureHandlerConfig<T>
): ReplayFailureHandler<T> {
  throw new Error('Not implemented: createReplayFailureHandler')
}

/**
 * Handle a replay failure directly
 */
export function handleReplayFailure<T = unknown>(
  _context: ReplayFailureContext<T>
): Promise<ReplayFailureResult<T>> {
  throw new Error('Not implemented: handleReplayFailure')
}
