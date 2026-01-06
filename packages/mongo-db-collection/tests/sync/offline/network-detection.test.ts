/**
 * @file Network Detection Tests - TDD (RED Phase)
 *
 * This test file verifies the Network Detection functionality for Layer 10 Offline Support.
 * The network detector monitors online/offline status using navigator.onLine and
 * online/offline events to enable proper offline-first behavior.
 *
 * Key behaviors tested:
 * 1. Initial online/offline status detection
 * 2. Event-based status change detection
 * 3. Manual status override capabilities
 * 4. Listener subscription management
 * 5. Proper cleanup and disposal
 *
 * RED PHASE: These tests define expected behavior before implementation
 * Bead ID: po0.184
 *
 * @module @tanstack/mongo-db-collection/tests/sync/offline/network-detection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createNetworkDetector,
  NetworkDetector,
  NetworkStatus,
  NetworkStatusListener,
  NetworkDetectorConfig,
} from '../../../src/sync/offline/network-detection'

// =============================================================================
// Mock Setup
// =============================================================================

/**
 * Mock navigator object
 */
let mockNavigator: { onLine: boolean; connection?: Record<string, unknown> } = { onLine: true }

/**
 * Mock navigator.onLine property
 */
function mockNavigatorOnLine(value: boolean): void {
  mockNavigator.onLine = value
}

/**
 * Create a mock window object for event handling
 */
function createMockWindow(): {
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  dispatchEvent: (event: Event) => void
  listeners: Map<string, Set<EventListener>>
} {
  const listeners = new Map<string, Set<EventListener>>()

  const addEventListener = vi.fn((type: string, handler: EventListener) => {
    if (!listeners.has(type)) {
      listeners.set(type, new Set())
    }
    listeners.get(type)!.add(handler)
  })

  const removeEventListener = vi.fn((type: string, handler: EventListener) => {
    listeners.get(type)?.delete(handler)
  })

  const dispatchEvent = (event: Event) => {
    listeners.get(event.type)?.forEach((handler) => handler(event))
  }

  return { addEventListener, removeEventListener, dispatchEvent, listeners }
}

// =============================================================================
// Initial Status Detection Tests
// =============================================================================

describe('Network Detection - Initial Status', () => {
  let detector: NetworkDetector

  beforeEach(() => {
    // Set up a mock navigator
    mockNavigator = { onLine: true }
    vi.stubGlobal('navigator', mockNavigator)
  })

  afterEach(() => {
    detector?.dispose()
    vi.unstubAllGlobals()
  })

  it('should detect initial online status when navigator.onLine is true', () => {
    mockNavigatorOnLine(true)
    detector = createNetworkDetector()

    expect(detector.isOnline()).toBe(true)
    expect(detector.getStatus()).toBe('online')
  })

  it('should detect initial offline status when navigator.onLine is false', () => {
    mockNavigatorOnLine(false)
    detector = createNetworkDetector()

    expect(detector.isOnline()).toBe(false)
    expect(detector.getStatus()).toBe('offline')
  })

  it('should default to online when navigator is unavailable', () => {
    vi.stubGlobal('navigator', undefined)
    detector = createNetworkDetector()

    expect(detector.isOnline()).toBe(true)
    expect(detector.getStatus()).toBe('online')
  })

  it('should default to online when navigator.onLine is undefined', () => {
    vi.stubGlobal('navigator', {})
    detector = createNetworkDetector()

    expect(detector.isOnline()).toBe(true)
    expect(detector.getStatus()).toBe('online')
  })

  it('should accept initial status override via configuration', () => {
    mockNavigatorOnLine(true)
    detector = createNetworkDetector({ initialStatus: 'offline' })

    expect(detector.isOnline()).toBe(false)
    expect(detector.getStatus()).toBe('offline')
  })
})

// =============================================================================
// Event-Based Status Change Tests
// =============================================================================

