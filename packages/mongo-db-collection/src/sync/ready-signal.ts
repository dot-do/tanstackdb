/**
 * Ready Signal Handler
 *
 * Manages the synchronization "ready" state for MongoDB change stream sync operations.
 * Responsible for:
 * 1. Tracking when initial sync is complete
 * 2. Buffering events received during initial sync
 * 3. Processing buffered events before signaling ready
 * 4. Ensuring ready is only signaled once
 * 5. Handling errors that occur before ready state
 *
 * @module @tanstack/mongo-db-collection/sync/ready-signal
 */

import type { ChangeMessage } from '../types.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Event types emitted by ReadySignalHandler
 */
type ReadySignalEvents = {
  ready: () => void
  error: (error: Error) => void
}

/**
 * Event listener function type
 */
type EventListener<T extends keyof ReadySignalEvents> = ReadySignalEvents[T]

/**
 * Configuration options for ReadySignalHandler
 */
export interface ReadySignalHandlerConfig<T> {
  /** Callback when ready state is reached */
  onReady?: () => void
  /** Callback when an error occurs */
  onError?: (error: Error) => void
  /** Function to process events */
  eventProcessor?: (event: ChangeMessage<T>) => void
  /** Timeout in milliseconds for ready state */
  readyTimeout?: number
}

/**
 * Statistics about the handler state
 */
export interface ReadySignalStats {
  isReady: boolean
  hasError: boolean
  bufferedEventCount: number
  readyAfterMs?: number
}

// ============================================================================
// ReadySignalHandler Class
// ============================================================================

/**
 * Manages the ready signal state for MongoDB sync operations.
 *
 * The handler buffers events received during initial sync and processes
 * them in order when the ready signal is triggered. It ensures ready
 * is only signaled once and properly handles errors.
 *
 * @typeParam T - The document type
 *
 * @example
 * ```typescript
 * const handler = new ReadySignalHandler<MyDocument>({
 *   onReady: () => console.log('Sync ready!'),
 *   onError: (err) => console.error('Sync failed:', err),
 *   eventProcessor: (event) => collection.applyChange(event),
 * })
 *
 * // Buffer events during initial sync
 * handler.bufferEvent(changeEvent)
 *
 * // Signal ready when initial sync completes
 * handler.markReady()
 * ```
 */
export class ReadySignalHandler<T> {
  private _isReady = false
  private _hasError = false
  private _isDisposed = false
  private _lastError: Error | undefined
  private _buffer: ChangeMessage<T>[] = []
  private _listeners: Map<keyof ReadySignalEvents, Set<EventListener<keyof ReadySignalEvents>>> = new Map()
  private _readyPromise: Promise<void> | null = null
  private _readyResolve: (() => void) | null = null
  private _readyReject: ((error: Error) => void) | null = null
  private _timeoutId: ReturnType<typeof setTimeout> | null = null
  private _startTime: number
  private _readyTime: number | undefined

  private readonly _onReady?: () => void
  private readonly _onError?: (error: Error) => void
  private readonly _eventProcessor?: (event: ChangeMessage<T>) => void
  private readonly _readyTimeout?: number

  /**
   * Creates a new ReadySignalHandler instance.
   *
   * @param config - Configuration options
   */
  constructor(config: ReadySignalHandlerConfig<T> = {}) {
    this._onReady = config.onReady
    this._onError = config.onError
    this._eventProcessor = config.eventProcessor
    this._readyTimeout = config.readyTimeout
    this._startTime = Date.now()
  }

  // ==========================================================================
  // Public Properties
  // ==========================================================================

  /**
   * Whether the handler has reached ready state.
   */
  get isReady(): boolean {
    return this._isReady
  }

  /**
   * Whether an error has occurred.
   */
  get hasError(): boolean {
    return this._hasError
  }

  /**
   * Whether the handler has been disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed
  }

  /**
   * The last error that occurred, if any.
   */
  get lastError(): Error | undefined {
    return this._lastError
  }

