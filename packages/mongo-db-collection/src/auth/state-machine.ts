/**
 * @file Auth State Machine
 * @module @tanstack/mongo-db-collection/auth/state-machine
 *
 * Implements a finite state machine for managing authentication state transitions.
 * Handles authentication flows including login, token refresh, expiration, and failures.
 *
 * @description
 * This module provides a robust, type-safe state machine for authentication management.
 * It supports transition guards, state history tracking, debug logging, and optional
 * state persistence. The API is inspired by XState for familiarity.
 *
 * ## State Diagram (ASCII)
 *
 * ```
 *                    ┌─────────────────────────────────────────┐
 *                    │              [reset]                    │
 *                    ▼                                         │
 *     ┌──────────────────────────┐                            │
 *     │     unauthenticated      │◄───────────────────────────┤
 *     └──────────────────────────┘                            │
 *                    │                                         │
 *                    │ [authenticate]                          │
 *                    ▼                                         │
 *     ┌──────────────────────────┐                            │
 *     │      authenticating      │────┐                       │
 *     │     (timeout: 30s)       │    │                       │
 *     └──────────────────────────┘    │                       │
 *           │              │          │                       │
 *  [success]│              │[failure] │[timeout]              │
 *           ▼              │          │                       │
 *     ┌──────────────────────────┐    │                       │
 *     │      authenticated       │    │                       │
 *     └──────────────────────────┘    │                       │
 *           │              │          │                       │
 *  [refresh]│              │[expire]  │                       │
 *           ▼              └──────────┼───────────────────────┘
 *     ┌──────────────────────────┐    │
 *     │       refreshing         │────┤
 *     │     (timeout: 30s)       │    │
 *     └──────────────────────────┘    │
 *           │              │          │
 *  [success]│              │[failure] │[timeout]
 *           │              │          │
 *           │              ▼          ▼
 *           │       ┌──────────────────────────┐
 *           │       │         failed           │
 *           │       └──────────────────────────┘
 *           │                    │
 *           │                    │ [authenticate]
 *           │                    ▼
 *           └────────────────────┴──► (back to authenticating)
 * ```
 *
 * ## State Descriptions
 *
 * - **unauthenticated**: Initial state. No valid credentials. Can only transition
 *   to `authenticating` via the `authenticate` event.
 *
 * - **authenticating**: Credentials are being validated. Will transition to
 *   `authenticated` on success, `failed` on failure, or auto-transition to
 *   `failed` after timeout (default 30s).
 *
 * - **authenticated**: Valid credentials. Can transition to `refreshing` when
 *   token needs refresh, or `unauthenticated` when token expires.
 *
 * - **refreshing**: Token refresh in progress. Similar timeout behavior to
 *   `authenticating`. Transitions to `authenticated` on success or `failed`
 *   on failure/timeout.
 *
 * - **failed**: Authentication or refresh failed. Can retry via `authenticate`.
 *
 * ## Events
 *
 * | Event        | Description                                    |
 * |--------------|------------------------------------------------|
 * | authenticate | Begin authentication process                   |
 * | success      | Authentication/refresh succeeded               |
 * | failure      | Authentication/refresh failed                  |
 * | refresh      | Begin token refresh                            |
 * | expire       | Token has expired                              |
 * | reset        | Force reset to unauthenticated (from any state)|
 *
 * ## Transition Table
 *
 * | From State       | Event        | To State         | Guard                |
 * |------------------|--------------|------------------|----------------------|
 * | unauthenticated  | authenticate | authenticating   | -                    |
 * | authenticating   | success      | authenticated    | -                    |
 * | authenticating   | failure      | failed           | -                    |
 * | authenticated    | refresh      | refreshing       | -                    |
 * | authenticated    | expire       | unauthenticated  | -                    |
 * | refreshing       | success      | authenticated    | -                    |
 * | refreshing       | failure      | failed           | -                    |
 * | failed           | authenticate | authenticating   | maxRetries not hit   |
 * | *                | reset        | unauthenticated  | -                    |
 *
 * @example Basic Usage
 * ```typescript
 * import { AuthStateMachine } from '@tanstack/mongo-db-collection/auth/state-machine';
 *
 * const machine = new AuthStateMachine();
 *
 * machine.on('stateChange', ({ from, to, event }) => {
 *   console.log(`Auth: ${from} -> ${to} via ${event}`);
 * });
 *
 * machine.transition('authenticate');
 * // Later, on success:
 * machine.transition('success');
 * ```
 *
 * @example With Guards and History
 * ```typescript
 * const machine = new AuthStateMachine({
 *   guards: {
 *     canAuthenticate: (ctx) => ctx.retryCount < 3,
 *   },
 *   debug: true,
 *   historySize: 10,
 * });
 *
 * // Check history
 * console.log(machine.getHistory());
 * ```
 *
 * @example With Persistence
 * ```typescript
 * const machine = new AuthStateMachine({
 *   persistence: {
 *     save: (state) => localStorage.setItem('authState', JSON.stringify(state)),
 *     load: () => JSON.parse(localStorage.getItem('authState') || 'null'),
 *   },
 * });
 * ```
 *
 * @see {@link https://xstate.js.org/docs/} XState Documentation (API inspiration)
 * @see {@link https://en.wikipedia.org/wiki/Finite-state_machine} FSM Theory
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Valid authentication states in the state machine.
 *
 * @remarks
 * States are categorized as:
 * - Terminal states: `unauthenticated`, `authenticated`, `failed`
 * - Intermediate states: `authenticating`, `refreshing` (these have timeouts)
 */
