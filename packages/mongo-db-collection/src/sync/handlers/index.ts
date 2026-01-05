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
