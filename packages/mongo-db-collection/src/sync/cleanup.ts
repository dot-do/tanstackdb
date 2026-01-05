/**
 * Sync Cleanup Function
 *
 * Provides resource cleanup for MongoDB sync operations including:
 * - Closing change stream connections
 * - Disconnecting from mongo.do service
 * - Clearing event buffers to free memory
 * - Cancelling pending operations (in-flight requests)
 * - Idempotent operation (safe to call multiple times)
 *
 * @module @tanstack/mongo-db-collection/sync/cleanup
 */

/**
 * Represents the current state of the cleanup manager.
 */
export type SyncCleanupState = 'idle' | 'cleaning_up' | 'cleaned_up'

/**
 * Represents a pending operation that can be cancelled.
 */
export interface PendingOperation {
  /** Unique identifier for the operation */
  id: string
  /** Type of operation (e.g., 'find', 'update', 'insert') */
  type: string
  /** Timestamp when the operation started */
  startedAt: number
}

/**
 * Interface for a change stream that can be closed.
 */
export interface ChangeStreamLike {
  /** Closes the change stream */
  close: () => Promise<void>
  /** Returns whether the change stream is already closed */
  isClosed: () => boolean
}

/**
 * Interface for a mongo.do client that can be disconnected.
 */
export interface MongoDoClientLike {
  /** Disconnects from the mongo.do service */
  disconnect: () => Promise<void>
  /** Returns whether the client is currently connected */
  isConnected: () => boolean
}

/**
 * Interface for an event buffer that can be cleared.
 */
export interface EventBufferLike<T = unknown> {
  /** Clears all events from the buffer */
  clear: () => void
  /** Returns the current number of events in the buffer */
  size: () => number
  /** Returns all events in the buffer */
  getEvents: () => T[]
}

/**
 * Interface for pending operations management.
 */
export interface PendingOperationsLike {
  /** Cancels all pending operations with the given reason */
  cancel: (reason: string) => void
  /** Returns all pending operations */
  getPending: () => PendingOperation[]
  /** Returns whether there are any pending operations */
  hasPending: () => boolean
}

/**
 * Error information for a cleanup phase.
 */
export interface CleanupPhaseError {
  /** The phase where the error occurred */
  phase: 'changeStream' | 'client' | 'eventBuffer' | 'pendingOperations'
  /** The error that occurred */
  error: Error
}

/**
 * Result of a cleanup operation.
 */
export interface CleanupResult {
  /** Whether the cleanup completed successfully (all phases succeeded) */
  success: boolean
  /** Duration of the cleanup operation in milliseconds */
  durationMs: number
  /** Number of events that were cleared from the buffer */
  clearedEvents: number
  /** Number of pending operations that were cancelled */
  cancelledOperations: number
  /** Array of errors that occurred during cleanup */
  errors: CleanupPhaseError[]
  /** Whether the cleanup operation timed out */
  timedOut: boolean
  /** Whether cleanup was already performed (subsequent calls return this as true) */
  alreadyCleanedUp: boolean
}

/**
 * Configuration options for SyncCleanupManager.
 */
export interface SyncCleanupOptions {
  /** The change stream to close */
  changeStream?: ChangeStreamLike
  /** The mongo.do client to disconnect */
  client?: MongoDoClientLike
  /** The event buffer to clear */
  eventBuffer?: EventBufferLike
  /** The pending operations manager */
  pendingOperations?: PendingOperationsLike
  /** Timeout for cleanup operations in milliseconds */
  timeoutMs?: number
  /** Callback for cleanup progress updates */
  onProgress?: (phase: string) => void
  /** Callback for cleanup errors */
  onError?: (error: CleanupPhaseError) => void
  /** Callback for state changes */
  onStateChange?: (state: SyncCleanupState) => void
}

