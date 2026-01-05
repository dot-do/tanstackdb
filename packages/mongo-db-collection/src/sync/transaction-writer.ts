/**
 * Transaction Writer for MongoDB Collection Sync
 *
 * Provides a transactional wrapper around SyncParams for batching
 * and managing writes to TanStack DB collections.
 */

import type { SyncParams, ChangeMessage } from '../types.js'

/**
 * Statistics about write operations.
 */
export interface WriteStats {
  /** Total number of writes performed */
  totalWrites: number
  /** Number of insert operations */
  insertCount: number
  /** Number of update operations */
  updateCount: number
  /** Number of delete operations */
  deleteCount: number
}

/**
 * Commit statistics passed to onCommit callback.
 */
export interface CommitStats {
  /** Total number of writes in this commit */
  writeCount: number
  /** Number of insert operations */
  insertCount: number
  /** Number of update operations */
  updateCount: number
  /** Number of delete operations */
  deleteCount: number
}

/**
 * Configuration options for TransactionWriter.
 */
export interface TransactionWriterConfig<T extends object> {
  /**
   * Auto-flush interval in milliseconds.
   * When set to a positive value, queued writes will be automatically
   * flushed after this interval. Set to 0 (default) to disable.
   * @default 0
   */
  autoFlushMs?: number

  /**
   * Maximum number of writes to batch before auto-flushing.
   * @default 1000
   */
  maxBatchSize?: number

  /**
   * When true, automatically commits the transaction after flush.
   * @default false
   */
  autoCommit?: boolean

  /**
   * When true, automatically begins a new transaction after commit.
   * @default false
   */
  autoBegin?: boolean

  /**
   * Error handler for write errors.
   * If not provided, errors will be thrown.
   */
  onError?: (error: Error, change: ChangeMessage<T>) => void

  /**
   * Callback invoked when a rollback occurs.
   * Receives the writes that were discarded.
   */
  onRollback?: (discardedWrites: ChangeMessage<T>[]) => void

  /**
   * When true, preserves rolled back writes for potential retry.
   * @default false
   */
  preserveRolledBack?: boolean

  /**
   * When true, flushes pending writes when dispose() is called.
   * @default false
   */
  flushOnDispose?: boolean

  /**
   * Callback invoked when a transaction is committed.
   */
  onCommit?: (stats: CommitStats) => void
}

/**
 * TransactionWriter wraps SyncParams to provide batching, auto-commit,
 * error handling, and rollback support for sync operations.
 *
 * @typeParam T - The document type being synced
 *
 * @example Basic usage
 * ```typescript
 * const writer = new TransactionWriter(syncParams)
 *
 * writer.beginTransaction()
 * writer.write({ type: 'insert', key: 'doc1', value: { _id: 'doc1', name: 'Test' } })
 * writer.commitTransaction()
 * ```
 *
 * @example With batching
 * ```typescript
 * const writer = new TransactionWriter(syncParams, { maxBatchSize: 100 })
 *
 * writer.beginTransaction()
 * for (const doc of documents) {
 *   writer.queueWrite({ type: 'insert', key: doc._id, value: doc })
 * }
 * writer.flush()
 * writer.commitTransaction()
 * ```
 */
export class TransactionWriter<T extends object> {
  private readonly syncParams: SyncParams<T>
  private readonly config: Required<
    Pick<TransactionWriterConfig<T>, 'autoFlushMs' | 'maxBatchSize' | 'autoCommit' | 'autoBegin' | 'preserveRolledBack' | 'flushOnDispose'>
  > & Pick<TransactionWriterConfig<T>, 'onError' | 'onRollback' | 'onCommit'>

  private pendingWrites: ChangeMessage<T>[] = []
  private _failedWrites: ChangeMessage<T>[] = []
  private _rolledBackWrites: ChangeMessage<T>[] = []
  private _isTransactionActive = false
  private _transactionCount = 0
  private _disposed = false
  private autoFlushTimer: ReturnType<typeof setTimeout> | null = null

  // Statistics tracking
  private stats: WriteStats = {
    totalWrites: 0,
    insertCount: 0,
    updateCount: 0,
    deleteCount: 0,
  }

