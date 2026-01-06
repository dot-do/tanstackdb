/**
 * MongoDoCollectionOptions Factory - GREEN Phase Implementation
 *
 * This module provides factory functions for creating TanStack DB
 * collection options configured for mongo.do sync.
 *
 * Bead ID: tanstackdb-po0.151 (GREEN phase implementation)
 *
 * @module @tanstack/mongo-db-collection/factory/mongo-do-collection-options
 */

import type { ZodSchema } from 'zod'
import {
  type MongoDoCollectionConfig,
  type SyncMode,
  type ConflictStrategy,
  type ConflictResolver,
  type MongoDoCredentials,
  isSyncMode,
  isConflictStrategy,
  SYNC_MODES,
  CONFLICT_STRATEGIES,
} from '../types.js'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Timestamp configuration for automatic timestamp fields
 */
export interface TimestampConfig {
  createdAt?: string
  updatedAt?: string
  auto?: boolean
}

/**
 * Validation configuration options
 */
export interface ValidationConfig {
  enabled?: boolean
  strict?: boolean
  onRead?: boolean
  onWrite?: boolean
  onError?: (error: Error, document: unknown) => void
}

/**
 * Transform configuration for read/write operations
 */
export interface TransformConfig<T> {
  read?: (doc: unknown) => T
  write?: (doc: T) => unknown
}

/**
 * Type coercion configuration
 */
export interface TypeCoercionConfig {
  dates?: boolean
  objectIds?: boolean
  numbers?: boolean
  custom?: (value: unknown, type: string) => unknown
}

/**
 * Retry configuration for failed operations
 */
export interface RetryConfig {
  maxAttempts?: number
  delay?: number
  exponentialBackoff?: boolean
  maxDelay?: number
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  enabled?: boolean
  ttl?: number
  maxSize?: number
}

/**
 * Offline storage adapter interface
 */
export interface OfflineStorageAdapter {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  remove: (key: string) => Promise<void>
}

/**
 * Offline mode configuration
 */
export interface OfflineConfig {
  enabled?: boolean
  storage?: OfflineStorageAdapter
  syncOnReconnect?: boolean
}

/**
 * Hook functions for sync lifecycle
 */
export interface HooksConfig<T> {
  beforeSync?: (data: T[]) => void | Promise<void>
  afterSync?: (data: T[]) => void | Promise<void>
  onError?: (error: Error) => void | Promise<void>
  onConflict?: (context: unknown) => void | Promise<void>
}

/**
 * Logger interface
 */
export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  level?: 'debug' | 'info' | 'warn' | 'error'
  logger?: Logger
}

/**
 * Configuration input for createMongoDoCollectionOptions
 */
export interface MongoDoCollectionOptionsConfig<T = unknown> {
  // Required
  collectionName: string

  // Optional identification
  id?: string

  // Connection
  endpoint?: string
  database?: string

  // Authentication
  authToken?: string
  credentials?: MongoDoCredentials
  apiKey?: string

  // Schema and key
  schema?: ZodSchema<T>
  getKey?: (item: T) => string
  idField?: string

  // Sync configuration
  syncMode?: SyncMode
  enableChangeStream?: boolean
  realtime?: boolean
  syncInterval?: number
  batchSize?: number

  // Conflict resolution
  conflictStrategy?: ConflictStrategy
  conflictResolver?: ConflictResolver<T>

  // Timestamps
  timestamps?: TimestampConfig

  // Validation
  validation?: ValidationConfig

  // Transforms
  transforms?: TransformConfig<T>

  // Field mapping
  fieldMap?: Record<string, string>
  reverseFieldMap?: Record<string, string>

  // Type coercion
  typeCoercion?: TypeCoercionConfig | false

  // Retry
  retry?: RetryConfig

  // Cache
  cache?: CacheConfig

  // Offline
  offline?: OfflineConfig

  // Hooks
  hooks?: HooksConfig<T>

  // Logging
  logging?: LoggingConfig
}

/**
 * Result type from createMongoDoCollectionOptions
 */