describe('Network Detection - Event-Based Changes', () => {
  let detector: NetworkDetector
  let mockWindow: ReturnType<typeof createMockWindow>

  beforeEach(() => {
    mockNavigator = { onLine: true }
    vi.stubGlobal('navigator', mockNavigator)
    mockWindow = createMockWindow()
    vi.stubGlobal('window', mockWindow)
  })

  afterEach(() => {
    detector?.dispose()
    vi.unstubAllGlobals()
  })

  it('should register event listeners on window for online/offline events', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    expect(mockWindow.addEventListener).toHaveBeenCalledWith('online', expect.any(Function))
    expect(mockWindow.addEventListener).toHaveBeenCalledWith('offline', expect.any(Function))
  })

  it('should update status when online event is fired', () => {
    mockNavigatorOnLine(false)
    detector = createNetworkDetector({
      initialStatus: 'offline',
      window: mockWindow as unknown as Window,
    })

    expect(detector.isOnline()).toBe(false)

    // Simulate online event
    mockNavigatorOnLine(true)
    mockWindow.dispatchEvent(new Event('online'))

    expect(detector.isOnline()).toBe(true)
    expect(detector.getStatus()).toBe('online')
  })

  it('should update status when offline event is fired', () => {
    mockNavigatorOnLine(true)
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    expect(detector.isOnline()).toBe(true)

    // Simulate offline event
    mockNavigatorOnLine(false)
    mockWindow.dispatchEvent(new Event('offline'))

    expect(detector.isOnline()).toBe(false)
    expect(detector.getStatus()).toBe('offline')
  })

  it('should handle rapid online/offline transitions', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    // Rapid transitions
    mockWindow.dispatchEvent(new Event('offline'))
    mockWindow.dispatchEvent(new Event('online'))
    mockWindow.dispatchEvent(new Event('offline'))
    mockWindow.dispatchEvent(new Event('online'))

    expect(detector.isOnline()).toBe(true)
  })

  it('should not duplicate listeners on multiple status checks', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    // Multiple status checks
    detector.isOnline()
    detector.getStatus()
    detector.isOnline()

    // Should only have registered once
    expect(mockWindow.addEventListener).toHaveBeenCalledTimes(2) // online + offline
  })
})

// =============================================================================
// Listener Subscription Tests
// =============================================================================

describe('Network Detection - Listener Subscriptions', () => {
  let detector: NetworkDetector
  let mockWindow: ReturnType<typeof createMockWindow>

  beforeEach(() => {
    mockNavigator = { onLine: true }
    vi.stubGlobal('navigator', mockNavigator)
    mockWindow = createMockWindow()
  })

  afterEach(() => {
    detector?.dispose()
    vi.unstubAllGlobals()
  })

  it('should allow subscribing to status changes', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const listener = vi.fn()
    detector.onStatusChange(listener)

    mockWindow.dispatchEvent(new Event('offline'))

    expect(listener).toHaveBeenCalledWith({
      status: 'offline',
      previousStatus: 'online',
      timestamp: expect.any(Date),
    })
  })

  it('should notify all listeners when status changes', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const listener1 = vi.fn()
    const listener2 = vi.fn()
    const listener3 = vi.fn()

    detector.onStatusChange(listener1)
    detector.onStatusChange(listener2)
    detector.onStatusChange(listener3)

    mockWindow.dispatchEvent(new Event('offline'))

    expect(listener1).toHaveBeenCalled()
    expect(listener2).toHaveBeenCalled()
    expect(listener3).toHaveBeenCalled()
  })

  it('should return unsubscribe function', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const listener = vi.fn()
    const unsubscribe = detector.onStatusChange(listener)

    mockWindow.dispatchEvent(new Event('offline'))
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    mockWindow.dispatchEvent(new Event('online'))
    expect(listener).toHaveBeenCalledTimes(1) // Not called again
  })

  it('should not notify listener when status does not change', () => {
    mockNavigatorOnLine(true)
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const listener = vi.fn()
    detector.onStatusChange(listener)

    // Fire online event when already online
    mockWindow.dispatchEvent(new Event('online'))

    expect(listener).not.toHaveBeenCalled()
  })

  it('should include previous status in change notification', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const listener = vi.fn()
    detector.onStatusChange(listener)

    mockWindow.dispatchEvent(new Event('offline'))

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        previousStatus: 'online',
        status: 'offline',
      })
    )

    mockWindow.dispatchEvent(new Event('online'))

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        previousStatus: 'offline',
        status: 'online',
      })
    )
  })

  it('should handle listener errors gracefully', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const badListener = vi.fn(() => {
      throw new Error('Listener error')
    })
    const goodListener = vi.fn()

    detector.onStatusChange(badListener)
    detector.onStatusChange(goodListener)

    // Should not throw
    expect(() => {
      mockWindow.dispatchEvent(new Event('offline'))
    }).not.toThrow()

    // Good listener should still be called
    expect(goodListener).toHaveBeenCalled()
  })

  it('should support once option for single notification', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const listener = vi.fn()
    detector.onStatusChange(listener, { once: true })

    mockWindow.dispatchEvent(new Event('offline'))
    mockWindow.dispatchEvent(new Event('online'))
    mockWindow.dispatchEvent(new Event('offline'))

    expect(listener).toHaveBeenCalledTimes(1)
  })
})

