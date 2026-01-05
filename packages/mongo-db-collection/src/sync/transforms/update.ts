/**
 * @file Update Event Transform
 *
 * Transforms MongoDB update change stream events into TanStack DB ChangeMessage format.
 * This module provides comprehensive support for handling update events including
 * partial updates, diff computation, and metadata enrichment.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/transforms/update
 */

import type { MongoUpdateEvent, ChangeMessage } from '../../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for transforming MongoDB update events.
 *
 * Provides fine-grained control over how update events are transformed,
 * including metadata inclusion and custom key extraction.
 *
 * @typeParam T - The document type being transformed
 *
 * @example
 * ```typescript
 * const options: UpdateEventTransformOptions<User> = {
 *   includeUpdateDescription: true,
 *   includeSource: true,
 *   getKey: (doc) => `user:${doc._id}`,
 *   customMetadata: { database: 'production' }
 * }
 * ```
 */
export interface UpdateEventTransformOptions<T> {
  /**
   * Custom function to extract the key from the document.
   * Defaults to using `doc._id`.
   *
   * @example
   * ```typescript
   * getKey: (doc) => doc.sku // Use SKU instead of _id
   * getKey: (doc) => `${doc.category}:${doc._id}` // Compound key
   * ```
   */
  getKey?: (doc: T) => string

  /**
   * When true, includes the MongoDB updateDescription in metadata.
   * This contains updatedFields and removedFields from the change event.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // With includeUpdateDescription: true
   * {
   *   metadata: {
   *     updateDescription: {
   *       updatedFields: { name: 'New Name' },
   *       removedFields: ['oldField']
   *     }
   *   }
   * }
   * ```
   */
  includeUpdateDescription?: boolean

  /**
   * When true, includes the source identifier in metadata.
   * Sets `metadata.source` to 'mongodb-change-stream'.
   *
   * @default false
   */
  includeSource?: boolean

  /**
   * When true, includes a timestamp in metadata.
   * Sets `metadata.timestamp` to the current timestamp (Date.now()).
   *
   * @default false
   */
  includeTimestamp?: boolean

  /**
   * When true, includes the operation type in metadata.
   * Sets `metadata.operationType` to 'update'.
   *
   * @default false
   */
  includeOperationType?: boolean

  /**
   * Custom metadata to merge into the result's metadata object.
   * These values are merged alongside any automatically generated metadata.
   *
   * @example
   * ```typescript
   * customMetadata: {
   *   collectionName: 'users',
   *   database: 'myapp',
   *   environment: 'production'
   * }
   * ```
   */
  customMetadata?: Record<string, unknown>
}

/**
 * Result type for the update event transformation.
 *
 * Extends ChangeMessage with a fixed 'update' type discriminator,
 * providing stronger typing for update-specific operations.
 *
 * @typeParam T - The document type
 *
 * @example
 * ```typescript
 * const result: UpdateEventTransformResult<User> = transformUpdateEvent(event)
 * result.type // Always 'update'
 * result.value // User
 * ```
 */
export interface UpdateEventTransformResult<T> extends ChangeMessage<T> {
  /** Always 'update' for update event transforms */
  type: 'update'
}

/**
 * Metadata structure for update description information.
 *
 * @typeParam T - The document type
 */
export interface UpdateDescriptionMetadata<T> {
  /**
   * Fields that were updated with their new values.
   * May include dot-notation paths for nested fields.
   */
  updatedFields: Partial<T>

  /**
   * Array of field names that were removed from the document.
   * Uses dot notation for nested fields (e.g., 'address.city').
   */
  removedFields: string[]
}

// ============================================================================
// Diff Computation Helpers
// ============================================================================

/**
 * Extracts the list of changed field paths from an update description.
 *
 * Combines both updated and removed fields into a single array of
 * field paths that were modified during the update operation.
 *
 * @typeParam T - The document type
 * @param updateDescription - The MongoDB update description
 * @returns Array of field paths that were changed
 *
 * @example
 * ```typescript
 * const changed = getChangedFields({
 *   updatedFields: { name: 'New', 'settings.theme': 'dark' },
 *   removedFields: ['oldField']
 * })
 * // ['name', 'settings.theme', 'oldField']
 * ```
 */
export function getChangedFields<T>(
  updateDescription: { updatedFields: Partial<T>; removedFields: string[] }
): string[] {
  const updatedPaths = Object.keys(updateDescription.updatedFields)
  const removedPaths = updateDescription.removedFields
  return [...updatedPaths, ...removedPaths]
}

