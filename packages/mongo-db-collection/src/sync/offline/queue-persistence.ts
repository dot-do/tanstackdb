/**
 * @file Queue Persistence (Stub for TDD)
 *
 * This file provides type exports for RED phase tests.
 * Implementation will be added during the GREEN phase.
 *
 * @module @tanstack/mongo-db-collection/sync/offline/queue-persistence
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Storage backend type
 */
export type StorageBackend = 'memory' | 'localStorage' | 'sessionStorage' | 'indexedDB'

/**
 * Storage format version info
 */
export interface StorageFormat {
  version: number
  mutations: PersistedMutation[]
  lastModified?: number
  timestamp?: number
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean
  migratedCount: number
  fromVersion?: number
  toVersion?: number
}

/**
 * Persisted mutation
 */
export interface PersistedMutation {
  id: string
  type: 'insert' | 'update' | 'delete'
  collectionName: string
  collection?: string
  key: string
  value: Record<string, unknown>
  data?: Record<string, unknown>
  timestamp: number
  retryCount: number
  status?: 'pending' | 'completed' | 'failed'
  metadata?: Record<string, unknown>
}

/**
 * Queue statistics
 */
export interface QueueStats {
  totalCount: number
  byType: Record<string, number>
  byCollection: Record<string, number>
  oldestTimestamp?: number
}

/**
 * Configuration for queue persistence
 */
export interface QueuePersistenceConfig {
  backend?: StorageBackend
  namespace?: string
  maxQueueSize?: number
  maxStorageBytes?: number
  warningThreshold?: number
  dbVersion?: number
  targetVersion?: number
  validateOnRestore?: boolean
  backupOnCorruption?: boolean
  clearOnUnrecoverableCorruption?: boolean
  autoCompactOnQuotaExceeded?: boolean
  evictionStrategy?: 'oldest-first' | 'newest-first'
  fallbackToMemory?: boolean
  backupBeforeMigration?: boolean
  backupBeforeClear?: boolean
  onError?: (error: Error) => void
  onRestore?: (data: { count: number; mutations: PersistedMutation[] }) => void
  onClear?: (data: { clearedCount: number }) => void
  onQuotaExceeded?: (data: { currentSize: number; attemptedSize: number }) => void
  onStorageWarning?: () => void
  onCorruptionDetected?: (data: { originalData: string; error: Error }) => void
  onBackup?: (data: { version?: number; data?: unknown; mutations?: PersistedMutation[] }) => void
  onMigrationComplete?: (data: { fromVersion: number; toVersion: number; mutationCount: number }) => void
  deserialize?: (data: PersistedMutation) => PersistedMutation
  mutationMigrator?: (mutation: PersistedMutation) => PersistedMutation
  migrations?: Record<string, (data: StorageFormat) => StorageFormat>
}

/**
 * Queue persistence class
 */
export class QueuePersistence {
  readonly backend: StorageBackend
  readonly namespace: string
  readonly maxQueueSize: number
  readonly isUsingFallback: boolean

  constructor(_config?: QueuePersistenceConfig) {
    // Stub implementation - just set defaults
    const config = _config || {}

    // Check storage availability
    let effectiveBackend = config.backend || 'memory'
    if (effectiveBackend === 'localStorage' && typeof globalThis.localStorage === 'undefined') {
      effectiveBackend = 'memory'
    }
    if (effectiveBackend === 'sessionStorage' && typeof globalThis.sessionStorage === 'undefined') {
      effectiveBackend = 'memory'
    }
    if (effectiveBackend === 'indexedDB' && typeof globalThis.indexedDB === 'undefined') {
      effectiveBackend = 'memory'
    }

    this.backend = effectiveBackend
    this.namespace = config.namespace || 'tanstack-db-queue'
    this.maxQueueSize = config.maxQueueSize || 1000
    this.isUsingFallback = false
  }

  async enqueue(_mutation: PersistedMutation): Promise<string> {
    throw new Error('Not implemented: QueuePersistence.enqueue')
  }

  async enqueueBatch(_mutations: PersistedMutation[]): Promise<string[]> {
    throw new Error('Not implemented: QueuePersistence.enqueueBatch')
  }

  async dequeue(): Promise<PersistedMutation | null> {
    throw new Error('Not implemented: QueuePersistence.dequeue')
  }

  async peek(): Promise<PersistedMutation | null> {
    throw new Error('Not implemented: QueuePersistence.peek')
  }

  async remove(_id: string): Promise<boolean> {
    throw new Error('Not implemented: QueuePersistence.remove')
  }

  async removeBatch(_ids: string[]): Promise<void> {
    throw new Error('Not implemented: QueuePersistence.removeBatch')
  }

  async getAll(): Promise<PersistedMutation[]> {
    throw new Error('Not implemented: QueuePersistence.getAll')
  }

  async size(): Promise<number> {
    throw new Error('Not implemented: QueuePersistence.size')
  }

  async isEmpty(): Promise<boolean> {
    throw new Error('Not implemented: QueuePersistence.isEmpty')
  }

  async clear(_options?: { silent?: boolean }): Promise<void> {
    throw new Error('Not implemented: QueuePersistence.clear')
  }

  async clearByCollection(_collectionName: string): Promise<void> {
    throw new Error('Not implemented: QueuePersistence.clearByCollection')
  }

  async clearOlderThan(_timestamp: number): Promise<void> {
    throw new Error('Not implemented: QueuePersistence.clearOlderThan')
  }

  async clearByStatus(_status: string): Promise<void> {
    throw new Error('Not implemented: QueuePersistence.clearByStatus')
  }

  async updateRetryCount(_id: string, _count: number): Promise<boolean> {
    throw new Error('Not implemented: QueuePersistence.updateRetryCount')
  }

  async getByCollection(_collectionName: string): Promise<PersistedMutation[]> {
    throw new Error('Not implemented: QueuePersistence.getByCollection')
  }

  async getStats(): Promise<QueueStats> {
    throw new Error('Not implemented: QueuePersistence.getStats')
  }

  async getQueueSizeBytes(): Promise<number> {
    throw new Error('Not implemented: QueuePersistence.getQueueSizeBytes')
  }

  async estimateAvailableSpace(): Promise<number> {
    throw new Error('Not implemented: QueuePersistence.estimateAvailableSpace')
  }

  async restore(): Promise<void> {
    throw new Error('Not implemented: QueuePersistence.restore')
  }

  async detectStorageVersion(): Promise<number> {
    throw new Error('Not implemented: QueuePersistence.detectStorageVersion')
  }

  async migrateToBackend(_backend: StorageBackend): Promise<MigrationResult> {
    throw new Error('Not implemented: QueuePersistence.migrateToBackend')
  }

  async compact(_options?: { pruneCompleted?: boolean }): Promise<void> {
    throw new Error('Not implemented: QueuePersistence.compact')
  }
}
