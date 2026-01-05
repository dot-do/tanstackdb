/**
 * @file Transport Selector for MongoDB Collection RPC
 *
 * Provides intelligent selection between HTTP and WebSocket transports
 * based on operation type, configuration, and transport availability.
 *
 * ## Overview
 *
 * The TransportSelector is the central component for managing transport selection
 * in the MongoDB collection RPC layer. It supports:
 *
 * - **Intelligent Selection**: Automatically chooses the best transport based on
 *   operation type, subscriptions, and configuration.
 * - **Strategy Pattern**: Pluggable transport selection strategies for custom logic.
 * - **Circuit Breaker**: Protects against failing transports with automatic recovery.
 * - **Health Checking**: Configurable health check strategies for monitoring transport health.
 * - **Load Balancing**: Distributes requests across transports based on configurable strategies.
 * - **Event History**: Tracks transport switch events for debugging and monitoring.
 *
 * ## Transport Selection Criteria
 *
 * - **HTTP**: One-off requests, queries without subscriptions
 * - **WebSocket**: Change streams, subscriptions, real-time updates
 *
 * ## Usage Example
 *
 * ```typescript
 * import { TransportSelector, RoundRobinLoadBalancer } from '@tanstack/mongo-db-collection/rpc'
 *
 * const selector = new TransportSelector({
 *   enableChangeStream: true,
 *   websocketAvailable: true,
 *   circuitBreaker: {
 *     enabled: true,
 *     failureThreshold: 5,
 *     recoveryTimeout: 30000,
 *   },
 *   loadBalancer: new RoundRobinLoadBalancer(),
 * })
 *
 * // Returns 'websocket' for watch operations
 * selector.selectTransport({ operation: 'watch', hasSubscription: true })
 *
 * // Returns 'http' for simple queries
 * selector.selectTransport({ operation: 'find', hasSubscription: false })
 * ```
 *
 * @module @tanstack/mongo-db-collection/rpc
 * @see {@link TransportSelector} - Main transport selector class
 * @see {@link TransportSelectionStrategy} - Strategy interface for custom selection
 * @see {@link CircuitBreaker} - Circuit breaker for fault tolerance
 * @see {@link HealthCheckStrategy} - Health check strategy interface
 * @see {@link LoadBalancingStrategy} - Load balancing strategy interface
 */

import { EventEmitter } from 'events'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Available transport types for RPC communication.
 *
 * @remarks
 * The transport type determines how requests are sent to the server:
 * - `http`: Uses HTTP/HTTPS for stateless request-response communication
 * - `websocket`: Uses WebSocket for persistent, bidirectional communication
 *
 * @example
 * ```typescript
 * const transport: TransportType = 'websocket'
 * ```
 */
export type TransportType = 'http' | 'websocket'

/**
 * Circuit breaker states for transport fault tolerance.
 *
 * @remarks
 * The circuit breaker follows the standard circuit breaker pattern:
 * - `closed`: Normal operation, requests pass through
 * - `open`: Circuit tripped, requests are blocked
 * - `half-open`: Testing if the transport has recovered
 *
 * @see {@link CircuitBreakerState} for state transitions
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open'

/**
 * Load balancing strategy types for distributing requests.
 *
 * @remarks
 * Built-in strategies:
 * - `round-robin`: Distributes requests evenly across transports
 * - `least-connections`: Sends to transport with fewest active connections
 * - `weighted`: Distributes based on configurable weights
 * - `latency-based`: Prefers transport with lowest latency
 *
 * @see {@link LoadBalancingStrategy} for custom implementations
 */
export type LoadBalancingStrategyType = 'round-robin' | 'least-connections' | 'weighted' | 'latency-based'

/**
 * Health check strategy types for monitoring transport health.
 *
 * @remarks
 * Built-in strategies:
 * - `ping`: Simple ping/pong health check
 * - `request`: Sends a test request to verify functionality
 * - `passive`: Monitors existing traffic for health signals
 * - `composite`: Combines multiple strategies
 */
export type HealthCheckStrategyType = 'ping' | 'request' | 'passive' | 'composite'

/**
 * Configuration for the circuit breaker pattern.
 *
 * @remarks
 * The circuit breaker protects against cascading failures by temporarily
 * blocking requests to failing transports.
 *
 * @example
 * ```typescript
 * const config: CircuitBreakerConfig = {
 *   enabled: true,
 *   failureThreshold: 5,
 *   recoveryTimeout: 30000,
 *   halfOpenRequests: 3,
 * }
 * ```
 */
export interface CircuitBreakerConfig {
  /**
   * Whether the circuit breaker is enabled.
   * @defaultValue `false`
   */
  enabled?: boolean

  /**
   * Number of consecutive failures before opening the circuit.
   * @defaultValue `5`
   */
  failureThreshold?: number

  /**
   * Time in milliseconds before attempting recovery (transitioning to half-open).
   * @defaultValue `30000` (30 seconds)
   */
  recoveryTimeout?: number

  /**
   * Number of test requests to allow in half-open state.
   * @defaultValue `3`
   */
  halfOpenRequests?: number

  /**
   * Percentage of requests to allow through in half-open state.
   * @defaultValue `10`
   */
  halfOpenPercentage?: number

  /**
   * Custom failure detector function.
   * If provided, this function determines whether a request failure should count toward the threshold.
   */
  failureDetector?: (error: Error) => boolean
}

/**
 * Configuration for health check strategies.
 *
 * @remarks
 * Defines how transport health is monitored and reported.
 *
 * @example
 * ```typescript
 * const config: HealthCheckConfig = {
 *   strategy: 'composite',
 *   interval: 10000,
 *   timeout: 5000,
 *   strategies: [
 *     { type: 'ping', weight: 0.5 },
 *     { type: 'passive', weight: 0.5 },
 *   ],
 * }
 * ```
 */
export interface HealthCheckConfig {
  /**
   * The health check strategy to use.
   * @defaultValue `'ping'`
   */
  strategy?: HealthCheckStrategyType

  /**
   * Interval in milliseconds between health checks.
   * @defaultValue `10000` (10 seconds)
   */
  interval?: number

  /**
   * Timeout in milliseconds for each health check.
   * @defaultValue `5000` (5 seconds)
   */
  timeout?: number

  /**
   * For composite strategy, the list of strategies to combine.
   */
  strategies?: Array<{
    type: HealthCheckStrategyType
    weight: number
  }>

  /**
   * Custom health check function.
   * If provided, this function is used instead of the built-in strategies.
   */
  customCheck?: (transport: TransportType) => Promise<boolean>

  /**
   * Whether to use adaptive intervals based on health status.
   * @defaultValue `false`
   */
  adaptiveInterval?: boolean

  /**
   * Minimum interval when using adaptive intervals.
   * @defaultValue `1000` (1 second)
   */
  minInterval?: number

  /**
   * Maximum interval when using adaptive intervals.
   * @defaultValue `60000` (1 minute)
   */
  maxInterval?: number
}

/**
 * Configuration for load balancing between transports.
 *
 * @remarks
 * When both HTTP and WebSocket are available and suitable for a request,
 * load balancing determines which transport to use.
 *
 * @example
 * ```typescript
 * const config: LoadBalancingConfig = {
 *   strategy: 'weighted',
 *   weights: { http: 0.7, websocket: 0.3 },
 * }
 * ```
 */
export interface LoadBalancingConfig {
  /**
   * The load balancing strategy to use.
   * @defaultValue `'round-robin'`
   */
  strategy?: LoadBalancingStrategyType

  /**
   * Weights for the weighted strategy.
   * Values should sum to 1.0.
   */
  weights?: Record<TransportType, number>

  /**
   * Whether to stick to a transport once selected for a session.
   * @defaultValue `false`
   */
  stickySession?: boolean

  /**
   * TTL for sticky sessions in milliseconds.
   * @defaultValue `300000` (5 minutes)
   */
  stickySessionTTL?: number

  /**
   * Custom load balancer implementation.
   * If provided, this is used instead of built-in strategies.
   */
  customBalancer?: LoadBalancingStrategy
}

/**
 * Configuration options for the transport selector.
 *
 * @remarks
 * All properties are optional for maximum flexibility. The selector will use
 * sensible defaults for any omitted options.
 *
 * @example
 * ```typescript
 * const config: TransportConfig = {
 *   enableChangeStream: true,
 *   websocketAvailable: true,
 *   circuitBreaker: {
 *     enabled: true,
 *     failureThreshold: 5,
 *   },
 *   healthCheck: {
 *     strategy: 'ping',
 *     interval: 10000,
 *   },
 * }
 * ```
 */
