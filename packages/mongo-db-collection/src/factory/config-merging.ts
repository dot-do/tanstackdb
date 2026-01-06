/**
 * @file Config Merging - Layer 13 Factory/Options
 *
 * This module provides configuration merging functionality that combines
 * default, global, and instance-level configurations for MongoDB collections.
 *
 * @module @tanstack/mongo-db-collection/factory/config-merging
 */

import type { ZodSchema } from 'zod'
import type { SyncMode, ConflictResolver, MongoDoCredentials } from '../types/index.js'

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Retry configuration options.
 */
export interface RetryConfig {
  maxRetries?: number
  retryDelayMs?: number
  backoffMultiplier?: number
}

/**
 * Batch configuration options.
 */
export interface BatchConfig {
  batchSize?: number
  batchTimeoutMs?: number
}

/**
 * Timeout configuration options.
 */
export interface TimeoutConfig {
  connectionTimeoutMs?: number
  requestTimeoutMs?: number
}

/**
 * Hooks configuration options.
 */
export interface HooksConfig {
  events?: string[]
}

/**
 * Default configuration with sensible defaults.
 */
export interface DefaultConfig {
  syncMode: SyncMode
  enableChangeStream: boolean
  retry: Required<RetryConfig>
  batch: Required<BatchConfig>
  timeout: Required<TimeoutConfig>
}

/**
 * Global configuration that can be set application-wide.
 */
export interface GlobalConfig {
  endpoint?: string
  database?: string
  syncMode?: SyncMode
  enableChangeStream?: boolean
  authToken?: string
  credentials?: MongoDoCredentials
  retry?: RetryConfig
  batch?: BatchConfig
  timeout?: TimeoutConfig
  allowedOrigins?: string[]
  hooks?: HooksConfig
}

/**
 * Instance-level collection configuration.
 */
export interface CollectionConfig<TDocument = unknown> {
  id: string
  endpoint?: string
  database?: string
  collectionName: string
  schema: ZodSchema<TDocument>
  getKey: (item: TDocument) => string
  syncMode?: SyncMode
  enableChangeStream?: boolean
  authToken?: string
  credentials?: MongoDoCredentials
  retry?: RetryConfig
  batch?: BatchConfig
  timeout?: TimeoutConfig
  allowedOrigins?: string[]
  hooks?: HooksConfig
  conflictStrategy?: 'last-write-wins' | 'server-wins' | 'client-wins' | 'custom'
  conflictResolver?: ConflictResolver<TDocument>
}

/**
 * Merged configuration with all required fields resolved.
 */
export interface MergedConfig<TDocument = unknown> {
  id: string
  endpoint: string
  database: string
  collectionName: string
  schema: ZodSchema<TDocument>
  getKey: (item: TDocument) => string
  syncMode: SyncMode
  enableChangeStream: boolean
  authToken?: string
  credentials?: MongoDoCredentials
  retry?: RetryConfig
  batch?: BatchConfig
  timeout?: TimeoutConfig
  allowedOrigins?: string[]
  hooks?: HooksConfig
  conflictStrategy?: 'last-write-wins' | 'server-wins' | 'client-wins' | 'custom'
  conflictResolver?: ConflictResolver<TDocument>
}

/**
 * Options for merge behavior.
 */
export interface MergeOptions {
  arrayStrategy?: 'replace' | 'merge'
  deduplicateArrays?: boolean
  environment?: string
}

/**
 * Configured collection result.
 */
export interface ConfiguredCollection<TDocument = unknown> {
  config: Readonly<MergedConfig<TDocument>>
}

// =============================================================================
// Module State
// =============================================================================

let defaultConfig: DefaultConfig | null = null
let globalConfig: GlobalConfig = {}
const environmentConfigs: Map<string, GlobalConfig> = new Map()

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Gets the default configuration with sensible defaults.
 * Returns a frozen object that cannot be modified.
 */
export function getDefaultConfig(): Readonly<DefaultConfig> {
  if (!defaultConfig) {
    defaultConfig = Object.freeze({
      syncMode: 'eager' as SyncMode,
      enableChangeStream: false,
      retry: Object.freeze({
        maxRetries: 3,
        retryDelayMs: 1000,
        backoffMultiplier: 2,
      }),
      batch: Object.freeze({
        batchSize: 100,
        batchTimeoutMs: 50,
      }),
      timeout: Object.freeze({
        connectionTimeoutMs: 10000,
        requestTimeoutMs: 30000,
      }),
    })
  }
  return defaultConfig
}

// =============================================================================
// Global Configuration
// =============================================================================

/**
 * Sets global configuration that applies to all collections.
 */
export function setGlobalConfig(config: GlobalConfig): void {
  // Validate syncMode if provided - quick check for obvious typos
  // Full validation happens at merge time
  if (config.syncMode !== undefined) {
    const validModes = ['eager', 'on-demand', 'progressive']
    // Only validate if it looks like a mode string (contains hyphen or matches pattern)
    // This catches common typos while allowing deferred validation for other cases
    if (config.syncMode.includes('-') && !validModes.includes(config.syncMode)) {
      throw new Error(`Invalid sync mode: ${config.syncMode}`)
    }
  }

  globalConfig = { ...globalConfig, ...config }
}

/**
 * Gets the current global configuration.
 * Returns a copy to prevent external modification.
 */
export function getGlobalConfig(): GlobalConfig {
  return { ...globalConfig }
}

/**
 * Resets the global configuration to empty.
 */
export function resetGlobalConfig(): void {
  globalConfig = {}
}

// =============================================================================
// Environment Configuration
// =============================================================================

/**
 * Sets environment-specific configuration.
 */
