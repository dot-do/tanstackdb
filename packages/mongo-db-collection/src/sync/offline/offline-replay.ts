/**
 * @file Offline Replay Queue (Stub for TDD)
 *
 * This file provides type exports for RED phase tests.
 * Implementation will be added during the GREEN phase.
 *
 * @module @tanstack/mongo-db-collection/sync/offline/offline-replay
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for offline replay queue
 */
export interface OfflineReplayConfig {
  maxQueueSize?: number
  maxQueueSizeBytes?: number
  retryAttempts?: number
  retryDelayMs?: number
  keepFailedMutations?: boolean
  stopOnError?: boolean
  autoReplay?: boolean
  debounceMs?: number
  initialState?: string
  onConflict?: (context: ConflictContext) => Promise<ConflictResolution>
}

/**
 * Conflict context for resolution
 */
export interface ConflictContext {
  mutation: QueuedMutation
  error: Error
}

/**
 * Conflict resolution type
 */
export type ConflictResolution = 'skip' | 'update' | 'retry' | 'fail'

/**
 * Queued mutation
 */
export interface QueuedMutation {
  id?: string
  type: 'insert' | 'update' | 'delete'
  collection: string
  database?: string
  document?: Record<string, unknown>
  filter?: Record<string, unknown>
  update?: Record<string, unknown>
  timestamp?: Date
}

/**
 * Replay result
 */
export interface ReplayResult {
  success: boolean
  replayed: number
  failed: number
  skipped?: number
  errors?: ReplayError[]
}

/**
 * Replay error
 */
export interface ReplayError {
  mutationId: string
  error: Error
  isDuplicateKey?: boolean
}

/**
 * Replay progress event data
 */
export interface ReplayProgress {
  current: number
  total: number
  mutationId: string
  success: boolean
}

/**
 * Replay event types
 */
export type ReplayEventType =
  | 'replayStart'
  | 'replayProgress'
  | 'replayComplete'
  | 'replayError'
  | 'replayRetry'
  | 'queueOverflow'

/**
 * RPC client interface for replay
 */
export interface RpcClient {
  rpc: (method: string, params: Record<string, unknown>) => Promise<unknown>
  isConnected: () => boolean
}

/**
 * Offline replay queue interface
 */
export interface OfflineReplayQueue {
  enqueue(mutation: QueuedMutation): void
  replay(rpc: RpcClient): Promise<ReplayResult>
  getQueuedMutations(): QueuedMutation[]
  getConfig(): OfflineReplayConfig
  isEmpty(): boolean
  size(): number
  clear(): void
  serialize(): string
  on(event: ReplayEventType, listener: (data: unknown) => void): void
  off(event: ReplayEventType, listener: (data: unknown) => void): void
  once(event: ReplayEventType, listener: (data: unknown) => void): void
  setRpcClient(rpc: RpcClient): void
  notifyConnected(): void
  pause(): void
  resume(): void
  isPaused(): boolean
  isReplaying(): boolean
}

// =============================================================================
// Factory Functions (Stubs)
// =============================================================================

/**
 * Create an offline replay queue
 */
export function createOfflineReplayQueue(
  _config?: OfflineReplayConfig
): OfflineReplayQueue {
  throw new Error('Not implemented: createOfflineReplayQueue')
}