export interface TransportConfig {
  /**
   * Force a specific transport regardless of operation type.
   * Use with caution as this bypasses intelligent selection.
   */
  forceTransport?: TransportType

  /**
   * Enable change stream support (prefers WebSocket).
   * When enabled, operations that could benefit from real-time updates will use WebSocket.
   * @defaultValue `false`
   */
  enableChangeStream?: boolean

  /**
   * Whether WebSocket transport is available.
   * Set to false if the server doesn't support WebSocket or if it's disabled.
   * @defaultValue `true`
   */
  websocketAvailable?: boolean

  /**
   * Whether HTTP transport is available.
   * Rarely needs to be disabled, but useful for WebSocket-only environments.
   * @defaultValue `true`
   */
  httpAvailable?: boolean

  /**
   * Interval in milliseconds for reconnection attempts.
   * After a transport fails, the selector will wait this long before trying again.
   * @defaultValue `5000` (5 seconds)
   */
  reconnectInterval?: number

  /**
   * Interval in milliseconds for health checks.
   * @deprecated Use `healthCheck.interval` instead.
   * @defaultValue `10000` (10 seconds)
   */
  healthCheckInterval?: number

  /**
   * Timeout in milliseconds for draining connections during transport switch.
   * Requests in-flight will be allowed to complete within this window.
   * @defaultValue `5000` (5 seconds)
   */
  drainTimeout?: number

  /**
   * Number of consecutive failures before marking transport unhealthy.
   * @deprecated Use `circuitBreaker.failureThreshold` instead.
   * @defaultValue `3`
   */
  unhealthyThreshold?: number

  /**
   * Allow fallback when forced transport is unavailable.
   * If false, an error is thrown when the forced transport is unavailable.
   * @defaultValue `false`
   */
  allowFallbackOnForced?: boolean

  /**
   * Enable connection pooling for WebSocket connections.
   * Multiple subscriptions will share a single WebSocket connection.
   * @defaultValue `true`
   */
  enableConnectionPooling?: boolean

  /**
   * Preserve request ordering during transport switches.
   * When enabled, requests are migrated in order instead of being dropped.
   * @defaultValue `false`
   */
  preserveRequestOrder?: boolean

  /**
   * Circuit breaker configuration for fault tolerance.
   * @see {@link CircuitBreakerConfig}
   */
  circuitBreaker?: CircuitBreakerConfig

  /**
   * Health check configuration.
   * @see {@link HealthCheckConfig}
   */
  healthCheck?: HealthCheckConfig

  /**
   * Load balancing configuration.
   * @see {@link LoadBalancingConfig}
   */
  loadBalancing?: LoadBalancingConfig

  /**
   * Custom transport selection strategy.
   * If provided, this strategy is consulted before the default selection logic.
   * @see {@link TransportSelectionStrategy}
   */
  selectionStrategy?: TransportSelectionStrategy

  /**
   * Maximum number of events to keep in the switch history.
   * @defaultValue `100`
   */
  maxEventHistorySize?: number
}

/**
 * Health status information for a transport.
 *
 * @remarks
 * Contains comprehensive health information including latency, failure counts,
 * and connection state for WebSocket transports.
 *
 * @example
 * ```typescript
 * const health: TransportHealth = {
 *   healthy: true,
 *   lastCheck: Date.now(),
 *   latency: 45,
 *   consecutiveFailures: 0,
 *   connectionState: 'connected',
 * }
 * ```
 */
export interface TransportHealth {
  /**
   * Whether the transport is currently healthy.
   * Based on consecutive failures and circuit breaker state.
   */
  healthy: boolean

  /**
   * Timestamp of the last health check.
   */
  lastCheck: number

  /**
   * Last error encountered, if any.
   * Useful for debugging transport issues.
   */
  lastError?: Error

  /**
   * Number of consecutive health check failures.
   * Resets to 0 on successful check.
   */
  consecutiveFailures?: number

  /**
   * Latency in milliseconds from the last successful health check.
   */
  latency?: number

  /**
   * Current connection state for WebSocket transport.
   * Only applicable for WebSocket transports.
   */
  connectionState?: 'connected' | 'connecting' | 'disconnected'

  /**
   * Average latency over the last N health checks.
   */
  averageLatency?: number

  /**
   * 95th percentile latency over the last N health checks.
   */
  p95Latency?: number

  /**
   * Total number of requests processed by this transport.
   */
  totalRequests?: number

  /**
   * Total number of failed requests on this transport.
   */
  totalFailures?: number

  /**
   * Success rate as a percentage (0-100).
   */
  successRate?: number
}

/**
 * Context for a request, used to determine the appropriate transport.
 *
 * @remarks
 * The request context provides all the information needed to make an
 * intelligent transport selection decision.
 *
 * @example
 * ```typescript
 * const context: RequestContext = {
 *   operation: 'watch',
 *   hasSubscription: true,
 *   enableChangeStream: true,
 *   sessionId: 'session-123',
 *   collectionName: 'users',
 * }
 * ```
 */
export interface RequestContext {
  /**
   * The MongoDB operation type.
   * Common values: 'find', 'insert', 'update', 'delete', 'aggregate', 'watch'
   */
  operation: string

  /**
   * Whether this request has an active subscription.
   * Subscriptions require persistent connections (WebSocket).
   */
  hasSubscription: boolean

  /**
   * Whether change stream is enabled for this specific request.
   * Overrides the global `enableChangeStream` setting.
   */
  enableChangeStream?: boolean

  /**
   * Session identifier for grouping related requests.
   * Used for session affinity and transport stickiness.
   */
  sessionId?: string

  /**
   * Subscription identifier.
   * Used to track and manage active subscriptions.
   */
  subscriptionId?: string

  /**
   * Collection name for the request.
   * May influence transport selection for collection-specific rules.
   */
  collectionName?: string

  /**
   * Pipeline for aggregate operations.
   * Analyzed to detect change stream stages.
   */
  pipeline?: Array<Record<string, unknown>>

  /**
   * Unique request identifier.
   * Used for tracking and correlation.
   */
  requestId?: string

  /**
   * Expected duration for long-running requests.
   * May influence transport selection and timeout handling.
   */
  expectedDuration?: number

  /**
   * Priority level for the request.
   * Higher priority requests may get preferential transport selection.
   */
  priority?: 'low' | 'normal' | 'high'

  /**
   * Whether the request is idempotent.
   * Idempotent requests are safer to retry on transport failure.
   */
  idempotent?: boolean

  /**
   * Custom metadata for strategy-specific logic.
   */
  metadata?: Record<string, unknown>
}

/**
 * Transport preferences for the selector.
 *
 * @remarks
 * Preferences influence transport selection when multiple transports
 * are available and suitable for a request.
 *
 * @example
 * ```typescript
 * const preferences: TransportPreferences = {
 *   preferredTransport: 'websocket',
 *   maxRetries: 3,
 *   retryDelay: 1000,
 * }
 * ```
 */
export interface TransportPreferences {
  /**
   * Preferred transport when both are available.
   * The selector will favor this transport when appropriate.
   */
  preferredTransport?: TransportType

  /**
   * Maximum retry attempts before giving up.
   * @defaultValue `3`
   */
  maxRetries?: number

  /**
   * Delay between retries in milliseconds.
   * @defaultValue `1000` (1 second)
   */
  retryDelay?: number

  /**
   * Whether to use exponential backoff for retries.
   * @defaultValue `true`
   */
  exponentialBackoff?: boolean

  /**
   * Maximum delay for exponential backoff in milliseconds.
   * @defaultValue `30000` (30 seconds)
   */
  maxRetryDelay?: number
}

/**
 * State of an active subscription.
 *
 * @remarks
 * Tracks subscription state across transport switches and reconnections.
 *
 * @example
 * ```typescript
 * const state: SubscriptionState = {
 *   id: 'sub-001',
 *   sessionId: 'session-123',
 *   transport: 'websocket',
 *   active: true,
 * }
 * ```
 */
export interface SubscriptionState {
  /**
   * Subscription identifier.
   */
  id: string

  /**
   * Session identifier.
   */
  sessionId?: string

  /**
   * Current transport for the subscription.
   */
  transport: TransportType

