/**
 * @fileoverview MongoDB Change Stream Event Types
 *
 * This module provides TypeScript types for MongoDB change stream events
 * and TanStack DB compatible change messages. These types enable type-safe
 * handling of real-time database changes.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/types/events
 */

// ============================================================================
// Generic Constraints
// ============================================================================

/**
 * Base constraint for MongoDB documents.
 *
 * All documents must be objects. This constraint ensures type safety
 * when working with generic document types.
 */
export type DocumentConstraint = object

// ============================================================================
// Common Types
// ============================================================================

/**
 * MongoDB document key containing the unique identifier.
 *
 * This type represents the document key structure used in MongoDB
 * change stream events to identify which document was affected.
 *
 * @example
 * ```typescript
 * const key: DocumentKey = { _id: '507f1f77bcf86cd799439011' }
 * ```
 */
export interface DocumentKey {
  /** The unique MongoDB document identifier */
  _id: string
}

/**
 * Description of updates made to a document.
 *
 * This interface captures the changes made during an update operation,
 * including which fields were modified and which were removed.
 *
 * @typeParam T - The document type being updated
 *
 * @example
 * ```typescript
 * interface User {
 *   _id: string
 *   name: string
 *   email: string
 * }
 *
 * const updateDesc: UpdateDescription<User> = {
 *   updatedFields: { name: 'New Name' },
 *   removedFields: ['email']
 * }
 * ```
 */
export interface UpdateDescription<T> {
  /**
   * Fields that were updated with their new values.
   * Only contains the fields that changed, not the entire document.
   */
  updatedFields: Partial<T>

  /**
   * Array of field names that were removed from the document.
   * Uses dot notation for nested fields (e.g., 'address.city').
   */
  removedFields: string[]
}

// ============================================================================
// MongoDB Change Stream Event Types
// ============================================================================

/**
 * Represents an insert operation from MongoDB change stream.
 *
 * @template T - The document type being inserted
 *
 * @example
 * ```typescript
 * const insertEvent: MongoInsertEvent<User> = {
 *   operationType: 'insert',
 *   fullDocument: { _id: '123', name: 'John', email: 'john@example.com' },
 *   documentKey: { _id: '123' }
 * }
 * ```
 */
export interface MongoInsertEvent<T> {
  /** Discriminator for insert operations */
  operationType: 'insert'
  /** The complete document that was inserted */
  fullDocument: T
  /** The unique identifier of the inserted document */
  documentKey: { _id: string }
}

/**
 * Represents an update operation from MongoDB change stream.
 *
 * @template T - The document type being updated
 *
 * @example
 * ```typescript
 * const updateEvent: MongoUpdateEvent<User> = {
 *   operationType: 'update',
 *   fullDocument: { _id: '123', name: 'John Updated', email: 'john@example.com' },
 *   documentKey: { _id: '123' },
 *   updateDescription: {
 *     updatedFields: { name: 'John Updated' },
 *     removedFields: []
 *   }
 * }
 * ```
 */
export interface MongoUpdateEvent<T> {
  /** Discriminator for update operations */
  operationType: 'update'
  /** The complete document after the update */
  fullDocument: T
  /** The unique identifier of the updated document */
  documentKey: { _id: string }
  /** Details about what fields were changed */
  updateDescription: {
    /** Fields that were added or modified */
    updatedFields: Partial<T>
    /** Names of fields that were removed */
    removedFields: string[]
  }
}

/**
 * Represents a delete operation from MongoDB change stream.
 *
 * @template T - The document type that was deleted (unused but kept for consistency)
 *
 * @example
 * ```typescript
 * const deleteEvent: MongoDeleteEvent<User> = {
 *   operationType: 'delete',
 *   documentKey: { _id: '123' }
 * }
 * ```
 */
export interface MongoDeleteEvent<T> {
  /** Discriminator for delete operations */
  operationType: 'delete'
  /** The unique identifier of the deleted document */
  documentKey: { _id: string }
}

