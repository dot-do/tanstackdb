/**
 * @file Network Detection (Stub for TDD)
 *
 * This file provides type exports for RED phase tests.
 * Implementation will be added during the GREEN phase.
 *
 * @module @tanstack/mongo-db-collection/sync/offline/network-detection
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Network status type
 */
export type NetworkStatus = 'online' | 'offline'

/**
 * Network quality information from Network Information API
 */
export interface NetworkQuality {
  effectiveType?: '2g' | '3g' | '4g' | 'slow-2g'
  downlink?: number
  rtt?: number
  saveData?: boolean
}

/**
 * Status change event data
 */
export interface NetworkStatusChange {
  status: NetworkStatus
  previousStatus: NetworkStatus
  timestamp: Date
}

/**
 * Listener options
 */
export interface NetworkStatusListenerOptions {
  once?: boolean
}

/**
 * Status listener function type
 */
export type NetworkStatusListener = (change: NetworkStatusChange) => void

/**
 * Set status options
 */
export interface SetStatusOptions {
  duration?: number
  pauseAutoDetection?: boolean
}

/**
 * Network detector statistics
 */
export interface NetworkDetectorStats {
  currentStatus: NetworkStatus
  statusChangeCount: number
  timeInCurrentStatus: number
  lastChangeTimestamp?: Date
  uptimePercentage: number
  isOverridden: boolean
}

/**
 * Configuration for network detector
 */
export interface NetworkDetectorConfig {
  initialStatus?: NetworkStatus
  window?: Window
}

/**
 * Network detector interface
 */
export interface NetworkDetector {
  isOnline(): boolean
  getStatus(): NetworkStatus
  onStatusChange(
    listener: NetworkStatusListener,
    options?: NetworkStatusListenerOptions
  ): () => void
  setStatus(status: NetworkStatus, options?: SetStatusOptions): NetworkStatus
  clearOverride(): void
  getNetworkQuality(): NetworkQuality | undefined
  isSlowConnection(): boolean
  isSaveDataMode(): boolean
  getStats(): NetworkDetectorStats
  dispose(): void
  isDisposed: boolean
}

// =============================================================================
// Factory Functions (Stubs)
// =============================================================================

/**
 * Create a network detector
 */
export function createNetworkDetector(
  _config?: NetworkDetectorConfig
): NetworkDetector {
  throw new Error('Not implemented: createNetworkDetector')
}