  /**
   * Whether the subscription is currently active.
   */
  active: boolean

  /**
   * Timestamp when the subscription was created.
   */
  createdAt?: number

  /**
   * Timestamp of the last activity on this subscription.
   */
  lastActivity?: number

  /**
   * Number of messages received on this subscription.
   */
  messageCount?: number
}

/**
 * Pending request for tracking during transport switches.
 *
 * @remarks
 * Pending requests are tracked to ensure graceful transport switches
 * without dropping in-flight requests.
 *
 * @example
 * ```typescript
 * const pending = selector.createPendingRequest(context)
 * pending.onComplete(() => console.log('Request completed'))
 * // ... later
 * await pending.complete()
 * ```
 */
export interface PendingRequest {
  /**
   * Complete the request.
   * Call this when the request has finished processing.
   */
  complete: () => Promise<void>

  /**
   * Register a completion callback.
   * @param callback - Function to call when the request completes
   */
  onComplete: (callback: () => void) => void
}

/**
 * Event record for transport switch history.
 *
 * @remarks
 * Records all transport-related events for debugging and monitoring.
 *
 * @example
 * ```typescript
 * const event: TransportSwitchEvent = {
 *   type: 'switch',
 *   timestamp: Date.now(),
 *   from: 'http',
 *   to: 'websocket',
 *   reason: 'subscription_added',
 * }
 * ```
 */
export interface TransportSwitchEvent {
  /**
   * Type of the event.
   */
  type: 'switch' | 'fallback' | 'upgrade' | 'health' | 'circuit-breaker'

  /**
   * Timestamp when the event occurred.
   */
  timestamp: number

  /**
   * Source transport (if applicable).
   */
  from?: TransportType

  /**
   * Target transport (if applicable).
   */
  to?: TransportType

  /**
   * Reason for the event.
   */
  reason?: string

  /**
   * Additional data associated with the event.
   */
  data?: Record<string, unknown>
}

/**
 * Circuit breaker state for a transport.
 *
 * @remarks
 * Tracks the circuit breaker state and history for a specific transport.
 */
export interface CircuitBreakerTransportState {
  /**
   * Current circuit breaker state.
   */
  state: CircuitBreakerState

  /**
   * Number of failures since the circuit was last closed.
   */
  failures: number

  /**
   * Number of successful requests in half-open state.
   */
  halfOpenSuccesses: number

  /**
   * Timestamp when the circuit was last opened.
   */
  lastOpenedAt?: number

  /**
   * Timestamp when the circuit should transition to half-open.
   */
  nextHalfOpenAt?: number

  /**
   * Timestamp of the last state change.
   */
  lastStateChange: number
}

// ============================================================================
// Strategy Interfaces
// ============================================================================

/**
 * Interface for custom transport selection strategies.
 *
 * @remarks
 * Implement this interface to create custom transport selection logic.
 * The strategy is consulted before the default selection logic and can
 * override or augment the default behavior.
 *
 * @example
 * ```typescript
 * class PriorityBasedStrategy implements TransportSelectionStrategy {
 *   name = 'priority-based'
 *
 *   select(context: RequestContext, available: TransportType[]): TransportType | null {
 *     if (context.priority === 'high' && available.includes('websocket')) {
 *       return 'websocket'
 *     }
 *     return null // Fall through to default logic
 *   }
 *
 *   shouldUse(context: RequestContext): boolean {
 *     return context.priority !== undefined
 *   }
 * }
 * ```
 */
export interface TransportSelectionStrategy {
  /**
   * Name of the strategy for identification and logging.
   */
  readonly name: string

  /**
   * Select a transport for the given context.
   *
   * @param context - The request context
   * @param available - List of available transports
   * @returns The selected transport, or null to use default logic
   */
  select(context: RequestContext, available: TransportType[]): TransportType | null

  /**
   * Determine if this strategy should be used for the given context.
   *
   * @param context - The request context
   * @returns True if this strategy should be applied
   */
  shouldUse(context: RequestContext): boolean

  /**
   * Optional initialization method.
   * Called when the strategy is registered with the selector.
   */
  initialize?(): void

  /**
   * Optional cleanup method.
   * Called when the strategy is unregistered or the selector is destroyed.
   */
  destroy?(): void
}

/**
 * Interface for custom health check strategies.
 *
 * @remarks
 * Implement this interface to create custom health checking logic
 * for transports.
 *
 * @example
 * ```typescript
 * class CustomHealthCheck implements HealthCheckStrategy {
 *   name = 'custom-ping'
 *
 *   async check(transport: TransportType): Promise<HealthCheckResult> {
 *     const start = Date.now()
 *     try {
 *       await this.pingTransport(transport)
 *       return {
 *         healthy: true,
 *         latency: Date.now() - start,
 *       }
 *     } catch (error) {
 *       return {
 *         healthy: false,
 *         error: error as Error,
 *       }
 *     }
 *   }
 * }
 * ```
 */
export interface HealthCheckStrategy {
  /**
   * Name of the strategy for identification and logging.
   */
  readonly name: string

  /**
   * Perform a health check on the specified transport.
   *
   * @param transport - The transport to check
   * @returns The health check result
   */
  check(transport: TransportType): Promise<HealthCheckResult>

  /**
   * Get the recommended check interval for this strategy.
   *
   * @param transport - The transport type
   * @param currentHealth - The current health status
   * @returns Recommended interval in milliseconds
   */
  getRecommendedInterval?(transport: TransportType, currentHealth: TransportHealth): number
}

/**
 * Result of a health check.
 */
export interface HealthCheckResult {
  /**
   * Whether the transport is healthy.
   */
  healthy: boolean

  /**
   * Latency in milliseconds (if measured).
   */
  latency?: number

  /**
   * Error that occurred during the check (if any).
   */
  error?: Error

  /**
   * Additional metadata from the check.
   */
  metadata?: Record<string, unknown>
}

/**
 * Interface for custom load balancing strategies.
 *
 * @remarks
 * Implement this interface to create custom load balancing logic
 * for distributing requests across transports.
 *
 * @example
 * ```typescript
 * class WeightedLoadBalancer implements LoadBalancingStrategy {
 *   name = 'weighted'
 *   private weights: Map<TransportType, number>
 *
 *   constructor(weights: Record<TransportType, number>) {
 *     this.weights = new Map(Object.entries(weights))
 *   }
 *
 *   select(available: TransportType[], context: RequestContext): TransportType {
 *     const random = Math.random()
 *     let cumulative = 0
 *     for (const transport of available) {
 *       cumulative += this.weights.get(transport) || 0
 *       if (random <= cumulative) {
 *         return transport
 *       }
 *     }
 *     return available[0]
 *   }
 * }
 * ```
 */
export interface LoadBalancingStrategy {
  /**
   * Name of the strategy for identification and logging.
   */
  readonly name: string

  /**
   * Select a transport from the available options.
   *
   * @param available - List of available transports
   * @param context - The request context
   * @param stats - Current transport statistics
   * @returns The selected transport
   */
  select(
    available: TransportType[],
    context: RequestContext,
    stats: Map<TransportType, TransportHealth>
  ): TransportType

  /**
   * Record the result of a request for adaptive balancing.
   *
   * @param transport - The transport that handled the request
   * @param success - Whether the request succeeded
   * @param latency - The request latency in milliseconds
   */
  recordResult?(transport: TransportType, success: boolean, latency: number): void

  /**
   * Reset the balancer state.
   */
  reset?(): void
}

// ============================================================================
// Built-in Strategy Implementations
// ============================================================================

/**
 * Round-robin load balancing strategy.
 *
 * @remarks
 * Distributes requests evenly across available transports by rotating
 * through them in order.
 *
 * @example
 * ```typescript
 * const balancer = new RoundRobinLoadBalancer()
 * const selector = new TransportSelector({
 *   loadBalancing: { customBalancer: balancer },
 * })
 * ```
 */
export class RoundRobinLoadBalancer implements LoadBalancingStrategy {
  readonly name = 'round-robin'
  private currentIndex = 0

  /**
   * Select the next transport in the rotation.
   *
   * @param available - List of available transports
   * @returns The selected transport
   */
  select(available: TransportType[]): TransportType {
    if (available.length === 0) {
      throw new Error('No transports available')
    }
    const transport = available[this.currentIndex % available.length]!
    this.currentIndex++
    return transport
  }

