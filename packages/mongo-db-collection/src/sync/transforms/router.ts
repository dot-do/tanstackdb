/**
 * Change Event Router
 *
 * A high-performance router for MongoDB change stream events that transforms
 * them to TanStack DB ChangeMessage format and dispatches them to registered handlers.
 *
 * @module sync/transforms/router
 *
 * ## Features
 *
 * - **Event Routing**: Routes events to handlers based on operation type, key prefix, and custom filters
 * - **Custom Transforms**: Support for custom event transformation functions
 * - **Event Batching**: Batch events by size or time for efficient bulk processing
 * - **Middleware Pipeline**: Intercept, modify, or filter events before handler execution
 * - **Priority Queue**: Process high-priority events before lower-priority ones
 * - **Comprehensive Metrics**: Track latency percentiles, throughput, and queue statistics
 * - **Error Handling**: Configurable strategies for error recovery and reporting
 * - **Order Preservation**: Optional strict ordering for events that must be processed sequentially
 *
 * ## Architecture
 *
 * ```
 * MongoDB Change Stream
 *        │
 *        ▼
 * ┌─────────────────┐
 * │  Priority Queue │  (optional)
 * └────────┬────────┘
 *          │
 *          ▼
 * ┌─────────────────┐
 * │   Transform     │  MongoDB event → ChangeMessage
 * └────────┬────────┘
 *          │
 *          ▼
 * ┌─────────────────┐
 * │  Middleware     │  Intercept, modify, filter
 * │   Pipeline      │
 * └────────┬────────┘
 *          │
 *          ▼
 * ┌─────────────────┐
 * │    Handlers     │  Event handlers with filters
 * └─────────────────┘
 * ```
 *
 * ## Usage Examples
 *
 * ### Basic Usage
 *
 * ```typescript
 * import { ChangeEventRouter } from '@tanstack/mongo-db-collection'
 *
 * const router = new ChangeEventRouter<User>({
 *   enableMetrics: true,
 *   batchSize: 100,
 *   batchTimeoutMs: 50,
 * })
 *
 * // Register event handlers
 * router.onEvent((message) => {
 *   console.log('Received:', message.type, message.key)
 * })
 *
 * // Filter by operation type
 * router.onEvent((message) => {
 *   console.log('New user inserted:', message.value.name)
 * }, { operationType: 'insert' })
 *
 * // Process a change event
 * await router.routeEvent(mongoChangeEvent)
 * ```
 *
 * ### With Middleware
 *
 * ```typescript
 * // Add logging middleware
 * router.use(async (ctx, next) => {
 *   console.log(`Processing ${ctx.event.operationType} event`)
 *   const start = Date.now()
 *   await next()
 *   console.log(`Processed in ${Date.now() - start}ms`)
 * }, { name: 'logger' })
 *
 * // Add validation middleware
 * router.use(async (ctx, next) => {
 *   if (!ctx.message.value?.name) {
 *     ctx.skipHandlers = true // Skip handlers for invalid data
 *     return
 *   }
 *   await next()
 * }, { name: 'validator', operationTypes: ['insert', 'update'] })
 * ```
 *
 * ### With Priority Queue
 *
 * ```typescript
 * const router = new ChangeEventRouter<Order>({
 *   enablePriorityQueue: true,
 *   defaultPriority: 'normal',
 * })
 *
 * // Critical events are processed immediately
 * router.queueEventWithPriority(cancelOrderEvent, 'critical')
 *
 * // Regular events go through the queue
 * router.queueEventWithPriority(updateStockEvent, 'low')
 * ```
 *
 * ### Batch Processing
 *
 * ```typescript
 * router.onBatch((messages) => {
 *   // Efficiently process multiple events at once
 *   await database.bulkWrite(messages)
 * })
 *
 * // Queue events for batching
 * for (const event of events) {
 *   router.queueEvent(event)
 * }
 *
 * // Manual flush when needed
 * await router.flushBatch()
 * ```
 *
 * @see {@link ChangeEventRouterConfig} for configuration options
 * @see {@link RouterStats} for basic metrics
 * @see {@link DetailedRouterStats} for comprehensive metrics
 * @see {@link Middleware} for middleware function signature
 */

import type {
  MongoChangeEvent,
  MongoOperationType,
  ChangeMessage,
} from '../../types'
import type {
  ChangeEventRouterConfig,
  ChangeEventHandler,
  BatchEventHandler,
  HandlerOptions,
  RouterStats,
  DetailedRouterStats,
  KeyExtractor,
  TransformFunction,
  ErrorHandler,
  EventFilter,
  EventPriority,
  Middleware,
  MiddlewareOptions,
  MiddlewareContext,
  MiddlewareResult,
  QueueEventOptions,
} from './types'

/**
 * Numeric priority values for sorting the priority queue.
 * Higher values = higher priority.
 *
 * @internal
 */
const PRIORITY_VALUES: Record<EventPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
}

/**
 * Internal representation of a registered handler with its options.
 *
 * @typeParam T - The document type
 * @internal
 */
