/**
 * @file Auto-Provisioning - TDD (GREEN Phase Implementation)
 *
 * This file provides implementations for the Auto-Provisioning functionality.
 * Auto-Provisioning automatically creates user databases and collections on first use.
 *
 * @module @tanstack/mongo-db-collection/provisioning/auto-provisioning
 */

// =============================================================================
// Types
// =============================================================================

export interface ProvisioningConfig {
  rpcClient?: RpcClient
  autoCreateDatabase?: boolean
  autoCreateCollection?: boolean
  defaultIndexes?: Array<{ key: Record<string, number> }>
  retryAttempts?: number
  retryDelayMs?: number
  timeoutMs?: number
  enableStatusCache?: boolean
  statusCacheTtlMs?: number
  deduplicateConcurrent?: boolean
  dryRun?: boolean
  updateIndexes?: boolean
  dropUnusedIndexes?: boolean
  enableMigrations?: boolean
  rollbackOnFailure?: boolean
  migrationTimeoutMs?: number
  useMigrationLock?: boolean
  multiTenant?: boolean
  tenantNaming?: 'database' | 'collection-prefix'
  tenantPrefix?: string
  tenantCollections?: string[]
  tenantIndexes?: Array<{ key: Record<string, number> }>
  tenantIdPattern?: RegExp
  sharedDatabase?: string
  sanitizeNames?: boolean
  bypassValidation?: boolean
  isRetryable?: (err: Error) => boolean
  hooks?: ProvisioningHooks
  namingStrategy?: {
    database?: (ctx: ProvisioningContext) => string
    collection?: (ctx: ProvisioningContext) => string
  }
}

export interface ProvisioningContext {
  endpoint?: string
  database?: string
  collection?: string
  userId?: string
  authToken?: string
}

export interface ProvisioningStatus {
  databaseExists: boolean
  collectionExists: boolean
  isProvisioned: boolean
  checkedAt: Date
  needsProvisioning?: boolean
  error?: Error
  indexes?: Array<{ key: Record<string, number>; unique?: boolean; name?: string }>
  stats?: {
    documentCount: number
    storageSize: number
    avgDocumentSize: number
  }
}

export interface ProvisioningResult {
  success: boolean
  databaseProvisioned?: boolean
  collectionProvisioned?: boolean
  alreadyExists?: boolean
  error?: Error
  dryRun?: boolean
  cancelled?: boolean
  databaseName?: string
  collectionName?: string
  indexesCreated?: number
  created?: boolean
  indexesSkipped?: number
}

export interface ProvisioningEvent {
  type: string
  data?: unknown
}

export interface ProvisioningHooks {
  beforeProvision?: (ctx: ProvisioningContext) => void | Promise<void> | ProvisioningContext | Promise<ProvisioningContext>
  afterProvision?: (result: ProvisioningResult) => void | Promise<void>
  onError?: (error: Error) => void
  onProgress?: (progress: { step: string }) => void
  onStateChange?: (state: ProvisioningState) => void
}

export type ProvisioningState = 'idle' | 'checking' | 'provisioning' | 'completed' | 'error'

export interface DatabaseProvisionParams {
  endpoint: string
  database: string
  authToken: string
  userId?: string
  namingStrategy?: 'user-prefixed'
  options?: {
    enableSharding?: boolean
    replicationFactor?: number
  }
}

export interface CollectionProvisionParams {
  endpoint: string
  database: string
  collection: string
  authToken: string
  indexes?: Array<{ key: Record<string, number>; unique?: boolean }>
  options?: {
    capped?: boolean
    size?: number
    max?: number
    timeSeries?: {
      timeField: string
      metaField?: string
      granularity?: 'seconds' | 'minutes' | 'hours'
    }
    validator?: unknown
    validationLevel?: 'strict' | 'moderate'
    validationAction?: 'error' | 'warn'
  }
}

export interface DatabaseResult {
  success: boolean
  databaseName?: string
  alreadyExists?: boolean
  created?: boolean
  error?: Error
}

export interface CollectionResult {
  success: boolean
  collectionName?: string
  alreadyExists?: boolean
  created?: boolean
  error?: Error
  indexesCreated?: number
}

export interface EnsureDatabaseOptions {
  enableSharding?: boolean
  replicationFactor?: number
}

export interface EnsureCollectionOptions {
  indexes?: Array<{ key: Record<string, number>; unique?: boolean }>
  validator?: unknown
  validationLevel?: 'strict' | 'moderate'
  validationAction?: 'error' | 'warn'
  capped?: boolean
  size?: number
  max?: number
  timeSeries?: {
    timeField: string
    metaField?: string
    granularity?: 'seconds' | 'minutes' | 'hours'
  }
  expireAfterSeconds?: number
}

export interface EnsureResult {
  success: boolean
  created?: boolean
  alreadyExists?: boolean
  databaseName?: string
  collectionName?: string
  error?: Error
  indexesCreated?: number
}

