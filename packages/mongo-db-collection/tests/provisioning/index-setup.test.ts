/**
 * @file Index Setup Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the Index Setup functionality that creates
 * necessary MongoDB indexes for efficient querying during user provisioning.
 *
 * Index Setup is called during Layer 12 User Provisioning to ensure that
 * MongoDB collections have the appropriate indexes for efficient queries
 * on commonly accessed fields like userId, email, createdAt, etc.
 *
 * RED PHASE: These tests will fail until the index setup is implemented
 * in src/provisioning/index-setup.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createIndexSetup,
  setupIndexes,
  type IndexSetupConfig,
  type IndexDefinition,
  type IndexSetupResult,
  type IndexSetupHandler,
} from '../../src/provisioning/index-setup'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic user document type for testing index setup.
 */
interface TestUser {
  _id: string
  userId: string
  email: string
  name: string
  createdAt: Date
  updatedAt: Date
  status: 'active' | 'inactive' | 'pending'
}

/**
 * Document with compound index requirements.
 */
interface TestOrder {
  _id: string
  userId: string
  productId: string
  status: string
  createdAt: Date
  total: number
}

// =============================================================================
// Mock RPC Client
// =============================================================================

interface MockRpcClient {
  rpc: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  isConnected: ReturnType<typeof vi.fn>
}

function createMockRpcClient(): MockRpcClient {
  return {
    rpc: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  }
}

// =============================================================================
// Index Setup Factory Tests
// =============================================================================

describe('createIndexSetup', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createIndexSetup).toBe('function')
    })

    it('should return a handler function', () => {
      const mockRpc = createMockRpcClient()
      const handler = createIndexSetup({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
      })

      expect(typeof handler).toBe('function')
    })

    it('should throw when rpcClient is not provided', () => {
      expect(() =>
        createIndexSetup({
          rpcClient: undefined as any,
          database: 'testdb',
          collection: 'users',
        })
      ).toThrow('rpcClient is required')
    })

    it('should throw when database is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createIndexSetup({
          rpcClient: mockRpc,
          database: '',
          collection: 'users',
        })
      ).toThrow('database is required')
    })

    it('should throw when collection is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createIndexSetup({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: '',
        })
      ).toThrow('collection is required')
    })
  })

  describe('handler execution', () => {
    let mockRpc: MockRpcClient
    let handler: IndexSetupHandler

    beforeEach(() => {
      mockRpc = createMockRpcClient()
      mockRpc.rpc.mockResolvedValue({ ok: 1, createdCollectionAutomatically: false })
    })

    it('should call RPC with createIndex for a single index', async () => {
      const handler = createIndexSetup({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { userId: 1 }, options: { unique: true } },
        ],
      })

      await handler()

      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'users',
        keys: { userId: 1 },
        options: { unique: true },
      })
    })

    it('should call RPC for multiple indexes', async () => {
      const handler = createIndexSetup({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { userId: 1 }, options: { unique: true } },
          { key: { email: 1 }, options: { unique: true } },
          { key: { createdAt: -1 } },
        ],
      })

      await handler()

      expect(mockRpc.rpc).toHaveBeenCalledTimes(3)
      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'users',
        keys: { userId: 1 },
        options: { unique: true },
      })
      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'users',
        keys: { email: 1 },
        options: { unique: true },
      })
      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'users',
        keys: { createdAt: -1 },
        options: undefined,
      })
    })

    it('should handle compound indexes', async () => {
      const handler = createIndexSetup({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'orders',
        indexes: [
          { key: { userId: 1, createdAt: -1 } },
          { key: { status: 1, productId: 1 } },
        ],
      })

      await handler()

      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'orders',
        keys: { userId: 1, createdAt: -1 },
        options: undefined,
      })
      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'orders',
        keys: { status: 1, productId: 1 },
        options: undefined,
      })
    })

    it('should handle empty indexes array', async () => {
      const handler = createIndexSetup({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [],
      })

      const result = await handler()

      expect(mockRpc.rpc).not.toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(result.indexesCreated).toBe(0)
    })

    it('should return result with created index count', async () => {
      const handler = createIndexSetup({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { userId: 1 } },
          { key: { email: 1 } },
        ],
      })

      const result = await handler()

      expect(result.success).toBe(true)
      expect(result.indexesCreated).toBe(2)
    })
  })
})

