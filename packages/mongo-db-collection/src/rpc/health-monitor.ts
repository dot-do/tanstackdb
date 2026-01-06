/**
 * @file Connection Health Monitor
 *
 * The health monitor tracks connection health via heartbeats/pings and
 * triggers automatic reconnection when the connection becomes unhealthy.
 *
 * Features:
 * - Health monitoring with configurable heartbeat intervals
 * - Connection health state tracking (healthy, degraded, unhealthy)
 * - Automatic reconnection triggering based on health thresholds
 * - Latency tracking and reporting
 * - Health check callback integration
 * - Event emission for health state changes
 * - Graceful start/stop of monitoring
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Health state of the connection
 */
export type HealthState = 'healthy' | 'degraded' | 'unhealthy'

/**
 * Reconnect callback type
 */
export type ReconnectCallback = () => Promise<void>

/**
 * Ping function type
 */
export type PingFn = () => Promise<void>

/**
 * Options for the health monitor
 */
export interface HealthMonitorOptions {
  pingFn: PingFn
  pingInterval?: number
  pingTimeout?: number
  unhealthyThreshold?: number
  degradedThreshold?: number
  healthyThreshold?: number
  reconnectOnUnhealthy?: boolean
  onReconnect?: ReconnectCallback
}

/**
 * Health status information
 */
export interface HealthStatus {
  state: HealthState
  consecutiveFailures: number
  consecutiveSuccesses: number
  lastPingTime: number | null
  isRunning: boolean
  totalPings: number
  latency?: {
    current: number
    average: number
    min: number
    max: number
  }
}

/**
 * Result of a health check
 */
export interface HealthCheckResult {
  success: boolean
  latency?: number
  error?: Error
}

/**
 * Event handler types
 */
export interface HealthChangeEvent {
  state: HealthState
  previousState: HealthState
}

export interface PingSuccessEvent {
  latency: number
}

export interface PingFailureEvent {
  error: Error
  consecutiveFailures: number
}

export interface ReconnectFailedEvent {
  error: Error
}

// =============================================================================
// Implementation
// =============================================================================

type EventHandler = (...args: unknown[]) => void

/**
 * ConnectionHealthMonitor monitors connection health via pings
 */
export class ConnectionHealthMonitor {
  private _options: Required<HealthMonitorOptions>
  private _state: HealthState = 'healthy'
  private _isRunning = false
  private _consecutiveFailures = 0
  private _consecutiveSuccesses = 0
  private _lastPingTime: number | null = null
  private _totalPings = 0
  private _pingIntervalId: ReturnType<typeof setInterval> | null = null
  private _eventListeners: Map<string, Set<EventHandler>> = new Map()
  private _latencies: number[] = []
  private _isReconnecting = false
  private _destroyed = false

  constructor(options: HealthMonitorOptions) {
    this._options = {
      pingFn: options.pingFn,
      pingInterval: options.pingInterval ?? 30000,
      pingTimeout: options.pingTimeout ?? 5000,
      unhealthyThreshold: options.unhealthyThreshold ?? 3,
      degradedThreshold: options.degradedThreshold ?? 1,
      healthyThreshold: options.healthyThreshold ?? 2,
      reconnectOnUnhealthy: options.reconnectOnUnhealthy ?? false,
      onReconnect: options.onReconnect ?? (async () => {}),
    }
  }

  get options(): Required<HealthMonitorOptions> {
    return this._options
  }

  get state(): HealthState {
    return this._state
  }

  get isRunning(): boolean {
    return this._isRunning
  }

  start(): void {
    if (this._isRunning || this._destroyed) return

    this._isRunning = true

    // Send immediate ping via setTimeout(0) for proper fake timer integration
    setTimeout(() => {
      if (this._isRunning && !this._isReconnecting) {
        void this._ping()
      }
    }, 0)

    // Set up interval
    this._pingIntervalId = setInterval(() => {
      if (!this._isReconnecting) {
        void this._ping()
      }
    }, this._options.pingInterval)
  }

  stop(): void {
    this._isRunning = false

    if (this._pingIntervalId !== null) {
      clearInterval(this._pingIntervalId)
      this._pingIntervalId = null
    }
  }

