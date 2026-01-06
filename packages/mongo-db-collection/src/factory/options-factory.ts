/**
 * Options Factory - Fluent Builder for MongoDB Collection Configuration
 *
 * Provides a chainable API for building type-safe MongoDB collection configurations.
 * This is an alternative to the direct object configuration approach.
 *
 * @module @tanstack/mongo-db-collection/factory/options-factory
 */

import type { ZodSchema } from 'zod'
import type { MongoDoCollectionConfig, MongoDoCredentials, SyncMode } from '../types/index.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Internal state for the options builder.
 * All fields are optional until build() is called.
 * @internal
 */
interface BuilderState<T> {
  id?: string
  endpoint?: string
  database?: string
  collectionName?: string
  schema?: ZodSchema<T>
  getKey?: (item: T) => string
  authToken?: string
  credentials?: MongoDoCredentials
  syncMode?: SyncMode
  enableChangeStream?: boolean
}

/**
 * Fluent builder interface for creating MongoDoCollectionConfig.
 *
 * @typeParam T - The document type stored in the collection
 *
 * @example
 * ```typescript
 * const config = createOptionsBuilder<User>()
 *   .id('users-collection')
 *   .endpoint('https://api.mongo.do')
 *   .database('myapp')
 *   .collectionName('users')
 *   .schema(userSchema)
 *   .getKey((user) => user._id)
 *   .withEagerSync()
 *   .withRealtime()
 *   .build()
 * ```
 */
export interface OptionsBuilder<T> {
  /**
   * Set the unique identifier for this collection configuration.
   * @param value - Unique identifier string
   * @returns The builder for chaining
   */
  id(value: string): OptionsBuilder<T>

  /**
   * Set the mongo.do API endpoint URL.
   * @param value - The API endpoint URL
   * @returns The builder for chaining
   */
  endpoint(value: string): OptionsBuilder<T>

  /**
   * Set the MongoDB database name.
   * @param value - Database name
   * @returns The builder for chaining
   */
  database(value: string): OptionsBuilder<T>

  /**
   * Set the MongoDB collection name.
   * @param value - Collection name
   * @returns The builder for chaining
   */
  collectionName(value: string): OptionsBuilder<T>

  /**
   * Set the Zod schema for document validation.
   * @param value - Zod schema for the document type
   * @returns The builder for chaining
   */
  schema(value: ZodSchema<T>): OptionsBuilder<T>

  /**
   * Set the function to extract unique key from documents.
   * @param fn - Function that extracts a string key from a document
   * @returns The builder for chaining
   */
  getKey(fn: (item: T) => string): OptionsBuilder<T>

  /**
   * Set the authentication token.
   * @param value - Bearer token for authentication
   * @returns The builder for chaining
   */
  authToken(value: string | undefined): OptionsBuilder<T>

  /**
   * Set username/password credentials.
   * @param value - Credentials object with username and password
   * @returns The builder for chaining
   */
  credentials(value: MongoDoCredentials): OptionsBuilder<T>

  /**
   * Set the sync mode.
   * @param value - Sync mode: 'eager', 'on-demand', or 'progressive'
   * @returns The builder for chaining
   */
  syncMode(value: SyncMode): OptionsBuilder<T>

  /**
   * Enable or disable change stream for real-time updates.
   * @param value - Whether to enable change stream
   * @returns The builder for chaining
   */
  enableChangeStream(value: boolean): OptionsBuilder<T>

  // Convenience methods

  /**
   * Convenience method to set syncMode to 'eager'.
   * @returns The builder for chaining
   */
  withEagerSync(): OptionsBuilder<T>

  /**
   * Convenience method to set syncMode to 'on-demand'.
   * @returns The builder for chaining
   */
  withOnDemandSync(): OptionsBuilder<T>

  /**
   * Convenience method to set syncMode to 'progressive'.
   * @returns The builder for chaining
   */
  withProgressiveSync(): OptionsBuilder<T>

  /**
   * Convenience method to enable change stream.
   * @returns The builder for chaining
   */
  withRealtime(): OptionsBuilder<T>

  /**
   * Convenience method to set auth token.
   * @param token - The auth token
   * @returns The builder for chaining
   */
  withAuth(token: string): OptionsBuilder<T>

  /**
   * Create a clone of this builder with all current values.
   * @returns A new builder instance with the same values
   */
  clone(): OptionsBuilder<T>

  /**
   * Initialize builder from an existing config.
   * @param config - Existing configuration to copy from
   * @returns The builder for chaining
   */
  fromConfig(config: MongoDoCollectionConfig<T>): OptionsBuilder<T>

  /**
   * Build the final MongoDoCollectionConfig.
   * @throws Error if required fields are missing
   * @returns The validated configuration object
   */
  build(): MongoDoCollectionConfig<T>
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Internal implementation of the OptionsBuilder interface.
 * @internal
 */
class OptionsBuilderImpl<T> implements OptionsBuilder<T> {
  private state: BuilderState<T>

  constructor(initialState: BuilderState<T> = {}) {
    this.state = { ...initialState }
  }

  id(value: string): OptionsBuilder<T> {
    this.state.id = value
    return this
  }

  endpoint(value: string): OptionsBuilder<T> {
    this.state.endpoint = value
    return this
  }

  database(value: string): OptionsBuilder<T> {
    this.state.database = value
    return this
  }

  collectionName(value: string): OptionsBuilder<T> {
    this.state.collectionName = value
    return this
  }

  schema(value: ZodSchema<T>): OptionsBuilder<T> {
    this.state.schema = value
    return this
  }

