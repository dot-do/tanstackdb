/**
 * Offline Queue Implementation for TanStack DB
 *
 * This module provides an offline mutation queue that stores mutations
 * when the device is offline and replays them when back online.
 *
 * Features:
 * - FIFO queue with priority support
 * - Persistent storage with fallback to memory
 * - Automatic replay on reconnection
 * - Retry logic with exponential backoff
 * - Conflict handling
 * - Batch processing
 * - Event callbacks for monitoring
 *
 * @module @tanstack/mongo-db-collection/sync/offline/offline-queue
 */

import type { ChangeMessage } from '../../types.js'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Priority levels for mutations
 */
export type MutationPriority = 'low' | 'normal' | 'high' | 'critical'

/**
 * Source of the mutation (affects priority)
 */
export type MutationSource = 'user' | 'background'

/**
 * Status of a queued mutation
 */
export type MutationStatus = 'pending' | 'replaying' | 'failed'

/**
 * Storage interface for persistence
 */
export interface OfflineStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

/**
 * Network status provider
 */
export interface NetworkStatus {
  isOnline: boolean
  onStatusChange: (callback: (online: boolean) => void) => () => void
}

/**
 * A queued mutation with metadata
 */
export interface QueuedMutation<T> {
  /** Unique identifier for this queue entry */
  id: string
  /** The mutation to replay */
  mutation: ChangeMessage<T>
  /** When the mutation was enqueued */
  timestamp: Date
  /** Current status */
  status: MutationStatus
  /** Number of replay attempts */
  attempts: number
  /** Priority level */
  priority: MutationPriority
  /** Source of mutation */
  source?: MutationSource
  /** Effective priority (may change due to decay) */
  effectivePriority: number
  /** Whether conflict has been resolved (to prevent infinite resolution loops) */
  conflictResolved?: boolean
}

/**
 * Result of a replay operation
 */
export interface ReplayResult<T> {
  success: boolean
  error?: Error
  conflict?: boolean
  unresolvable?: boolean
  serverVersion?: T
}

/**
 * Result of a batch replay operation
 */
export interface BatchReplayResult<T> {
  results: Array<{
    success: boolean
    key: string
    error?: Error
    conflict?: boolean
  }>
}

/**
 * Alias for BatchReplayResult for compatibility
 */
export type BatchProcessResult<T> = BatchReplayResult<T>

/**
 * Result of enqueueing a mutation
 */
export interface EnqueueResult {
  queued: boolean
  id?: string
}

/**
 * Options for enqueueing a mutation
 */
export interface EnqueueOptions {
  forceQueue?: boolean
  priority?: MutationPriority
  source?: MutationSource
}

/**
 * Options for restoring the queue
 */
export interface RestoreOptions {
  mergeStrategy?: 'prepend' | 'append' | 'replace'
}

/**
 * Options for processing the queue
 */
export interface QueueProcessingOptions {
  maxItems?: number
  stopOnError?: boolean
}

/**
 * Connection interface for processing
 */
export interface QueueConnection<T> {
  isConnected: boolean
  send: (mutation: QueuedMutation<T>) => Promise<ReplayResult<T>>
}

/**
 * Queue statistics
 */
export interface QueueStats {
  pending: number
  failed: number
  replayed: number
  totalProcessed: number
}

/**
 * Conflict resolution result
 */
export interface ConflictResolutionResult<T> {
  resolution?: 'merge' | 'accept-server' | 'accept-client'
  resolved?: T
  mergedValue?: T
}

/**
 * Replay complete event data
 */
export interface ReplayCompleteData {
  successful: number
  failed: number
}

/**
 * Partial success event data
 */
export interface PartialSuccessData {
  successful: number
  failed: number
  conflicts: number
}

/**
 * Process start event data
 */
export interface ProcessStartData {
  queueLength: number
}

/**
 * Process end event data
 */
export interface ProcessEndData {
  processed: number
  successful: number
  failed: number
}

/**
 * Process queue result
 */
export interface ProcessQueueResult {
  processed: number
  successful: number
  failed: number
}

