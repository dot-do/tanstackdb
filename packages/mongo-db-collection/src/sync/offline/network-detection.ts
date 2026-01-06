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
// Factory Functions
// =============================================================================

/**
 * Create a network detector
 */
export function createNetworkDetector(
  config?: NetworkDetectorConfig
): NetworkDetector {
  // State
  let currentStatus: NetworkStatus = getInitialStatus(config)
  let isOverridden = false
  let pauseAutoDetection = false
  let disposed = false
  let durationTimeoutId: ReturnType<typeof setTimeout> | null = null

  // Statistics
  let statusChangeCount = 0
  let lastChangeTimestamp: Date | undefined
  let statusStartTime = Date.now()
  let totalOnlineTime = 0
  let creationTime = Date.now()

  // Listeners
  const listeners = new Set<{
    callback: NetworkStatusListener
    once: boolean
  }>()

  // Get window reference
  const win = config?.window ?? (typeof window !== 'undefined' ? window : undefined)

  // Event handlers
  const handleOnline = () => {
    if (disposed || pauseAutoDetection) return
    updateStatus('online')
  }

  const handleOffline = () => {
    if (disposed || pauseAutoDetection) return
    updateStatus('offline')
  }

  // Register event listeners if window is available
  if (win) {
    win.addEventListener('online', handleOnline)
    win.addEventListener('offline', handleOffline)
  }

  function getInitialStatus(cfg?: NetworkDetectorConfig): NetworkStatus {
    if (cfg?.initialStatus) {
      return cfg.initialStatus
    }
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine ? 'online' : 'offline'
    }
    return 'online'
  }

  function updateStatus(newStatus: NetworkStatus): void {
    if (disposed) return
    if (newStatus === currentStatus) return

    const previousStatus = currentStatus

    // Update time tracking before changing status
    const now = Date.now()
    if (previousStatus === 'online') {
      totalOnlineTime += now - statusStartTime
    }
    statusStartTime = now

    currentStatus = newStatus
    statusChangeCount++
    lastChangeTimestamp = new Date()

    // Notify listeners
    const change: NetworkStatusChange = {
      status: newStatus,
      previousStatus,
      timestamp: lastChangeTimestamp,
    }

    const listenersToRemove: typeof listeners extends Set<infer T> ? T[] : never = []

    for (const entry of listeners) {
      try {
        entry.callback(change)
      } catch {
        // Ignore listener errors
      }
      if (entry.once) {
        listenersToRemove.push(entry)
      }
    }

    for (const entry of listenersToRemove) {
      listeners.delete(entry)
    }
  }

  function isOnline(): boolean {
    return currentStatus === 'online'
  }

  function getStatus(): NetworkStatus {
    return currentStatus
  }

  function onStatusChange(
    listener: NetworkStatusListener,
    options?: NetworkStatusListenerOptions
  ): () => void {
    if (disposed) {
      return () => {}
    }

    const entry = {
      callback: listener,
      once: options?.once ?? false,
    }
    listeners.add(entry)

    return () => {
      listeners.delete(entry)
    }
  }

  function setStatus(status: NetworkStatus, options?: SetStatusOptions): NetworkStatus {
    if (disposed) {
      return currentStatus
    }

    // Clear any existing duration timeout
    if (durationTimeoutId !== null) {
      clearTimeout(durationTimeoutId)
      durationTimeoutId = null
    }

    const previousStatus = currentStatus

    if (options?.pauseAutoDetection) {
      pauseAutoDetection = true
      isOverridden = true
    }

    // Set duration timeout if specified
    if (options?.duration) {
      isOverridden = true
      const revertToStatus = currentStatus
      durationTimeoutId = setTimeout(() => {
        if (!disposed) {
          durationTimeoutId = null
          updateStatus(revertToStatus === 'online' ? 'online' : 'online')
        }
      }, options.duration)
    }

    updateStatus(status)

    return previousStatus
  }

  function clearOverride(): void {
    if (disposed) return

    if (durationTimeoutId !== null) {
      clearTimeout(durationTimeoutId)
      durationTimeoutId = null
    }

    isOverridden = false
    pauseAutoDetection = false

    // Sync with actual navigator status
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      updateStatus(navigator.onLine ? 'online' : 'offline')
    }
  }

  function getNetworkQuality(): NetworkQuality | undefined {
    if (typeof navigator === 'undefined') return undefined
    const nav = navigator as Navigator & { connection?: NetworkQuality }
    if (!nav.connection) return undefined

    return {
      effectiveType: nav.connection.effectiveType,
      downlink: nav.connection.downlink,
      rtt: nav.connection.rtt,
      saveData: nav.connection.saveData,
    }
  }

  function isSlowConnection(): boolean {
    const quality = getNetworkQuality()
    if (!quality?.effectiveType) return false
    return quality.effectiveType === '2g' || quality.effectiveType === 'slow-2g'
  }

  function isSaveDataMode(): boolean {
    const quality = getNetworkQuality()
    return quality?.saveData === true
  }

  function getStats(): NetworkDetectorStats {
    const now = Date.now()
    let currentOnlineTime = totalOnlineTime
    if (currentStatus === 'online') {
      currentOnlineTime += now - statusStartTime
    }
    const totalTime = now - creationTime

    return {
      currentStatus,
      statusChangeCount,
      timeInCurrentStatus: now - statusStartTime,
      lastChangeTimestamp,
      uptimePercentage: totalTime > 0 ? (currentOnlineTime / totalTime) * 100 : 100,
      isOverridden,
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true

    // Clear timeout
    if (durationTimeoutId !== null) {
      clearTimeout(durationTimeoutId)
      durationTimeoutId = null
    }

    // Remove event listeners
    if (win) {
      win.removeEventListener('online', handleOnline)
      win.removeEventListener('offline', handleOffline)
    }

    // Clear all listeners
    listeners.clear()
  }

  return {
    isOnline,
    getStatus,
    onStatusChange,
    setStatus,
    clearOverride,
    getNetworkQuality,
    isSlowConnection,
    isSaveDataMode,
    getStats,
    dispose,
    get isDisposed() {
      return disposed
    },
  }
}