interface RegisteredHandler<T> {
  /** Unique identifier for the handler */
  id: number
  /** The handler function to invoke */
  handler: ChangeEventHandler<T>
  /** Optional filtering options */
  options?: HandlerOptions<T>
}

/**
 * Internal representation of a registered batch handler.
 *
 * @typeParam T - The document type
 * @internal
 */
interface RegisteredBatchHandler<T> {
  /** Unique identifier for the handler */
  id: number
  /** The batch handler function to invoke */
  handler: BatchEventHandler<T>
}

/**
 * Internal representation of a registered middleware.
 *
 * @typeParam T - The document type
 * @internal
 */
interface RegisteredMiddleware<T> {
  /** Unique identifier for the middleware */
  id: number
  /** The middleware function */
  middleware: Middleware<T>
  /** Registration options */
  options: MiddlewareOptions
}

/**
 * Internal representation of an event in the priority queue.
 *
 * @typeParam T - The document type
 * @internal
 */
interface QueuedEvent<T> {
  /** The MongoDB change event */
  event: MongoChangeEvent<T>
  /** Priority level */
  priority: EventPriority
  /** Numeric priority for sorting */
  priorityValue: number
  /** Timestamp when queued */
  queuedAt: number
  /** Custom metadata */
  metadata: Record<string, unknown>
}

/**
 * Routes MongoDB change stream events to registered handlers.
 *
 * The ChangeEventRouter provides a flexible and efficient way to process MongoDB
 * change stream events. It transforms events from MongoDB's native format to
 * TanStack DB's ChangeMessage format and dispatches them to registered handlers.
 *
 * ## Key Capabilities
 *
 * 1. **Handler Registration**: Register multiple handlers with optional filters
 *    for operation type, key prefix, or custom conditions.
 *
 * 2. **Middleware Pipeline**: Add middleware functions that can intercept,
 *    modify, or filter events before they reach handlers.
 *
 * 3. **Priority Queue**: Process critical events immediately while queueing
 *    lower-priority events for batch processing.
 *
 * 4. **Batching**: Group events for efficient bulk processing with configurable
 *    size limits and timeouts.
 *
 * 5. **Metrics**: Track detailed statistics including latency percentiles,
 *    throughput, and error rates.
 *
 * @typeParam T - The document type. Must extend `{ _id: string }`.
 *
 * @example Basic event routing
 * ```typescript
 * const router = new ChangeEventRouter<User>({ enableMetrics: true })
 *
 * router.onEvent((message) => {
 *   console.log(`${message.type}: ${message.key}`)
 * })
 *
 * await router.routeEvent(changeEvent)
 * ```
 *
 * @example With middleware
 * ```typescript
 * router.use(async (ctx, next) => {
 *   ctx.metadata.startTime = Date.now()
 *   await next()
 *   console.log(`Processed in ${Date.now() - ctx.metadata.startTime}ms`)
 * })
 * ```
 *
 * @example With priority queue
 * ```typescript
 * const router = new ChangeEventRouter<Order>({
 *   enablePriorityQueue: true,
 *   defaultPriority: 'normal',
 * })
 *
 * // Critical events bypass the queue
 * router.queueEventWithPriority(urgentEvent, 'critical')
 * ```
 */
export class ChangeEventRouter<T extends { _id: string }> {
  /**
   * Registered event handlers.
   * @internal
   */
  private handlers: RegisteredHandler<T>[] = []

  /**
   * Registered batch handlers.
   * @internal
   */
  private batchHandlers: RegisteredBatchHandler<T>[] = []

  /**
   * Registered middleware functions.
   * @internal
   */
  private middlewares: RegisteredMiddleware<T>[] = []

  /**
   * Counter for generating unique handler/middleware IDs.
   * @internal
   */
  private nextHandlerId = 1

  /**
   * Flag indicating if the router has been disposed.
   * @internal
   */
  private disposed = false

  /**
   * Resolved configuration with defaults applied.
   * @internal
   */
  private readonly config: Required<
    Pick<
      ChangeEventRouterConfig<T>,
      | 'batchSize'
      | 'batchTimeoutMs'
      | 'enableMetrics'
      | 'silentErrors'
      | 'preserveOrder'
      | 'enablePriorityQueue'
      | 'defaultPriority'
      | 'enableDetailedMetrics'
      | 'maxLatencySamples'
    >
  > &
    Pick<ChangeEventRouterConfig<T>, 'errorHandler' | 'getKey' | 'transform'>

  /**
   * Basic statistics for event processing.
   * @internal
   */
  private stats: RouterStats = {
    totalEvents: 0,
    eventsByType: {},
    handlerExecutions: 0,
    errors: 0,
  }

  /**
   * Latency samples for percentile calculations.
   * @internal
   */
  private latencySamples: number[] = []

  /**
   * Events processed by priority level.
   * @internal
   */
  private eventsByPriority: Record<EventPriority, number> = {
    critical: 0,
    high: 0,
    normal: 0,
    low: 0,
  }