export type AuthState = 'unauthenticated' | 'authenticating' | 'authenticated' | 'refreshing' | 'failed'

/**
 * Events that can trigger state transitions.
 *
 * @remarks
 * The `reset` event is special - it can be triggered from any state and
 * always transitions to `unauthenticated`.
 */
export type AuthEvent = 'authenticate' | 'success' | 'failure' | 'refresh' | 'expire' | 'reset'

/**
 * Represents a state change event emitted when the machine transitions.
 */
export interface AuthStateChange {
  /** The state before the transition */
  from: AuthState
  /** The state after the transition */
  to: AuthState
  /** The event that triggered the transition */
  event: AuthEvent
  /** Timestamp when the transition occurred */
  timestamp: number
  /** Context at the time of transition */
  context: Readonly<AuthContext>
}

/**
 * Represents a timeout event emitted when an intermediate state times out.
 */
export interface AuthTimeoutEvent {
  /** The state that timed out */
  state: AuthState
  /** The timeout duration in milliseconds */
  timeoutMs: number
  /** Timestamp when the timeout occurred */
  timestamp: number
}

/**
 * Entry in the state history.
 */
export interface HistoryEntry {
  /** The state that was entered */
  state: AuthState
  /** The event that caused entry into this state */
  event: AuthEvent
  /** Timestamp when the state was entered */
  timestamp: number
  /** Duration spent in this state (set when leaving) */
  durationMs?: number
}

/**
 * Context data maintained by the state machine.
 *
 * @remarks
 * Context provides additional data that can be used by guards and
 * for debugging/monitoring purposes.
 */
export interface AuthContext {
  /** Number of failed authentication attempts since last success */
  retryCount: number
  /** Timestamp of last successful authentication */
  lastAuthenticatedAt: number | null
  /** Timestamp of last failure */
  lastFailedAt: number | null
  /** Error message from last failure */
  lastError: string | null
  /** Custom metadata that can be set by consumers */
  metadata: Record<string, unknown>
}

/**
 * Guard function signature for conditional transitions.
 *
 * @param context - Current machine context
 * @param event - The event being processed
 * @returns true if the transition should proceed, false to block it
 */
export type TransitionGuard = (context: AuthContext, event: AuthEvent) => boolean

/**
 * Guard configuration mapping guard names to guard functions.
 */
export interface GuardConfig {
  /**
   * Guard for the authenticate event.
   * Useful for implementing retry limits.
   */
  canAuthenticate?: TransitionGuard

  /**
   * Guard for the refresh event.
   * Useful for preventing refresh in certain conditions.
   */
  canRefresh?: TransitionGuard

  /**
   * Custom guards that can be referenced by name.
   */
  [key: string]: TransitionGuard | undefined
}

/**
 * Persistence adapter interface for saving/loading state.
 */
export interface PersistenceAdapter {
  /**
   * Save the current state and context.
   *
   * @param state - Current state
   * @param context - Current context
   */
  save(state: AuthState, context: AuthContext): void | Promise<void>

  /**
   * Load previously saved state and context.
   *
   * @returns The saved state/context or null if none exists
   */
  load(): { state: AuthState; context: AuthContext } | null | Promise<{ state: AuthState; context: AuthContext } | null>
}