  /**
   * Reset the rotation index.
   */
  reset(): void {
    this.currentIndex = 0
  }
}

/**
 * Least-connections load balancing strategy.
 *
 * @remarks
 * Selects the transport with the fewest active connections.
 * Useful for balancing long-running connections like WebSocket subscriptions.
 *
 * @example
 * ```typescript
 * const balancer = new LeastConnectionsLoadBalancer()
 * ```
 */
export class LeastConnectionsLoadBalancer implements LoadBalancingStrategy {
  readonly name = 'least-connections'
  private connections = new Map<TransportType, number>()

  /**
   * Select the transport with the fewest active connections.
   *
   * @param available - List of available transports
   * @returns The selected transport
   */
  select(available: TransportType[]): TransportType {
    if (available.length === 0) {
      throw new Error('No transports available')
    }

    let minConnections = Infinity
    let selected: TransportType = available[0]!

    for (const transport of available) {
      const count = this.connections.get(transport) || 0
      if (count < minConnections) {
        minConnections = count
        selected = transport
      }
    }

    // Increment connection count
    this.connections.set(selected, (this.connections.get(selected) || 0) + 1)

    return selected
  }

  /**
   * Record the result and update connection count.
   *
   * @param transport - The transport that handled the request
   * @param success - Whether the request succeeded
   */
  recordResult(transport: TransportType, success: boolean): void {
    // Decrement connection count when request completes
    const current = this.connections.get(transport) || 1
    this.connections.set(transport, Math.max(0, current - 1))
  }

  /**
   * Reset all connection counts.
   */
  reset(): void {
    this.connections.clear()
  }
}

/**
 * Latency-based load balancing strategy.
 *
 * @remarks
 * Selects the transport with the lowest observed latency.
 * Adapts to changing network conditions over time.
 *
 * @example
 * ```typescript
 * const balancer = new LatencyBasedLoadBalancer()
 * ```
 */
export class LatencyBasedLoadBalancer implements LoadBalancingStrategy {
  readonly name = 'latency-based'
  private latencies = new Map<TransportType, number[]>()
  private readonly maxSamples: number

  /**
   * Create a new latency-based load balancer.
   *
   * @param maxSamples - Maximum number of latency samples to keep per transport
   */
  constructor(maxSamples = 100) {
    this.maxSamples = maxSamples
  }

  /**
   * Select the transport with the lowest average latency.
   *
   * @param available - List of available transports
   * @param context - The request context
   * @param stats - Current transport statistics
   * @returns The selected transport
   */
  select(
    available: TransportType[],
    context: RequestContext,
    stats: Map<TransportType, TransportHealth>
  ): TransportType {
    if (available.length === 0) {
      throw new Error('No transports available')
    }

    let minLatency = Infinity
    let selected: TransportType = available[0]!

    for (const transport of available) {
      const samples = this.latencies.get(transport) || []
      const avgLatency = samples.length > 0
        ? samples.reduce((a, b) => a + b, 0) / samples.length
        : stats.get(transport)?.latency || Infinity

      if (avgLatency < minLatency) {
        minLatency = avgLatency
        selected = transport
      }
    }

    return selected
  }

  /**
   * Record the result and update latency samples.
   *
   * @param transport - The transport that handled the request
   * @param success - Whether the request succeeded
   * @param latency - The request latency in milliseconds
   */
  recordResult(transport: TransportType, success: boolean, latency: number): void {
    if (!success) return

    const samples = this.latencies.get(transport) || []
    samples.push(latency)

    // Keep only the most recent samples
    if (samples.length > this.maxSamples) {
      samples.shift()
    }

    this.latencies.set(transport, samples)
  }

  /**
   * Reset all latency samples.
   */
  reset(): void {
    this.latencies.clear()
  }
}

// ============================================================================
// TransportSelector Class
// ============================================================================

/**
 * Intelligent transport selector for MongoDB collection RPC.
 *
 * @remarks
 * The TransportSelector is responsible for choosing between HTTP and WebSocket
 * transports based on operation type, configuration, and transport health.
 * It supports pluggable strategies for selection, health checking, and load balancing.
 *
 * ## Features
 *
 * - **Intelligent Selection**: Automatically chooses the best transport
 * - **Strategy Pattern**: Pluggable custom selection strategies
 * - **Circuit Breaker**: Fault tolerance with automatic recovery
 * - **Health Checking**: Configurable health monitoring
 * - **Load Balancing**: Distribute requests across transports
 * - **Event History**: Track all transport events
 *
 * ## Events
 *
 * The selector emits the following events:
 * - `transport:fallback` - When falling back from preferred transport
 * - `transport:upgrade` - When upgrading to a better transport
 * - `transport:health` - When transport health changes
 * - `transport:switchStart` - When starting a transport switch
 * - `transport:draining` - When draining connections
 * - `transport:drained` - When connections are drained
 * - `transport:switchComplete` - When transport switch completes
 * - `transport:forcedSwitch` - When a switch was forced (dropped requests)
 * - `transport:reconnecting` - When attempting to reconnect
 * - `subscription:reconnect` - When reconnecting a subscription
 * - `circuit-breaker:open` - When circuit breaker opens
 * - `circuit-breaker:half-open` - When circuit breaker enters half-open
 * - `circuit-breaker:close` - When circuit breaker closes
 *
 * @example
 * ```typescript
 * const selector = new TransportSelector({
 *   enableChangeStream: true,
 *   websocketAvailable: true,
 *   circuitBreaker: { enabled: true },
 * })
 *
 * // Listen for events
 * selector.on('transport:fallback', (event) => {
 *   console.log(`Fell back from ${event.from} to ${event.to}`)
 * })
 *
 * // Select transport for a request
 * const transport = selector.selectTransport({
 *   operation: 'watch',
 *   hasSubscription: true,
 * })
 * ```
 *
 * @see {@link TransportSelectionStrategy} for custom selection strategies
 * @see {@link CircuitBreakerConfig} for circuit breaker configuration
 * @see {@link HealthCheckConfig} for health check configuration
 * @see {@link LoadBalancingConfig} for load balancing configuration
 */
export class TransportSelector extends EventEmitter {
  // ============================================================================
  // Private Properties
  // ============================================================================

  /** Health status for each transport */
  private health: Map<TransportType, TransportHealth> = new Map()

  /** Active subscriptions */
  private subscriptions: Map<string, SubscriptionState> = new Map()

  /** Pending requests during transport switches */
  private pendingRequests: Map<string, PendingRequest & { callbacks: Array<() => void> }> = new Map()

  /** User preferences for transport selection */
  private preferences: TransportPreferences = {}

  /** Timer for periodic health checks */
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null

  /** Timer for reconnection attempts */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  /** Transport assigned to each session */
  private sessionTransports: Map<string, TransportType> = new Map()

  /** WebSocket connection count for pooling */
  private wsConnectionCount = 0

  /** Configuration for the selector */
  private config: TransportConfig

  /** Currently forced transport (if any) */
  private currentForcedTransport: TransportType | null = null

  /** Circuit breaker state for each transport */
  private circuitBreakers: Map<TransportType, CircuitBreakerTransportState> = new Map()

  /** Event history for debugging and monitoring */
  private eventHistory: TransportSwitchEvent[] = []

  /** Custom selection strategies */
  private selectionStrategies: TransportSelectionStrategy[] = []

  /** Custom health check strategy */
  private healthCheckStrategy: HealthCheckStrategy | null = null

  /** Load balancing strategy */
  private loadBalancer: LoadBalancingStrategy | null = null

  /** Latency history for each transport */
  private latencyHistory: Map<TransportType, number[]> = new Map()

  /** Sticky session mappings */
  private stickySessions: Map<string, { transport: TransportType; expiresAt: number }> = new Map()

  // ============================================================================
  // Constructor
  // ============================================================================

  /**
   * Creates a new TransportSelector instance.
   *
   * @param config - Optional configuration for the selector
   *
   * @example
   * ```typescript
   * // Basic usage with defaults
   * const selector = new TransportSelector()
   *
   * // With custom configuration
   * const selector = new TransportSelector({
   *   enableChangeStream: true,
   *   circuitBreaker: { enabled: true },
   * })
   * ```
   */
  constructor(config: TransportConfig = {}) {
    super()
    this.config = {
      websocketAvailable: true,
      httpAvailable: true,
      unhealthyThreshold: 3,
      maxEventHistorySize: 100,
      ...config,
    }

    // Initialize health for both transports
    this.initializeTransportHealth('http')
    this.initializeTransportHealth('websocket')

    // Initialize circuit breakers
    this.initializeCircuitBreakers()

    // Initialize load balancer
    this.initializeLoadBalancer()

    // Initialize selection strategy
    if (config.selectionStrategy) {
      this.registerSelectionStrategy(config.selectionStrategy)
    }

    // Initialize health check strategy
    this.initializeHealthCheckStrategy()
  }