/**
 * Configuration for the offline queue
 */
export interface OfflineQueueConfig<T> {
  /** Required: Collection identifier */
  collectionId: string
  /** Optional: Storage backend */
  storage?: OfflineStorage
  /** Optional: Network status provider */
  networkStatus?: NetworkStatus
  /** Maximum queue size (default: 1000) */
  maxQueueSize?: number
  /** Number of retry attempts (default: 3) */
  retryAttempts?: number
  /** Delay between retries in ms (default: 1000) */
  retryDelayMs?: number
  /** Use exponential backoff for retries */
  useExponentialBackoff?: boolean
  /** Maximum storage size in bytes */
  maxStorageBytes?: number
  /** Auto-compact queue when approaching limit */
  autoCompact?: boolean
  /** Fall back to memory storage on error */
  fallbackToMemory?: boolean
  /** Block enqueue when paused */
  blockEnqueueWhenPaused?: boolean
  /** Persist queue on dispose */
  persistOnDispose?: boolean
  /** Auto-persist on changes */
  autoPersist?: boolean
  /** Auto-restore on init */
  autoRestore?: boolean
  /** Use priority-based queue */
  usePriorityQueue?: boolean
  /** Priority decay time in ms */
  priorityDecayMs?: number
  /** Batch size for processing */
  batchSize?: number
  /** Delay between batches in ms */
  batchDelayMs?: number

  // Callbacks
  onReplay?: (mutation: QueuedMutation<T>) => Promise<ReplayResult<T>>
  onBatchReplay?: (mutations: QueuedMutation<T>[]) => Promise<BatchReplayResult<T>>
  onConflict?: (mutation: QueuedMutation<T>, serverVersion: T) => Promise<ConflictResolutionResult<T>>
  onFailure?: (mutation: QueuedMutation<T>, error: Error) => void
  onRollback?: (mutation: QueuedMutation<T>) => void
  onEnqueue?: (mutation: QueuedMutation<T>) => void
  onDequeue?: (mutation: QueuedMutation<T>) => void
  onReplayStart?: () => void
  onReplayComplete?: (data: ReplayCompleteData) => void
  onQueueCleared?: () => void
  onQueueEmpty?: () => void
  onStorageError?: (error: Error) => void
  onPause?: () => void
  onResume?: () => void
  onPartialSuccess?: (data: PartialSuccessData) => void
  onProcessStart?: (data: ProcessStartData) => void
  onProcessEnd?: (data: ProcessEndData) => void
  onError?: (mutation: QueuedMutation<T>, error: Error) => void
}

// ============================================================================
// Priority Values
// ============================================================================

const PRIORITY_VALUES: Record<MutationPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  critical: 4,
}

const SOURCE_BOOST: Record<MutationSource, number> = {
  background: 0,
  user: 0.5,
}

// ============================================================================
// OfflineQueue Implementation
// ============================================================================

/**
 * Offline mutation queue for storing and replaying mutations.
 *
 * @template T - The document type
 */
export class OfflineQueue<T> {
  private queue: QueuedMutation<T>[] = []
  private failedMutations: QueuedMutation<T>[] = []
  private config: OfflineQueueConfig<T>
  private disposed = false
  private paused = false
  private isReplaying = false
  private retryTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private networkUnsubscribe?: () => void
  private stats: QueueStats = {
    pending: 0,
    failed: 0,
    replayed: 0,
    totalProcessed: 0,
  }
  private usingFallbackStorage = false
  private idCounter = 0