/**
 * Represents a replace operation from MongoDB change stream.
 *
 * A replace operation completely overwrites an existing document.
 *
 * @template T - The document type being replaced
 *
 * @example
 * ```typescript
 * const replaceEvent: MongoReplaceEvent<User> = {
 *   operationType: 'replace',
 *   fullDocument: { _id: '123', name: 'Completely New', email: 'new@example.com' },
 *   documentKey: { _id: '123' }
 * }
 * ```
 */
export interface MongoReplaceEvent<T> {
  /** Discriminator for replace operations */
  operationType: 'replace'
  /** The complete new document that replaced the old one */
  fullDocument: T
  /** The unique identifier of the replaced document */
  documentKey: { _id: string }
}

/**
 * Union type representing all possible MongoDB change stream events.
 *
 * Use this type when handling change stream events where you need to
 * discriminate based on the `operationType` field.
 *
 * @template T - The document type
 *
 * @example
 * ```typescript
 * function handleChange<T>(event: MongoChangeEvent<T>) {
 *   switch (event.operationType) {
 *     case 'insert':
 *       console.log('New document:', event.fullDocument)
 *       break
 *     case 'update':
 *       console.log('Updated fields:', event.updateDescription.updatedFields)
 *       break
 *     case 'delete':
 *       console.log('Deleted document:', event.documentKey._id)
 *       break
 *     case 'replace':
 *       console.log('Replaced with:', event.fullDocument)
 *       break
 *   }
 * }
 * ```
 */
export type MongoChangeEvent<T> =
  | MongoInsertEvent<T>
  | MongoUpdateEvent<T>
  | MongoDeleteEvent<T>
  | MongoReplaceEvent<T>

/**
 * A normalized change message compatible with TanStack DB's sync protocol.
 *
 * This interface bridges MongoDB change stream events with TanStack DB's
 * internal change representation, enabling seamless real-time synchronization.
 *
 * @template T - The document/record type
 *
 * @example
 * ```typescript
 * const changeMessage: ChangeMessage<User> = {
 *   type: 'update',
 *   key: 'user-123',
 *   value: { _id: '123', name: 'John', email: 'john@example.com' },
 *   previousValue: { _id: '123', name: 'Johnny', email: 'john@example.com' },
 *   metadata: { source: 'change-stream', timestamp: Date.now() }
 * }
 * ```
 */
export interface ChangeMessage<T> {
  /** The type of change operation */
  type: 'insert' | 'update' | 'delete'
  /** The unique key identifying the document/record */
  key: string
  /** The current value of the document (required for insert/update) */
  value: T
  /** The previous value before the change (available for update/delete) */
  previousValue?: T
  /** Optional metadata about the change */
  metadata?: Record<string, unknown>
}

// ============================================================================
// Helper Types for Event Payloads
// ============================================================================

/**
 * The type of change operation for TanStack DB messages.
 *
 * Used in {@link ChangeMessage} to indicate what kind of change occurred.
 */
export type ChangeType = 'insert' | 'update' | 'delete'

/**
 * All possible operation types for MongoDB change events.
 */
export type MongoOperationType = 'insert' | 'update' | 'delete' | 'replace'

/**
 * Extract the full document type from an event that has one.
 *
 * Useful for extracting the document from insert, update, or replace events.
 *
 * @typeParam E - The event type to extract from
 *
 * @example
 * ```typescript
 * type InsertDoc = EventDocument<MongoInsertEvent<User>> // User
 * type DeleteDoc = EventDocument<MongoDeleteEvent<User>> // never (no fullDocument)
 * ```
 */
export type EventDocument<E> = E extends { fullDocument: infer D } ? D : never

/**
 * Extract the document key from any MongoDB change event.
 *
 * @typeParam E - The event type to extract from
 *
 * @example
 * ```typescript
 * type Key = EventDocumentKey<MongoInsertEvent<User>> // { _id: string }
 * ```
 */
