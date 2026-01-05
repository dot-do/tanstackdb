/**
 * @file Replace Event Transform
 *
 * Transforms MongoDB replace change stream events into TanStack DB ChangeMessage format.
 *
 * A MongoDB replace event occurs when a document is completely replaced using operations
 * like `replaceOne()` or `findOneAndReplace()`. Unlike update events which modify specific
 * fields, replace events completely overwrite the existing document with a new one.
 *
 * In TanStack DB, replace operations are mapped to the 'update' change type since the
 * document still exists but has entirely new content.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/transforms/replace
 */

import type { MongoReplaceEvent, ChangeMessage } from '../../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Represents the difference between two document versions.
 *
 * This interface captures the granular changes between the previous
 * and current versions of a replaced document.
 *
 * @typeParam T - The document type
 */
export interface DocumentDiff<T> {
  /**
   * Fields that were added in the new document (not present in previous).
   */
  addedFields: Partial<T>

  /**
   * Fields that were removed from the document (present in previous, not in new).
   */
  removedFields: (keyof T)[]

  /**
   * Fields that were modified (present in both but with different values).
   */
  modifiedFields: Partial<T>

  /**
   * Fields that remained unchanged between versions.
   */
  unchangedFields: (keyof T)[]
}

/**
 * Options for transforming MongoDB replace events.
 *
 * @typeParam T - The document type being transformed
 *
 * @example
 * ```typescript
 * const options: ReplaceTransformOptions<User> = {
 *   getKey: (doc) => `user:${doc._id}`,
 *   includePreviousValue: true,
 *   previousValue: previousUserState,
 *   generateDiff: true,
 * }
 * ```
 */
export interface ReplaceTransformOptions<T> {
  /**
   * Custom function to extract the key from the document.
   * Defaults to using `doc._id`.
   *
   * @param doc - The full document from the replace event
   * @returns The key string for the change message
   *
   * @example
   * ```typescript
   * getKey: (doc) => `tenant:${doc.tenantId}:users:${doc._id}`
   * ```
   */
  getKey?: (doc: T) => string

  /**
   * Optional metadata to include in the change message.
   * Useful for tracking event source, timestamps, or custom application data.
   *
   * @example
   * ```typescript
   * metadata: {
   *   source: 'mongodb-change-stream',
   *   timestamp: Date.now(),
   *   operationId: event.operationDescription?.operationId
   * }
   * ```
   */
  metadata?: Record<string, unknown>

  /**
   * Optional function to transform the document value before including
   * it in the change message. Useful for data normalization, filtering
   * sensitive fields, or adding computed properties.
   *
   * @param doc - The original document
   * @returns The transformed document
   *
   * @example
   * ```typescript
   * transformValue: (doc) => ({
   *   ...doc,
   *   fullName: `${doc.firstName} ${doc.lastName}`,
   *   passwordHash: undefined // Remove sensitive data
   * })
   * ```
   */
  transformValue?: (doc: T) => T

  /**
   * When true, includes the previous document value in the change message.
   * Requires `previousValue` to be provided.
   *
   * @default false
   */
  includePreviousValue?: boolean

  /**
   * The previous state of the document before replacement.
   * Required when `includePreviousValue` is true.
   *
   * This is typically obtained from:
   * - A local cache/store
   * - The `fullDocumentBeforeChange` option in MongoDB 6.0+ change streams
   * - A pre-image collection
   */
  previousValue?: T

  /**
   * When true, generates a diff between the previous and current document.
   * Requires `previousValue` to be provided.
   *
   * The diff is included in the metadata under the `diff` key.
   *
   * @default false
   */
  generateDiff?: boolean
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates that the event is a valid MongoDB replace event.
 *
 * @param event - The event to validate
 * @throws {Error} If the event is null, undefined, or has invalid structure
 *
 * @internal
 */
function validateReplaceEvent<T>(event: MongoReplaceEvent<T>): void {
  if (event === null || event === undefined) {
    throw new Error('Replace event is required')
  }

  if (event.operationType !== 'replace') {
    throw new Error(
      `Invalid operation type: expected 'replace', got '${event.operationType}'`
    )
  }

  if (!event.fullDocument) {
    throw new Error('Replace event must contain fullDocument')
  }

  if (!event.documentKey) {
    throw new Error('Replace event must contain documentKey')
  }

  if (event.documentKey._id === undefined || event.documentKey._id === null) {
    throw new Error('Replace event documentKey must contain _id')
  }
}

// ============================================================================
// Diff Generation
// ============================================================================

/**
 * Generates a diff between two document versions.
 *
 * Compares the previous and current document states to identify:
 * - Fields that were added
 * - Fields that were removed
 * - Fields that were modified
 * - Fields that remained unchanged
 *
 * @typeParam T - The document type
 * @param previous - The previous document state
 * @param current - The current document state
 * @returns A DocumentDiff object describing the changes
 *
 * @example
 * ```typescript
 * const diff = generateDocumentDiff(
 *   { _id: '1', name: 'Old', count: 10, removed: true },
 *   { _id: '1', name: 'New', count: 10, added: true }
 * )
 * // diff.addedFields = { added: true }
 * // diff.removedFields = ['removed']
 * // diff.modifiedFields = { name: 'New' }
 * // diff.unchangedFields = ['_id', 'count']
 * ```
 */
export function generateDocumentDiff<T extends object>(
  previous: T,
  current: T
): DocumentDiff<T> {
  const addedFields: Partial<T> = {}
  const removedFields: (keyof T)[] = []
  const modifiedFields: Partial<T> = {}
  const unchangedFields: (keyof T)[] = []

  const previousKeys = new Set(Object.keys(previous) as (keyof T)[])
  const currentKeys = new Set(Object.keys(current) as (keyof T)[])

  // Find added fields (in current but not in previous)
  for (const key of currentKeys) {
    if (!previousKeys.has(key)) {
      addedFields[key] = current[key]
    }
  }

  // Find removed fields (in previous but not in current)
  for (const key of previousKeys) {
    if (!currentKeys.has(key)) {
      removedFields.push(key)
    }
  }

  // Find modified and unchanged fields (in both)
  for (const key of previousKeys) {
    if (currentKeys.has(key)) {
      const prevValue = previous[key]
      const currValue = current[key]

      if (deepEqual(prevValue, currValue)) {
        unchangedFields.push(key)
      } else {
        modifiedFields[key] = currValue
      }
    }
  }

  return {
    addedFields,
    removedFields,
    modifiedFields,
    unchangedFields,
  }
}

/**
 * Deep equality comparison for values.
 *
 * Handles primitives, arrays, objects, dates, and null/undefined.
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns true if values are deeply equal
 *
 * @internal
 */
function deepEqual(a: unknown, b: unknown): boolean {
  // Handle identical references and primitives
  if (a === b) return true

  // Handle null/undefined
  if (a === null || b === null) return a === b
  if (a === undefined || b === undefined) return a === b

  // Handle different types
  if (typeof a !== typeof b) return false

  // Handle dates
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }

