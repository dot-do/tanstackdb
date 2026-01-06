import type { ZodSchema } from 'zod'
import type { Collection } from '@tanstack/db'
import type { BasicExpression } from '../query/predicate-compiler.js'

// Re-export event types
export type {
  MongoChangeEvent,
  MongoInsertEvent,
  MongoUpdateEvent,
  MongoDeleteEvent,
  MongoReplaceEvent,
  ChangeMessage,
  // Helper types
  DocumentConstraint,
  DocumentKey,
  UpdateDescription,
  ChangeType,
  MongoOperationType,
  EventDocument,
  EventDocumentKey,
  EventOperationType,
  EventWithDocument,
} from './events.js'

// Re-export type guards
export {
  isInsertEvent,
  isUpdateEvent,
  isDeleteEvent,
  isReplaceEvent,
  hasFullDocument,
  isInsertMessage,
  isUpdateMessage,
  isDeleteMessage,
} from './events.js'

import type { ChangeMessage } from './events.js'

// =============================================================================
// Branded Type Infrastructure
// =============================================================================

/**
 * Symbol used for branding types to prevent accidental type coercion.
 * Branded types are structurally unique and cannot be assigned from plain strings.
 * @internal
 */
declare const BrandSymbol: unique symbol

/**
 * Creates a branded type by intersecting a base type with a phantom brand property.
 *
 * Branded types provide compile-time safety by making structurally identical types
 * incompatible. This prevents mixing up values that have the same runtime type
 * but different semantic meanings.
 *
 * @typeParam T - The base type to brand
 * @typeParam Brand - A unique string literal identifier for the brand
 *
 * @example
 * ```typescript
 * type UserId = Branded<string, 'UserId'>
 * type SessionId = Branded<string, 'SessionId'>
 *
 * const userId: UserId = 'user-123' as UserId
 * const sessionId: SessionId = 'session-456' as SessionId
 *
 * // Type error: Cannot assign SessionId to UserId
 * const invalid: UserId = sessionId // Error!
 * ```
 *
 * @internal
 */
type Branded<T, Brand extends string> = T & { readonly [BrandSymbol]: Brand }

// =============================================================================
// Sync Mode Types
// =============================================================================

/**
 * The underlying string literal values for sync modes.
 * @internal
 */
type SyncModeValue = 'eager' | 'on-demand' | 'progressive'

/**
 * Synchronization mode options for MongoDB collections.
 *
 * Determines when and how data is synchronized between the client and server.
 *
 * @remarks
 * Available modes:
 * - `'eager'` - Sync immediately when changes occur. Best for:
 *   - Real-time collaborative applications
 *   - Small to medium datasets
 *   - When data freshness is critical
 *
 * - `'on-demand'` - Sync only when explicitly requested. Best for:
 *   - Large datasets with infrequent updates
 *   - Bandwidth-limited environments
 *   - When user controls when to sync
 *
 * - `'progressive'` - Sync in batches over time. Best for:
 *   - Large datasets that need background sync
 *   - Initial load optimization
 *   - When you need eventual consistency
 *
 * @example Basic usage
 * ```typescript
 * const config: MongoDoCollectionConfig<User> = {
 *   // ... other config
 *   syncMode: 'eager', // Changes sync immediately
 * }
 * ```
 *
 * @example Using type guard
 * ```typescript
 * const userChoice = getUserSyncPreference()
 * if (isSyncMode(userChoice)) {
 *   config.syncMode = userChoice
 * }
 * ```
 *
 * @see {@link isSyncMode} - Type guard for runtime validation
 * @see {@link SYNC_MODES} - Array of all valid modes
 * @see {@link BrandedSyncMode} - Stricter branded version
 */
export type SyncMode = SyncModeValue

/**
 * Branded version of SyncMode for stricter type checking scenarios.
 *
 * Use this when you need to ensure a value has been explicitly validated
 * as a sync mode through a type guard, not just any matching string.
 *
 * @example
 * ```typescript
 * function configureSyncEngine(mode: BrandedSyncMode): void {
 *   // This function only accepts validated modes
 * }
 *
 * const rawMode = 'eager'
 * // configureSyncEngine(rawMode) // Error: string not assignable to BrandedSyncMode
 *
 * if (isSyncMode(rawMode)) {
 *   configureSyncEngine(rawMode as BrandedSyncMode) // OK
 * }
 * ```
 */
export type BrandedSyncMode = Branded<SyncModeValue, 'SyncMode'>

/**
 * Constant tuple of all valid sync mode values.
 *
 * Use for validation, iteration, or building UI components.
 *
 * @example Validation
 * ```typescript
 * const isValid = SYNC_MODES.includes(userInput as SyncMode)
 * ```
 *
 * @example Building UI
 * ```typescript
 * <select>
 *   {SYNC_MODES.map(mode => (
 *     <option key={mode} value={mode}>{mode}</option>
 *   ))}
 * </select>
 * ```
 */