/**
 * Debug logger interface.
 */
export interface DebugLogger {
  /**
   * Log a debug message.
   * @param message - The message to log
   * @param data - Optional data to include
   */
  (message: string, data?: Record<string, unknown>): void
}

/**
 * Configuration options for the AuthStateMachine.
 */
export interface AuthStateMachineConfig {
  /**
   * Timeout in ms for stuck states (authenticating, refreshing).
   * @default 30000
   */
  timeout?: number

  /**
   * Maximum number of entries to keep in state history.
   * Set to 0 to disable history tracking.
   * @default 50
   */
  historySize?: number

  /**
   * Guard functions for conditional transitions.
   */
  guards?: GuardConfig

  /**
   * Enable debug logging.
   * Can be boolean or a custom logger function.
   * @default false
   */
  debug?: boolean | DebugLogger

  /**
   * Persistence adapter for saving/loading state.
   * When provided, state will be persisted on every transition.
   */
  persistence?: PersistenceAdapter

  /**
   * Initial context values (merged with defaults).
   */
  initialContext?: Partial<AuthContext>

  /**
   * Maximum number of retry attempts before blocking authenticate.
   * Only applies when using the default canAuthenticate guard.
   * @default Infinity
   */
  maxRetries?: number
}

// ============================================================================
// Internal Types
// ============================================================================

type EventType = 'stateChange' | 'timeout' | 'guardRejected'
type StateChangeListener = (change: AuthStateChange) => void
type TimeoutListener = (event: AuthTimeoutEvent) => void
type GuardRejectedListener = (event: GuardRejectedEvent) => void
type Listener = StateChangeListener | TimeoutListener | GuardRejectedListener

/**
 * Event emitted when a guard rejects a transition.
 */
export interface GuardRejectedEvent {
  /** The guard that rejected the transition */
  guard: string
  /** The event that was blocked */
  event: AuthEvent
  /** The current state */
  state: AuthState
  /** The context at rejection time */
  context: Readonly<AuthContext>
}

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for intermediate states (30 seconds) */
const DEFAULT_TIMEOUT = 30000

/** Default history size */
const DEFAULT_HISTORY_SIZE = 50

/** States that should timeout if stuck */
const TIMEOUT_STATES: AuthState[] = ['authenticating', 'refreshing']

/**
 * State transition map defining valid transitions.
 * Key: current state, Value: map of event to next state
 */
const TRANSITIONS: Record<AuthState, Partial<Record<AuthEvent, AuthState>>> = {
  unauthenticated: {
    authenticate: 'authenticating',
  },
  authenticating: {
    success: 'authenticated',
    failure: 'failed',
  },
  authenticated: {
    refresh: 'refreshing',
    expire: 'unauthenticated',
  },
  refreshing: {
    success: 'authenticated',
    failure: 'failed',
  },
  failed: {
    authenticate: 'authenticating',
  },
}

/**
 * Guard requirements for transitions.
 * Maps event names to guard function names.
 */
const TRANSITION_GUARDS: Partial<Record<AuthEvent, string>> = {
  authenticate: 'canAuthenticate',
  refresh: 'canRefresh',
}

// ============================================================================
// Default Context
// ============================================================================

/**
 * Creates a fresh default context.
 */
function createDefaultContext(overrides?: Partial<AuthContext>): AuthContext {
  return {
    retryCount: 0,
    lastAuthenticatedAt: null,
    lastFailedAt: null,
    lastError: null,
    metadata: {},
    ...overrides,
  }
}

// ============================================================================
// AuthStateMachine Class
// ============================================================================

/**
 * Authentication State Machine
 *
 * A robust finite state machine for managing authentication flows.
 * Provides XState-like ergonomics with guards, history, logging, and persistence.
 *
 * @example
 * ```typescript
 * const machine = new AuthStateMachine({ debug: true });
 *
 * machine.on('stateChange', (change) => {
 *   console.log(`State changed: ${change.from} -> ${change.to}`);
 * });
 *
 * machine.transition('authenticate');
 * // ... authentication logic ...
 * machine.transition('success');
 * ```
 */
export class AuthStateMachine {
  // -------------------------------------------------------------------------
  // Private Fields
  // -------------------------------------------------------------------------