export type EventDocumentKey<E> = E extends { documentKey: infer K } ? K : never

/**
 * Extract the operation type from a MongoDB change event.
 *
 * @typeParam E - The event type to extract from
 *
 * @example
 * ```typescript
 * type OpType = EventOperationType<MongoInsertEvent<User>> // 'insert'
 * type AllOpTypes = EventOperationType<MongoChangeEvent<User>> // 'insert' | 'update' | 'delete' | 'replace'
 * ```
 */
export type EventOperationType<E> = E extends { operationType: infer O } ? O : never

/**
 * Type representing events that contain a full document.
 *
 * This includes insert, update, and replace events but NOT delete events.
 *
 * @typeParam T - The document type
 *
 * @example
 * ```typescript
 * function processDocumentEvent<T>(event: EventWithDocument<T>): T {
 *   return event.fullDocument
 * }
 * ```
 */
export type EventWithDocument<T = DocumentConstraint> =
  | MongoInsertEvent<T>
  | MongoUpdateEvent<T>
  | MongoReplaceEvent<T>

// ============================================================================
// Type Guards for MongoDB Change Events
// ============================================================================

/**
 * Type guard to check if a MongoDB change event is an insert event.
 *
 * Use this function to safely narrow a {@link MongoChangeEvent} to
 * {@link MongoInsertEvent} with full TypeScript type inference.
 *
 * @typeParam T - The document type
 * @param event - The change event to check
 * @returns `true` if the event is an insert event, `false` otherwise
 *
 * @example
 * ```typescript
 * function handleChange<T>(event: MongoChangeEvent<T>): void {
 *   if (isInsertEvent(event)) {
 *     // TypeScript knows event is MongoInsertEvent<T> here
 *     console.log('New document:', event.fullDocument)
 *   }
 * }
 * ```
 *
 * @see {@link MongoInsertEvent}
 */
export function isInsertEvent<T = DocumentConstraint>(
  event: MongoChangeEvent<T>
): event is MongoInsertEvent<T> {
  return event.operationType === 'insert'
}

/**
 * Type guard to check if a MongoDB change event is an update event.
 *
 * Use this function to safely narrow a {@link MongoChangeEvent} to
 * {@link MongoUpdateEvent} with full TypeScript type inference.
 *
 * @typeParam T - The document type
 * @param event - The change event to check
 * @returns `true` if the event is an update event, `false` otherwise
 *
 * @example
 * ```typescript
 * function handleChange<T>(event: MongoChangeEvent<T>): void {
 *   if (isUpdateEvent(event)) {
 *     // TypeScript knows event is MongoUpdateEvent<T> here
 *     console.log('Updated fields:', event.updateDescription.updatedFields)
 *     console.log('Removed fields:', event.updateDescription.removedFields)
 *   }
 * }
 * ```
 *
 * @see {@link MongoUpdateEvent}
 */
export function isUpdateEvent<T = DocumentConstraint>(
  event: MongoChangeEvent<T>
): event is MongoUpdateEvent<T> {
  return event.operationType === 'update'
}

/**
 * Type guard to check if a MongoDB change event is a delete event.
 *
 * Use this function to safely narrow a {@link MongoChangeEvent} to
 * {@link MongoDeleteEvent} with full TypeScript type inference.
 *
 * @typeParam T - The document type
 * @param event - The change event to check
 * @returns `true` if the event is a delete event, `false` otherwise
 *
 * @example
 * ```typescript
 * function handleChange<T>(event: MongoChangeEvent<T>): void {
 *   if (isDeleteEvent(event)) {
 *     // TypeScript knows event is MongoDeleteEvent<T> here
 *     console.log('Deleted document ID:', event.documentKey._id)
 *     // Note: fullDocument is NOT available on delete events
 *   }
 * }
 * ```
 *
 * @see {@link MongoDeleteEvent}
 */