export const SYNC_MODES: readonly SyncMode[] = ['eager', 'on-demand', 'progressive'] as const

/**
 * Type guard to check if a value is a valid SyncMode.
 *
 * @param value - The value to check (can be any type)
 * @returns `true` if the value is a valid sync mode string
 *
 * @example
 * ```typescript
 * const preference = localStorage.getItem('syncMode')
 * if (isSyncMode(preference)) {
 *   // preference is now typed as SyncMode
 *   config.syncMode = preference
 * } else {
 *   config.syncMode = 'eager' // default
 * }
 * ```
 */
export function isSyncMode(value: unknown): value is SyncMode {
  return typeof value === 'string' && SYNC_MODES.includes(value as SyncMode)
}

/**
 * Safely converts an unknown value to a SyncMode, returning undefined if invalid.
 *
 * @param value - The value to convert
 * @returns The value as SyncMode if valid, undefined otherwise
 *
 * @example
 * ```typescript
 * const mode = asSyncMode(process.env.SYNC_MODE) ?? 'eager'
 * config.syncMode = mode
 * ```
 */
export function asSyncMode(value: unknown): SyncMode | undefined {
  return isSyncMode(value) ? value : undefined
}

// =============================================================================
// Conflict Strategy Types
// =============================================================================

/**
 * The underlying string literal values for conflict strategies.
 * @internal
 */
type ConflictStrategyValue = 'last-write-wins' | 'server-wins' | 'client-wins' | 'custom'

/**
 * Conflict resolution strategies for concurrent modifications.
 *
 * Determines how conflicts are resolved when the same document is modified
 * on both client and server before synchronization completes.
 *
 * @remarks
 * Available strategies:
 * - `'last-write-wins'` - The most recent write (by timestamp) takes precedence.
 *   Simple and predictable, but may lose data in concurrent edits.
 *
 * - `'server-wins'` - Server changes always override client changes.
 *   Ensures server authority, good for admin-controlled data.
 *
 * - `'client-wins'` - Client changes always override server changes.
 *   Preserves local user intent, good for offline-first apps.
 *
 * - `'custom'` - Use a custom {@link ConflictResolver} function.
 *   Most flexible, allows field-level merging or business logic.
 *
 * @example Basic usage
 * ```typescript
 * const config = {
 *   conflictStrategy: 'server-wins' as ConflictStrategy,
 * }
 * ```
 *
 * @example With custom resolver
 * ```typescript
 * const config = {
 *   conflictStrategy: 'custom' as ConflictStrategy,
 *   conflictResolver: (context) => ({
 *     resolved: { ...context.serverVersion, ...context.clientVersion }
 *   })
 * }
 * ```
 *
 * @see {@link ConflictResolver} - Custom resolution function type
 * @see {@link ConflictContext} - Context provided to resolvers
 */
export type ConflictStrategy = ConflictStrategyValue

/**
 * Branded version of ConflictStrategy for stricter type checking.
 *
 * Use when you need to ensure values have been explicitly validated.
 */
export type BrandedConflictStrategy = Branded<ConflictStrategyValue, 'ConflictStrategy'>

/**
 * Constant tuple of all valid conflict strategy values.
 *
 * @example
 * ```typescript
 * CONFLICT_STRATEGIES.forEach(strategy => {
 *   console.log(`Available: ${strategy}`)
 * })
 * ```
 */
export const CONFLICT_STRATEGIES: readonly ConflictStrategy[] = [
  'last-write-wins',
  'server-wins',
  'client-wins',
  'custom',
] as const

/**
 * Type guard to check if a value is a valid ConflictStrategy.
 *
 * @param value - The value to check
 * @returns `true` if the value is a valid conflict strategy
 *
 * @example
 * ```typescript
 * if (isConflictStrategy(userChoice)) {
 *   config.conflictStrategy = userChoice
 * }
 * ```
 */
export function isConflictStrategy(value: unknown): value is ConflictStrategy {
  return typeof value === 'string' && CONFLICT_STRATEGIES.includes(value as ConflictStrategy)
}

/**
 * Safely converts an unknown value to a ConflictStrategy.
 *
 * @param value - The value to convert
 * @returns The value as ConflictStrategy if valid, undefined otherwise
 */
export function asConflictStrategy(value: unknown): ConflictStrategy | undefined {
  return isConflictStrategy(value) ? value : undefined
}

// =============================================================================
// Conflict Resolution Types
// =============================================================================

