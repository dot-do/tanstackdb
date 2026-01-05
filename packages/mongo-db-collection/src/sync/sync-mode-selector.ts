/**
 * @file Sync Mode Selector
 *
 * This module provides automatic and manual sync mode selection for MongoDB collections.
 * The selector determines the optimal sync mode based on collection size and other factors,
 * while also supporting explicit mode overrides and runtime transitions.
 *
 * @module @tanstack/mongo-db-collection/sync/sync-mode-selector
 */

import type { SyncMode } from '../types.js'
import { SYNC_MODES, isSyncMode } from '../types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Collection statistics used for sync mode selection.
 */
export interface CollectionStats {
  documentCount: number
  estimatedSizeBytes: number
  avgDocumentSizeBytes?: number
}

/**
 * Thresholds for automatic sync mode selection.
 */
export interface SyncModeThresholds {
  /** Maximum document count for eager mode (exclusive upper bound) */
  eagerMaxDocuments: number
  /** Maximum document count for progressive mode (exclusive upper bound) */
  progressiveMaxDocuments: number
  /** Maximum total size in bytes for eager mode (optional) */
  eagerMaxSizeBytes?: number
  /** Maximum total size in bytes for progressive mode (optional) */
  progressiveMaxSizeBytes?: number
}

/**
 * Configuration for sync mode selection.
 */
export interface SyncModeSelectionConfig {
  /** Explicit mode to use, bypassing automatic selection */
  explicitMode?: SyncMode
  /** Force the explicit mode regardless of collection stats */
  force?: boolean
  /** Custom thresholds for automatic selection */
  thresholds?: SyncModeThresholds
  /** Consider size in bytes when selecting mode */
  considerSize?: boolean
  /** Maximum size in bytes for eager mode */
  maxEagerSizeBytes?: number
  /** Prefer size-based selection over document count */
  preferSizeOverCount?: boolean
  /** Initial mode for the selector */
  initialMode?: SyncMode
  /** Initial stats for automatic selection */
  initialStats?: CollectionStats
  /** Enable automatic mode selection based on stats updates */
  autoSelect?: boolean
  /** Batch size for progressive mode */
  progressiveBatchSize?: number
  /** Track mode change history */
  trackHistory?: boolean
  /** Initial serialized state to restore from */
  initialState?: string
}

/**
 * Transition event for mode changes.
 */
export interface SyncModeTransition {
  from: SyncMode
  to: SyncMode
  timestamp: Date
  reason?: string
}

/**
 * Mode configuration details.
 */
export interface ModeConfig {
  requiresInitialLoad: boolean
  loadStrategy: 'full' | 'batched' | 'on-request'
  supportsLoadSubset: boolean
  memoryUsage: 'low' | 'medium' | 'high'
  batchSize?: number
  batchDelayMs?: number
}

/**
 * Mode history entry.
 */
export interface ModeHistoryEntry {
  mode: SyncMode
  timestamp: Date
  reason?: string
}

/**
 * Recommendation options.
 */
export interface RecommendationOptions {
  useCase?: 'real-time-collaboration' | 'search-driven' | 'dashboard' | 'general'
  expectedLatency?: 'low' | 'medium' | 'high'
  expectedDatasetSize?: 'small' | 'medium' | 'large'
}

/**
 * Recommendation result.
 */
export interface Recommendation {
  recommendedMode: SyncMode
  reason: string
}

/**
 * Serialized selector state.
 */
interface SerializedState {
  currentMode: SyncMode
  autoSelectEnabled: boolean
  history: ModeHistoryEntry[]
  version: number
}

/**
 * Mode change listener type.
 */
export type ModeChangeListener = (transition: SyncModeTransition) => void

/**
 * Error listener type.
 */
export type ErrorListener = (error: Error) => void

/**
 * Sync mode selector instance interface.
 */
export interface SyncModeSelector {
  /** Get the current sync mode */
  getCurrentMode(): SyncMode
  /** Set the sync mode explicitly */
  setMode(mode: SyncMode, options?: { reason?: string }): SyncMode
  /** Register a listener for mode changes */
  onModeChange(listener: ModeChangeListener): () => void
  /** Update collection stats (triggers auto-select if enabled) */
  updateStats(stats: CollectionStats): void
  /** Re-enable automatic mode selection */
  enableAutoSelect(): void
  /** Get configuration details for the current mode */
  getModeConfig(): ModeConfig
  /** Get a mode recommendation based on use case */
  getRecommendation(options: RecommendationOptions): Recommendation
  /** Get mode change history */
  getModeHistory(): ModeHistoryEntry[]
  /** Serialize the selector state */
  serialize(): string
  /** Register an error listener */
  onError(listener: ErrorListener): () => void
}

// =============================================================================
// Default Thresholds
// =============================================================================

const DEFAULT_THRESHOLDS: SyncModeThresholds = {
  eagerMaxDocuments: 1000,
  progressiveMaxDocuments: 10000,
}

const DEFAULT_BATCH_SIZE = 100
const DEFAULT_BATCH_DELAY_MS = 50
const SERIALIZATION_VERSION = 1