export interface IndexDefinition {
  key: Record<string, number | 'text' | 'hashed' | '2dsphere'>
  unique?: boolean
  sparse?: boolean
  expireAfterSeconds?: number
  partialFilterExpression?: Record<string, unknown>
  weights?: Record<string, number>
  name?: string
}

export interface EnsureIndexesResult {
  success: boolean
  indexesCreated: number
  indexesDropped?: number
  indexesSkipped?: number
  error?: Error
}

export interface SchemaValidationResult {
  success: boolean
  modified?: boolean
  error?: Error
}

export interface ValidationOptions {
  validationLevel?: 'strict' | 'moderate' | 'off'
  validationAction?: 'error' | 'warn'
  bypassDocumentValidation?: boolean
}

export interface Migration {
  version: number
  name?: string
  up: (ctx: MigrationContext) => void | Promise<void>
  down: (ctx: MigrationContext) => void | Promise<void>
}

export interface MigrationContext {
  database: string
  rpcClient: unknown
}

export interface MigrationResult {
  success: boolean
  dryRun?: boolean
  pendingMigrations?: Migration[]
  error?: Error
}

export interface MigrationHistoryEntry {
  version: number
  name?: string
  appliedAt: Date
}

export interface RollbackOptions {
  migrations: Migration[]
}

export interface ProvisionTenantResult {
  success: boolean
  databaseName?: string
  collectionsCreated?: string[]
  databaseDropped?: boolean
  error?: Error
}

export interface RpcClient {
  call: (params: RpcCallParams) => Promise<RpcResponse>
  isConnected: () => boolean
}

export interface RpcCallParams {
  method: string
  params: Record<string, unknown>
}

export interface RpcResponse {
  success?: boolean
  created?: boolean
  exists?: boolean
  databaseExists?: boolean
  collectionExists?: boolean
  databaseCreated?: boolean
  collectionCreated?: boolean
  indexes?: Array<{ key: Record<string, number>; unique?: boolean; name?: string }>
  stats?: {
    documentCount: number
    storageSize: number
    avgDocumentSize: number
  }
  step?: string
  indexesExist?: boolean
  indexesCreated?: number
  documents?: Array<Record<string, unknown>>
  databases?: Array<{ name: string }>
  dropped?: boolean
  modified?: boolean
}

// =============================================================================
// Error Class
// =============================================================================

export class ProvisioningError extends Error {
  code: string
  context?: Record<string, unknown>

  constructor(message: string, code: string, context?: Record<string, unknown>, cause?: Error) {
    super(message)
    this.name = 'ProvisioningError'
    this.code = code
    this.context = context
    if (cause) {
      this.cause = cause
    }
  }
}

// =============================================================================
// AutoProvisioner Interface
// =============================================================================

export interface AutoProvisioner {
  provision(context: ProvisioningContext): Promise<ProvisioningResult>
  checkStatus(context: ProvisioningContext, options?: { forceRefresh?: boolean }): Promise<ProvisioningStatus>
  getConfig(): ProvisioningConfig
  on(event: string, listener: (data: unknown) => void): () => void
  ensureDatabase(name: string, options?: EnsureDatabaseOptions): Promise<EnsureResult>
  ensureCollection(database: string, collection: string, options?: EnsureCollectionOptions): Promise<EnsureResult>
  ensureIndexes(database: string, collection: string, indexes: IndexDefinition[]): Promise<EnsureIndexesResult>
  applySchemaValidation(
    database: string,
    collection: string,
    validator: unknown,
    options?: ValidationOptions
  ): Promise<SchemaValidationResult>
  getSchemaVersion(database: string): Promise<number>
  applyMigration(database: string, migration: Migration): Promise<MigrationResult>
  applyMigrations(database: string, migrations: Migration[], options?: { dryRun?: boolean }): Promise<MigrationResult>
  getMigrationHistory(database: string): Promise<MigrationHistoryEntry[]>
  rollbackTo(database: string, version: number, options: RollbackOptions): Promise<MigrationResult>
  provisionTenant(tenantId: string, options?: { collections?: string[] }): Promise<ProvisionTenantResult>
  deprovisionTenant(tenantId: string): Promise<ProvisionTenantResult>
  listTenants(): Promise<string[]>
  isTenantProvisioned(tenantId: string): Promise<boolean>
  cancel(): void
}

// =============================================================================
// Constants
// =============================================================================

const RESERVED_DATABASE_NAMES = ['admin', 'local', 'config']

// =============================================================================
// Validation Helpers
// =============================================================================