  private async _ping(): Promise<void> {
    this._emit('ping')
    this._totalPings++

    const startTime = Date.now()

    try {
      // Race the ping against timeout
      await Promise.race([
        this._options.pingFn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Ping timeout')), this._options.pingTimeout)
        ),
      ])

      const latency = Date.now() - startTime
      this._lastPingTime = Date.now()
      this._latencies.push(latency)

      // Keep only last 100 latencies
      if (this._latencies.length > 100) {
        this._latencies.shift()
      }

      this._handlePingSuccess(latency)
    } catch (error) {
      this._handlePingFailure(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private _handlePingSuccess(latency: number): void {
    this._consecutiveFailures = 0
    this._consecutiveSuccesses++

    this._emit('pingSuccess', { latency })

    // Check if we should transition to healthy
    if (
      this._state !== 'healthy' &&
      this._consecutiveSuccesses >= this._options.healthyThreshold
    ) {
      this._transitionState('healthy')
    }
  }

  private _handlePingFailure(error: Error): void {
    this._consecutiveSuccesses = 0
    this._consecutiveFailures++

    this._emit('pingFailure', {
      error,
      consecutiveFailures: this._consecutiveFailures,
    })

    // Check state transitions
    if (
      this._state === 'healthy' &&
      this._consecutiveFailures >= this._options.degradedThreshold
    ) {
      this._transitionState('degraded')
    }

    if (
      this._state !== 'unhealthy' &&
      this._consecutiveFailures >= this._options.unhealthyThreshold
    ) {
      this._transitionState('unhealthy')
      void this._triggerReconnect()
    }
  }

  private _transitionState(newState: HealthState): void {
    const previousState = this._state
    this._state = newState

    this._emit('healthChange', {
      state: newState,
      previousState,
    })
  }

  private async _triggerReconnect(): Promise<void> {
    if (!this._options.reconnectOnUnhealthy || this._isReconnecting) return

    this._isReconnecting = true
    this._emit('reconnecting')

    try {
      await this._options.onReconnect()

      // Reset state after successful reconnection
      this._state = 'healthy'
      this._consecutiveFailures = 0
      this._consecutiveSuccesses = 0

      this._emit('reconnected')
    } catch (error) {
      this._emit('reconnectFailed', {
        error: error instanceof Error ? error : new Error(String(error)),
      })
    } finally {
      this._isReconnecting = false
    }
  }

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now()

    try {
      // Execute ping without timeout race for manual checks
      // This allows the ping to complete naturally without fake timer issues
      await this._options.pingFn()

      const latency = Date.now() - startTime

      // If running, update internal state
      if (this._isRunning) {
        this._handlePingSuccess(latency)
      }

      return { success: true, latency }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // If running, update internal state
      if (this._isRunning) {
        this._handlePingFailure(err)
      }

      return { success: false, error: err }
    }
  }

  getStatus(): HealthStatus {
    const status: HealthStatus = {
      state: this._state,
      consecutiveFailures: this._consecutiveFailures,
      consecutiveSuccesses: this._consecutiveSuccesses,
      lastPingTime: this._lastPingTime,
      isRunning: this._isRunning,
      totalPings: this._totalPings,
    }

    if (this._latencies.length > 0) {
      const sum = this._latencies.reduce((a, b) => a + b, 0)
      status.latency = {
        current: this._latencies[this._latencies.length - 1],
        average: sum / this._latencies.length,
        min: Math.min(...this._latencies),
        max: Math.max(...this._latencies),
      }
    }

    return status
  }

  setPingInterval(interval: number): void {
    this._options.pingInterval = interval

    // Restart interval if running
    if (this._isRunning && this._pingIntervalId !== null) {
      clearInterval(this._pingIntervalId)
      this._pingIntervalId = setInterval(() => {
        if (!this._isReconnecting) {
          void this._ping()
        }
      }, this._options.pingInterval)
    }
  }

  setReconnectCallback(callback: ReconnectCallback): void {
    this._options.onReconnect = callback
  }

  setThresholds(thresholds: {
    degradedThreshold?: number
    unhealthyThreshold?: number
    healthyThreshold?: number
  }): void {
    if (thresholds.degradedThreshold !== undefined) {
      this._options.degradedThreshold = thresholds.degradedThreshold
    }
    if (thresholds.unhealthyThreshold !== undefined) {
      this._options.unhealthyThreshold = thresholds.unhealthyThreshold
    }
    if (thresholds.healthyThreshold !== undefined) {
      this._options.healthyThreshold = thresholds.healthyThreshold
    }
  }

  on(event: string, handler: EventHandler): void {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set())
    }
    this._eventListeners.get(event)!.add(handler)
  }

  off(event: string, handler: EventHandler): void {
    this._eventListeners.get(event)?.delete(handler)
  }

  private _emit(event: string, ...args: unknown[]): void {
    this._eventListeners.get(event)?.forEach((handler) => handler(...args))
  }

  listenerCount(event: string): number {
    return this._eventListeners.get(event)?.size ?? 0
  }

  destroy(): void {
    if (this._destroyed) return

    this._destroyed = true
    this.stop()
    this._eventListeners.clear()
  }
}