/**
 * Context provided to custom conflict resolvers.
 *
 * Contains all information needed to make an informed decision about
 * how to resolve a conflict between concurrent modifications.
 *
 * @typeParam T - The document type
 *
 * @example
 * ```typescript
 * const resolver = (context: ConflictContext<User>) => {
 *   // Compare timestamps to decide winner
 *   if (context.serverTimestamp > context.clientTimestamp) {
 *     return { resolved: context.serverVersion }
 *   }
 *
 *   // Or merge fields intelligently
 *   return {
 *     resolved: {
 *       ...context.serverVersion,
 *       name: context.clientVersion.name, // Prefer client's name change
 *       updatedAt: new Date(),
 *     }
 *   }
 * }
 * ```
 */
export interface ConflictContext<T = unknown> {
  /** The document version from the server (remote state) */
  readonly serverVersion: T
  /** The document version from the client (local changes) */
  readonly clientVersion: T
  /** The common ancestor version before the conflict occurred (if available) */
  readonly baseVersion?: T
  /** Timestamp when the server version was last modified */
  readonly serverTimestamp: Date
  /** Timestamp when the client version was last modified */
  readonly clientTimestamp: Date
  /** The document key (typically _id) */
  readonly key: string
  /** The field names that have conflicting values (if determinable) */
  readonly conflictingFields?: string[]
  /** Additional metadata about the conflict */
  readonly metadata?: Record<string, unknown>
}

/**
 * Result returned from a custom conflict resolver.
 *
 * @typeParam T - The document type
 */
export interface ConflictResolution<T = unknown> {
  /** The resolved document value that will be persisted */
  readonly resolved: T
  /** Optional metadata to record about how the conflict was resolved */
  readonly resolutionMetadata?: {
    /** Which strategy was used (for logging/debugging) */
    strategy?: string
    /** Fields that were merged from server */
    serverFields?: string[]
    /** Fields that were merged from client */
    clientFields?: string[]
    /** When the resolution occurred */
    resolvedAt?: Date
    /** Custom metadata */
    [key: string]: unknown
  }
}

/**
 * Custom conflict resolver function type.
 *
 * Implement this to define custom conflict resolution logic when
 * using `conflictStrategy: 'custom'`.
 *
 * @typeParam T - The document type
 *
 * @example Simple merge resolver
 * ```typescript
 * const mergeResolver: ConflictResolver<User> = (context) => {
 *   return {
 *     resolved: {
 *       ...context.serverVersion,
 *       ...context.clientVersion,
 *       updatedAt: new Date(),
 *     },
 *     resolutionMetadata: { strategy: 'merge' }
 *   }
 * }
 * ```
 *
 * @example Field-level resolution
 * ```typescript
 * const fieldResolver: ConflictResolver<Document> = (context) => {
 *   const resolved = { ...context.serverVersion }
 *   const clientFields: string[] = []
 *
 *   // Prefer client for user-editable fields
 *   for (const field of ['title', 'content', 'tags']) {
 *     if (context.clientVersion[field] !== context.baseVersion?.[field]) {
 *       resolved[field] = context.clientVersion[field]
 *       clientFields.push(field)
 *     }
 *   }
 *
 *   return {
 *     resolved,
 *     resolutionMetadata: { strategy: 'field-level', clientFields }
 *   }
 * }
 * ```
 */
export type ConflictResolver<T = unknown> = (context: ConflictContext<T>) => ConflictResolution<T>

// =============================================================================
// Authentication Types
// =============================================================================

/**
 * Username and password credentials for MongoDB authentication.
 *
 * @remarks
 * Use this when connecting with basic authentication instead of an auth token.
 * For production environments, consider using auth tokens or environment variables.
 *
 * @example
 * ```typescript
 * const credentials: MongoDoCredentials = {
 *   username: 'myuser',
 *   password: process.env.MONGO_PASSWORD!,
 * }
 * ```
 */
export interface MongoDoCredentials {
  /** The username for authentication */
  username: string
  /** The password for authentication */
  password: string
}

// =============================================================================
// Sync Configuration Types
// =============================================================================

/**
 * Configuration for MongoDB sync operations.
 *
 * Used for general sync configuration when not tied to a specific collection.
 *
 * @remarks
 * All properties are optional as they may be provided at different levels
 * of the configuration hierarchy.
 *
 * @example
 * ```typescript
 * const syncConfig: MongoDoSyncConfig = {
 *   endpoint: 'https://mongo.do/api',
 *   database: 'myapp',
 *   collection: 'users',
 *   syncInterval: 5000, // Sync every 5 seconds
 * }
 * ```
 */
export interface MongoDoSyncConfig {
  /**
   * The mongo.do API endpoint URL.
   *
   * @example 'https://mongo.do/api'
   */
  endpoint?: string

  /**
   * API key for authentication with the mongo.do service.
   *
   * @remarks
   * This is an alternative to using username/password credentials.
   * Store this securely and never commit to source control.
   */
  apiKey?: string

  /**
   * Database name to connect to.
   *
   * @example 'myapp-production'
   */
  database?: string

  /**
   * Collection name to sync with.
   *
   * @example 'users'
   */
  collection?: string