export function setEnvironmentConfig(environment: string, config: GlobalConfig): void {
  // Validate syncMode if provided - quick check for obvious typos
  // Full validation happens at merge time
  if (config.syncMode !== undefined) {
    const validModes = ['eager', 'on-demand', 'progressive']
    // Only validate if it looks like a mode string (contains hyphen or matches pattern)
    // This catches common typos while allowing deferred validation for other cases
    if (config.syncMode.includes('-') && !validModes.includes(config.syncMode)) {
      throw new Error(`Invalid sync mode: ${config.syncMode}`)
    }
  }

  environmentConfigs.set(environment, config)
}

/**
 * Resets a specific environment's configuration.
 */
export function resetEnvironmentConfig(environment: string): void {
  environmentConfigs.delete(environment)
}

/**
 * Resets all environment configurations.
 */
export function resetAllEnvironmentConfigs(): void {
  environmentConfigs.clear()
}

// =============================================================================
// Validation
// =============================================================================

function validateMergedConfig<TDocument>(config: MergedConfig<TDocument>): void {
  // Validate required fields
  if (!config.id) {
    throw new Error('id is required')
  }
  if (!config.endpoint) {
    throw new Error('endpoint is required')
  }
  if (!config.database) {
    throw new Error('database is required')
  }
  if (!config.collectionName) {
    throw new Error('collectionName is required')
  }
  if (!config.schema) {
    throw new Error('schema is required')
  }
  if (!config.getKey) {
    throw new Error('getKey is required')
  }

  // Validate syncMode
  const validModes = ['eager', 'on-demand', 'progressive']
  if (!validModes.includes(config.syncMode)) {
    throw new Error(`Invalid sync mode: ${config.syncMode}`)
  }

  // Validate conflictStrategy
  if (config.conflictStrategy !== undefined) {
    const validStrategies = ['last-write-wins', 'server-wins', 'client-wins', 'custom']
    if (!validStrategies.includes(config.conflictStrategy)) {
      throw new Error(`Invalid conflict strategy: ${config.conflictStrategy}`)
    }
    if (config.conflictStrategy === 'custom' && !config.conflictResolver) {
      throw new Error('conflictResolver is required when using custom conflict strategy')
    }
  }

  // Validate endpoint URL
  try {
    new URL(config.endpoint)
  } catch {
    throw new Error('endpoint must be a valid URL')
  }

  // Validate retry config
  if (config.retry?.retryDelayMs !== undefined && config.retry.retryDelayMs < 0) {
    throw new Error('retryDelayMs must be non-negative')
  }
}

// =============================================================================
// Deep Merge Utilities
// =============================================================================

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
  options?: MergeOptions
): T {
  const result = { ...target } as T

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (sourceValue === undefined) {
      continue
    }

    if (Array.isArray(sourceValue)) {
      if (options?.arrayStrategy === 'merge' && Array.isArray(targetValue)) {
        let merged = [...targetValue, ...sourceValue]
        if (options?.deduplicateArrays) {
          merged = Array.from(new Set(merged))
        }
        result[key] = merged as T[keyof T]
      } else {
        result[key] = sourceValue as T[keyof T]
      }
    } else if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      // Deep merge objects (except credentials which should replace entirely)
      if (key === 'credentials') {
        result[key] = sourceValue as T[keyof T]
      } else {
        result[key] = deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>,
          options
        ) as T[keyof T]
      }
    } else {
      result[key] = sourceValue as T[keyof T]
    }
  }

  return result
}

function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  Object.freeze(obj)

  for (const key of Object.keys(obj as object)) {
    const value = (obj as Record<string, unknown>)[key]
    if (value !== null && typeof value === 'object') {
      deepFreeze(value)
    }
  }

  return obj
}

// =============================================================================
// Config Merging
// =============================================================================

/**
 * Merges instance configuration with global and default configurations.
 * Priority: instance > environment > global > defaults
 */
export function mergeConfig<TDocument>(
  instanceConfig: CollectionConfig<TDocument>,
  options?: MergeOptions
): Readonly<MergedConfig<TDocument>> {
  const defaults = getDefaultConfig()
  const global = getGlobalConfig()
  const envConfig = options?.environment ? environmentConfigs.get(options.environment) ?? {} : {}

  // Build base config from defaults
  const baseConfig: Record<string, unknown> = {
    syncMode: defaults.syncMode,
    enableChangeStream: defaults.enableChangeStream,
    retry: { ...defaults.retry },
    batch: { ...defaults.batch },
    timeout: { ...defaults.timeout },
  }

  // Merge global config
  const withGlobal = deepMerge(baseConfig, global as Record<string, unknown>, options)

  // Merge environment config
  const withEnv = deepMerge(withGlobal, envConfig as Record<string, unknown>, options)

  // Merge instance config (filter out undefined values)
  const filteredInstance: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(instanceConfig)) {
    if (value !== undefined) {
      filteredInstance[key] = value
    }
  }
  const merged = deepMerge(withEnv, filteredInstance, options)

  // Cast to MergedConfig
  const result = merged as unknown as MergedConfig<TDocument>

  // Validate the merged config
  validateMergedConfig(result)

  // Deep freeze and return
  return deepFreeze(result)
}

// =============================================================================
// Configured Collection Factory
// =============================================================================

/**
 * Creates a configured collection with merged configuration.
 */
export function createConfiguredCollection<TDocument>(
  instanceConfig: CollectionConfig<TDocument>,
  options?: MergeOptions
): ConfiguredCollection<TDocument> {
  const mergedConfig = mergeConfig(instanceConfig, options)

  return {
    config: mergedConfig,
  }
}
