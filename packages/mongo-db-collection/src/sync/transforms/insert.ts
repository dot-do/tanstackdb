/**
 * @file Insert Event Transform
 *
 * Transforms MongoDB insert change stream events into TanStack DB ChangeMessage format.
 * This module provides type-safe, immutable transformations with support for composable
 * transform pipelines.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/transforms/insert
 *
 * @remarks
 * The transform system follows these principles:
 * - **Type Safety**: Full TypeScript support with generic document types
 * - **Immutability**: Input events are never modified; outputs are fresh objects
 * - **Composability**: Transform pipelines allow chaining multiple transformations
 * - **Validation**: Built-in type guards and validation for runtime safety
 *
 * @example Basic Usage
 * ```typescript
 * import { transformInsertEvent } from '@tanstack/mongo-db-collection'
 *
 * const event: MongoInsertEvent<User> = {
 *   operationType: 'insert',
 *   fullDocument: { _id: '123', name: 'John' },
 *   documentKey: { _id: '123' }
 * }
 *
 * const message = transformInsertEvent(event)
 * ```
 *
 * @example Using Transform Pipeline
 * ```typescript
 * import { transformInsertEvent, createInsertTransformPipeline } from '@tanstack/mongo-db-collection'
 *
 * const pipeline = createInsertTransformPipeline<User>()
 *   .addTransform((doc) => ({ ...doc, name: doc.name.toUpperCase() }))
 *   .addTransform((doc) => ({ ...doc, processed: true }))
 *
 * const message = transformInsertEvent(event, { pipeline })
 * ```
 */

import type { MongoInsertEvent, ChangeMessage } from '../../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Base constraint for documents that can be transformed.
 * All documents must have a string `_id` field.
 *
 * @typeParam T - The document type
 */
export type InsertDocumentConstraint = { _id: string }

/**
 * Function that transforms a document value.
 *
 * @typeParam T - The document type
 * @param doc - The document to transform
 * @returns The transformed document
 *
 * @remarks
 * Transform functions should be pure and return a new object rather than
 * modifying the input. The transform system creates a copy before calling
 * transformers, but transformers should still follow immutability patterns.
 *
 * @example
 * ```typescript
 * const uppercaseName: ValueTransformer<User> = (doc) => ({
 *   ...doc,
 *   name: doc.name.toUpperCase()
 * })
 * ```
 */
export type ValueTransformer<T> = (doc: T) => T

/**
 * Pipeline of value transformers that are applied in sequence.
 *
 * @typeParam T - The document type
 *
 * @remarks
 * Pipelines provide a composable way to apply multiple transformations
 * to a document. Each transformer receives the output of the previous one.
 *
 * @see {@link createInsertTransformPipeline}
 */
export interface InsertTransformPipeline<T> {
  /**
   * Array of transformer functions to apply in order.
   */
  readonly transforms: ReadonlyArray<ValueTransformer<T>>

  /**
   * Add a new transform to the pipeline.
   *
   * @param transform - The transform function to add
   * @returns A new pipeline with the transform added (immutable)
   */
  addTransform(transform: ValueTransformer<T>): InsertTransformPipeline<T>

  /**
   * Execute the pipeline on a document.
   *
   * @param doc - The document to transform
   * @returns The transformed document after applying all transforms
   */
  execute(doc: T): T
}

/**
 * Options for transforming MongoDB insert events.
 *
 * @typeParam T - The document type being transformed
 *
 * @remarks
 * Options allow customization of the transform process including:
 * - Custom key extraction
 * - Metadata injection
 * - Single value transformation
 * - Transform pipeline for composable transformations
 *
 * @example With metadata
 * ```typescript
 * const result = transformInsertEvent(event, {
 *   metadata: { source: 'api', version: 1 }
 * })
 * ```
 *
 * @example With custom key
 * ```typescript
 * const result = transformInsertEvent(event, {
 *   getKey: (doc) => `tenant:${doc.tenantId}:${doc._id}`
 * })
 * ```
 */