  private state: AuthState = 'unauthenticated'
  private context: AuthContext
  private stateChangeListeners: StateChangeListener[] = []
  private timeoutListeners: TimeoutListener[] = []
  private guardRejectedListeners: GuardRejectedListener[] = []
  private timeoutTimer?: ReturnType<typeof setTimeout>
  private stateEnteredAt: number = Date.now()
  private history: HistoryEntry[] = []
  private config: Required<Omit<AuthStateMachineConfig, 'persistence' | 'guards' | 'initialContext'>> & {
    persistence?: PersistenceAdapter
    guards: GuardConfig
  }
  private debugLog: DebugLogger

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Creates a new AuthStateMachine instance.
   *
   * @param config - Optional configuration options
   *
   * @example
   * ```typescript
   * // Basic usage
   * const machine = new AuthStateMachine();
   *
   * // With configuration
   * const machine = new AuthStateMachine({
   *   timeout: 10000,
   *   debug: true,
   *   maxRetries: 3,
   * });
   * ```
   */
  constructor(config?: AuthStateMachineConfig) {
    // Initialize config with defaults
    this.config = {
      timeout: config?.timeout ?? DEFAULT_TIMEOUT,
      historySize: config?.historySize ?? DEFAULT_HISTORY_SIZE,
      debug: config?.debug ?? false,
      maxRetries: config?.maxRetries ?? Infinity,
      persistence: config?.persistence,
      guards: this.buildGuards(config?.guards, config?.maxRetries),
    }

    // Initialize debug logger
    this.debugLog = this.createDebugLogger()

    // Initialize context
    this.context = createDefaultContext(config?.initialContext)

    this.debugLog('State machine initialized', {
      config: {
        timeout: this.config.timeout,
        historySize: this.config.historySize,
        maxRetries: this.config.maxRetries,
        hasGuards: Object.keys(this.config.guards).length > 0,
        hasPersistence: !!this.config.persistence,
      },
    })

    // Try to load persisted state
    this.loadPersistedState()

    // Record initial state in history
    this.recordHistory('reset')
  }

  // -------------------------------------------------------------------------
  // Public Methods - State Access
  // -------------------------------------------------------------------------

  /**
   * Get the current authentication state.
   *
   * @returns The current state
   *
   * @example
   * ```typescript
   * if (machine.getState() === 'authenticated') {
   *   // User is authenticated
   * }
   * ```
   */
  getState(): AuthState {
    return this.state
  }

  /**
   * Get a readonly copy of the current context.
   *
   * @returns The current context
   *
   * @example
   * ```typescript
   * const ctx = machine.getContext();
   * console.log(`Retry count: ${ctx.retryCount}`);
   * ```
   */
  getContext(): Readonly<AuthContext> {
    return { ...this.context }
  }

  /**
   * Get the state transition history.
   *
   * @returns Array of history entries, newest first
   *
   * @example
   * ```typescript
   * const history = machine.getHistory();
   * history.forEach(entry => {
   *   console.log(`${entry.state} (${entry.durationMs}ms)`);
   * });
   * ```
   */
  getHistory(): ReadonlyArray<HistoryEntry> {
    return [...this.history]
  }

  /**
   * Check if the machine is in a specific state.
   *
   * @param state - The state to check
   * @returns true if the machine is in the specified state
   *
   * @example
   * ```typescript
   * if (machine.matches('authenticated')) {
   *   // Perform authenticated action
   * }
   * ```
   */
  matches(state: AuthState): boolean {
    return this.state === state
  }

  /**
   * Check if a transition is valid from the current state.
   *
   * @param event - The event to check
   * @returns true if the transition would be valid (ignoring guards)
   *
   * @example
   * ```typescript
   * if (machine.can('authenticate')) {
   *   machine.transition('authenticate');
   * }
   * ```
   */
  can(event: AuthEvent): boolean {
    if (event === 'reset') return true
    return this.getNextState(event) !== null
  }

  // -------------------------------------------------------------------------
  // Public Methods - State Transitions
  // -------------------------------------------------------------------------