  /**
   * Sync interval in milliseconds.
   *
   * @remarks
   * Only applicable when `syncMode` is `'progressive'`.
   * Lower values mean more frequent syncs but higher bandwidth usage.
   *
   * @defaultValue 10000
   * @example 5000 // Sync every 5 seconds
   */
  syncInterval?: number
}

// =============================================================================
// Collection Configuration Types
// =============================================================================

/**
 * Configuration for creating a MongoDB collection adapter.
 *
 * This interface defines all the options needed to connect a TanStack DB
 * collection to a MongoDB backend via the mongo.do service.
 *
 * @typeParam TDocument - The document type stored in the collection.
 *   Must be a valid object type that can be serialized to JSON.
 *
 * @remarks
 * The configuration is divided into required and optional properties:
 *
 * **Required properties:**
 * - `id` - Unique identifier for the collection
 * - `endpoint` - The mongo.do API endpoint
 * - `database` - Target database name
 * - `collectionName` - Target collection name
 * - `schema` - Zod schema for validation
 * - `getKey` - Function to extract document keys
 *
 * **Optional properties:**
 * - `authToken` - Bearer token for authentication
 * - `credentials` - Username/password for authentication
 * - `syncMode` - How synchronization should occur
 * - `enableChangeStream` - Enable real-time updates
 *
 * @example Basic configuration
 * ```typescript
 * import { z } from 'zod'
 * import type { MongoDoCollectionConfig } from '@tanstack/mongo-db-collection'
 *
 * const userSchema = z.object({
 *   _id: z.string(),
 *   name: z.string(),
 *   email: z.string().email(),
 * })
 *
 * type User = z.infer<typeof userSchema>
 *
 * const config: MongoDoCollectionConfig<User> = {
 *   id: 'users-collection',
 *   endpoint: 'https://mongo.do/api',
 *   database: 'myapp',
 *   collectionName: 'users',
 *   schema: userSchema,
 *   getKey: (user) => user._id,
 * }
 * ```
 *
 * @example Configuration with authentication and real-time sync
 * ```typescript
 * const config: MongoDoCollectionConfig<User> = {
 *   id: 'users-collection',
 *   endpoint: 'https://mongo.do/api',
 *   database: 'myapp',
 *   collectionName: 'users',
 *   schema: userSchema,
 *   getKey: (user) => user._id,
 *   authToken: process.env.MONGO_TOKEN,
 *   syncMode: 'eager',
 *   enableChangeStream: true,
 * }
 * ```
 *
 * @see {@link SyncMode} for available synchronization modes
 * @see {@link MongoDoCredentials} for username/password authentication
 */
export interface MongoDoCollectionConfig<TDocument = unknown> {
  /**
   * Unique identifier for this collection configuration.
   *
   * Used internally to track and manage the collection instance.
   * Should be unique across all collections in your application.
   *
   * @example 'users-collection'
   * @example 'products-v2'
   */
  id: string

  /**
   * The mongo.do API endpoint URL.
   *
   * This is the base URL for all API requests to the mongo.do service.
   *
   * @example 'https://mongo.do/api'
   * @example 'https://custom.mongo.do/api/v2'
   */
  endpoint: string

  /**
   * Database name to connect to.
   *
   * The name of the MongoDB database that contains your collection.
   *
   * @example 'myapp'
   * @example 'myapp-production'
   */
  database: string

  /**
   * Collection name within the database.
   *
   * The name of the MongoDB collection to sync with.
   *
   * @example 'users'
   * @example 'products'
   */
  collectionName: string

  /**
   * Zod schema for document validation.
   *
   * Used to validate documents before they are written to the collection
   * and to provide type inference for the document type.
   *
   * @remarks
   * The schema should match the `TDocument` type parameter.
   * All documents are validated against this schema before sync.
   *
   * @example
   * ```typescript
   * import { z } from 'zod'
   *
   * const userSchema = z.object({
   *   _id: z.string(),
   *   name: z.string(),
   *   email: z.string().email(),
   *   createdAt: z.date(),
   * })
   *
   * // Use in config:
   * schema: userSchema
   * ```
   */
  schema: ZodSchema<TDocument>

  /**
   * Function to extract the unique key from a document.
   *
   * This key is used to identify documents for sync operations.
   * Typically, this returns the `_id` field of the document.
   *
   * @param item - The document to extract the key from
   * @returns A string key that uniquely identifies the document
   *
   * @example
   * ```typescript
   * // Simple _id extraction
   * getKey: (user) => user._id
   *
   * // Composite key
   * getKey: (order) => `${order.userId}-${order.orderId}`
   * ```
   */
  getKey: (item: TDocument) => string

  /**
   * Optional authentication token for the mongo.do API.
   *
   * Use this for bearer token authentication. This is the preferred
   * authentication method for production environments.
   *
   * @remarks
   * Either `authToken` or `credentials` can be used, but not both.
   * If neither is provided, anonymous access is attempted.
   *
   * @example 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
   */
  authToken?: string

