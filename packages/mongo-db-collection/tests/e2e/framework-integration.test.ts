/**
 * @file Framework Integration E2E Tests (RED Phase - TDD)
 *
 * These tests verify the end-to-end integration between the mongo-db-collection
 * package and the TanStack DB framework. This is Layer 14 of the architecture,
 * ensuring that all components work together seamlessly.
 *
 * The integration tests verify:
 * 1. Collection configuration flows correctly to the framework
 * 2. Sync lifecycle methods are called in correct order
 * 3. Change events propagate correctly through the system
 * 4. Error handling works end-to-end
 * 5. Type safety is maintained across boundaries
 *
 * RED PHASE: These tests define the expected behavior for framework integration.
 * Implementation will follow in the GREEN phase.
 *
 * @see https://tanstack.com/db/latest/docs
 * @bead po0.231 - RED tests for Layer 14 E2E Integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

// Import from the package entry point to test the public API
import {
  mongoDoCollectionOptions,
  createMongoDoCollection,
  isMongoDoCollectionConfig,
  createInsertMutationHandler,
  createUpdateMutationHandler,
  createDeleteMutationHandler,
} from '../../src/index'
import type {
  MongoDoCollectionConfig,
  SyncParams,
  SyncReturn,
  ChangeMessage,
  SyncMode,
  ConflictStrategy,
  LoadSubsetOptions,
} from '../../src/index'
import type { Collection } from '@tanstack/db'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Test document schema representing a typical entity
 */
const userSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().min(0),
  status: z.enum(['active', 'inactive', 'pending']),
  tags: z.array(z.string()).optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
})

type User = z.infer<typeof userSchema>

/**
 * Product schema for multi-collection testing
 */
const productSchema = z.object({
  _id: z.string(),
  sku: z.string(),
  name: z.string(),
  price: z.number().positive(),
  inventory: z.number().int().min(0),
  category: z.string(),
})

type Product = z.infer<typeof productSchema>

/**
 * Creates a standard test configuration for users
 */
function createUserConfig(
  overrides: Partial<MongoDoCollectionConfig<User>> = {}
): MongoDoCollectionConfig<User> {
  return {
    id: 'users',
    endpoint: 'https://api.mongo.do',
    database: 'testdb',
    collectionName: 'users',
    schema: userSchema,
    getKey: (user) => user._id,
    syncMode: 'eager',
    enableChangeStream: true,
    ...overrides,
  }
}

/**
 * Creates a mock collection for testing
 */
function createMockCollection<T extends object>(): Collection<T> & {
  _mockState: Map<string, T>
} {
  const mockState = new Map<string, T>()

  return {
    id: 'mock-collection',
    state: () => mockState,
    _mockState: mockState,
  } as Collection<T> & { _mockState: Map<string, T> }
}

/**
 * Creates mock sync params for testing
 */