  // ============================================================================
  // Initialization Methods
  // ============================================================================

  /**
   * Initialize health status for a transport.
   *
   * @param type - The transport type
   */
  private initializeTransportHealth(type: TransportType): void {
    const health: TransportHealth = {
      healthy: type === 'websocket'
        ? (this.config.websocketAvailable ?? true)
        : (this.config.httpAvailable ?? true),
      lastCheck: Date.now(),
      consecutiveFailures: 0,
      totalRequests: 0,
      totalFailures: 0,
      successRate: 100,
    }

    if (type === 'websocket') {
      health.connectionState = this.config.websocketAvailable ? 'disconnected' : 'disconnected'
    }

    this.health.set(type, health)
    this.latencyHistory.set(type, [])
  }

  /**
   * Initialize circuit breakers for all transports.
   */
  private initializeCircuitBreakers(): void {
    const transports: TransportType[] = ['http', 'websocket']

    for (const transport of transports) {
      this.circuitBreakers.set(transport, {
        state: 'closed',
        failures: 0,
        halfOpenSuccesses: 0,
        lastStateChange: Date.now(),
      })
    }
  }

  /**
   * Initialize the load balancer based on configuration.
   */
  private initializeLoadBalancer(): void {
    const config = this.config.loadBalancing

    if (config?.customBalancer) {
      this.loadBalancer = config.customBalancer
      return
    }

    switch (config?.strategy) {
      case 'round-robin':
        this.loadBalancer = new RoundRobinLoadBalancer()
        break
      case 'least-connections':
        this.loadBalancer = new LeastConnectionsLoadBalancer()
        break
      case 'latency-based':
        this.loadBalancer = new LatencyBasedLoadBalancer()
        break
      default:
        // No load balancer by default
        this.loadBalancer = null
    }
  }

  /**
   * Initialize the health check strategy based on configuration.
   */
  private initializeHealthCheckStrategy(): void {
    const config = this.config.healthCheck

    if (config?.customCheck) {
      this.healthCheckStrategy = {
        name: 'custom',
        check: async (transport: TransportType) => {
          try {
            const healthy = await config.customCheck!(transport)
            return { healthy }
          } catch (error) {
            return { healthy: false, error: error as Error }
          }
        },
      }
    }
  }

  // ============================================================================
  // Transport Selection
  // ============================================================================