// =============================================================================
// Direct setupIndexes Function Tests
// =============================================================================

describe('setupIndexes', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ ok: 1 })
  })

  describe('basic functionality', () => {
    it('should be a function', () => {
      expect(typeof setupIndexes).toBe('function')
    })

    it('should create a single index', async () => {
      const result = await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { userId: 1 }, options: { unique: true } },
        ],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'users',
        keys: { userId: 1 },
        options: { unique: true },
      })
      expect(result.success).toBe(true)
    })

    it('should create multiple indexes', async () => {
      const result = await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { userId: 1 }, options: { unique: true } },
          { key: { email: 1 }, options: { unique: true, sparse: true } },
          { key: { status: 1, createdAt: -1 } },
        ],
      })

      expect(mockRpc.rpc).toHaveBeenCalledTimes(3)
      expect(result.success).toBe(true)
      expect(result.indexesCreated).toBe(3)
    })

    it('should return success false on RPC error', async () => {
      mockRpc.rpc.mockRejectedValue(new Error('MongoDB connection failed'))

      const result = await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { userId: 1 } },
        ],
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toBe('MongoDB connection failed')
    })
  })

  describe('index options', () => {
    it('should support unique indexes', async () => {
      await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { email: 1 }, options: { unique: true } },
        ],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'users',
        keys: { email: 1 },
        options: { unique: true },
      })
    })

    it('should support sparse indexes', async () => {
      await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { optionalField: 1 }, options: { sparse: true } },
        ],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'users',
        keys: { optionalField: 1 },
        options: { sparse: true },
      })
    })

    it('should support TTL indexes', async () => {
      await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'sessions',
        indexes: [
          { key: { expiresAt: 1 }, options: { expireAfterSeconds: 3600 } },
        ],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'sessions',
        keys: { expiresAt: 1 },
        options: { expireAfterSeconds: 3600 },
      })
    })

    it('should support background index creation', async () => {
      await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { name: 1 }, options: { background: true } },
        ],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'users',
        keys: { name: 1 },
        options: { background: true },
      })
    })

    it('should support named indexes', async () => {
      await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { userId: 1 }, options: { name: 'user_id_idx' } },
        ],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'users',
        keys: { userId: 1 },
        options: { name: 'user_id_idx' },
      })
    })

    it('should support partial filter expressions', async () => {
      await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          {
            key: { email: 1 },
            options: {
              unique: true,
              partialFilterExpression: { status: 'active' },
            },
          },
        ],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'users',
        keys: { email: 1 },
        options: {
          unique: true,
          partialFilterExpression: { status: 'active' },
        },
      })
    })
  })

  describe('index types', () => {
    it('should support text indexes', async () => {
      await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'articles',
        indexes: [
          { key: { title: 'text', content: 'text' } },
        ],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'articles',
        keys: { title: 'text', content: 'text' },
        options: undefined,
      })
    })

    it('should support 2dsphere indexes', async () => {
      await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'locations',
        indexes: [
          { key: { location: '2dsphere' } },
        ],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'locations',
        keys: { location: '2dsphere' },
        options: undefined,
      })
    })

    it('should support hashed indexes', async () => {
      await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { shardKey: 'hashed' } },
        ],
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('createIndex', {
        database: 'testdb',
        collection: 'users',
        keys: { shardKey: 'hashed' },
        options: undefined,
      })
    })
  })

  describe('input validation', () => {
    it('should throw when indexes is not provided', async () => {
      await expect(
        setupIndexes({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          indexes: undefined as any,
        })
      ).rejects.toThrow('indexes is required')
    })

    it('should throw when database is empty', async () => {
      await expect(
        setupIndexes({
          rpcClient: mockRpc,
          database: '',
          collection: 'users',
          indexes: [{ key: { userId: 1 } }],
        })
      ).rejects.toThrow('database is required')
    })

    it('should throw when collection is empty', async () => {
      await expect(
        setupIndexes({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: '',
          indexes: [{ key: { userId: 1 } }],
        })
      ).rejects.toThrow('collection is required')
    })

    it('should throw when index key is empty', async () => {
      await expect(
        setupIndexes({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'users',
          indexes: [{ key: {} }],
        })
      ).rejects.toThrow('index key cannot be empty')
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('error handling', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
  })

  describe('duplicate index errors', () => {
    it('should handle duplicate index errors gracefully', async () => {
      mockRpc.rpc.mockRejectedValue(new Error('Index already exists with different options'))

      const result = await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { userId: 1 }, options: { unique: true } },
        ],
      })

      expect(result.success).toBe(false)
      expect(result.isDuplicateIndexError).toBe(true)
    })

    it('should continue creating remaining indexes if one already exists with skipExisting option', async () => {
      mockRpc.rpc
        .mockRejectedValueOnce(new Error('Index already exists'))
        .mockResolvedValueOnce({ ok: 1 })
        .mockResolvedValueOnce({ ok: 1 })

      const result = await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { userId: 1 } },
          { key: { email: 1 } },
          { key: { createdAt: -1 } },
        ],
        options: { skipExisting: true },
      })

      expect(mockRpc.rpc).toHaveBeenCalledTimes(3)
      expect(result.success).toBe(true)
      expect(result.indexesCreated).toBe(2)
      expect(result.indexesSkipped).toBe(1)
    })
  })

  describe('network errors', () => {
    it('should handle connection timeout', async () => {
      mockRpc.rpc.mockRejectedValue(new Error('Connection timed out'))

      const result = await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { userId: 1 } },
        ],
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toBe('Connection timed out')
    })

    it('should handle disconnected client', async () => {
      mockRpc.isConnected.mockReturnValue(false)

      const result = await setupIndexes({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'users',
        indexes: [
          { key: { userId: 1 } },
        ],
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('not connected')
    })
  })
})

