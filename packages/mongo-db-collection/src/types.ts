/**
 * Type definitions for @tanstack/mongo-db-collection
 *
 * This module re-exports all types from the types directory for convenience.
 * For more granular imports, use the specific type modules directly.
 *
 * @module types
 */

// Re-export all types from the canonical location
export type {
  // Event types
  MongoChangeEvent,
  MongoInsertEvent,
  MongoUpdateEvent,
  MongoDeleteEvent,
  MongoReplaceEvent,
  ChangeMessage,
  // Event helper types
  DocumentConstraint,
  DocumentKey,
  UpdateDescription,
  ChangeType,
  MongoOperationType,
  EventDocument,
  EventDocumentKey,
  EventOperationType,
  EventWithDocument,
} from './types/events.js'

export type {
  // Sync mode types (with branded versions)
  SyncMode,
  BrandedSyncMode,
  // Conflict strategy types (with branded versions)
  ConflictStrategy,
  BrandedConflictStrategy,
  // Conflict resolution types
  ConflictContext,
  ConflictResolution,
  ConflictResolver,
  // Configuration types
  MongoDoSyncConfig,
  MongoDoCollectionConfig,
  MongoDoCredentials,
  // MongoDB query types
  MongoComparisonOperators,
  MongoElementOperators,
  MongoStringOperators,
  MongoArrayOperators,
  MongoFilterCondition,
  MongoLogicalOperators,
  MongoFilterQuery,
  SortDirection,
  SortSpec,
  CursorValue,
  // Subset loading
  LoadSubsetOptions,
  // Sync function types
  SyncParams,
  SyncReturn,
  // Type utilities
  RequiredMongoDoCollectionConfig,
  OptionalMongoDoCollectionConfig,
  WithRequiredConfig,
  InferDocumentType,
} from './types/index.js'

// Re-export runtime functions and constants
export {
  // Type guards
  isMongoDoCollectionConfig,
  isSyncMode,
  isConflictStrategy,
  // Safe conversion functions
  asSyncMode,
  asConflictStrategy,
  // Constants
  SYNC_MODES,
  CONFLICT_STRATEGIES,
} from './types/index.js'

// Re-export event type guards
export {
  isInsertEvent,
  isUpdateEvent,
  isDeleteEvent,
  isReplaceEvent,
  hasFullDocument,
  isInsertMessage,
  isUpdateMessage,
  isDeleteMessage,
} from './types/events.js'