/**
 * Checks if a specific field was modified in the update.
 *
 * @typeParam T - The document type
 * @param updateDescription - The MongoDB update description
 * @param fieldPath - The field path to check (supports dot notation)
 * @returns True if the field was updated or removed
 *
 * @example
 * ```typescript
 * const desc = { updatedFields: { name: 'New' }, removedFields: ['email'] }
 * wasFieldModified(desc, 'name')  // true
 * wasFieldModified(desc, 'email') // true
 * wasFieldModified(desc, 'age')   // false
 * ```
 */
export function wasFieldModified<T>(
  updateDescription: { updatedFields: Partial<T>; removedFields: string[] },
  fieldPath: string
): boolean {
  const hasUpdated = fieldPath in updateDescription.updatedFields
  const hasRemoved = updateDescription.removedFields.includes(fieldPath)
  return hasUpdated || hasRemoved
}

/**
 * Checks if a field was updated (modified with a new value).
 *
 * @typeParam T - The document type
 * @param updateDescription - The MongoDB update description
 * @param fieldPath - The field path to check
 * @returns True if the field has a new value
 *
 * @example
 * ```typescript
 * const desc = { updatedFields: { name: 'New' }, removedFields: [] }
 * wasFieldUpdated(desc, 'name') // true
 * ```
 */
export function wasFieldUpdated<T>(
  updateDescription: { updatedFields: Partial<T>; removedFields: string[] },
  fieldPath: string
): boolean {
  return fieldPath in updateDescription.updatedFields
}

/**
 * Checks if a field was removed from the document.
 *
 * @typeParam T - The document type
 * @param updateDescription - The MongoDB update description
 * @param fieldPath - The field path to check
 * @returns True if the field was removed
 *
 * @example
 * ```typescript
 * const desc = { updatedFields: {}, removedFields: ['deletedField'] }
 * wasFieldRemoved(desc, 'deletedField') // true
 * ```
 */
export function wasFieldRemoved<T>(
  updateDescription: { updatedFields: Partial<T>; removedFields: string[] },
  fieldPath: string
): boolean {
  return updateDescription.removedFields.includes(fieldPath)
}

/**
 * Gets the count of fields that were modified.
 *
 * @typeParam T - The document type
 * @param updateDescription - The MongoDB update description
 * @returns Total count of updated and removed fields
 *
 * @example
 * ```typescript
 * const desc = { updatedFields: { a: 1, b: 2 }, removedFields: ['c'] }
 * getModifiedFieldCount(desc) // 3
 * ```
 */
export function getModifiedFieldCount<T>(
  updateDescription: { updatedFields: Partial<T>; removedFields: string[] }
): number {
  return (
    Object.keys(updateDescription.updatedFields).length +
    updateDescription.removedFields.length
  )
}

/**
 * Checks if the update only affected nested fields within a parent path.
 *
 * Useful for determining if an update was scoped to a specific section
 * of the document.
 *
 * @typeParam T - The document type
 * @param updateDescription - The MongoDB update description
 * @param parentPath - The parent path to check
 * @returns True if all changes are within the parent path
 *
 * @example
 * ```typescript
 * const desc = {
 *   updatedFields: { 'settings.theme': 'dark', 'settings.notifications': true },
 *   removedFields: []
 * }
 * isNestedUpdate(desc, 'settings') // true
 * isNestedUpdate(desc, 'profile')  // false
 * ```
 */
export function isNestedUpdate<T>(
  updateDescription: { updatedFields: Partial<T>; removedFields: string[] },
  parentPath: string
): boolean {
  const allPaths = getChangedFields(updateDescription)
  if (allPaths.length === 0) return false

  const prefix = parentPath + '.'
  return allPaths.every(
    (path) => path === parentPath || path.startsWith(prefix)
  )
}

/**
 * Extracts only the updated field values (not removed fields).
 *
 * @typeParam T - The document type
 * @param updateDescription - The MongoDB update description
 * @returns Object containing only the fields that were updated with their new values
 *
 * @example
 * ```typescript
 * const desc = { updatedFields: { name: 'New', age: 30 }, removedFields: ['email'] }
 * getUpdatedValues(desc) // { name: 'New', age: 30 }
 * ```
 */