export interface MongoDoCollectionOptionsResult<T = unknown>
  extends MongoDoCollectionConfig<T> {
  // Additional computed/defaulted fields
  batchSize: number
  syncInterval: number
  conflictStrategy: ConflictStrategy
  idField: string
  realtime?: boolean
  apiKey?: string
  timestamps?: TimestampConfig
  validation?: ValidationConfig
  transforms?: TransformConfig<T>
  fieldMap?: Record<string, string>
  reverseFieldMap?: Record<string, string>
  typeCoercion?: TypeCoercionConfig | false
  retry?: RetryConfig
  cache?: CacheConfig
  offline?: OfflineConfig
  hooks?: HooksConfig<T>
  logging?: LoggingConfig
  conflictResolver?: ConflictResolver<T>
}

/**
 * Validation error for collection config
 */
export interface CollectionConfigValidationError {
  field: string
  message: string
  code?: string
}

/**
 * Validation result
 */
export interface CollectionConfigValidationResult {
  valid: boolean
  errors: CollectionConfigValidationError[]
}

/**
 * Default configuration values
 */
export interface CollectionConfigDefaults {
  endpoint?: string
  database?: string
  syncMode?: SyncMode
  conflictStrategy?: ConflictStrategy
  batchSize?: number
  syncInterval?: number
  enableChangeStream?: boolean
  idField?: string
}

// =============================================================================
// Default Values
// =============================================================================

const DEFAULT_ENDPOINT = 'https://mongo.do/api'
const DEFAULT_DATABASE = 'default'
const DEFAULT_SYNC_MODE: SyncMode = 'eager'
const DEFAULT_CONFLICT_STRATEGY: ConflictStrategy = 'last-write-wins'
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_SYNC_INTERVAL = 10000
const DEFAULT_ENABLE_CHANGE_STREAM = false
const DEFAULT_ID_FIELD = '_id'

// MongoDB collection name constraints
const MAX_COLLECTION_NAME_LENGTH = 255
const INVALID_COLLECTION_NAME_CHARS = /\$/
const SYSTEM_COLLECTION_PREFIX = 'system.'

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validates a collection name according to MongoDB constraints.
 *
 * @param name - The collection name to validate
 * @returns An array of validation errors (empty if valid)
 */
function validateCollectionName(name: string): CollectionConfigValidationError[] {
  const errors: CollectionConfigValidationError[] = []

  if (!name || name.trim() === '') {
    errors.push({
      field: 'collectionName',
      message: 'Collection name is required and cannot be empty',
      code: 'REQUIRED',
    })
    return errors
  }

  if (name.length > MAX_COLLECTION_NAME_LENGTH) {
    errors.push({
      field: 'collectionName',
      message: `Collection name length exceeds maximum of ${MAX_COLLECTION_NAME_LENGTH} characters`,
      code: 'MAX_LENGTH',
    })
  }

  if (INVALID_COLLECTION_NAME_CHARS.test(name)) {
    errors.push({
      field: 'collectionName',
      message: 'Invalid collection name: contains invalid characters ($)',
      code: 'INVALID_CHARS',
    })
  }

  if (name.startsWith(SYSTEM_COLLECTION_PREFIX)) {
    errors.push({
      field: 'collectionName',
      message: 'System collections (starting with "system.") are reserved',
      code: 'RESERVED',
    })
  }

  return errors
}

/**
 * Validates a URL endpoint.
 *
 * @param endpoint - The endpoint URL to validate
 * @returns An array of validation errors (empty if valid)
 */