  /**
   * Middleware execution count.
   * @internal
   */
  private middlewareExecutions = 0

  /**
   * Middleware error count.
   * @internal
   */
  private middlewareErrors = 0

  /**
   * Peak queue size observed.
   * @internal
   */
  private peakQueueSize = 0

  /**
   * Timestamp when metrics collection started.
   * @internal
   */
  private metricsStartTime = Date.now()

  /**
   * Number of batches processed.
   * @internal
   */
  private batchesProcessed = 0

  /**
   * Total items processed in batches (for average calculation).
   * @internal
   */
  private totalBatchedItems = 0

  /**
   * Queue for batched events.
   * @internal
   */
  private batchQueue: ChangeMessage<T>[] = []

  /**
   * Timer for batch timeout.
   * @internal
   */
  private batchTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Priority queue for events when enablePriorityQueue is true.
   * @internal
   */
  private priorityQueue: QueuedEvent<T>[] = []

  /**
   * Promise chain for order preservation.
   * @internal
   */
  private processingPromise: Promise<void> = Promise.resolve()

  /**
   * Creates a new ChangeEventRouter instance.
   *
   * @param config - Configuration options for the router
   *
   * @throws {Error} If batchSize is not a positive number
   * @throws {Error} If batchTimeoutMs is negative
   *
   * @example Default configuration
   * ```typescript
   * const router = new ChangeEventRouter<User>({})
   * ```
   *
   * @example Full configuration
   * ```typescript
   * const router = new ChangeEventRouter<User>({
   *   batchSize: 100,
   *   batchTimeoutMs: 50,
   *   enableMetrics: true,
   *   enableDetailedMetrics: true,
   *   enablePriorityQueue: true,
   *   defaultPriority: 'normal',
   *   preserveOrder: false,
   *   silentErrors: false,
   *   errorHandler: (err, msg) => console.error(err, msg),
   *   getKey: (event) => event.documentKey._id,
   *   transform: (event) => customTransform(event),
   * })
   * ```
   */
  constructor(config: ChangeEventRouterConfig<T>) {
    // Validate configuration
    if (config.batchSize !== undefined && config.batchSize <= 0) {
      throw new Error('batchSize must be a positive number')
    }
    if (config.batchTimeoutMs !== undefined && config.batchTimeoutMs < 0) {
      throw new Error('batchTimeoutMs must be a non-negative number')
    }

    this.config = {
      batchSize: config.batchSize ?? 100,
      batchTimeoutMs: config.batchTimeoutMs ?? 100,
      enableMetrics: config.enableMetrics ?? false,
      silentErrors: config.silentErrors ?? false,
      preserveOrder: config.preserveOrder ?? false,
      enablePriorityQueue: config.enablePriorityQueue ?? false,
      defaultPriority: config.defaultPriority ?? 'normal',
      enableDetailedMetrics: config.enableDetailedMetrics ?? false,
      maxLatencySamples: config.maxLatencySamples ?? 1000,
      errorHandler: config.errorHandler,
      getKey: config.getKey,
      transform: config.transform,
    }
  }

  // ============================================================================
  // Public Properties
  // ============================================================================

  /**
   * Gets the number of registered event handlers.
   *
   * Does not include batch handlers or middleware.
   *
   * @returns The count of registered handlers
   *
   * @example
   * ```typescript
   * router.onEvent(handler1)
   * router.onEvent(handler2)
   * console.log(router.handlerCount) // 2
   * ```
   */
  get handlerCount(): number {
    return this.handlers.length
  }

  /**
   * Gets the number of registered middleware functions.
   *
   * @returns The count of registered middleware
   *
   * @example
   * ```typescript
   * router.use(middleware1)
   * router.use(middleware2)
   * console.log(router.middlewareCount) // 2
   * ```
   */
  get middlewareCount(): number {
    return this.middlewares.length
  }

  /**
   * Gets the current size of the priority queue.
   *
   * Only meaningful when `enablePriorityQueue` is true.
   *
   * @returns The number of events waiting in the priority queue
   */
  get queueSize(): number {
    return this.priorityQueue.length
  }

  // ============================================================================
  // Handler Registration
  // ============================================================================