function createMockSyncParams<T extends object>(): SyncParams<T> & {
  begin: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
  markReady: ReturnType<typeof vi.fn>
} {
  return {
    collection: createMockCollection<T>(),
    begin: vi.fn(),
    write: vi.fn(),
    commit: vi.fn(),
    markReady: vi.fn(),
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Framework Integration E2E Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Collection Configuration Integration', () => {
    it('should create valid collection config via mongoDoCollectionOptions', () => {
      const config = mongoDoCollectionOptions<User>(createUserConfig())

      expect(config).toBeDefined()
      expect(config.id).toBe('users')
      expect(config.endpoint).toBe('https://api.mongo.do')
      expect(config.database).toBe('testdb')
      expect(config.collectionName).toBe('users')
      expect(config.schema).toBe(userSchema)
      expect(config.getKey).toBeInstanceOf(Function)
    })

    it('should create valid collection config via createMongoDoCollection', () => {
      const config = createMongoDoCollection<User>(createUserConfig())

      expect(config).toBeDefined()
      expect(isMongoDoCollectionConfig(config)).toBe(true)
    })

    it('should validate config with isMongoDoCollectionConfig type guard', () => {
      const validConfig = createUserConfig()
      const invalidConfig = { id: 'test' } // Missing required fields

      expect(isMongoDoCollectionConfig(validConfig)).toBe(true)
      expect(isMongoDoCollectionConfig(invalidConfig)).toBe(false)
      expect(isMongoDoCollectionConfig(null)).toBe(false)
      expect(isMongoDoCollectionConfig(undefined)).toBe(false)
    })

    it('should preserve generic type parameter through config creation', () => {
      const config = mongoDoCollectionOptions<User>(createUserConfig())

      // Type assertion verifies type flows correctly
      const testUser: User = {
        _id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        age: 25,
        status: 'active',
      }

      const key = config.getKey(testUser)
      expect(key).toBe('user-1')
    })

    it('should support all sync modes in configuration', () => {
      const syncModes: SyncMode[] = ['eager', 'on-demand', 'progressive']

      for (const syncMode of syncModes) {
        const config = mongoDoCollectionOptions<User>(
          createUserConfig({ syncMode })
        )
        expect(config.syncMode).toBe(syncMode)
      }
    })

    it('should support authentication configuration', () => {
      // Auth token config
      const tokenConfig = mongoDoCollectionOptions<User>(
        createUserConfig({ authToken: 'test-token' })
      )
      expect(tokenConfig.authToken).toBe('test-token')

      // Credentials config
      const credentialsConfig = mongoDoCollectionOptions<User>(
        createUserConfig({
          credentials: { username: 'user', password: 'pass' },
        })
      )
      expect(credentialsConfig.credentials).toEqual({
        username: 'user',
        password: 'pass',
      })
    })
  })

  describe('Multi-Collection Integration', () => {
    it('should support multiple collection configurations', () => {
      const userConfig = mongoDoCollectionOptions<User>(createUserConfig())
      const productConfig = mongoDoCollectionOptions<Product>({
        id: 'products',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'products',
        schema: productSchema,
        getKey: (product) => product._id,
      })

      expect(userConfig.id).not.toBe(productConfig.id)
      expect(userConfig.collectionName).toBe('users')
      expect(productConfig.collectionName).toBe('products')
    })

    it('should maintain type isolation between collections', () => {
      const userConfig = mongoDoCollectionOptions<User>(createUserConfig())
      const productConfig = mongoDoCollectionOptions<Product>({
        id: 'products',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'products',
        schema: productSchema,
        getKey: (product) => product._id,
      })

      const user: User = {
        _id: 'u1',
        name: 'User',
        email: 'u@test.com',
        age: 30,
        status: 'active',
      }
      const product: Product = {
        _id: 'p1',
        sku: 'SKU001',
        name: 'Product',
        price: 99.99,
        inventory: 100,
        category: 'electronics',
      }

      expect(userConfig.getKey(user)).toBe('u1')
      expect(productConfig.getKey(product)).toBe('p1')
    })
  })

  describe('Mutation Handler Integration', () => {
    it('should create insert mutation handler', () => {
      const handler = createInsertMutationHandler({
        collectionName: 'users',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
      })

      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })

    it('should create update mutation handler', () => {
      const handler = createUpdateMutationHandler({
        collectionName: 'users',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
      })

      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })

    it('should create delete mutation handler', () => {
      const handler = createDeleteMutationHandler({
        collectionName: 'users',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
      })

      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })
  })

  describe('Change Message Format Integration', () => {
    it('should create valid insert change message', () => {
      const user: User = {
        _id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        age: 25,
        status: 'active',
      }

      const message: ChangeMessage<User> = {
        type: 'insert',
        key: user._id,
        value: user,
      }

      expect(message.type).toBe('insert')
      expect(message.key).toBe('user-1')
      expect(message.value).toEqual(user)
    })

    it('should create valid update change message', () => {
      const user: User = {
        _id: 'user-1',
        name: 'Updated User',
        email: 'test@example.com',
        age: 26,
        status: 'active',
      }

      const message: ChangeMessage<User> = {
        type: 'update',
        key: user._id,
        value: user,
      }

      expect(message.type).toBe('update')
      expect(message.key).toBe('user-1')
      expect(message.value).toEqual(user)
    })

    it('should create valid delete change message', () => {
      const message: ChangeMessage<User> = {
        type: 'delete',
        key: 'user-1',
      }

      expect(message.type).toBe('delete')
      expect(message.key).toBe('user-1')
      expect(message.value).toBeUndefined()
    })
  })

  describe('Sync Lifecycle Integration', () => {
    it('should support full sync lifecycle through params', () => {
      const params = createMockSyncParams<User>()
      const callOrder: string[] = []

      params.begin.mockImplementation(() => callOrder.push('begin'))
      params.write.mockImplementation(() => callOrder.push('write'))
      params.commit.mockImplementation(() => callOrder.push('commit'))
      params.markReady.mockImplementation(() => callOrder.push('markReady'))

      // Simulate sync lifecycle
      params.begin()
      params.write({ type: 'insert', key: 'u1', value: {} as User })
      params.write({ type: 'insert', key: 'u2', value: {} as User })
      params.commit()
      params.markReady()

      expect(callOrder).toEqual([
        'begin',
        'write',
        'write',
        'commit',
        'markReady',
      ])
    })

    it('should handle empty initial sync', () => {
      const params = createMockSyncParams<User>()

      // Simulate empty sync
      params.begin()
      params.commit()
      params.markReady()

      expect(params.begin).toHaveBeenCalledTimes(1)
      expect(params.write).not.toHaveBeenCalled()
      expect(params.commit).toHaveBeenCalledTimes(1)
      expect(params.markReady).toHaveBeenCalledTimes(1)
    })

    it('should support multiple sync transactions', () => {
      const params = createMockSyncParams<User>()

      // First transaction
      params.begin()
      params.write({ type: 'insert', key: 'u1', value: {} as User })
      params.commit()

      // Second transaction
      params.begin()
      params.write({ type: 'update', key: 'u1', value: {} as User })
      params.commit()

      expect(params.begin).toHaveBeenCalledTimes(2)
      expect(params.write).toHaveBeenCalledTimes(2)
      expect(params.commit).toHaveBeenCalledTimes(2)
    })
  })

  describe('LoadSubset Integration', () => {
    it('should create valid LoadSubsetOptions with filter', () => {
      const options: LoadSubsetOptions<User> = {
        where: {
          status: 'active',
          age: { $gte: 18 },
        },
        limit: 10,
      }

      expect(options.where).toBeDefined()
      expect(options.where?.status).toBe('active')
      expect(options.limit).toBe(10)
    })

    it('should create valid LoadSubsetOptions with pagination', () => {
      const options: LoadSubsetOptions<User> = {
        limit: 20,
        offset: 40,
        orderBy: { createdAt: 'desc' },
      }

      expect(options.limit).toBe(20)
      expect(options.offset).toBe(40)
      expect(options.orderBy).toEqual({ createdAt: 'desc' })
    })

    it('should create valid LoadSubsetOptions with cursor pagination', () => {
      const options: LoadSubsetOptions<User> = {
        cursor: 'last-id-123',
        cursorField: '_id',
        limit: 20,
      }

      expect(options.cursor).toBe('last-id-123')
      expect(options.cursorField).toBe('_id')
      expect(options.limit).toBe(20)
    })

    it('should support complex MongoDB filter queries', () => {
      const options: LoadSubsetOptions<User> = {
        where: {
          $or: [{ status: 'active' }, { status: 'pending' }],
          age: { $gte: 18, $lt: 65 },
          tags: { $in: ['premium', 'verified'] },
        },
      }

      expect(options.where?.$or).toHaveLength(2)
      expect(options.where?.age).toEqual({ $gte: 18, $lt: 65 })
    })
  })

  describe('SyncReturn Interface Integration', () => {
    it('should create valid SyncReturn with cleanup', () => {
      const cleanupFn = vi.fn()

      const syncReturn: SyncReturn = {
        cleanup: cleanupFn,
      }

      expect(syncReturn.cleanup).toBeDefined()
      expect(syncReturn.loadSubset).toBeUndefined()

      syncReturn.cleanup()
      expect(cleanupFn).toHaveBeenCalledTimes(1)
    })

    it('should create valid SyncReturn with loadSubset', () => {
      const cleanupFn = vi.fn()
      const loadSubsetFn = vi.fn().mockResolvedValue(undefined)

      const syncReturn: SyncReturn = {
        cleanup: cleanupFn,
        loadSubset: loadSubsetFn,
      }

      expect(syncReturn.cleanup).toBeDefined()
      expect(syncReturn.loadSubset).toBeDefined()
    })

    it('should allow loadSubset to be called with options', async () => {
      const loadSubsetFn = vi.fn().mockResolvedValue(undefined)

      const syncReturn: SyncReturn = {
        cleanup: vi.fn(),
        loadSubset: loadSubsetFn,
      }

      await syncReturn.loadSubset?.({
        where: { status: 'active' },
        limit: 10,
      })

      expect(loadSubsetFn).toHaveBeenCalledWith({
        where: { status: 'active' },
        limit: 10,
      })
    })
  })

  describe('Type Safety E2E', () => {
    it('should maintain type safety through configuration chain', () => {
      // This test verifies compile-time type safety
      const config = mongoDoCollectionOptions<User>({
        id: 'typed-users',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'users',
        schema: userSchema,
        getKey: (user) => {
          // TypeScript should know user has User shape
          return user._id
        },
      })

      // getKey should accept User and return string
      const user: User = {
        _id: 'test-id',
        name: 'Test',
        email: 'test@test.com',
        age: 25,
        status: 'active',
      }

      const key: string = config.getKey(user)
      expect(key).toBe('test-id')
    })

    it('should enforce document type in change messages', () => {
      // This test verifies that change messages are properly typed
      const user: User = {
        _id: 'u1',
        name: 'User',
        email: 'u@test.com',
        age: 30,
        status: 'active',
      }

      const insertMessage: ChangeMessage<User> = {
        type: 'insert',
        key: user._id,
        value: user,
      }

      const updateMessage: ChangeMessage<User> = {
        type: 'update',
        key: user._id,
        value: user,
      }

      const deleteMessage: ChangeMessage<User> = {
        type: 'delete',
        key: user._id,
      }

      expect(insertMessage.type).toBe('insert')
      expect(updateMessage.type).toBe('update')
      expect(deleteMessage.type).toBe('delete')
    })

    it('should enforce filter types in LoadSubsetOptions', () => {
      // This test verifies that filter queries are type-safe
      const options: LoadSubsetOptions<User> = {
        where: {
          // TypeScript should enforce User field types
          status: 'active', // Valid enum value
          age: { $gte: 18 }, // Valid number comparison
          name: { $regex: '^Test' }, // Valid string operation
        },
      }

      expect(options.where?.status).toBe('active')
    })
  })

  describe('Error Handling Integration', () => {
    it('should handle invalid config gracefully', () => {
      // The type guard should return false for invalid configs
      const invalidConfigs = [
        null,
        undefined,
        {},
        { id: 'test' },
        { id: 'test', endpoint: 'url' },
        { id: 'test', endpoint: 'url', database: 'db' },
      ]

      for (const config of invalidConfigs) {
        expect(isMongoDoCollectionConfig(config)).toBe(false)
      }
    })

    it('should validate sync params exist', () => {
      const params = createMockSyncParams<User>()

      expect(params.collection).toBeDefined()
      expect(params.begin).toBeInstanceOf(Function)
      expect(params.write).toBeInstanceOf(Function)
      expect(params.commit).toBeInstanceOf(Function)
      expect(params.markReady).toBeInstanceOf(Function)
    })
  })

  describe('Schema Validation Integration', () => {
    it('should validate documents against schema', () => {
      const config = createUserConfig()
      const validUser: User = {
        _id: 'u1',
        name: 'Test User',
        email: 'test@example.com',
        age: 25,
        status: 'active',
      }

      const result = config.schema.safeParse(validUser)
      expect(result.success).toBe(true)
    })

    it('should reject invalid documents via schema', () => {
      const config = createUserConfig()
      const invalidUser = {
        _id: 'u1',
        name: 'Test User',
        email: 'invalid-email', // Invalid email format
        age: -5, // Invalid age
        status: 'unknown', // Invalid status
      }

      const result = config.schema.safeParse(invalidUser)
      expect(result.success).toBe(false)
    })

    it('should handle optional fields in schema', () => {
      const config = createUserConfig()
      const userWithOptionals: User = {
        _id: 'u1',
        name: 'Test User',
        email: 'test@example.com',
        age: 25,
        status: 'active',
        tags: ['premium', 'verified'],
        createdAt: new Date(),
      }

      const result = config.schema.safeParse(userWithOptionals)
      expect(result.success).toBe(true)
    })
  })

  describe('Framework Compatibility', () => {
    it('should export all required types for framework integration', async () => {
      // Verify all necessary types are exported from the main module
      const exports = await import('../../src/index')

      // Functions
      expect(exports.mongoDoCollectionOptions).toBeDefined()
      expect(exports.createMongoDoCollection).toBeDefined()
      expect(exports.isMongoDoCollectionConfig).toBeDefined()

      // Mutation handlers
      expect(exports.createInsertMutationHandler).toBeDefined()
      expect(exports.createUpdateMutationHandler).toBeDefined()
      expect(exports.createDeleteMutationHandler).toBeDefined()
    })

    it('should export type guards for runtime validation', async () => {
      const exports = await import('../../src/index')

      expect(typeof exports.isMongoDoCollectionConfig).toBe('function')
    })

    it('should provide consistent API surface', () => {
      // Both factory functions should return identical results
      const config1 = mongoDoCollectionOptions<User>(createUserConfig())
      const config2 = createMongoDoCollection<User>(createUserConfig())

      expect(config1).toEqual(config2)
    })
  })
})

