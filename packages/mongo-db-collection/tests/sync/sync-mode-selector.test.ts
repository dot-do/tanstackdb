/**
 * @file Sync Mode Selector Tests - TDD (RED/GREEN)
 *
 * This test file verifies the Sync Mode Selector functionality for MongoDB collections.
 * The selector automatically determines the optimal sync mode based on collection size
 * and other factors, while also supporting explicit mode overrides and runtime transitions.
 *
 * Key behaviors tested:
 * 1. Automatic selection based on collection size
 * 2. Explicit mode override
 * 3. Switching modes during runtime
 * 4. Mode-specific behaviors are correctly applied
 * 5. Validation of mode configurations
 *
 * RED PHASE: These tests define expected behavior before implementation
 *
 * @module @tanstack/mongo-db-collection/tests/sync/sync-mode-selector
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  selectSyncMode,
  createSyncModeSelector,
  validateSyncModeConfig,
  getDefaultSyncModeThresholds,
} from '../../src/sync/sync-mode-selector'
import type {
  SyncModeSelector,
  SyncModeSelectionConfig,
  SyncModeTransition,
  SyncModeThresholds,
} from '../../src/sync/sync-mode-selector'
import type { SyncMode } from '../../src/types'

// =============================================================================
// Test Setup
// =============================================================================

interface MockCollectionStats {
  documentCount: number
  estimatedSizeBytes: number
  avgDocumentSizeBytes?: number
}

function createMockCollectionStats(
  documentCount: number,
  sizePerDoc: number = 1024
): MockCollectionStats {
  return {
    documentCount,
    estimatedSizeBytes: documentCount * sizePerDoc,
    avgDocumentSizeBytes: sizePerDoc,
  }
}

// =============================================================================
// Automatic Selection Tests
// =============================================================================

describe('Sync Mode Selector - Automatic Selection', () => {
  describe('selectSyncMode function', () => {
    it('should select eager mode for small collections (< 1000 documents)', () => {
      const stats = createMockCollectionStats(500)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('eager')
    })

    it('should select eager mode for collections at the lower boundary (999 documents)', () => {
      const stats = createMockCollectionStats(999)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('eager')
    })

    it('should select progressive mode for medium collections (1000-10000 documents)', () => {
      const stats = createMockCollectionStats(1000)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('progressive')
    })

    it('should select progressive mode for collections at mid-range (5000 documents)', () => {
      const stats = createMockCollectionStats(5000)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('progressive')
    })

    it('should select progressive mode for collections at upper boundary (9999 documents)', () => {
      const stats = createMockCollectionStats(9999)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('progressive')
    })

    it('should select on-demand mode for large collections (>= 10000 documents)', () => {
      const stats = createMockCollectionStats(10000)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('on-demand')
    })

    it('should select on-demand mode for very large collections (100000 documents)', () => {
      const stats = createMockCollectionStats(100000)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('on-demand')
    })

    it('should select eager mode for empty collections', () => {
      const stats = createMockCollectionStats(0)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('eager')
    })

    it('should handle undefined document count gracefully', () => {
      const stats = { documentCount: undefined as unknown as number, estimatedSizeBytes: 0 }
      const mode = selectSyncMode(stats)
      expect(mode).toBe('eager') // Default to eager for unknown
    })

    it('should handle negative document count gracefully', () => {
      const stats = createMockCollectionStats(-1)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('eager') // Default to eager for invalid
    })
  })

  describe('Size-based selection with byte thresholds', () => {
    it('should consider estimated size in bytes when document count is low but size is large', () => {
      // 100 documents but each is 10MB - should prefer progressive or on-demand
      const stats: MockCollectionStats = {
        documentCount: 100,
        estimatedSizeBytes: 100 * 10 * 1024 * 1024, // 1GB total
        avgDocumentSizeBytes: 10 * 1024 * 1024,
      }
      const mode = selectSyncMode(stats, { considerSize: true, maxEagerSizeBytes: 50 * 1024 * 1024 })
      expect(mode).not.toBe('eager')
    })

    it('should select eager for small total size even with moderate document count', () => {
      const stats: MockCollectionStats = {
        documentCount: 1500, // Would be progressive by count
        estimatedSizeBytes: 1500 * 100, // Only 150KB total
        avgDocumentSizeBytes: 100,
      }
      // With size-based selection enabled and generous size limit, can be eager
      const mode = selectSyncMode(stats, {
        considerSize: true,
        maxEagerSizeBytes: 10 * 1024 * 1024, // 10MB
        preferSizeOverCount: true,
      })
      expect(mode).toBe('eager')
    })

    it('should use document count when size data is unavailable', () => {
      const stats: MockCollectionStats = {
        documentCount: 5000,
        estimatedSizeBytes: 0, // Unknown
      }
      const mode = selectSyncMode(stats, { considerSize: true })
      expect(mode).toBe('progressive')
    })
  })

  describe('Custom threshold configuration', () => {
    it('should allow custom thresholds for eager mode', () => {
      const stats = createMockCollectionStats(500)
      const customThresholds: SyncModeThresholds = {
        eagerMaxDocuments: 100,
        progressiveMaxDocuments: 1000,
      }
      const mode = selectSyncMode(stats, { thresholds: customThresholds })
      expect(mode).toBe('progressive') // 500 > 100
    })

    it('should allow custom thresholds for progressive mode', () => {
      const stats = createMockCollectionStats(5000)
      const customThresholds: SyncModeThresholds = {
        eagerMaxDocuments: 1000,
        progressiveMaxDocuments: 2000,
      }
      const mode = selectSyncMode(stats, { thresholds: customThresholds })
      expect(mode).toBe('on-demand') // 5000 > 2000
    })

    it('should return default thresholds from getDefaultSyncModeThresholds', () => {
      const thresholds = getDefaultSyncModeThresholds()
      expect(thresholds.eagerMaxDocuments).toBe(1000)
      expect(thresholds.progressiveMaxDocuments).toBe(10000)
    })
  })
})

// =============================================================================
// Explicit Mode Override Tests
// =============================================================================

describe('Sync Mode Selector - Explicit Mode Override', () => {
  describe('Override with explicit mode', () => {
    it('should use explicit mode when specified regardless of collection size', () => {
      const stats = createMockCollectionStats(100000) // Would be on-demand
      const mode = selectSyncMode(stats, { explicitMode: 'eager' })
      expect(mode).toBe('eager')
    })

    it('should use explicit on-demand mode for small collection', () => {
      const stats = createMockCollectionStats(10) // Would be eager
      const mode = selectSyncMode(stats, { explicitMode: 'on-demand' })
      expect(mode).toBe('on-demand')
    })

    it('should use explicit progressive mode for tiny collection', () => {
      const stats = createMockCollectionStats(5)
      const mode = selectSyncMode(stats, { explicitMode: 'progressive' })
      expect(mode).toBe('progressive')
    })

    it('should respect force flag to bypass all automatic selection', () => {
      const config: SyncModeSelectionConfig = {
        explicitMode: 'eager',
        force: true,
      }
      const stats = createMockCollectionStats(1000000) // Very large
      const mode = selectSyncMode(stats, config)
      expect(mode).toBe('eager')
    })
  })

  describe('Override priority', () => {
    it('should prioritize explicit mode over custom thresholds', () => {
      const stats = createMockCollectionStats(500)
      const config: SyncModeSelectionConfig = {
        explicitMode: 'on-demand',
        thresholds: { eagerMaxDocuments: 1000, progressiveMaxDocuments: 10000 },
      }
      const mode = selectSyncMode(stats, config)
      expect(mode).toBe('on-demand')
    })

    it('should prioritize explicit mode over size-based selection', () => {
      const stats: MockCollectionStats = {
        documentCount: 100,
        estimatedSizeBytes: 100 * 1024 * 1024, // 100MB
      }
      const config: SyncModeSelectionConfig = {
        explicitMode: 'eager',
        considerSize: true,
        maxEagerSizeBytes: 10 * 1024 * 1024, // 10MB (would normally reject eager)
      }
      const mode = selectSyncMode(stats, config)
      expect(mode).toBe('eager')
    })
  })
})

// =============================================================================
// Runtime Mode Switching Tests
// =============================================================================

describe('Sync Mode Selector - Runtime Mode Switching', () => {
  let selector: SyncModeSelector

  beforeEach(() => {
    selector = createSyncModeSelector()
  })

  describe('createSyncModeSelector', () => {
    it('should create a selector instance with default configuration', () => {
      expect(selector).toBeDefined()
      expect(selector.getCurrentMode).toBeInstanceOf(Function)
      expect(selector.setMode).toBeInstanceOf(Function)
      expect(selector.onModeChange).toBeInstanceOf(Function)
    })

    it('should create selector with initial mode', () => {
      const selectorWithMode = createSyncModeSelector({ initialMode: 'progressive' })
      expect(selectorWithMode.getCurrentMode()).toBe('progressive')
    })

    it('should create selector with initial stats for automatic selection', () => {
      const stats = createMockCollectionStats(5000)
      const selectorWithStats = createSyncModeSelector({ initialStats: stats })
      expect(selectorWithStats.getCurrentMode()).toBe('progressive')
    })
  })

  describe('getCurrentMode', () => {
    it('should return current sync mode', () => {
      const mode = selector.getCurrentMode()
      expect(['eager', 'on-demand', 'progressive']).toContain(mode)
    })

    it('should return consistent mode without changes', () => {
      const mode1 = selector.getCurrentMode()
      const mode2 = selector.getCurrentMode()
      expect(mode1).toBe(mode2)
    })
  })

  describe('setMode', () => {
    it('should change the current mode', () => {
      selector.setMode('on-demand')
      expect(selector.getCurrentMode()).toBe('on-demand')
    })

    it('should change mode from eager to progressive', () => {
      selector.setMode('eager')
      expect(selector.getCurrentMode()).toBe('eager')
      selector.setMode('progressive')
      expect(selector.getCurrentMode()).toBe('progressive')
    })

    it('should return previous mode after change', () => {
      selector.setMode('eager')
      const previousMode = selector.setMode('on-demand')
      expect(previousMode).toBe('eager')
    })

    it('should validate mode before setting', () => {
      expect(() => {
        selector.setMode('invalid-mode' as SyncMode)
      }).toThrow()
    })

    it('should not trigger change event when mode is same', () => {
      const listener = vi.fn()
      selector.onModeChange(listener)
      selector.setMode('eager')
      selector.setMode('eager') // Same mode
      // Should only be called once
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe('updateStats', () => {
    it('should update mode based on new stats when in auto mode', () => {
      const autoSelector = createSyncModeSelector({ autoSelect: true })
      autoSelector.updateStats(createMockCollectionStats(100))
      expect(autoSelector.getCurrentMode()).toBe('eager')

      autoSelector.updateStats(createMockCollectionStats(50000))
      expect(autoSelector.getCurrentMode()).toBe('on-demand')
    })

    it('should not change mode when explicit mode is set', () => {
      selector.setMode('eager')
      selector.updateStats(createMockCollectionStats(100000))
      expect(selector.getCurrentMode()).toBe('eager') // Should stay eager
    })

    it('should allow re-enabling auto mode after explicit set', () => {
      const autoSelector = createSyncModeSelector({ autoSelect: true })
      autoSelector.setMode('eager') // Disables auto
      autoSelector.updateStats(createMockCollectionStats(50000))
      expect(autoSelector.getCurrentMode()).toBe('eager') // Still explicit

      autoSelector.enableAutoSelect()
      autoSelector.updateStats(createMockCollectionStats(50000))
      expect(autoSelector.getCurrentMode()).toBe('on-demand') // Auto kicks in
    })
  })

  describe('onModeChange event handling', () => {
    it('should register change listener', () => {
      const listener = vi.fn()
      selector.onModeChange(listener)
      selector.setMode('progressive')
      expect(listener).toHaveBeenCalled()
    })

    it('should call listener with transition details', () => {
      const listener = vi.fn()
      selector.setMode('eager')
      selector.onModeChange(listener)
      selector.setMode('on-demand')

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'eager',
          to: 'on-demand',
        })
      )
    })

    it('should include timestamp in transition', () => {
      const listener = vi.fn()
      selector.onModeChange(listener)
      selector.setMode('progressive')

      const transition = listener.mock.calls[0]?.[0] as SyncModeTransition | undefined
      expect(transition?.timestamp).toBeInstanceOf(Date)
    })

    it('should include reason in transition', () => {
      const listener = vi.fn()
      selector.onModeChange(listener)
      selector.setMode('progressive', { reason: 'User preference' })

      const transition = listener.mock.calls[0]?.[0] as SyncModeTransition | undefined
      expect(transition?.reason).toBe('User preference')
    })

    it('should return unsubscribe function', () => {
      const listener = vi.fn()
      const unsubscribe = selector.onModeChange(listener)

      selector.setMode('progressive')
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()
      selector.setMode('on-demand')
      expect(listener).toHaveBeenCalledTimes(1) // Still 1, not called again
    })

    it('should support multiple listeners', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      selector.onModeChange(listener1)
      selector.onModeChange(listener2)
      selector.setMode('progressive')

      expect(listener1).toHaveBeenCalled()
      expect(listener2).toHaveBeenCalled()
    })
  })
})

// =============================================================================
// Mode-Specific Behavior Tests
// =============================================================================

describe('Sync Mode Selector - Mode-Specific Behaviors', () => {
  describe('Eager mode characteristics', () => {
    it('should identify eager mode as requiring full initial load', () => {
      const selector = createSyncModeSelector({ initialMode: 'eager' })
      const config = selector.getModeConfig()
      expect(config.requiresInitialLoad).toBe(true)
      expect(config.loadStrategy).toBe('full')
    })

    it('should identify eager mode as not supporting loadSubset', () => {
      const selector = createSyncModeSelector({ initialMode: 'eager' })
      const config = selector.getModeConfig()
      expect(config.supportsLoadSubset).toBe(false)
    })

    it('should identify eager mode memory requirements', () => {
      const selector = createSyncModeSelector({ initialMode: 'eager' })
      const config = selector.getModeConfig()
      expect(config.memoryUsage).toBe('high')
    })
  })

  describe('On-demand mode characteristics', () => {
    it('should identify on-demand mode as not requiring initial load', () => {
      const selector = createSyncModeSelector({ initialMode: 'on-demand' })
      const config = selector.getModeConfig()
      expect(config.requiresInitialLoad).toBe(false)
      expect(config.loadStrategy).toBe('on-request')
    })

    it('should identify on-demand mode as supporting loadSubset', () => {
      const selector = createSyncModeSelector({ initialMode: 'on-demand' })
      const config = selector.getModeConfig()
      expect(config.supportsLoadSubset).toBe(true)
    })

    it('should identify on-demand mode memory requirements', () => {
      const selector = createSyncModeSelector({ initialMode: 'on-demand' })
      const config = selector.getModeConfig()
      expect(config.memoryUsage).toBe('low')
    })
  })

  describe('Progressive mode characteristics', () => {
    it('should identify progressive mode load strategy', () => {
      const selector = createSyncModeSelector({ initialMode: 'progressive' })
      const config = selector.getModeConfig()
      expect(config.requiresInitialLoad).toBe(true)
      expect(config.loadStrategy).toBe('batched')
    })

    it('should identify progressive mode batch configuration', () => {
      const selector = createSyncModeSelector({ initialMode: 'progressive' })
      const config = selector.getModeConfig()
      expect(config.batchSize).toBeGreaterThan(0)
      expect(config.batchDelayMs).toBeGreaterThanOrEqual(0)
    })

    it('should identify progressive mode memory requirements', () => {
      const selector = createSyncModeSelector({ initialMode: 'progressive' })
      const config = selector.getModeConfig()
      expect(config.memoryUsage).toBe('medium')
    })

    it('should allow custom batch size for progressive mode', () => {
      const selector = createSyncModeSelector({
        initialMode: 'progressive',
        progressiveBatchSize: 50,
      })
      const config = selector.getModeConfig()
      expect(config.batchSize).toBe(50)
    })
  })

  describe('Mode-specific recommendations', () => {
    it('should recommend eager for real-time collaborative use cases', () => {
      const recommendation = selector.getRecommendation({
        useCase: 'real-time-collaboration',
        expectedLatency: 'low',
      })
      expect(recommendation.recommendedMode).toBe('eager')
    })

    it('should recommend on-demand for large datasets with search', () => {
      const recommendation = selector.getRecommendation({
        useCase: 'search-driven',
        expectedDatasetSize: 'large',
      })
      expect(recommendation.recommendedMode).toBe('on-demand')
    })

    it('should recommend progressive for initial page load optimization', () => {
      const recommendation = selector.getRecommendation({
        useCase: 'dashboard',
        expectedDatasetSize: 'medium',
      })
      expect(recommendation.recommendedMode).toBe('progressive')
    })
  })

  let selector: SyncModeSelector

  beforeEach(() => {
    selector = createSyncModeSelector()
  })
})

// =============================================================================
// Validation Tests
// =============================================================================

describe('Sync Mode Selector - Configuration Validation', () => {
  describe('validateSyncModeConfig', () => {
    it('should accept valid configuration with all options', () => {
      const config: SyncModeSelectionConfig = {
        explicitMode: 'eager',
        thresholds: {
          eagerMaxDocuments: 500,
          progressiveMaxDocuments: 5000,
        },
        considerSize: true,
        maxEagerSizeBytes: 10 * 1024 * 1024,
      }
      expect(() => validateSyncModeConfig(config)).not.toThrow()
    })

    it('should accept empty configuration (defaults used)', () => {
      expect(() => validateSyncModeConfig({})).not.toThrow()
    })

    it('should accept undefined configuration', () => {
      expect(() => validateSyncModeConfig(undefined)).not.toThrow()
    })

    it('should reject invalid explicit mode', () => {
      const config = { explicitMode: 'invalid' as SyncMode }
      expect(() => validateSyncModeConfig(config)).toThrow(/invalid.*mode/i)
    })

    it('should reject negative threshold values', () => {
      const config: SyncModeSelectionConfig = {
        thresholds: {
          eagerMaxDocuments: -100,
          progressiveMaxDocuments: 1000,
        },
      }
      expect(() => validateSyncModeConfig(config)).toThrow(/threshold/i)
    })

    it('should reject when eager threshold > progressive threshold', () => {
      const config: SyncModeSelectionConfig = {
        thresholds: {
          eagerMaxDocuments: 10000,
          progressiveMaxDocuments: 1000, // Less than eager
        },
      }
      expect(() => validateSyncModeConfig(config)).toThrow(/threshold/i)
    })

    it('should reject negative size threshold', () => {
      const config: SyncModeSelectionConfig = {
        considerSize: true,
        maxEagerSizeBytes: -1,
      }
      expect(() => validateSyncModeConfig(config)).toThrow(/size/i)
    })

    it('should validate batch size for progressive mode', () => {
      const config: SyncModeSelectionConfig = {
        explicitMode: 'progressive',
        progressiveBatchSize: 0, // Invalid
      }
      expect(() => validateSyncModeConfig(config)).toThrow(/batch/i)
    })

    it('should accept valid batch size', () => {
      const config: SyncModeSelectionConfig = {
        explicitMode: 'progressive',
        progressiveBatchSize: 100,
      }
      expect(() => validateSyncModeConfig(config)).not.toThrow()
    })
  })

  describe('Type validation for SyncMode', () => {
    it('should accept string literal sync modes', () => {
      const modes: SyncMode[] = ['eager', 'on-demand', 'progressive']
      modes.forEach((mode) => {
        expect(() => selectSyncMode(createMockCollectionStats(100), { explicitMode: mode })).not.toThrow()
      })
    })

    it('should handle type coercion attempts gracefully', () => {
      // Passing an object that might be coerced
      const badMode = { toString: () => 'eager' } as unknown as SyncMode
      expect(() =>
        selectSyncMode(createMockCollectionStats(100), { explicitMode: badMode })
      ).toThrow()
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Sync Mode Selector - Edge Cases', () => {
  describe('Boundary conditions', () => {
    it('should handle exactly 1000 documents (boundary)', () => {
      const stats = createMockCollectionStats(1000)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('progressive')
    })

    it('should handle exactly 10000 documents (boundary)', () => {
      const stats = createMockCollectionStats(10000)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('on-demand')
    })

    it('should handle Number.MAX_SAFE_INTEGER documents', () => {
      const stats = createMockCollectionStats(Number.MAX_SAFE_INTEGER)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('on-demand')
    })

    it('should handle very small positive numbers (fractional)', () => {
      const stats = createMockCollectionStats(0.5)
      const mode = selectSyncMode(stats)
      expect(mode).toBe('eager')
    })
  })

  describe('Invalid input handling', () => {
    it('should handle NaN document count', () => {
      const stats = { documentCount: NaN, estimatedSizeBytes: 0 }
      const mode = selectSyncMode(stats)
      expect(mode).toBe('eager') // Default
    })

    it('should handle Infinity document count', () => {
      const stats = { documentCount: Infinity, estimatedSizeBytes: 0 }
      const mode = selectSyncMode(stats)
      expect(mode).toBe('on-demand')
    })

    it('should handle null stats gracefully', () => {
      const mode = selectSyncMode(null as unknown as MockCollectionStats)
      expect(mode).toBe('eager')
    })
  })

  describe('Concurrent operations', () => {
    it('should handle rapid successive mode changes', () => {
      const selector = createSyncModeSelector()
      const modes: SyncMode[] = ['eager', 'progressive', 'on-demand', 'eager', 'progressive']

      modes.forEach((mode) => selector.setMode(mode))

      expect(selector.getCurrentMode()).toBe('progressive')
    })

    it('should maintain consistency during listener execution', () => {
      const selector = createSyncModeSelector()
      const observedModes: SyncMode[] = []

      selector.onModeChange((transition) => {
        observedModes.push(selector.getCurrentMode())
        // Mode should match what listener sees
        expect(selector.getCurrentMode()).toBe(transition.to)
      })

      selector.setMode('progressive')
      selector.setMode('on-demand')

      expect(observedModes).toEqual(['progressive', 'on-demand'])
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Sync Mode Selector - Integration', () => {
  describe('Full workflow', () => {
    it('should support complete mode selection workflow', () => {
      // 1. Create selector with auto-select
      const selector = createSyncModeSelector({ autoSelect: true })

      // 2. Initial stats suggest eager mode
      selector.updateStats(createMockCollectionStats(100))
      expect(selector.getCurrentMode()).toBe('eager')

      // 3. Collection grows, mode changes automatically
      selector.updateStats(createMockCollectionStats(5000))
      expect(selector.getCurrentMode()).toBe('progressive')

      // 4. User overrides to on-demand
      selector.setMode('on-demand')
      expect(selector.getCurrentMode()).toBe('on-demand')

      // 5. Stats update doesn't change explicit mode
      selector.updateStats(createMockCollectionStats(100))
      expect(selector.getCurrentMode()).toBe('on-demand')

      // 6. Re-enable auto-select
      selector.enableAutoSelect()
      selector.updateStats(createMockCollectionStats(100))
      expect(selector.getCurrentMode()).toBe('eager')
    })

    it('should track mode history', () => {
      const selector = createSyncModeSelector({ trackHistory: true })

      selector.setMode('eager')
      selector.setMode('progressive')
      selector.setMode('on-demand')

      const history = selector.getModeHistory()
      expect(history).toHaveLength(3)
      expect(history.map((h) => h.mode)).toEqual(['eager', 'progressive', 'on-demand'])
    })

    it('should serialize and deserialize state', () => {
      const selector = createSyncModeSelector({ initialMode: 'progressive' })
      selector.setMode('on-demand')

      const serialized = selector.serialize()
      expect(serialized).toBeDefined()

      const restored = createSyncModeSelector({ initialState: serialized })
      expect(restored.getCurrentMode()).toBe('on-demand')
    })
  })

  describe('Error recovery', () => {
    it('should recover from invalid deserialized state', () => {
      const invalidState = { currentMode: 'not-a-mode', version: 999 }
      const selector = createSyncModeSelector({
        initialState: invalidState as unknown as string,
      })
      // Should fall back to default (eager)
      expect(selector.getCurrentMode()).toBe('eager')
    })

    it('should emit error event on listener exception without breaking', () => {
      const selector = createSyncModeSelector()
      const errorListener = vi.fn()
      selector.onError(errorListener)

      const badListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error')
      })
      const goodListener = vi.fn()

      selector.onModeChange(badListener)
      selector.onModeChange(goodListener)

      selector.setMode('progressive')

      // Both listeners called
      expect(badListener).toHaveBeenCalled()
      expect(goodListener).toHaveBeenCalled()

      // Error was caught and reported
      expect(errorListener).toHaveBeenCalledWith(expect.any(Error))
    })
  })
})

// =============================================================================
// Performance Tests
// =============================================================================

describe('Sync Mode Selector - Performance', () => {
  it('should select mode quickly for large datasets', () => {
    const stats = createMockCollectionStats(10000000) // 10 million

    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      selectSyncMode(stats)
    }
    const duration = performance.now() - start

    // 10000 selections should complete in under 100ms
    expect(duration).toBeLessThan(100)
  })

  it('should handle many listeners efficiently', () => {
    const selector = createSyncModeSelector()
    const listeners = Array.from({ length: 100 }, () => vi.fn())

    listeners.forEach((listener) => selector.onModeChange(listener))

    const start = performance.now()
    selector.setMode('progressive')
    const duration = performance.now() - start

    // 100 listeners should be notified quickly
    expect(duration).toBeLessThan(50)
    listeners.forEach((listener) => expect(listener).toHaveBeenCalledTimes(1))
  })
})