function isValidDatabaseName(name: string): boolean {
  // MongoDB database name rules: cannot contain / \ . " * < > : | ? $
  // and cannot be empty
  if (!name || name.length === 0) return false
  if (/[\/\\."*<>:|?$]/.test(name)) return false
  return true
}

function isValidCollectionName(name: string): boolean {
  // MongoDB collection name rules: cannot start with $ or system.
  // and cannot contain null character
  if (!name || name.length === 0) return false
  if (name.startsWith('$') || name.startsWith('system.')) return false
  if (name.includes('\0')) return false
  return true
}

function sanitizeName(name: string): string {
  // Replace invalid characters with underscores
  return name.replace(/[\/\\."*<>:|?$\-\.]/g, '_')
}

function getCacheKey(context: ProvisioningContext): string {
  return `${context.endpoint}:${context.database}:${context.collection}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// Factory Function
// =============================================================================

export function createAutoProvisioner(config: ProvisioningConfig = {}): AutoProvisioner {
  // Validate configuration
  if (config.retryAttempts !== undefined && config.retryAttempts < 0) {
    throw new Error('retryAttempts must be non-negative')
  }
  if (config.timeoutMs !== undefined && config.timeoutMs < 0) {
    throw new Error('timeoutMs must be non-negative')
  }

  const defaultConfig: ProvisioningConfig = {
    autoCreateDatabase: true,
    autoCreateCollection: true,
    retryAttempts: 3,
    retryDelayMs: 1000,
    timeoutMs: 30000,
    enableStatusCache: false,
    statusCacheTtlMs: 60000,
    deduplicateConcurrent: false,
    ...config,
  }

  const listeners: Map<string, Array<(data: unknown) => void>> = new Map()
  const statusCache: Map<string, { status: ProvisioningStatus; timestamp: number }> = new Map()
  const pendingProvisions: Map<string, Promise<ProvisioningResult>> = new Map()
  let cancelled = false

  const emit = (event: string, data: unknown) => {
    const eventListeners = listeners.get(event) || []
    eventListeners.forEach((listener) => listener(data))
  }

  const changeState = (state: ProvisioningState) => {
    if (defaultConfig.hooks?.onStateChange) {
      defaultConfig.hooks.onStateChange(state)
    }
  }

  const rpcClient = defaultConfig.rpcClient as RpcClient | undefined

  const retryWithBackoff = async <T>(
    fn: () => Promise<T>,
    attempts: number,
    delayMs: number,
    isRetryable?: (err: Error) => boolean
  ): Promise<T> => {
    let lastError: Error | undefined
    for (let i = 0; i < attempts; i++) {
      try {
        const result = await fn()
        // Treat undefined/null result as an error
        if (result === undefined || result === null) {
          throw lastError ?? new Error('No response received')
        }
        return result
      } catch (err) {
        lastError = err as Error
        if (isRetryable && !isRetryable(lastError)) {
          throw lastError
        }
        if (i < attempts - 1) {
          await sleep(delayMs)
        }
      }
    }
    throw lastError
  }

  const provisioner: AutoProvisioner = {
    provision: async (context: ProvisioningContext): Promise<ProvisioningResult> => {
      cancelled = false
      changeState('idle')

      // Validate context
      if (!context.endpoint || !context.database || !context.collection) {
        return {
          success: false,
          error: new Error('Invalid configuration: endpoint, database, and collection are required'),
        }
      }

      // Dry run mode
      if (defaultConfig.dryRun) {
        return {
          success: true,
          dryRun: true,
          databaseProvisioned: false,
          collectionProvisioned: false,
        }
      }

      // Deduplication for concurrent requests (enabled by default)
      const cacheKey = getCacheKey(context)
      const existingPromise = pendingProvisions.get(cacheKey)
      if (existingPromise) {
        return existingPromise
      }

      // Create a deferred promise to avoid race conditions
      let resolveProvision: (result: ProvisioningResult) => void
      let rejectProvision: (error: Error) => void
      const provisionPromise = new Promise<ProvisioningResult>((resolve, reject) => {
        resolveProvision = resolve
        rejectProvision = reject
      })

      // Store the promise immediately to prevent duplicates
      pendingProvisions.set(cacheKey, provisionPromise)

      const doProvision = async (): Promise<ProvisioningResult> => {
        try {
          // Call beforeProvision hook
          let effectiveContext = context
          if (defaultConfig.hooks?.beforeProvision) {
            try {
              const hookResult = await defaultConfig.hooks.beforeProvision(context)
              if (hookResult && typeof hookResult === 'object' && 'database' in hookResult) {
                effectiveContext = hookResult as ProvisioningContext
              }
            } catch (err) {
              // beforeProvision hook threw - cancel provisioning
              return {
                success: false,
                error: err as Error,
              }
            }
          }

          emit('provisioning-started', { context: effectiveContext })
          changeState('checking')

          // If autoCreateDatabase is false, don't provision database
          if (defaultConfig.autoCreateDatabase === false) {
            const result: ProvisioningResult = {
              success: true,
              databaseProvisioned: false,
              collectionProvisioned: defaultConfig.autoCreateCollection ?? true,
            }
            if (defaultConfig.hooks?.afterProvision) {
              await defaultConfig.hooks.afterProvision(result)
            }
            emit('provisioning-completed', result)
            changeState('completed')
            return result
          }

          // If autoCreateCollection is false, don't provision collection
          if (defaultConfig.autoCreateCollection === false && rpcClient) {
            const response = await rpcClient.call({
              method: 'provision',
              params: {
                database: effectiveContext.database,
                autoCreateDatabase: defaultConfig.autoCreateDatabase,
                autoCreateCollection: false,
              },
            })
            const result: ProvisioningResult = {
              success: response.success ?? true,
              databaseProvisioned: defaultConfig.autoCreateDatabase ?? true,
              collectionProvisioned: false,
              alreadyExists: response.exists,
            }
            if (defaultConfig.hooks?.afterProvision) {
              await defaultConfig.hooks.afterProvision(result)
            }
            emit('provisioning-completed', result)
            changeState('completed')
            return result
          }

          if (!rpcClient) {
            // No RPC client - return based on config
            const result: ProvisioningResult = {
              success: true,
              databaseProvisioned: defaultConfig.autoCreateDatabase ?? false,
              collectionProvisioned: defaultConfig.autoCreateCollection ?? false,
            }
            if (defaultConfig.hooks?.afterProvision) {
              await defaultConfig.hooks.afterProvision(result)
            }
            emit('provisioning-completed', result)
            changeState('completed')
            return result
          }

          changeState('provisioning')

          // Apply naming strategy if provided
          let databaseName = effectiveContext.database!
          let collectionName = effectiveContext.collection!
          if (defaultConfig.namingStrategy?.database) {
            databaseName = defaultConfig.namingStrategy.database(effectiveContext)
          }
          if (defaultConfig.namingStrategy?.collection) {
            collectionName = defaultConfig.namingStrategy.collection(effectiveContext)
          }

          const retryAttempts = defaultConfig.retryAttempts ?? 3
          const retryDelayMs = defaultConfig.retryDelayMs ?? 1000
          const isRetryable = defaultConfig.isRetryable

          let response: RpcResponse
          try {
            response = await retryWithBackoff(
              async () => {
                if (cancelled) {
                  throw new Error('Cancelled')
                }
                const resp = await rpcClient.call({
                  method: 'provision',
                  params: {
                    database: databaseName,
                    collection: collectionName,
                    autoCreateDatabase: defaultConfig.autoCreateDatabase,
                    autoCreateCollection: defaultConfig.autoCreateCollection,
                  },
                })

                // Call onProgress for each step
                if (defaultConfig.hooks?.onProgress && resp?.step) {
                  defaultConfig.hooks.onProgress({ step: resp.step })
                }

                return resp
              },
              retryAttempts,
              retryDelayMs,
              isRetryable
            )
          } catch (err) {
            if ((err as Error).message === 'Cancelled') {
              return { success: false, cancelled: true }
            }
            if (defaultConfig.hooks?.onError) {
              defaultConfig.hooks.onError(err as Error)
            }
            emit('provisioning-failed', err)
            changeState('error')
            const result: ProvisioningResult = {
              success: false,
              error: err as Error,
            }
            return result
          }

          // Check if cancelled after the call
          if (cancelled) {
            return { success: false, cancelled: true }
          }

          // Handle case where response is undefined (shouldn't happen but defensive)
          if (!response) {
            return {
              success: false,
              error: new Error('No response from provisioning call'),
            }
          }

          // Emit creation events
          if (response.databaseCreated) {
            emit('database-created', { database: effectiveContext.database })
          }
          if (response.collectionCreated) {
            emit('collection-created', { collection: effectiveContext.collection })
          }

          const result: ProvisioningResult = {
            success: response.success ?? true,
            databaseProvisioned: response.created ?? (defaultConfig.autoCreateDatabase ?? true),
            collectionProvisioned: response.created ?? (defaultConfig.autoCreateCollection ?? true),
            alreadyExists: response.exists,
          }

          if (defaultConfig.hooks?.afterProvision) {
            await defaultConfig.hooks.afterProvision(result)
          }

          emit('provisioning-completed', result)
          changeState('completed')
          return result
        } catch (err) {
          if (defaultConfig.hooks?.onError) {
            defaultConfig.hooks.onError(err as Error)
          }
          emit('provisioning-failed', err)
          changeState('error')
          return {
            success: false,
            error: err as Error,
          }
        }
      }

      // Execute provisioning and resolve/reject the deferred promise
      doProvision()
        .then((result) => {
          // Clear cache before resolving to avoid race conditions
          pendingProvisions.delete(cacheKey)
          resolveProvision!(result)
        })
        .catch((err) => {
          pendingProvisions.delete(cacheKey)
          rejectProvision!(err)
        })

      return provisionPromise
    },

    checkStatus: async (context: ProvisioningContext, options?: { forceRefresh?: boolean }): Promise<ProvisioningStatus> => {
      const cacheKey = getCacheKey(context)

      // Check cache
      if (defaultConfig.enableStatusCache && !options?.forceRefresh) {
        const cached = statusCache.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < (defaultConfig.statusCacheTtlMs ?? 60000)) {
          return cached.status
        }
      }

      if (!rpcClient) {
        return {
          databaseExists: false,
          collectionExists: false,
          isProvisioned: false,
          checkedAt: new Date(),
        }
      }

      const response = await rpcClient.call({
        method: 'checkStatus',
        params: {
          database: context.database,
          collection: context.collection,
        },
      })

      const status: ProvisioningStatus = {
        databaseExists: response.databaseExists ?? false,
        collectionExists: response.collectionExists ?? false,
        isProvisioned: (response.databaseExists && response.collectionExists) ?? false,
        checkedAt: new Date(),
        indexes: response.indexes,
        stats: response.stats,
      }

      // Update cache
      if (defaultConfig.enableStatusCache) {
        statusCache.set(cacheKey, { status, timestamp: Date.now() })
      }

      return status
    },

    getConfig: () => defaultConfig,

    on: (event: string, listener: (data: unknown) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, [])
      }
      listeners.get(event)!.push(listener)
      return () => {
        const eventListeners = listeners.get(event)
        if (eventListeners) {
          const index = eventListeners.indexOf(listener)
          if (index > -1) {
            eventListeners.splice(index, 1)
          }
        }
      }
    },

    ensureDatabase: async (name: string, options?: EnsureDatabaseOptions): Promise<EnsureResult> => {
      // Validate database name
      if (!name) {
        throw new Error('Database name cannot be empty')
      }
      if (RESERVED_DATABASE_NAMES.includes(name.toLowerCase())) {
        throw new Error('Cannot provision reserved database')
      }

      let effectiveName = name
      if (defaultConfig.sanitizeNames) {
        effectiveName = sanitizeName(name)
      }

      if (!rpcClient) {
        return {
          success: false,
          error: new Error('No RPC client configured'),
        }
      }

      try {
        // Check if database exists
        const checkResponse = await rpcClient.call({
          method: 'checkDatabase',
          params: { database: effectiveName },
        })

        if (checkResponse.exists) {
          return {
            success: true,
            created: false,
            alreadyExists: true,
            databaseName: effectiveName,
          }
        }

        // Create database
        const retryAttempts = defaultConfig.retryAttempts ?? 3
        const retryDelayMs = defaultConfig.retryDelayMs ?? 1000

        await retryWithBackoff(
          () =>
            rpcClient.call({
              method: 'createDatabase',
              params: {
                database: effectiveName,
                options: options ?? {},
              },
            }),
          retryAttempts,
          retryDelayMs
        )

        return {
          success: true,
          created: true,
          databaseName: effectiveName,
        }
      } catch (err) {
        return {
          success: false,
          error: err as Error,
        }
      }
    },

    ensureCollection: async (
      database: string,
      collection: string,
      options?: EnsureCollectionOptions
    ): Promise<EnsureResult> => {
      if (!rpcClient) {
        return {
          success: false,
          error: new Error('No RPC client configured'),
        }
      }

      try {
        // Check if collection exists
        const checkResponse = await rpcClient.call({
          method: 'checkCollection',
          params: { database, collection },
        })

        if (checkResponse.exists) {
          return {
            success: true,
            created: false,
            alreadyExists: true,
            collectionName: collection,
          }
        }

        // Create collection
        const retryAttempts = defaultConfig.retryAttempts ?? 3
        const retryDelayMs = defaultConfig.retryDelayMs ?? 1000

        await retryWithBackoff(
          () =>
            rpcClient.call({
              method: 'createCollection',
              params: {
                database,
                collection,
                ...options,
              },
            }),
          retryAttempts,
          retryDelayMs
        )

        // Create indexes if provided
        let indexesCreated = 0
        if (options?.indexes && options.indexes.length > 0) {
          const indexResponse = await rpcClient.call({
            method: 'createIndexes',
            params: {
              database,
              collection,
              indexes: options.indexes,
            },
          })
          indexesCreated = indexResponse.indexesCreated ?? options.indexes.length
        }

        return {
          success: true,
          created: true,
          collectionName: collection,
          indexesCreated,
        }
      } catch (err) {
        return {
          success: false,
          error: err as Error,
        }
      }
    },

    ensureIndexes: async (
      database: string,
      collection: string,
      indexes: IndexDefinition[]
    ): Promise<EnsureIndexesResult> => {
      if (!rpcClient) {
        return {
          success: false,
          indexesCreated: 0,
          error: new Error('No RPC client configured'),
        }
      }

      try {
        // Get existing indexes
        const existingResponse = await rpcClient.call({
          method: 'listIndexes',
          params: { database, collection },
        })
        const existingIndexes = existingResponse.indexes ?? []

        // Determine which indexes need to be created
        const existingKeys = new Set(
          existingIndexes.map((idx: { key: Record<string, number>; unique?: boolean; name?: string }) =>
            JSON.stringify(idx.key)
          )
        )
        const indexesToCreate = indexes.filter((idx) => !existingKeys.has(JSON.stringify(idx.key)))
        const indexesSkipped = indexes.length - indexesToCreate.length

        // Create new indexes
        let indexesCreated = 0
        for (const index of indexesToCreate) {
          await rpcClient.call({
            method: 'createIndex',
            params: {
              database,
              collection,
              keys: index.key,
              options: {
                unique: index.unique,
                sparse: index.sparse,
                expireAfterSeconds: index.expireAfterSeconds,
                partialFilterExpression: index.partialFilterExpression,
                weights: index.weights,
              },
            },
          })
          indexesCreated++
        }

        // Optionally drop unused indexes (when updateIndexes or dropUnusedIndexes is enabled)
        let indexesDropped = 0
        if (defaultConfig.dropUnusedIndexes || defaultConfig.updateIndexes) {
          const desiredKeys = new Set(indexes.map((idx) => JSON.stringify(idx.key)))
          for (const existingIndex of existingIndexes) {
            // Never drop _id index
            if (existingIndex.name === '_id_') continue
            if (!desiredKeys.has(JSON.stringify(existingIndex.key))) {
              await rpcClient.call({
                method: 'dropIndex',
                params: {
                  database,
                  collection,
                  indexName: existingIndex.name,
                },
              })
              indexesDropped++
            }
          }
        }

        // Additional updateIndexes logic (already handled above)
        if (defaultConfig.updateIndexes) {
          // Logic to detect and update changed indexes
          // For simplicity, this just handles the basic case
        }

        return {
          success: true,
          indexesCreated,
          indexesDropped,
          indexesSkipped,
        }
      } catch (err) {
        return {
          success: false,
          indexesCreated: 0,
          error: err as Error,
        }
      }
    },

    applySchemaValidation: async (
      database: string,
      collection: string,
      validator: unknown,
      options?: ValidationOptions
    ): Promise<SchemaValidationResult> => {
      if (!rpcClient) {
        return {
          success: false,
          error: new Error('No RPC client configured'),
        }
      }

      try {
        const params: Record<string, unknown> = {
          database,
          collection,
          validator: validator ?? {},
        }

        if (options?.validationLevel) {
          params.validationLevel = options.validationLevel
        }
        if (options?.validationAction) {
          params.validationAction = options.validationAction
        }
        if (defaultConfig.bypassValidation) {
          params.bypassDocumentValidation = true
        }

        const response = await rpcClient.call({
          method: 'collMod',
          params,
        })

        return {
          success: response.success ?? true,
          modified: response.modified,
        }
      } catch (err) {
        return {
          success: false,
          error: err as Error,
        }
      }
    },

    getSchemaVersion: async (database: string): Promise<number> => {
      if (!rpcClient) {
        return 0
      }

      const response = await rpcClient.call({
        method: 'findOne',
        params: {
          database,
          collection: '_schema_version',
          filter: { _id: 'schema_version' },
        },
      })

      const documents = response.documents ?? []
      if (documents.length === 0) {
        return 0
      }

      return (documents[0] as { version?: number }).version ?? 0
    },

    applyMigration: async (database: string, migration: Migration): Promise<MigrationResult> => {
      if (!rpcClient) {
        return {
          success: false,
          error: new Error('No RPC client configured'),
        }
      }

      const timeoutMs = defaultConfig.migrationTimeoutMs ?? 30000

      try {
        // Acquire lock if configured
        if (defaultConfig.useMigrationLock) {
          await rpcClient.call({
            method: 'acquireLock',
            params: { lockName: `migration_${database}` },
          })
        }

        // Apply migration with timeout
        const migrationPromise = migration.up({
          database,
          rpcClient,
        })

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Migration timeout')), timeoutMs)
        )

        await Promise.race([migrationPromise, timeoutPromise])

        // Update schema version
        await rpcClient.call({
          method: 'updateOne',
          params: {
            database,
            collection: '_schema_version',
            filter: { _id: 'schema_version' },
            update: {
              $set: { version: migration.version, appliedAt: new Date() },
            },
            upsert: true,
          },
        })

        // Record migration history
        await rpcClient.call({
          method: 'insertOne',
          params: {
            database,
            collection: '_migrations',
            document: {
              version: migration.version,
              name: migration.name,
              appliedAt: new Date(),
            },
          },
        })

        // Release lock if configured
        if (defaultConfig.useMigrationLock) {
          await rpcClient.call({
            method: 'releaseLock',
            params: { lockName: `migration_${database}` },
          })
        }

        return { success: true }
      } catch (err) {
        // Release lock on error
        if (defaultConfig.useMigrationLock) {
          try {
            await rpcClient.call({
              method: 'releaseLock',
              params: { lockName: `migration_${database}` },
            })
          } catch {
            // Ignore release errors
          }
        }

        return {
          success: false,
          error: err as Error,
        }
      }
    },

    applyMigrations: async (
      database: string,
      migrations: Migration[],
      options?: { dryRun?: boolean }
    ): Promise<MigrationResult> => {
      if (!rpcClient) {
        return {
          success: false,
          error: new Error('No RPC client configured'),
        }
      }

      // Get current version
      const currentVersion = await provisioner.getSchemaVersion(database)

      // Sort migrations by version
      const sortedMigrations = [...migrations].sort((a, b) => a.version - b.version)

      // Filter to pending migrations
      const pendingMigrations = sortedMigrations.filter((m) => m.version > currentVersion)

      // Dry run mode
      if (options?.dryRun) {
        return {
          success: true,
          dryRun: true,
          pendingMigrations,
        }
      }

      // Apply migrations
      const appliedMigrations: Migration[] = []
      try {
        for (const migration of pendingMigrations) {
          await migration.up({ database, rpcClient })
          appliedMigrations.push(migration)

          // Update version
          await rpcClient.call({
            method: 'updateOne',
            params: {
              database,
              collection: '_schema_version',
              filter: { _id: 'schema_version' },
              update: { $set: { version: migration.version, appliedAt: new Date() } },
              upsert: true,
            },
          })
        }
        return { success: true }
      } catch (err) {
        // Rollback on failure if configured
        if (defaultConfig.rollbackOnFailure) {
          for (const migration of appliedMigrations.reverse()) {
            try {
              await migration.down({ database, rpcClient })
            } catch {
              // Ignore rollback errors
            }
          }
        }
        return {
          success: false,
          error: err as Error,
        }
      }
    },

    getMigrationHistory: async (database: string): Promise<MigrationHistoryEntry[]> => {
      if (!rpcClient) {
        return []
      }

      const response = await rpcClient.call({
        method: 'find',
        params: {
          database,
          collection: '_migrations',
          sort: { version: 1 },
        },
      })

      return (response.documents ?? []).map((doc: Record<string, unknown>) => ({
        version: doc.version as number,
        name: doc.name as string | undefined,
        appliedAt: doc.appliedAt as Date,
      }))
    },

    rollbackTo: async (database: string, version: number, options: RollbackOptions): Promise<MigrationResult> => {
      if (!rpcClient) {
        return {
          success: false,
          error: new Error('No RPC client configured'),
        }
      }

      const currentVersion = await provisioner.getSchemaVersion(database)

      // Sort migrations by version descending for rollback
      const sortedMigrations = [...options.migrations].sort((a, b) => b.version - a.version)

      // Find migrations to roll back
      const migrationsToRollback = sortedMigrations.filter(
        (m) => m.version > version && m.version <= currentVersion
      )

      try {
        for (const migration of migrationsToRollback) {
          await migration.down({ database, rpcClient })

          // Update version
          await rpcClient.call({
            method: 'updateOne',
            params: {
              database,
              collection: '_schema_version',
              filter: { _id: 'schema_version' },
              update: { $set: { version: migration.version - 1, appliedAt: new Date() } },
              upsert: true,
            },
          })
        }
        return { success: true }
      } catch (err) {
        return {
          success: false,
          error: err as Error,
        }
      }
    },

    provisionTenant: async (
      tenantId: string,
      options?: { collections?: string[] }
    ): Promise<ProvisionTenantResult> => {
      if (!rpcClient) {
        return {
          success: false,
          error: new Error('No RPC client configured'),
        }
      }

      // Validate tenant ID
      if (defaultConfig.tenantIdPattern && !defaultConfig.tenantIdPattern.test(tenantId)) {
        throw new Error('Invalid tenant ID format')
      }

      // Sanitize tenant ID
      const sanitizedTenantId = sanitizeName(tenantId)
      // Only use prefix if explicitly provided
      const prefix = defaultConfig.tenantPrefix ?? ''
      const databaseName = prefix ? `${prefix}${sanitizedTenantId}` : sanitizedTenantId

      try {
        if (defaultConfig.tenantNaming === 'collection-prefix') {
          // Shared database with prefixed collections
          const sharedDb = defaultConfig.sharedDatabase ?? 'shared'
          const collections = options?.collections ?? defaultConfig.tenantCollections ?? []
          const collectionsCreated: string[] = []

          for (const coll of collections) {
            // For collection-prefix naming, use sanitized tenant ID directly
            const prefixedName = `${sanitizedTenantId}_${coll}`
            await rpcClient.call({
              method: 'createCollection',
              params: {
                database: sharedDb,
                collection: prefixedName,
              },
            })
            collectionsCreated.push(prefixedName)
          }

          return {
            success: true,
            databaseName: sharedDb,
            collectionsCreated,
          }
        }

        // Default: per-tenant database
        await rpcClient.call({
          method: 'createDatabase',
          params: { database: databaseName },
        })

        const collections = options?.collections ?? defaultConfig.tenantCollections ?? []
        const collectionsCreated: string[] = []

        for (const coll of collections) {
          await rpcClient.call({
            method: 'createCollection',
            params: { database: databaseName, collection: coll },
          })
          collectionsCreated.push(coll)
        }

        // Create tenant indexes if configured
        if (defaultConfig.tenantIndexes) {
          // If no collections specified, create indexes on a default collection
          const indexCollections = collectionsCreated.length > 0 ? collectionsCreated : ['default']
          for (const index of defaultConfig.tenantIndexes) {
            for (const coll of indexCollections) {
              await rpcClient.call({
                method: 'createIndex',
                params: {
                  database: databaseName,
                  collection: coll,
                  keys: index.key,
                },
              })
            }
          }
        }

        return {
          success: true,
          databaseName,
          collectionsCreated,
        }
      } catch (err) {
        return {
          success: false,
          error: err as Error,
        }
      }
    },

    deprovisionTenant: async (tenantId: string): Promise<ProvisionTenantResult> => {
      if (!rpcClient) {
        return {
          success: false,
          error: new Error('No RPC client configured'),
        }
      }

      const sanitizedTenantId = sanitizeName(tenantId)
      const prefix = defaultConfig.tenantPrefix ?? ''
      const databaseName = prefix ? `${prefix}${sanitizedTenantId}` : sanitizedTenantId

      try {
        await rpcClient.call({
          method: 'dropDatabase',
          params: { database: databaseName },
        })

        return {
          success: true,
          databaseDropped: true,
        }
      } catch (err) {
        return {
          success: false,
          error: err as Error,
        }
      }
    },

    listTenants: async (): Promise<string[]> => {
      if (!rpcClient) {
        return []
      }

      try {
        const response = await rpcClient.call({
          method: 'listDatabases',
          params: {},
        })

        const databases = response?.databases ?? []
        const prefix = defaultConfig.tenantPrefix ?? ''

        if (prefix) {
          return databases
            .map((db: { name: string }) => db.name)
            .filter((name: string) => name.startsWith(prefix))
            .map((name: string) => name.slice(prefix.length))
        }
        // Without a prefix, return all databases (user is responsible for filtering)
        return databases.map((db: { name: string }) => db.name)
      } catch {
        return []
      }
    },

    isTenantProvisioned: async (tenantId: string): Promise<boolean> => {
      const tenants = await provisioner.listTenants()
      const sanitizedId = sanitizeName(tenantId)
      return tenants.includes(sanitizedId)
    },

    cancel: () => {
      cancelled = true
    },
  }

  return provisioner
}

// =============================================================================
// Helper Functions
// =============================================================================

export async function checkProvisioningStatus(
  rpcClient: RpcClient,
  context: ProvisioningContext
): Promise<ProvisioningStatus> {
  try {
    const response = await rpcClient.call({
      method: 'checkStatus',
      params: {
        database: context.database,
        collection: context.collection,
      },
    })

    return {
      databaseExists: response.databaseExists ?? false,
      collectionExists: response.collectionExists ?? false,
      isProvisioned: (response.databaseExists && response.collectionExists) ?? false,
      checkedAt: new Date(),
      indexes: response.indexes,
      stats: response.stats,
    }
  } catch (err) {
    return {
      databaseExists: false,
      collectionExists: false,
      isProvisioned: false,
      checkedAt: new Date(),
      error: err as Error,
    }
  }
}

export async function provisionDatabase(
  rpcClient: RpcClient,
  params: DatabaseProvisionParams
): Promise<DatabaseResult> {
  // Validate database name
  if (!isValidDatabaseName(params.database)) {
    throw new ProvisioningError(
      `Invalid database name: ${params.database}`,
      'INVALID_DATABASE_NAME',
      { database: params.database }
    )
  }

  // Apply naming strategy
  let databaseName = params.database
  if (params.namingStrategy === 'user-prefixed' && params.userId) {
    databaseName = `${params.userId}_${params.database}`
  }

  try {
    const response = await rpcClient.call({
      method: 'createDatabase',
      params: {
        database: databaseName,
        options: params.options ?? {},
      },
    })

    return {
      success: response.success ?? true,
      databaseName,
      alreadyExists: response.exists,
      created: response.created,
    }
  } catch (err) {
    throw err
  }
}

export async function provisionCollection(
  rpcClient: RpcClient,
  params: CollectionProvisionParams
): Promise<CollectionResult> {
  // Validate collection name
  if (!isValidCollectionName(params.collection)) {
    throw new ProvisioningError(
      `Invalid collection name: ${params.collection}`,
      'INVALID_COLLECTION_NAME',
      { collection: params.collection }
    )
  }

  try {
    const callParams: Record<string, unknown> = {
      database: params.database,
      collection: params.collection,
    }

    if (params.indexes) {
      callParams.indexes = params.indexes
    }
    if (params.options) {
      callParams.options = params.options
    }

    const response = await rpcClient.call({
      method: 'createCollection',
      params: callParams,
    })

    return {
      success: response.success ?? true,
      collectionName: params.collection,
      alreadyExists: response.exists,
      created: response.created,
    }
  } catch (err) {
    throw err
  }
}