  // Per-transaction stats for onCommit callback
  private currentTxStats: WriteStats = {
    totalWrites: 0,
    insertCount: 0,
    updateCount: 0,
    deleteCount: 0,
  }

  /**
   * Creates a new TransactionWriter.
   *
   * @param syncParams - The SyncParams from TanStack DB
   * @param config - Optional configuration options
   * @throws Error if autoFlushMs is negative
   * @throws Error if maxBatchSize is zero or negative
   */
  constructor(syncParams: SyncParams<T>, config: TransactionWriterConfig<T> = {}) {
    if (config.autoFlushMs !== undefined && config.autoFlushMs < 0) {
      throw new Error('autoFlushMs must be non-negative')
    }
    if (config.maxBatchSize !== undefined && config.maxBatchSize <= 0) {
      throw new Error('maxBatchSize must be positive')
    }

    this.syncParams = syncParams
    this.config = {
      autoFlushMs: config.autoFlushMs ?? 0,
      maxBatchSize: config.maxBatchSize ?? 1000,
      autoCommit: config.autoCommit ?? false,
      autoBegin: config.autoBegin ?? false,
      preserveRolledBack: config.preserveRolledBack ?? false,
      flushOnDispose: config.flushOnDispose ?? false,
      onError: config.onError,
      onRollback: config.onRollback,
      onCommit: config.onCommit,
    }
  }

  /**
   * Auto-flush interval in milliseconds.
   */
  get autoFlushMs(): number {
    return this.config.autoFlushMs
  }

  /**
   * Maximum batch size before auto-flush.
   */
  get maxBatchSize(): number {
    return this.config.maxBatchSize
  }

  /**
   * Number of writes queued but not yet flushed.
   */
  get pendingCount(): number {
    return this.pendingWrites.length
  }

  /**
   * Whether a transaction is currently active.
   */
  get isTransactionActive(): boolean {
    return this._isTransactionActive
  }

  /**
   * Number of transactions that have been committed.
   */
  get transactionCount(): number {
    return this._transactionCount
  }

  /**
   * Writes that failed during flush.
   */
  get failedWrites(): ChangeMessage<T>[] {
    return [...this._failedWrites]
  }

  /**
   * Writes that were discarded during rollback.
   * Only populated when preserveRolledBack is true.
   */
  get rolledBackWrites(): ChangeMessage<T>[] {
    return [...this._rolledBackWrites]
  }

  /**
   * Begins a new transaction.
   *
   * @throws Error if a transaction is already active
   */
  beginTransaction(): void {
    if (this._isTransactionActive) {
      throw new Error('Transaction already active')
    }
    this._isTransactionActive = true
    this.currentTxStats = {
      totalWrites: 0,
      insertCount: 0,
      updateCount: 0,
      deleteCount: 0,
    }
    this.syncParams.begin()
  }

  /**
   * Commits the current transaction.
   *
   * @throws Error if no transaction is active
   */
  commitTransaction(): void {
    if (!this._isTransactionActive) {
      throw new Error('No active transaction')
    }
    this._isTransactionActive = false
    this._transactionCount++
    this.syncParams.commit()

    // Call onCommit callback with stats
    if (this.config.onCommit) {
      this.config.onCommit({
        writeCount: this.currentTxStats.totalWrites,
        insertCount: this.currentTxStats.insertCount,
        updateCount: this.currentTxStats.updateCount,
        deleteCount: this.currentTxStats.deleteCount,
      })
    }
  }

  /**
   * Writes a change message directly (synchronously).
   *
   * @param change - The change message to write
   */
  write(change: ChangeMessage<T>): void {
    this.syncParams.write(change)
    this.trackWrite(change)
  }