export function isDeleteEvent<T = DocumentConstraint>(
  event: MongoChangeEvent<T>
): event is MongoDeleteEvent<T> {
  return event.operationType === 'delete'
}

/**
 * Type guard to check if a MongoDB change event is a replace event.
 *
 * Use this function to safely narrow a {@link MongoChangeEvent} to
 * {@link MongoReplaceEvent} with full TypeScript type inference.
 *
 * @typeParam T - The document type
 * @param event - The change event to check
 * @returns `true` if the event is a replace event, `false` otherwise
 *
 * @example
 * ```typescript
 * function handleChange<T>(event: MongoChangeEvent<T>): void {
 *   if (isReplaceEvent(event)) {
 *     // TypeScript knows event is MongoReplaceEvent<T> here
 *     console.log('Replacement document:', event.fullDocument)
 *   }
 * }
 * ```
 *
 * @see {@link MongoReplaceEvent}
 */
export function isReplaceEvent<T = DocumentConstraint>(
  event: MongoChangeEvent<T>
): event is MongoReplaceEvent<T> {
  return event.operationType === 'replace'
}

/**
 * Type guard to check if an event contains a full document.
 *
 * Returns `true` for insert, update, and replace events.
 * Returns `false` for delete events.
 *
 * @typeParam T - The document type
 * @param event - The change event to check
 * @returns `true` if the event has a fullDocument property
 *
 * @example
 * ```typescript
 * function processEvent<T>(event: MongoChangeEvent<T>): T | null {
 *   if (hasFullDocument(event)) {
 *     // TypeScript knows event.fullDocument exists and is type T
 *     return event.fullDocument
 *   }
 *   return null
 * }
 * ```
 *
 * @see {@link EventWithDocument}
 */
export function hasFullDocument<T = DocumentConstraint>(
  event: MongoChangeEvent<T>
): event is EventWithDocument<T> {
  return event.operationType !== 'delete'
}

// ============================================================================
// Type Guards for ChangeMessage
// ============================================================================

/**
 * Type guard to check if a change message is an insert message.
 *
 * @typeParam T - The value type
 * @param message - The change message to check
 * @returns `true` if the message type is 'insert'
 *
 * @example
 * ```typescript
 * function handleMessage<T>(msg: ChangeMessage<T>): void {
 *   if (isInsertMessage(msg)) {
 *     console.log('Inserted:', msg.value)
 *   }
 * }
 * ```
 */
export function isInsertMessage<T = DocumentConstraint>(
  message: ChangeMessage<T>
): message is ChangeMessage<T> & { type: 'insert' } {
  return message.type === 'insert'
}

/**
 * Type guard to check if a change message is an update message.
 *
 * @typeParam T - The value type
 * @param message - The change message to check
 * @returns `true` if the message type is 'update'
 *
 * @example
 * ```typescript
 * function handleMessage<T>(msg: ChangeMessage<T>): void {
 *   if (isUpdateMessage(msg)) {
 *     console.log('Updated to:', msg.value)
 *     console.log('Previous:', msg.previousValue)
 *   }
 * }
 * ```
 */
export function isUpdateMessage<T = DocumentConstraint>(
  message: ChangeMessage<T>
): message is ChangeMessage<T> & { type: 'update' } {
  return message.type === 'update'
}

/**
 * Type guard to check if a change message is a delete message.
 *
 * @typeParam T - The value type
 * @param message - The change message to check
 * @returns `true` if the message type is 'delete'
 *
 * @example
 * ```typescript
 * function handleMessage<T>(msg: ChangeMessage<T>): void {
 *   if (isDeleteMessage(msg)) {
 *     console.log('Deleted:', msg.key)
 *   }
 * }
 * ```
 */
export function isDeleteMessage<T = DocumentConstraint>(
  message: ChangeMessage<T>
): message is ChangeMessage<T> & { type: 'delete' } {
  return message.type === 'delete'
}
