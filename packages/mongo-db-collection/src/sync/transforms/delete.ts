/**
 * @file Delete Event Transform
 *
 * Transforms MongoDB delete change stream events into TanStack DB DeleteKeyMessage format.
 *
 * Delete events are unique in MongoDB change streams because they do NOT contain
 * the full document (it's already been deleted). They only provide the documentKey
 * with the _id of the deleted document. This module provides utilities for:
 *
 * - Transforming hard deletes to DeleteKeyMessage
 * - Supporting soft deletes with tombstone generation
 * - Consistent key extraction and handling
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/transforms/delete
 */

import type { MongoDeleteEvent, ChangeMessage } from '../../types/events.js'
import type { DeleteKeyMessage } from '@tanstack/db'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for transforming MongoDB delete events.
 *
 * @typeParam T - The document type that was deleted
 */
export interface DeleteTransformOptions<T extends object> {
  /**
   * Custom function to transform the document _id into a custom key.
   * Defaults to using the _id directly.
   *
   * @example
   * ```typescript
   * { getKey: (id) => `users/${id}` }
   * ```
   */
  getKey?: (id: string) => string

  /**
   * When true, generates a soft delete (tombstone) instead of a hard delete.
   * Returns a ChangeMessage with type 'update' and a tombstone value.
   *
   * @default false
   */
  softDelete?: boolean

  /**
   * Factory function to generate a tombstone value for soft deletes.
   * Only used when softDelete is true.
   * If not provided, uses {@link createDefaultTombstone}.
   *
   * @example
   * ```typescript
   * {
   *   softDelete: true,
   *   createTombstone: (id) => ({
   *     _id: id,
   *     _deleted: true,
   *     _deletedAt: new Date().toISOString()
   *   })
   * }
   * ```
   */
  createTombstone?: (id: string) => T

  /**
   * Optional metadata to include in the message.
   * Useful for tracking deletion source, timestamps, or audit information.
   */
  metadata?: Record<string, unknown>
}

/**
 * Result type for delete transformation.
 *
 * When softDelete is false (default), returns a DeleteKeyMessage.
 * When softDelete is true, returns a ChangeMessage with type 'update'.
 *
 * @typeParam T - The document type
 */
export type DeleteTransformResult<T extends object> =
  | DeleteKeyMessage<string>
  | ChangeMessage<T>

/**
 * Interface for a tombstone document marker.
 *
 * Tombstones are placeholder documents that indicate a record has been
 * soft-deleted. They maintain referential integrity while marking
 * the document as logically deleted.
 */
export interface TombstoneMarker {
  /** The document identifier */
  _id: string
  /** Flag indicating the document is deleted */
  _deleted: true
  /** ISO 8601 timestamp of when the deletion occurred */
  _deletedAt: string
}

// ============================================================================
// Tombstone Helpers
// ============================================================================

/**
 * Creates a default tombstone marker for soft deletes.
 *
 * The default tombstone includes:
 * - The original document _id
 * - A _deleted flag set to true
 * - A _deletedAt timestamp in ISO 8601 format
 *
 * @param id - The document identifier
 * @returns A tombstone marker object
 *
 * @example
 * ```typescript
 * const tombstone = createDefaultTombstone('user-123')
 * // {
 * //   _id: 'user-123',
 * //   _deleted: true,
 * //   _deletedAt: '2024-01-15T10:30:00.000Z'
 * // }
 * ```
 */
export function createDefaultTombstone(id: string): TombstoneMarker {
  return {
    _id: id,
    _deleted: true,
    _deletedAt: new Date().toISOString(),
  }
}

/**
 * Creates a tombstone with custom fields.
 *
 * Extends the default tombstone marker with additional fields
 * for domain-specific soft delete requirements.
 *
 * @typeParam T - Additional fields to include in the tombstone
 * @param id - The document identifier
 * @param additionalFields - Extra fields to merge into the tombstone
 * @returns A tombstone with the base marker plus additional fields
 *
 * @example
 * ```typescript
 * const tombstone = createTombstoneWithFields('user-123', {
 *   deletedBy: 'admin',
 *   reason: 'Account deactivated'
 * })
 * // {
 * //   _id: 'user-123',
 * //   _deleted: true,
 * //   _deletedAt: '2024-01-15T10:30:00.000Z',
 * //   deletedBy: 'admin',
 * //   reason: 'Account deactivated'
 * // }
 * ```
 */
export function createTombstoneWithFields<T extends Record<string, unknown>>(
  id: string,
  additionalFields: T
): TombstoneMarker & T {
  return {
    ...createDefaultTombstone(id),
    ...additionalFields,
  }
}