  /**
   * Queues a write for batched execution.
   * The write will be executed when flush() is called or when
   * the batch size limit is reached.
   *
   * @param change - The change message to queue
   * @throws Error if the writer has been disposed
   * @throws Error if no transaction is active
   */
  queueWrite(change: ChangeMessage<T>): void {
    if (this._disposed) {
      throw new Error('TransactionWriter has been disposed')
    }
    if (!this._isTransactionActive) {
      throw new Error('No active transaction')
    }

    this.pendingWrites.push(change)

    // Check if we've reached the batch size limit
    if (this.pendingWrites.length >= this.config.maxBatchSize) {
      this.flush()
    } else {
      // Reset/start auto-flush timer
      this.resetAutoFlushTimer()
    }
  }

  /**
   * Flushes all pending writes to the sync params.
   */
  flush(): void {
    this.clearAutoFlushTimer()

    if (this.pendingWrites.length === 0) {
      return
    }

    const writes = this.pendingWrites
    this.pendingWrites = []

    for (const change of writes) {
      try {
        this.syncParams.write(change)
        this.trackWrite(change)
      } catch (error) {
        this._failedWrites.push(change)
        if (this.config.onError) {
          this.config.onError(error as Error, change)
        } else {
          throw error
        }
      }
    }

    // Auto-commit if configured
    if (this.config.autoCommit && this._isTransactionActive) {
      this.commitTransaction()
      if (this.config.autoBegin) {
        this.beginTransaction()
      }
    }
  }

  /**
   * Rolls back the current transaction, discarding pending writes.
   *
   * @throws Error if no transaction is active
   */
  rollback(): void {
    if (!this._isTransactionActive) {
      throw new Error('No active transaction')
    }

    this.clearAutoFlushTimer()

    const discarded = this.pendingWrites
    this.pendingWrites = []

    if (this.config.preserveRolledBack) {
      this._rolledBackWrites = [...discarded]
    }

    if (this.config.onRollback) {
      this.config.onRollback(discarded)
    }

    this._isTransactionActive = false
  }

  /**
   * Clears the list of failed writes.
   */
  clearFailedWrites(): void {
    this._failedWrites = []
  }

  /**
   * Retries failed writes by re-queueing them.
   * Requires an active transaction.
   */
  retryFailedWrites(): void {
    const failed = this._failedWrites
    this._failedWrites = []
    for (const write of failed) {
      this.pendingWrites.push(write)
    }
  }

  /**
   * Re-queues rolled back writes.
   * Requires an active transaction.
   */
  requeueRolledBack(): void {
    const rolledBack = this._rolledBackWrites
    this._rolledBackWrites = []
    for (const write of rolledBack) {
      this.pendingWrites.push(write)
    }
  }

  /**
   * Gets the current write statistics.
   */
  getStats(): WriteStats {
    return { ...this.stats }
  }

  /**
   * Resets the write statistics.
   */
  resetStats(): void {
    this.stats = {
      totalWrites: 0,
      insertCount: 0,
      updateCount: 0,
      deleteCount: 0,
    }
  }

  /**
   * Disposes of the writer, optionally flushing pending writes.
   */
  dispose(): void {
    if (this._disposed) {
      return
    }

    this._disposed = true
    this.clearAutoFlushTimer()

    if (this.config.flushOnDispose && this.pendingWrites.length > 0) {
      this.flush()
    } else {
      this.pendingWrites = []
    }
  }

  private trackWrite(change: ChangeMessage<T>): void {
    this.stats.totalWrites++
    this.currentTxStats.totalWrites++

    switch (change.type) {
      case 'insert':
        this.stats.insertCount++
        this.currentTxStats.insertCount++
        break
      case 'update':
        this.stats.updateCount++
        this.currentTxStats.updateCount++
        break
      case 'delete':
        this.stats.deleteCount++
        this.currentTxStats.deleteCount++
        break
    }
  }

  private resetAutoFlushTimer(): void {
    if (this.config.autoFlushMs <= 0) {
      return
    }

    this.clearAutoFlushTimer()
    this.autoFlushTimer = setTimeout(() => {
      if (!this._disposed && this.pendingWrites.length > 0) {
        this.flush()
      }
    }, this.config.autoFlushMs)
  }

  private clearAutoFlushTimer(): void {
    if (this.autoFlushTimer !== null) {
      clearTimeout(this.autoFlushTimer)
      this.autoFlushTimer = null
    }
  }
}