  /**
   * Optional username/password credentials for authentication.
   *
   * Use this for basic authentication when an auth token is not available.
   *
   * @remarks
   * Either `authToken` or `credentials` can be used, but not both.
   * For production, prefer using `authToken` over credentials.
   *
   * @example
   * ```typescript
   * credentials: {
   *   username: 'myuser',
   *   password: process.env.MONGO_PASSWORD!,
   * }
   * ```
   */
  credentials?: MongoDoCredentials

  /**
   * Sync mode determining when data synchronization occurs.
   *
   * Controls the synchronization behavior between client and server.
   *
   * @defaultValue 'eager'
   * @see {@link SyncMode} for available options
   *
   * @example
   * ```typescript
   * // Immediate sync for real-time apps
   * syncMode: 'eager'
   *
   * // Manual sync for bandwidth-limited scenarios
   * syncMode: 'on-demand'
   *
   * // Batch sync for large datasets
   * syncMode: 'progressive'
   * ```
   */
  syncMode?: SyncMode

  /**
   * Enable MongoDB change stream for real-time updates.
   *
   * When enabled, the collection will receive real-time updates
   * from MongoDB via change streams.
   *
   * @remarks
   * Requires a MongoDB replica set or sharded cluster.
   * May increase bandwidth usage due to continuous connection.
   *
   * @defaultValue false
   *
   * @example
   * ```typescript
   * // Enable real-time updates
   * enableChangeStream: true
   * ```
   */
  enableChangeStream?: boolean
}

// =============================================================================
// MongoDB Query Types
// =============================================================================

/**
 * MongoDB comparison operators for query filters.
 *
 * These operators can be used in `where` clauses to create complex queries.
 *
 * @typeParam T - The type of value being compared
 *
 * @example
 * ```typescript
 * const filter: MongoComparisonOperators<number> = {
 *   $gte: 18,
 *   $lt: 65
 * }
 * ```
 */
export interface MongoComparisonOperators<T = unknown> {
  /** Matches values equal to the specified value */
  $eq?: T
  /** Matches values not equal to the specified value */
  $ne?: T
  /** Matches values greater than the specified value */
  $gt?: T
  /** Matches values greater than or equal to the specified value */
  $gte?: T
  /** Matches values less than the specified value */
  $lt?: T
  /** Matches values less than or equal to the specified value */
  $lte?: T
  /** Matches any of the values in the specified array */
  $in?: T[]
  /** Matches none of the values in the specified array */
  $nin?: T[]
}

/**
 * MongoDB element operators for checking field existence and type.
 *
 * @example
 * ```typescript
 * // Match documents where 'email' field exists
 * const filter = { email: { $exists: true } }
 * ```
 */
export interface MongoElementOperators {
  /** Matches documents that have (or don't have) the specified field */
  $exists?: boolean
  /** Matches documents where the field is of the specified BSON type */
  $type?: string | number
}

/**
 * MongoDB string operators for text matching.
 *
 * @example
 * ```typescript
 * // Match names starting with 'John'
 * const filter = { name: { $regex: '^John', $options: 'i' } }
 * ```
 */
export interface MongoStringOperators {
  /** Regular expression pattern to match */
  $regex?: string | RegExp
  /** Regular expression options (i, m, s, x) */
  $options?: string
}

/**
 * MongoDB array operators for querying array fields.
 *
 * @typeParam T - The type of array elements
 *
 * @example
 * ```typescript
 * // Match documents with exactly 3 tags
 * const filter = { tags: { $size: 3 } }
 *
 * // Match documents with all specified tags
 * const filter = { tags: { $all: ['typescript', 'react'] } }
 * ```
 */
export interface MongoArrayOperators<T = unknown> {
  /** Matches arrays with the specified number of elements */
  $size?: number
  /** Matches arrays containing all specified values */
  $all?: T[]
  /** Matches if any array element matches the condition */
  $elemMatch?: MongoFilterCondition<T>
}

/**
 * Combined filter condition for a single field.
 *
 * Can be a direct value (equality match) or an object with operators.
 *
 * @typeParam T - The type of the field being filtered
 */
export type MongoFilterCondition<T = unknown> =
  | T
  | MongoComparisonOperators<T>
  | MongoElementOperators
  | MongoStringOperators
  | MongoArrayOperators<T extends (infer U)[] ? U : never>

/**
 * MongoDB logical operators for combining query conditions.
 *
 * @typeParam T - The document type being queried
 *
 * @example
 * ```typescript
 * // Match active admins OR moderators
 * const filter: MongoLogicalOperators<User> = {
 *   $or: [
 *     { role: 'admin', status: 'active' },
 *     { role: 'moderator', status: 'active' }
 *   ]
 * }
 * ```
 */
