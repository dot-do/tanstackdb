/**
 * Types for Change Event Router and Transform System
 *
 * This module provides TypeScript types for routing and transforming
 * MongoDB change stream events to TanStack DB format.
 */

import type {
  MongoChangeEvent,
  MongoOperationType,
  ChangeMessage,
} from '../../types'

/**
 * Handler function type for receiving transformed change messages.
 *
 * @typeParam T - The document type
 */
export type ChangeEventHandler<T> = (message: ChangeMessage<T>) => void | Promise<void>

/**
 * Batch handler function type for receiving batches of transformed messages.
 *
 * @typeParam T - The document type
 */
export type BatchEventHandler<T> = (messages: ChangeMessage<T>[]) => void | Promise<void>

/**
 * Filter function for determining if an event should be processed.
 *
 * @typeParam T - The document type
 */
export type EventFilter<T> = (event: MongoChangeEvent<T>) => boolean

/**
 * Error handler function for handling errors during event processing.
 *
 * @typeParam T - The document type
 */
export type ErrorHandler<T> = (error: Error, message: ChangeMessage<T>) => void

/**
 * Key extractor function for deriving the message key from an event.
 *
 * @typeParam T - The document type
 */
export type KeyExtractor<T> = (event: MongoChangeEvent<T>) => string

/**
 * Transform function for customizing the transformation of events to messages.
 *
 * @typeParam T - The document type
 */
export type TransformFunction<T> = (event: MongoChangeEvent<T>) => ChangeMessage<T>

/**
 * Handler registration options for filtering events.
 *
 * @typeParam T - The document type
 */
export interface HandlerOptions<T> {
  /** Filter to a single operation type */
  operationType?: MongoOperationType

  /** Filter to multiple operation types */
  operationTypes?: MongoOperationType[]

  /** Custom filter function */
  filter?: EventFilter<T>

  /** Filter by document key prefix */
  keyPrefix?: string
}

/**
 * Statistics tracked by the router when metrics are enabled.
 */
export interface RouterStats {
  /** Total number of events processed */
  totalEvents: number

  /** Count of events by operation type */
  eventsByType: Partial<Record<MongoOperationType, number>>

  /** Total number of handler executions */
  handlerExecutions: number

  /** Total number of errors encountered */
  errors: number
}

/**
 * Extended router statistics with detailed timing and throughput metrics.
 *
 * Provides comprehensive telemetry for monitoring router performance,
 * including latency percentiles, throughput, and queue metrics.
 */
export interface DetailedRouterStats extends RouterStats {
  /** Average event processing latency in milliseconds */
  averageLatencyMs: number

  /** Minimum event processing latency in milliseconds */
  minLatencyMs: number

  /** Maximum event processing latency in milliseconds */
  maxLatencyMs: number

  /** 50th percentile (median) latency in milliseconds */
  p50LatencyMs: number

  /** 95th percentile latency in milliseconds */
  p95LatencyMs: number

  /** 99th percentile latency in milliseconds */
  p99LatencyMs: number

  /** Events processed per second (rolling average) */
  throughputPerSecond: number

  /** Current number of events in the priority queue */
  queueSize: number

  /** Peak queue size observed */
  peakQueueSize: number

  /** Number of events processed by priority level */
  eventsByPriority: Record<EventPriority, number>

  /** Count of middleware executions */
  middlewareExecutions: number

  /** Count of middleware errors */
  middlewareErrors: number

  /** Timestamp when stats collection started */
  collectionStartedAt: number

  /** Duration of stats collection in milliseconds */
  collectionDurationMs: number

  /** Number of batches flushed */
  batchesProcessed: number

  /** Average batch size */
  averageBatchSize: number
}

/**
 * Event priority levels for the priority queue.
 *
 * Higher priority events are processed before lower priority events.
 * Priority 'critical' events bypass normal queuing and are processed immediately.
 *
 * @example
 * ```typescript
 * // Queue a high priority event
 * router.queueEventWithPriority(event, 'high')
 *
 * // Critical events are processed immediately
 * router.queueEventWithPriority(event, 'critical')
 * ```
 */