/**
 * Manages cleanup of MongoDB sync resources.
 *
 * This class provides a structured way to clean up all resources associated
 * with a MongoDB sync operation. It ensures that cleanup is:
 *
 * - **Complete**: All resources (change stream, client, buffer, operations) are cleaned up
 * - **Ordered**: Resources are cleaned up in the correct order to avoid errors
 * - **Resilient**: Errors in one phase don't prevent other phases from running
 * - **Idempotent**: Safe to call multiple times without side effects
 * - **Observable**: Progress and errors can be monitored via callbacks
 *
 * @example Basic usage
 * ```typescript
 * const cleanup = new SyncCleanupManager({
 *   changeStream,
 *   client,
 *   eventBuffer,
 *   pendingOperations,
 * })
 *
 * const result = await cleanup.cleanup()
 * console.log(`Cleanup ${result.success ? 'succeeded' : 'failed'}`)
 * ```
 *
 * @example With callbacks
 * ```typescript
 * const cleanup = new SyncCleanupManager({
 *   changeStream,
 *   client,
 *   eventBuffer,
 *   pendingOperations,
 *   onProgress: (phase) => console.log(`Cleaning up ${phase}...`),
 *   onError: (err) => console.error(`Error in ${err.phase}:`, err.error),
 * })
 * ```
 */
export class SyncCleanupManager {
  private _state: SyncCleanupState = 'idle'
  private _cleanupPromise: Promise<CleanupResult> | null = null
  private _cleanupResult: CleanupResult | null = null

  private readonly _changeStream?: ChangeStreamLike
  private readonly _client?: MongoDoClientLike
  private readonly _eventBuffer?: EventBufferLike
  private readonly _pendingOperations?: PendingOperationsLike
  private readonly _timeoutMs: number
  private readonly _onProgress?: (phase: string) => void
  private readonly _onError?: (error: CleanupPhaseError) => void
  private readonly _onStateChange?: (state: SyncCleanupState) => void

  /**
   * Creates a new SyncCleanupManager.
   *
   * @param options - Configuration options for cleanup
   */
  constructor(options: SyncCleanupOptions = {}) {
    this._changeStream = options.changeStream
    this._client = options.client
    this._eventBuffer = options.eventBuffer
    this._pendingOperations = options.pendingOperations
    this._timeoutMs = options.timeoutMs ?? 30000
    this._onProgress = options.onProgress
    this._onError = options.onError
    this._onStateChange = options.onStateChange
  }

  /**
   * The current state of the cleanup manager.
   */
  get state(): SyncCleanupState {
    return this._state
  }

  /**
   * Whether cleanup has been performed.
   */
  get isCleanedUp(): boolean {
    return this._state === 'cleaned_up'
  }

  /**
   * Performs cleanup of all resources.
   *
   * This method is idempotent - calling it multiple times will return
   * the same result after the first cleanup completes.
   *
   * @returns Promise resolving to the cleanup result
   */
  async cleanup(): Promise<CleanupResult> {
    // If already cleaned up, return the cached result
    if (this._state === 'cleaned_up' && this._cleanupResult) {
      return {
        ...this._cleanupResult,
        alreadyCleanedUp: true,
      }
    }

    // If cleanup is in progress, wait for it to complete
    if (this._cleanupPromise) {
      return this._cleanupPromise
    }

    // Start cleanup
    this._cleanupPromise = this._performCleanup()
    return this._cleanupPromise
  }

