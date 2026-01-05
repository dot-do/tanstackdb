/**
 * Batch RPC Executor Tests (TDD RED Phase)
 *
 * These tests verify the BatchExecutor class which:
 * 1. Collects multiple RPC calls within a time window
 * 2. Sends them as JSON-RPC batch arrays
 * 3. Correlates batch responses to original requests
 * 4. Supports configurable batch size limits
 * 5. Supports configurable batch time windows
 * 6. Handles partial failures in batch responses
 *
 * RED PHASE: These tests will fail until BatchExecutor is implemented
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BatchExecutor } from '../../src/rpc/batch'
import type { JsonRpcRequest, JsonRpcResponse, BatchExecutorConfig } from '../../src/rpc/types'

describe('BatchExecutor', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let executor: BatchExecutor

  beforeEach(() => {
    vi.useFakeTimers()
    mockFetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('collecting calls within time window', () => {
    it('should collect calls within time window', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 10,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      // Mock successful batch response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { jsonrpc: '2.0', result: { data: 'result1' }, id: 1 },
            { jsonrpc: '2.0', result: { data: 'result2' }, id: 2 },
            { jsonrpc: '2.0', result: { data: 'result3' }, id: 3 },
          ]),
      })

      // Queue multiple calls within the time window
      const promise1 = executor.call('method1', { param: 'a' })
      const promise2 = executor.call('method2', { param: 'b' })
      const promise3 = executor.call('method3', { param: 'c' })

      // Advance time to trigger batch
      await vi.advanceTimersByTimeAsync(50)

      // All calls should resolve
      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3])

      expect(result1).toEqual({ data: 'result1' })
      expect(result2).toEqual({ data: 'result2' })
      expect(result3).toEqual({ data: 'result3' })

      // Should have made exactly one fetch call with all three requests
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('JSON-RPC batch format', () => {
    it('should send as JSON-RPC batch', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 10,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { jsonrpc: '2.0', result: 'ok', id: 1 },
            { jsonrpc: '2.0', result: 'ok', id: 2 },
          ]),
      })

      const promise1 = executor.call('users.find', { query: {} })
      const promise2 = executor.call('users.count', { query: {} })

      await vi.advanceTimersByTimeAsync(50)
      await Promise.all([promise1, promise2])

      // Verify the fetch was called with proper JSON-RPC batch format
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.mongo.do/rpc',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )

      // Parse the body to verify batch array format
      const callArgs = mockFetch.mock.calls[0]!
      const body = JSON.parse((callArgs[1] as { body: string }).body)

      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(2)

      // Verify JSON-RPC 2.0 format for each request
      expect(body[0]).toMatchObject({
        jsonrpc: '2.0',
        method: 'users.find',
        params: { query: {} },
        id: expect.any(Number),
      })
      expect(body[1]).toMatchObject({
        jsonrpc: '2.0',
        method: 'users.count',
        params: { query: {} },
        id: expect.any(Number),
      })
    })
  })

  describe('response correlation', () => {
    it('should correlate responses to requests', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 10,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      // Responses returned in different order than requests
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { jsonrpc: '2.0', result: 'third', id: 3 },
            { jsonrpc: '2.0', result: 'first', id: 1 },
            { jsonrpc: '2.0', result: 'second', id: 2 },
          ]),
      })

      const promise1 = executor.call('method1', {})
      const promise2 = executor.call('method2', {})
      const promise3 = executor.call('method3', {})

      await vi.advanceTimersByTimeAsync(50)

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3])

      // Results should be correlated correctly despite out-of-order response
      expect(result1).toBe('first')
      expect(result2).toBe('second')
      expect(result3).toBe('third')
    })
  })

  describe('batch size limit', () => {
    it('should flush on size limit', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 1000, // Long time window
        maxBatchSize: 3, // Small batch size
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      // Set up responses for two batches
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { jsonrpc: '2.0', result: 'r1', id: 1 },
              { jsonrpc: '2.0', result: 'r2', id: 2 },
              { jsonrpc: '2.0', result: 'r3', id: 3 },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { jsonrpc: '2.0', result: 'r4', id: 4 },
              { jsonrpc: '2.0', result: 'r5', id: 5 },
            ]),
        })

      // Queue 5 calls - should trigger flush at 3
      const promises = [
        executor.call('m1', {}),
        executor.call('m2', {}),
        executor.call('m3', {}), // This should trigger first batch
        executor.call('m4', {}),
        executor.call('m5', {}),
      ]

      // Wait for first batch to be sent (triggered by size limit)
      await vi.advanceTimersByTimeAsync(0)

      // First batch should already be sent
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Verify first batch has exactly 3 items
      const firstBatchBody = JSON.parse((mockFetch.mock.calls[0]![1] as { body: string }).body)
      expect(firstBatchBody).toHaveLength(3)

      // Advance time to trigger second batch
      await vi.advanceTimersByTimeAsync(1000)

      expect(mockFetch).toHaveBeenCalledTimes(2)

      // Verify second batch has remaining 2 items
      const secondBatchBody = JSON.parse((mockFetch.mock.calls[1]![1] as { body: string }).body)
      expect(secondBatchBody).toHaveLength(2)

      // All promises should resolve correctly
      const results = await Promise.all(promises)
      expect(results).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
    })
  })

  describe('time window', () => {
    it('should flush on time window', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 100,
        maxBatchSize: 100, // High limit so time window triggers first
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { jsonrpc: '2.0', result: 'r1', id: 1 },
            { jsonrpc: '2.0', result: 'r2', id: 2 },
          ]),
      })

      const promise1 = executor.call('m1', {})
      const promise2 = executor.call('m2', {})

      // Before time window expires
      await vi.advanceTimersByTimeAsync(50)
      expect(mockFetch).not.toHaveBeenCalled()

      // After time window expires
      await vi.advanceTimersByTimeAsync(50)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [result1, result2] = await Promise.all([promise1, promise2])
      expect(result1).toBe('r1')
      expect(result2).toBe('r2')
    })
  })

  describe('manual flush', () => {
    it('should support manual flush', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 10000, // Very long window
        maxBatchSize: 100,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { jsonrpc: '2.0', result: 'immediate1', id: 1 },
            { jsonrpc: '2.0', result: 'immediate2', id: 2 },
          ]),
      })

      const promise1 = executor.call('m1', {})
      const promise2 = executor.call('m2', {})

      // Manually flush without waiting for time window
      await executor.flush()

      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [result1, result2] = await Promise.all([promise1, promise2])
      expect(result1).toBe('immediate1')
      expect(result2).toBe('immediate2')
    })

    it('should return empty array when flushing with no pending requests', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 10,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      // Flush with nothing pending
      await executor.flush()

      // Should not make any fetch calls
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('partial batch failures', () => {
    it('should handle partial batch failures', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 10,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      // Response with mixed success and error
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { jsonrpc: '2.0', result: 'success1', id: 1 },
            {
              jsonrpc: '2.0',
              error: { code: -32602, message: 'Invalid params', data: { field: 'query' } },
              id: 2,
            },
            { jsonrpc: '2.0', result: 'success3', id: 3 },
          ]),
      })

      const promise1 = executor.call('m1', {})
      const promise2 = executor.call('m2', { invalid: true })
      const promise3 = executor.call('m3', {})

      await vi.advanceTimersByTimeAsync(50)

      // First and third should succeed
      const result1 = await promise1
      expect(result1).toBe('success1')

      const result3 = await promise3
      expect(result3).toBe('success3')

      // Second should reject with the JSON-RPC error
      await expect(promise2).rejects.toMatchObject({
        code: -32602,
        message: 'Invalid params',
        data: { field: 'query' },
      })
    })

    it('should handle network errors for entire batch', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 10,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      // Network failure
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const promise1 = executor.call('m1', {})
      const promise2 = executor.call('m2', {})

      await vi.advanceTimersByTimeAsync(50)

      // All promises should reject with the network error
      await expect(promise1).rejects.toThrow('Network error')
      await expect(promise2).rejects.toThrow('Network error')
    })

    it('should handle HTTP error responses', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 10,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      // HTTP 500 error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      const promise1 = executor.call('m1', {})
      const promise2 = executor.call('m2', {})

      await vi.advanceTimersByTimeAsync(50)

      await expect(promise1).rejects.toThrow(/500|Internal Server Error/)
      await expect(promise2).rejects.toThrow(/500|Internal Server Error/)
    })

    it('should handle missing response for a request in batch', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 10,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      // Response missing id: 2
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { jsonrpc: '2.0', result: 'success1', id: 1 },
            // Missing response for id: 2
            { jsonrpc: '2.0', result: 'success3', id: 3 },
          ]),
      })

      const promise1 = executor.call('m1', {})
      const promise2 = executor.call('m2', {})
      const promise3 = executor.call('m3', {})

      await vi.advanceTimersByTimeAsync(50)

      const result1 = await promise1
      expect(result1).toBe('success1')

      const result3 = await promise3
      expect(result3).toBe('success3')

      // Should reject with an error about missing response
      await expect(promise2).rejects.toThrow(/missing|not found|no response/i)
    })
  })

  describe('configuration validation', () => {
    it('should require valid endpoint', () => {
      expect(
        () =>
          new BatchExecutor({
            endpoint: '',
            batchTimeMs: 50,
            maxBatchSize: 10,
            fetch: mockFetch,
          })
      ).toThrow(/endpoint/i)
    })

    it('should require positive batchTimeMs', () => {
      expect(
        () =>
          new BatchExecutor({
            endpoint: 'https://api.mongo.do/rpc',
            batchTimeMs: 0,
            maxBatchSize: 10,
            fetch: mockFetch,
          })
      ).toThrow(/batchTimeMs/i)
    })

    it('should require positive maxBatchSize', () => {
      expect(
        () =>
          new BatchExecutor({
            endpoint: 'https://api.mongo.do/rpc',
            batchTimeMs: 50,
            maxBatchSize: 0,
            fetch: mockFetch,
          })
      ).toThrow(/maxBatchSize/i)
    })
  })

  describe('request ID management', () => {
    it('should generate unique IDs for each request', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 10,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            { jsonrpc: '2.0', result: 'r1', id: 1 },
            { jsonrpc: '2.0', result: 'r2', id: 2 },
            { jsonrpc: '2.0', result: 'r3', id: 3 },
          ]),
      })

      executor.call('m1', {})
      executor.call('m2', {})
      executor.call('m3', {})

      await vi.advanceTimersByTimeAsync(50)

      const body = JSON.parse((mockFetch.mock.calls[0]![1] as { body: string }).body)
      const ids = body.map((req: JsonRpcRequest) => req.id)

      // All IDs should be unique
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(3)
    })
  })

  describe('authentication headers', () => {
    it('should include auth token in headers when provided', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 10,
        fetch: mockFetch,
        authToken: 'my-secret-token',
      }

      executor = new BatchExecutor(config)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ jsonrpc: '2.0', result: 'ok', id: 1 }]),
      })

      executor.call('m1', {})
      await vi.advanceTimersByTimeAsync(50)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.mongo.do/rpc',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-secret-token',
          }),
        })
      )
    })

    it('should include custom headers when provided', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 10,
        fetch: mockFetch,
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Request-ID': 'req-123',
        },
      }

      executor = new BatchExecutor(config)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ jsonrpc: '2.0', result: 'ok', id: 1 }]),
      })

      executor.call('m1', {})
      await vi.advanceTimersByTimeAsync(50)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.mongo.do/rpc',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'custom-value',
            'X-Request-ID': 'req-123',
          }),
        })
      )
    })
  })

  describe('concurrent batch handling', () => {
    it('should handle multiple concurrent batches correctly', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 2,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      // Set up responses for multiple batches
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { jsonrpc: '2.0', result: 'batch1-r1', id: 1 },
              { jsonrpc: '2.0', result: 'batch1-r2', id: 2 },
            ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { jsonrpc: '2.0', result: 'batch2-r1', id: 3 },
              { jsonrpc: '2.0', result: 'batch2-r2', id: 4 },
            ]),
        })

      // First batch (triggers immediately due to size limit)
      const promise1 = executor.call('m1', {})
      const promise2 = executor.call('m2', {})

      // Second batch
      const promise3 = executor.call('m3', {})
      const promise4 = executor.call('m4', {})

      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(50)

      const [r1, r2, r3, r4] = await Promise.all([promise1, promise2, promise3, promise4])

      expect(r1).toBe('batch1-r1')
      expect(r2).toBe('batch1-r2')
      expect(r3).toBe('batch2-r1')
      expect(r4).toBe('batch2-r2')
    })
  })

  describe('cleanup and disposal', () => {
    it('should cancel pending timers on dispose', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 1000,
        maxBatchSize: 10,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)

      const promise = executor.call('m1', {})

      // Dispose before timer fires
      executor.dispose()

      // Advance time past the batch window
      await vi.advanceTimersByTimeAsync(1000)

      // Fetch should not have been called
      expect(mockFetch).not.toHaveBeenCalled()

      // Promise should reject due to disposal
      await expect(promise).rejects.toThrow(/disposed|cancelled|aborted/i)
    })

    it('should reject new calls after disposal', async () => {
      const config: BatchExecutorConfig = {
        endpoint: 'https://api.mongo.do/rpc',
        batchTimeMs: 50,
        maxBatchSize: 10,
        fetch: mockFetch,
      }

      executor = new BatchExecutor(config)
      executor.dispose()

      await expect(executor.call('m1', {})).rejects.toThrow(/disposed|closed/i)
    })
  })
})
