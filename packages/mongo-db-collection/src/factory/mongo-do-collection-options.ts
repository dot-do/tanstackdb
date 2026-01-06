/**
 * MongoDoCollectionOptions Factory - Stub for TDD RED Phase
 *
 * This file contains stub exports to allow tests to run and fail.
 * The actual implementation will be added in the GREEN phase.
 *
 * Bead ID: tanstackdb-po0.151 (RED phase stub)
 *
 * @module @tanstack/mongo-db-collection/factory/mongo-do-collection-options
 */

import type { ZodSchema } from 'zod'
import type {
  MongoDoCollectionConfig,
  SyncMode,
  ConflictStrategy,
  ConflictResolver,
  MongoDoCredentials,
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
// Stub Implementations (RED Phase)
// =============================================================================

/**
 * Creates collection options configured for mongo.do sync.
 *
 * @stub This is a RED phase stub - implementation pending
 */
export function createMongoDoCollectionOptions<T = unknown>(
  _config: MongoDoCollectionOptionsConfig<T>
): MongoDoCollectionOptionsResult<T> {
  throw new Error('Not implemented - RED phase stub')
}

/**
 * Validates collection configuration.
 *
 * @stub This is a RED phase stub - implementation pending
 */
export function validateCollectionConfig(
  _config: Partial<MongoDoCollectionOptionsConfig>
): CollectionConfigValidationResult {
  throw new Error('Not implemented - RED phase stub')
}

/**
 * Merges configuration with defaults.
 *
 * @stub This is a RED phase stub - implementation pending
 */
export function mergeWithDefaults<T = unknown>(
  _config: MongoDoCollectionOptionsConfig<T>,
  _customDefaults?: CollectionConfigDefaults
): MongoDoCollectionOptionsResult<T> {
  throw new Error('Not implemented - RED phase stub')
}