  constructor(config: OfflineQueueConfig<T>) {
    // Validate config
    if (!config.collectionId || config.collectionId.trim() === '') {
      throw new Error('collectionId is required and cannot be empty')
    }
    if (config.maxQueueSize !== undefined && config.maxQueueSize <= 0) {
      throw new Error('maxQueueSize must be a positive number')
    }
    if (config.retryAttempts !== undefined && config.retryAttempts < 0) {
      throw new Error('retryAttempts must be non-negative')
    }

    // When autoRestore is explicitly false, default autoPersist to false too
    const autoPersistDefault = config.autoRestore === false ? false : true

    this.config = {
      maxQueueSize: 1000,
      retryAttempts: 3,
      retryDelayMs: 1000,
      useExponentialBackoff: false,
      fallbackToMemory: false,
      blockEnqueueWhenPaused: false,
      persistOnDispose: false,
      autoPersist: autoPersistDefault,
      autoRestore: true,
      usePriorityQueue: false,
      batchSize: 10,
      batchDelayMs: 0,
      ...config,
    }

    // Subscribe to network status changes
    if (this.config.networkStatus) {
      this.networkUnsubscribe = this.config.networkStatus.onStatusChange((online) => {
        if (online && !this.paused && !this.disposed) {
          this.startReplay()
        }
      })
    }
  }

  // ============================================================================
  // Public Properties
  // ============================================================================

  get maxQueueSize(): number {
    return this.config.maxQueueSize!
  }

  get retryAttempts(): number {
    return this.config.retryAttempts!
  }

  get retryDelayMs(): number {
    return this.config.retryDelayMs!
  }

  get length(): number {
    return this.queue.length
  }

  get isEmpty(): boolean {
    return this.queue.length === 0
  }

  get isPaused(): boolean {
    return this.paused
  }

  get isUsingFallbackStorage(): boolean {
    return this.usingFallbackStorage
  }

  get batchSize(): number {
    return this.config.batchSize!
  }