  /**
   * Performs the actual cleanup operation.
   *
   * @internal
   */
  private async _performCleanup(): Promise<CleanupResult> {
    const startTime = Date.now()
    const errors: CleanupPhaseError[] = []
    let clearedEvents = 0
    let cancelledOperations = 0
    let timedOut = false

    // Transition to cleaning_up state
    this._setState('cleaning_up')

    // Create a timeout promise if timeout is configured
    const timeoutPromise = this._timeoutMs > 0
      ? new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), this._timeoutMs))
      : null

    // Wrap the cleanup in a race with the timeout
    const cleanupWork = async () => {
      // Phase 1: Cancel pending operations (before disconnecting)
      if (this._pendingOperations) {
        this._onProgress?.('pendingOperations')
        try {
          if (this._pendingOperations.hasPending()) {
            cancelledOperations = this._pendingOperations.getPending().length
            this._pendingOperations.cancel('Cleanup: operations cancelled')
          }
        } catch (error) {
          const phaseError: CleanupPhaseError = {
            phase: 'pendingOperations',
            error: error instanceof Error ? error : new Error(String(error)),
          }
          errors.push(phaseError)
          this._onError?.(phaseError)
        }
      }

      // Phase 2: Close change stream
      if (this._changeStream) {
        this._onProgress?.('changeStream')
        try {
          if (!this._changeStream.isClosed()) {
            await this._changeStream.close()
          }
        } catch (error) {
          const phaseError: CleanupPhaseError = {
            phase: 'changeStream',
            error: error instanceof Error ? error : new Error(String(error)),
          }
          errors.push(phaseError)
          this._onError?.(phaseError)
        }
      }

      // Phase 3: Clear event buffer
      if (this._eventBuffer) {
        this._onProgress?.('eventBuffer')
        try {
          clearedEvents = this._eventBuffer.size()
          this._eventBuffer.clear()
        } catch (error) {
          const phaseError: CleanupPhaseError = {
            phase: 'eventBuffer',
            error: error instanceof Error ? error : new Error(String(error)),
          }
          errors.push(phaseError)
          this._onError?.(phaseError)
        }
      }

      // Phase 4: Disconnect client
      if (this._client) {
        this._onProgress?.('client')
        try {
          if (this._client.isConnected()) {
            await this._client.disconnect()
          }
        } catch (error) {
          const phaseError: CleanupPhaseError = {
            phase: 'client',
            error: error instanceof Error ? error : new Error(String(error)),
          }
          errors.push(phaseError)
          this._onError?.(phaseError)
        }
      }
    }

    // Execute cleanup with optional timeout
    if (timeoutPromise) {
      const result = await Promise.race([
        cleanupWork().then(() => 'done' as const),
        timeoutPromise,
      ])

      if (result === 'timeout') {
        timedOut = true
        // Add timeout error for the current phase
        const phaseError: CleanupPhaseError = {
          phase: 'changeStream',
          error: new Error('Cleanup operation timed out'),
        }
        errors.push(phaseError)
        this._onError?.(phaseError)
      }
    } else {
      await cleanupWork()
    }

    // Transition to cleaned_up state
    this._setState('cleaned_up')

    // Build result
    const result: CleanupResult = {
      success: errors.length === 0,
      durationMs: Date.now() - startTime,
      clearedEvents,
      cancelledOperations,
      errors,
      timedOut,
      alreadyCleanedUp: false,
    }

    // Cache the result for subsequent calls
    this._cleanupResult = result

    return result
  }

  /**
   * Updates the state and notifies the callback.
   *
   * @internal
   */
  private _setState(state: SyncCleanupState): void {
    this._state = state
    this._onStateChange?.(state)
  }
}

/**
 * Creates a simple cleanup function for MongoDB sync resources.
 *
 * This is a convenience wrapper around SyncCleanupManager that returns
 * a simple async function suitable for use as a cleanup callback.
 *
 * The returned function is idempotent and will not throw errors.
 *
 * @param options - Configuration options for cleanup
 * @returns An async cleanup function
 *
 * @example
 * ```typescript
 * const cleanup = createSyncCleanup({
 *   changeStream,
 *   client,
 *   eventBuffer,
 *   pendingOperations,
 * })
 *
 * // Later, when cleanup is needed:
 * await cleanup()
 *
 * // Safe to call multiple times:
 * await cleanup() // No-op
 * ```
 */
export function createSyncCleanup(options: SyncCleanupOptions): () => Promise<void> {
  const manager = new SyncCleanupManager(options)

  return async () => {
    try {
      await manager.cleanup()
    } catch {
      // Suppress errors - cleanup should never throw
    }
  }
}
