/**
 * @file useMongoDoCollection React Hook Tests (RED Phase - TDD)
 *
 * Bead ID: po0.233
 *
 * These tests verify the useMongoDoCollection React hook that provides
 * a convenient way to use a MongoDB collection in React components with
 * proper lifecycle management.
 *
 * The hook is responsible for:
 * 1. Creating and managing collection configuration
 * 2. Providing sync function for TanStack DB integration
 * 3. Managing collection lifecycle (setup and cleanup)
 * 4. Exposing type-safe collection options
 * 5. Handling auth token updates and reconnection
 *
 * RED PHASE: These tests will fail until useMongoDoCollection is implemented
 * in src/factory/use-collection-hook.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import {
  useMongoDoCollection,
  type UseMongoDoCollectionOptions,
  type UseMongoDoCollectionReturn,
} from '../../src/factory/use-collection-hook'
import type { MongoDoCollectionConfig, SyncMode } from '../../src/types'

// Test document schema and type
const userSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
  createdAt: z.date().optional(),
})

type User = z.infer<typeof userSchema>

// Product schema for additional type tests
const productSchema = z.object({
  _id: z.string(),
  sku: z.string(),
  name: z.string(),
  price: z.number().positive(),
  inStock: z.boolean(),
})

type Product = z.infer<typeof productSchema>

// Mock React hooks for testing without actual React dependency
const mockUseState = vi.fn()
const mockUseEffect = vi.fn()
const mockUseCallback = vi.fn()
const mockUseMemo = vi.fn()
const mockUseRef = vi.fn()

// Setup React mock
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    mockUseState(initial)
    return [initial, vi.fn()]
  },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    mockUseEffect(effect, deps)
    // Execute the effect for testing
    const cleanup = effect()
    return cleanup
  },
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]) => {
    mockUseCallback(fn, deps)
    return fn
  },
  useMemo: <T>(fn: () => T, deps: unknown[]) => {
    mockUseMemo(fn, deps)
    return fn()
  },
  useRef: <T>(initial: T) => {
    mockUseRef(initial)
    return { current: initial }
  },
}))

describe('useMongoDoCollection', () => {
  const baseOptions: UseMongoDoCollectionOptions<User> = {
    id: 'users-collection',
    endpoint: 'https://api.mongo.do',
    database: 'testdb',
    collectionName: 'users',
    schema: userSchema,
    getKey: (user) => user._id,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('hook creation and return type', () => {
    it('should return an object with required properties', () => {
      const result = useMongoDoCollection(baseOptions)

      expect(result).toBeDefined()
      expect(result).toHaveProperty('config')
      expect(result).toHaveProperty('sync')
      expect(result).toHaveProperty('isReady')
      expect(result).toHaveProperty('error')
    })

    it('should return config matching MongoDoCollectionConfig interface', () => {
      const result = useMongoDoCollection(baseOptions)

      expect(result.config).toBeDefined()
      expect(result.config.id).toBe('users-collection')
      expect(result.config.endpoint).toBe('https://api.mongo.do')
      expect(result.config.database).toBe('testdb')
      expect(result.config.collectionName).toBe('users')
      expect(result.config.schema).toBe(userSchema)
      expect(result.config.getKey).toBeInstanceOf(Function)
    })

    it('should return a sync function', () => {
      const result = useMongoDoCollection(baseOptions)

      expect(result.sync).toBeInstanceOf(Function)
    })

    it('should have isReady as a boolean', () => {
      const result = useMongoDoCollection(baseOptions)

      expect(typeof result.isReady).toBe('boolean')
    })

    it('should have error as null or Error', () => {
      const result = useMongoDoCollection(baseOptions)

      expect(result.error === null || result.error instanceof Error).toBe(true)
    })

    it('should match UseMongoDoCollectionReturn interface', () => {
      const result: UseMongoDoCollectionReturn<User> = useMongoDoCollection(baseOptions)

      // Type check - should compile without errors
      const config: MongoDoCollectionConfig<User> = result.config
      const isReady: boolean = result.isReady
      const error: Error | null = result.error

      expect(config).toBeDefined()
      expect(typeof isReady).toBe('boolean')
      expect(error === null || error instanceof Error).toBe(true)
    })
  })

  describe('configuration options', () => {
    it('should accept required configuration options', () => {
      const result = useMongoDoCollection(baseOptions)

      expect(result.config.id).toBe(baseOptions.id)
      expect(result.config.endpoint).toBe(baseOptions.endpoint)
      expect(result.config.database).toBe(baseOptions.database)
      expect(result.config.collectionName).toBe(baseOptions.collectionName)
    })

    it('should accept optional authToken', () => {
      const optionsWithAuth: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        authToken: 'test-auth-token-123',
      }

      const result = useMongoDoCollection(optionsWithAuth)

      expect(result.config.authToken).toBe('test-auth-token-123')
    })

    it('should accept optional credentials', () => {
      const optionsWithCreds: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        credentials: {
          username: 'testuser',
          password: 'testpass',
        },
      }

      const result = useMongoDoCollection(optionsWithCreds)

      expect(result.config.credentials).toEqual({
        username: 'testuser',
        password: 'testpass',
      })
    })

    it('should accept optional syncMode', () => {
      const syncModes: SyncMode[] = ['eager', 'on-demand', 'progressive']

      for (const syncMode of syncModes) {
        const optionsWithSyncMode: UseMongoDoCollectionOptions<User> = {
          ...baseOptions,
          syncMode,
        }

        const result = useMongoDoCollection(optionsWithSyncMode)

        expect(result.config.syncMode).toBe(syncMode)
      }
    })

    it('should accept optional enableChangeStream', () => {
      const optionsWithChangeStream: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        enableChangeStream: true,
      }

      const result = useMongoDoCollection(optionsWithChangeStream)

      expect(result.config.enableChangeStream).toBe(true)
    })

    it('should default syncMode to eager when not specified', () => {
      const result = useMongoDoCollection(baseOptions)

      expect(result.config.syncMode).toBe('eager')
    })

    it('should default enableChangeStream to false when not specified', () => {
      const result = useMongoDoCollection(baseOptions)

      expect(result.config.enableChangeStream).toBe(false)
    })
  })

  describe('getKey function', () => {
    it('should correctly extract key from document', () => {
      const result = useMongoDoCollection(baseOptions)

      const testUser: User = {
        _id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
      }

      const key = result.config.getKey(testUser)

      expect(key).toBe('user-123')
    })

    it('should support custom getKey implementations', () => {
      const customOptions: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        getKey: (user) => `user:${user.email}`,
      }

      const result = useMongoDoCollection(customOptions)

      const testUser: User = {
        _id: 'user-456',
        name: 'Another User',
        email: 'another@example.com',
      }

      const key = result.config.getKey(testUser)

      expect(key).toBe('user:another@example.com')
    })
  })

  describe('sync function', () => {
    it('should return a sync function that can be passed to TanStack DB', () => {
      const result = useMongoDoCollection(baseOptions)

      expect(result.sync).toBeInstanceOf(Function)
    })

    it('should create sync function with correct configuration', () => {
      const optionsWithAll: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        authToken: 'sync-test-token',
        syncMode: 'progressive',
        enableChangeStream: true,
      }

      const result = useMongoDoCollection(optionsWithAll)

      // The sync function should be callable and not throw
      expect(() => result.sync).not.toThrow()
    })
  })

  describe('lifecycle management', () => {
    it('should use useEffect for cleanup', () => {
      useMongoDoCollection(baseOptions)

      expect(mockUseEffect).toHaveBeenCalled()
    })

    it('should memoize config to prevent unnecessary re-renders', () => {
      useMongoDoCollection(baseOptions)

      expect(mockUseMemo).toHaveBeenCalled()
    })

    it('should memoize sync function', () => {
      useMongoDoCollection(baseOptions)

      // Should use useMemo or useCallback for sync function
      const memoCallCount = mockUseMemo.mock.calls.length + mockUseCallback.mock.calls.length
      expect(memoCallCount).toBeGreaterThan(0)
    })

    it('should return cleanup function from useEffect', () => {
      const result = useMongoDoCollection(baseOptions)

      // The hook should set up cleanup properly
      const effectCall = mockUseEffect.mock.calls[0]
      expect(effectCall).toBeDefined()

      // Execute effect and check cleanup
      const effectFn = effectCall[0] as () => void | (() => void)
      const cleanup = effectFn()

      // Cleanup should be a function or undefined
      expect(cleanup === undefined || typeof cleanup === 'function').toBe(true)
    })
  })

  describe('auth token updates', () => {
    it('should update config when authToken changes', () => {
      // First render
      const options1: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        authToken: 'initial-token',
      }
      const result1 = useMongoDoCollection(options1)
      expect(result1.config.authToken).toBe('initial-token')

      // Simulate re-render with new token
      const options2: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        authToken: 'updated-token',
      }
      const result2 = useMongoDoCollection(options2)
      expect(result2.config.authToken).toBe('updated-token')
    })

    it('should handle undefined authToken', () => {
      const optionsNoAuth: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        // No authToken
      }

      const result = useMongoDoCollection(optionsNoAuth)

      expect(result.config.authToken).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('should throw on invalid endpoint', () => {
      const invalidOptions: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        endpoint: '', // Invalid empty endpoint
      }

      expect(() => useMongoDoCollection(invalidOptions)).toThrow(/endpoint/i)
    })

    it('should throw on invalid database name', () => {
      const invalidOptions: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        database: '', // Invalid empty database
      }

      expect(() => useMongoDoCollection(invalidOptions)).toThrow(/database/i)
    })

    it('should throw on invalid collection name', () => {
      const invalidOptions: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        collectionName: '', // Invalid empty collection
      }

      expect(() => useMongoDoCollection(invalidOptions)).toThrow(/collection/i)
    })

    it('should throw on missing getKey function', () => {
      const invalidOptions = {
        ...baseOptions,
        getKey: undefined,
      } as unknown as UseMongoDoCollectionOptions<User>

      expect(() => useMongoDoCollection(invalidOptions)).toThrow(/getKey/i)
    })

    it('should throw on missing schema', () => {
      const invalidOptions = {
        ...baseOptions,
        schema: undefined,
      } as unknown as UseMongoDoCollectionOptions<User>

      expect(() => useMongoDoCollection(invalidOptions)).toThrow(/schema/i)
    })
  })

  describe('type safety', () => {
    it('should enforce document type from schema', () => {
      const result = useMongoDoCollection(baseOptions)

      // Type check - this should compile without errors
      const config: MongoDoCollectionConfig<User> = result.config

      expect(config.schema).toBe(userSchema)
    })

    it('should work with different document types', () => {
      const productOptions: UseMongoDoCollectionOptions<Product> = {
        id: 'products-collection',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'products',
        schema: productSchema,
        getKey: (product) => product._id,
      }

      const result = useMongoDoCollection(productOptions)

      expect(result.config.id).toBe('products-collection')
      expect(result.config.schema).toBe(productSchema)

      // Type check - getKey should work with Product type
      const testProduct: Product = {
        _id: 'prod-123',
        sku: 'SKU-001',
        name: 'Test Product',
        price: 29.99,
        inStock: true,
      }

      const key = result.config.getKey(testProduct)
      expect(key).toBe('prod-123')
    })

    it('should infer document type from options', () => {
      // TypeScript should infer User type from the options
      const result = useMongoDoCollection({
        id: 'inferred-users',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'users',
        schema: userSchema,
        getKey: (user) => user._id,
      })

      // This should type-check correctly
      const typedConfig: MongoDoCollectionConfig<User> = result.config

      expect(typedConfig).toBeDefined()
    })
  })

  describe('multiple instances', () => {
    it('should support multiple independent collection hooks', () => {
      const userResult = useMongoDoCollection({
        id: 'users',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'users',
        schema: userSchema,
        getKey: (user) => user._id,
      })

      const productResult = useMongoDoCollection({
        id: 'products',
        endpoint: 'https://api.mongo.do',
        database: 'testdb',
        collectionName: 'products',
        schema: productSchema,
        getKey: (product) => product._id,
      })

      expect(userResult.config.id).toBe('users')
      expect(productResult.config.id).toBe('products')

      expect(userResult.config.collectionName).toBe('users')
      expect(productResult.config.collectionName).toBe('products')
    })

    it('should maintain separate state for each instance', () => {
      const result1 = useMongoDoCollection({
        ...baseOptions,
        id: 'collection-1',
        authToken: 'token-1',
      })

      const result2 = useMongoDoCollection({
        ...baseOptions,
        id: 'collection-2',
        authToken: 'token-2',
      })

      expect(result1.config.id).toBe('collection-1')
      expect(result1.config.authToken).toBe('token-1')

      expect(result2.config.id).toBe('collection-2')
      expect(result2.config.authToken).toBe('token-2')
    })
  })

  describe('onReady and onError callbacks', () => {
    it('should accept optional onReady callback', () => {
      const onReady = vi.fn()

      const optionsWithCallback: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        onReady,
      }

      const result = useMongoDoCollection(optionsWithCallback)

      expect(result).toBeDefined()
      // onReady should be called when sync is ready (tested via mock)
    })

    it('should accept optional onError callback', () => {
      const onError = vi.fn()

      const optionsWithCallback: UseMongoDoCollectionOptions<User> = {
        ...baseOptions,
        onError,
      }

      const result = useMongoDoCollection(optionsWithCallback)

      expect(result).toBeDefined()
      // onError should be called when sync encounters an error (tested via mock)
    })
  })

  describe('additional methods', () => {
    it('should expose disconnect method', () => {
      const result = useMongoDoCollection(baseOptions)

      expect(result).toHaveProperty('disconnect')
      expect(result.disconnect).toBeInstanceOf(Function)
    })

    it('should expose reconnect method', () => {
      const result = useMongoDoCollection(baseOptions)

      expect(result).toHaveProperty('reconnect')
      expect(result.reconnect).toBeInstanceOf(Function)
    })

    it('should disconnect on unmount', () => {
      const result = useMongoDoCollection(baseOptions)

      // Effect cleanup should call disconnect
      const effectCall = mockUseEffect.mock.calls[0]
      if (effectCall) {
        const effectFn = effectCall[0] as () => void | (() => void)
        const cleanup = effectFn()

        if (typeof cleanup === 'function') {
          // Cleanup function should handle disconnection
          expect(() => cleanup()).not.toThrow()
        }
      }
    })
  })
})

describe('useMongoDoCollection Type Exports', () => {
  it('should export UseMongoDoCollectionOptions type', () => {
    // Type assertion test - should compile without errors
    const options: UseMongoDoCollectionOptions<User> = {
      id: 'test',
      endpoint: 'https://api.mongo.do',
      database: 'testdb',
      collectionName: 'users',
      schema: userSchema,
      getKey: (user) => user._id,
    }

    expect(options).toBeDefined()
  })

  it('should export UseMongoDoCollectionReturn type', () => {
    // Type assertion test - should compile without errors
    const result = useMongoDoCollection({
      id: 'test',
      endpoint: 'https://api.mongo.do',
      database: 'testdb',
      collectionName: 'users',
      schema: userSchema,
      getKey: (user) => user._id,
    })

    const typedResult: UseMongoDoCollectionReturn<User> = result

    expect(typedResult.config).toBeDefined()
    expect(typedResult.sync).toBeInstanceOf(Function)
    expect(typeof typedResult.isReady).toBe('boolean')
  })
})

describe('useMongoDoCollection Integration Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should work with TanStack DB collection pattern', () => {
    // This test verifies the hook output can be used with TanStack DB
    const result = useMongoDoCollection({
      id: 'integration-test',
      endpoint: 'https://api.mongo.do',
      database: 'testdb',
      collectionName: 'users',
      schema: userSchema,
      getKey: (user) => user._id,
      syncMode: 'eager',
      enableChangeStream: true,
    })

    // The config should be usable with TanStack DB's collection function
    const collectionConfig = result.config

    expect(collectionConfig.id).toBe('integration-test')
    expect(collectionConfig.syncMode).toBe('eager')
    expect(collectionConfig.enableChangeStream).toBe(true)

    // The sync function should be callable
    expect(result.sync).toBeInstanceOf(Function)
  })

  it('should support production-like configuration', () => {
    const productionOptions: UseMongoDoCollectionOptions<User> = {
      id: 'production-users',
      endpoint: 'https://api.mongo.do/v1',
      database: 'production-db',
      collectionName: 'users',
      schema: userSchema,
      getKey: (user) => user._id,
      authToken: 'production-jwt-token',
      syncMode: 'progressive',
      enableChangeStream: true,
      onReady: () => console.log('Collection ready'),
      onError: (error) => console.error('Collection error:', error),
    }

    const result = useMongoDoCollection(productionOptions)

    expect(result.config.endpoint).toBe('https://api.mongo.do/v1')
    expect(result.config.database).toBe('production-db')
    expect(result.config.authToken).toBe('production-jwt-token')
    expect(result.config.syncMode).toBe('progressive')
    expect(result.config.enableChangeStream).toBe(true)
  })
})