  get estimatedSizeBytes(): number {
    return JSON.stringify(this.queue).length * 2 // UTF-16 encoding estimate
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  async initialize(): Promise<void> {
    if (this.config.autoRestore !== false) {
      await this.restoreQueue()
    }
  }

  // ============================================================================
  // Core Queue Operations
  // ============================================================================

  async enqueue(mutation: ChangeMessage<T>, options?: EnqueueOptions): Promise<EnqueueResult> {
    if (this.disposed) {
      throw new Error('Queue has been disposed')
    }

    if (this.paused && this.config.blockEnqueueWhenPaused) {
      throw new Error('Queue is paused')
    }

    // If online and not forcing queue, don't queue
    const networkStatus = this.config.networkStatus
    if (networkStatus?.isOnline && !options?.forceQueue) {
      return { queued: false }
    }

    // Check queue size limit
    if (this.queue.length >= this.config.maxQueueSize!) {
      throw new Error('Queue is full')
    }

    const priority = options?.priority ?? 'normal'
    const source = options?.source
    const now = new Date()

    const queuedMutation: QueuedMutation<T> = {
      id: this.generateId(),
      mutation,
      timestamp: now,
      status: 'pending',
      attempts: 0,
      priority,
      source,
      effectivePriority: this.calculateEffectivePriority(priority, source, now),
    }

    // Insert at correct position based on priority if using priority queue
    if (this.config.usePriorityQueue) {
      this.insertByPriority(queuedMutation)
    } else {
      this.queue.push(queuedMutation)
    }

    this.stats.pending++

    // Emit event
    this.config.onEnqueue?.(queuedMutation)

    // Persist
    if (this.config.autoPersist !== false) {
      await this.persistQueue()
    }

    return { queued: true, id: queuedMutation.id }
  }

  async dequeue(): Promise<QueuedMutation<T> | null> {
    if (this.queue.length === 0) {
      return null
    }

    const mutation = this.queue.shift()!
    this.stats.pending--

    // Emit event
    this.config.onDequeue?.(mutation)

    // Persist
    if (this.config.autoPersist !== false && this.config.storage) {
      await this.persistQueue()
    }

    // Check if queue is empty
    if (this.queue.length === 0) {
      this.config.onQueueEmpty?.()
    }

    return mutation
  }

  peek(): QueuedMutation<T> | null {
    if (this.queue.length === 0) {
      return null
    }
    return this.queue[0]
  }

  async clear(): Promise<void> {
    this.queue = []
    this.failedMutations = []
    this.stats.pending = 0
    this.stats.failed = 0

    // Clear retry timeouts
    for (const timeout of this.retryTimeouts.values()) {
      clearTimeout(timeout)
    }
    this.retryTimeouts.clear()

    // Clear storage
    if (this.config.storage) {
      await this.config.storage.removeItem(this.getStorageKey())
    }

    this.config.onQueueCleared?.()
  }

  async remove(id: string): Promise<boolean> {
    const index = this.queue.findIndex((m) => m.id === id)
    if (index === -1) {
      return false
    }

    this.queue.splice(index, 1)
    this.stats.pending--

    if (this.config.autoPersist !== false && this.config.storage) {
      await this.persistQueue()
    }

    return true
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  getAll(): QueuedMutation<T>[] {
    // Recalculate effective priorities based on current time if decay is configured
    if (this.config.priorityDecayMs) {
      for (const mutation of this.queue) {
        mutation.effectivePriority = this.calculateEffectivePriority(
          mutation.priority,
          mutation.source,
          mutation.timestamp
        )
      }
    }
    return [...this.queue]
  }

  getById(id: string): QueuedMutation<T> | undefined {
    return this.queue.find((m) => m.id === id)
  }

  getByKey(key: string): QueuedMutation<T>[] {
    return this.queue.filter((m) => m.mutation.key === key)
  }

  getByPriority(priority: MutationPriority): QueuedMutation<T>[] {
    return this.queue.filter((m) => m.priority === priority)
  }

  // ============================================================================
  // Priority Management
  // ============================================================================

  async updatePriority(id: string, priority: MutationPriority): Promise<boolean> {
    const mutation = this.queue.find((m) => m.id === id)
    if (!mutation) {
      return false
    }

    mutation.priority = priority
    mutation.effectivePriority = this.calculateEffectivePriority(
      priority,
      mutation.source,
      mutation.timestamp
    )

    // Re-sort if using priority queue
    if (this.config.usePriorityQueue) {
      this.queue.sort((a, b) => b.effectivePriority - a.effectivePriority)
    }

    if (this.config.autoPersist !== false && this.config.storage) {
      await this.persistQueue()
    }

    return true
  }

  setBatchSize(size: number): void {
    this.config.batchSize = size
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  getStats(): QueueStats {
    return { ...this.stats }
  }

  resetStats(): void {
    this.stats = {
      pending: this.queue.length,
      failed: this.failedMutations.length,
      replayed: 0,
      totalProcessed: 0,
    }
  }

  // ============================================================================
  // Pause/Resume
  // ============================================================================

  pause(): void {
    this.paused = true
    this.config.onPause?.()
  }

  resume(): void {
    this.paused = false
    this.config.onResume?.()

    // Start replay if online
    const networkStatus = this.config.networkStatus
    if (networkStatus?.isOnline && !this.disposed) {
      this.startReplay()
    }
  }

  // ============================================================================
  // Replay Logic
  // ============================================================================

  async replay(): Promise<void> {
    await this.startReplay()
  }

  private async startReplay(): Promise<void> {
    if (this.isReplaying || this.paused || this.disposed || this.queue.length === 0) {
      return
    }

    this.isReplaying = true
    this.config.onReplayStart?.()
    this.config.onProcessStart?.({ queueLength: this.queue.length })

    let successful = 0
    let failed = 0
    let processed = 0

    try {
      if (this.config.onBatchReplay) {
        // Batch processing
        await this.processBatches()
        const statsAfter = this.getStats()
        successful = statsAfter.replayed
        failed = statsAfter.failed
        processed = statsAfter.totalProcessed
      } else if (this.config.onReplay) {
        // Single mutation processing
        while (this.queue.length > 0 && !this.paused && !this.disposed) {
          const mutation = this.queue[0]
          const result = await this.processOneMutation(mutation)

          if (result === 'success') {
            this.queue.shift()
            this.stats.pending--
            this.stats.replayed++
            this.stats.totalProcessed++
            successful++
            processed++
          } else if (result === 'retry') {
            // Will be retried after delay
            break
          } else {
            // Failed after all retries
            this.queue.shift()
            this.stats.pending--
            this.stats.failed++
            this.stats.totalProcessed++
            this.failedMutations.push(mutation)
            failed++
            processed++
          }

          // Persist after each mutation
          if (this.config.autoPersist !== false && this.config.storage) {
            await this.persistQueue()
          }
        }
      }
    } finally {
      this.isReplaying = false
    }

    this.config.onProcessEnd?.({ processed, successful, failed })
    this.config.onReplayComplete?.({ successful, failed })

    if (this.queue.length === 0) {
      this.config.onQueueEmpty?.()
    }
  }

  private async processOneMutation(
    mutation: QueuedMutation<T>
  ): Promise<'success' | 'retry' | 'failed'> {
    mutation.attempts++

    try {
      const result = await this.config.onReplay!(mutation)

      if (result.success) {
        return 'success'
      }

      // Handle conflict
      if (result.conflict) {
        if (result.unresolvable) {
          this.config.onRollback?.(mutation)
          return 'failed'
        }

        // Only resolve conflict once to prevent infinite loops
        if (this.config.onConflict && result.serverVersion && !mutation.conflictResolved) {
          const resolution = await this.config.onConflict(mutation, result.serverVersion)
          if (resolution.resolved || resolution.mergedValue) {
            // Update mutation with resolved value
            mutation.mutation = {
              ...mutation.mutation,
              value: (resolution.resolved ?? resolution.mergedValue)!,
            }
            // Mark as resolved to prevent repeated conflict resolution
            mutation.conflictResolved = true
            // Retry immediately with the resolved value (don't count as another attempt)
            mutation.attempts-- // Offset the increment at the start
            return this.processOneMutation(mutation)
          }
        }

        // Treat unresolved/already-resolved conflict as a failure for retry purposes
        // The mutation will be retried if attempts allow
      }

      // Check if we should retry
      if (mutation.attempts < this.config.retryAttempts!) {
        this.scheduleRetry(mutation)
        return 'retry'
      }

      // All retries exhausted
      this.config.onFailure?.(mutation, result.error ?? new Error('Unknown error'))
      this.config.onError?.(mutation, result.error ?? new Error('Unknown error'))
      return 'failed'
    } catch (error) {
      if (mutation.attempts < this.config.retryAttempts!) {
        this.scheduleRetry(mutation)
        return 'retry'
      }

      const err = error instanceof Error ? error : new Error(String(error))
      this.config.onFailure?.(mutation, err)
      this.config.onError?.(mutation, err)
      return 'failed'
    }
  }

  private scheduleRetry(mutation: QueuedMutation<T>): void {
    let delay = this.config.retryDelayMs!

    if (this.config.useExponentialBackoff) {
      delay = delay * Math.pow(2, mutation.attempts - 1)
    }

    const timeout = setTimeout(() => {
      this.retryTimeouts.delete(mutation.id)
      if (!this.paused && !this.disposed) {
        this.startReplay()
      }
    }, delay)

    this.retryTimeouts.set(mutation.id, timeout)
  }

  private async processBatches(): Promise<void> {
    const batchSize = this.config.batchSize!
    const batchDelay = this.config.batchDelayMs!

    while (this.queue.length > 0 && !this.paused && !this.disposed) {
      const batch = this.queue.slice(0, batchSize)
      const result = await this.config.onBatchReplay!(batch)

      let successCount = 0
      let failCount = 0
      let conflictCount = 0
      let needsRetry = false

      // Process results - try matching by key first, then by index
      const toRemove: string[] = []
      const processedMutations = new Set<string>()

      for (let i = 0; i < result.results.length && i < batch.length; i++) {
        const itemResult = result.results[i]
        // Try to match by key first, fall back to index
        let mutation = batch.find((m) => m.mutation.key === itemResult.key)
        if (!mutation) {
          // Fall back to index-based matching
          mutation = batch[i]
          if (processedMutations.has(mutation.id)) {
            continue
          }
        }
        processedMutations.add(mutation.id)

        if (itemResult.success) {
          toRemove.push(mutation.id)
          this.stats.replayed++
          this.stats.totalProcessed++
          successCount++
        } else {
          if (itemResult.conflict) {
            conflictCount++
            // Count conflicts as failures for partial success reporting
            failCount++
          }
          // Leave failed items in queue for retry or mark as failed
          mutation.attempts++
          if (mutation.attempts >= this.config.retryAttempts!) {
            toRemove.push(mutation.id)
            this.failedMutations.push(mutation)
            this.stats.failed++
            this.stats.totalProcessed++
            // Only increment failCount if we haven't already counted it as a conflict
            if (!itemResult.conflict) {
              failCount++
            }
          } else {
            // Item needs retry - schedule it and break out of the loop
            needsRetry = true
            this.scheduleRetry(mutation)
          }
        }
      }

      // Remove processed mutations
      this.queue = this.queue.filter((m) => !toRemove.includes(m.id))
      this.stats.pending = this.queue.length

      // Emit partial success if there were conflicts
      if (conflictCount > 0) {
        this.config.onPartialSuccess?.({
          successful: successCount,
          failed: failCount,
          conflicts: conflictCount,
        })
      }

      // Persist after batch
      if (this.config.autoPersist !== false && this.config.storage) {
        await this.persistQueue()
      }

      // If any items need retry, break the loop - they'll be processed after delay
      if (needsRetry) {
        break
      }

      // Delay between batches
      if (batchDelay > 0 && this.queue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, batchDelay))
      }
    }
  }

  // ============================================================================
  // Direct Queue Processing
  // ============================================================================

  async processQueue(
    connection: QueueConnection<T>,
    options?: QueueProcessingOptions
  ): Promise<ProcessQueueResult> {
    if (!connection.isConnected) {
      throw new Error('Connection is not connected')
    }

    const maxItems = options?.maxItems ?? Infinity
    const stopOnError = options?.stopOnError ?? false

    let processed = 0
    let successful = 0
    let failed = 0

    while (this.queue.length > 0 && processed < maxItems) {
      const mutation = this.queue[0]
      mutation.attempts++

      try {
        const result = await connection.send(mutation)

        if (result.success) {
          this.queue.shift()
          this.stats.pending--
          this.stats.replayed++
          this.stats.totalProcessed++
          successful++
        } else {
          if (mutation.attempts >= this.config.retryAttempts!) {
            this.queue.shift()
            this.stats.pending--
            this.stats.failed++
            this.stats.totalProcessed++
            this.failedMutations.push(mutation)
            failed++
          } else if (stopOnError) {
            break
          }
        }
      } catch (error) {
        if (mutation.attempts >= this.config.retryAttempts!) {
          this.queue.shift()
          this.stats.pending--
          this.stats.failed++
          this.stats.totalProcessed++
          failed++
        }
        if (stopOnError) {
          break
        }
      }

      processed++

      // Persist after each mutation
      if (this.config.autoPersist !== false && this.config.storage) {
        await this.persistQueue()
      }
    }

    return { processed, successful, failed }
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  async persistQueue(): Promise<void> {
    if (!this.config.storage) {
      return
    }

    const data = {
      version: 1,
      mutations: this.queue.map((m) => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
      })),
    }

    try {
      await this.config.storage.setItem(this.getStorageKey(), JSON.stringify(data))
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // Check for quota exceeded
      if (err.message.includes('Quota') || err.name === 'QuotaExceededError') {
        this.config.onStorageError?.(err)
        throw new Error('Storage quota exceeded')
      }

      this.config.onStorageError?.(err)

      if (this.config.fallbackToMemory) {
        this.usingFallbackStorage = true
        // Continue with in-memory queue
      } else {
        throw err
      }
    }
  }

