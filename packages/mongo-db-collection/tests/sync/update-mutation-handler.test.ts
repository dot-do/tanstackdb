/**
 * @file Update Mutation Handler Tests (RED Phase - TDD)
 *
 * These tests verify the update mutation handler functionality that processes
 * client-side update mutations and sends them to MongoDB via the mongo.do API.
 *
 * The update mutation handler is responsible for:
 * 1. Accepting update mutations from TanStack DB collections
 * 2. Transforming updates to MongoDB update operations
 * 3. Sending updates to the mongo.do API
 * 4. Handling optimistic updates and rollbacks
 * 5. Supporting partial updates with $set/$unset operators
 * 6. Managing update conflicts and retries
 * 7. Batching multiple updates for efficiency
 *
 * RED PHASE: These tests will fail until the update mutation handler is implemented
 *
 * @module tests/sync/update-mutation-handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

// =============================================================================
// Test Setup - Import Types
// =============================================================================

import {
  createUpdateMutationHandler,
  type UpdateMutationHandlerConfig,
  type UpdateMutation,
  type UpdateResult,
  type UpdateMutationHandler,
} from '../../src/sync/handlers/update-mutation'

// Test document schema
const testDocumentSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number(),
  status: z.enum(['active', 'inactive', 'pending']),
  settings: z.object({
    theme: z.string(),
    notifications: z.boolean(),
    language: z.string().optional(),
  }),
  tags: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
  updatedAt: z.date().optional(),
})

type TestDocument = z.infer<typeof testDocumentSchema>

// Mock RPC client
const createMockRpcClient = () => ({
  rpc: vi.fn(),
  isConnected: vi.fn(() => true),
})


// =============================================================================
// Test Suite
// =============================================================================

describe('UpdateMutationHandler', () => {
  let mockRpcClient: ReturnType<typeof createMockRpcClient>

  const defaultConfig: UpdateMutationHandlerConfig<TestDocument> = {
    endpoint: 'https://api.mongo.do',
    database: 'testdb',
    collectionName: 'users',
    authToken: 'test-token',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockRpcClient = createMockRpcClient()
    mockRpcClient.rpc.mockResolvedValue({ acknowledged: true, modifiedCount: 1 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('handler creation', () => {
    it('should create an update mutation handler', () => {
      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      expect(handler).toBeDefined()
      expect(handler.update).toBeInstanceOf(Function)
      expect(handler.updateMany).toBeInstanceOf(Function)
    })

    it('should require endpoint configuration', () => {
      const invalidConfig = { ...defaultConfig, endpoint: undefined } as any

      expect(() => createUpdateMutationHandler(invalidConfig)).toThrow(/endpoint/i)
    })

    it('should require database configuration', () => {
      const invalidConfig = { ...defaultConfig, database: undefined } as any

      expect(() => createUpdateMutationHandler(invalidConfig)).toThrow(/database/i)
    })

    it('should require collectionName configuration', () => {
      const invalidConfig = { ...defaultConfig, collectionName: undefined } as any

      expect(() => createUpdateMutationHandler(invalidConfig)).toThrow(/collection/i)
    })
  })

  describe('single update operations', () => {
    it('should send update mutation to RPC', async () => {
      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: {
          _id: 'user-123',
          name: 'John Doe',
          email: 'john@example.com',
          age: 30,
          status: 'active',
          settings: { theme: 'light', notifications: true },
          tags: ['developer'],
        },
        newValue: {
          _id: 'user-123',
          name: 'John Updated',
          email: 'john@example.com',
          age: 31,
          status: 'active',
          settings: { theme: 'dark', notifications: true },
          tags: ['developer', 'admin'],
        },
        updatedFields: {
          name: 'John Updated',
          age: 31,
          settings: { theme: 'dark', notifications: true },
          tags: ['developer', 'admin'],
        },
        removedFields: [],
        timestamp: Date.now(),
      }

      await handler.update(mutation)

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'updateOne',
        expect.objectContaining({
          database: 'testdb',
          collection: 'users',
          filter: { _id: 'user-123' },
        })
      )
    })

    it('should return update result with success status', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce({ acknowledged: true, modifiedCount: 1 })

      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Updated' },
        updatedFields: { name: 'Updated' },
        removedFields: [],
        timestamp: Date.now(),
      }

      const result = await handler.update(mutation)

      expect(result.success).toBe(true)
      expect(result.key).toBe('user-123')
      expect(result.acknowledged).toBe(true)
      expect(result.modifiedCount).toBe(1)
    })

    it('should return failure result on RPC error', async () => {
      mockRpcClient.rpc.mockRejectedValueOnce(new Error('Network error'))

      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Updated' },
        updatedFields: { name: 'Updated' },
        removedFields: [],
        timestamp: Date.now(),
      }

      const result = await handler.update(mutation)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Network error')
    })

    it('should use $set for updated fields', async () => {
      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Updated Name', age: 35 },
        updatedFields: { name: 'Updated Name', age: 35 },
        removedFields: [],
        timestamp: Date.now(),
      }

      await handler.update(mutation)

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'updateOne',
        expect.objectContaining({
          update: expect.objectContaining({
            $set: { name: 'Updated Name', age: 35 },
          }),
        })
      )
    })

    it('should use $unset for removed fields', async () => {
      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), metadata: undefined },
        updatedFields: {},
        removedFields: ['metadata', 'settings.language'],
        timestamp: Date.now(),
      }

      await handler.update(mutation)

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'updateOne',
        expect.objectContaining({
          update: expect.objectContaining({
            $unset: { metadata: '', 'settings.language': '' },
          }),
        })
      )
    })

    it('should handle both $set and $unset in same update', async () => {
      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'New Name' },
        updatedFields: { name: 'New Name' },
        removedFields: ['metadata'],
        timestamp: Date.now(),
      }

      await handler.update(mutation)

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'updateOne',
        expect.objectContaining({
          update: expect.objectContaining({
            $set: { name: 'New Name' },
            $unset: { metadata: '' },
          }),
        })
      )
    })
  })

  describe('nested field updates', () => {
    it('should handle nested field updates with dot notation', async () => {
      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: {
          ...createTestDocument('user-123'),
          settings: { theme: 'dark', notifications: false },
        },
        updatedFields: { 'settings.theme': 'dark', 'settings.notifications': false } as any,
        removedFields: [],
        timestamp: Date.now(),
      }

      await handler.update(mutation)

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'updateOne',
        expect.objectContaining({
          update: expect.objectContaining({
            $set: {
              'settings.theme': 'dark',
              'settings.notifications': false,
            },
          }),
        })
      )
    })

    it('should handle deep nested field updates', async () => {
      interface DeepDoc {
        _id: string
        level1: {
          level2: {
            level3: {
              value: string
            }
          }
        }
      }

      const handler = createUpdateMutationHandler<DeepDoc>(
        { ...defaultConfig } as UpdateMutationHandlerConfig<DeepDoc>,
        mockRpcClient
      )

      const mutation: UpdateMutation<DeepDoc> = {
        key: 'doc-123',
        previousValue: {
          _id: 'doc-123',
          level1: { level2: { level3: { value: 'old' } } },
        },
        newValue: {
          _id: 'doc-123',
          level1: { level2: { level3: { value: 'new' } } },
        },
        updatedFields: { 'level1.level2.level3.value': 'new' } as any,
        removedFields: [],
        timestamp: Date.now(),
      }

      await handler.update(mutation)

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'updateOne',
        expect.objectContaining({
          update: expect.objectContaining({
            $set: {
              'level1.level2.level3.value': 'new',
            },
          }),
        })
      )
    })
  })

  describe('array field updates', () => {
    it('should handle array replacement', async () => {
      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: {
          ...createTestDocument('user-123'),
          tags: ['new-tag-1', 'new-tag-2'],
        },
        updatedFields: { tags: ['new-tag-1', 'new-tag-2'] },
        removedFields: [],
        timestamp: Date.now(),
      }

      await handler.update(mutation)

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'updateOne',
        expect.objectContaining({
          update: expect.objectContaining({
            $set: {
              tags: ['new-tag-1', 'new-tag-2'],
            },
          }),
        })
      )
    })

    it('should support array operators like $push', async () => {
      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      // Extended mutation type for array operations
      const mutation = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: {
          ...createTestDocument('user-123'),
          tags: ['developer', 'new-tag'],
        },
        updatedFields: {},
        removedFields: [],
        timestamp: Date.now(),
        arrayOperations: {
          tags: { $push: 'new-tag' },
        },
      }

      await handler.update(mutation as any)

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'updateOne',
        expect.objectContaining({
          update: expect.objectContaining({
            $push: { tags: 'new-tag' },
          }),
        })
      )
    })

    it('should support $addToSet for unique array additions', async () => {
      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: createTestDocument('user-123'),
        updatedFields: {},
        removedFields: [],
        timestamp: Date.now(),
        arrayOperations: {
          tags: { $addToSet: 'unique-tag' },
        },
      }

      await handler.update(mutation as any)

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'updateOne',
        expect.objectContaining({
          update: expect.objectContaining({
            $addToSet: { tags: 'unique-tag' },
          }),
        })
      )
    })

    it('should support $pull for array removal', async () => {
      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: {
          ...createTestDocument('user-123'),
          tags: [],
        },
        updatedFields: {},
        removedFields: [],
        timestamp: Date.now(),
        arrayOperations: {
          tags: { $pull: 'developer' },
        },
      }

      await handler.update(mutation as any)

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'updateOne',
        expect.objectContaining({
          update: expect.objectContaining({
            $pull: { tags: 'developer' },
          }),
        })
      )
    })
  })

  describe('batch update operations', () => {
    it('should batch multiple updates together', async () => {
      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          batchSize: 10,
          batchTimeoutMs: 100,
        },
        mockRpcClient
      )

      const mutations: UpdateMutation<TestDocument>[] = [
        {
          key: 'user-1',
          previousValue: createTestDocument('user-1'),
          newValue: { ...createTestDocument('user-1'), name: 'User 1 Updated' },
          updatedFields: { name: 'User 1 Updated' },
          removedFields: [],
          timestamp: Date.now(),
        },
        {
          key: 'user-2',
          previousValue: createTestDocument('user-2'),
          newValue: { ...createTestDocument('user-2'), name: 'User 2 Updated' },
          updatedFields: { name: 'User 2 Updated' },
          removedFields: [],
          timestamp: Date.now(),
        },
      ]

      const results = await handler.updateMany(mutations)

      expect(results).toHaveLength(2)
      expect(results[0]?.key).toBe('user-1')
      expect(results[1]?.key).toBe('user-2')
    })

    it('should use bulkWrite for multiple updates', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce({
        acknowledged: true,
        modifiedCount: 2,
        matchedCount: 2,
      })

      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutations: UpdateMutation<TestDocument>[] = [
        {
          key: 'user-1',
          previousValue: createTestDocument('user-1'),
          newValue: { ...createTestDocument('user-1'), name: 'Updated 1' },
          updatedFields: { name: 'Updated 1' },
          removedFields: [],
          timestamp: Date.now(),
        },
        {
          key: 'user-2',
          previousValue: createTestDocument('user-2'),
          newValue: { ...createTestDocument('user-2'), name: 'Updated 2' },
          updatedFields: { name: 'Updated 2' },
          removedFields: [],
          timestamp: Date.now(),
        },
      ]

      await handler.updateMany(mutations)

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'bulkWrite',
        expect.objectContaining({
          database: 'testdb',
          collection: 'users',
          operations: expect.arrayContaining([
            expect.objectContaining({
              updateOne: expect.objectContaining({
                filter: { _id: 'user-1' },
              }),
            }),
            expect.objectContaining({
              updateOne: expect.objectContaining({
                filter: { _id: 'user-2' },
              }),
            }),
          ]),
        })
      )
    })

    it('should auto-flush batch after timeout', async () => {
      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          batchSize: 10,
          batchTimeoutMs: 50,
        },
        mockRpcClient
      )

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-1',
        previousValue: createTestDocument('user-1'),
        newValue: { ...createTestDocument('user-1'), name: 'Updated' },
        updatedFields: { name: 'Updated' },
        removedFields: [],
        timestamp: Date.now(),
      }

      // Add to batch but don't wait for result
      handler.update(mutation)

      expect(mockRpcClient.rpc).not.toHaveBeenCalled()

      // Advance timer past batch timeout
      await vi.advanceTimersByTimeAsync(60)

      expect(mockRpcClient.rpc).toHaveBeenCalled()
    })

    it('should flush immediately when batch size reached', async () => {
      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          batchSize: 2,
          batchTimeoutMs: 10000,
        },
        mockRpcClient
      )

      const mutations = [
        {
          key: 'user-1',
          previousValue: createTestDocument('user-1'),
          newValue: { ...createTestDocument('user-1'), name: 'U1' },
          updatedFields: { name: 'U1' },
          removedFields: [],
          timestamp: Date.now(),
        },
        {
          key: 'user-2',
          previousValue: createTestDocument('user-2'),
          newValue: { ...createTestDocument('user-2'), name: 'U2' },
          updatedFields: { name: 'U2' },
          removedFields: [],
          timestamp: Date.now(),
        },
      ]

      // Add both mutations - should trigger immediate flush
      await Promise.all(mutations.map((m) => handler.update(m)))

      expect(mockRpcClient.rpc).toHaveBeenCalled()
    })
  })

  describe('optimistic updates', () => {
    it('should call onOptimisticUpdate callback immediately', async () => {
      const onOptimisticUpdate = vi.fn()

      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          onOptimisticUpdate,
        },
        mockRpcClient
      )

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Optimistic' },
        updatedFields: { name: 'Optimistic' },
        removedFields: [],
        timestamp: Date.now(),
      }

      handler.update(mutation)

      expect(onOptimisticUpdate).toHaveBeenCalledWith(mutation)
      // Verify optimistic update was called before RPC
      const optimisticOrder = onOptimisticUpdate.mock.invocationCallOrder[0]
      const rpcOrder = mockRpcClient.rpc.mock.invocationCallOrder[0]
      expect(optimisticOrder).toBeLessThan(rpcOrder ?? Infinity)
    })

    it('should call onUpdateConfirmed on success', async () => {
      const onUpdateConfirmed = vi.fn()

      mockRpcClient.rpc.mockResolvedValueOnce({ acknowledged: true, modifiedCount: 1 })

      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          onUpdateConfirmed,
        },
        mockRpcClient
      )

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Updated' },
        updatedFields: { name: 'Updated' },
        removedFields: [],
        timestamp: Date.now(),
      }

      await handler.update(mutation)

      expect(onUpdateConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          key: 'user-123',
        })
      )
    })

    it('should call onUpdateFailed on error', async () => {
      const onUpdateFailed = vi.fn()
      const error = new Error('Update failed')

      mockRpcClient.rpc.mockRejectedValueOnce(error)

      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          onUpdateFailed,
        },
        mockRpcClient
      )

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Failed' },
        updatedFields: { name: 'Failed' },
        removedFields: [],
        timestamp: Date.now(),
      }

      await handler.update(mutation)

      expect(onUpdateFailed).toHaveBeenCalledWith(mutation, error)
    })
  })

  describe('conflict handling', () => {
    it('should detect version conflicts', async () => {
      mockRpcClient.rpc.mockResolvedValueOnce({ acknowledged: true, modifiedCount: 0 })

      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Conflict' },
        updatedFields: { name: 'Conflict' },
        removedFields: [],
        timestamp: Date.now(),
      }

      const result = await handler.update(mutation)

      expect(result.modifiedCount).toBe(0)
      // Should indicate potential conflict
    })

    it('should call onConflict callback when conflict detected', async () => {
      const serverValue: TestDocument = {
        ...createTestDocument('user-123'),
        name: 'Server Version',
        age: 99,
      }

      const onConflict = vi.fn().mockReturnValue(serverValue)

      mockRpcClient.rpc
        .mockResolvedValueOnce({ acknowledged: true, modifiedCount: 0 })
        .mockResolvedValueOnce(serverValue) // Get current server value
        .mockResolvedValueOnce({ acknowledged: true, modifiedCount: 1 }) // Retry update

      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          onConflict,
        },
        mockRpcClient
      )

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Client Version' },
        updatedFields: { name: 'Client Version' },
        removedFields: [],
        timestamp: Date.now(),
      }

      await handler.update(mutation)

      expect(onConflict).toHaveBeenCalledWith(mutation, serverValue)
    })

    it('should abort update if onConflict returns null', async () => {
      const onConflict = vi.fn().mockReturnValue(null)

      mockRpcClient.rpc
        .mockResolvedValueOnce({ acknowledged: true, modifiedCount: 0 })
        .mockResolvedValueOnce(createTestDocument('user-123'))

      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          onConflict,
        },
        mockRpcClient
      )

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Aborted' },
        updatedFields: { name: 'Aborted' },
        removedFields: [],
        timestamp: Date.now(),
      }

      const result = await handler.update(mutation)

      expect(result.success).toBe(false)
      // Should not retry after null return
      expect(mockRpcClient.rpc).toHaveBeenCalledTimes(2) // Initial + get server value
    })
  })

  describe('retry logic', () => {
    it('should retry on transient errors', async () => {
      mockRpcClient.rpc
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({ acknowledged: true, modifiedCount: 1 })

      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          retryConfig: {
            maxRetries: 3,
            retryDelayMs: 100,
            backoffMultiplier: 2,
          },
        },
        mockRpcClient
      )

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Retry Success' },
        updatedFields: { name: 'Retry Success' },
        removedFields: [],
        timestamp: Date.now(),
      }

      const resultPromise = handler.update(mutation)

      // Advance timers for retries
      await vi.advanceTimersByTimeAsync(100) // First retry
      await vi.advanceTimersByTimeAsync(200) // Second retry (backoff)

      const result = await resultPromise

      expect(result.success).toBe(true)
      expect(mockRpcClient.rpc).toHaveBeenCalledTimes(3)
    })

    it('should fail after max retries exceeded', async () => {
      mockRpcClient.rpc.mockRejectedValue(new Error('Persistent error'))

      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          retryConfig: {
            maxRetries: 2,
            retryDelayMs: 50,
            backoffMultiplier: 1,
          },
        },
        mockRpcClient
      )

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Will Fail' },
        updatedFields: { name: 'Will Fail' },
        removedFields: [],
        timestamp: Date.now(),
      }

      const resultPromise = handler.update(mutation)

      // Advance through all retries
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(100)

      const result = await resultPromise

      expect(result.success).toBe(false)
      expect(mockRpcClient.rpc).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })

    it('should use exponential backoff', async () => {
      const callTimes: number[] = []

      mockRpcClient.rpc.mockImplementation(async () => {
        callTimes.push(Date.now())
        throw new Error('Retry me')
      })

      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          retryConfig: {
            maxRetries: 3,
            retryDelayMs: 100,
            backoffMultiplier: 2,
          },
        },
        mockRpcClient
      )

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Backoff Test' },
        updatedFields: { name: 'Backoff Test' },
        removedFields: [],
        timestamp: Date.now(),
      }

      const resultPromise = handler.update(mutation)

      // Advance through backoff delays: 100, 200, 400
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(200)
      await vi.advanceTimersByTimeAsync(400)

      await resultPromise

      // Verify exponential backoff timing
      expect(mockRpcClient.rpc).toHaveBeenCalledTimes(4)
    })
  })

  describe('pending updates management', () => {
    it('should track pending updates', async () => {
      let resolveRpc: (value: any) => void

      mockRpcClient.rpc.mockReturnValue(
        new Promise((resolve) => {
          resolveRpc = resolve
        })
      )

      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Pending' },
        updatedFields: { name: 'Pending' },
        removedFields: [],
        timestamp: Date.now(),
      }

      handler.update(mutation)

      expect(handler.hasPendingUpdates()).toBe(true)
      expect(handler.getPendingUpdates()).toHaveLength(1)
      expect(handler.getPendingUpdates()[0]?.key).toBe('user-123')

      resolveRpc!({ acknowledged: true, modifiedCount: 1 })
      await vi.advanceTimersByTimeAsync(0)

      expect(handler.hasPendingUpdates()).toBe(false)
    })

    it('should allow cancelling pending updates', async () => {
      let resolveRpc: (value: any) => void

      mockRpcClient.rpc.mockReturnValue(
        new Promise((resolve) => {
          resolveRpc = resolve
        })
      )

      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Cancel Me' },
        updatedFields: { name: 'Cancel Me' },
        removedFields: [],
        timestamp: Date.now(),
      }

      handler.update(mutation)

      const cancelled = handler.cancel('user-123')

      expect(cancelled).toBe(true)
      expect(handler.hasPendingUpdates()).toBe(false)
    })

    it('should allow cancelling all pending updates', async () => {
      mockRpcClient.rpc.mockReturnValue(new Promise(() => {})) // Never resolves

      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      const mutations = [
        {
          key: 'user-1',
          previousValue: createTestDocument('user-1'),
          newValue: { ...createTestDocument('user-1'), name: 'U1' },
          updatedFields: { name: 'U1' },
          removedFields: [],
          timestamp: Date.now(),
        },
        {
          key: 'user-2',
          previousValue: createTestDocument('user-2'),
          newValue: { ...createTestDocument('user-2'), name: 'U2' },
          updatedFields: { name: 'U2' },
          removedFields: [],
          timestamp: Date.now(),
        },
      ]

      mutations.forEach((m) => handler.update(m))

      expect(handler.getPendingUpdates()).toHaveLength(2)

      handler.cancelAll()

      expect(handler.hasPendingUpdates()).toBe(false)
    })

    it('should flush all pending updates immediately', async () => {
      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          batchSize: 100,
          batchTimeoutMs: 10000,
        },
        mockRpcClient
      )

      const mutations = [
        {
          key: 'user-1',
          previousValue: createTestDocument('user-1'),
          newValue: { ...createTestDocument('user-1'), name: 'Flush 1' },
          updatedFields: { name: 'Flush 1' },
          removedFields: [],
          timestamp: Date.now(),
        },
        {
          key: 'user-2',
          previousValue: createTestDocument('user-2'),
          newValue: { ...createTestDocument('user-2'), name: 'Flush 2' },
          updatedFields: { name: 'Flush 2' },
          removedFields: [],
          timestamp: Date.now(),
        },
      ]

      mutations.forEach((m) => handler.update(m))

      expect(mockRpcClient.rpc).not.toHaveBeenCalled()

      const results = await handler.flush()

      expect(mockRpcClient.rpc).toHaveBeenCalled()
      expect(results).toHaveLength(2)
    })
  })

  describe('cleanup', () => {
    it('should cleanup resources on destroy', async () => {
      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      handler.destroy()

      // Should not accept new updates after destroy
      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'After Destroy' },
        updatedFields: { name: 'After Destroy' },
        removedFields: [],
        timestamp: Date.now(),
      }

      await expect(handler.update(mutation)).rejects.toThrow(/destroyed/i)
    })

    it('should cancel pending updates on destroy', async () => {
      mockRpcClient.rpc.mockReturnValue(new Promise(() => {}))

      const handler = createUpdateMutationHandler(defaultConfig, mockRpcClient)

      handler.update({
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Pending' },
        updatedFields: { name: 'Pending' },
        removedFields: [],
        timestamp: Date.now(),
      })

      expect(handler.hasPendingUpdates()).toBe(true)

      handler.destroy()

      expect(handler.hasPendingUpdates()).toBe(false)
    })
  })

  describe('authentication', () => {
    it('should include auth token in RPC calls', async () => {
      const handler = createUpdateMutationHandler(
        {
          ...defaultConfig,
          authToken: 'secret-token',
        },
        mockRpcClient
      )

      const mutation: UpdateMutation<TestDocument> = {
        key: 'user-123',
        previousValue: createTestDocument('user-123'),
        newValue: { ...createTestDocument('user-123'), name: 'Auth Test' },
        updatedFields: { name: 'Auth Test' },
        removedFields: [],
        timestamp: Date.now(),
      }

      await handler.update(mutation)

      expect(mockRpcClient.rpc).toHaveBeenCalledWith(
        'updateOne',
        expect.objectContaining({
          authToken: 'secret-token',
        })
      )
    })
  })
})

// =============================================================================
// Helper Functions
// =============================================================================

function createTestDocument(id: string): TestDocument {
  return {
    _id: id,
    name: 'Test User',
    email: 'test@example.com',
    age: 30,
    status: 'active',
    settings: {
      theme: 'light',
      notifications: true,
    },
    tags: ['developer'],
  }
}

describe('UpdateMutation Type Safety', () => {
  it('should preserve document type in mutations', () => {
    interface User {
      _id: string
      name: string
      age: number
    }

    const mutation: UpdateMutation<User> = {
      key: 'user-1',
      previousValue: { _id: 'user-1', name: 'Old', age: 25 },
      newValue: { _id: 'user-1', name: 'New', age: 26 },
      updatedFields: { name: 'New', age: 26 },
      removedFields: [],
      timestamp: Date.now(),
    }

    // Type check - should compile without errors
    expect(mutation.newValue.name).toBe('New')
    expect(mutation.previousValue.age).toBe(25)
  })

  it('should type updatedFields as partial of document', () => {
    interface Product {
      _id: string
      name: string
      price: number
      description: string
    }

    const mutation: UpdateMutation<Product> = {
      key: 'prod-1',
      previousValue: { _id: 'prod-1', name: 'Widget', price: 10, description: 'A widget' },
      newValue: { _id: 'prod-1', name: 'Updated Widget', price: 15, description: 'A widget' },
      updatedFields: { name: 'Updated Widget', price: 15 }, // Partial<Product>
      removedFields: [],
      timestamp: Date.now(),
    }

    expect(mutation.updatedFields.name).toBe('Updated Widget')
    expect(mutation.updatedFields.description).toBeUndefined()
  })
})