export interface MongoLogicalOperators<T = Record<string, unknown>> {
  /** Joins conditions with logical AND (all must match) */
  $and?: Array<MongoFilterQuery<T>>
  /** Joins conditions with logical OR (any must match) */
  $or?: Array<MongoFilterQuery<T>>
  /** Inverts the condition (must NOT match) */
  $not?: MongoFilterQuery<T>
  /** Joins conditions with logical NOR (none must match) */
  $nor?: Array<MongoFilterQuery<T>>
}

/**
 * Complete MongoDB filter query type.
 *
 * Supports field-level conditions and logical operators.
 *
 * @typeParam T - The document type being queried
 *
 * @example Simple equality
 * ```typescript
 * const filter: MongoFilterQuery<User> = {
 *   status: 'active',
 *   role: 'admin'
 * }
 * ```
 *
 * @example With operators
 * ```typescript
 * const filter: MongoFilterQuery<User> = {
 *   age: { $gte: 18, $lt: 65 },
 *   status: { $in: ['active', 'pending'] },
 *   $or: [
 *     { role: 'admin' },
 *     { permissions: { $all: ['write', 'delete'] } }
 *   ]
 * }
 * ```
 */
export type MongoFilterQuery<T = Record<string, unknown>> = {
  [K in keyof T]?: MongoFilterCondition<T[K]>
} & MongoLogicalOperators<T>

/**
 * Sort direction values.
 *
 * Supports both string ('asc'/'desc') and numeric (1/-1) notation.
 */
export type SortDirection = 'asc' | 'desc' | 1 | -1

/**
 * Sort specification for ordering query results.
 *
 * @example
 * ```typescript
 * // Single field
 * const sort: SortSpec = { createdAt: 'desc' }
 *
 * // Multiple fields (applied in order)
 * const sort: SortSpec = { status: 'asc', createdAt: -1 }
 * ```
 */
export type SortSpec = Record<string, SortDirection>

/**
 * Cursor value type for pagination.
 *
 * Supports common MongoDB cursor value types.
 */
export type CursorValue = string | number | Date

// =============================================================================
// Load Subset Options
// =============================================================================

/**
 * Options for loading a subset of data from the collection.
 *
 * Provides pagination, filtering, and sorting capabilities for
 * partial data loading scenarios. This type provides proper typing
 * for MongoDB-style queries while remaining compatible with
 * TanStack DB's subset loading interface.
 *
 * @typeParam T - Optional document type for type-safe filtering.
 *               Defaults to `Record<string, unknown>` for flexible queries.
 *
 * @remarks
 * All properties are optional. When not specified, defaults are used:
 * - No filtering (all documents)
 * - No sorting (server default order)
 * - No limit (all matching documents)
 * - No offset (start from beginning)
 *
 * @example Basic pagination
 * ```typescript
 * const options: LoadSubsetOptions = {
 *   limit: 20,
 *   offset: 40, // Skip first 40, get next 20
 * }
 * ```
 *
 * @example Type-safe filtered query
 * ```typescript
 * interface User {
 *   _id: string
 *   status: 'active' | 'inactive'
 *   age: number
 * }
 *
 * const options: LoadSubsetOptions<User> = {
 *   where: {
 *     status: 'active',
 *     age: { $gte: 18 }
 *   },
 *   orderBy: { age: 'desc' },
 *   limit: 10,
 * }
 * ```
 *
 * @example Cursor-based pagination
 * ```typescript
 * const options: LoadSubsetOptions = {
 *   cursor: lastDocumentId,
 *   cursorField: '_id',
 *   limit: 20,
 * }
 * ```
 *
 * @see {@link MongoFilterQuery} for filter query syntax
 * @see {@link SortSpec} for sort specification
 */
export interface LoadSubsetOptions<T = Record<string, unknown>> {
  /**
   * Filter conditions for the query.
   *
   * MongoDB-style query object to filter documents. Supports equality matching,
   * comparison operators, logical operators, and more.
   *
   * @example Simple equality
   * ```typescript
   * where: { status: 'active' }
   * ```
   *
   * @example Multiple conditions (implicit AND)
   * ```typescript
   * where: { status: 'active', role: 'admin' }
   * ```
   *
   * @example Comparison operators
   * ```typescript
   * where: { age: { $gte: 18, $lt: 65 } }
   * ```
   *
   * @example Logical operators
   * ```typescript
   * where: {
   *   status: 'active',
   *   $or: [
   *     { role: 'admin' },
   *     { role: 'moderator' }
   *   ]
   * }
   * ```
   */
  where?: MongoFilterQuery<T>