export interface InsertTransformOptions<T> {
  /**
   * Custom function to extract the key from the document.
   * Defaults to using `doc._id`.
   *
   * @remarks
   * The key is used to identify the document in TanStack DB's collection.
   * Custom key functions are useful for multi-tenant scenarios or when
   * you need composite keys.
   */
  getKey?: (doc: T) => string

  /**
   * Optional metadata to include in the change message.
   *
   * @remarks
   * Metadata is passed through to TanStack DB and can be used for
   * debugging, auditing, or application-specific purposes.
   */
  metadata?: Record<string, unknown>

  /**
   * Optional function to transform the document value.
   *
   * @deprecated Use `pipeline` for composable transformations
   * @remarks
   * For simple transformations, this function is applied to the document
   * before creating the change message. For complex scenarios, prefer
   * using the `pipeline` option.
   */
  transformValue?: ValueTransformer<T>

  /**
   * Optional transform pipeline for composable transformations.
   *
   * @remarks
   * When both `transformValue` and `pipeline` are provided, the pipeline
   * is applied first, then `transformValue` is applied to the result.
   */
  pipeline?: InsertTransformPipeline<T>
}

/**
 * Result of validating an insert event.
 * Used internally for type-safe validation flow.
 */
interface InsertValidationResult<T> {
  /** Whether the event is valid */
  readonly valid: boolean
  /** Error message if invalid */
  readonly error?: string
  /** The validated event (only present if valid) */
  readonly event?: MongoInsertEvent<T>
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a valid MongoDB insert event.
 *
 * This function performs runtime validation to ensure the value has
 * all required properties of a {@link MongoInsertEvent}.
 *
 * @typeParam T - The expected document type
 * @param value - The value to check
 * @returns `true` if value is a valid insert event, `false` otherwise
 *
 * @example
 * ```typescript
 * function handleEvent(event: unknown) {
 *   if (isValidInsertEvent<User>(event)) {
 *     // TypeScript knows event is MongoInsertEvent<User>
 *     const message = transformInsertEvent(event)
 *   }
 * }
 * ```
 *
 * @see {@link assertInsertEvent} for throwing version
 */
export function isValidInsertEvent<T extends InsertDocumentConstraint>(
  value: unknown
): value is MongoInsertEvent<T> {
  if (value === null || value === undefined) {
    return false
  }

  if (typeof value !== 'object') {
    return false
  }

  const event = value as Record<string, unknown>

  if (event.operationType !== 'insert') {
    return false
  }

  if (!event.fullDocument || typeof event.fullDocument !== 'object') {
    return false
  }

  if (!event.documentKey || typeof event.documentKey !== 'object') {
    return false
  }

  const documentKey = event.documentKey as Record<string, unknown>
  if (documentKey._id === undefined || documentKey._id === null) {
    return false
  }

  return true
}

/**
 * Type guard to check if a value has valid insert event structure (partial check).
 *
 * This is a lighter check than {@link isValidInsertEvent} that only verifies
 * the basic structure without deep validation.
 *
 * @typeParam T - The expected document type
 * @param value - The value to check
 * @returns `true` if value has insert event structure
 *
 * @internal
 */
export function hasInsertEventShape(
  value: unknown
): value is { operationType: string; fullDocument: unknown; documentKey: unknown } {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    'operationType' in value &&
    'fullDocument' in value &&
    'documentKey' in value
  )
}

/**
 * Assertion function that throws if the event is not a valid insert event.
 *
 * @typeParam T - The expected document type
 * @param event - The event to validate
 * @throws {TypeError} If the event is null or undefined
 * @throws {Error} If the event is not a valid insert event
 *
 * @example
 * ```typescript
 * function processEvent(event: unknown) {
 *   assertInsertEvent<User>(event)
 *   // TypeScript now knows event is MongoInsertEvent<User>
 *   console.log(event.fullDocument.name)
 * }
 * ```
 *
 * @see {@link isValidInsertEvent} for boolean check version
 */