  async restoreQueue(options?: RestoreOptions): Promise<void> {
    if (!this.config.storage) {
      return
    }

    try {
      const stored = await this.config.storage.getItem(this.getStorageKey())
      if (!stored) {
        return
      }

      const data = JSON.parse(stored)
      const restoredMutations: QueuedMutation<T>[] = data.mutations.map(
        (m: Record<string, unknown>) => ({
          ...m,
          timestamp: new Date(m.timestamp as string),
        })
      )

      const mergeStrategy = options?.mergeStrategy ?? 'replace'

      switch (mergeStrategy) {
        case 'prepend':
          this.queue = [...restoredMutations, ...this.queue]
          break
        case 'append':
          this.queue = [...this.queue, ...restoredMutations]
          break
        case 'replace':
        default:
          this.queue = restoredMutations
          break
      }

      this.stats.pending = this.queue.length
    } catch {
      // Handle corrupted data gracefully
      this.queue = []
      this.stats.pending = 0
    }
  }

  // ============================================================================
  // Compaction
  // ============================================================================

  async compact(): Promise<void> {
    // Group mutations by document key
    const byKey = new Map<string, QueuedMutation<T>[]>()

    for (const mutation of this.queue) {
      const key = mutation.mutation.key
      if (!byKey.has(key)) {
        byKey.set(key, [])
      }
      byKey.get(key)!.push(mutation)
    }

    // Compact: keep only the last mutation for each key (with some exceptions)
    const compacted: QueuedMutation<T>[] = []

    for (const [, mutations] of byKey) {
      if (mutations.length === 1) {
        compacted.push(mutations[0])
      } else {
        // For insert followed by updates, merge into final state
        // For delete, only keep delete
        const lastMutation = mutations[mutations.length - 1]

        if (lastMutation.mutation.type === 'delete') {
          // If first was insert, can remove entirely
          if (mutations[0].mutation.type === 'insert') {
            // Skip - net effect is nothing
            continue
          }
          compacted.push(lastMutation)
        } else {
          // Keep the last state
          compacted.push(lastMutation)
        }
      }
    }

    this.queue = compacted
    this.stats.pending = this.queue.length

    if (this.config.autoPersist !== false && this.config.storage) {
      await this.persistQueue()
    }
  }