  /**
   * Registers an event handler.
   *
   * The handler will be called for each event that matches the optional
   * filter criteria. Handlers are called in registration order.
   *
   * @param handler - The handler function to call for matching events
   * @param options - Optional filtering options to narrow which events trigger this handler
   *
   * @returns A function to unsubscribe the handler
   *
   * @throws {Error} If the router has been disposed
   *
   * @example Register for all events
   * ```typescript
   * const unsubscribe = router.onEvent((message) => {
   *   console.log('Event:', message.type, message.key)
   * })
   *
   * // Later: remove the handler
   * unsubscribe()
   * ```
   *
   * @example Register for specific operation type
   * ```typescript
   * router.onEvent((message) => {
   *   console.log('New document:', message.value)
   * }, { operationType: 'insert' })
   * ```
   *
   * @example Register for multiple operation types
   * ```typescript
   * router.onEvent((message) => {
   *   console.log('Document changed:', message.key)
   * }, { operationTypes: ['insert', 'update'] })
   * ```
   *
   * @example Register with key prefix filter
   * ```typescript
   * router.onEvent((message) => {
   *   console.log('User changed:', message.key)
   * }, { keyPrefix: 'user-' })
   * ```
   *
   * @example Register with custom filter
   * ```typescript
   * router.onEvent((message) => {
   *   console.log('High-value order:', message.value)
   * }, {
   *   operationType: 'insert',
   *   filter: (event) => event.fullDocument.total > 1000
   * })
   * ```
   */
  onEvent(handler: ChangeEventHandler<T>, options?: HandlerOptions<T>): () => void {
    if (this.disposed) {
      throw new Error('Cannot register handler on disposed router')
    }

    const id = this.nextHandlerId++
    this.handlers.push({ id, handler, options })

    return () => {
      const index = this.handlers.findIndex((h) => h.id === id)
      if (index !== -1) {
        this.handlers.splice(index, 1)
      }
    }
  }

  /**
   * Registers a batch event handler.
   *
   * Batch handlers receive arrays of events that have been accumulated via
   * `queueEvent()`. They are called when the batch size is reached or when
   * the batch timeout expires.
   *
   * @param handler - The handler function to call with batched events
   *
   * @returns A function to unsubscribe the handler
   *
   * @throws {Error} If the router has been disposed
   *
   * @example
   * ```typescript
   * router.onBatch(async (messages) => {
   *   console.log(`Processing batch of ${messages.length} events`)
   *
   *   // Efficiently process multiple events at once
   *   const operations = messages.map((msg) => ({
   *     updateOne: {
   *       filter: { _id: msg.key },
   *       update: { $set: msg.value },
   *       upsert: true,
   *     },
   *   }))
   *
   *   await collection.bulkWrite(operations)
   * })
   *
   * // Queue events for batching
   * for (const event of events) {
   *   router.queueEvent(event)
   * }
   * ```
   */
  onBatch(handler: BatchEventHandler<T>): () => void {
    if (this.disposed) {
      throw new Error('Cannot register handler on disposed router')
    }

    const id = this.nextHandlerId++
    this.batchHandlers.push({ id, handler })

    return () => {
      const index = this.batchHandlers.findIndex((h) => h.id === id)
      if (index !== -1) {
        this.batchHandlers.splice(index, 1)
      }
    }
  }

  // ============================================================================
  // Middleware Support
  // ============================================================================