// =============================================================================
// Manual Status Override Tests
// =============================================================================

describe('Network Detection - Manual Status Override', () => {
  let detector: NetworkDetector
  let mockWindow: ReturnType<typeof createMockWindow>

  beforeEach(() => {
    mockNavigator = { onLine: true }
    vi.stubGlobal('navigator', mockNavigator)
    mockWindow = createMockWindow()
  })

  afterEach(() => {
    detector?.dispose()
    vi.unstubAllGlobals()
  })

  it('should allow manual status override', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    expect(detector.isOnline()).toBe(true)

    detector.setStatus('offline')

    expect(detector.isOnline()).toBe(false)
    expect(detector.getStatus()).toBe('offline')
  })

  it('should notify listeners on manual status change', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const listener = vi.fn()
    detector.onStatusChange(listener)

    detector.setStatus('offline')

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'offline',
        previousStatus: 'online',
      })
    )
  })

  it('should return previous status from setStatus', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const previousStatus = detector.setStatus('offline')

    expect(previousStatus).toBe('online')
  })

  it('should not notify listeners when manually setting same status', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const listener = vi.fn()
    detector.onStatusChange(listener)

    detector.setStatus('online') // Already online

    expect(listener).not.toHaveBeenCalled()
  })

  it('should support temporary override that auto-reverts', async () => {
    vi.useFakeTimers()
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const listener = vi.fn()
    detector.onStatusChange(listener)

    detector.setStatus('offline', { duration: 1000 })

    expect(detector.isOnline()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)

    expect(detector.isOnline()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('should cancel temporary override on new setStatus call', async () => {
    vi.useFakeTimers()
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    detector.setStatus('offline', { duration: 1000 })
    expect(detector.isOnline()).toBe(false)

    // Set a new status before duration expires
    detector.setStatus('online')

    vi.advanceTimersByTime(2000)

    // Should remain online (not reverted)
    expect(detector.isOnline()).toBe(true)

    vi.useRealTimers()
  })

  it('should pause automatic detection when in override mode', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    detector.setStatus('offline', { pauseAutoDetection: true })

    // Simulate online event - should be ignored
    mockNavigatorOnLine(true)
    mockWindow.dispatchEvent(new Event('online'))

    expect(detector.isOnline()).toBe(false)
  })

  it('should resume automatic detection when override is cleared', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    detector.setStatus('offline', { pauseAutoDetection: true })
    detector.clearOverride()

    // Now events should work
    mockWindow.dispatchEvent(new Event('online'))

    expect(detector.isOnline()).toBe(true)
  })
})

// =============================================================================
// Network Quality Detection Tests
// =============================================================================