/**
 * Type guard to check if a value is a tombstone marker.
 *
 * Useful for filtering or identifying soft-deleted documents
 * in query results or sync operations.
 *
 * @param value - The value to check
 * @returns True if the value has tombstone marker properties
 *
 * @example
 * ```typescript
 * const docs = await collection.find({})
 * const activeDocuments = docs.filter(doc => !isTombstone(doc))
 * ```
 */
export function isTombstone(value: unknown): value is TombstoneMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_deleted' in value &&
    (value as TombstoneMarker)._deleted === true
  )
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates that the event is a valid MongoDB delete event.
 *
 * @param event - The event to validate
 * @throws {Error} If the event is null, undefined, or has invalid structure
 *
 * @internal
 */
function validateDeleteEvent<T extends object>(event: MongoDeleteEvent<T>): void {
  if (event === null || event === undefined) {
    throw new Error('Delete event is required')
  }

  if (event.operationType !== 'delete') {
    throw new Error(
      `Invalid operation type: expected 'delete', got '${event.operationType}'`
    )
  }

  if (!event.documentKey) {
    throw new Error('Delete event must contain documentKey')
  }

  if (event.documentKey._id === undefined || event.documentKey._id === null) {
    throw new Error('Delete event documentKey must contain _id')
  }
}

/**
 * Extracts and validates the key from a delete event.
 *
 * @param event - The MongoDB delete event
 * @param getKey - Optional custom key extractor function
 * @returns The extracted key string
 *
 * @internal
 */
function extractKey<T extends object>(
  event: MongoDeleteEvent<T>,
  getKey?: (id: string) => string
): string {
  const rawId = event.documentKey._id
  return getKey ? getKey(rawId) : rawId
}

// ============================================================================
// Transform Functions
// ============================================================================

/**
 * Transforms a MongoDB delete change stream event into a TanStack DB DeleteKeyMessage.
 *
 * This is the primary transform function for hard deletes. For soft deletes,
 * use {@link transformDeleteEventWithOptions} with `softDelete: true`.
 *
 * Delete events are unique in MongoDB change streams because they do NOT contain
 * the full document (it's already been deleted). They only provide the documentKey
 * with the _id of the deleted document.
 *
 * @typeParam T - The document type that was deleted (unused but kept for consistency)
 * @param event - The MongoDB delete change stream event
 * @param getKey - Optional function to transform the document _id into a custom key
 * @returns A DeleteKeyMessage compatible with TanStack DB's write() function
 *
 * @example Basic usage - uses _id as key
 * ```typescript
 * const deleteEvent: MongoDeleteEvent<User> = {
 *   operationType: 'delete',
 *   documentKey: { _id: '507f1f77bcf86cd799439011' }
 * }
 *
 * const message = transformDeleteEvent(deleteEvent)
 * // { type: 'delete', key: '507f1f77bcf86cd799439011' }
 * ```
 *
 * @example With custom key transformation
 * ```typescript
 * const message = transformDeleteEvent(deleteEvent, (id) => `users/${id}`)
 * // { type: 'delete', key: 'users/507f1f77bcf86cd799439011' }
 * ```
 *
 * @example With namespaced keys
 * ```typescript
 * const message = transformDeleteEvent(deleteEvent, (id) => `tenant:acme:users:${id}`)
 * // { type: 'delete', key: 'tenant:acme:users:507f1f77bcf86cd799439011' }
 * ```
 *
 * @see {@link transformDeleteEventWithOptions} for soft delete support
 * @see {@link DeleteKeyMessage} from @tanstack/db
 */
export function transformDeleteEvent<T extends object>(
  event: MongoDeleteEvent<T>,
  getKey?: (id: string) => string
): DeleteKeyMessage<string> {
  validateDeleteEvent(event)

  const key = extractKey(event, getKey)

  return {
    type: 'delete',
    key,
  }
}

