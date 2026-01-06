/**
 * @tanstack/mongo-db-collection
 *
 * TanStack DB adapter for MongoDB via mongo.do API.
 * Provides real-time synchronization between TanStack DB collections
 * and MongoDB databases with support for change streams.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection
 */

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Re-export all types for convenient access.
 * Types are organized into three categories:
 * - Configuration types: Adapter configuration interfaces
 * - Event types: MongoDB change stream event representations
 * - Type utilities: Helper types for working with configurations
 */
export type {
  // Configuration types
  MongoDoCollectionConfig,
  MongoDoSyncConfig,
  MongoDoCredentials,
  SyncParams,
  SyncReturn,
  SyncMode,
  ConflictStrategy,
  LoadSubsetOptions,
  // Event types
  ChangeMessage,
  MongoChangeEvent,
  MongoInsertEvent,
  MongoUpdateEvent,
  MongoDeleteEvent,
  MongoReplaceEvent,
  // Type utilities
  RequiredMongoDoCollectionConfig,
  OptionalMongoDoCollectionConfig,
  WithRequiredConfig,
  InferDocumentType,
} from './types.js'

// Re-export type guard function
export { isMongoDoCollectionConfig } from './types.js'

// ============================================================================
// Internal Imports
// ============================================================================

import type { MongoDoCollectionConfig } from './types.js'

// ============================================================================
// Public API
// ============================================================================

/**
 * Creates collection options for use with TanStack DB.
 *
 * This is the primary factory function for configuring a MongoDB collection
 * adapter. It accepts a configuration object and returns it typed correctly
 * for use with TanStack DB's collection system.
 *
 * @template TDocument - The document type stored in the MongoDB collection.
 *   Must be compatible with the provided Zod schema.
 *
 * @param config - Configuration for the MongoDB collection adapter
 * @param config.id - Unique identifier for this collection configuration
 * @param config.endpoint - The mongo.do API endpoint URL
 * @param config.database - MongoDB database name
 * @param config.collectionName - MongoDB collection name
 * @param config.schema - Zod schema for document validation
 * @param config.getKey - Function to extract a unique key from a document
 * @param config.authToken - Optional authentication token
 * @param config.credentials - Optional username/password credentials
 * @param config.syncMode - Sync strategy: 'eager', 'on-demand', or 'progressive'
 * @param config.enableChangeStream - Enable real-time updates via change streams
 *
 * @returns The validated collection configuration
 *
 * @example
 * Basic usage with a User collection:
 * ```typescript
 * import { z } from 'zod'
 * import { mongoDoCollectionOptions } from '@tanstack/mongo-db-collection'
 *
 * const userSchema = z.object({
 *   _id: z.string(),
 *   name: z.string(),
 *   email: z.string().email(),
 *   createdAt: z.date(),
 * })
 *
 * type User = z.infer<typeof userSchema>
 *
 * const userCollectionConfig = mongoDoCollectionOptions<User>({
 *   id: 'users',
 *   endpoint: 'https://api.mongo.do',
 *   database: 'myapp',
 *   collectionName: 'users',
 *   schema: userSchema,
 *   getKey: (user) => user._id,
 *   syncMode: 'eager',
 *   enableChangeStream: true,
 * })
 * ```
 *
 * @example
 * With authentication:
 * ```typescript
 * const secureConfig = mongoDoCollectionOptions<User>({
 *   id: 'users',
 *   endpoint: 'https://api.mongo.do',
 *   database: 'myapp',
 *   collectionName: 'users',
 *   schema: userSchema,
 *   getKey: (user) => user._id,
 *   authToken: process.env.MONGO_DO_TOKEN,
 * })
 * ```
 *
 * @see {@link MongoDoCollectionConfig} for full configuration options
 * @see {@link createMongoDoCollection} for an alternative API
 */
export function mongoDoCollectionOptions<TDocument = unknown>(
  config: MongoDoCollectionConfig<TDocument>
): MongoDoCollectionConfig<TDocument> {
  return config
}

/**
 * Creates a MongoDB collection adapter configuration.
 *
 * This is an alias for {@link mongoDoCollectionOptions} that provides
 * a more descriptive name for developers who prefer explicit naming.
 * Both functions are functionally identical.
 *
 * @template TDocument - The document type stored in the MongoDB collection
 *
 * @param config - Configuration for the MongoDB collection adapter
 * @returns A configured collection adapter options object
 *
 * @example
 * ```typescript
 * import { z } from 'zod'
 * import { createMongoDoCollection } from '@tanstack/mongo-db-collection'
 *
 * const productSchema = z.object({
 *   _id: z.string(),
 *   sku: z.string(),
 *   name: z.string(),
 *   price: z.number().positive(),
 * })
 *
 * type Product = z.infer<typeof productSchema>
 *
 * const productConfig = createMongoDoCollection<Product>({
 *   id: 'products',
 *   endpoint: 'https://api.mongo.do',
 *   database: 'ecommerce',
 *   collectionName: 'products',
 *   schema: productSchema,
 *   getKey: (product) => product._id,
 *   syncMode: 'progressive',
 * })
 * ```
 *
 * @see {@link mongoDoCollectionOptions} for the primary API
 * @see {@link MongoDoCollectionConfig} for full configuration options
 */
export function createMongoDoCollection<TDocument = unknown>(
  config: MongoDoCollectionConfig<TDocument>
): MongoDoCollectionConfig<TDocument> {
  return mongoDoCollectionOptions(config)
}

// ============================================================================
// Mutation Handlers
// ============================================================================

/**
 * Re-export mutation handlers for direct use.
 * These handlers are used internally by the sync function but can also
 * be used directly for custom integrations.
 */
export {
  createInsertMutationHandler,
  handleInsertMutation,
  createUpdateMutationHandler,
  createDeleteMutationHandler,
  handleDeleteMutation,
} from './sync/handlers/index.js'

export type {
  // Insert mutation types
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
  // Update mutation types
  UpdateMutation,
  UpdateResult,
  UpdateMutationHandlerConfig,
  UpdateMutationHandler,
  // Delete mutation types
  DeleteMutationContext,
  DeleteMutationResult,
  BeforeDeleteContext,
  AfterDeleteContext,
  DeleteMutationHandlerConfig,
  HandleDeleteMutationConfig,
} from './sync/handlers/index.js'

// ============================================================================
// Factory Module
// ============================================================================

/**
 * Re-export factory functions for fluent builder API.
 * These provide an alternative to the direct object configuration approach.
 */
export { createOptionsBuilder, type OptionsBuilder } from './factory/index.js'