// =============================================================================
// Provisioning Integration Tests
// =============================================================================

describe('provisioning integration', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ ok: 1 })
  })

  it('should support typical user provisioning indexes', async () => {
    const result = await setupIndexes({
      rpcClient: mockRpc,
      database: 'app',
      collection: 'users',
      indexes: [
        { key: { userId: 1 }, options: { unique: true } },
        { key: { email: 1 }, options: { unique: true, sparse: true } },
        { key: { status: 1 } },
        { key: { createdAt: -1 } },
        { key: { 'profile.organization': 1 } },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.indexesCreated).toBe(5)
  })

  it('should support session/token indexes with TTL', async () => {
    const result = await setupIndexes({
      rpcClient: mockRpc,
      database: 'app',
      collection: 'sessions',
      indexes: [
        { key: { sessionId: 1 }, options: { unique: true } },
        { key: { userId: 1 } },
        { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.indexesCreated).toBe(3)
  })

  it('should support audit log indexes', async () => {
    const result = await setupIndexes({
      rpcClient: mockRpc,
      database: 'app',
      collection: 'auditLogs',
      indexes: [
        { key: { userId: 1, timestamp: -1 } },
        { key: { action: 1 } },
        { key: { resourceType: 1, resourceId: 1 } },
        { key: { timestamp: -1 } },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.indexesCreated).toBe(4)
  })
})

// =============================================================================
// Hooks and Callbacks Tests
// =============================================================================

describe('hooks and callbacks', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ ok: 1 })
  })

  it('should call onBeforeCreate hook', async () => {
    const onBeforeCreate = vi.fn()

    await setupIndexes({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      indexes: [
        { key: { userId: 1 } },
      ],
      hooks: {
        onBeforeCreate,
      },
    })

    expect(onBeforeCreate).toHaveBeenCalledWith({
      database: 'testdb',
      collection: 'users',
      index: { key: { userId: 1 } },
    })
  })

  it('should call onAfterCreate hook', async () => {
    const onAfterCreate = vi.fn()

    await setupIndexes({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      indexes: [
        { key: { userId: 1 } },
      ],
      hooks: {
        onAfterCreate,
      },
    })

    expect(onAfterCreate).toHaveBeenCalledWith({
      database: 'testdb',
      collection: 'users',
      index: { key: { userId: 1 } },
      result: { ok: 1 },
    })
  })

  it('should call onError hook on failure', async () => {
    const error = new Error('Index creation failed')
    mockRpc.rpc.mockRejectedValue(error)
    const onError = vi.fn()

    await setupIndexes({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      indexes: [
        { key: { userId: 1 } },
      ],
      hooks: {
        onError,
      },
    })

    expect(onError).toHaveBeenCalledWith({
      error,
      database: 'testdb',
      collection: 'users',
      index: { key: { userId: 1 } },
    })
  })

  it('should call onComplete hook after all indexes are processed', async () => {
    const onComplete = vi.fn()

    await setupIndexes({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      indexes: [
        { key: { userId: 1 } },
        { key: { email: 1 } },
      ],
      hooks: {
        onComplete,
      },
    })

    expect(onComplete).toHaveBeenCalledWith({
      success: true,
      indexesCreated: 2,
      indexesSkipped: 0,
      indexesFailed: 0,
    })
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('type safety', () => {
  it('should maintain proper types for index definitions', async () => {
    const mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ ok: 1 })

    // This test verifies TypeScript compilation
    const indexes: IndexDefinition[] = [
      { key: { userId: 1 }, options: { unique: true } },
      { key: { email: 1 }, options: { unique: true, sparse: true } },
      { key: { createdAt: -1 } },
    ]

    const result = await setupIndexes({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      indexes,
    })

    expect(result.success).toBe(true)
  })

  it('should accept typed handler from factory', async () => {
    const mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ ok: 1 })

    const handler: IndexSetupHandler = createIndexSetup({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      indexes: [
        { key: { userId: 1 } },
      ],
    })

    const result = await handler()

    expect(result.success).toBe(true)
  })
})