  /**
   * Transition to a new state based on an event.
   *
   * @param event - The event to trigger
   * @param errorMessage - Optional error message (used for failure events)
   * @throws Error if the transition is invalid for the current state
   * @throws Error if a guard blocks the transition
   *
   * @example
   * ```typescript
   * machine.transition('authenticate');
   *
   * // With error message
   * machine.transition('failure', 'Invalid credentials');
   * ```
   */
  transition(event: AuthEvent, errorMessage?: string): void {
    this.debugLog(`Transition requested: ${event}`, {
      currentState: this.state,
      errorMessage,
    })

    const nextState = this.getNextState(event)
    if (!nextState) {
      const error = `Invalid transition: ${event} from ${this.state}`
      this.debugLog(`Transition rejected: ${error}`)
      throw new Error(error)
    }

    // Check guards
    const guardName = TRANSITION_GUARDS[event]
    if (guardName && this.config.guards[guardName]) {
      const guard = this.config.guards[guardName]!
      if (!guard(this.context, event)) {
        this.debugLog(`Guard rejected transition: ${guardName}`, {
          event,
          context: this.context,
        })

        this.emitGuardRejected({
          guard: guardName,
          event,
          state: this.state,
          context: { ...this.context },
        })

        throw new Error(`Guard '${guardName}' rejected transition: ${event}`)
      }
    }

    // Update context based on transition
    this.updateContext(event, nextState, errorMessage)

    // Calculate duration in previous state
    const durationMs = Date.now() - this.stateEnteredAt

    // Update last history entry with duration
    const lastEntry = this.history[0]
    if (lastEntry) {
      lastEntry.durationMs = durationMs
    }

    const change: AuthStateChange = {
      from: this.state,
      to: nextState,
      event,
      timestamp: Date.now(),
      context: { ...this.context },
    }

    this.debugLog(`Transition executed: ${this.state} -> ${nextState}`, {
      event,
      durationInPreviousState: durationMs,
    })

    this.state = nextState
    this.stateEnteredAt = Date.now()

    // Record in history
    this.recordHistory(event)

    // Handle timeout for intermediate states
    this.handleTimeout()

    // Persist state
    this.persistState()

    // Emit state change
    this.emitStateChange(change)
  }

  /**
   * Attempt a transition, returning success/failure instead of throwing.
   *
   * @param event - The event to trigger
   * @param errorMessage - Optional error message (used for failure events)
   * @returns true if the transition succeeded, false otherwise
   *
   * @example
   * ```typescript
   * if (machine.tryTransition('authenticate')) {
   *   console.log('Authentication started');
   * } else {
   *   console.log('Could not start authentication');
   * }
   * ```
   */
  tryTransition(event: AuthEvent, errorMessage?: string): boolean {
    try {
      this.transition(event, errorMessage)
      return true
    } catch {
      return false
    }
  }

  /**
   * Reset the state machine to unauthenticated state.
   *
   * This is idempotent - no event is emitted if already unauthenticated.
   * Also resets the context to default values.
   *
   * @param clearHistory - Whether to also clear the state history
   *
   * @example
   * ```typescript
   * machine.reset();
   *
   * // Also clear history
   * machine.reset(true);
   * ```
   */
  reset(clearHistory = false): void {
    this.debugLog('Reset requested', { clearHistory })

    this.clearTimeout()

    if (clearHistory) {
      this.history = []
    }

    if (this.state === 'unauthenticated') {
      this.debugLog('Already unauthenticated, skipping reset')
      return
    }

    // Calculate duration in previous state
    const durationMs = Date.now() - this.stateEnteredAt
    const lastEntry = this.history[0]
    if (lastEntry) {
      lastEntry.durationMs = durationMs
    }

    const change: AuthStateChange = {
      from: this.state,
      to: 'unauthenticated',
      event: 'reset',
      timestamp: Date.now(),
      context: { ...this.context },
    }

    this.state = 'unauthenticated'
    this.stateEnteredAt = Date.now()
    this.context = createDefaultContext()

    // Record in history
    this.recordHistory('reset')

    // Persist state
    this.persistState()

    this.debugLog('Reset completed')
    this.emitStateChange(change)
  }

  // -------------------------------------------------------------------------
  // Public Methods - Context Management
  // -------------------------------------------------------------------------

  /**
   * Update custom metadata in the context.
   *
   * @param key - The metadata key
   * @param value - The metadata value
   *
   * @example
   * ```typescript
   * machine.setMetadata('userId', '12345');
   * machine.setMetadata('sessionId', 'abc-xyz');
   * ```
   */
  setMetadata(key: string, value: unknown): void {
    this.context.metadata[key] = value
    this.persistState()
  }

  /**
   * Get a metadata value from the context.
   *
   * @param key - The metadata key
   * @returns The metadata value or undefined
   */
  getMetadata<T = unknown>(key: string): T | undefined {
    return this.context.metadata[key] as T | undefined
  }

  // -------------------------------------------------------------------------
  // Public Methods - Event Subscription
  // -------------------------------------------------------------------------