  /**
   * Sort order for the results.
   *
   * Specify fields and their sort direction. Fields are sorted in the
   * order specified (first field is primary sort, etc.).
   *
   * @example Single field descending
   * ```typescript
   * orderBy: { createdAt: 'desc' }
   * ```
   *
   * @example Multiple fields
   * ```typescript
   * orderBy: { status: 'asc', createdAt: 'desc' }
   * ```
   *
   * @example Numeric notation
   * ```typescript
   * orderBy: { score: -1, name: 1 } // -1 = desc, 1 = asc
   * ```
   */
  orderBy?: SortSpec

  /**
   * Maximum number of documents to load.
   *
   * Use with `offset` for traditional pagination, or with `cursor`
   * for more efficient cursor-based pagination.
   *
   * @example
   * ```typescript
   * limit: 20 // Load at most 20 documents
   * ```
   */
  limit?: number

  /**
   * Number of documents to skip before loading.
   *
   * Used for offset-based pagination. For large datasets,
   * prefer cursor-based pagination for better performance.
   *
   * @example Page 3 of 20 items per page
   * ```typescript
   * offset: 40, // Skip first 40 (pages 1 and 2)
   * limit: 20
   * ```
   */
  offset?: number

  /**
   * Cursor value for cursor-based pagination.
   *
   * Typically the `_id` or another sortable field value from the last
   * document in the previous page. More efficient than offset-based
   * pagination for large datasets.
   *
   * @example String cursor (ObjectId)
   * ```typescript
   * cursor: '507f1f77bcf86cd799439011'
   * ```
   *
   * @example Numeric cursor (timestamp)
   * ```typescript
   * cursor: 1704067200000
   * ```
   *
   * @example Date cursor
   * ```typescript
   * cursor: new Date('2024-01-01')
   * ```
   */
  cursor?: CursorValue

  /**
   * Field to use for cursor-based pagination.
   *
   * Specifies which field the cursor value corresponds to.
   * Should match the primary sort field for correct results.
   *
   * @defaultValue '_id'
   *
   * @example
   * ```typescript
   * cursorField: 'createdAt',
   * cursor: new Date('2024-01-01'),
   * orderBy: { createdAt: 'desc' }
   * ```
   */
  cursorField?: string

  /**
   * TanStack DB predicate expression (BasicExpression<boolean>).
   *
   * An alternative to the `where` clause that uses TanStack DB's structured
   * predicate format. When provided, this takes precedence over `where`.
   * The predicate will be compiled into a MongoDB filter query.
   *
   * @example Equality predicate
   * ```typescript
   * predicate: {
   *   type: 'func',
   *   name: 'eq',
   *   args: [
   *     { type: 'ref', path: ['status'] },
   *     { type: 'val', value: 'active' }
   *   ]
   * }
   * ```
   *
   * @example Comparison predicate
   * ```typescript
   * predicate: {
   *   type: 'func',
   *   name: 'gt',
   *   args: [
   *     { type: 'ref', path: ['age'] },
   *     { type: 'val', value: 18 }
   *   ]
   * }
   * ```
   *
   * @example Logical AND predicate
   * ```typescript
   * predicate: {
   *   type: 'func',
   *   name: 'and',
   *   args: [
   *     { type: 'func', name: 'eq', args: [...] },
   *     { type: 'func', name: 'gt', args: [...] }
   *   ]
   * }
   * ```
   */
  predicate?: BasicExpression<boolean>
}

// =============================================================================
// Sync Function Types
// =============================================================================

/**
 * Parameters passed to the sync function.
 *
 * Provides methods for managing sync transactions and writing changes
 * to the collection.
 *
 * @typeParam T - The document type (must be an object)
 *
 * @remarks
 * The sync process follows this lifecycle:
 * 1. Call `begin()` to start a transaction
 * 2. Call `write()` for each change to apply
 * 3. Call `commit()` to finalize the transaction
 * 4. Call `markReady()` when sync is complete
 *
 * @example
 * ```typescript
 * function mySync<T extends object>(params: SyncParams<T>) {
 *   const { begin, write, commit, markReady } = params
 *
 *   begin()
 *
 *   for (const change of changes) {
 *     write(change)
 *   }
 *
 *   commit()
 *   markReady()
 *
 *   return {
 *     cleanup: () => { /* cleanup logic *\/ },
 *   }
 * }
 * ```
 */
export interface SyncParams<T extends object> {
  /**
   * The collection being synced.
   *
   * Reference to the TanStack DB collection instance.
   */
  collection: Collection<T>

  /**
   * Begin a sync transaction.
   *
   * Must be called before writing any changes.
   * All subsequent writes are batched until `commit()` is called.
   */
  begin: () => void

  /**
   * Write a change message to the collection.
   *
   * @param change - The change message describing the operation
   *
   * @example
   * ```typescript
   * write({
   *   type: 'insert',
   *   key: doc._id,
   *   value: doc,
   * })
   * ```
   */
  write: (change: ChangeMessage<T>) => void