  /**
   * Selects the appropriate transport for a request context.
   *
   * @remarks
   * The selection process follows this priority:
   * 1. Circuit breaker check (skip unavailable transports)
   * 2. Custom selection strategy (if registered)
   * 3. Forced transport (if configured and available)
   * 4. WebSocket for subscriptions/change streams
   * 5. Preferred transport (if set)
   * 6. Load balancer (if configured)
   * 7. HTTP as default
   *
   * @param context - The request context
   * @returns The selected transport type
   * @throws Error if forced transport is unavailable and fallback is disabled
   *
   * @example
   * ```typescript
   * // Simple query - returns 'http'
   * selector.selectTransport({ operation: 'find', hasSubscription: false })
   *
   * // Subscription - returns 'websocket'
   * selector.selectTransport({ operation: 'watch', hasSubscription: true })
   * ```
   */
  selectTransport(context: RequestContext): TransportType {
    const wsHealth = this.health.get('websocket')
    const wsAvailable = this.isWebSocketAvailable()

    // Track session for upgrade detection
    const previousSessionTransport = context.sessionId
      ? this.sessionTransports.get(context.sessionId)
      : undefined

    // Check sticky session
    if (context.sessionId && this.config.loadBalancing?.stickySession) {
      const sticky = this.stickySessions.get(context.sessionId)
      if (sticky && sticky.expiresAt > Date.now() && this.isTransportAvailable(sticky.transport)) {
        return sticky.transport
      }
    }

    // Try custom selection strategies first
    const availableTransports = this.getAvailableTransports()
    for (const strategy of this.selectionStrategies) {
      if (strategy.shouldUse(context)) {
        const selected = strategy.select(context, availableTransports)
        if (selected && this.isTransportAvailable(selected)) {
          this.recordTransportSelection(context, selected, `strategy:${strategy.name}`)
          return selected
        }
      }
    }

    // Determine preferred transport based on context
    let selectedTransport: TransportType = 'http'

    // Check if this context would prefer WebSocket
    const needsWebSocket =
      context.operation === 'watch' ||
      context.hasSubscription ||
      context.enableChangeStream ||
      this.config.enableChangeStream ||
      this.hasChangeStreamInPipeline(context.pipeline)

    if (needsWebSocket) {
      selectedTransport = 'websocket'
    }

    // Check forced transport configuration
    if (this.config.forceTransport) {
      const forcedAvailable = this.isTransportAvailable(this.config.forceTransport)

      if (!forcedAvailable) {
        if (this.config.allowFallbackOnForced) {
          // Fall back to the other transport
          selectedTransport = this.config.forceTransport === 'websocket' ? 'http' : 'websocket'
          this.recordEvent({
            type: 'fallback',
            from: this.config.forceTransport,
            to: selectedTransport,
            reason: 'forced_transport_unavailable',
          })
        } else {
          throw new Error(`Forced transport "${this.config.forceTransport}" is not available`)
        }
      } else {
        selectedTransport = this.config.forceTransport
        // Update current forced transport
        this.currentForcedTransport = this.config.forceTransport
      }
    } else if (needsWebSocket) {
      // WebSocket is needed but might not be available
      if (!wsAvailable || !wsHealth?.healthy || !this.isCircuitBreakerClosed('websocket')) {
        // Emit fallback event
        this.emit('transport:fallback', {
          from: 'websocket',
          to: 'http',
          reason: 'websocket_unavailable',
        })

        this.recordEvent({
          type: 'fallback',
          from: 'websocket',
          to: 'http',
          reason: 'websocket_unavailable',
        })

        // Schedule reconnection attempt
        if (this.config.reconnectInterval && !this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.attemptReconnect('websocket')
            this.reconnectTimer = null
          }, this.config.reconnectInterval)
        }

        selectedTransport = 'http'
      } else {
        selectedTransport = 'websocket'
      }
    } else if (this.preferences.preferredTransport) {
      // Use preferred transport if available
      if (this.isTransportAvailable(this.preferences.preferredTransport)) {
        selectedTransport = this.preferences.preferredTransport
      }
    } else if (this.loadBalancer && availableTransports.length > 1) {
      // Use load balancer for selection
      selectedTransport = this.loadBalancer.select(availableTransports, context, this.health)
    }

    // Track subscription state
    if (context.subscriptionId && context.hasSubscription) {
      this.subscriptions.set(context.subscriptionId, {
        id: context.subscriptionId,
        sessionId: context.sessionId,
        transport: selectedTransport,
        active: true,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
      })
    }

    // Emit upgrade event if session is upgrading from HTTP to WebSocket
    if (
      context.sessionId &&
      previousSessionTransport === 'http' &&
      selectedTransport === 'websocket' &&
      context.hasSubscription
    ) {
      this.emit('transport:upgrade', {
        sessionId: context.sessionId,
        from: 'http',
        to: 'websocket',
        reason: 'subscription_added',
      })

      this.recordEvent({
        type: 'upgrade',
        from: 'http',
        to: 'websocket',
        reason: 'subscription_added',
        data: { sessionId: context.sessionId },
      })
    }

    // Track session transport
    if (context.sessionId) {
      this.sessionTransports.set(context.sessionId, selectedTransport)

      // Update sticky session
      if (this.config.loadBalancing?.stickySession) {
        const ttl = this.config.loadBalancing.stickySessionTTL || 300000
        this.stickySessions.set(context.sessionId, {
          transport: selectedTransport,
          expiresAt: Date.now() + ttl,
        })
      }
    }

    // Track WebSocket connections for pooling
    if (selectedTransport === 'websocket' && this.config.enableConnectionPooling) {
      // Only count unique WebSocket connections (pooled)
      if (this.wsConnectionCount === 0) {
        this.wsConnectionCount = 1
      }
    }

    return selectedTransport
  }

  /**
   * Record a transport selection for monitoring.
   *
   * @param context - The request context
   * @param transport - The selected transport
   * @param reason - The reason for selection
   */
  private recordTransportSelection(
    context: RequestContext,
    transport: TransportType,
    reason: string
  ): void {
    const health = this.health.get(transport)
    if (health) {
      health.totalRequests = (health.totalRequests || 0) + 1
    }
  }

  /**
   * Get list of currently available transports.
   *
   * @returns Array of available transport types
   */
  private getAvailableTransports(): TransportType[] {
    const available: TransportType[] = []

    if (this.isTransportAvailable('http')) {
      available.push('http')
    }

    if (this.isTransportAvailable('websocket')) {
      available.push('websocket')
    }

    return available
  }

  // ============================================================================
  // Circuit Breaker Methods
  // ============================================================================

  /**
   * Check if the circuit breaker for a transport is closed (allowing requests).
   *
   * @param type - The transport type
   * @returns True if the circuit is closed or half-open
   */
  private isCircuitBreakerClosed(type: TransportType): boolean {
    if (!this.config.circuitBreaker?.enabled) {
      return true
    }

    const state = this.circuitBreakers.get(type)
    if (!state) return true

    // Check if we should transition from open to half-open
    if (state.state === 'open' && state.nextHalfOpenAt && Date.now() >= state.nextHalfOpenAt) {
      this.transitionCircuitBreaker(type, 'half-open')
      return true
    }

    return state.state !== 'open'
  }

  /**
   * Record a circuit breaker failure for a transport.
   *
   * @param type - The transport type
   * @param error - The error that occurred
   */
  recordCircuitBreakerFailure(type: TransportType, error?: Error): void {
    if (!this.config.circuitBreaker?.enabled) return

    const state = this.circuitBreakers.get(type)
    if (!state) return

    const config = this.config.circuitBreaker

    // Check if this failure should count (custom detector)
    if (config.failureDetector && error && !config.failureDetector(error)) {
      return
    }

    state.failures++

    const threshold = config.failureThreshold || 5

    if (state.state === 'closed' && state.failures >= threshold) {
      this.transitionCircuitBreaker(type, 'open')
    } else if (state.state === 'half-open') {
      // Any failure in half-open state reopens the circuit
      this.transitionCircuitBreaker(type, 'open')
    }
  }

  /**
   * Record a circuit breaker success for a transport.
   *
   * @param type - The transport type
   */
  recordCircuitBreakerSuccess(type: TransportType): void {
    if (!this.config.circuitBreaker?.enabled) return

    const state = this.circuitBreakers.get(type)
    if (!state) return

    if (state.state === 'half-open') {
      state.halfOpenSuccesses++

      const requiredSuccesses = this.config.circuitBreaker.halfOpenRequests || 3
      if (state.halfOpenSuccesses >= requiredSuccesses) {
        this.transitionCircuitBreaker(type, 'closed')
      }
    } else if (state.state === 'closed') {
      // Reset failure count on success in closed state
      state.failures = 0
    }
  }

  /**
   * Transition the circuit breaker to a new state.
   *
   * @param type - The transport type
   * @param newState - The new state
   */
  private transitionCircuitBreaker(type: TransportType, newState: CircuitBreakerState): void {
    const state = this.circuitBreakers.get(type)
    if (!state) return

    const oldState = state.state
    state.state = newState
    state.lastStateChange = Date.now()

    switch (newState) {
      case 'open':
        state.lastOpenedAt = Date.now()
        state.nextHalfOpenAt = Date.now() + (this.config.circuitBreaker?.recoveryTimeout || 30000)
        state.halfOpenSuccesses = 0
        this.emit('circuit-breaker:open', { transport: type })
        break

      case 'half-open':
        state.halfOpenSuccesses = 0
        this.emit('circuit-breaker:half-open', { transport: type })
        break

      case 'closed':
        state.failures = 0
        state.halfOpenSuccesses = 0
        state.lastOpenedAt = undefined
        state.nextHalfOpenAt = undefined
        this.emit('circuit-breaker:close', { transport: type })
        break
    }

    this.recordEvent({
      type: 'circuit-breaker',
      data: {
        transport: type,
        from: oldState,
        to: newState,
      },
    })
  }

  /**
   * Get the current circuit breaker state for a transport.
   *
   * @param type - The transport type
   * @returns The circuit breaker state
   */
  getCircuitBreakerState(type: TransportType): CircuitBreakerTransportState | undefined {
    return this.circuitBreakers.get(type)
  }

  // ============================================================================
  // Event History Methods
  // ============================================================================

  /**
   * Record an event in the history.
   *
   * @param event - The event to record (without timestamp)
   */
  private recordEvent(event: Omit<TransportSwitchEvent, 'timestamp'>): void {
    const fullEvent: TransportSwitchEvent = {
      ...event,
      timestamp: Date.now(),
    }

    this.eventHistory.push(fullEvent)

    // Trim history if it exceeds max size
    const maxSize = this.config.maxEventHistorySize || 100
    while (this.eventHistory.length > maxSize) {
      this.eventHistory.shift()
    }
  }

  /**
   * Get the transport switch event history.
   *
   * @param options - Options for filtering the history
   * @returns Array of events matching the criteria
   *
   * @example
   * ```typescript
   * // Get all events
   * const allEvents = selector.getEventHistory()
   *
   * // Get only switch events
   * const switchEvents = selector.getEventHistory({ type: 'switch' })
   *
   * // Get recent events
   * const recentEvents = selector.getEventHistory({ since: Date.now() - 60000 })
   * ```
   */
  getEventHistory(options?: {
    type?: TransportSwitchEvent['type']
    since?: number
    limit?: number
  }): TransportSwitchEvent[] {
    let events = [...this.eventHistory]

    if (options?.type) {
      events = events.filter((e) => e.type === options.type)
    }

    if (options?.since) {
      events = events.filter((e) => e.timestamp >= options.since!)
    }

    if (options?.limit) {
      events = events.slice(-options.limit)
    }

    return events
  }

  /**
   * Clear the event history.
   */
  clearEventHistory(): void {
    this.eventHistory = []
  }

  // ============================================================================
  // Strategy Management
  // ============================================================================

  /**
   * Register a custom transport selection strategy.
   *
   * @param strategy - The strategy to register
   *
   * @example
   * ```typescript
   * selector.registerSelectionStrategy({
   *   name: 'priority-based',
   *   select: (context, available) => {
   *     if (context.priority === 'high') return 'websocket'
   *     return null
   *   },
   *   shouldUse: (context) => context.priority !== undefined,
   * })
   * ```
   */
  registerSelectionStrategy(strategy: TransportSelectionStrategy): void {
    strategy.initialize?.()
    this.selectionStrategies.push(strategy)
  }

  /**
   * Unregister a transport selection strategy.
   *
   * @param name - The name of the strategy to remove
   */
  unregisterSelectionStrategy(name: string): void {
    const index = this.selectionStrategies.findIndex((s) => s.name === name)
    if (index !== -1) {
      const strategy = this.selectionStrategies[index]!
      strategy.destroy?.()
      this.selectionStrategies.splice(index, 1)
    }
  }

  /**
   * Get all registered selection strategies.
   *
   * @returns Array of registered strategies
   */
  getSelectionStrategies(): TransportSelectionStrategy[] {
    return [...this.selectionStrategies]
  }

  /**
   * Set a custom health check strategy.
   *
   * @param strategy - The health check strategy
   */
  setHealthCheckStrategy(strategy: HealthCheckStrategy): void {
    this.healthCheckStrategy = strategy
  }

  /**
   * Set the load balancing strategy.
   *
   * @param strategy - The load balancing strategy
   */
  setLoadBalancingStrategy(strategy: LoadBalancingStrategy): void {
    this.loadBalancer = strategy
  }

  // ============================================================================
  // Transport Availability Methods
  // ============================================================================

  /**
   * Checks if a specific transport is available and healthy.
   *
   * @param type - The transport type to check
   * @returns Whether the transport is available
   *
   * @example
   * ```typescript
   * if (selector.isTransportAvailable('websocket')) {
   *   // Use WebSocket
   * }
   * ```
   */
  private isTransportAvailable(type: TransportType): boolean {
    // Check circuit breaker first
    if (!this.isCircuitBreakerClosed(type)) {
      return false
    }

    if (type === 'websocket') {
      return this.isWebSocketAvailable()
    }
    return this.config.httpAvailable !== false
  }

  /**
   * Checks if WebSocket transport is available and healthy.
   *
   * @returns Whether WebSocket is available
   */
  private isWebSocketAvailable(): boolean {
    if (this.config.websocketAvailable === false) {
      return false
    }
    const health = this.health.get('websocket')
    return health?.healthy !== false
  }

  /**
   * Checks if a pipeline contains a $changeStream stage.
   *
   * @param pipeline - The aggregation pipeline
   * @returns Whether the pipeline has a change stream stage
   */
  private hasChangeStreamInPipeline(pipeline?: Array<Record<string, unknown>>): boolean {
    if (!pipeline) return false
    return pipeline.some((stage) => '$changeStream' in stage)
  }

  // ============================================================================
  // Reconnection Methods
  // ============================================================================

  /**
   * Attempts to reconnect a transport.
   *
   * @param type - The transport type to reconnect
   *
   * @remarks
   * This method emits a `transport:reconnecting` event and should be
   * implemented by the transport layer to actually reconnect.
   *
   * @example
   * ```typescript
   * selector.on('transport:reconnecting', async ({ type }) => {
   *   await transportLayer.reconnect(type)
   * })
   *
   * selector.attemptReconnect('websocket')
   * ```
   */
  attemptReconnect(type: TransportType): void {
    this.emit('transport:reconnecting', { type })

    this.recordEvent({
      type: 'switch',
      to: type,
      reason: 'reconnect_attempt',
    })
  }

  // ============================================================================
  // Health Check Methods
  // ============================================================================

  /**
   * Checks the health of a specific transport.
   *
   * @param type - The transport type to check
   * @returns Health status including latency and state
   *
   * @example
   * ```typescript
   * const health = await selector.checkHealth('websocket')
   * console.log(`Healthy: ${health.healthy}, Latency: ${health.latency}ms`)
   * ```
   */
  async checkHealth(type: TransportType): Promise<TransportHealth> {
    const startTime = Date.now()
    const currentHealth = this.health.get(type) || {
      healthy: true,
      lastCheck: startTime,
      consecutiveFailures: 0,
    }

    // Use custom health check strategy if available
    if (this.healthCheckStrategy) {
      try {
        const result = await this.healthCheckStrategy.check(type)
        const latency = result.latency ?? (Date.now() - startTime)

        this.updateLatencyHistory(type, latency)

        const newHealth: TransportHealth = {
          ...currentHealth,
          healthy: result.healthy,
          lastCheck: Date.now(),
          latency,
          consecutiveFailures: result.healthy ? 0 : (currentHealth.consecutiveFailures ?? 0) + 1,
          lastError: result.error,
        }

        if (type === 'websocket') {
          newHealth.connectionState = this.config.websocketAvailable ? 'connected' : 'disconnected'
        }

        this.calculateHealthMetrics(newHealth)
        this.health.set(type, newHealth)

        // Update circuit breaker based on result
        if (result.healthy) {
          this.recordCircuitBreakerSuccess(type)
        } else {
          this.recordCircuitBreakerFailure(type, result.error)
        }

        return newHealth
      } catch (error) {
        const newHealth: TransportHealth = {
          ...currentHealth,
          healthy: false,
          lastCheck: Date.now(),
          lastError: error as Error,
          consecutiveFailures: (currentHealth.consecutiveFailures ?? 0) + 1,
        }

        this.health.set(type, newHealth)
        this.recordCircuitBreakerFailure(type, error as Error)
        return newHealth
      }
    }

    // Default health check (ping simulation)
    const latency = Date.now() - startTime
    this.updateLatencyHistory(type, latency)

    const newHealth: TransportHealth = {
      ...currentHealth,
      healthy: currentHealth.consecutiveFailures === 0 ||
        (currentHealth.consecutiveFailures ?? 0) < (this.config.unhealthyThreshold ?? 3),
      lastCheck: Date.now(),
      latency,
    }

    if (type === 'websocket') {
      newHealth.connectionState = this.config.websocketAvailable ? 'connected' : 'disconnected'
    }

    this.calculateHealthMetrics(newHealth)
    this.health.set(type, newHealth)
    return newHealth
  }

  /**
   * Update latency history for a transport.
   *
   * @param type - The transport type
   * @param latency - The latency to record
   */
  private updateLatencyHistory(type: TransportType, latency: number): void {
    const history = this.latencyHistory.get(type) || []
    history.push(latency)

    // Keep only the last 100 samples
    if (history.length > 100) {
      history.shift()
    }

    this.latencyHistory.set(type, history)
  }

  /**
   * Calculate health metrics from latency history.
   *
   * @param health - The health object to update
   */
  private calculateHealthMetrics(health: TransportHealth): void {
    // Calculate success rate
    if (health.totalRequests && health.totalRequests > 0) {
      const failures = health.totalFailures || 0
      health.successRate = ((health.totalRequests - failures) / health.totalRequests) * 100
    }
  }

  /**
   * Sets the health status for a transport and emits change events.
   *
   * @param type - The transport type
   * @param healthUpdate - Partial health update
   *
   * @example
   * ```typescript
   * selector.setTransportHealth('websocket', {
   *   healthy: false,
   *   lastError: new Error('Connection lost'),
   *   lastCheck: Date.now(),
   * })
   * ```
   */
  setTransportHealth(
    type: TransportType,
    healthUpdate: Partial<TransportHealth> & { healthy: boolean }
  ): void {
    const previousHealth = this.health.get(type) || {
      healthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
    }

    const newHealth: TransportHealth = {
      ...previousHealth,
      ...healthUpdate,
      consecutiveFailures: healthUpdate.healthy
        ? 0
        : (healthUpdate.consecutiveFailures ?? (previousHealth.consecutiveFailures ?? 0)),
    }

    this.health.set(type, newHealth)

    this.emit('transport:health', {
      transport: type,
      healthy: newHealth.healthy,
      previousHealth,
    })

    this.recordEvent({
      type: 'health',
      data: {
        transport: type,
        healthy: newHealth.healthy,
        previousHealthy: previousHealth.healthy,
      },
    })

    // Update circuit breaker
    if (healthUpdate.healthy) {
      this.recordCircuitBreakerSuccess(type)
    } else {
      this.recordCircuitBreakerFailure(type, healthUpdate.lastError)
    }
  }

  /**
   * Gets the current health status for a transport.
   *
   * @param type - The transport type
   * @returns Current health status
   *
   * @example
   * ```typescript
   * const health = selector.getTransportHealth('http')
   * if (!health.healthy) {
   *   console.log(`HTTP unhealthy: ${health.lastError?.message}`)
   * }
   * ```
   */
  getTransportHealth(type: TransportType): TransportHealth {
    return this.health.get(type) || {
      healthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
    }
  }

  /**
   * Records a health check failure for a transport.
   *
   * @param type - The transport type
   *
   * @example
   * ```typescript
   * try {
   *   await transport.ping()
   * } catch (error) {
   *   selector.recordHealthCheckFailure('websocket')
   * }
   * ```
   */
  recordHealthCheckFailure(type: TransportType): void {
    const current = this.health.get(type) || {
      healthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
    }

    const failures = (current.consecutiveFailures ?? 0) + 1
    const threshold = this.config.unhealthyThreshold ?? 3

    const newHealth: TransportHealth = {
      ...current,
      consecutiveFailures: failures,
      healthy: failures < threshold,
      lastCheck: Date.now(),
      totalFailures: (current.totalFailures || 0) + 1,
    }

    this.health.set(type, newHealth)
    this.calculateHealthMetrics(newHealth)

    this.recordCircuitBreakerFailure(type)
  }

  /**
   * Records a successful health check for a transport.
   *
   * @param type - The transport type
   * @param latency - The measured latency in ms
   *
   * @example
   * ```typescript
   * const start = Date.now()
   * await transport.ping()
   * selector.recordHealthCheckSuccess('websocket', Date.now() - start)
   * ```
   */
  recordHealthCheckSuccess(type: TransportType, latency: number): void {
    const current = this.health.get(type) || {
      healthy: true,
      lastCheck: Date.now(),
      consecutiveFailures: 0,
    }

    const newHealth: TransportHealth = {
      ...current,
      healthy: true,
      consecutiveFailures: 0,
      latency,
      lastCheck: Date.now(),
    }

    this.updateLatencyHistory(type, latency)
    this.health.set(type, newHealth)

    this.recordCircuitBreakerSuccess(type)
  }

  /**
   * Starts periodic health checks for all transports.
   *
   * @example
   * ```typescript
   * // Start health checks
   * selector.startHealthChecks()
   *
   * // Later, stop them
   * selector.stopHealthChecks()
   * ```
   */
  startHealthChecks(): void {
    if (this.healthCheckTimer) {
      return
    }

    const interval = this.config.healthCheck?.interval ||
      this.config.healthCheckInterval ||
      10000

    this.healthCheckTimer = setInterval(() => {
      this.checkHealth('http')
      if (this.config.websocketAvailable) {
        this.checkHealth('websocket')
      }
    }, interval)
  }

  /**
   * Stops periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  // ============================================================================
  // Subscription Management
  // ============================================================================

  /**
   * Gets the subscription state for a given subscription ID.
   *
   * @param subscriptionId - The subscription identifier
   * @returns The subscription state or undefined
   *
   * @example
   * ```typescript
   * const state = selector.getSubscriptionState('sub-001')
   * if (state?.active) {
   *   console.log(`Subscription on ${state.transport}`)
   * }
   * ```
   */
  getSubscriptionState(subscriptionId: string): SubscriptionState | undefined {
    return this.subscriptions.get(subscriptionId)
  }

  /**
   * Update subscription activity.
   *
   * @param subscriptionId - The subscription identifier
   */
  updateSubscriptionActivity(subscriptionId: string): void {
    const state = this.subscriptions.get(subscriptionId)
    if (state) {
      state.lastActivity = Date.now()
      state.messageCount = (state.messageCount || 0) + 1
    }
  }

  /**
   * Get all active subscriptions.
   *
   * @returns Map of subscription IDs to their states
   */
  getActiveSubscriptions(): Map<string, SubscriptionState> {
    return new Map(
      Array.from(this.subscriptions.entries()).filter(([, state]) => state.active)
    )
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Gets the number of active connections for a transport type.
   *
   * @param type - The transport type
   * @returns Number of active connections
   */
  getActiveConnectionCount(type: TransportType): number {
    if (type === 'websocket') {
      return this.wsConnectionCount
    }
    // HTTP is connectionless in this model
    return 0
  }

  // ============================================================================
  // Preferences Management
  // ============================================================================

  /**
   * Sets transport preferences.
   *
   * @param prefs - The preferences to set
   *
   * @example
   * ```typescript
   * selector.setPreferences({
   *   preferredTransport: 'websocket',
   *   maxRetries: 5,
   *   retryDelay: 2000,
   * })
   * ```
   */
  setPreferences(prefs: TransportPreferences): void {
    this.preferences = { ...this.preferences, ...prefs }
  }

  /**
   * Gets current transport preferences.
   *
   * @returns Current preferences
   */
  getPreferences(): TransportPreferences {
    return { ...this.preferences }
  }

  // ============================================================================
  // Pending Request Management
  // ============================================================================

  /**
   * Creates a pending request for tracking during transport switches.
   *
   * @param context - The request context
   * @returns A pending request handle
   *
   * @example
   * ```typescript
   * const pending = selector.createPendingRequest({
   *   operation: 'find',
   *   hasSubscription: false,
   *   requestId: 'req-001',
   * })
   *
   * // When request completes
   * await pending.complete()
   * ```
   */
  createPendingRequest(context: RequestContext): PendingRequest {
    const requestId = context.requestId || `req-${Date.now()}`
    const callbacks: Array<() => void> = []

    const pendingRequest = {
      callbacks,
      complete: async (): Promise<void> => {
        callbacks.forEach((cb) => cb())
        this.pendingRequests.delete(requestId)
      },
      onComplete: (callback: () => void): void => {
        callbacks.push(callback)
      },
    }

    this.pendingRequests.set(requestId, pendingRequest)
    return pendingRequest
  }

  /**
   * Get the count of pending requests.
   *
   * @returns Number of pending requests
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size
  }

  // ============================================================================
  // Transport Switching
  // ============================================================================

  /**
   * Drains connections for a transport before switching.
   *
   * @param type - The transport type to drain
   * @param options - Drain options
   *
   * @remarks
   * Waits for pending requests to complete or times out.
   * Emits `transport:draining` and `transport:drained` events.
   *
   * @example
   * ```typescript
   * await selector.drainConnections('http', { timeout: 5000 })
   * ```
   */
  async drainConnections(type: TransportType, options: { timeout: number }): Promise<void> {
    this.emit('transport:draining')

    // If preserveRequestOrder is enabled, we don't wait for requests to complete
    // They will be migrated to the new transport instead of being dropped
    if (this.config.preserveRequestOrder) {
      this.emit('transport:drained')
      return
    }

    // Wait for pending requests to complete or timeout
    const startTime = Date.now()

    while (this.pendingRequests.size > 0) {
      if (Date.now() - startTime > options.timeout) {
        // Timeout reached, force drain
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    this.emit('transport:drained')
  }

  /**
   * Switches from one transport to another gracefully.
   *
   * @param from - The current transport
   * @param to - The target transport
   *
   * @remarks
   * This method:
   * 1. Emits `transport:switchStart`
   * 2. Drains connections from the source transport
   * 3. Reconnects subscriptions on the new transport
   * 4. Updates configuration to use the new transport
   * 5. Emits `transport:switchComplete`
   *
   * @example
   * ```typescript
   * await selector.switchTransport('http', 'websocket')
   * ```
   */
  async switchTransport(from: TransportType, to: TransportType): Promise<void> {
    this.emit('transport:switchStart')

    this.recordEvent({
      type: 'switch',
      from,
      to,
      reason: 'manual_switch',
    })

    const drainTimeout = this.config.drainTimeout ?? 5000

    // Drain connections
    await this.drainConnections(from, { timeout: drainTimeout })

    // Check for dropped requests after drain
    const droppedRequests: string[] = []
    this.pendingRequests.forEach((_, requestId) => {
      droppedRequests.push(requestId)
    })

    if (droppedRequests.length > 0) {
      this.emit('transport:forcedSwitch', {
        from,
        to,
        droppedRequests,
      })

      this.recordEvent({
        type: 'switch',
        from,
        to,
        reason: 'forced_switch',
        data: { droppedRequests },
      })

      // Clear remaining pending requests
      this.pendingRequests.clear()
    }

    // Reconnect subscriptions on new transport
    this.subscriptions.forEach((sub, subId) => {
      if (sub.transport === from) {
        this.emit('subscription:reconnect', {
          subscriptionId: subId,
          previousTransport: from,
          newTransport: to,
        })
        sub.transport = to
      }
    })

    // Update config to force new transport after switch
    this.config.forceTransport = to
    this.currentForcedTransport = to

    this.emit('transport:switchComplete')
  }

  // ============================================================================
  // Configuration and Cleanup
  // ============================================================================

  /**
   * Update the selector configuration.
   *
   * @param config - Partial configuration to merge
   *
   * @example
   * ```typescript
   * selector.updateConfig({
   *   circuitBreaker: { failureThreshold: 10 },
   * })
   * ```
   */
  updateConfig(config: Partial<TransportConfig>): void {
    this.config = { ...this.config, ...config }

    // Re-initialize components if needed
    if (config.loadBalancing) {
      this.initializeLoadBalancer()
    }

    if (config.healthCheck) {
      this.initializeHealthCheckStrategy()
    }
  }

  /**
   * Get the current configuration.
   *
   * @returns The current configuration
   */
  getConfig(): TransportConfig {
    return { ...this.config }
  }

  /**
   * Destroy the selector and clean up resources.
   *
   * @remarks
   * Stops health checks, clears timers, and destroys registered strategies.
   */
  destroy(): void {
    this.stopHealthChecks()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Destroy registered strategies
    for (const strategy of this.selectionStrategies) {
      strategy.destroy?.()
    }

    this.selectionStrategies = []
    this.subscriptions.clear()
    this.pendingRequests.clear()
    this.sessionTransports.clear()
    this.stickySessions.clear()
    this.eventHistory = []

    this.removeAllListeners()
  }
}
