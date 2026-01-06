/**
 * @file Subscription Cleanup Tests (RED Phase - TDD)
 *
 * These tests verify that subscriptions are properly cleaned up when unsubscribed.
 * The current implementation has a memory leak where subscriptions are added to
 * the subscriptions array but never removed on unsubscribe.
 *
 * Features being tested:
 * - Subscriptions are removed from the array when unsubscribed
 * - Subscriptions array doesn't grow unbounded with subscribe/unsubscribe cycles
 * - Only active subscriptions are restored after reconnection
 * - Unsubscribed subscriptions are not restored after reconnection
 *
 * Bug Location: ws-transport.ts:633-635
 * Issue: tanstackdb-c7t
 *
 * RED PHASE: These tests will fail until subscription cleanup is implemented.
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSocketTransport } from '../../src/rpc/ws-transport'

// Polyfill CloseEvent for Node.js environment
class CloseEvent extends Event {
  code: number
  reason: string
  wasClean: boolean

  constructor(type: string, init?: { code?: number; reason?: string; wasClean?: boolean }) {
    super(type)
    this.code = init?.code ?? 1000
    this.reason = init?.reason ?? ''
    this.wasClean = init?.wasClean ?? true
  }
}

// Polyfill ErrorEvent for Node.js environment
class ErrorEvent extends Event {
  error: Error | undefined
  message: string

  constructor(type: string, init?: { error?: Error; message?: string }) {
    super(type)
    this.error = init?.error
    this.message = init?.message ?? ''
  }
}

// Make polyfills available globally
;(globalThis as any).CloseEvent = CloseEvent
;(globalThis as any).ErrorEvent = ErrorEvent

// Mock WebSocket for testing
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  protocols?: string | string[]
  readyState: number = MockWebSocket.CONNECTING
  binaryType: 'blob' | 'arraybuffer' = 'blob'
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  private messageQueue: string[] = []

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
  }

  send(data: string | ArrayBuffer): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.messageQueue.push(typeof data === 'string' ? data : '[binary]')
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSING
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code: code || 1000, reason }))
    }
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    if (this.onopen) {
      this.onopen(new Event('open'))
    }
  }

  simulateMessage(data: string | object): void {
    if (this.onmessage) {
      const messageData = typeof data === 'string' ? data : JSON.stringify(data)
      this.onmessage(new MessageEvent('message', { data: messageData }))
    }
  }

  simulateClose(code: number = 1000, reason: string = ''): void {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code, reason }))
    }
  }

  getLastMessage(): string | undefined {
    return this.messageQueue[this.messageQueue.length - 1]
  }

  getAllMessages(): string[] {
    return [...this.messageQueue]
  }

  clearMessages(): void {
    this.messageQueue = []
  }
}

// Store original WebSocket for restoration
const originalWebSocket = globalThis.WebSocket

describe('Subscription Cleanup (Memory Leak Fix)', () => {
  let mockWs: MockWebSocket
  let transport: WebSocketTransport
  let wsInstances: MockWebSocket[] = []

  beforeEach(() => {
    wsInstances = []
    // Replace global WebSocket with mock that tracks all instances
    const MockWebSocketConstructor = vi.fn((url: string, protocols?: string | string[]) => {
      mockWs = new MockWebSocket(url, protocols)
      wsInstances.push(mockWs)
      return mockWs
    }) as unknown as typeof WebSocket
    ;(MockWebSocketConstructor as any).CONNECTING = MockWebSocket.CONNECTING
    ;(MockWebSocketConstructor as any).OPEN = MockWebSocket.OPEN
    ;(MockWebSocketConstructor as any).CLOSING = MockWebSocket.CLOSING
    ;(MockWebSocketConstructor as any).CLOSED = MockWebSocket.CLOSED
    ;(globalThis as any).WebSocket = MockWebSocketConstructor
    vi.useFakeTimers()
  })

  afterEach(() => {
    ;(globalThis as any).WebSocket = originalWebSocket
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('Subscription Removal on Unsubscribe', () => {
    beforeEach(() => {
      transport = new WebSocketTransport({
        url: 'ws://localhost:8080/mongo',
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
        heartbeatInterval: 0,
      })
    })

    it('should remove subscription from internal array when unsubscribe is called', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Create a subscription
      const subPromise = transport.send('subscribe', { collection: 'users' })
      let msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: 'sub-123' } })
      await subPromise

      // Now unsubscribe
      const unsubPromise = transport.send('unsubscribe', { subscriptionId: 'sub-123' })
      msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { success: true } })
      await unsubPromise

      mockWs.clearMessages()

      // Disconnect and reconnect
      mockWs.simulateClose(1006, 'Connection lost')
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      // Should NOT have re-subscribed since we unsubscribed
      const messages = mockWs.getAllMessages()
      const subscribeMessages = messages.filter((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'subscribe'
      })

      expect(subscribeMessages.length).toBe(0)
    })

    it('should remove subscription by subscriptionId when unsubscribing', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Create two subscriptions
      const subPromise1 = transport.send('subscribe', { collection: 'users' })
      let msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: 'sub-users' } })
      await subPromise1

      const subPromise2 = transport.send('subscribe', { collection: 'orders' })
      msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: 'sub-orders' } })
      await subPromise2

      // Unsubscribe from first one only
      const unsubPromise = transport.send('unsubscribe', { subscriptionId: 'sub-users' })
      msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { success: true } })
      await unsubPromise

      mockWs.clearMessages()

      // Disconnect and reconnect
      mockWs.simulateClose(1006, 'Connection lost')
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      // Should only re-subscribe to 'orders', not 'users'
      const messages = mockWs.getAllMessages()
      const subscribeMessages = messages.filter((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'subscribe'
      })

      expect(subscribeMessages.length).toBe(1)
      const parsedSub = JSON.parse(subscribeMessages[0])
      expect(parsedSub.params.collection).toBe('orders')
    })
  })

  describe('Subscription Array Growth Prevention', () => {
    beforeEach(() => {
      transport = new WebSocketTransport({
        url: 'ws://localhost:8080/mongo',
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
        heartbeatInterval: 0,
      })
    })

    it('should not grow subscriptions array unboundedly with subscribe/unsubscribe cycles', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Do 100 subscribe/unsubscribe cycles
      for (let i = 0; i < 100; i++) {
        // Subscribe
        const subPromise = transport.send('subscribe', { collection: `collection-${i}` })
        let msg = JSON.parse(mockWs.getLastMessage()!)
        mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: `sub-${i}` } })
        await subPromise

        // Unsubscribe
        const unsubPromise = transport.send('unsubscribe', { subscriptionId: `sub-${i}` })
        msg = JSON.parse(mockWs.getLastMessage()!)
        mockWs.simulateMessage({ id: msg.id, result: { success: true } })
        await unsubPromise
      }

      mockWs.clearMessages()

      // Disconnect and reconnect
      mockWs.simulateClose(1006, 'Connection lost')
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      // Should have ZERO re-subscriptions since all were unsubscribed
      const messages = mockWs.getAllMessages()
      const subscribeMessages = messages.filter((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'subscribe'
      })

      expect(subscribeMessages.length).toBe(0)
    })

    it('should maintain correct subscription count after mixed operations', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Subscribe to 5 collections
      for (let i = 0; i < 5; i++) {
        const subPromise = transport.send('subscribe', { collection: `collection-${i}` })
        const msg = JSON.parse(mockWs.getLastMessage()!)
        mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: `sub-${i}` } })
        await subPromise
      }

      // Unsubscribe from 3 (indices 0, 2, 4)
      for (const i of [0, 2, 4]) {
        const unsubPromise = transport.send('unsubscribe', { subscriptionId: `sub-${i}` })
        const msg = JSON.parse(mockWs.getLastMessage()!)
        mockWs.simulateMessage({ id: msg.id, result: { success: true } })
        await unsubPromise
      }

      mockWs.clearMessages()

      // Disconnect and reconnect
      mockWs.simulateClose(1006, 'Connection lost')
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      // Should only re-subscribe to 2 collections (indices 1 and 3)
      const messages = mockWs.getAllMessages()
      const subscribeMessages = messages.filter((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'subscribe'
      })

      expect(subscribeMessages.length).toBe(2)

      // Verify correct collections
      const restoredCollections = subscribeMessages.map((m) => {
        const parsed = JSON.parse(m)
        return parsed.params.collection
      })
      expect(restoredCollections).toContain('collection-1')
      expect(restoredCollections).toContain('collection-3')
      expect(restoredCollections).not.toContain('collection-0')
      expect(restoredCollections).not.toContain('collection-2')
      expect(restoredCollections).not.toContain('collection-4')
    })
  })

  describe('Active Subscription Restoration Only', () => {
    beforeEach(() => {
      transport = new WebSocketTransport({
        url: 'ws://localhost:8080/mongo',
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
        heartbeatInterval: 0,
      })
    })

    it('should only restore active subscriptions after reconnection', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Create 3 subscriptions
      const subs = ['active-1', 'inactive', 'active-2']
      for (let i = 0; i < 3; i++) {
        const subPromise = transport.send('subscribe', { collection: subs[i] })
        const msg = JSON.parse(mockWs.getLastMessage()!)
        mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: `sub-${subs[i]}` } })
        await subPromise
      }

      // Unsubscribe from the middle one
      const unsubPromise = transport.send('unsubscribe', { subscriptionId: 'sub-inactive' })
      const msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { success: true } })
      await unsubPromise

      mockWs.clearMessages()

      // Disconnect and reconnect
      mockWs.simulateClose(1006, 'Connection lost')
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      // Should only restore active-1 and active-2
      const messages = mockWs.getAllMessages()
      const subscribeMessages = messages.filter((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'subscribe'
      })

      expect(subscribeMessages.length).toBe(2)

      const restoredCollections = subscribeMessages.map((m) => {
        const parsed = JSON.parse(m)
        return parsed.params.collection
      })
      expect(restoredCollections).toContain('active-1')
      expect(restoredCollections).toContain('active-2')
      expect(restoredCollections).not.toContain('inactive')
    })

    it('should not restore subscriptions that were unsubscribed before disconnect', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Subscribe
      const subPromise = transport.send('subscribe', { collection: 'temp-data' })
      let msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: 'temp-sub' } })
      await subPromise

      // Unsubscribe
      const unsubPromise = transport.send('unsubscribe', { subscriptionId: 'temp-sub' })
      msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { success: true } })
      await unsubPromise

      mockWs.clearMessages()

      // Disconnect and reconnect
      mockWs.simulateClose(1006, 'Connection lost')
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      // Should NOT restore the unsubscribed subscription
      const messages = mockWs.getAllMessages()
      const subscribeMessages = messages.filter((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'subscribe'
      })

      expect(subscribeMessages.length).toBe(0)
    })

    it('should preserve subscription params when restoring active subscriptions', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Create a subscription with complex params
      const subParams = {
        collection: 'users',
        filter: { active: true, role: 'admin' },
        projection: { name: 1, email: 1 },
      }
      const subPromise = transport.send('subscribe', subParams)
      const msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: 'sub-users' } })
      await subPromise

      mockWs.clearMessages()

      // Disconnect and reconnect
      mockWs.simulateClose(1006, 'Connection lost')
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      // Should restore with original params
      const messages = mockWs.getAllMessages()
      const subscribeMessage = messages.find((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'subscribe'
      })

      expect(subscribeMessage).toBeDefined()
      const parsed = JSON.parse(subscribeMessage!)
      expect(parsed.params).toEqual(subParams)
    })
  })

  describe('Edge Cases', () => {
    beforeEach(() => {
      transport = new WebSocketTransport({
        url: 'ws://localhost:8080/mongo',
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
        heartbeatInterval: 0,
      })
    })

    it('should handle unsubscribe for non-existent subscription gracefully', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Try to unsubscribe from a subscription that was never created
      const unsubPromise = transport.send('unsubscribe', { subscriptionId: 'non-existent' })
      const msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { success: false, error: 'Not found' } })

      // Should not throw
      await expect(unsubPromise).resolves.toBeDefined()
    })

    it('should handle rapid subscribe/unsubscribe correctly', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Rapidly subscribe and unsubscribe
      const subPromise = transport.send('subscribe', { collection: 'rapid' })
      let msg = JSON.parse(mockWs.getLastMessage()!)
      const subId = msg.id

      // Immediately request unsubscribe (before subscribe response)
      const unsubPromise = transport.send('unsubscribe', { subscriptionId: 'rapid-sub' })
      msg = JSON.parse(mockWs.getLastMessage()!)
      const unsubId = msg.id

      // Now respond to subscribe
      mockWs.simulateMessage({ id: subId, result: { subscriptionId: 'rapid-sub' } })
      await subPromise

      // Then respond to unsubscribe
      mockWs.simulateMessage({ id: unsubId, result: { success: true } })
      await unsubPromise

      mockWs.clearMessages()

      // Disconnect and reconnect
      mockWs.simulateClose(1006, 'Connection lost')
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      // Should NOT restore since it was unsubscribed
      const messages = mockWs.getAllMessages()
      const subscribeMessages = messages.filter((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'subscribe'
      })

      expect(subscribeMessages.length).toBe(0)
    })

    it('should handle multiple unsubscribes for same subscription', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Subscribe
      const subPromise = transport.send('subscribe', { collection: 'double-unsub' })
      let msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: 'double-sub' } })
      await subPromise

      // Unsubscribe twice
      const unsubPromise1 = transport.send('unsubscribe', { subscriptionId: 'double-sub' })
      msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { success: true } })
      await unsubPromise1

      const unsubPromise2 = transport.send('unsubscribe', { subscriptionId: 'double-sub' })
      msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { success: false, error: 'Already unsubscribed' } })
      await unsubPromise2

      mockWs.clearMessages()

      // Disconnect and reconnect
      mockWs.simulateClose(1006, 'Connection lost')
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      // Should not restore
      const messages = mockWs.getAllMessages()
      const subscribeMessages = messages.filter((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'subscribe'
      })

      expect(subscribeMessages.length).toBe(0)
    })

    it('should clear all subscriptions on intentional disconnect', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Create subscriptions
      for (let i = 0; i < 3; i++) {
        const subPromise = transport.send('subscribe', { collection: `coll-${i}` })
        const msg = JSON.parse(mockWs.getLastMessage()!)
        mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: `sub-${i}` } })
        await subPromise
      }

      // Intentional disconnect
      await transport.disconnect()

      // Reconnect manually
      const reconnectPromise = transport.connect()
      mockWs.simulateOpen()
      await reconnectPromise

      // After intentional disconnect, subscriptions should be cleared
      // (user needs to re-subscribe manually)
      mockWs.clearMessages()

      // Simulate another disconnect/reconnect cycle
      mockWs.simulateClose(1006, 'Connection lost')
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      // Should have no subscriptions to restore from before intentional disconnect
      const messages = mockWs.getAllMessages()
      const subscribeMessages = messages.filter((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'subscribe'
      })

      expect(subscribeMessages.length).toBe(0)
    })
  })

  describe('Subscription Count Accessor', () => {
    beforeEach(() => {
      transport = new WebSocketTransport({
        url: 'ws://localhost:8080/mongo',
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
        heartbeatInterval: 0,
      })
    })

    it('should expose subscription count for monitoring', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Initial count should be 0
      expect(transport.subscriptionCount).toBe(0)

      // Subscribe
      const subPromise = transport.send('subscribe', { collection: 'monitored' })
      const msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: 'mon-sub' } })
      await subPromise

      // Count should be 1
      expect(transport.subscriptionCount).toBe(1)

      // Unsubscribe
      const unsubPromise = transport.send('unsubscribe', { subscriptionId: 'mon-sub' })
      const msg2 = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg2.id, result: { success: true } })
      await unsubPromise

      // Count should be back to 0
      expect(transport.subscriptionCount).toBe(0)
    })
  })
})