  /**
   * Registers a middleware function.
   *
   * Middleware functions are called in order (based on the `order` option)
   * before event handlers. They can:
   * - Modify the transformed message
   * - Add metadata to the context
   * - Skip remaining middleware
   * - Skip handler execution entirely
   *
   * Middleware follows a Koa-style pattern where `next()` calls the next
   * middleware in the chain.
   *
   * @param middleware - The middleware function
   * @param options - Optional configuration for the middleware
   *
   * @returns A function to remove the middleware
   *
   * @throws {Error} If the router has been disposed
   *
   * @example Logging middleware
   * ```typescript
   * router.use(async (ctx, next) => {
   *   console.log(`[${ctx.event.operationType}] ${ctx.message.key}`)
   *   const start = Date.now()
   *   await next()
   *   console.log(`Processed in ${Date.now() - start}ms`)
   * }, { name: 'logger', order: 0 })
   * ```
   *
   * @example Validation middleware
   * ```typescript
   * router.use(async (ctx, next) => {
   *   if (!isValid(ctx.message.value)) {
   *     ctx.skipHandlers = true
   *     console.warn('Skipping invalid event:', ctx.message.key)
   *     return
   *   }
   *   await next()
   * }, {
   *   name: 'validator',
   *   operationTypes: ['insert', 'update'],
   * })
   * ```
   *
   * @example Transform middleware
   * ```typescript
   * router.use(async (ctx, next) => {
   *   // Enrich the message with computed data
   *   ctx.message = {
   *     ...ctx.message,
   *     metadata: {
   *       ...ctx.message.metadata,
   *       processedAt: Date.now(),
   *       priority: ctx.priority,
   *     },
   *   }
   *   await next()
   * }, { name: 'enricher' })
   * ```
   */
  use(middleware: Middleware<T>, options: MiddlewareOptions = {}): () => void {
    if (this.disposed) {
      throw new Error('Cannot register middleware on disposed router')
    }

    const id = this.nextHandlerId++
    const registered: RegisteredMiddleware<T> = {
      id,
      middleware,
      options: {
        name: options.name ?? `middleware-${id}`,
        order: options.order ?? this.middlewares.length,
        operationTypes: options.operationTypes,
      },
    }

    this.middlewares.push(registered)

    // Sort middleware by order
    this.middlewares.sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))

    return () => {
      const index = this.middlewares.findIndex((m) => m.id === id)
      if (index !== -1) {
        this.middlewares.splice(index, 1)
      }
    }
  }

  // ============================================================================
  // Event Routing
  // ============================================================================

  /**
   * Routes a change event to all matching handlers.
   *
   * This is the main entry point for processing events. The event goes through:
   * 1. Transformation to ChangeMessage format
   * 2. Middleware pipeline (if any middleware registered)
   * 3. Handler execution (for all matching handlers)
   *
   * If `preserveOrder` is enabled, events are processed sequentially.
   * Otherwise, events can be processed concurrently.
   *
   * @param event - The MongoDB change event to route
   * @param options - Optional queue options (used for priority and metadata)
   *
   * @throws {Error} If the router has been disposed
   * @throws {Error} If a handler fails and no error handling is configured
   *
   * @example Basic usage
   * ```typescript
   * await router.routeEvent({
   *   operationType: 'insert',
   *   fullDocument: { _id: 'user-123', name: 'John' },
   *   documentKey: { _id: 'user-123' },
   * })
   * ```
   *
   * @example With priority (when priority queue is disabled)
   * ```typescript
   * await router.routeEvent(event, { priority: 'high' })
   * ```
   */
  async routeEvent(event: MongoChangeEvent<T>, options?: QueueEventOptions): Promise<void> {
    if (this.disposed) {
      throw new Error('Cannot route events on disposed router')
    }

    const priority = options?.priority ?? this.config.defaultPriority
    const metadata = options?.metadata ?? {}
    const startTime = Date.now()

    const doRoute = async () => {
      const message = this.transformEvent(event)

      // Track metrics
      if (this.config.enableMetrics) {
        this.stats.totalEvents++
        const opType = event.operationType
        this.stats.eventsByType[opType] = (this.stats.eventsByType[opType] ?? 0) + 1
      }

      // Track priority metrics
      if (this.config.enableDetailedMetrics) {
        this.eventsByPriority[priority]++
      }

      // Create middleware context
      const context: MiddlewareContext<T> = {
        event,
        message,
        startTime,
        priority,
        metadata: { ...metadata },
        skipRemainingMiddleware: false,
        skipHandlers: false,
      }

      // Execute middleware pipeline
      let finalMessage = message
      if (this.middlewares.length > 0) {
        const result = await this.executeMiddlewarePipeline(context, event)
        if (result) {
          finalMessage = result.message ?? context.message
        } else {
          finalMessage = context.message
        }
      }

      // Skip handlers if middleware requested
      if (context.skipHandlers) {
        this.recordLatency(startTime)
        return
      }

      // Find matching handlers
      const matchingHandlers = this.handlers.filter((h) =>
        this.handlerMatchesEvent(h, event, finalMessage)
      )

      // Execute handlers
      const errors: Error[] = []
      for (const { handler } of matchingHandlers) {
        if (this.config.enableMetrics) {
          this.stats.handlerExecutions++
        }

        try {
          await handler(finalMessage)
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          errors.push(err)

          if (this.config.enableMetrics) {
            this.stats.errors++
          }

          if (this.config.errorHandler) {
            this.config.errorHandler(err, finalMessage)
          }
        }
      }

      // Record latency
      this.recordLatency(startTime)

      // If there were errors and no error handler, throw the first one
      if (errors.length > 0 && !this.config.errorHandler && !this.config.silentErrors) {
        throw errors[0]
      }
    }

    if (this.config.preserveOrder) {
      this.processingPromise = this.processingPromise.then(doRoute)
      await this.processingPromise
    } else {
      await doRoute()
    }
  }

  /**
   * Executes the middleware pipeline for an event.
   *
   * @param context - The middleware context
   * @param event - The original event (for operation type filtering)
   *
   * @returns The final middleware result, or undefined
   *
   * @internal
   */
  private async executeMiddlewarePipeline(
    context: MiddlewareContext<T>,
    event: MongoChangeEvent<T>
  ): Promise<MiddlewareResult<T> | void> {
    // Filter middleware by operation type
    const applicableMiddleware = this.middlewares.filter((m) => {
      if (!m.options.operationTypes) return true
      return m.options.operationTypes.includes(event.operationType)
    })

    if (applicableMiddleware.length === 0) {
      return
    }

    // Create the middleware chain
    let index = 0
    const executeNext = async (): Promise<MiddlewareResult<T> | void> => {
      if (index >= applicableMiddleware.length || context.skipRemainingMiddleware) {
        return
      }

      const current = applicableMiddleware[index++]

      if (this.config.enableDetailedMetrics) {
        this.middlewareExecutions++
      }

      try {
        const result = await current.middleware(context, executeNext)

        // Apply result to context
        if (result) {
          if (result.message) {
            context.message = result.message
          }
          if (result.metadata) {
            Object.assign(context.metadata, result.metadata)
          }
          if (result.skipRemainingMiddleware) {
            context.skipRemainingMiddleware = true
          }
          if (result.skipHandlers) {
            context.skipHandlers = true
          }
        }

        return result
      } catch (error) {
        if (this.config.enableDetailedMetrics) {
          this.middlewareErrors++
        }

        if (this.config.enableMetrics) {
          this.stats.errors++
        }

        const err = error instanceof Error ? error : new Error(String(error))
        if (this.config.errorHandler) {
          this.config.errorHandler(err, context.message)
        } else if (!this.config.silentErrors) {
          throw err
        }
      }
    }

    return executeNext()
  }

  // ============================================================================
  // Priority Queue
  // ============================================================================

  /**
   * Queues an event with a specific priority.
   *
   * Events are stored in a priority queue and processed in priority order.
   * Critical events are processed immediately, bypassing the queue.
   *
   * This method is only meaningful when `enablePriorityQueue` is true.
   * Otherwise, it falls back to `queueEvent()`.
   *
   * @param event - The MongoDB change event to queue
   * @param priority - The priority level for this event
   * @param metadata - Optional metadata to attach to the event
   *
   * @example
   * ```typescript
   * // Process order cancellation immediately
   * router.queueEventWithPriority(cancelEvent, 'critical')
   *
   * // Low priority inventory update
   * router.queueEventWithPriority(stockEvent, 'low')
   * ```
   */
  queueEventWithPriority(
    event: MongoChangeEvent<T>,
    priority: EventPriority,
    metadata: Record<string, unknown> = {}
  ): void {
    if (this.disposed) {
      return
    }

    // Critical events bypass the queue
    if (priority === 'critical') {
      this.routeEvent(event, { priority, metadata }).catch((err) => {
        if (this.config.errorHandler) {
          const message = this.transformEvent(event)
          this.config.errorHandler(err, message)
        }
      })
      return
    }

    if (!this.config.enablePriorityQueue) {
      // Fall back to regular batching
      this.queueEvent(event)
      return
    }

    const queuedEvent: QueuedEvent<T> = {
      event,
      priority,
      priorityValue: PRIORITY_VALUES[priority],
      queuedAt: Date.now(),
      metadata,
    }

    // Insert in priority order (binary search for efficiency)
    const insertIndex = this.findInsertIndex(queuedEvent)
    this.priorityQueue.splice(insertIndex, 0, queuedEvent)

    // Track peak queue size
    if (this.priorityQueue.length > this.peakQueueSize) {
      this.peakQueueSize = this.priorityQueue.length
    }

    // Process the queue
    this.processPriorityQueue()
  }

  /**
   * Finds the correct insertion index for a queued event to maintain priority order.
   *
   * Uses binary search for O(log n) insertion.
   *
   * @param event - The event to insert
   *
   * @returns The index where the event should be inserted
   *
   * @internal
   */
  private findInsertIndex(event: QueuedEvent<T>): number {
    let low = 0
    let high = this.priorityQueue.length

    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      // Higher priority values should come first
      if (this.priorityQueue[mid].priorityValue >= event.priorityValue) {
        low = mid + 1
      } else {
        high = mid
      }
    }

    return low
  }

  /**
   * Processes events from the priority queue.
   *
   * Events are processed in priority order (highest first).
   *
   * @internal
   */
  private async processPriorityQueue(): Promise<void> {
    while (this.priorityQueue.length > 0 && !this.disposed) {
      const queued = this.priorityQueue.shift()!

      try {
        await this.routeEvent(queued.event, {
          priority: queued.priority,
          metadata: queued.metadata,
        })
      } catch (error) {
        // Errors are handled by routeEvent
      }
    }
  }

  // ============================================================================
  // Event Batching
  // ============================================================================

  /**
   * Queues an event for batched processing.
   *
   * Events are accumulated in a batch and flushed when either:
   * - The batch size limit is reached
   * - The batch timeout expires
   * - `flushBatch()` is called manually
   *
   * @param event - The MongoDB change event to queue
   *
   * @example
   * ```typescript
   * // Queue multiple events for efficient batching
   * for (const event of events) {
   *   router.queueEvent(event)
   * }
   *
   * // Events will be flushed automatically based on config
   * // Or flush manually:
   * await router.flushBatch()
   * ```
   */
  queueEvent(event: MongoChangeEvent<T>): void {
    if (this.disposed) {
      return
    }

    const message = this.transformEvent(event)
    this.batchQueue.push(message)

    // Start timer if not already running
    if (!this.batchTimer && this.config.batchTimeoutMs > 0) {
      this.batchTimer = setTimeout(() => {
        this.flushBatch()
      }, this.config.batchTimeoutMs)
    }

    // Flush if batch size reached
    if (this.batchQueue.length >= this.config.batchSize) {
      this.flushBatch()
    }
  }

  /**
   * Flushes the current batch to all batch handlers.
   *
   * This method can be called manually to force batch processing,
   * or it is called automatically based on batch size and timeout.
   *
   * @example
   * ```typescript
   * // Queue some events
   * router.queueEvent(event1)
   * router.queueEvent(event2)
   *
   * // Force flush before waiting for timeout
   * await router.flushBatch()
   * ```
   */
  async flushBatch(): Promise<void> {
    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    // Get and clear queue
    const batch = this.batchQueue.splice(0)

    // Skip if empty
    if (batch.length === 0) {
      return
    }

    // Track batch metrics
    if (this.config.enableDetailedMetrics) {
      this.batchesProcessed++
      this.totalBatchedItems += batch.length
    }

    // Call batch handlers
    for (const { handler } of this.batchHandlers) {
      await handler(batch)
    }
  }

  // ============================================================================
  // Metrics and Statistics
  // ============================================================================

  /**
   * Records a latency sample for metrics.
   *
   * @param startTime - The timestamp when processing started
   *
   * @internal
   */
  private recordLatency(startTime: number): void {
    if (!this.config.enableDetailedMetrics) {
      return
    }

    const latency = Date.now() - startTime
    this.latencySamples.push(latency)

    // Keep samples within limit
    if (this.latencySamples.length > this.config.maxLatencySamples) {
      this.latencySamples.shift()
    }
  }

  /**
   * Calculates a percentile from the latency samples.
   *
   * @param percentile - The percentile to calculate (0-100)
   *
   * @returns The latency at the given percentile, or 0 if no samples
   *
   * @internal
   */
  private calculatePercentile(percentile: number): number {
    if (this.latencySamples.length === 0) {
      return 0
    }

    const sorted = [...this.latencySamples].sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }

  /**
   * Gets the current router statistics.
   *
   * Returns basic statistics when `enableMetrics` is true.
   * Use `getDetailedStats()` for comprehensive metrics.
   *
   * @returns The current statistics, or empty stats if metrics are disabled
   *
   * @example
   * ```typescript
   * const stats = router.getStats()
   * console.log(`Processed ${stats.totalEvents} events`)
   * console.log(`Errors: ${stats.errors}`)
   * console.log(`Inserts: ${stats.eventsByType.insert ?? 0}`)
   * ```
   */
  getStats(): RouterStats {
    if (!this.config.enableMetrics) {
      return {
        totalEvents: 0,
        eventsByType: {},
        handlerExecutions: 0,
        errors: 0,
      }
    }
    return { ...this.stats }
  }

  /**
   * Gets detailed router statistics including latency percentiles and throughput.
   *
   * Requires `enableDetailedMetrics` to be true for full data.
   *
   * @returns Comprehensive statistics including timing and queue metrics
   *
   * @example
   * ```typescript
   * const stats = router.getDetailedStats()
   *
   * console.log('Performance:')
   * console.log(`  P50 Latency: ${stats.p50LatencyMs}ms`)
   * console.log(`  P95 Latency: ${stats.p95LatencyMs}ms`)
   * console.log(`  P99 Latency: ${stats.p99LatencyMs}ms`)
   * console.log(`  Throughput: ${stats.throughputPerSecond.toFixed(2)} events/sec`)
   *
   * console.log('Queue:')
   * console.log(`  Current Size: ${stats.queueSize}`)
   * console.log(`  Peak Size: ${stats.peakQueueSize}`)
   *
   * console.log('By Priority:')
   * console.log(`  Critical: ${stats.eventsByPriority.critical}`)
   * console.log(`  High: ${stats.eventsByPriority.high}`)
   * console.log(`  Normal: ${stats.eventsByPriority.normal}`)
   * console.log(`  Low: ${stats.eventsByPriority.low}`)
   * ```
   */
  getDetailedStats(): DetailedRouterStats {
    const now = Date.now()
    const durationMs = now - this.metricsStartTime
    const durationSec = durationMs / 1000

    // Calculate latency stats
    let avgLatency = 0
    let minLatency = 0
    let maxLatency = 0

    if (this.latencySamples.length > 0) {
      const sum = this.latencySamples.reduce((a, b) => a + b, 0)
      avgLatency = sum / this.latencySamples.length
      minLatency = Math.min(...this.latencySamples)
      maxLatency = Math.max(...this.latencySamples)
    }

    return {
      // Basic stats
      totalEvents: this.stats.totalEvents,
      eventsByType: { ...this.stats.eventsByType },
      handlerExecutions: this.stats.handlerExecutions,
      errors: this.stats.errors,

      // Latency stats
      averageLatencyMs: avgLatency,
      minLatencyMs: minLatency,
      maxLatencyMs: maxLatency,
      p50LatencyMs: this.calculatePercentile(50),
      p95LatencyMs: this.calculatePercentile(95),
      p99LatencyMs: this.calculatePercentile(99),

      // Throughput
      throughputPerSecond: durationSec > 0 ? this.stats.totalEvents / durationSec : 0,

      // Queue stats
      queueSize: this.priorityQueue.length,
      peakQueueSize: this.peakQueueSize,

      // Priority stats
      eventsByPriority: { ...this.eventsByPriority },

      // Middleware stats
      middlewareExecutions: this.middlewareExecutions,
      middlewareErrors: this.middlewareErrors,

      // Collection info
      collectionStartedAt: this.metricsStartTime,
      collectionDurationMs: durationMs,

      // Batch stats
      batchesProcessed: this.batchesProcessed,
      averageBatchSize:
        this.batchesProcessed > 0 ? this.totalBatchedItems / this.batchesProcessed : 0,
    }
  }

  /**
   * Resets the router statistics.
   *
   * Clears all accumulated metrics and restarts the collection period.
   *
   * @example
   * ```typescript
   * // Process some events...
   * console.log(router.getStats().totalEvents) // e.g., 1000
   *
   * // Reset for a new measurement period
   * router.resetStats()
   * console.log(router.getStats().totalEvents) // 0
   * ```
   */
  resetStats(): void {
    this.stats = {
      totalEvents: 0,
      eventsByType: {},
      handlerExecutions: 0,
      errors: 0,
    }

    this.latencySamples = []
    this.eventsByPriority = { critical: 0, high: 0, normal: 0, low: 0 }
    this.middlewareExecutions = 0
    this.middlewareErrors = 0
    this.peakQueueSize = 0
    this.metricsStartTime = Date.now()
    this.batchesProcessed = 0
    this.totalBatchedItems = 0
  }

  // ============================================================================
  // Transformation
  // ============================================================================

  /**
   * The default transform function for converting events to messages.
   *
   * This method is publicly accessible so custom transform functions can
   * use it as a base and extend the result.
   *
   * @param event - The MongoDB change event
   *
   * @returns The transformed ChangeMessage
   *
   * @example Using in a custom transform
   * ```typescript
   * const router = new ChangeEventRouter<User>({
   *   transform: (event) => {
   *     const base = router.defaultTransform(event)
   *     return {
   *       ...base,
   *       metadata: {
   *         ...base.metadata,
   *         transformedAt: Date.now(),
   *       },
   *     }
   *   },
   * })
   * ```
   */
  defaultTransform(event: MongoChangeEvent<T>): ChangeMessage<T> {
    const key = this.extractKey(event)

    switch (event.operationType) {
      case 'insert':
        return {
          type: 'insert',
          key,
          value: event.fullDocument,
        }

      case 'update':
        return {
          type: 'update',
          key,
          value: event.fullDocument,
          metadata: {
            updatedFields: event.updateDescription.updatedFields,
            removedFields: event.updateDescription.removedFields,
          },
        }

      case 'delete':
        return {
          type: 'delete',
          key,
          value: { _id: key } as T, // Minimal placeholder for delete
        }

      case 'replace':
        return {
          type: 'update',
          key,
          value: event.fullDocument,
          metadata: {
            isReplace: true,
          },
        }
    }
  }

  /**
   * Transforms an event using the configured transform function or default.
   *
   * @param event - The MongoDB change event
   *
   * @returns The transformed ChangeMessage
   *
   * @internal
   */
  private transformEvent(event: MongoChangeEvent<T>): ChangeMessage<T> {
    if (this.config.transform) {
      return this.config.transform(event)
    }
    return this.defaultTransform(event)
  }

  /**
   * Extracts the key from an event using the configured extractor or default.
   *
   * @param event - The MongoDB change event
   *
   * @returns The document key string
   *
   * @internal
   */
  private extractKey(event: MongoChangeEvent<T>): string {
    if (this.config.getKey) {
      return this.config.getKey(event)
    }
    return event.documentKey._id
  }

  /**
   * Checks if a handler matches an event based on its options.
   *
   * @param registered - The registered handler
   * @param event - The MongoDB change event
   * @param message - The transformed message
   *
   * @returns True if the handler should receive the event
   *
   * @internal
   */
  private handlerMatchesEvent(
    registered: RegisteredHandler<T>,
    event: MongoChangeEvent<T>,
    message: ChangeMessage<T>
  ): boolean {
    const { options } = registered

    if (!options) {
      return true
    }

    // Check single operation type
    if (options.operationType && event.operationType !== options.operationType) {
      return false
    }

    // Check multiple operation types
    if (options.operationTypes && !options.operationTypes.includes(event.operationType)) {
      return false
    }

    // Check key prefix
    if (options.keyPrefix && !message.key.startsWith(options.keyPrefix)) {
      return false
    }

    // Check custom filter
    if (options.filter && !options.filter(event)) {
      return false
    }

    return true
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Disposes the router and cleans up resources.
   *
   * After disposal:
   * - All handlers and middleware are removed
   * - Pending batches are flushed
   * - Timers are cleared
   * - New events and registrations are rejected
   *
   * @example
   * ```typescript
   * const router = new ChangeEventRouter<User>({})
   *
   * // ... use the router ...
   *
   * // Clean up when done
   * router.dispose()
   * ```
   */
  dispose(): void {
    // Flush any pending batch
    if (this.batchQueue.length > 0) {
      this.flushBatch()
    }

    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    // Clear handlers and middleware
    this.handlers = []
    this.batchHandlers = []
    this.middlewares = []
    this.priorityQueue = []
    this.disposed = true
  }
}