function validateEndpoint(endpoint: string): CollectionConfigValidationError[] {
  const errors: CollectionConfigValidationError[] = []

  try {
    new URL(endpoint)
  } catch {
    errors.push({
      field: 'endpoint',
      message: 'Invalid URL format for endpoint',
      code: 'INVALID_URL',
    })
  }

  return errors
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Creates collection options configured for mongo.do sync.
 *
 * @typeParam T - The document type for the collection
 * @param config - The configuration options
 * @returns The complete collection options with defaults applied
 * @throws Error if the configuration is invalid
 */
export function createMongoDoCollectionOptions<T = unknown>(
  config: MongoDoCollectionOptionsConfig<T>
): MongoDoCollectionOptionsResult<T> {
  // Validate required fields
  if (!config.collectionName) {
    throw new Error('Collection name is required')
  }

  // Validate collection name
  const nameErrors = validateCollectionName(config.collectionName)
  if (nameErrors.length > 0) {
    throw new Error(nameErrors[0].message)
  }

  // Validate numeric fields
  if (config.syncInterval !== undefined && config.syncInterval < 0) {
    throw new Error('Sync interval cannot be negative')
  }

  if (config.batchSize !== undefined) {
    if (config.batchSize < 0) {
      throw new Error('Batch size cannot be negative')
    }
    if (config.batchSize === 0) {
      throw new Error('Batch size cannot be zero')
    }
  }

  // Validate sync mode
  if (config.syncMode !== undefined && !isSyncMode(config.syncMode)) {
    throw new Error(`Invalid sync mode: must be one of ${SYNC_MODES.join(', ')}`)
  }

  // Validate conflict strategy
  if (config.conflictStrategy !== undefined && !isConflictStrategy(config.conflictStrategy)) {
    throw new Error(`Invalid conflict strategy: must be one of ${CONFLICT_STRATEGIES.join(', ')}`)
  }

  // Validate authentication - cannot have both authToken and credentials
  if (config.authToken && config.credentials) {
    throw new Error('Cannot specify both authToken and credentials - choose one authentication method')
  }

  // Validate custom conflict strategy requires a resolver
  if (config.conflictStrategy === 'custom' && !config.conflictResolver) {
    throw new Error('Custom conflict strategy requires a conflictResolver function')
  }

  // Validate that we have a way to get keys when schema is provided and both getKey and idField are explicitly undefined
  // This catches the case where user explicitly sets both to undefined (intentionally removing key extraction)
  if (
    config.schema &&
    Object.prototype.hasOwnProperty.call(config, 'getKey') &&
    config.getKey === undefined &&
    Object.prototype.hasOwnProperty.call(config, 'idField') &&
    config.idField === undefined
  ) {
    throw new Error('Must provide either getKey function or idField when using schema')
  }

  // Build the result with defaults
  const result: MongoDoCollectionOptionsResult<T> = {
    // Required fields with defaults
    id: config.id ?? config.collectionName,
    endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
    database: config.database ?? DEFAULT_DATABASE,
    collectionName: config.collectionName,
    schema: config.schema as ZodSchema<T>,
    getKey: config.getKey ?? ((item: T) => (item as Record<string, unknown>)[config.idField ?? DEFAULT_ID_FIELD] as string),

    // Sync settings with defaults
    syncMode: config.syncMode ?? DEFAULT_SYNC_MODE,
    enableChangeStream: config.enableChangeStream ?? DEFAULT_ENABLE_CHANGE_STREAM,
    batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
    syncInterval: config.syncInterval ?? DEFAULT_SYNC_INTERVAL,
    conflictStrategy: config.conflictStrategy ?? DEFAULT_CONFLICT_STRATEGY,
    idField: config.idField ?? DEFAULT_ID_FIELD,

    // Authentication (optional)
    authToken: config.authToken,
    credentials: config.credentials,
    apiKey: config.apiKey,

    // Optional features
    realtime: config.realtime,
    timestamps: config.timestamps,
    validation: config.validation,
    transforms: config.transforms,
    fieldMap: config.fieldMap,
    reverseFieldMap: config.reverseFieldMap,
    typeCoercion: config.typeCoercion,
    retry: config.retry,
    cache: config.cache,
    offline: config.offline,
    hooks: config.hooks,
    logging: config.logging,
    conflictResolver: config.conflictResolver,
  }

  return result
}

/**
 * Validates collection configuration.
 *
 * @param config - The configuration to validate
 * @returns A validation result with valid flag and any errors
 */
export function validateCollectionConfig(
  config: Partial<MongoDoCollectionOptionsConfig>
): CollectionConfigValidationResult {
  const errors: CollectionConfigValidationError[] = []

  // Validate collection name
  if (config.collectionName !== undefined) {
    errors.push(...validateCollectionName(config.collectionName))
  }

  // Validate endpoint if provided
  if (config.endpoint !== undefined && config.endpoint !== '') {
    errors.push(...validateEndpoint(config.endpoint))
  }

  // Validate sync interval
  if (config.syncInterval !== undefined && config.syncInterval < 0) {
    errors.push({
      field: 'syncInterval',
      message: 'Sync interval cannot be negative',
      code: 'NEGATIVE_VALUE',
    })
  }

  // Validate batch size
  if (config.batchSize !== undefined) {
    if (config.batchSize < 0) {
      errors.push({
        field: 'batchSize',
        message: 'Batch size cannot be negative',
        code: 'NEGATIVE_VALUE',
      })
    } else if (config.batchSize === 0) {
      errors.push({
        field: 'batchSize',
        message: 'Batch size cannot be zero',
        code: 'ZERO_VALUE',
      })
    }
  }

  // Validate sync mode
  if (config.syncMode !== undefined && !isSyncMode(config.syncMode)) {
    errors.push({
      field: 'syncMode',
      message: `Invalid sync mode: must be one of ${SYNC_MODES.join(', ')}`,
      code: 'INVALID_VALUE',
    })
  }

  // Validate conflict strategy
  if (config.conflictStrategy !== undefined && !isConflictStrategy(config.conflictStrategy)) {
    errors.push({
      field: 'conflictStrategy',
      message: `Invalid conflict strategy: must be one of ${CONFLICT_STRATEGIES.join(', ')}`,
      code: 'INVALID_VALUE',
    })
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Merges configuration with defaults.
 *
 * @typeParam T - The document type
 * @param config - The base configuration
 * @param customDefaults - Optional custom default values
 * @returns The merged configuration with all defaults applied
 */
export function mergeWithDefaults<T = unknown>(
  config: MongoDoCollectionOptionsConfig<T>,
  customDefaults?: CollectionConfigDefaults
): MongoDoCollectionOptionsResult<T> {
  // Determine defaults (custom or built-in)
  const defaults = {
    endpoint: customDefaults?.endpoint ?? DEFAULT_ENDPOINT,
    database: customDefaults?.database ?? DEFAULT_DATABASE,
    syncMode: customDefaults?.syncMode ?? DEFAULT_SYNC_MODE,
    conflictStrategy: customDefaults?.conflictStrategy ?? DEFAULT_CONFLICT_STRATEGY,
    batchSize: customDefaults?.batchSize ?? DEFAULT_BATCH_SIZE,
    syncInterval: customDefaults?.syncInterval ?? DEFAULT_SYNC_INTERVAL,
    enableChangeStream: customDefaults?.enableChangeStream ?? DEFAULT_ENABLE_CHANGE_STREAM,
    idField: customDefaults?.idField ?? DEFAULT_ID_FIELD,
  }

  // Create result object, preserving original object reference for immutability
  const result: MongoDoCollectionOptionsResult<T> = {
    // Required fields
    id: config.id ?? config.collectionName,
    endpoint: config.endpoint ?? defaults.endpoint,
    database: config.database ?? defaults.database,
    collectionName: config.collectionName,
    schema: config.schema as ZodSchema<T>,
    getKey: config.getKey ?? ((item: T) => (item as Record<string, unknown>)[config.idField ?? defaults.idField] as string),

    // Sync settings
    syncMode: config.syncMode ?? defaults.syncMode,
    enableChangeStream: config.enableChangeStream ?? defaults.enableChangeStream,
    batchSize: config.batchSize ?? defaults.batchSize,
    syncInterval: config.syncInterval ?? defaults.syncInterval,
    conflictStrategy: config.conflictStrategy ?? defaults.conflictStrategy,
    idField: config.idField ?? defaults.idField,

    // Authentication (preserve undefined/null as-is for explicit settings)
    authToken: config.authToken,
    credentials: config.credentials,
    apiKey: config.apiKey,

    // Optional features (deeply preserve nested objects)
    realtime: config.realtime,
    timestamps: config.timestamps,
    validation: config.validation,
    transforms: config.transforms,
    fieldMap: config.fieldMap,
    reverseFieldMap: config.reverseFieldMap,
    typeCoercion: config.typeCoercion,
    retry: config.retry,
    cache: config.cache,
    offline: config.offline,
    hooks: config.hooks,
    logging: config.logging,
    conflictResolver: config.conflictResolver,
  }

  return result
}