// =============================================================================
// Public Functions
// =============================================================================

/**
 * Returns the default sync mode thresholds.
 */
export function getDefaultSyncModeThresholds(): SyncModeThresholds {
  return { ...DEFAULT_THRESHOLDS }
}

/**
 * Validates a sync mode selection configuration.
 *
 * @throws Error if the configuration is invalid
 */
export function validateSyncModeConfig(config: SyncModeSelectionConfig | undefined): void {
  if (config === undefined || config === null) {
    return
  }

  // Validate explicit mode
  if (config.explicitMode !== undefined) {
    if (typeof config.explicitMode !== 'string' || !isSyncMode(config.explicitMode)) {
      throw new Error(`Invalid sync mode: ${config.explicitMode}`)
    }
  }

  // Validate thresholds
  if (config.thresholds) {
    const { eagerMaxDocuments, progressiveMaxDocuments } = config.thresholds

    if (eagerMaxDocuments !== undefined && eagerMaxDocuments < 0) {
      throw new Error('Threshold eagerMaxDocuments cannot be negative')
    }

    if (progressiveMaxDocuments !== undefined && progressiveMaxDocuments < 0) {
      throw new Error('Threshold progressiveMaxDocuments cannot be negative')
    }

    if (
      eagerMaxDocuments !== undefined &&
      progressiveMaxDocuments !== undefined &&
      eagerMaxDocuments > progressiveMaxDocuments
    ) {
      throw new Error('Threshold eagerMaxDocuments cannot be greater than progressiveMaxDocuments')
    }
  }

  // Validate size threshold
  if (config.maxEagerSizeBytes !== undefined && config.maxEagerSizeBytes < 0) {
    throw new Error('Size threshold maxEagerSizeBytes cannot be negative')
  }

  // Validate batch size
  if (config.progressiveBatchSize !== undefined && config.progressiveBatchSize <= 0) {
    throw new Error('Batch size must be a positive number')
  }
}

/**
 * Selects the appropriate sync mode based on collection stats and configuration.
 *
 * @param stats - Collection statistics
 * @param config - Optional configuration for mode selection
 * @returns The selected sync mode
 */
export function selectSyncMode(
  stats: CollectionStats | null | undefined,
  config?: SyncModeSelectionConfig
): SyncMode {
  // Validate explicit mode if provided
  if (config?.explicitMode !== undefined) {
    if (typeof config.explicitMode !== 'string' || !isSyncMode(config.explicitMode)) {
      throw new Error(`Invalid sync mode: ${config.explicitMode}`)
    }
    return config.explicitMode
  }

  // Handle null/undefined stats
  if (!stats) {
    return 'eager'
  }

  const thresholds = config?.thresholds ?? DEFAULT_THRESHOLDS
  const documentCount = stats.documentCount

  // Handle invalid document counts
  if (
    documentCount === undefined ||
    documentCount === null ||
    Number.isNaN(documentCount) ||
    documentCount < 0
  ) {
    return 'eager'
  }

  // Handle Infinity
  if (!Number.isFinite(documentCount)) {
    return 'on-demand'
  }

  // Size-based selection
  if (config?.considerSize && stats.estimatedSizeBytes > 0) {
    const maxEagerSize = config.maxEagerSizeBytes ?? 50 * 1024 * 1024 // 50MB default

    if (config.preferSizeOverCount) {
      // Prefer size-based selection
      if (stats.estimatedSizeBytes <= maxEagerSize) {
        return 'eager'
      }
    } else {
      // Size as a secondary factor - if size exceeds limit, bump up mode
      if (stats.estimatedSizeBytes > maxEagerSize && documentCount < thresholds.eagerMaxDocuments) {
        return 'progressive'
      }
    }
  }

  // Document count-based selection
  if (documentCount < thresholds.eagerMaxDocuments) {
    return 'eager'
  }

  if (documentCount < thresholds.progressiveMaxDocuments) {
    return 'progressive'
  }

  return 'on-demand'
}

/**
 * Creates a sync mode selector instance.
 *
 * @param config - Optional configuration for the selector
 * @returns A SyncModeSelector instance
 */
