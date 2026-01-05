/**
 * @file WebSocket Transport Tests (RED Phase - TDD)
 *
 * These tests verify the WebSocket transport implementation for @tanstack/mongo-db-collection.
 * The WebSocketTransport class provides real-time bidirectional communication with
 * MongoDB servers, supporting RPC calls, push messages (change events), and connection management.
 *
 * Features being tested:
 * - Constructor with WebSocket URL configuration
 * - Connection establishment and lifecycle
 * - Request/response correlation via message IDs
 * - Push message handling for server-initiated events
 * - Auto-reconnection on connection loss
 * - Heartbeat/ping-pong keep-alive mechanism
 * - Error event handling
 * - Binary message support (optional feature)
 *
 * RED PHASE: These tests will fail until WebSocketTransport is implemented in src/rpc/ws-transport.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSocketTransport } from '../../src/rpc/ws-transport'
import type {
  WebSocketTransportOptions,
  RPCMessage,
  RPCResponse,
  PushMessage,
  TransportState,
} from '../../src/rpc/ws-transport'

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
  readyState: number = MockWebSocket.CONNECTING
  binaryType: 'blob' | 'arraybuffer' = 'blob'
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  private messageQueue: string[] = []

  constructor(url: string) {
    this.url = url
  }

  send(data: string | ArrayBuffer): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.messageQueue.push(typeof data === 'string' ? data : '[binary]')
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSING
    // Fire onclose synchronously for predictable test behavior
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

  simulateBinaryMessage(data: ArrayBuffer): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }))
    }
  }

  simulateError(error: Error): void {
    if (this.onerror) {
      const event = new ErrorEvent('error', { error, message: error.message })
      this.onerror(event)
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

describe('WebSocketTransport', () => {
  let mockWs: MockWebSocket
  let transport: WebSocketTransport

  beforeEach(() => {
    // Replace global WebSocket with mock that includes static constants
    const MockWebSocketConstructor = vi.fn((url: string) => {
      mockWs = new MockWebSocket(url)
      return mockWs
    }) as unknown as typeof WebSocket
    // Add static constants that the implementation relies on
    ;(MockWebSocketConstructor as any).CONNECTING = MockWebSocket.CONNECTING
    ;(MockWebSocketConstructor as any).OPEN = MockWebSocket.OPEN
    ;(MockWebSocketConstructor as any).CLOSING = MockWebSocket.CLOSING
    ;(MockWebSocketConstructor as any).CLOSED = MockWebSocket.CLOSED
    ;(globalThis as any).WebSocket = MockWebSocketConstructor
    vi.useFakeTimers()
  })

  afterEach(() => {
    // Restore original WebSocket
    ;(globalThis as any).WebSocket = originalWebSocket
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('Constructor', () => {
    it('should construct with WS URL', () => {
      const url = 'ws://localhost:8080/mongo'
      transport = new WebSocketTransport(url)

      expect(transport).toBeInstanceOf(WebSocketTransport)
      expect(transport.url).toBe(url)
    })

    it('should construct with WSS URL', () => {
      const url = 'wss://secure.example.com/mongo'
      transport = new WebSocketTransport(url)

      expect(transport).toBeInstanceOf(WebSocketTransport)
      expect(transport.url).toBe(url)
    })

    it('should construct with options object', () => {
      const options: WebSocketTransportOptions = {
        url: 'ws://localhost:8080/mongo',
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 5,
        heartbeatInterval: 30000,
        requestTimeout: 10000,
      }

      transport = new WebSocketTransport(options)

      expect(transport.url).toBe(options.url)
      expect(transport.options.reconnect).toBe(true)
      expect(transport.options.reconnectInterval).toBe(1000)
      expect(transport.options.maxReconnectAttempts).toBe(5)
      expect(transport.options.heartbeatInterval).toBe(30000)
      expect(transport.options.requestTimeout).toBe(10000)
    })

    it('should use default options when not provided', () => {
      transport = new WebSocketTransport('ws://localhost:8080')

      expect(transport.options.reconnect).toBe(true)
      expect(transport.options.reconnectInterval).toBeGreaterThan(0)
      expect(transport.options.maxReconnectAttempts).toBeGreaterThan(0)
      expect(transport.options.heartbeatInterval).toBeGreaterThan(0)
      expect(transport.options.requestTimeout).toBeGreaterThan(0)
    })

    it('should throw error for invalid URL scheme', () => {
      expect(() => new WebSocketTransport('http://localhost:8080')).toThrow()
      expect(() => new WebSocketTransport('https://localhost:8080')).toThrow()
      expect(() => new WebSocketTransport('invalid://localhost')).toThrow()
    })

    it('should initialize in disconnected state', () => {
      transport = new WebSocketTransport('ws://localhost:8080')
      expect(transport.state).toBe('disconnected')
    })
  })

  describe('Connection Management', () => {
    beforeEach(() => {
      transport = new WebSocketTransport('ws://localhost:8080/mongo')
    })

    it('should connect via WebSocket', async () => {
      const connectPromise = transport.connect()

      // Simulate successful connection
      mockWs.simulateOpen()

      await expect(connectPromise).resolves.toBeUndefined()
      expect(transport.state).toBe('connected')
    })

    it('should transition to connecting state during connection', () => {
      transport.connect()
      expect(transport.state).toBe('connecting')
    })

    it('should reject connection if WebSocket fails to open', async () => {
      const connectPromise = transport.connect()

      // Simulate connection error
      mockWs.simulateError(new Error('Connection refused'))
      mockWs.simulateClose(1006, 'Connection failed')

      await expect(connectPromise).rejects.toThrow()
      expect(transport.state).toBe('disconnected')
    })

    it('should disconnect cleanly', async () => {
      // First connect
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Then disconnect
      const disconnectPromise = transport.disconnect()

      await expect(disconnectPromise).resolves.toBeUndefined()
      expect(transport.state).toBe('disconnected')
    })

    it('should handle disconnect when not connected', async () => {
      // Should not throw when disconnecting from already disconnected state
      await expect(transport.disconnect()).resolves.toBeUndefined()
    })

    it('should emit state change events', async () => {
      const stateChanges: TransportState[] = []
      transport.on('stateChange', (state) => stateChanges.push(state))

      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      expect(stateChanges).toContain('connecting')
      expect(stateChanges).toContain('connected')
    })

    it('should not allow multiple simultaneous connections', async () => {
      const connectPromise1 = transport.connect()
      const connectPromise2 = transport.connect()

      mockWs.simulateOpen()

      await connectPromise1
      // Second connection should resolve to same result or be rejected
      await expect(connectPromise2).resolves.toBeUndefined()
    })

    it('should clean up resources on disconnect', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Start some pending requests
      const requestPromise = transport.send('test', {})

      // Disconnect should reject pending requests
      await transport.disconnect()

      await expect(requestPromise).rejects.toThrow()
    })
  })

  describe('Request/Response', () => {
    beforeEach(async () => {
      transport = new WebSocketTransport('ws://localhost:8080/mongo')
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise
    })

    it('should send message and await response', async () => {
      const sendPromise = transport.send('find', { collection: 'users', filter: {} })

      // Get the sent message
      const sentMessage = JSON.parse(mockWs.getLastMessage()!)
      expect(sentMessage.method).toBe('find')
      expect(sentMessage.params).toEqual({ collection: 'users', filter: {} })
      expect(sentMessage.id).toBeDefined()

      // Simulate response
      mockWs.simulateMessage({
        id: sentMessage.id,
        result: [{ _id: '1', name: 'Alice' }],
      })

      const response = await sendPromise
      expect(response).toEqual([{ _id: '1', name: 'Alice' }])
    })

    it('should correlate request/response by ID', async () => {
      // Send multiple requests
      const promise1 = transport.send('find', { collection: 'users' })
      const promise2 = transport.send('find', { collection: 'orders' })
      const promise3 = transport.send('count', { collection: 'products' })

      const messages = mockWs.getAllMessages().map((m) => JSON.parse(m))
      expect(messages.length).toBe(3)

      // All IDs should be unique
      const ids = messages.map((m) => m.id)
      expect(new Set(ids).size).toBe(3)

      // Respond out of order
      mockWs.simulateMessage({ id: messages[1].id, result: { orders: [] } })
      mockWs.simulateMessage({ id: messages[2].id, result: { count: 42 } })
      mockWs.simulateMessage({ id: messages[0].id, result: { users: [] } })

      // Each promise should resolve with its correct response
      await expect(promise1).resolves.toEqual({ users: [] })
      await expect(promise2).resolves.toEqual({ orders: [] })
      await expect(promise3).resolves.toEqual({ count: 42 })
    })

    it('should handle RPC error responses', async () => {
      const sendPromise = transport.send('find', { collection: 'nonexistent' })

      const sentMessage = JSON.parse(mockWs.getLastMessage()!)

      // Simulate error response
      mockWs.simulateMessage({
        id: sentMessage.id,
        error: {
          code: -32600,
          message: 'Collection not found',
          data: { collection: 'nonexistent' },
        },
      })

      await expect(sendPromise).rejects.toMatchObject({
        code: -32600,
        message: 'Collection not found',
      })
    })

    it('should timeout pending requests', async () => {
      // Create transport with short timeout and disabled heartbeat to avoid timer interference
      transport = new WebSocketTransport({
        url: 'ws://localhost:8080',
        requestTimeout: 1000,
        heartbeatInterval: 0, // Disable heartbeat for this test
      })
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Attach rejection handler immediately to avoid unhandled rejection warning
      let rejectionError: Error | null = null
      const sendPromise = transport.send('slowOperation', {}).catch((err) => {
        rejectionError = err
      })

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(1500)

      await sendPromise
      expect(rejectionError).toBeTruthy()
      expect(rejectionError!.message).toMatch(/timeout/i)
    })

    it('should reject requests when not connected', async () => {
      await transport.disconnect()

      await expect(transport.send('find', {})).rejects.toThrow(/not connected/i)
    })

    it('should include request metadata in messages', async () => {
      const sendPromise = transport.send('find', { filter: {} }, { requestId: 'custom-123' })

      const sentMessage = JSON.parse(mockWs.getLastMessage()!)

      // Respond to prevent hanging test
      mockWs.simulateMessage({ id: sentMessage.id, result: [] })
      await sendPromise

      expect(sentMessage.id).toBe('custom-123')
    })

    it('should generate unique request IDs', async () => {
      const ids = new Set<string>()

      for (let i = 0; i < 100; i++) {
        const promise = transport.send('test', {})
        const msg = JSON.parse(mockWs.getLastMessage()!)
        ids.add(msg.id)
        mockWs.simulateMessage({ id: msg.id, result: null })
        await promise
      }

      expect(ids.size).toBe(100)
    })
  })

  describe('Push Messages', () => {
    beforeEach(async () => {
      transport = new WebSocketTransport('ws://localhost:8080/mongo')
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise
    })

    it('should emit push messages', async () => {
      const pushHandler = vi.fn()
      transport.on('push', pushHandler)

      // Simulate server-initiated push (no id, has method)
      mockWs.simulateMessage({
        method: 'changeEvent',
        params: {
          operationType: 'insert',
          fullDocument: { _id: '1', name: 'New Doc' },
          ns: { db: 'test', coll: 'users' },
        },
      })

      expect(pushHandler).toHaveBeenCalledTimes(1)
      expect(pushHandler).toHaveBeenCalledWith({
        method: 'changeEvent',
        params: expect.objectContaining({
          operationType: 'insert',
        }),
      })
    })

    it('should distinguish push messages from responses', async () => {
      const pushHandler = vi.fn()
      const responseHandler = vi.fn()

      transport.on('push', pushHandler)

      const sendPromise = transport.send('find', {})
      const msg = JSON.parse(mockWs.getLastMessage()!)

      // Simulate a push message (no id field, has method)
      mockWs.simulateMessage({
        method: 'changeEvent',
        params: { type: 'insert' },
      })

      // Simulate response (has id, matches request)
      mockWs.simulateMessage({
        id: msg.id,
        result: [],
      })

      await sendPromise

      // Push handler should be called for push message only
      expect(pushHandler).toHaveBeenCalledTimes(1)
      expect(pushHandler).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'changeEvent' })
      )
    })

    it('should handle change stream events', async () => {
      const changeHandler = vi.fn()
      transport.on('change', changeHandler)

      mockWs.simulateMessage({
        method: 'change',
        params: {
          operationType: 'update',
          documentKey: { _id: '123' },
          updateDescription: {
            updatedFields: { name: 'Updated' },
            removedFields: [],
          },
        },
      })

      expect(changeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'update',
          documentKey: { _id: '123' },
        })
      )
    })

    it('should handle subscription notifications', async () => {
      const subscriptionHandler = vi.fn()
      transport.on('subscription', subscriptionHandler)

      // Subscribe to collection changes
      const subscribePromise = transport.send('subscribe', { collection: 'users' })
      const msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: 'sub-1' } })
      await subscribePromise

      // Simulate subscription notification
      mockWs.simulateMessage({
        method: 'subscription.data',
        params: {
          subscriptionId: 'sub-1',
          data: [
            { _id: '1', name: 'Alice' },
            { _id: '2', name: 'Bob' },
          ],
        },
      })

      expect(subscriptionHandler).toHaveBeenCalled()
    })

    it('should emit typed events based on push method', async () => {
      const insertHandler = vi.fn()
      const updateHandler = vi.fn()
      const deleteHandler = vi.fn()

      transport.on('insert', insertHandler)
      transport.on('update', updateHandler)
      transport.on('delete', deleteHandler)

      mockWs.simulateMessage({ method: 'insert', params: { doc: { _id: '1' } } })
      mockWs.simulateMessage({ method: 'update', params: { id: '1', changes: {} } })
      mockWs.simulateMessage({ method: 'delete', params: { id: '1' } })

      expect(insertHandler).toHaveBeenCalledTimes(1)
      expect(updateHandler).toHaveBeenCalledTimes(1)
      expect(deleteHandler).toHaveBeenCalledTimes(1)
    })
  })

  describe('Auto-Reconnect', () => {
    beforeEach(() => {
      transport = new WebSocketTransport({
        url: 'ws://localhost:8080/mongo',
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
      })
    })

    it('should auto-reconnect on disconnect', async () => {
      // Initial connection
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      const reconnectHandler = vi.fn()
      transport.on('reconnecting', reconnectHandler)

      // Simulate unexpected disconnect
      mockWs.simulateClose(1006, 'Connection lost')

      // Should enter reconnecting state
      expect(transport.state).toBe('reconnecting')
      expect(reconnectHandler).toHaveBeenCalled()

      // Advance time to trigger reconnect attempt
      await vi.advanceTimersByTimeAsync(1000)

      // Should have created new WebSocket
      mockWs.simulateOpen()

      expect(transport.state).toBe('connected')
    })

    it('should use exponential backoff for reconnection', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      const connectAttempts: number[] = []
      const originalFn = (globalThis as any).WebSocket

      ;(globalThis as any).WebSocket = vi.fn((url: string) => {
        connectAttempts.push(Date.now())
        mockWs = new MockWebSocket(url)
        return mockWs
      })

      // Simulate disconnect
      mockWs.simulateClose(1006)

      // First reconnect after base interval
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateClose(1006) // Fail again

      // Second reconnect should be delayed longer (exponential backoff)
      await vi.advanceTimersByTimeAsync(2000)
      mockWs.simulateClose(1006) // Fail again

      // Third attempt
      await vi.advanceTimersByTimeAsync(4000)
      mockWs.simulateOpen()

      expect(connectAttempts.length).toBeGreaterThanOrEqual(3)

      ;(globalThis as any).WebSocket = originalFn
    })

    it('should stop reconnecting after max attempts', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      const failHandler = vi.fn()
      transport.on('reconnectFailed', failHandler)

      // Simulate disconnect
      mockWs.simulateClose(1006)

      // Exhaust all reconnect attempts
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(5000)
        if (mockWs.readyState === MockWebSocket.CONNECTING) {
          mockWs.simulateClose(1006)
        }
      }

      expect(failHandler).toHaveBeenCalled()
      expect(transport.state).toBe('disconnected')
    })

    it('should not reconnect on intentional disconnect', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      const reconnectHandler = vi.fn()
      transport.on('reconnecting', reconnectHandler)

      // Intentional disconnect
      await transport.disconnect()

      // Advance time
      await vi.advanceTimersByTimeAsync(5000)

      // Should not attempt to reconnect
      expect(reconnectHandler).not.toHaveBeenCalled()
    })

    it('should restore subscriptions after reconnect', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Create a subscription
      const subPromise = transport.send('subscribe', { collection: 'users' })
      let msg = JSON.parse(mockWs.getLastMessage()!)
      mockWs.simulateMessage({ id: msg.id, result: { subscriptionId: 'sub-1' } })
      await subPromise

      mockWs.clearMessages()

      // Simulate disconnect and reconnect
      mockWs.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      // Should have re-subscribed
      const messages = mockWs.getAllMessages()
      const resubscribe = messages.find((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'subscribe'
      })

      expect(resubscribe).toBeDefined()
    })

    it('should emit reconnect event on successful reconnection', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      const reconnectedHandler = vi.fn()
      transport.on('reconnected', reconnectedHandler)

      // Simulate disconnect
      mockWs.simulateClose(1006)

      // Reconnect
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      expect(reconnectedHandler).toHaveBeenCalled()
    })
  })

  describe('Heartbeat/Keep-Alive', () => {
    beforeEach(() => {
      transport = new WebSocketTransport({
        url: 'ws://localhost:8080/mongo',
        heartbeatInterval: 5000,
      })
    })

    it('should send heartbeats', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      mockWs.clearMessages()

      // Advance time past heartbeat interval
      await vi.advanceTimersByTimeAsync(5000)

      const messages = mockWs.getAllMessages()
      const heartbeat = messages.find((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'ping' || parsed.type === 'ping'
      })

      expect(heartbeat).toBeDefined()
    })

    it('should handle pong responses', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Advance time to trigger heartbeat
      await vi.advanceTimersByTimeAsync(5000)

      const msg = JSON.parse(mockWs.getLastMessage()!)

      // Simulate pong response
      mockWs.simulateMessage({
        id: msg.id,
        result: 'pong',
      })

      // Should remain connected
      expect(transport.state).toBe('connected')
    })

    it('should disconnect on missed heartbeats', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      const disconnectHandler = vi.fn()
      transport.on('disconnect', disconnectHandler)

      // Advance past enough time for 3 missed heartbeats
      // Timeline: 5s (send), 10s (timeout, miss 1), 15s (send), 20s (timeout, miss 2),
      //          25s (send), 30s (timeout, miss 3, disconnect!)
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(5000)
      }

      // Should have triggered disconnect due to missed heartbeats
      expect(disconnectHandler).toHaveBeenCalled()
    })

    it('should reset heartbeat timer on any message', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      mockWs.clearMessages()

      // Advance partway through heartbeat interval
      await vi.advanceTimersByTimeAsync(3000)

      // Receive a message (should reset timer)
      mockWs.simulateMessage({ method: 'push', params: {} })

      // Advance remaining time of original interval
      await vi.advanceTimersByTimeAsync(2500)

      // Should not have sent heartbeat yet (timer was reset)
      const heartbeats = mockWs.getAllMessages().filter((m) => {
        const parsed = JSON.parse(m)
        return parsed.method === 'ping'
      })

      expect(heartbeats.length).toBe(0)
    })

    it('should stop heartbeats on disconnect', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      await transport.disconnect()
      mockWs.clearMessages()

      // Advance past heartbeat interval
      await vi.advanceTimersByTimeAsync(10000)

      // Should not have sent any heartbeats
      expect(mockWs.getAllMessages().length).toBe(0)
    })
  })

  describe('Error Handling', () => {
    beforeEach(async () => {
      transport = new WebSocketTransport('ws://localhost:8080/mongo')
    })

    it('should emit error event on WebSocket error', async () => {
      const errorHandler = vi.fn()
      transport.on('error', errorHandler)

      const connectPromise = transport.connect()

      mockWs.simulateError(new Error('Network error'))
      mockWs.simulateClose(1006)

      try {
        await connectPromise
      } catch {
        // Expected
      }

      expect(errorHandler).toHaveBeenCalled()
    })

    it('should handle malformed JSON messages', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      const errorHandler = vi.fn()
      transport.on('error', errorHandler)

      // Simulate malformed message
      mockWs.simulateMessage('not valid json {{{')

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/parse|json/i),
        })
      )
    })

    it('should handle messages with unknown IDs', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      const warningHandler = vi.fn()
      transport.on('warning', warningHandler)

      // Response for unknown request
      mockWs.simulateMessage({
        id: 'unknown-id-12345',
        result: {},
      })

      expect(warningHandler).toHaveBeenCalled()
    })

    it('should handle close with error codes', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      const closeHandler = vi.fn()
      transport.on('close', closeHandler)

      mockWs.simulateClose(1008, 'Policy violation')

      expect(closeHandler).toHaveBeenCalledWith({
        code: 1008,
        reason: 'Policy violation',
      })
    })

    it('should provide error details in rejected promises', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      const sendPromise = transport.send('find', {})
      const msg = JSON.parse(mockWs.getLastMessage()!)

      mockWs.simulateMessage({
        id: msg.id,
        error: {
          code: -32001,
          message: 'Unauthorized',
          data: { reason: 'Invalid token' },
        },
      })

      await expect(sendPromise).rejects.toMatchObject({
        code: -32001,
        message: 'Unauthorized',
        data: { reason: 'Invalid token' },
      })
    })
  })

  describe('Binary Message Support', () => {
    beforeEach(async () => {
      transport = new WebSocketTransport({
        url: 'ws://localhost:8080/mongo',
        binaryType: 'arraybuffer',
      })
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise
    })

    it('should send binary messages when configured', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]).buffer
      const sendPromise = transport.sendBinary(data)

      // Mock response
      const msg = mockWs.getLastMessage()!
      expect(msg).toBe('[binary]')

      mockWs.simulateBinaryMessage(new Uint8Array([6, 7, 8]).buffer)

      await sendPromise
    })

    it('should handle binary responses', async () => {
      const binaryHandler = vi.fn()
      transport.on('binary', binaryHandler)

      const binaryData = new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer
      mockWs.simulateBinaryMessage(binaryData)

      expect(binaryHandler).toHaveBeenCalledWith(expect.any(ArrayBuffer))
    })

    it('should support BSON encoding option', async () => {
      transport = new WebSocketTransport({
        url: 'ws://localhost:8080/mongo',
        encoding: 'bson',
      })
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      expect(transport.options.encoding).toBe('bson')
    })
  })

  describe('Event Emitter Interface', () => {
    beforeEach(() => {
      transport = new WebSocketTransport('ws://localhost:8080/mongo')
    })

    it('should support on/off for event listeners', () => {
      const handler = vi.fn()

      transport.on('connect', handler)
      transport.off('connect', handler)

      const connectPromise = transport.connect()
      mockWs.simulateOpen()

      return connectPromise.then(() => {
        expect(handler).not.toHaveBeenCalled()
      })
    })

    it('should support once for single-use listeners', async () => {
      const handler = vi.fn()
      transport.once('connect', handler)

      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Disconnect and reconnect
      mockWs.simulateClose(1006)
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateOpen()

      // Handler should only have been called once
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should support removeAllListeners', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      transport.on('connect', handler1)
      transport.on('connect', handler2)
      transport.removeAllListeners('connect')

      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).not.toHaveBeenCalled()
    })
  })

  describe('Connection State', () => {
    beforeEach(() => {
      transport = new WebSocketTransport('ws://localhost:8080/mongo')
    })

    it('should track connection state accurately', async () => {
      expect(transport.state).toBe('disconnected')
      expect(transport.isConnected).toBe(false)

      const connectPromise = transport.connect()
      expect(transport.state).toBe('connecting')
      expect(transport.isConnected).toBe(false)

      mockWs.simulateOpen()
      await connectPromise

      expect(transport.state).toBe('connected')
      expect(transport.isConnected).toBe(true)

      await transport.disconnect()

      expect(transport.state).toBe('disconnected')
      expect(transport.isConnected).toBe(false)
    })

    it('should expose connection statistics', async () => {
      const connectPromise = transport.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Send some messages
      for (let i = 0; i < 5; i++) {
        const promise = transport.send('test', {})
        const msg = JSON.parse(mockWs.getLastMessage()!)
        mockWs.simulateMessage({ id: msg.id, result: null })
        await promise
      }

      const stats = transport.stats

      expect(stats.messagesSent).toBe(5)
      expect(stats.messagesReceived).toBeGreaterThanOrEqual(5)
      expect(stats.bytesReceived).toBeGreaterThan(0)
      expect(stats.bytesSent).toBeGreaterThan(0)
      expect(stats.connectionTime).toBeGreaterThanOrEqual(0)
    })
  })
})