export type EventPriority = 'critical' | 'high' | 'normal' | 'low'

/**
 * Middleware context passed to middleware functions.
 *
 * Contains the event being processed, the transformed message,
 * and metadata about the processing pipeline.
 *
 * @typeParam T - The document type
 */
export interface MiddlewareContext<T> {
  /** The original MongoDB change event */
  readonly event: MongoChangeEvent<T>

  /** The transformed change message (may be modified by middleware) */
  message: ChangeMessage<T>

  /** Timestamp when the event entered the pipeline */
  readonly startTime: number

  /** Priority of the event in the queue */
  readonly priority: EventPriority

  /** Custom metadata that middleware can attach */
  metadata: Record<string, unknown>

  /** Whether to skip remaining middleware and proceed to handlers */
  skipRemainingMiddleware: boolean

  /** Whether to skip handler execution entirely */
  skipHandlers: boolean
}

/**
 * Result returned by middleware functions.
 *
 * Middleware can modify the message, add metadata, or control flow.
 */
export interface MiddlewareResult<T> {
  /** Modified message (optional, uses existing if not provided) */
  message?: ChangeMessage<T>

  /** Additional metadata to merge into context */
  metadata?: Record<string, unknown>

  /** Whether to skip remaining middleware */
  skipRemainingMiddleware?: boolean

  /** Whether to skip handler execution */
  skipHandlers?: boolean
}

/**
 * Middleware function type for intercepting and modifying events.
 *
 * Middleware functions are called in order before handlers.
 * They can modify the message, add metadata, or short-circuit processing.
 *
 * @typeParam T - The document type
 *
 * @example
 * ```typescript
 * const loggingMiddleware: Middleware<User> = async (ctx, next) => {
 *   console.log('Processing event:', ctx.event.operationType)
 *   const result = await next()
 *   console.log('Event processed in', Date.now() - ctx.startTime, 'ms')
 *   return result
 * }
 *
 * router.use(loggingMiddleware)
 * ```
 */
export type Middleware<T> = (
  context: MiddlewareContext<T>,
  next: () => Promise<MiddlewareResult<T> | void>
) => Promise<MiddlewareResult<T> | void>

/**
 * Options for middleware registration.
 */
export interface MiddlewareOptions {
  /** Name for identifying the middleware in logs/metrics */
  name?: string

  /** Order in which middleware executes (lower = earlier) */
  order?: number

  /** Operation types this middleware applies to (all if not specified) */
  operationTypes?: MongoOperationType[]
}

/**
 * Options for queuing events with priority.
 */
export interface QueueEventOptions {
  /** Priority level for the event */
  priority?: EventPriority

  /** Custom metadata to attach to the event */
  metadata?: Record<string, unknown>
}

/**
 * Extended configuration options for ChangeEventRouter with middleware and priority support.
 *
 * @typeParam T - The document type
 */
export interface ChangeEventRouterConfig<T> {
  /** Maximum number of events to batch before flushing */
  batchSize?: number

  /** Maximum time in milliseconds to wait before flushing a batch */
  batchTimeoutMs?: number

  /** Whether to collect and track metrics */
  enableMetrics?: boolean

  /** Custom error handler function */
  errorHandler?: ErrorHandler<T>

  /** Silently swallow errors without throwing or calling errorHandler */
  silentErrors?: boolean

  /** Custom key extraction function */
  getKey?: KeyExtractor<T>

  /** Custom transform function for events */
  transform?: TransformFunction<T>

  /** Whether to preserve order of event processing */
  preserveOrder?: boolean

  /** Enable priority queue for event processing */
  enablePriorityQueue?: boolean

  /** Default priority for events without explicit priority */
  defaultPriority?: EventPriority

  /** Enable detailed metrics collection */
  enableDetailedMetrics?: boolean

  /** Maximum number of latency samples to keep for percentile calculations */
  maxLatencySamples?: number
}