export function createSyncModeSelector(config?: SyncModeSelectionConfig): SyncModeSelector {
  let currentMode: SyncMode = 'eager'
  let autoSelectEnabled = config?.autoSelect ?? false
  let currentStats: CollectionStats | undefined = config?.initialStats
  let hasBeenExplicitlySet = false
  const listeners: Set<ModeChangeListener> = new Set()
  const errorListeners: Set<ErrorListener> = new Set()
  const history: ModeHistoryEntry[] = []
  const trackHistory = config?.trackHistory ?? false
  const progressiveBatchSize = config?.progressiveBatchSize ?? DEFAULT_BATCH_SIZE

  // Try to restore from serialized state
  if (config?.initialState) {
    try {
      const parsed = JSON.parse(config.initialState) as SerializedState
      if (parsed && isSyncMode(parsed.currentMode)) {
        currentMode = parsed.currentMode
        autoSelectEnabled = parsed.autoSelectEnabled ?? false
        hasBeenExplicitlySet = true
        if (Array.isArray(parsed.history)) {
          history.push(
            ...parsed.history.map((h) => ({
              ...h,
              timestamp: new Date(h.timestamp),
            }))
          )
        }
      }
    } catch {
      // Invalid state, use defaults
      currentMode = 'eager'
    }
  } else if (config?.initialMode) {
    currentMode = config.initialMode
    hasBeenExplicitlySet = true
  } else if (config?.initialStats) {
    currentMode = selectSyncMode(config.initialStats, config)
    hasBeenExplicitlySet = true
  }

  function notifyListeners(transition: SyncModeTransition): void {
    for (const listener of listeners) {
      try {
        listener(transition)
      } catch (error) {
        // Notify error listeners but continue processing
        const err = error instanceof Error ? error : new Error(String(error))
        for (const errorListener of errorListeners) {
          try {
            errorListener(err)
          } catch {
            // Ignore errors in error listeners
          }
        }
      }
    }
  }

  function addToHistory(mode: SyncMode, reason?: string): void {
    if (trackHistory) {
      history.push({
        mode,
        timestamp: new Date(),
        reason,
      })
    }
  }

  const selector: SyncModeSelector = {
    getCurrentMode(): SyncMode {
      return currentMode
    },

    setMode(mode: SyncMode, options?: { reason?: string }): SyncMode {
      if (!isSyncMode(mode)) {
        throw new Error(`Invalid sync mode: ${mode}`)
      }

      const previousMode = currentMode
      const wasExplicitlySet = hasBeenExplicitlySet

      // Disable auto-select when explicitly setting mode
      autoSelectEnabled = false

      // If already explicitly set to the same mode, don't fire events
      if (wasExplicitlySet && previousMode === mode) {
        return previousMode
      }

      // Mark as explicitly set
      hasBeenExplicitlySet = true
      currentMode = mode
      addToHistory(mode, options?.reason)

      const transition: SyncModeTransition = {
        from: previousMode,
        to: mode,
        timestamp: new Date(),
        reason: options?.reason,
      }

      notifyListeners(transition)

      return previousMode
    },

    onModeChange(listener: ModeChangeListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    updateStats(stats: CollectionStats): void {
      currentStats = stats

      if (!autoSelectEnabled) {
        return
      }

      const newMode = selectSyncMode(stats, config)
      if (newMode !== currentMode) {
        const previousMode = currentMode
        currentMode = newMode
        addToHistory(newMode, 'auto-select based on stats')

        const transition: SyncModeTransition = {
          from: previousMode,
          to: newMode,
          timestamp: new Date(),
          reason: 'auto-select based on stats',
        }

        notifyListeners(transition)
      }
    },

    enableAutoSelect(): void {
      autoSelectEnabled = true
    },

    getModeConfig(): ModeConfig {
      switch (currentMode) {
        case 'eager':
          return {
            requiresInitialLoad: true,
            loadStrategy: 'full',
            supportsLoadSubset: false,
            memoryUsage: 'high',
          }
        case 'progressive':
          return {
            requiresInitialLoad: true,
            loadStrategy: 'batched',
            supportsLoadSubset: true,
            memoryUsage: 'medium',
            batchSize: progressiveBatchSize,
            batchDelayMs: DEFAULT_BATCH_DELAY_MS,
          }
        case 'on-demand':
          return {
            requiresInitialLoad: false,
            loadStrategy: 'on-request',
            supportsLoadSubset: true,
            memoryUsage: 'low',
          }
        default:
          return {
            requiresInitialLoad: true,
            loadStrategy: 'full',
            supportsLoadSubset: false,
            memoryUsage: 'high',
          }
      }
    },

    getRecommendation(options: RecommendationOptions): Recommendation {
      const { useCase, expectedLatency, expectedDatasetSize } = options

      // Real-time collaboration needs eager for low latency
      if (useCase === 'real-time-collaboration' || expectedLatency === 'low') {
        return {
          recommendedMode: 'eager',
          reason: 'Real-time collaboration requires immediate data availability',
        }
      }

      // Large datasets with search should use on-demand
      if (useCase === 'search-driven' || expectedDatasetSize === 'large') {
        return {
          recommendedMode: 'on-demand',
          reason: 'Large datasets benefit from on-demand loading to reduce memory usage',
        }
      }

      // Dashboard/medium size is well-suited for progressive
      if (useCase === 'dashboard' || expectedDatasetSize === 'medium') {
        return {
          recommendedMode: 'progressive',
          reason: 'Progressive loading optimizes initial page load while maintaining data freshness',
        }
      }

      // Default recommendation
      return {
        recommendedMode: 'eager',
        reason: 'Default recommendation for general use cases',
      }
    },

    getModeHistory(): ModeHistoryEntry[] {
      return [...history]
    },

    serialize(): string {
      const state: SerializedState = {
        currentMode,
        autoSelectEnabled,
        history,
        version: SERIALIZATION_VERSION,
      }
      return JSON.stringify(state)
    },

    onError(listener: ErrorListener): () => void {
      errorListeners.add(listener)
      return () => {
        errorListeners.delete(listener)
      }
    },
  }

  return selector
}