/**
 * Transforms a MongoDB delete event with full options support.
 *
 * This function provides advanced features including:
 * - Soft delete support with tombstone generation
 * - Custom tombstone factories
 * - Metadata attachment
 *
 * @typeParam T - The document type that was deleted
 * @param event - The MongoDB delete change stream event
 * @param options - Transformation options including soft delete configuration
 * @returns A DeleteKeyMessage for hard deletes, or ChangeMessage for soft deletes
 *
 * @example Hard delete (default behavior)
 * ```typescript
 * const message = transformDeleteEventWithOptions(deleteEvent)
 * // { type: 'delete', key: '507f1f77bcf86cd799439011' }
 * ```
 *
 * @example Soft delete with default tombstone
 * ```typescript
 * const message = transformDeleteEventWithOptions(deleteEvent, {
 *   softDelete: true
 * })
 * // {
 * //   type: 'update',
 * //   key: '507f1f77bcf86cd799439011',
 * //   value: {
 * //     _id: '507f1f77bcf86cd799439011',
 * //     _deleted: true,
 * //     _deletedAt: '2024-01-15T10:30:00.000Z'
 * //   }
 * // }
 * ```
 *
 * @example Soft delete with custom tombstone
 * ```typescript
 * const message = transformDeleteEventWithOptions<User>(deleteEvent, {
 *   softDelete: true,
 *   createTombstone: (id) => ({
 *     _id: id,
 *     name: '[DELETED]',
 *     email: '',
 *     role: 'user',
 *     _deleted: true,
 *     _deletedAt: new Date().toISOString()
 *   })
 * })
 * ```
 *
 * @example With metadata
 * ```typescript
 * const message = transformDeleteEventWithOptions(deleteEvent, {
 *   metadata: {
 *     source: 'change-stream',
 *     deletedBy: 'system'
 *   }
 * })
 * // { type: 'delete', key: '...', metadata: { ... } }
 * ```
 *
 * @see {@link transformDeleteEvent} for simple hard delete transformation
 * @see {@link createDefaultTombstone} for default tombstone structure
 */
export function transformDeleteEventWithOptions<T extends object>(
  event: MongoDeleteEvent<T>,
  options?: DeleteTransformOptions<T>
): DeleteTransformResult<T> {
  validateDeleteEvent(event)

  const key = extractKey(event, options?.getKey)
  const rawId = event.documentKey._id

  // Handle soft delete (tombstone)
  if (options?.softDelete) {
    const tombstone = options.createTombstone
      ? options.createTombstone(rawId)
      : (createDefaultTombstone(rawId) as unknown as T)

    const result: ChangeMessage<T> = {
      type: 'update',
      key,
      value: tombstone,
    }

    if (options.metadata) {
      result.metadata = options.metadata
    }

    return result
  }

  // Handle hard delete
  const result: DeleteKeyMessage<string> & { metadata?: Record<string, unknown> } = {
    type: 'delete',
    key,
  }

  if (options?.metadata) {
    result.metadata = options.metadata
  }

  return result
}

/**
 * Creates a delete transform function with pre-configured options.
 *
 * Useful for creating reusable transform functions with consistent
 * options across multiple delete event transformations.
 *
 * @typeParam T - The document type
 * @param options - Default options to apply to all transformations
 * @returns A transform function that applies the configured options
 *
 * @example Creating a namespaced delete transform
 * ```typescript
 * const userDeleteTransform = createDeleteTransform<User>({
 *   getKey: (id) => `users/${id}`,
 *   metadata: { collection: 'users' }
 * })
 *
 * // Use it later
 * const message = userDeleteTransform(deleteEvent)
 * ```
 *
 * @example Creating a soft delete transform
 * ```typescript
 * const softDeleteTransform = createDeleteTransform<User>({
 *   softDelete: true,
 *   createTombstone: (id) => ({
 *     _id: id,
 *     name: '[DELETED]',
 *     email: '',
 *     role: 'user',
 *     _deleted: true,
 *     _deletedAt: new Date().toISOString()
 *   })
 * })
 * ```
 */
export function createDeleteTransform<T extends object>(
  options: DeleteTransformOptions<T>
): (event: MongoDeleteEvent<T>) => DeleteTransformResult<T> {
  return (event: MongoDeleteEvent<T>) =>
    transformDeleteEventWithOptions(event, options)
}

/**
 * Batch transforms multiple delete events.
 *
 * Efficiently transforms an array of delete events using the same options.
 * Maintains order and applies consistent transformation to all events.
 *
 * @typeParam T - The document type
 * @param events - Array of MongoDB delete events
 * @param options - Optional transformation options applied to all events
 * @returns Array of transformed messages in the same order as input
 *
 * @example
 * ```typescript
 * const events: MongoDeleteEvent<User>[] = [
 *   { operationType: 'delete', documentKey: { _id: 'user-1' } },
 *   { operationType: 'delete', documentKey: { _id: 'user-2' } },
 * ]
 *
 * const messages = batchTransformDeleteEvents(events, {
 *   getKey: (id) => `users/${id}`
 * })
 * // [
 * //   { type: 'delete', key: 'users/user-1' },
 * //   { type: 'delete', key: 'users/user-2' }
 * // ]
 * ```
 */
export function batchTransformDeleteEvents<T extends object>(
  events: MongoDeleteEvent<T>[],
  options?: DeleteTransformOptions<T>
): DeleteTransformResult<T>[] {
  return events.map((event) => transformDeleteEventWithOptions(event, options))
}