  // Handle objects
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>
    const bObj = b as Record<string, unknown>
    const aKeys = Object.keys(aObj)
    const bKeys = Object.keys(bObj)

    if (aKeys.length !== bKeys.length) return false

    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false
      if (!deepEqual(aObj[key], bObj[key])) return false
    }
    return true
  }

  return false
}

// ============================================================================
// Transform Function
// ============================================================================

/**
 * Transforms a MongoDB replace change stream event into a TanStack DB ChangeMessage.
 *
 * This function handles the conversion of MongoDB's replace event format
 * to the normalized ChangeMessage format used by TanStack DB for synchronization.
 * Replace events are mapped to 'update' type since the document exists but has
 * entirely new content.
 *
 * @typeParam T - The document type (must have a string `_id` field)
 * @param event - The MongoDB replace event to transform
 * @param options - Optional transformation options
 * @returns A ChangeMessage representing the replace operation as an update
 * @throws {Error} If the event is invalid or missing required fields
 *
 * @example Basic usage
 * ```typescript
 * const event: MongoReplaceEvent<User> = {
 *   operationType: 'replace',
 *   fullDocument: { _id: '123', name: 'John Updated', email: 'john@new.com' },
 *   documentKey: { _id: '123' }
 * }
 *
 * const message = transformReplaceEvent(event)
 * // {
 * //   type: 'update',
 * //   key: '123',
 * //   value: { _id: '123', name: 'John Updated', email: 'john@new.com' }
 * // }
 * ```
 *
 * @example With custom key extractor
 * ```typescript
 * const message = transformReplaceEvent(event, {
 *   getKey: (doc) => `user:${doc._id}`
 * })
 * // { type: 'update', key: 'user:123', value: { ... } }
 * ```
 *
 * @example With previous value tracking
 * ```typescript
 * const previousUser = await cache.get('user:123')
 *
 * const message = transformReplaceEvent(event, {
 *   includePreviousValue: true,
 *   previousValue: previousUser
 * })
 * // {
 * //   type: 'update',
 * //   key: '123',
 * //   value: { ... },
 * //   previousValue: { _id: '123', name: 'John', email: 'john@old.com' }
 * // }
 * ```
 *
 * @example With diff generation
 * ```typescript
 * const message = transformReplaceEvent(event, {
 *   previousValue: previousUser,
 *   generateDiff: true
 * })
 * // {
 * //   type: 'update',
 * //   key: '123',
 * //   value: { ... },
 * //   metadata: {
 * //     diff: {
 * //       addedFields: {},
 * //       removedFields: [],
 * //       modifiedFields: { name: 'John Updated', email: 'john@new.com' },
 * //       unchangedFields: ['_id']
 * //     }
 * //   }
 * // }
 * ```
 *
 * @see {@link ReplaceTransformOptions} for available options
 * @see {@link generateDocumentDiff} for diff generation details
 */
export function transformReplaceEvent<T extends { _id: string }>(
  event: MongoReplaceEvent<T>,
  options?: ReplaceTransformOptions<T>
): ChangeMessage<T> {
  // Validate the event
  validateReplaceEvent(event)

  // Extract options with defaults
  const getKey = options?.getKey ?? ((doc: T) => doc._id)
  const transformValue = options?.transformValue

  // Create a shallow copy of the document to maintain immutability
  const documentCopy = { ...event.fullDocument }

  // Apply value transformation if provided
  const value = transformValue ? transformValue(documentCopy) : documentCopy

  // Build the change message
  const result: ChangeMessage<T> = {
    type: 'update', // Replace is semantically an update (document still exists)
    key: getKey(event.fullDocument),
    value,
  }

  // Add previousValue if requested and available
  if (options?.includePreviousValue && options.previousValue !== undefined) {
    result.previousValue = { ...options.previousValue }
  }

  // Build metadata
  const metadata: Record<string, unknown> = {}

  // Add user-provided metadata
  if (options?.metadata) {
    Object.assign(metadata, options.metadata)
  }

  // Generate and add diff if requested
  if (options?.generateDiff && options.previousValue !== undefined) {
    metadata.diff = generateDocumentDiff(options.previousValue, documentCopy)
  }

  // Only include metadata if there's something to include
  if (Object.keys(metadata).length > 0) {
    result.metadata = metadata
  }

  return result
}