describe('Network Detection - Network Quality', () => {
  let detector: NetworkDetector

  beforeEach(() => {
    mockNavigator = {
      onLine: true,
      connection: {
        effectiveType: '4g',
        downlink: 10,
        rtt: 50,
        saveData: false,
      },
    }
    vi.stubGlobal('navigator', mockNavigator)
  })

  afterEach(() => {
    detector?.dispose()
    vi.unstubAllGlobals()
  })

  it('should detect network quality when Network Information API is available', () => {
    detector = createNetworkDetector()

    const quality = detector.getNetworkQuality()

    expect(quality).toBeDefined()
    expect(quality?.effectiveType).toBe('4g')
    expect(quality?.downlink).toBe(10)
  })

  it('should return undefined quality when Network Information API is unavailable', () => {
    vi.stubGlobal('navigator', { onLine: true })
    detector = createNetworkDetector()

    const quality = detector.getNetworkQuality()

    expect(quality).toBeUndefined()
  })

  it('should detect slow connection based on effective type', () => {
    vi.stubGlobal('navigator', {
      onLine: true,
      connection: { effectiveType: '2g' },
    })
    detector = createNetworkDetector()

    expect(detector.isSlowConnection()).toBe(true)
  })

  it('should not mark 4g as slow connection', () => {
    detector = createNetworkDetector()

    expect(detector.isSlowConnection()).toBe(false)
  })

  it('should detect save data mode', () => {
    vi.stubGlobal('navigator', {
      onLine: true,
      connection: { saveData: true },
    })
    detector = createNetworkDetector()

    expect(detector.isSaveDataMode()).toBe(true)
  })
})

// =============================================================================
// Cleanup and Disposal Tests
// =============================================================================

describe('Network Detection - Cleanup and Disposal', () => {
  let detector: NetworkDetector
  let mockWindow: ReturnType<typeof createMockWindow>

  beforeEach(() => {
    mockNavigator = { onLine: true }
    vi.stubGlobal('navigator', mockNavigator)
    mockWindow = createMockWindow()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should remove event listeners on dispose', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    detector.dispose()

    expect(mockWindow.removeEventListener).toHaveBeenCalledWith('online', expect.any(Function))
    expect(mockWindow.removeEventListener).toHaveBeenCalledWith('offline', expect.any(Function))
  })

  it('should clear all status listeners on dispose', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const listener = vi.fn()
    detector.onStatusChange(listener)

    detector.dispose()

    // Try to trigger a change - should not call listener
    mockWindow.dispatchEvent(new Event('offline'))

    expect(listener).not.toHaveBeenCalled()
  })

  it('should mark as disposed', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    expect(detector.isDisposed).toBe(false)

    detector.dispose()

    expect(detector.isDisposed).toBe(true)
  })

  it('should be idempotent on multiple dispose calls', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    expect(() => {
      detector.dispose()
      detector.dispose()
      detector.dispose()
    }).not.toThrow()
  })

  it('should ignore operations after dispose', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    detector.dispose()

    // These should not throw
    expect(() => {
      detector.setStatus('offline')
      detector.onStatusChange(() => {})
      detector.clearOverride()
    }).not.toThrow()

    // Status should remain at last known
    expect(detector.isOnline()).toBe(true)
  })

  it('should cancel pending timeouts on dispose', () => {
    vi.useFakeTimers()
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    detector.setStatus('offline', { duration: 5000 })
    detector.dispose()

    vi.advanceTimersByTime(10000)

    // Should not throw or cause issues
    expect(detector.isDisposed).toBe(true)

    vi.useRealTimers()
  })
})

// =============================================================================
// Statistics and Debugging Tests
// =============================================================================