export function getUpdatedValues<T>(
  updateDescription: { updatedFields: Partial<T>; removedFields: string[] }
): Partial<T> {
  return { ...updateDescription.updatedFields }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates that the event is a valid MongoDB update event.
 *
 * @param event - The event to validate
 * @throws {Error} If the event is invalid
 *
 * @internal
 */
function validateUpdateEvent<T>(event: MongoUpdateEvent<T>): void {
  if (event === null || event === undefined) {
    throw new Error('Update event is required')
  }

  if (event.operationType !== 'update') {
    throw new Error(
      `Invalid operation type: expected 'update', got '${event.operationType}'`
    )
  }

  if (!event.fullDocument) {
    throw new Error('Update event must contain fullDocument')
  }

  if (!event.documentKey) {
    throw new Error('Update event must contain documentKey')
  }

  if (event.documentKey._id === undefined || event.documentKey._id === null) {
    throw new Error('Update event documentKey must contain _id')
  }

  if (!event.updateDescription) {
    throw new Error('Update event must contain updateDescription')
  }
}

// ============================================================================
// Transform Function
// ============================================================================

/**
 * Transforms a MongoDB update change stream event into a TanStack DB ChangeMessage.
 *
 * This function handles the conversion of MongoDB's update event format
 * to the normalized ChangeMessage format used by TanStack DB for synchronization.
 * It supports partial updates through the updateDescription metadata and provides
 * flexible key extraction and metadata enrichment options.
 *
 * @typeParam T - The document type (must have a string `_id` field)
 * @param event - The MongoDB update event to transform
 * @param options - Optional transformation options
 * @returns A ChangeMessage representing the update operation
 * @throws {Error} If the event is invalid or missing required fields
 *
 * @example Basic usage
 * ```typescript
 * const event: MongoUpdateEvent<User> = {
 *   operationType: 'update',
 *   fullDocument: { _id: '123', name: 'John Updated', email: 'john@example.com' },
 *   documentKey: { _id: '123' },
 *   updateDescription: {
 *     updatedFields: { name: 'John Updated' },
 *     removedFields: []
 *   }
 * }
 *
 * const message = transformUpdateEvent(event)
 * // { type: 'update', key: '123', value: { _id: '123', name: 'John Updated', ... } }
 * ```
 *
 * @example With custom key extractor
 * ```typescript
 * const message = transformUpdateEvent(event, {
 *   getKey: (doc) => `user:${doc._id}`
 * })
 * // { type: 'update', key: 'user:123', value: { ... } }
 * ```
 *
 * @example With update description metadata
 * ```typescript
 * const message = transformUpdateEvent(event, {
 *   includeUpdateDescription: true
 * })
 * // {
 * //   type: 'update',
 * //   key: '123',
 * //   value: { ... },
 * //   metadata: {
 * //     updateDescription: {
 * //       updatedFields: { name: 'John Updated' },
 * //       removedFields: []
 * //     }
 * //   }
 * // }
 * ```
 *
 * @example With all metadata options
 * ```typescript
 * const message = transformUpdateEvent(event, {
 *   includeUpdateDescription: true,
 *   includeSource: true,
 *   includeTimestamp: true,
 *   includeOperationType: true,
 *   customMetadata: { collection: 'users' }
 * })
 * // {
 * //   type: 'update',
 * //   key: '123',
 * //   value: { ... },
 * //   metadata: {
 * //     updateDescription: { ... },
 * //     source: 'mongodb-change-stream',
 * //     timestamp: 1704067200000,
 * //     operationType: 'update',
 * //     collection: 'users'
 * //   }
 * // }
 * ```
 *
 * @see {@link UpdateEventTransformOptions} for available options
 * @see {@link UpdateEventTransformResult} for the return type
 * @see {@link getChangedFields} for extracting changed field paths
 */
export function transformUpdateEvent<T extends { _id: string }>(
  event: MongoUpdateEvent<T>,
  options?: UpdateEventTransformOptions<T>
): UpdateEventTransformResult<T> {
  // Validate the event
  validateUpdateEvent(event)

  // Extract key using custom function or default to documentKey._id
  const getKey = options?.getKey ?? ((doc: T) => doc._id)
  const key = getKey(event.fullDocument)

  // Build the base result
  const result: UpdateEventTransformResult<T> = {
    type: 'update',
    key,
    value: event.fullDocument,
  }

  // Build metadata if any options are enabled
  const metadata: Record<string, unknown> = {}
  let hasMetadata = false

  // Include update description if requested
  if (options?.includeUpdateDescription) {
    metadata.updateDescription = {
      updatedFields: event.updateDescription.updatedFields,
      removedFields: event.updateDescription.removedFields,
    }
    hasMetadata = true
  }

  // Include source identifier if requested
  if (options?.includeSource) {
    metadata.source = 'mongodb-change-stream'
    hasMetadata = true
  }

  // Include timestamp if requested
  if (options?.includeTimestamp) {
    metadata.timestamp = Date.now()
    hasMetadata = true
  }

  // Include operation type if requested
  if (options?.includeOperationType) {
    metadata.operationType = 'update'
    hasMetadata = true
  }

  // Merge custom metadata if provided
  if (options?.customMetadata) {
    Object.assign(metadata, options.customMetadata)
    hasMetadata = true
  }

  // Only add metadata to result if we have any
  if (hasMetadata) {
    result.metadata = metadata
  }

  return result
}

// ============================================================================
// Partial Update Helpers
// ============================================================================

/**
 * Creates a partial update message that only includes the changed fields.
 *
 * Useful when you want to sync only the delta rather than the full document.
 * This can reduce payload size for large documents with small changes.
 *
 * @typeParam T - The document type
 * @param event - The MongoDB update event
 * @param options - Optional transformation options
 * @returns A change message with only the updated fields in the value
 *
 * @example
 * ```typescript
 * const event: MongoUpdateEvent<User> = {
 *   operationType: 'update',
 *   fullDocument: { _id: '123', name: 'John', email: 'john@example.com', age: 30 },
 *   documentKey: { _id: '123' },
 *   updateDescription: {
 *     updatedFields: { name: 'John Updated' },
 *     removedFields: []
 *   }
 * }
 *
 * const partialMessage = createPartialUpdateMessage(event)
 * // {
 * //   type: 'update',
 * //   key: '123',
 * //   value: { _id: '123', name: 'John Updated' },
 * //   metadata: { isPartial: true, removedFields: [] }
 * // }
 * ```
 */
export function createPartialUpdateMessage<T extends { _id: string }>(
  event: MongoUpdateEvent<T>,
  options?: Pick<UpdateEventTransformOptions<T>, 'getKey'>
): UpdateEventTransformResult<Partial<T> & { _id: string }> {
  // Validate the event
  validateUpdateEvent(event)

  // Extract key
  const getKey = options?.getKey ?? ((doc: T) => doc._id)
  const key = getKey(event.fullDocument)

  // Build partial value with only changed fields and _id
  const partialValue: Partial<T> & { _id: string } = {
    _id: event.fullDocument._id,
    ...event.updateDescription.updatedFields,
  }

  return {
    type: 'update',
    key,
    value: partialValue,
    metadata: {
      isPartial: true,
      removedFields: event.updateDescription.removedFields,
    },
  }
}

/**
 * Checks if an update event represents a significant change.
 *
 * A significant change is one that modifies at least one field.
 * Empty updates (no fields updated or removed) are not significant.
 *
 * @typeParam T - The document type
 * @param event - The MongoDB update event
 * @returns True if the update has at least one changed field
 *
 * @example
 * ```typescript
 * // Significant update
 * const event1 = {
 *   updateDescription: { updatedFields: { name: 'New' }, removedFields: [] }
 * }
 * isSignificantUpdate(event1) // true
 *
 * // Empty update (not significant)
 * const event2 = {
 *   updateDescription: { updatedFields: {}, removedFields: [] }
 * }
 * isSignificantUpdate(event2) // false
 * ```
 */
export function isSignificantUpdate<T>(event: MongoUpdateEvent<T>): boolean {
  return getModifiedFieldCount(event.updateDescription) > 0
}

/**
 * Filters an update event to only include changes to specified fields.
 *
 * Useful for creating targeted sync messages that only care about
 * specific field changes.
 *
 * @typeParam T - The document type
 * @param event - The MongoDB update event
 * @param fieldPaths - Array of field paths to include
 * @returns Object with filtered updated and removed fields
 *
 * @example
 * ```typescript
 * const event = {
 *   updateDescription: {
 *     updatedFields: { name: 'New', email: 'new@example.com', age: 30 },
 *     removedFields: ['oldField', 'settings.theme']
 *   }
 * }
 *
 * const filtered = filterUpdateFields(event, ['name', 'settings.theme'])
 * // {
 * //   updatedFields: { name: 'New' },
 * //   removedFields: ['settings.theme']
 * // }
 * ```
 */
export function filterUpdateFields<T>(
  event: MongoUpdateEvent<T>,
  fieldPaths: string[]
): { updatedFields: Partial<T>; removedFields: string[] } {
  const fieldSet = new Set(fieldPaths)

  const filteredUpdated: Partial<T> = {}
  for (const [key, value] of Object.entries(event.updateDescription.updatedFields)) {
    if (fieldSet.has(key)) {
      (filteredUpdated as Record<string, unknown>)[key] = value
    }
  }

  const filteredRemoved = event.updateDescription.removedFields.filter(
    (field) => fieldSet.has(field)
  )

  return {
    updatedFields: filteredUpdated,
    removedFields: filteredRemoved,
  }
}