  // ============================================================================
  // Disposal
  // ============================================================================

  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }

    // Clear retry timeouts
    for (const timeout of this.retryTimeouts.values()) {
      clearTimeout(timeout)
    }
    this.retryTimeouts.clear()

    // Unsubscribe from network status
    if (this.networkUnsubscribe) {
      this.networkUnsubscribe()
      this.networkUnsubscribe = undefined
    }

    // Persist if configured
    if (this.config.persistOnDispose && this.config.storage) {
      await this.persistQueue()
    }

    this.disposed = true
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private generateId(): string {
    return `${Date.now()}-${++this.idCounter}-${Math.random().toString(36).slice(2, 9)}`
  }

  private getStorageKey(): string {
    return `offline-queue:${this.config.collectionId}`
  }

  private calculateEffectivePriority(
    priority: MutationPriority,
    source?: MutationSource,
    timestamp?: Date
  ): number {
    let value = PRIORITY_VALUES[priority]

    // Add source boost
    if (source) {
      value += SOURCE_BOOST[source]
    }

    // Add time-based decay if configured
    if (this.config.priorityDecayMs && timestamp) {
      const age = Date.now() - timestamp.getTime()
      const decayPeriods = age / this.config.priorityDecayMs
      value += decayPeriods * 0.1 // Small boost for older items
    }

    return value
  }

  private insertByPriority(mutation: QueuedMutation<T>): void {
    // Find insertion point to maintain priority order (highest first)
    // Within same priority, maintain FIFO
    let insertIndex = this.queue.length

    for (let i = 0; i < this.queue.length; i++) {
      if (mutation.effectivePriority > this.queue[i].effectivePriority) {
        insertIndex = i
        break
      }
    }

    this.queue.splice(insertIndex, 0, mutation)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an offline queue with the given configuration.
 *
 * @template T - The document type
 * @param config - Queue configuration
 * @returns A new OfflineQueue instance
 */
export function createOfflineQueue<T>(config: OfflineQueueConfig<T>): OfflineQueue<T> {
  return new OfflineQueue<T>(config)
}