  /**
   * Commit the sync transaction.
   *
   * Finalizes all writes since `begin()` was called.
   * After commit, changes are applied to the collection.
   */
  commit: () => void

  /**
   * Mark the sync as ready.
   *
   * Indicates that the initial sync is complete and the
   * collection is ready for use.
   */
  markReady: () => void
}

/**
 * Return type from sync function.
 *
 * Contains cleanup handlers and optional subset loading capability.
 *
 * @example
 * ```typescript
 * const syncReturn: SyncReturn = {
 *   cleanup: () => {
 *     // Close connections, remove listeners, etc.
 *   },
 *   loadSubset: async (options) => {
 *     // Load additional data based on options
 *   },
 * }
 * ```
 */
export interface SyncReturn {
  /**
   * Cleanup function to stop sync and release resources.
   *
   * Called when the collection is unmounted or sync is stopped.
   * Should close connections, remove event listeners, etc.
   */
  cleanup: () => void

  /**
   * Optional function to load a subset of data.
   *
   * Allows loading additional data with filtering and pagination.
   *
   * @param options - Options for filtering and pagination
   * @returns Promise that resolves when data is loaded
   */
  loadSubset?: (options: LoadSubsetOptions) => Promise<void>
}

// =============================================================================
// Type Utilities
// =============================================================================

/**
 * Extracts the required properties from MongoDoCollectionConfig.
 *
 * Useful for creating partial configurations that only include
 * the mandatory fields.
 *
 * @typeParam TDocument - The document type stored in the collection
 *
 * @example
 * ```typescript
 * type RequiredUserConfig = RequiredMongoDoCollectionConfig<User>
 * // { id: string; endpoint: string; database: string; ... }
 * ```
 */
export type RequiredMongoDoCollectionConfig<TDocument = unknown> = Required<
  Pick<
    MongoDoCollectionConfig<TDocument>,
    'id' | 'endpoint' | 'database' | 'collectionName' | 'schema' | 'getKey'
  >
>

/**
 * Extracts the optional properties from MongoDoCollectionConfig.
 *
 * Useful for creating override objects that only contain optional settings.
 *
 * @typeParam TDocument - The document type stored in the collection
 *
 * @example
 * ```typescript
 * type OptionalUserConfig = OptionalMongoDoCollectionConfig<User>
 * // { authToken?: string; credentials?: MongoDoCredentials; ... }
 *
 * const overrides: OptionalUserConfig = {
 *   syncMode: 'eager',
 *   enableChangeStream: true,
 * }
 * ```
 */
export type OptionalMongoDoCollectionConfig<TDocument = unknown> = Partial<
  Pick<
    MongoDoCollectionConfig<TDocument>,
    'authToken' | 'credentials' | 'syncMode' | 'enableChangeStream'
  >
>

/**
 * Creates a config type with specific optional properties made required.
 *
 * @typeParam TDocument - The document type stored in the collection
 * @typeParam K - Keys of optional properties to make required
 *
 * @example
 * ```typescript
 * // Config that requires auth token
 * type AuthenticatedConfig = WithRequiredConfig<User, 'authToken'>
 *
 * // Config that requires both auth token and sync mode
 * type StrictConfig = WithRequiredConfig<User, 'authToken' | 'syncMode'>
 * ```
 */
export type WithRequiredConfig<
  TDocument = unknown,
  K extends keyof OptionalMongoDoCollectionConfig<TDocument> = never,
> = MongoDoCollectionConfig<TDocument> & Required<Pick<MongoDoCollectionConfig<TDocument>, K>>

/**
 * Extracts the document type from a MongoDoCollectionConfig.
 *
 * @typeParam TConfig - A MongoDoCollectionConfig type
 *
 * @example
 * ```typescript
 * const userConfig: MongoDoCollectionConfig<User> = { ... }
 * type ExtractedUser = InferDocumentType<typeof userConfig>
 * // User
 * ```
 */
export type InferDocumentType<TConfig> = TConfig extends MongoDoCollectionConfig<infer T>
  ? T
  : never

/**
 * Type guard to check if a value is a valid MongoDoCollectionConfig.
 *
 * @param value - The value to check
 * @returns True if the value has all required properties
 *
 * @example
 * ```typescript
 * if (isMongoDoCollectionConfig(config)) {
 *   // config is typed as MongoDoCollectionConfig<unknown>
 *   console.log(config.id, config.endpoint)
 * }
 * ```
 */
export function isMongoDoCollectionConfig(
  value: unknown
): value is MongoDoCollectionConfig<unknown> {
  if (!value || typeof value !== 'object') return false
  const config = value as Record<string, unknown>
  return (
    typeof config.id === 'string' &&
    typeof config.endpoint === 'string' &&
    typeof config.database === 'string' &&
    typeof config.collectionName === 'string' &&
    typeof config.schema === 'object' &&
    typeof config.getKey === 'function'
  )
}
