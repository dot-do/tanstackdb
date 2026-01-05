import { ZodSchema } from 'zod';
import { Collection } from '@tanstack/db';

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
interface MongoInsertEvent<T> {
    /** Discriminator for insert operations */
    operationType: 'insert';
    /** The complete document that was inserted */
    fullDocument: T;
    /** The unique identifier of the inserted document */
    documentKey: {
        _id: string;
    };
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
interface MongoUpdateEvent<T> {
    /** Discriminator for update operations */
    operationType: 'update';
    /** The complete document after the update */
    fullDocument: T;
    /** The unique identifier of the updated document */
    documentKey: {
        _id: string;
    };
    /** Details about what fields were changed */
    updateDescription: {
        /** Fields that were added or modified */
        updatedFields: Partial<T>;
        /** Names of fields that were removed */
        removedFields: string[];
    };
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
interface MongoDeleteEvent<T> {
    /** Discriminator for delete operations */
    operationType: 'delete';
    /** The unique identifier of the deleted document */
    documentKey: {
        _id: string;
    };
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
interface MongoReplaceEvent<T> {
    /** Discriminator for replace operations */
    operationType: 'replace';
    /** The complete new document that replaced the old one */
    fullDocument: T;
    /** The unique identifier of the replaced document */
    documentKey: {
        _id: string;
    };
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
type MongoChangeEvent<T> = MongoInsertEvent<T> | MongoUpdateEvent<T> | MongoDeleteEvent<T> | MongoReplaceEvent<T>;
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
interface ChangeMessage<T> {
    /** The type of change operation */
    type: 'insert' | 'update' | 'delete';
    /** The unique key identifying the document/record */
    key: string;
    /** The current value of the document (required for insert/update) */
    value: T;
    /** The previous value before the change (available for update/delete) */
    previousValue?: T;
    /** Optional metadata about the change */
    metadata?: Record<string, unknown>;
}

/**
 * The underlying string literal values for sync modes.
 * @internal
 */
type SyncModeValue = 'eager' | 'on-demand' | 'progressive';
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
type SyncMode = SyncModeValue;
/**
 * The underlying string literal values for conflict strategies.
 * @internal
 */
type ConflictStrategyValue = 'last-write-wins' | 'server-wins' | 'client-wins' | 'custom';
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
type ConflictStrategy = ConflictStrategyValue;
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
interface MongoDoCredentials {
    /** The username for authentication */
    username: string;
    /** The password for authentication */
    password: string;
}
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
interface MongoDoSyncConfig {
    /**
     * The mongo.do API endpoint URL.
     *
     * @example 'https://mongo.do/api'
     */
    endpoint?: string;
    /**
     * API key for authentication with the mongo.do service.
     *
     * @remarks
     * This is an alternative to using username/password credentials.
     * Store this securely and never commit to source control.
     */
    apiKey?: string;
    /**
     * Database name to connect to.
     *
     * @example 'myapp-production'
     */
    database?: string;
    /**
     * Collection name to sync with.
     *
     * @example 'users'
     */
    collection?: string;
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
    syncInterval?: number;
}
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
interface MongoDoCollectionConfig<TDocument = unknown> {
    /**
     * Unique identifier for this collection configuration.
     *
     * Used internally to track and manage the collection instance.
     * Should be unique across all collections in your application.
     *
     * @example 'users-collection'
     * @example 'products-v2'
     */
    id: string;
    /**
     * The mongo.do API endpoint URL.
     *
     * This is the base URL for all API requests to the mongo.do service.
     *
     * @example 'https://mongo.do/api'
     * @example 'https://custom.mongo.do/api/v2'
     */
    endpoint: string;
    /**
     * Database name to connect to.
     *
     * The name of the MongoDB database that contains your collection.
     *
     * @example 'myapp'
     * @example 'myapp-production'
     */
    database: string;
    /**
     * Collection name within the database.
     *
     * The name of the MongoDB collection to sync with.
     *
     * @example 'users'
     * @example 'products'
     */
    collectionName: string;
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
    schema: ZodSchema<TDocument>;
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
    getKey: (item: TDocument) => string;
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
    authToken?: string;
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
    credentials?: MongoDoCredentials;
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
    syncMode?: SyncMode;
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
    enableChangeStream?: boolean;
}
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
interface MongoComparisonOperators<T = unknown> {
    /** Matches values equal to the specified value */
    $eq?: T;
    /** Matches values not equal to the specified value */
    $ne?: T;
    /** Matches values greater than the specified value */
    $gt?: T;
    /** Matches values greater than or equal to the specified value */
    $gte?: T;
    /** Matches values less than the specified value */
    $lt?: T;
    /** Matches values less than or equal to the specified value */
    $lte?: T;
    /** Matches any of the values in the specified array */
    $in?: T[];
    /** Matches none of the values in the specified array */
    $nin?: T[];
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
interface MongoElementOperators {
    /** Matches documents that have (or don't have) the specified field */
    $exists?: boolean;
    /** Matches documents where the field is of the specified BSON type */
    $type?: string | number;
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
interface MongoStringOperators {
    /** Regular expression pattern to match */
    $regex?: string | RegExp;
    /** Regular expression options (i, m, s, x) */
    $options?: string;
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
interface MongoArrayOperators<T = unknown> {
    /** Matches arrays with the specified number of elements */
    $size?: number;
    /** Matches arrays containing all specified values */
    $all?: T[];
    /** Matches if any array element matches the condition */
    $elemMatch?: MongoFilterCondition<T>;
}
/**
 * Combined filter condition for a single field.
 *
 * Can be a direct value (equality match) or an object with operators.
 *
 * @typeParam T - The type of the field being filtered
 */
type MongoFilterCondition<T = unknown> = T | MongoComparisonOperators<T> | MongoElementOperators | MongoStringOperators | MongoArrayOperators<T extends (infer U)[] ? U : never>;
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
interface MongoLogicalOperators<T = Record<string, unknown>> {
    /** Joins conditions with logical AND (all must match) */
    $and?: Array<MongoFilterQuery<T>>;
    /** Joins conditions with logical OR (any must match) */
    $or?: Array<MongoFilterQuery<T>>;
    /** Inverts the condition (must NOT match) */
    $not?: MongoFilterQuery<T>;
    /** Joins conditions with logical NOR (none must match) */
    $nor?: Array<MongoFilterQuery<T>>;
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
type MongoFilterQuery<T = Record<string, unknown>> = {
    [K in keyof T]?: MongoFilterCondition<T[K]>;
} & MongoLogicalOperators<T>;
/**
 * Sort direction values.
 *
 * Supports both string ('asc'/'desc') and numeric (1/-1) notation.
 */
type SortDirection = 'asc' | 'desc' | 1 | -1;
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
type SortSpec = Record<string, SortDirection>;
/**
 * Cursor value type for pagination.
 *
 * Supports common MongoDB cursor value types.
 */
type CursorValue = string | number | Date;
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
interface LoadSubsetOptions<T = Record<string, unknown>> {
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
    where?: MongoFilterQuery<T>;
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
    orderBy?: SortSpec;
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
    limit?: number;
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
    offset?: number;
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
    cursor?: CursorValue;
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
    cursorField?: string;
}
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
interface SyncParams<T extends object> {
    /**
     * The collection being synced.
     *
     * Reference to the TanStack DB collection instance.
     */
    collection: Collection<T>;
    /**
     * Begin a sync transaction.
     *
     * Must be called before writing any changes.
     * All subsequent writes are batched until `commit()` is called.
     */
    begin: () => void;
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
    write: (change: ChangeMessage<T>) => void;
    /**
     * Commit the sync transaction.
     *
     * Finalizes all writes since `begin()` was called.
     * After commit, changes are applied to the collection.
     */
    commit: () => void;
    /**
     * Mark the sync as ready.
     *
     * Indicates that the initial sync is complete and the
     * collection is ready for use.
     */
    markReady: () => void;
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
interface SyncReturn {
    /**
     * Cleanup function to stop sync and release resources.
     *
     * Called when the collection is unmounted or sync is stopped.
     * Should close connections, remove event listeners, etc.
     */
    cleanup: () => void;
    /**
     * Optional function to load a subset of data.
     *
     * Allows loading additional data with filtering and pagination.
     *
     * @param options - Options for filtering and pagination
     * @returns Promise that resolves when data is loaded
     */
    loadSubset?: (options: LoadSubsetOptions) => Promise<void>;
}
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
type RequiredMongoDoCollectionConfig<TDocument = unknown> = Required<Pick<MongoDoCollectionConfig<TDocument>, 'id' | 'endpoint' | 'database' | 'collectionName' | 'schema' | 'getKey'>>;
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
type OptionalMongoDoCollectionConfig<TDocument = unknown> = Partial<Pick<MongoDoCollectionConfig<TDocument>, 'authToken' | 'credentials' | 'syncMode' | 'enableChangeStream'>>;
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
type WithRequiredConfig<TDocument = unknown, K extends keyof OptionalMongoDoCollectionConfig<TDocument> = never> = MongoDoCollectionConfig<TDocument> & Required<Pick<MongoDoCollectionConfig<TDocument>, K>>;
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
type InferDocumentType<TConfig> = TConfig extends MongoDoCollectionConfig<infer T> ? T : never;
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
declare function isMongoDoCollectionConfig(value: unknown): value is MongoDoCollectionConfig<unknown>;

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
/**
 * Re-export all types for convenient access.
 * Types are organized into three categories:
 * - Configuration types: Adapter configuration interfaces
 * - Event types: MongoDB change stream event representations
 * - Type utilities: Helper types for working with configurations
 */

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
declare function mongoDoCollectionOptions<TDocument = unknown>(config: MongoDoCollectionConfig<TDocument>): MongoDoCollectionConfig<TDocument>;
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
declare function createMongoDoCollection<TDocument = unknown>(config: MongoDoCollectionConfig<TDocument>): MongoDoCollectionConfig<TDocument>;

export { type ChangeMessage, type ConflictStrategy, type InferDocumentType, type LoadSubsetOptions, type MongoChangeEvent, type MongoDeleteEvent, type MongoDoCollectionConfig, type MongoDoCredentials, type MongoDoSyncConfig, type MongoInsertEvent, type MongoReplaceEvent, type MongoUpdateEvent, type OptionalMongoDoCollectionConfig, type RequiredMongoDoCollectionConfig, type SyncMode, type SyncParams, type SyncReturn, type WithRequiredConfig, createMongoDoCollection, isMongoDoCollectionConfig, mongoDoCollectionOptions };