export function assertInsertEvent<T extends InsertDocumentConstraint>(
  event: unknown
): asserts event is MongoInsertEvent<T> {
  if (event === null || event === undefined) {
    throw new TypeError('Insert event is required')
  }

  if (!hasInsertEventShape(event)) {
    throw new Error('Invalid event structure: missing required properties')
  }

  if (event.operationType !== 'insert') {
    throw new Error(
      `Invalid operation type: expected 'insert', got '${String(event.operationType)}'`
    )
  }

  if (!event.fullDocument) {
    throw new Error('Insert event must contain fullDocument')
  }

  if (!event.documentKey) {
    throw new Error('Insert event must contain documentKey')
  }

  const documentKey = event.documentKey as Record<string, unknown>
  if (documentKey._id === undefined || documentKey._id === null) {
    throw new Error('Insert event documentKey must contain _id')
  }
}

// ============================================================================
// Validation (Internal)
// ============================================================================

/**
 * Validates that the event is a valid MongoDB insert event.
 *
 * @param event - The event to validate
 * @throws {Error} If the event is invalid
 *
 * @internal
 * @deprecated Use {@link assertInsertEvent} instead
 */
function validateInsertEvent<T>(event: MongoInsertEvent<T>): void {
  assertInsertEvent<T & InsertDocumentConstraint>(event)
}

// ============================================================================
// Transform Pipeline
// ============================================================================

/**
 * Creates an immutable transform pipeline for insert events.
 *
 * A pipeline allows composing multiple transform functions that are applied
 * in sequence to a document. Each transform receives the output of the
 * previous transform.
 *
 * @typeParam T - The document type
 * @returns An empty pipeline that can be built using the fluent API
 *
 * @remarks
 * Pipelines are immutable - each `addTransform` call returns a new pipeline
 * instance. This ensures thread safety and predictable behavior.
 *
 * @example Basic pipeline
 * ```typescript
 * const pipeline = createInsertTransformPipeline<User>()
 *   .addTransform((doc) => ({ ...doc, name: doc.name.trim() }))
 *   .addTransform((doc) => ({ ...doc, createdAt: new Date() }))
 *
 * const result = pipeline.execute({ _id: '1', name: '  John  ' })
 * // { _id: '1', name: 'John', createdAt: Date }
 * ```
 *
 * @example Composing pipelines
 * ```typescript
 * const sanitizePipeline = createInsertTransformPipeline<User>()
 *   .addTransform((doc) => ({ ...doc, email: doc.email.toLowerCase() }))
 *
 * const enrichPipeline = createInsertTransformPipeline<User>()
 *   .addTransform((doc) => ({ ...doc, verified: false }))
 *
 * // Use in transform
 * const message = transformInsertEvent(event, {
 *   pipeline: sanitizePipeline.addTransform(enrichPipeline.execute.bind(enrichPipeline))
 * })
 * ```
 *
 * @see {@link InsertTransformPipeline}
 */
export function createInsertTransformPipeline<T>(): InsertTransformPipeline<T> {
  return createPipelineWithTransforms<T>([])
}

/**
 * Internal factory for creating pipeline instances with existing transforms.
 *
 * @typeParam T - The document type
 * @param transforms - Array of transform functions
 * @returns A new pipeline instance
 *
 * @internal
 */
function createPipelineWithTransforms<T>(
  transforms: ReadonlyArray<ValueTransformer<T>>
): InsertTransformPipeline<T> {
  return Object.freeze({
    transforms: Object.freeze([...transforms]),

    addTransform(transform: ValueTransformer<T>): InsertTransformPipeline<T> {
      return createPipelineWithTransforms([...transforms, transform])
    },

    execute(doc: T): T {
      return transforms.reduce<T>(
        (currentDoc, transform) => transform(currentDoc),
        doc
      )
    },
  })
}

// ============================================================================
// Immutability Helpers
// ============================================================================

/**
 * Creates a shallow frozen copy of an object.
 *
 * @typeParam T - The object type
 * @param obj - The object to copy and freeze
 * @returns A frozen shallow copy
 *
 * @internal
 */
function shallowFreeze<T extends object>(obj: T): Readonly<T> {
  return Object.freeze({ ...obj })
}