  /**
   * Subscribe to state machine events.
   *
   * @param eventType - The event type to listen for
   * @param listener - The listener function
   *
   * @example
   * ```typescript
   * // State changes
   * machine.on('stateChange', (change) => {
   *   console.log(change);
   * });
   *
   * // Timeouts
   * machine.on('timeout', (event) => {
   *   console.log(`State ${event.state} timed out`);
   * });
   *
   * // Guard rejections
   * machine.on('guardRejected', (event) => {
   *   console.log(`Guard ${event.guard} rejected ${event.event}`);
   * });
   * ```
   */
  on(eventType: 'stateChange', listener: StateChangeListener): void
  on(eventType: 'timeout', listener: TimeoutListener): void
  on(eventType: 'guardRejected', listener: GuardRejectedListener): void
  on(eventType: EventType, listener: Listener): void {
    if (eventType === 'stateChange') {
      this.stateChangeListeners.push(listener as StateChangeListener)
    } else if (eventType === 'timeout') {
      this.timeoutListeners.push(listener as TimeoutListener)
    } else if (eventType === 'guardRejected') {
      this.guardRejectedListeners.push(listener as GuardRejectedListener)
    }
  }

  /**
   * Unsubscribe from state machine events.
   *
   * @param eventType - The event type to unsubscribe from
   * @param listener - The listener function to remove
   */
  off(eventType: 'stateChange', listener: StateChangeListener): void
  off(eventType: 'timeout', listener: TimeoutListener): void
  off(eventType: 'guardRejected', listener: GuardRejectedListener): void
  off(eventType: EventType, listener: Listener): void {
    if (eventType === 'stateChange') {
      const index = this.stateChangeListeners.indexOf(listener as StateChangeListener)
      if (index !== -1) {
        this.stateChangeListeners.splice(index, 1)
      }
    } else if (eventType === 'timeout') {
      const index = this.timeoutListeners.indexOf(listener as TimeoutListener)
      if (index !== -1) {
        this.timeoutListeners.splice(index, 1)
      }
    } else if (eventType === 'guardRejected') {
      const index = this.guardRejectedListeners.indexOf(listener as GuardRejectedListener)
      if (index !== -1) {
        this.guardRejectedListeners.splice(index, 1)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public Methods - Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Destroy the state machine, cleaning up all listeners and timeouts.
   *
   * After destruction, the machine should not be used.
   *
   * @example
   * ```typescript
   * machine.destroy();
   * ```
   */
  destroy(): void {
    this.debugLog('Destroying state machine')
    this.clearTimeout()
    this.stateChangeListeners = []
    this.timeoutListeners = []
    this.guardRejectedListeners = []
    this.history = []
  }

  // -------------------------------------------------------------------------
  // Public Methods - Serialization (XState-like)
  // -------------------------------------------------------------------------

  /**
   * Get a snapshot of the current machine state.
   *
   * Useful for debugging or serialization.
   *
   * @returns A snapshot object
   *
   * @example
   * ```typescript
   * const snapshot = machine.getSnapshot();
   * console.log(JSON.stringify(snapshot, null, 2));
   * ```
   */
  getSnapshot(): {
    state: AuthState
    context: AuthContext
    history: HistoryEntry[]
    stateEnteredAt: number
  } {
    return {
      state: this.state,
      context: { ...this.context },
      history: [...this.history],
      stateEnteredAt: this.stateEnteredAt,
    }
  }

  // -------------------------------------------------------------------------
  // Private Methods - Guards
  // -------------------------------------------------------------------------

  /**
   * Build the guards configuration with defaults.
   */
  private buildGuards(userGuards?: GuardConfig, maxRetries?: number): GuardConfig {
    const defaultGuards: GuardConfig = {}

    // Default canAuthenticate guard based on maxRetries
    if (maxRetries !== undefined && maxRetries !== Infinity) {
      defaultGuards.canAuthenticate = (ctx) => ctx.retryCount < maxRetries
    }

    return {
      ...defaultGuards,
      ...userGuards,
    }
  }

  // -------------------------------------------------------------------------
  // Private Methods - Debug Logging
  // -------------------------------------------------------------------------

  /**
   * Create the debug logger based on configuration.
   */
  private createDebugLogger(): DebugLogger {
    if (!this.config.debug) {
      return () => {} // No-op
    }

    if (typeof this.config.debug === 'function') {
      return this.config.debug
    }

    // Default console logger
    return (message: string, data?: Record<string, unknown>) => {
      const timestamp = new Date().toISOString()
      const prefix = `[AuthStateMachine ${timestamp}]`
      if (data) {
        console.log(prefix, message, data)
      } else {
        console.log(prefix, message)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private Methods - State Transitions
  // -------------------------------------------------------------------------

  /**
   * Get the next state for a given event, or null if invalid.
   */
  private getNextState(event: AuthEvent): AuthState | null {
    // Reset is always valid
    if (event === 'reset') {
      return 'unauthenticated'
    }

    const transitions = TRANSITIONS[this.state]
    return transitions?.[event] ?? null
  }

  /**
   * Update context based on the transition.
   */
  private updateContext(event: AuthEvent, nextState: AuthState, errorMessage?: string): void {
    switch (event) {
      case 'success':
        if (nextState === 'authenticated') {
          this.context.retryCount = 0
          this.context.lastAuthenticatedAt = Date.now()
          this.context.lastError = null
        }
        break

      case 'failure':
        this.context.retryCount++
        this.context.lastFailedAt = Date.now()
        this.context.lastError = errorMessage ?? 'Unknown error'
        break

      case 'authenticate':
        // Reset error on new attempt (but keep retry count)
        this.context.lastError = null
        break

      case 'reset':
        this.context = createDefaultContext()
        break
    }
  }

  // -------------------------------------------------------------------------
  // Private Methods - History
  // -------------------------------------------------------------------------

  /**
   * Record a state entry in history.
   */
  private recordHistory(event: AuthEvent): void {
    if (this.config.historySize === 0) return

    const entry: HistoryEntry = {
      state: this.state,
      event,
      timestamp: Date.now(),
    }

    // Add to front of history
    this.history.unshift(entry)

    // Trim history if needed
    if (this.history.length > this.config.historySize) {
      this.history = this.history.slice(0, this.config.historySize)
    }
  }

  // -------------------------------------------------------------------------
  // Private Methods - Persistence
  // -------------------------------------------------------------------------

  /**
   * Load persisted state if available.
   */
  private loadPersistedState(): void {
    if (!this.config.persistence) return

    try {
      const result = this.config.persistence.load()

      // Handle async load (for Promise-based adapters)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<{ state: AuthState; context: AuthContext } | null>).then((data) => {
          if (data) {
            this.state = data.state
            this.context = { ...this.context, ...data.context }
            this.debugLog('Loaded persisted state', { state: data.state })
          }
        })
      } else if (result) {
        // Narrow type to exclude Promise
        const syncResult = result as { state: AuthState; context: AuthContext }
        this.state = syncResult.state
        this.context = { ...this.context, ...syncResult.context }
        this.debugLog('Loaded persisted state', { state: syncResult.state })
      }
    } catch (error) {
      this.debugLog('Failed to load persisted state', { error })
    }
  }

  /**
   * Persist current state.
   */
  private persistState(): void {
    if (!this.config.persistence) return

    try {
      this.config.persistence.save(this.state, this.context)
    } catch (error) {
      this.debugLog('Failed to persist state', { error })
    }
  }

  // -------------------------------------------------------------------------
  // Private Methods - Event Emission
  // -------------------------------------------------------------------------

  /**
   * Emit a state change event to all listeners.
   */
  private emitStateChange(change: AuthStateChange): void {
    for (const listener of this.stateChangeListeners) {
      try {
        listener(change)
      } catch (error) {
        this.debugLog('State change listener error', { error })
      }
    }
  }

  /**
   * Emit a timeout event to all listeners.
   */
  private emitTimeout(event: AuthTimeoutEvent): void {
    for (const listener of this.timeoutListeners) {
      try {
        listener(event)
      } catch (error) {
        this.debugLog('Timeout listener error', { error })
      }
    }
  }

  /**
   * Emit a guard rejected event to all listeners.
   */
  private emitGuardRejected(event: GuardRejectedEvent): void {
    for (const listener of this.guardRejectedListeners) {
      try {
        listener(event)
      } catch (error) {
        this.debugLog('Guard rejected listener error', { error })
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private Methods - Timeout Handling
  // -------------------------------------------------------------------------

  /**
   * Handle timeout setup/cleanup based on current state.
   */
  private handleTimeout(): void {
    // Clear any existing timeout
    this.clearTimeout()

    // Set timeout for intermediate states
    if (TIMEOUT_STATES.includes(this.state)) {
      this.debugLog(`Setting timeout for ${this.state}`, {
        timeoutMs: this.config.timeout,
      })

      this.timeoutTimer = setTimeout(() => {
        const timedOutState = this.state

        this.debugLog(`State timed out: ${timedOutState}`)

        // Emit timeout event
        this.emitTimeout({
          state: timedOutState,
          timeoutMs: this.config.timeout,
          timestamp: Date.now(),
        })

        // Update context for failure
        this.context.retryCount++
        this.context.lastFailedAt = Date.now()
        this.context.lastError = `Timeout after ${this.config.timeout}ms in ${timedOutState} state`

        // Calculate duration
        const durationMs = Date.now() - this.stateEnteredAt
        const lastHistoryEntry = this.history[0]
        if (lastHistoryEntry) {
          lastHistoryEntry.durationMs = durationMs
        }

        // Transition to failed state
        const change: AuthStateChange = {
          from: timedOutState,
          to: 'failed',
          event: 'failure',
          timestamp: Date.now(),
          context: { ...this.context },
        }

        this.state = 'failed'
        this.stateEnteredAt = Date.now()

        this.recordHistory('failure')
        this.persistState()
        this.emitStateChange(change)
      }, this.config.timeout)
    }
  }

  /**
   * Clear any pending timeout.
   */
  private clearTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = undefined
    }
  }
}

// ============================================================================
// Factory Functions (XState-like)
// ============================================================================

/**
 * Create a new AuthStateMachine instance.
 *
 * Factory function for creating state machines (XState-like API).
 *
 * @param config - Optional configuration
 * @returns A new AuthStateMachine instance
 *
 * @example
 * ```typescript
 * const machine = createAuthMachine({ debug: true });
 * ```
 */
export function createAuthMachine(config?: AuthStateMachineConfig): AuthStateMachine {
  return new AuthStateMachine(config)
}

// Type for Web Storage API (localStorage/sessionStorage)
interface WebStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

// Helper to safely get storage from global scope
function getStorage(type: 'localStorage' | 'sessionStorage'): WebStorage | null {
  try {
    // Access via globalThis for Node.js/browser compatibility
    const storage = (globalThis as Record<string, unknown>)[type] as WebStorage | undefined
    if (storage && typeof storage.getItem === 'function') {
      return storage
    }
  } catch {
    // Storage not available (e.g., in Node.js without polyfill)
  }
  return null
}

/**
 * Create a persistence adapter for localStorage.
 *
 * @param key - The localStorage key to use
 * @returns A PersistenceAdapter
 *
 * @remarks
 * This adapter is only available in browser environments where localStorage is defined.
 * In Node.js or environments without localStorage, save/load operations will be no-ops.
 *
 * @example
 * ```typescript
 * const machine = createAuthMachine({
 *   persistence: createLocalStorageAdapter('auth-state'),
 * });
 * ```
 */
export function createLocalStorageAdapter(key: string): PersistenceAdapter {
  return {
    save(state, context) {
      const storage = getStorage('localStorage')
      if (storage) {
        storage.setItem(key, JSON.stringify({ state, context }))
      }
    },
    load() {
      const storage = getStorage('localStorage')
      if (storage) {
        const data = storage.getItem(key)
        if (data) {
          try {
            return JSON.parse(data)
          } catch {
            return null
          }
        }
      }
      return null
    },
  }
}

/**
 * Create a persistence adapter for sessionStorage.
 *
 * @param key - The sessionStorage key to use
 * @returns A PersistenceAdapter
 *
 * @remarks
 * This adapter is only available in browser environments where sessionStorage is defined.
 * In Node.js or environments without sessionStorage, save/load operations will be no-ops.
 *
 * @example
 * ```typescript
 * const machine = createAuthMachine({
 *   persistence: createSessionStorageAdapter('auth-state'),
 * });
 * ```
 */
export function createSessionStorageAdapter(key: string): PersistenceAdapter {
  return {
    save(state, context) {
      const storage = getStorage('sessionStorage')
      if (storage) {
        storage.setItem(key, JSON.stringify({ state, context }))
      }
    },
    load() {
      const storage = getStorage('sessionStorage')
      if (storage) {
        const data = storage.getItem(key)
        if (data) {
          try {
            return JSON.parse(data)
          } catch {
            return null
          }
        }
      }
      return null
    },
  }
}