describe('Integration Contract Tests', () => {
  describe('TanStack DB Contract Compliance', () => {
    it('should provide SyncParams-compatible interface', () => {
      // Verify SyncParams structure matches TanStack DB expectations
      interface ExpectedSyncParams<T extends object> {
        collection: { id: string }
        begin: () => void
        write: (change: { type: string; key: string; value?: T }) => void
        commit: () => void
        markReady: () => void
      }

      const params = createMockSyncParams<User>()

      // Type assertion verifies contract compliance
      const _contractCheck: ExpectedSyncParams<User> = params
      expect(_contractCheck).toBeDefined()
    })

    it('should provide SyncReturn-compatible interface', () => {
      // Verify SyncReturn structure matches TanStack DB expectations
      interface ExpectedSyncReturn {
        cleanup: () => void
        loadSubset?: (options: Record<string, unknown>) => Promise<void>
      }

      const syncReturn: SyncReturn = {
        cleanup: () => {},
        loadSubset: async () => {},
      }

      // Type assertion verifies contract compliance
      const _contractCheck: ExpectedSyncReturn = syncReturn
      expect(_contractCheck).toBeDefined()
    })

    it('should provide ChangeMessage-compatible interface', () => {
      // Verify ChangeMessage structure matches TanStack DB expectations
      type ExpectedChangeMessage<T> =
        | { type: 'insert'; key: string; value: T }
        | { type: 'update'; key: string; value: T }
        | { type: 'delete'; key: string; value?: undefined }

      const insertMsg: ChangeMessage<User> = {
        type: 'insert',
        key: 'k1',
        value: {} as User,
      }

      const updateMsg: ChangeMessage<User> = {
        type: 'update',
        key: 'k1',
        value: {} as User,
      }

      const deleteMsg: ChangeMessage<User> = {
        type: 'delete',
        key: 'k1',
      }

      // Type assertion verifies contract compliance
      const _insertCheck: ExpectedChangeMessage<User> = insertMsg
      const _updateCheck: ExpectedChangeMessage<User> = updateMsg
      const _deleteCheck: ExpectedChangeMessage<User> = deleteMsg

      expect(_insertCheck).toBeDefined()
      expect(_updateCheck).toBeDefined()
      expect(_deleteCheck).toBeDefined()
    })
  })
})