/**
 * Creates an immutable copy of the document for transformation.
 *
 * This function creates a shallow copy by default, which is sufficient
 * for most use cases. The original document is never modified.
 *
 * @typeParam T - The document type
 * @param doc - The document to copy
 * @returns An immutable copy of the document
 *
 * @internal
 */
function createImmutableCopy<T extends object>(doc: T): T {
  // Shallow copy is sufficient for immutability at the transform level
  // Deep copying would impact performance for large documents
  return { ...doc }
}

// ============================================================================
// Transform Function
// ============================================================================

/**
 * Transforms a MongoDB insert change stream event into a TanStack DB ChangeMessage.
 *
 * This function handles the conversion of MongoDB's insert event format
 * to the normalized ChangeMessage format used by TanStack DB for synchronization.
 *
 * @typeParam T - The document type (must have a string `_id` field)
 * @param event - The MongoDB insert event to transform
 * @param options - Optional transformation options
 * @returns A ChangeMessage representing the insert operation
 * @throws {TypeError} If the event is null or undefined
 * @throws {Error} If the event is invalid or missing required fields
 *
 * @remarks
 * The transform process follows these steps:
 * 1. Validate the input event
 * 2. Create an immutable copy of the document
 * 3. Apply pipeline transforms (if provided)
 * 4. Apply single value transform (if provided, deprecated)
 * 5. Build and return the ChangeMessage
 *
 * **Immutability Guarantees:**
 * - The original event is never modified
 * - The returned ChangeMessage contains a copy of the document
 * - Multiple calls with the same event produce independent results
 *
 * @example Basic transformation
 * ```typescript
 * const event: MongoInsertEvent<User> = {
 *   operationType: 'insert',
 *   fullDocument: { _id: '123', name: 'John' },
 *   documentKey: { _id: '123' }
 * }
 *
 * const message = transformInsertEvent(event)
 * // { type: 'insert', key: '123', value: { _id: '123', name: 'John' } }
 * ```
 *
 * @example With custom key extractor
 * ```typescript
 * const message = transformInsertEvent(event, {
 *   getKey: (doc) => `user:${doc._id}`
 * })
 * // { type: 'insert', key: 'user:123', value: { ... } }
 * ```
 *
 * @example With transform pipeline
 * ```typescript
 * const pipeline = createInsertTransformPipeline<User>()
 *   .addTransform((doc) => ({ ...doc, name: doc.name.toUpperCase() }))
 *
 * const message = transformInsertEvent(event, { pipeline })
 * // { type: 'insert', key: '123', value: { _id: '123', name: 'JOHN' } }
 * ```
 *
 * @example With metadata
 * ```typescript
 * const message = transformInsertEvent(event, {
 *   metadata: {
 *     source: 'change-stream',
 *     timestamp: Date.now(),
 *     clusterTime: '7300000000000000001'
 *   }
 * })
 * ```
 *
 * @see {@link InsertTransformOptions}
 * @see {@link createInsertTransformPipeline}
 * @see {@link assertInsertEvent}
 */
export function transformInsertEvent<T extends { _id: string }>(
  event: MongoInsertEvent<T>,
  options?: InsertTransformOptions<T>
): ChangeMessage<T> {
  // Validate the event using assertion
  validateInsertEvent(event)

  // Extract options with defaults
  const { getKey, transformValue, pipeline, metadata } = options ?? {}
  const keyExtractor = getKey ?? ((doc: T) => doc._id)

  // Create an immutable copy of the document
  let value: T = createImmutableCopy(event.fullDocument)

  // Apply pipeline transforms first (if provided)
  if (pipeline) {
    value = pipeline.execute(value)
  }

  // Apply single value transformation (deprecated, but still supported)
  if (transformValue) {
    value = transformValue(value)
  }

  // Build the change message immutably
  const result: ChangeMessage<T> = Object.freeze({
    type: 'insert' as const,
    key: keyExtractor(event.fullDocument),
    value,
    ...(metadata && { metadata: shallowFreeze(metadata) }),
  }) as ChangeMessage<T>

  return result
}
