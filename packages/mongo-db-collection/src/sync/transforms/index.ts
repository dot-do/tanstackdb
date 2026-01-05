/**
 * @file Transform Exports
 *
 * This module exports all MongoDB change stream event transformers.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/transforms
 */

export {
  transformInsertEvent,
  // Type guards
  isValidInsertEvent,
  hasInsertEventShape,
  assertInsertEvent,
  // Pipeline factory
  createInsertTransformPipeline,
} from './insert.js'
export type {
  InsertTransformOptions,
  InsertTransformPipeline,
  InsertDocumentConstraint,
  ValueTransformer,
} from './insert.js'

export {
  transformUpdateEvent,
  // Diff computation helpers
  getChangedFields,
  wasFieldModified,
  wasFieldUpdated,
  wasFieldRemoved,
  getModifiedFieldCount,
  isNestedUpdate,
  getUpdatedValues,
  // Partial update helpers
  createPartialUpdateMessage,
  isSignificantUpdate,
  filterUpdateFields,
} from './update.js'
export type {
  UpdateEventTransformOptions,
  UpdateEventTransformResult,
  UpdateDescriptionMetadata,
} from './update.js'

export {
  transformDeleteEvent,
  transformDeleteEventWithOptions,
  createDeleteTransform,
  batchTransformDeleteEvents,
  createDefaultTombstone,
  createTombstoneWithFields,
  isTombstone,
} from './delete.js'
export type {
  DeleteTransformOptions,
  DeleteTransformResult,
  TombstoneMarker,
} from './delete.js'

export {
  transformReplaceEvent,
  generateDocumentDiff,
} from './replace.js'
export type {
  ReplaceTransformOptions,
  DocumentDiff,
} from './replace.js'

export { BatchEventTransformer } from './batch.js'
export type {
  BatchEventTransformerOptions,
  BatchStatistics,
  DisposeOptions,
} from './batch.js'

export { ChangeEventRouter } from './router.js'
export type {
  ChangeEventHandler,
  BatchEventHandler,
  EventFilter,
  ErrorHandler,
  KeyExtractor,
  TransformFunction,
  HandlerOptions,
  ChangeEventRouterConfig,
  RouterStats,
} from './types.js'
