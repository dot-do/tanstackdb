/**
 * @file Offline Replay Queue
 *
 * This module provides an offline replay queue for mutations that failed while offline.
 * When the connection is restored, queued mutations are replayed in FIFO order.
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
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: Required<Omit<OfflineReplayConfig, 'initialState' | 'onConflict'>> = {
  maxQueueSize: 1000,
  maxQueueSizeBytes: 10 * 1024 * 1024, // 10MB
  retryAttempts: 0,
  retryDelayMs: 1000,
  keepFailedMutations: false,
  stopOnError: false,
  autoReplay: false,
  debounceMs: 0,
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `mut-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Check if an error is a duplicate key error
 */
function isDuplicateKeyError(error: Error): boolean {
  return error.message.includes('E11000 duplicate key error')
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: Error): boolean {
  // Duplicate key errors are not retryable
  if (isDuplicateKeyError(error)) {
    return false
  }
  // Most other errors can be retried
  return true
}

/**
 * Estimate size of a mutation in bytes
 */
function estimateMutationSize(mutation: QueuedMutation): number {
  return JSON.stringify(mutation).length
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an offline replay queue
 */
export function createOfflineReplayQueue(
  config?: OfflineReplayConfig
): OfflineReplayQueue {
  // Merge with defaults
  const resolvedConfig: OfflineReplayConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  }

  // Internal state
  let mutations: QueuedMutation[] = []
  let currentSizeBytes = 0
  let paused = false
  let replaying = false
  let rpcClient: RpcClient | null = null
  let debounceTimeout: ReturnType<typeof setTimeout> | null = null

  // Event listeners
  const listeners: Map<ReplayEventType, Set<(data: unknown) => void>> = new Map()
  const onceListeners: Map<ReplayEventType, Set<(data: unknown) => void>> = new Map()

  // Initialize from serialized state if provided
  if (config?.initialState) {
    try {
      const parsed = JSON.parse(config.initialState)
      if (Array.isArray(parsed.mutations)) {
        mutations = parsed.mutations.map((m: QueuedMutation) => ({
          ...m,
          timestamp: m.timestamp ? new Date(m.timestamp) : undefined,
        }))
        currentSizeBytes = mutations.reduce((sum, m) => sum + estimateMutationSize(m), 0)
      }
    } catch {
      // Invalid state, start with empty queue
      mutations = []
      currentSizeBytes = 0
    }
  }

  /**
   * Emit an event to listeners
   */
  function emit(event: ReplayEventType, data: unknown): void {
    // Regular listeners
    const eventListeners = listeners.get(event)
    if (eventListeners) {
      eventListeners.forEach((listener) => listener(data))
    }

    // Once listeners
    const eventOnceListeners = onceListeners.get(event)
    if (eventOnceListeners) {
      eventOnceListeners.forEach((listener) => listener(data))
      eventOnceListeners.clear()
    }
  }

  /**
   * Validate a mutation
   */
  function validateMutation(mutation: QueuedMutation): void {
    if (!mutation.type) {
      throw new Error('Mutation type is required')
    }
    if (!mutation.collection) {
      throw new Error('Mutation collection is required')
    }
    if (mutation.type === 'insert' && !mutation.document) {
      throw new Error('Document is required for insert mutations')
    }
    if (mutation.type === 'update') {
      if (!mutation.filter) {
        throw new Error('Filter is required for update mutations')
      }
      if (!mutation.update) {
        throw new Error('Update is required for update mutations')
      }
    }
    if (mutation.type === 'delete' && !mutation.filter) {
      throw new Error('Filter is required for delete mutations')
    }
  }

  /**
   * Execute a single mutation via RPC
   */
  async function executeMutation(
    rpc: RpcClient,
    mutation: QueuedMutation
  ): Promise<void> {
    const params: Record<string, unknown> = {
      database: mutation.database,
      collection: mutation.collection,
    }

    switch (mutation.type) {
      case 'insert':
        params.document = mutation.document
        await rpc.rpc('insertOne', params)
        break
      case 'update':
        params.filter = mutation.filter
        params.update = mutation.update
        await rpc.rpc('updateOne', params)
        break
      case 'delete':
        params.filter = mutation.filter
        await rpc.rpc('deleteOne', params)
        break
    }
  }

  /**
   * Convert an insert mutation to an update for conflict resolution
   */
  async function executeAsUpdate(
    rpc: RpcClient,
    mutation: QueuedMutation
  ): Promise<void> {
    if (mutation.type !== 'insert' || !mutation.document) {
      throw new Error('Can only convert insert mutations to updates')
    }

    const { _id, ...rest } = mutation.document as { _id: unknown; [key: string]: unknown }

    await rpc.rpc('updateOne', {
      database: mutation.database,
      collection: mutation.collection,
      filter: { _id },
      update: { $set: rest },
    })
  }

  /**
   * Replay a single mutation with retry logic
   */
  async function replayMutation(
    rpc: RpcClient,
    mutation: QueuedMutation,
    index: number,
    total: number
  ): Promise<{ success: boolean; skipped?: boolean; error?: ReplayError }> {
    const maxAttempts = (resolvedConfig.retryAttempts ?? DEFAULT_CONFIG.retryAttempts) + 1
    const retryDelayMs = resolvedConfig.retryDelayMs ?? DEFAULT_CONFIG.retryDelayMs
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await executeMutation(rpc, mutation)

        emit('replayProgress', {
          current: index + 1,
          total,
          mutationId: mutation.id,
          success: true,
        })

        return { success: true }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        emit('replayError', {
          mutationId: mutation.id,
          error: lastError,
          attempt,
        })

        // Check if error is a duplicate key error for conflict handling
        if (isDuplicateKeyError(lastError) && resolvedConfig.onConflict) {
          const resolution = await resolvedConfig.onConflict({
            mutation,
            error: lastError,
          })

          if (resolution === 'skip') {
            emit('replayProgress', {
              current: index + 1,
              total,
              mutationId: mutation.id,
              success: false,
            })
            return { success: false, skipped: true }
          }

          if (resolution === 'update' && mutation.type === 'insert') {
            try {
              await executeAsUpdate(rpc, mutation)
              emit('replayProgress', {
                current: index + 1,
                total,
                mutationId: mutation.id,
                success: true,
              })
              return { success: true }
            } catch (updateErr) {
              lastError = updateErr instanceof Error ? updateErr : new Error(String(updateErr))
            }
          }
        }

        // Check if we should retry
        if (!isRetryableError(lastError) || attempt >= maxAttempts) {
          break
        }

        // Emit retry event
        emit('replayRetry', {
          mutationId: mutation.id,
          attempt: attempt + 1,
          maxAttempts,
        })

        // Wait before retrying
        await sleep(retryDelayMs)
      }
    }

    emit('replayProgress', {
      current: index + 1,
      total,
      mutationId: mutation.id,
      success: false,
    })

    return {
      success: false,
      error: {
        mutationId: mutation.id!,
        error: lastError!,
        isDuplicateKey: isDuplicateKeyError(lastError!),
      },
    }
  }

  const queue: OfflineReplayQueue = {
    enqueue(mutation: QueuedMutation): void {
      validateMutation(mutation)

      // Ensure ID and timestamp
      const completeMutation: QueuedMutation = {
        ...mutation,
        id: mutation.id ?? generateId(),
        timestamp: mutation.timestamp ?? new Date(),
      }

      const mutationSize = estimateMutationSize(completeMutation)

      // Check size limits
      const maxQueueSize = resolvedConfig.maxQueueSize ?? DEFAULT_CONFIG.maxQueueSize
      const maxQueueSizeBytes = resolvedConfig.maxQueueSizeBytes ?? DEFAULT_CONFIG.maxQueueSizeBytes

      // Check byte limit
      while (
        currentSizeBytes + mutationSize > maxQueueSizeBytes &&
        mutations.length > 0
      ) {
        const dropped = mutations.shift()!
        currentSizeBytes -= estimateMutationSize(dropped)
        emit('queueOverflow', { droppedMutation: dropped })
      }

      // Check count limit
      while (mutations.length >= maxQueueSize) {
        const dropped = mutations.shift()!
        currentSizeBytes -= estimateMutationSize(dropped)
        emit('queueOverflow', { droppedMutation: dropped })
      }

      mutations.push(completeMutation)
      currentSizeBytes += mutationSize
    },

    async replay(rpc: RpcClient): Promise<ReplayResult> {
      if (paused) {
        throw new Error('Replay is paused')
      }

      if (replaying) {
        throw new Error('Replay is already in progress')
      }

      if (!rpc.isConnected()) {
        throw new Error('Cannot replay: not connected')
      }

      if (mutations.length === 0) {
        return { success: true, replayed: 0, failed: 0 }
      }

      replaying = true

      try {
        const total = mutations.length
        const mutationsToReplay = [...mutations]
        const errors: ReplayError[] = []
        let replayed = 0
        let failed = 0
        let skipped = 0
        const failedMutations: QueuedMutation[] = []

        emit('replayStart', { totalMutations: total })

        for (let i = 0; i < mutationsToReplay.length; i++) {
          const mutation = mutationsToReplay[i]
          const result = await replayMutation(rpc, mutation, i, total)

          if (result.success) {
            replayed++
          } else if (result.skipped) {
            skipped++
          } else {
            failed++
            if (result.error) {
              errors.push(result.error)
            }
            if (resolvedConfig.keepFailedMutations) {
              failedMutations.push(mutation)
            }
            if (resolvedConfig.stopOnError) {
              break
            }
          }
        }

        // Clear the queue or keep failed mutations
        if (resolvedConfig.keepFailedMutations) {
          mutations = failedMutations
          currentSizeBytes = mutations.reduce((sum, m) => sum + estimateMutationSize(m), 0)
        } else {
          mutations = []
          currentSizeBytes = 0
        }

        const result: ReplayResult = {
          success: failed === 0,
          replayed,
          failed,
          skipped: skipped > 0 ? skipped : undefined,
          errors: errors.length > 0 ? errors : undefined,
        }

        emit('replayComplete', result)

        return result
      } finally {
        replaying = false
      }
    },

    getQueuedMutations(): QueuedMutation[] {
      return [...mutations]
    },

    getConfig(): OfflineReplayConfig {
      return { ...resolvedConfig }
    },

    isEmpty(): boolean {
      return mutations.length === 0
    },

    size(): number {
      return mutations.length
    },

    clear(): void {
      mutations = []
      currentSizeBytes = 0
    },

    serialize(): string {
      return JSON.stringify({ mutations })
    },

    on(event: ReplayEventType, listener: (data: unknown) => void): void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set())
      }
      listeners.get(event)!.add(listener)
    },

    off(event: ReplayEventType, listener: (data: unknown) => void): void {
      const eventListeners = listeners.get(event)
      if (eventListeners) {
        eventListeners.delete(listener)
      }
    },

    once(event: ReplayEventType, listener: (data: unknown) => void): void {
      if (!onceListeners.has(event)) {
        onceListeners.set(event, new Set())
      }
      onceListeners.get(event)!.add(listener)
    },

    setRpcClient(rpc: RpcClient): void {
      rpcClient = rpc
    },

    notifyConnected(): void {
      if (!resolvedConfig.autoReplay || !rpcClient || mutations.length === 0) {
        return
      }

      // Debounce multiple connection events
      if (debounceTimeout) {
        clearTimeout(debounceTimeout)
      }

      const debounceMs = resolvedConfig.debounceMs ?? DEFAULT_CONFIG.debounceMs

      debounceTimeout = setTimeout(() => {
        debounceTimeout = null
        if (rpcClient && rpcClient.isConnected() && !paused && !replaying) {
          queue.replay(rpcClient).catch(() => {
            // Silently handle replay errors during auto-replay
          })
        }
      }, debounceMs)
    },

    pause(): void {
      paused = true
    },

    resume(): void {
      paused = false
    },

    isPaused(): boolean {
      return paused
    },

    isReplaying(): boolean {
      return replaying
    },
  }

  return queue
}
