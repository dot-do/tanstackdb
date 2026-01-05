/**
 * @file RPC Client Tests (RED Phase - TDD)
 *
 * These tests verify the MongoDoClient class that provides RPC communication
 * with the mongo.do API endpoint. The client handles:
 * - Connection management (connect/disconnect)
 * - JSON-RPC request/response handling
 * - Database reference creation
 * - Error and timeout handling
 *
 * RED PHASE: These tests will fail until MongoDoClient is implemented in src/rpc/client.ts
 *
 * @see https://www.jsonrpc.org/specification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MongoDoClient } from '../../src/rpc/client'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock WebSocket for connection tests
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState: number = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((error: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(url: string) {
    this.url = url
  }

  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) this.onclose()
  })

  // Helper to simulate connection
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    if (this.onopen) this.onopen()
  }

  // Helper to simulate error
  simulateError(error: Event) {
    if (this.onerror) this.onerror(error)
  }

  // Helper to simulate message
  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }))
    }
  }
}

// Store original WebSocket
const originalWebSocket = globalThis.WebSocket

// Track mock WebSocket instance
let mockWs: MockWebSocket

describe('MongoDoClient', () => {
  const testEndpoint = 'https://api.mongo.do'
  const testAuth = {
    token: 'test-auth-token-123',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Replace global WebSocket with mock that tracks instance
    ;(globalThis as any).WebSocket = vi.fn((url: string) => {
      mockWs = new MockWebSocket(url)
      return mockWs
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    // Restore original WebSocket
    ;(globalThis as any).WebSocket = originalWebSocket
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should construct with endpoint and auth', () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      expect(client).toBeInstanceOf(MongoDoClient)
      expect(client.endpoint).toBe(testEndpoint)
    })

    it('should construct with endpoint only (no auth)', () => {
      const client = new MongoDoClient(testEndpoint)

      expect(client).toBeInstanceOf(MongoDoClient)
      expect(client.endpoint).toBe(testEndpoint)
    })

    it('should accept credentials-based auth', () => {
      const credentialsAuth = {
        credentials: {
          username: 'admin',
          password: 'secret',
        },
      }

      const client = new MongoDoClient(testEndpoint, credentialsAuth)

      expect(client).toBeInstanceOf(MongoDoClient)
    })

    it('should accept custom timeout configuration', () => {
      const client = new MongoDoClient(testEndpoint, testAuth, {
        timeout: 30000,
      })

      expect(client).toBeInstanceOf(MongoDoClient)
    })
  })

  describe('connect()', () => {
    it('should connect to mongo.do endpoint', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // Simulate successful WebSocket connection
      const connectPromise = client.connect()

      // Get the WebSocket instance and trigger open immediately (before timeout)
      mockWs.simulateOpen()

      await expect(connectPromise).resolves.toBeUndefined()
      expect(client.isConnected()).toBe(true)
    })

    it('should include auth token in connection', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      const connectPromise = client.connect()

      // Verify the WebSocket URL includes auth (converted to wss)
      expect(mockWs.url).toContain('wss://')
      expect(mockWs.url).toContain('token=')
      mockWs.simulateOpen()

      await connectPromise
    })

    it('should reject if already connected', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // First connection
      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Second connection attempt should reject
      await expect(client.connect()).rejects.toThrow('Already connected')
    })
  })

  describe('disconnect()', () => {
    it('should disconnect cleanly', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // Connect first
      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Now disconnect
      await client.disconnect()

      expect(mockWs.close).toHaveBeenCalled()
      expect(client.isConnected()).toBe(false)
    })

    it('should resolve immediately if not connected', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // Should not throw when not connected
      await expect(client.disconnect()).resolves.toBeUndefined()
    })

    it('should cancel pending requests on disconnect', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // Connect
      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Start an RPC request (don't await)
      const rpcPromise = client.rpc('testMethod', { arg: 'value' })

      // Disconnect while request is pending
      await client.disconnect()

      // The pending request should reject
      await expect(rpcPromise).rejects.toThrow('Not connected to server')
    })
  })

  describe('isConnected()', () => {
    it('should report connection state', () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // Initially not connected
      expect(client.isConnected()).toBe(false)
    })

    it('should return true after successful connection', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      expect(client.isConnected()).toBe(true)
    })

    it('should return false after disconnect', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // Connect
      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      expect(client.isConnected()).toBe(true)

      // Disconnect
      await client.disconnect()

      expect(client.isConnected()).toBe(false)
    })
  })

  describe('db()', () => {
    it('should return database reference', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // Connect first
      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      const db = client.db('testDatabase')

      expect(db).toBeDefined()
      expect(db.name).toBe('testDatabase')
    })

    it('should return the same reference for the same database name', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      const db1 = client.db('testDatabase')
      const db2 = client.db('testDatabase')

      expect(db1).toBe(db2)
    })

    it('should return different references for different database names', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      const db1 = client.db('database1')
      const db2 = client.db('database2')

      expect(db1).not.toBe(db2)
      expect(db1.name).toBe('database1')
      expect(db2.name).toBe('database2')
    })

    it('should throw if not connected', () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      expect(() => client.db('testDatabase')).toThrow('Not connected')
    })
  })

  describe('rpc()', () => {
    it('should send JSON-RPC requests', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // Connect
      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Make RPC call
      const rpcPromise = client.rpc('find', {
        database: 'mydb',
        collection: 'users',
        filter: { active: true },
      })

      // Verify the request was sent
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"method":"find"')
      )

      // Parse the sent message to verify JSON-RPC format
      const sentMessage = JSON.parse(mockWs.send.mock.calls[0]![0] as string)
      expect(sentMessage).toMatchObject({
        jsonrpc: '2.0',
        method: 'find',
        params: {
          database: 'mydb',
          collection: 'users',
          filter: { active: true },
        },
        id: expect.any(String),
      })

      // Simulate response
      mockWs.simulateMessage({
        jsonrpc: '2.0',
        id: sentMessage.id,
        result: [{ _id: '1', name: 'Test User', active: true }],
      })

      const result = await rpcPromise
      expect(result).toEqual([{ _id: '1', name: 'Test User', active: true }])
    })

    it('should handle RPC error responses', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // Connect
      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Make RPC call
      const rpcPromise = client.rpc('find', { database: 'nonexistent' })

      // Get the request ID
      const sentMessage = JSON.parse(mockWs.send.mock.calls[0]![0] as string)

      // Simulate error response
      mockWs.simulateMessage({
        jsonrpc: '2.0',
        id: sentMessage.id,
        error: {
          code: -32602,
          message: 'Database not found',
          data: { database: 'nonexistent' },
        },
      })

      await expect(rpcPromise).rejects.toThrow('Database not found')
    })

    it('should throw if not connected', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      await expect(client.rpc('find', {})).rejects.toThrow('Not connected')
    })

    it('should generate unique request IDs', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // Connect
      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Make multiple RPC calls
      client.rpc('method1', {})
      client.rpc('method2', {})
      client.rpc('method3', {})

      const calls = mockWs.send.mock.calls
      const ids = calls.map((call) => JSON.parse(call[0] as string).id)

      // All IDs should be unique
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(3)
    })
  })

  describe('error handling', () => {
    it('should handle connection errors', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      const connectPromise = client.connect()

      // Simulate connection error
      mockWs.simulateError(new Event('error'))

      await expect(connectPromise).rejects.toThrow()
      expect(client.isConnected()).toBe(false)
    })

    it('should handle unexpected disconnection', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // Connect
      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      expect(client.isConnected()).toBe(true)

      // Simulate unexpected close
      mockWs.close()

      expect(client.isConnected()).toBe(false)
    })

    it('should emit error events for connection issues', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)
      const errorHandler = vi.fn()

      client.on('error', errorHandler)

      const connectPromise = client.connect()
      mockWs.simulateError(new Event('error'))

      try {
        await connectPromise
      } catch {
        // Expected to throw
      }

      expect(errorHandler).toHaveBeenCalled()
    })

    it('should handle malformed JSON-RPC responses', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // Connect
      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Make RPC call
      const rpcPromise = client.rpc('test', {})

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0]![0] as string)

      // Simulate malformed response (missing jsonrpc version)
      mockWs.simulateMessage({
        id: sentMessage.id,
        result: 'data',
      })

      await expect(rpcPromise).rejects.toThrow('Invalid JSON-RPC response')
    })
  })

  describe('timeout handling', () => {
    it('should timeout on slow connections', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth, {
        connectTimeout: 5000,
      })

      const connectPromise = client.connect()
      // Immediately attach catch handler to prevent unhandled rejection
      connectPromise.catch(() => {})

      // Don't simulate open - let it timeout
      await vi.advanceTimersByTimeAsync(5001)

      await expect(connectPromise).rejects.toThrow('Connection timeout')
      expect(client.isConnected()).toBe(false)
    })

    it('should timeout on slow RPC responses', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth, {
        requestTimeout: 10000,
      })

      // Connect
      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Make RPC call
      const rpcPromise = client.rpc('slowMethod', {})
      // Immediately attach catch handler to prevent unhandled rejection
      rpcPromise.catch(() => {})

      // Don't simulate response - let it timeout
      await vi.advanceTimersByTimeAsync(10001)

      await expect(rpcPromise).rejects.toThrow('Request timeout')
    })

    it('should use default timeout if not specified', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      const connectPromise = client.connect()
      // Immediately attach catch handler to prevent unhandled rejection
      connectPromise.catch(() => {})

      // Default timeout should be 30 seconds
      await vi.advanceTimersByTimeAsync(30001)

      await expect(connectPromise).rejects.toThrow('Connection timeout')
    })

    it('should clear timeout on successful connection', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth, {
        connectTimeout: 5000,
      })

      const connectPromise = client.connect()

      // Connect before timeout
      mockWs.simulateOpen()

      await expect(connectPromise).resolves.toBeUndefined()

      // Advancing past the original timeout should not cause issues
      await vi.advanceTimersByTimeAsync(10000)

      expect(client.isConnected()).toBe(true)
    })

    it('should clear timeout on successful RPC response', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth, {
        requestTimeout: 5000,
      })

      // Connect
      const connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      // Make RPC call
      const rpcPromise = client.rpc('fastMethod', {})

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0]![0] as string)

      // Respond before timeout
      await vi.advanceTimersByTimeAsync(1000)
      mockWs.simulateMessage({
        jsonrpc: '2.0',
        id: sentMessage.id,
        result: { success: true },
      })

      await expect(rpcPromise).resolves.toEqual({ success: true })

      // Advancing past the original timeout should not cause issues
      await vi.advanceTimersByTimeAsync(10000)
    })
  })

  describe('reconnection', () => {
    it('should support manual reconnection after disconnect', async () => {
      const client = new MongoDoClient(testEndpoint, testAuth)

      // First connection
      let connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      expect(client.isConnected()).toBe(true)

      // Disconnect
      await client.disconnect()
      expect(client.isConnected()).toBe(false)

      // Reconnect - mockWs will be updated to the new instance by the WebSocket factory
      connectPromise = client.connect()
      mockWs.simulateOpen()
      await connectPromise

      expect(client.isConnected()).toBe(true)
    })
  })
})

describe('MongoDoClient Types', () => {
  it('should export proper TypeScript types', () => {
    // This test verifies the type exports work correctly
    const client: MongoDoClient = new MongoDoClient('https://api.mongo.do')

    // These should type-check correctly
    const endpoint: string = client.endpoint
    const connected: boolean = client.isConnected()

    expect(endpoint).toBe('https://api.mongo.do')
    expect(connected).toBe(false)
  })
})