  /**
   * The number of events currently buffered.
   */
  get bufferedEventCount(): number {
    return this._buffer.length
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  /**
   * Marks the handler as ready.
   *
   * This will:
   * 1. Process all buffered events in order
   * 2. Call the onReady callback
   * 3. Emit the 'ready' event
   * 4. Resolve any pending waitForReady promises
   *
   * Subsequent calls after the first are ignored with a warning.
   */
  markReady(): void {
    // Ignore if disposed
    if (this._isDisposed) {
      return
    }

    // Don't allow marking ready after error
    if (this._hasError) {
      return
    }

    // Only signal ready once
    if (this._isReady) {
      console.warn('ReadySignalHandler: already ready, ignoring subsequent markReady call')
      return
    }

    // Clear timeout if set
    this._clearTimeout()

    // Process buffered events first
    try {
      this._processBufferedEvents()
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)))
      return
    }

    // Set ready state
    this._isReady = true
    this._readyTime = Date.now()

    // Call callback
    this._onReady?.()

    // Emit event
    this._emit('ready')

    // Resolve pending promise
    this._readyResolve?.()
  }

  /**
   * Buffers an event to be processed when ready.
   *
   * @param event - The change event to buffer
   */
  bufferEvent(event: ChangeMessage<T>): void {
    if (this._isDisposed || this._hasError) {
      return
    }

    this._buffer.push(event)
  }

  /**
   * Processes an event, buffering if not ready or processing directly if ready.
   *
   * @param event - The change event to process
   */
  processEvent(event: ChangeMessage<T>): void {
    if (this._isDisposed || this._hasError) {
      return
    }

    if (this._isReady) {
      // Process directly
      this._eventProcessor?.(event)
    } else {
      // Buffer for later
      this.bufferEvent(event)
    }
  }

  /**
   * Handles an error that occurred during sync.
   *
   * This will:
   * 1. Set the error state
   * 2. Clear buffered events
   * 3. Call the onError callback
   * 4. Emit the 'error' event
   * 5. Reject any pending waitForReady promises
   *
   * @param error - The error that occurred
   */
  handleError(error: Error): void {
    if (this._isDisposed) {
      return
    }

    this._hasError = true
    this._lastError = error
    this._buffer = []

    // Clear timeout
    this._clearTimeout()

    // Call callback
    this._onError?.(error)

    // Emit event
    this._emit('error', error)

    // Reject pending promise
    this._readyReject?.(error)
  }

  /**
   * Waits for the handler to reach ready state.
   *
   * @returns A promise that resolves when ready or rejects on error/dispose/timeout
   */
  waitForReady(): Promise<void> {
    // Already ready
    if (this._isReady) {
      return Promise.resolve()
    }

    // Already errored
    if (this._hasError && this._lastError) {
      return Promise.reject(this._lastError)
    }

    // Already disposed
    if (this._isDisposed) {
      return Promise.reject(new Error('ReadySignalHandler disposed'))
    }

    // Create promise if not exists
    if (!this._readyPromise) {
      this._readyPromise = new Promise<void>((resolve, reject) => {
        this._readyResolve = resolve
        this._readyReject = reject
      })

      // Set timeout if configured
      if (this._readyTimeout) {
        this._timeoutId = setTimeout(() => {
          const error = new Error(`Ready timeout after ${this._readyTimeout}ms`)
          this.handleError(error)
        }, this._readyTimeout)
      }
    }

    return this._readyPromise
  }

  /**
   * Resets the handler to its initial state.
   *
   * Clears error state, ready state, and buffered events.
   */
  reset(): void {
    this._isReady = false
    this._hasError = false
    this._lastError = undefined
    this._buffer = []
    this._readyPromise = null
    this._readyResolve = null
    this._readyReject = null
    this._readyTime = undefined
    this._startTime = Date.now()
    this._clearTimeout()
  }

  /**
   * Disposes the handler and cleans up resources.
   *
   * Clears all event listeners, buffered events, and rejects pending promises.
   */
  dispose(): void {
    if (this._isDisposed) {
      return
    }

    this._isDisposed = true

    // Clear timeout
    this._clearTimeout()

    // Reject pending promise
    this._readyReject?.(new Error('ReadySignalHandler disposed'))

    // Clear buffer
    this._buffer = []

    // Clear listeners
    this._listeners.clear()

    // Clear promise references
    this._readyPromise = null
    this._readyResolve = null
    this._readyReject = null
  }

  /**
   * Registers an event listener.
   *
   * @param event - The event type to listen for
   * @param listener - The listener function
   */
  on<E extends keyof ReadySignalEvents>(event: E, listener: ReadySignalEvents[E]): void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    this._listeners.get(event)!.add(listener as EventListener<keyof ReadySignalEvents>)
  }

  /**
   * Removes an event listener.
   *
   * @param event - The event type
   * @param listener - The listener function to remove
   */
  off<E extends keyof ReadySignalEvents>(event: E, listener: ReadySignalEvents[E]): void {
    this._listeners.get(event)?.delete(listener as EventListener<keyof ReadySignalEvents>)
  }

  /**
   * Gets current statistics about the handler state.
   *
   * @returns Statistics snapshot
   */
  getStats(): ReadySignalStats {
    return {
      isReady: this._isReady,
      hasError: this._hasError,
      bufferedEventCount: this._buffer.length,
      readyAfterMs: this._readyTime ? this._readyTime - this._startTime : undefined,
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Processes all buffered events in order.
   */
  private _processBufferedEvents(): void {
    if (!this._eventProcessor) {
      this._buffer = []
      return
    }

    const events = this._buffer
    this._buffer = []

    for (const event of events) {
      this._eventProcessor(event)
    }
  }

  /**
   * Emits an event to all registered listeners.
   */
  private _emit<E extends keyof ReadySignalEvents>(
    event: E,
    ...args: Parameters<ReadySignalEvents[E]>
  ): void {
    if (this._isDisposed) {
      return
    }

    const listeners = this._listeners.get(event)
    if (!listeners) {
      return
    }

    for (const listener of listeners) {
      try {
        (listener as (...args: unknown[]) => void)(...args)
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Clears the timeout if set.
   */
  private _clearTimeout(): void {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId)
      this._timeoutId = null
    }
  }
}