// =============================================================================
// Concurrent Index Creation Tests
// =============================================================================

describe('concurrent index creation', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue({ ok: 1 })
  })

  it('should create indexes sequentially by default', async () => {
    const callOrder: number[] = []
    mockRpc.rpc.mockImplementation(async () => {
      callOrder.push(callOrder.length)
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { ok: 1 }
    })

    await setupIndexes({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      indexes: [
        { key: { userId: 1 } },
        { key: { email: 1 } },
        { key: { createdAt: -1 } },
      ],
    })

    expect(callOrder).toEqual([0, 1, 2])
  })

  it('should support concurrent index creation with concurrency option', async () => {
    let concurrentCalls = 0
    let maxConcurrent = 0

    mockRpc.rpc.mockImplementation(async () => {
      concurrentCalls++
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls)
      await new Promise((resolve) => setTimeout(resolve, 10))
      concurrentCalls--
      return { ok: 1 }
    })

    await setupIndexes({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      indexes: [
        { key: { userId: 1 } },
        { key: { email: 1 } },
        { key: { createdAt: -1 } },
        { key: { status: 1 } },
      ],
      options: { concurrency: 2 },
    })

    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })
})

// =============================================================================
// List Indexes Tests
// =============================================================================

describe('listIndexes', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
  })

  it('should support listing existing indexes', async () => {
    mockRpc.rpc.mockResolvedValue([
      { name: '_id_', key: { _id: 1 } },
      { name: 'userId_1', key: { userId: 1 }, unique: true },
    ])

    const result = await setupIndexes({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'users',
      indexes: [],
      options: { listExisting: true },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('listIndexes', {
      database: 'testdb',
      collection: 'users',
    })
    expect(result.existingIndexes).toEqual([
      { name: '_id_', key: { _id: 1 } },
      { name: 'userId_1', key: { userId: 1 }, unique: true },
    ])
  })
})