describe('Network Detection - Statistics', () => {
  let detector: NetworkDetector
  let mockWindow: ReturnType<typeof createMockWindow>

  beforeEach(() => {
    mockNavigator = { onLine: true }
    vi.stubGlobal('navigator', mockNavigator)
    mockWindow = createMockWindow()
  })

  afterEach(() => {
    detector?.dispose()
    vi.unstubAllGlobals()
  })

  it('should track status change count', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const stats = detector.getStats()
    expect(stats.statusChangeCount).toBe(0)

    mockWindow.dispatchEvent(new Event('offline'))
    mockWindow.dispatchEvent(new Event('online'))
    mockWindow.dispatchEvent(new Event('offline'))

    const newStats = detector.getStats()
    expect(newStats.statusChangeCount).toBe(3)
  })

  it('should track time in current status', () => {
    vi.useFakeTimers()
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    vi.advanceTimersByTime(5000)

    const stats = detector.getStats()
    expect(stats.timeInCurrentStatus).toBeGreaterThanOrEqual(5000)

    vi.useRealTimers()
  })

  it('should track last status change timestamp', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const beforeChange = new Date()
    mockWindow.dispatchEvent(new Event('offline'))
    const afterChange = new Date()

    const stats = detector.getStats()
    expect(stats.lastChangeTimestamp).toBeDefined()
    expect(stats.lastChangeTimestamp!.getTime()).toBeGreaterThanOrEqual(beforeChange.getTime())
    expect(stats.lastChangeTimestamp!.getTime()).toBeLessThanOrEqual(afterChange.getTime())
  })

  it('should track uptime percentage', () => {
    vi.useFakeTimers()
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    // Online for 8 seconds
    vi.advanceTimersByTime(8000)

    mockWindow.dispatchEvent(new Event('offline'))

    // Offline for 2 seconds
    vi.advanceTimersByTime(2000)

    const stats = detector.getStats()
    expect(stats.uptimePercentage).toBeCloseTo(80, 0)

    vi.useRealTimers()
  })

  it('should provide stats snapshot', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const stats = detector.getStats()

    expect(stats).toEqual(
      expect.objectContaining({
        currentStatus: 'online',
        statusChangeCount: expect.any(Number),
        timeInCurrentStatus: expect.any(Number),
        isOverridden: false,
      })
    )
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Network Detection - Integration', () => {
  let detector: NetworkDetector
  let mockWindow: ReturnType<typeof createMockWindow>

  beforeEach(() => {
    mockNavigator = { onLine: true }
    vi.stubGlobal('navigator', mockNavigator)
    mockWindow = createMockWindow()
  })

  afterEach(() => {
    detector?.dispose()
    vi.unstubAllGlobals()
  })

  it('should support complete offline/online workflow', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const statusHistory: NetworkStatus[] = []
    detector.onStatusChange(({ status }) => {
      statusHistory.push(status)
    })

    // Initially online
    expect(detector.isOnline()).toBe(true)

    // Go offline
    mockWindow.dispatchEvent(new Event('offline'))
    expect(detector.isOnline()).toBe(false)

    // Stay offline, do some operations
    expect(detector.getStatus()).toBe('offline')

    // Come back online
    mockWindow.dispatchEvent(new Event('online'))
    expect(detector.isOnline()).toBe(true)

    // Verify history
    expect(statusHistory).toEqual(['offline', 'online'])
  })

  it('should integrate manual override with automatic detection', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    // Simulate a scenario where we want to force offline for testing
    detector.setStatus('offline', { pauseAutoDetection: true })
    expect(detector.isOnline()).toBe(false)

    // Browser says we're online, but override is active
    mockWindow.dispatchEvent(new Event('online'))
    expect(detector.isOnline()).toBe(false)

    // Clear override
    detector.clearOverride()

    // Now browser events work
    expect(detector.isOnline()).toBe(true)
  })

  it('should work correctly in SSR environment (no window)', () => {
    vi.stubGlobal('window', undefined)

    detector = createNetworkDetector()

    // Should still work with defaults
    expect(detector.isOnline()).toBe(true)
    expect(() => detector.setStatus('offline')).not.toThrow()
    expect(detector.isOnline()).toBe(false)
  })
})

// =============================================================================
// Performance Tests
// =============================================================================

describe('Network Detection - Performance', () => {
  let detector: NetworkDetector
  let mockWindow: ReturnType<typeof createMockWindow>

  beforeEach(() => {
    mockNavigator = { onLine: true }
    vi.stubGlobal('navigator', mockNavigator)
    mockWindow = createMockWindow()
  })

  afterEach(() => {
    detector?.dispose()
    vi.unstubAllGlobals()
  })

  it('should handle many listeners efficiently', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const listeners = Array.from({ length: 100 }, () => vi.fn())
    listeners.forEach((listener) => detector.onStatusChange(listener))

    const start = performance.now()
    mockWindow.dispatchEvent(new Event('offline'))
    const duration = performance.now() - start

    // 100 listeners should be notified quickly
    expect(duration).toBeLessThan(50)
    listeners.forEach((listener) => expect(listener).toHaveBeenCalledTimes(1))
  })

  it('should handle rapid status checks efficiently', () => {
    detector = createNetworkDetector({ window: mockWindow as unknown as Window })

    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      detector.isOnline()
      detector.getStatus()
    }
    const duration = performance.now() - start

    // 20000 status checks should complete in under 100ms
    expect(duration).toBeLessThan(100)
  })
})