  getKey(fn: (item: T) => string): OptionsBuilder<T> {
    this.state.getKey = fn
    return this
  }

  authToken(value: string | undefined): OptionsBuilder<T> {
    this.state.authToken = value
    return this
  }

  credentials(value: MongoDoCredentials): OptionsBuilder<T> {
    this.state.credentials = value
    return this
  }

  syncMode(value: SyncMode): OptionsBuilder<T> {
    this.state.syncMode = value
    return this
  }

  enableChangeStream(value: boolean): OptionsBuilder<T> {
    this.state.enableChangeStream = value
    return this
  }

  // Convenience methods

  withEagerSync(): OptionsBuilder<T> {
    return this.syncMode('eager')
  }

  withOnDemandSync(): OptionsBuilder<T> {
    return this.syncMode('on-demand')
  }

  withProgressiveSync(): OptionsBuilder<T> {
    return this.syncMode('progressive')
  }

  withRealtime(): OptionsBuilder<T> {
    return this.enableChangeStream(true)
  }

  withAuth(token: string): OptionsBuilder<T> {
    return this.authToken(token)
  }

  clone(): OptionsBuilder<T> {
    // Deep clone the state
    const clonedState: BuilderState<T> = {
      ...this.state,
      credentials: this.state.credentials
        ? { ...this.state.credentials }
        : undefined,
    }
    return new OptionsBuilderImpl<T>(clonedState)
  }

  fromConfig(config: MongoDoCollectionConfig<T>): OptionsBuilder<T> {
    this.state = {
      id: config.id,
      endpoint: config.endpoint,
      database: config.database,
      collectionName: config.collectionName,
      schema: config.schema,
      getKey: config.getKey,
      authToken: config.authToken,
      credentials: config.credentials ? { ...config.credentials } : undefined,
      syncMode: config.syncMode,
      enableChangeStream: config.enableChangeStream,
    }
    return this
  }

  build(): MongoDoCollectionConfig<T> {
    // Validate required fields
    const missingFields: string[] = []

    if (!this.state.id || this.state.id === '') {
      missingFields.push('id')
    }
    if (!this.state.endpoint) {
      missingFields.push('endpoint')
    }
    if (!this.state.database) {
      missingFields.push('database')
    }
    if (!this.state.collectionName) {
      missingFields.push('collectionName')
    }
    if (!this.state.schema) {
      missingFields.push('schema')
    }
    if (!this.state.getKey) {
      missingFields.push('getKey')
    }

    if (missingFields.length > 0) {
      if (missingFields.length === 1) {
        throw new Error(`${missingFields[0]} is required`)
      }
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`)
    }

    // Build the config object
    const config: MongoDoCollectionConfig<T> = {
      id: this.state.id!,
      endpoint: this.state.endpoint!,
      database: this.state.database!,
      collectionName: this.state.collectionName!,
      schema: this.state.schema!,
      getKey: this.state.getKey!,
    }

    // Add optional fields only if defined
    if (this.state.authToken !== undefined) {
      config.authToken = this.state.authToken
    }
    if (this.state.credentials !== undefined) {
      config.credentials = this.state.credentials
    }
    if (this.state.syncMode !== undefined) {
      config.syncMode = this.state.syncMode
    }
    if (this.state.enableChangeStream !== undefined) {
      config.enableChangeStream = this.state.enableChangeStream
    }

    return config
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new options builder for configuring a MongoDB collection.
 *
 * The builder provides a fluent API for constructing MongoDoCollectionConfig
 * objects with type safety and validation.
 *
 * @typeParam T - The document type stored in the collection
 * @returns A new OptionsBuilder instance
 *
 * @example Basic usage
 * ```typescript
 * import { z } from 'zod'
 * import { createOptionsBuilder } from '@tanstack/mongo-db-collection'
 *
 * const userSchema = z.object({
 *   _id: z.string(),
 *   name: z.string(),
 *   email: z.string().email(),
 * })
 *
 * type User = z.infer<typeof userSchema>
 *
 * const config = createOptionsBuilder<User>()
 *   .id('users-collection')
 *   .endpoint('https://api.mongo.do')
 *   .database('myapp')
 *   .collectionName('users')
 *   .schema(userSchema)
 *   .getKey((user) => user._id)
 *   .build()
 * ```
 *
 * @example With convenience methods
 * ```typescript
 * const config = createOptionsBuilder<User>()
 *   .id('users-collection')
 *   .endpoint('https://api.mongo.do')
 *   .database('myapp')
 *   .collectionName('users')
 *   .schema(userSchema)
 *   .getKey((user) => user._id)
 *   .withEagerSync()
 *   .withRealtime()
 *   .withAuth(process.env.MONGO_TOKEN!)
 *   .build()
 * ```
 *
 * @example Cloning and modifying
 * ```typescript
 * const baseBuilder = createOptionsBuilder<User>()
 *   .endpoint('https://api.mongo.do')
 *   .database('myapp')
 *   .schema(userSchema)
 *   .getKey((user) => user._id)
 *
 * const devConfig = baseBuilder.clone()
 *   .id('users-dev')
 *   .collectionName('users_dev')
 *   .build()
 *
 * const prodConfig = baseBuilder.clone()
 *   .id('users-prod')
 *   .collectionName('users')
 *   .withAuth(process.env.PROD_TOKEN!)
 *   .build()
 * ```
 *
 * @see {@link OptionsBuilder} for the builder interface
 * @see {@link MongoDoCollectionConfig} for the configuration type
 */
export function createOptionsBuilder<T>(): OptionsBuilder<T> {
  return new OptionsBuilderImpl<T>()
}
