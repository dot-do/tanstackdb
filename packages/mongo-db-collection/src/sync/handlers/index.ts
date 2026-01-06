/**
 * @file Mutation Handlers
 *
 * Export all mutation handlers for TanStack DB integration.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/handlers
 */

export {
  createInsertMutationHandler,
  handleInsertMutation,
} from './insert-mutation.js'

export type {
  RpcClient,
  PendingMutation,
  Transaction,
  InsertMutationContext,
  InsertMutationResult,
  RetryConfig,
  BeforeInsertContext,
  AfterInsertContext,
  ErrorContext,
  InsertMutationHandlerConfig,
  HandleInsertMutationConfig,
} from './insert-mutation.js'

export {
  createUpdateMutationHandler,
} from './update-mutation.js'

export type {
  UpdateMutation,
  UpdateResult,
  UpdateMutationHandlerConfig,
  UpdateMutationHandler,
} from './update-mutation.js'

export {
  createDeleteMutationHandler,
  handleDeleteMutation,
} from './delete-mutation.js'

export type {
  DeleteMutationContext,
  DeleteMutationResult,
  BeforeDeleteContext,
  AfterDeleteContext,
  DeleteMutationHandlerConfig,
  HandleDeleteMutationConfig,
} from './delete-mutation.js'

export {
  createUnloadSubsetHandler,
  handleUnloadSubset,
} from './unload-subset.js'

export type {
  UnloadSubsetOptions,
  UnloadSubsetContext,
  BeforeUnloadContext,
  AfterUnloadContext,
  UnloadSubsetHandlerConfig,
  HandleUnloadSubsetConfig,
  UnloadSubsetHandler,
} from './unload-subset.js'

export {
  createMutationErrorHandler,
  handleMutationError,
  classifyMutationError,
  isRetryableError,
} from './mutation-error.js'

export type {
  MutationErrorType,
  ErrorRecoveryStrategy,
  MutationType,
  PendingMutation,
  Transaction,
  MutationErrorClassification,
  MutationErrorContext,
  ErrorLogEntry,
  MutationErrorResult,
  OnErrorContext,
  OnRetryContext,
  OnMaxRetriesExceededContext,
  OnRollbackContext,
  MutationErrorHandlerConfig,
  HandleMutationErrorConfig,
} from './mutation-error.js'
