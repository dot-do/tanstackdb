/**
 * @file HTTP Transport Tests (RED Phase - TDD)
 *
 * These tests verify the HttpTransport class for JSON-RPC 2.0 communication
 * with the mongo.do API over HTTP.
 *
 * Tests cover:
 * 1. Constructor with base URL configuration
 * 2. JSON-RPC 2.0 request structure (id, jsonrpc, method, params)
 * 3. POST requests to /rpc endpoint
 * 4. Response parsing and result extraction
 * 5. JSON-RPC error handling
 * 6. Network error handling
 * 7. Authentication header injection (Bearer token)
 * 8. Content-Type header verification
 * 9. Retry logic on 5xx server errors
 *
 * RED PHASE: These tests will fail until HttpTransport is implemented
 *
 * @see https://www.jsonrpc.org/specification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HttpTransport } from '../../src/rpc/http-transport'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('HttpTransport', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should construct with base URL', () => {
      const transport = new HttpTransport('https://api.mongo.do')

      expect(transport).toBeInstanceOf(HttpTransport)
      expect(transport.baseUrl).toBe('https://api.mongo.do')
    })

    it('should strip trailing slash from base URL', () => {
      const transport = new HttpTransport('https://api.mongo.do/')

      expect(transport.baseUrl).toBe('https://api.mongo.do')
    })

    it('should accept optional auth token in constructor', () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        authToken: 'test-token-123',
      })

      expect(transport).toBeInstanceOf(HttpTransport)
    })

    it('should accept optional retry configuration', () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        retries: 5,
        retryDelay: 500,
      })

      expect(transport).toBeInstanceOf(HttpTransport)
    })
  })

  describe('send()', () => {
    it('should send JSON-RPC 2.0 requests', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: { success: true },
        }),
      })

      await transport.send('collection.find', { collection: 'users' })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0]!

      expect(url).toBe('https://api.mongo.do/rpc')
      expect((options as { method: string }).method).toBe('POST')
    })

    it('should include JSON-RPC 2.0 structure in request body', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: { documents: [] },
        }),
      })

      await transport.send('collection.find', { collection: 'users', filter: { active: true } })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse((options as { body: string }).body)

      expect(body.jsonrpc).toBe('2.0')
      expect(body.method).toBe('collection.find')
      expect(body.params).toEqual({ collection: 'users', filter: { active: true } })
      expect(typeof body.id).toBe('number')
    })

    it('should generate unique request IDs', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        }),
      })

      await transport.send('method1', {})
      await transport.send('method2', {})

      const [, options1] = mockFetch.mock.calls[0]!
      const [, options2] = mockFetch.mock.calls[1]!
      const body1 = JSON.parse((options1 as { body: string }).body)
      const body2 = JSON.parse((options2 as { body: string }).body)

      expect(body1.id).not.toBe(body2.id)
    })

    it('should set Content-Type header to application/json', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        }),
      })

      await transport.send('test.method', {})

      const [, options] = mockFetch.mock.calls[0]!
      expect((options as { headers: Record<string, string> }).headers['Content-Type']).toBe('application/json')
    })
  })

  describe('response parsing', () => {
    it('should parse successful responses and extract result', async () => {
      const transport = new HttpTransport('https://api.mongo.do')
      const expectedResult = {
        documents: [
          { _id: '1', name: 'Alice' },
          { _id: '2', name: 'Bob' },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: expectedResult,
        }),
      })

      const result = await transport.send('collection.find', { collection: 'users' })

      expect(result).toEqual(expectedResult)
    })

    it('should handle null result', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: null,
        }),
      })

      const result = await transport.send('collection.delete', { collection: 'users', id: '123' })

      expect(result).toBeNull()
    })
  })

  describe('JSON-RPC error handling', () => {
    it('should handle JSON-RPC errors', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32600,
            message: 'Invalid Request',
          },
        }),
      })

      await expect(transport.send('invalid.method', {})).rejects.toThrow('Invalid Request')
    })

    it('should include error code in thrown error', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32601,
            message: 'Method not found',
          },
        }),
      })

      try {
        await transport.send('unknown.method', {})
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error & { code?: number }).code).toBe(-32601)
      }
    })

    it('should include error data if present', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32602,
            message: 'Invalid params',
            data: { field: 'filter', reason: 'must be an object' },
          },
        }),
      })

      try {
        await transport.send('collection.find', { filter: 'invalid' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error & { data?: unknown }).data).toEqual({
          field: 'filter',
          reason: 'must be an object',
        })
      }
    })

    it('should handle parse error (-32700)', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
          },
        }),
      })

      await expect(transport.send('test', {})).rejects.toThrow('Parse error')
    })

    it('should handle internal error (-32603)', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32603,
            message: 'Internal error',
          },
        }),
      })

      await expect(transport.send('test', {})).rejects.toThrow('Internal error')
    })
  })

  describe('network error handling', () => {
    it('should handle network errors', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      await expect(transport.send('test.method', {})).rejects.toThrow('Failed to fetch')
    })

    it('should handle timeout errors', async () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        timeout: 5000,
      })

      mockFetch.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'))

      await expect(transport.send('test.method', {})).rejects.toThrow()
    })

    it('should handle non-JSON responses', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token')
        },
      })

      await expect(transport.send('test.method', {})).rejects.toThrow()
    })

    it('should handle HTTP 4xx errors', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      await expect(transport.send('test.method', {})).rejects.toThrow()
    })
  })

  describe('authentication', () => {
    it('should include auth header when token is provided', async () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        authToken: 'my-secret-token',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        }),
      })

      await transport.send('test.method', {})

      const [, options] = mockFetch.mock.calls[0]!
      expect((options as { headers: Record<string, string> }).headers['Authorization']).toBe('Bearer my-secret-token')
    })

    it('should not include auth header when no token is provided', async () => {
      const transport = new HttpTransport('https://api.mongo.do')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        }),
      })

      await transport.send('test.method', {})

      const [, options] = mockFetch.mock.calls[0]!
      expect((options as { headers: Record<string, string | undefined> }).headers['Authorization']).toBeUndefined()
    })

    it('should allow setting auth token after construction', async () => {
      const transport = new HttpTransport('https://api.mongo.do')
      transport.setAuthToken('dynamic-token')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        }),
      })

      await transport.send('test.method', {})

      const [, options] = mockFetch.mock.calls[0]!
      expect((options as { headers: Record<string, string> }).headers['Authorization']).toBe('Bearer dynamic-token')
    })

    it('should allow clearing auth token', async () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        authToken: 'initial-token',
      })
      transport.setAuthToken(undefined)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        }),
      })

      await transport.send('test.method', {})

      const [, options] = mockFetch.mock.calls[0]!
      expect((options as { headers: Record<string, string | undefined> }).headers['Authorization']).toBeUndefined()
    })
  })

  describe('retry logic', () => {
    it('should retry on 5xx errors', async () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        retries: 3,
        retryDelay: 10, // Small delay for tests
      })

      // First two calls fail with 500, third succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: { success: true },
          }),
        })

      const result = await transport.send('test.method', {})

      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(result).toEqual({ success: true })
    })

    it('should not retry on 4xx errors', async () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        retries: 3,
        retryDelay: 10,
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      })

      await expect(transport.send('test.method', {})).rejects.toThrow()
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should exhaust retries and throw on persistent 5xx', async () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        retries: 2,
        retryDelay: 10,
      })

      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      })

      await expect(transport.send('test.method', {})).rejects.toThrow()
      expect(mockFetch).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })

    it('should use exponential backoff for retries', async () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        retries: 3,
        retryDelay: 100,
        exponentialBackoff: true,
      })

      const startTime = Date.now()

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
        })

      await transport.send('test.method', {})

      const elapsed = Date.now() - startTime
      // With exponential backoff: 100ms + 200ms = 300ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(200) // Allow some tolerance
    })

    it('should respect max retries configuration', async () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        retries: 0, // No retries
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(transport.send('test.method', {})).rejects.toThrow()
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should retry on network errors', async () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        retries: 2,
        retryDelay: 10,
      })

      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
        })

      await transport.send('test.method', {})

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('additional headers', () => {
    it('should allow custom headers', async () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Request-ID': '12345',
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
      })

      await transport.send('test.method', {})

      const [, options] = mockFetch.mock.calls[0]!
      expect((options as { headers: Record<string, string> }).headers['X-Custom-Header']).toBe('custom-value')
      expect((options as { headers: Record<string, string> }).headers['X-Request-ID']).toBe('12345')
    })

    it('should not allow overriding Content-Type', async () => {
      const transport = new HttpTransport('https://api.mongo.do', {
        headers: {
          'Content-Type': 'text/plain',
        },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
      })

      await transport.send('test.method', {})

      const [, options] = mockFetch.mock.calls[0]!
      expect((options as { headers: Record<string, string> }).headers['Content-Type']).toBe('application/json')
    })
  })
})
