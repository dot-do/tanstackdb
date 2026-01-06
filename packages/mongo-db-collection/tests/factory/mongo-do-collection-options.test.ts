/**
 * MongoDoCollectionOptions Factory Tests - TDD (RED Phase)
 *
 * Comprehensive tests for the factory function that creates TanStack DB
 * collection options configured for mongo.do sync.
 *
 * Bead ID: tanstackdb-po0.151 (RED tests)
 *
 * @module @tanstack/mongo-db-collection/tests/factory/mongo-do-collection-options
 */

import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import { z } from 'zod'
import type { ZodSchema } from 'zod'
import type {
  MongoDoCollectionConfig,
  SyncMode,
  ConflictStrategy,
} from '../../src/types'

// Import factory functions - these will fail until implemented
import {
  createMongoDoCollectionOptions,
  validateCollectionConfig,
  mergeWithDefaults,
  type MongoDoCollectionOptionsConfig,
  type MongoDoCollectionOptionsResult,
  type CollectionConfigValidationError,
  type CollectionConfigDefaults,
} from '../../src/factory/mongo-do-collection-options'

// =============================================================================
// Test Types and Schemas
// =============================================================================

const userSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
})

type User = z.infer<typeof userSchema>

const productSchema = z.object({
  _id: z.string(),
  sku: z.string(),
  title: z.string(),
  price: z.number().positive(),
  inStock: z.boolean(),
  category: z.string(),
  tags: z.array(z.string()).optional(),
})

type Product = z.infer<typeof productSchema>

const orderSchema = z.object({
  _id: z.string(),
  orderId: z.string(),
  userId: z.string(),
  items: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number(),
      price: z.number(),
    })
  ),
  total: z.number(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered']),
  createdAt: z.date(),
  updatedAt: z.date(),
})

type Order = z.infer<typeof orderSchema>

// =============================================================================
// 1. Basic Factory Creation Tests
// =============================================================================

describe('Basic Factory Creation', () => {
  describe('createMongoDoCollectionOptions function', () => {
    it('should export createMongoDoCollectionOptions function', () => {
      expect(createMongoDoCollectionOptions).toBeDefined()
      expect(typeof createMongoDoCollectionOptions).toBe('function')
    })

    it('should create options with minimal config (collection name only)', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options).toBeDefined()
      expect(options.collectionName).toBe('users')
    })

    it('should create options with full config', () => {
      const options = createMongoDoCollectionOptions<User>({
        id: 'users-collection',
        endpoint: 'https://api.mongo.do',
        database: 'myapp',
        collectionName: 'users',
        schema: userSchema,
        getKey: (user) => user._id,
        authToken: 'my-secret-token',
        syncMode: 'eager',
        enableChangeStream: true,
      })

      expect(options).toBeDefined()
      expect(options.id).toBe('users-collection')
      expect(options.endpoint).toBe('https://api.mongo.do')
      expect(options.database).toBe('myapp')
      expect(options.collectionName).toBe('users')
      expect(options.authToken).toBe('my-secret-token')
      expect(options.syncMode).toBe('eager')
      expect(options.enableChangeStream).toBe(true)
    })

    it('should return valid TanStack DB CollectionOptions shape', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        schema: userSchema,
        getKey: (user) => user._id,
      })

      // Validate required TanStack DB CollectionOptions properties
      expect(options).toHaveProperty('id')
      expect(options).toHaveProperty('schema')
      expect(options).toHaveProperty('getKey')
      expect(typeof options.getKey).toBe('function')
    })

    it('should create type-safe options preserving document type', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        schema: userSchema,
        getKey: (user) => user._id,
      })

      expectTypeOf(options).toMatchTypeOf<MongoDoCollectionOptionsResult<User>>()
    })

    it('should create independent option instances', () => {
      const options1 = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })
      const options2 = createMongoDoCollectionOptions<Product>({
        collectionName: 'products',
      })

      expect(options1).not.toBe(options2)
      expect(options1.collectionName).not.toBe(options2.collectionName)
    })
  })
})

// =============================================================================
// 2. Required Configuration Tests
// =============================================================================

describe('Required Configuration', () => {
  describe('Collection Name', () => {
    it('should require collection name', () => {
      expect(() => {
        // @ts-expect-error - collectionName should be required
        createMongoDoCollectionOptions<User>({})
      }).toThrow()
    })

    it('should accept valid collection name', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.collectionName).toBe('users')
    })

    it('should accept collection name with special characters', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users_v2.archive',
      })

      expect(options.collectionName).toBe('users_v2.archive')
    })

    it('should accept collection name with namespace', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'myapp.users',
      })

      expect(options.collectionName).toBe('myapp.users')
    })
  })

  describe('API Endpoint Configuration', () => {
    it('should accept endpoint URL', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        endpoint: 'https://api.mongo.do',
      })

      expect(options.endpoint).toBe('https://api.mongo.do')
    })

    it('should accept endpoint with custom path', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        endpoint: 'https://custom.mongo.do/api/v2',
      })

      expect(options.endpoint).toBe('https://custom.mongo.do/api/v2')
    })

    it('should use default endpoint when not provided', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.endpoint).toBeDefined()
      expect(typeof options.endpoint).toBe('string')
    })

    it('should accept endpoint with trailing slash', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        endpoint: 'https://api.mongo.do/',
      })

      // Should normalize or accept trailing slash
      expect(options.endpoint).toBeDefined()
    })
  })

  describe('Authentication Configuration', () => {
    it('should accept authToken', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        authToken: 'my-secret-token',
      })

      expect(options.authToken).toBe('my-secret-token')
    })

    it('should accept credentials with username and password', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        credentials: {
          username: 'admin',
          password: 'secret123',
        },
      })

      expect(options.credentials).toEqual({
        username: 'admin',
        password: 'secret123',
      })
    })

    it('should accept API key authentication', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        apiKey: 'api-key-12345',
      })

      expect(options.apiKey).toBe('api-key-12345')
    })

    it('should allow no authentication for anonymous access', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.authToken).toBeUndefined()
      expect(options.credentials).toBeUndefined()
      expect(options.apiKey).toBeUndefined()
    })

    it('should accept JWT token as authToken', () => {
      const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        authToken: jwtToken,
      })

      expect(options.authToken).toBe(jwtToken)
    })
  })

  describe('Database Configuration', () => {
    it('should accept database name', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        database: 'myapp',
      })

      expect(options.database).toBe('myapp')
    })

    it('should use default database when not provided', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.database).toBeDefined()
    })

    it('should accept database with environment suffix', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        database: 'myapp-production',
      })

      expect(options.database).toBe('myapp-production')
    })
  })
})

// =============================================================================
// 3. Sync Configuration Tests
// =============================================================================

describe('Sync Configuration', () => {
  describe('Real-time Sync', () => {
    it('should enable real-time sync with enableChangeStream', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        enableChangeStream: true,
      })

      expect(options.enableChangeStream).toBe(true)
    })

    it('should disable real-time sync when enableChangeStream is false', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        enableChangeStream: false,
      })

      expect(options.enableChangeStream).toBe(false)
    })

    it('should default to disabled change stream when not specified', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.enableChangeStream).toBe(false)
    })

    it('should enable realtime option', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        realtime: true,
      })

      expect(options.realtime).toBe(true)
    })
  })

  describe('Sync Interval', () => {
    it('should set sync interval in milliseconds', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        syncInterval: 5000,
      })

      expect(options.syncInterval).toBe(5000)
    })

    it('should accept zero sync interval for immediate sync', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        syncInterval: 0,
      })

      expect(options.syncInterval).toBe(0)
    })

    it('should use default sync interval when not specified', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.syncInterval).toBeDefined()
      expect(typeof options.syncInterval).toBe('number')
    })

    it('should accept large sync interval for infrequent sync', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        syncInterval: 60000, // 1 minute
      })

      expect(options.syncInterval).toBe(60000)
    })
  })

  describe('Batch Size', () => {
    it('should configure batch size for sync operations', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        batchSize: 100,
      })

      expect(options.batchSize).toBe(100)
    })

    it('should accept small batch size for low-bandwidth scenarios', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        batchSize: 10,
      })

      expect(options.batchSize).toBe(10)
    })

    it('should accept large batch size for high-throughput scenarios', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        batchSize: 1000,
      })

      expect(options.batchSize).toBe(1000)
    })

    it('should use default batch size when not specified', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.batchSize).toBeDefined()
      expect(typeof options.batchSize).toBe('number')
    })
  })

  describe('Sync Mode', () => {
    it('should configure eager sync mode', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        syncMode: 'eager',
      })

      expect(options.syncMode).toBe('eager')
    })

    it('should configure on-demand sync mode', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        syncMode: 'on-demand',
      })

      expect(options.syncMode).toBe('on-demand')
    })

    it('should configure progressive sync mode', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        syncMode: 'progressive',
      })

      expect(options.syncMode).toBe('progressive')
    })

    it('should use default sync mode when not specified', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.syncMode).toBeDefined()
    })
  })

  describe('Conflict Resolution Strategy', () => {
    it('should configure last-write-wins strategy', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        conflictStrategy: 'last-write-wins',
      })

      expect(options.conflictStrategy).toBe('last-write-wins')
    })

    it('should configure server-wins strategy', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        conflictStrategy: 'server-wins',
      })

      expect(options.conflictStrategy).toBe('server-wins')
    })

    it('should configure client-wins strategy', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        conflictStrategy: 'client-wins',
      })

      expect(options.conflictStrategy).toBe('client-wins')
    })

    it('should configure custom conflict strategy with resolver', () => {
      const customResolver = vi.fn((context) => ({
        resolved: context.serverVersion,
      }))

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        conflictStrategy: 'custom',
        conflictResolver: customResolver,
      })

      expect(options.conflictStrategy).toBe('custom')
      expect(options.conflictResolver).toBe(customResolver)
    })

    it('should use default conflict strategy when not specified', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.conflictStrategy).toBeDefined()
    })
  })
})

// =============================================================================
// 4. Schema Configuration Tests
// =============================================================================

describe('Schema Configuration', () => {
  describe('Type-safe Document Schema', () => {
    it('should accept Zod schema for document validation', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        schema: userSchema,
      })

      expect(options.schema).toBe(userSchema)
    })

    it('should accept complex nested schema', () => {
      const options = createMongoDoCollectionOptions<Order>({
        collectionName: 'orders',
        schema: orderSchema,
      })

      expect(options.schema).toBe(orderSchema)
    })

    it('should preserve schema type inference', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        schema: userSchema,
      })

      expectTypeOf(options.schema).toMatchTypeOf<ZodSchema<User>>()
    })

    it('should accept schema with optional fields', () => {
      const schemaWithOptionals = z.object({
        _id: z.string(),
        name: z.string(),
        nickname: z.string().optional(),
        bio: z.string().nullable(),
      })

      type DocWithOptionals = z.infer<typeof schemaWithOptionals>

      const options = createMongoDoCollectionOptions<DocWithOptionals>({
        collectionName: 'users',
        schema: schemaWithOptionals,
      })

      expect(options.schema).toBe(schemaWithOptionals)
    })

    it('should accept schema with union types', () => {
      const schemaWithUnion = z.object({
        _id: z.string(),
        status: z.union([z.literal('active'), z.literal('inactive')]),
      })

      type DocWithUnion = z.infer<typeof schemaWithUnion>

      const options = createMongoDoCollectionOptions<DocWithUnion>({
        collectionName: 'users',
        schema: schemaWithUnion,
      })

      expect(options.schema).toBe(schemaWithUnion)
    })
  })

  describe('ID Field Configuration', () => {
    it('should configure custom ID field', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        idField: '_id',
      })

      expect(options.idField).toBe('_id')
    })

    it('should accept alternative ID field name', () => {
      const customSchema = z.object({
        id: z.string(),
        name: z.string(),
      })

      type CustomDoc = z.infer<typeof customSchema>

      const options = createMongoDoCollectionOptions<CustomDoc>({
        collectionName: 'items',
        schema: customSchema,
        idField: 'id',
      })

      expect(options.idField).toBe('id')
    })

    it('should use default ID field when not specified', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.idField).toBe('_id')
    })

    it('should accept getKey function for custom key extraction', () => {
      const getKey = (user: User) => user._id

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        getKey,
      })

      expect(options.getKey).toBe(getKey)
    })

    it('should accept composite key extraction', () => {
      const getKey = (user: User) => `${user._id}:${user.email}`

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        getKey,
      })

      const testUser: User = { _id: '123', name: 'John', email: 'john@example.com' }
      expect(options.getKey(testUser)).toBe('123:john@example.com')
    })
  })

  describe('Timestamp Fields', () => {
    it('should configure createdAt field', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        timestamps: {
          createdAt: 'createdAt',
        },
      })

      expect(options.timestamps?.createdAt).toBe('createdAt')
    })

    it('should configure updatedAt field', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        timestamps: {
          updatedAt: 'updatedAt',
        },
      })

      expect(options.timestamps?.updatedAt).toBe('updatedAt')
    })

    it('should configure both timestamp fields', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        timestamps: {
          createdAt: 'createdAt',
          updatedAt: 'updatedAt',
        },
      })

      expect(options.timestamps).toEqual({
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
      })
    })

    it('should enable auto-timestamps', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        timestamps: {
          auto: true,
        },
      })

      expect(options.timestamps?.auto).toBe(true)
    })

    it('should accept custom timestamp field names', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        timestamps: {
          createdAt: 'created_at',
          updatedAt: 'updated_at',
        },
      })

      expect(options.timestamps?.createdAt).toBe('created_at')
      expect(options.timestamps?.updatedAt).toBe('updated_at')
    })

    it('should disable timestamps when not specified', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.timestamps).toBeUndefined()
    })
  })

  describe('Validation Options', () => {
    it('should enable strict validation mode', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        validation: {
          strict: true,
        },
      })

      expect(options.validation?.strict).toBe(true)
    })

    it('should disable validation', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        validation: {
          enabled: false,
        },
      })

      expect(options.validation?.enabled).toBe(false)
    })

    it('should configure validation on read', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        validation: {
          onRead: true,
        },
      })

      expect(options.validation?.onRead).toBe(true)
    })

    it('should configure validation on write', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        validation: {
          onWrite: true,
        },
      })

      expect(options.validation?.onWrite).toBe(true)
    })

    it('should configure custom validation error handler', () => {
      const errorHandler = vi.fn()

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        validation: {
          onError: errorHandler,
        },
      })

      expect(options.validation?.onError).toBe(errorHandler)
    })
  })
})

// =============================================================================
// 5. Transform Configuration Tests
// =============================================================================

describe('Transform Configuration', () => {
  describe('Document Transform on Read', () => {
    it('should configure read transform function', () => {
      const readTransform = vi.fn((doc: unknown) => doc as User)

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        transforms: {
          read: readTransform,
        },
      })

      expect(options.transforms?.read).toBe(readTransform)
    })

    it('should apply read transform to incoming documents', () => {
      const readTransform = (doc: { _id: string; name: string }) => ({
        ...doc,
        name: doc.name.toUpperCase(),
      }) as unknown as User

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        transforms: {
          read: readTransform,
        },
      })

      const result = options.transforms!.read!({ _id: '1', name: 'john' })
      expect(result.name).toBe('JOHN')
    })

    it('should handle null values in read transform', () => {
      const readTransform = vi.fn((doc: unknown) => doc ?? { _id: 'default' } as User)

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        transforms: {
          read: readTransform,
        },
      })

      expect(options.transforms?.read).toBe(readTransform)
    })
  })

  describe('Document Transform on Write', () => {
    it('should configure write transform function', () => {
      const writeTransform = vi.fn((doc: User) => doc)

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        transforms: {
          write: writeTransform,
        },
      })

      expect(options.transforms?.write).toBe(writeTransform)
    })

    it('should apply write transform to outgoing documents', () => {
      const writeTransform = (doc: User) => ({
        ...doc,
        email: doc.email.toLowerCase(),
      })

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        transforms: {
          write: writeTransform,
        },
      })

      const result = options.transforms!.write!({
        _id: '1',
        name: 'John',
        email: 'JOHN@EXAMPLE.COM',
      })
      expect(result.email).toBe('john@example.com')
    })

    it('should support async write transforms', () => {
      const asyncWriteTransform = vi.fn(async (doc: User) => doc)

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        transforms: {
          write: asyncWriteTransform,
        },
      })

      expect(options.transforms?.write).toBe(asyncWriteTransform)
    })
  })

  describe('Field Mapping/Renaming', () => {
    it('should configure field mapping', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        fieldMap: {
          _id: 'id',
          createdAt: 'created_at',
          updatedAt: 'updated_at',
        },
      })

      expect(options.fieldMap).toEqual({
        _id: 'id',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      })
    })

    it('should configure reverse field mapping', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        fieldMap: {
          id: '_id',
        },
        reverseFieldMap: {
          _id: 'id',
        },
      })

      expect(options.reverseFieldMap).toEqual({ _id: 'id' })
    })

    it('should handle nested field mapping', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        fieldMap: {
          'profile.firstName': 'name',
        },
      })

      expect(options.fieldMap).toEqual({ 'profile.firstName': 'name' })
    })
  })

  describe('Type Coercion', () => {
    it('should configure date coercion', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        typeCoercion: {
          dates: true,
        },
      })

      expect(options.typeCoercion?.dates).toBe(true)
    })

    it('should configure ObjectId coercion', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        typeCoercion: {
          objectIds: true,
        },
      })

      expect(options.typeCoercion?.objectIds).toBe(true)
    })

    it('should configure number coercion', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        typeCoercion: {
          numbers: true,
        },
      })

      expect(options.typeCoercion?.numbers).toBe(true)
    })

    it('should configure custom type coercion', () => {
      const customCoercion = vi.fn((value: unknown, type: string) => value)

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        typeCoercion: {
          custom: customCoercion,
        },
      })

      expect(options.typeCoercion?.custom).toBe(customCoercion)
    })

    it('should disable all type coercion', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        typeCoercion: false,
      })

      expect(options.typeCoercion).toBe(false)
    })
  })
})

// =============================================================================
// 6. Error Handling Tests
// =============================================================================

describe('Error Handling', () => {
  describe('Invalid Collection Name', () => {
    it('should throw error for empty collection name', () => {
      expect(() => {
        createMongoDoCollectionOptions<User>({
          collectionName: '',
        })
      }).toThrow(/collection.*name/i)
    })

    it('should throw error for collection name with invalid characters', () => {
      expect(() => {
        createMongoDoCollectionOptions<User>({
          collectionName: 'users$collection',
        })
      }).toThrow(/invalid.*collection.*name/i)
    })

    it('should throw error for collection name starting with system prefix', () => {
      expect(() => {
        createMongoDoCollectionOptions<User>({
          collectionName: 'system.users',
        })
      }).toThrow(/system.*collection/i)
    })

    it('should throw error for collection name exceeding max length', () => {
      const longName = 'a'.repeat(256)
      expect(() => {
        createMongoDoCollectionOptions<User>({
          collectionName: longName,
        })
      }).toThrow(/collection.*name.*length/i)
    })
  })

  describe('Missing Required Fields', () => {
    it('should throw error when getKey is missing and no idField', () => {
      expect(() => {
        createMongoDoCollectionOptions<User>({
          collectionName: 'users',
          schema: userSchema,
          idField: undefined,
          getKey: undefined,
        })
      }).toThrow(/getKey.*idField/i)
    })
  })

  describe('Invalid Option Combinations', () => {
    it('should throw error when both authToken and credentials are provided', () => {
      expect(() => {
        createMongoDoCollectionOptions<User>({
          collectionName: 'users',
          authToken: 'token',
          credentials: { username: 'admin', password: 'secret' },
        })
      }).toThrow(/authToken.*credentials/i)
    })

    it('should throw error when custom strategy is used without resolver', () => {
      expect(() => {
        createMongoDoCollectionOptions<User>({
          collectionName: 'users',
          conflictStrategy: 'custom',
          // conflictResolver not provided
        })
      }).toThrow(/custom.*resolver/i)
    })

    it('should throw error for invalid sync mode value', () => {
      expect(() => {
        createMongoDoCollectionOptions<User>({
          collectionName: 'users',
          // @ts-expect-error - invalid sync mode
          syncMode: 'invalid-mode',
        })
      }).toThrow(/invalid.*sync.*mode/i)
    })

    it('should throw error for invalid conflict strategy value', () => {
      expect(() => {
        createMongoDoCollectionOptions<User>({
          collectionName: 'users',
          // @ts-expect-error - invalid conflict strategy
          conflictStrategy: 'invalid-strategy',
        })
      }).toThrow(/invalid.*conflict.*strategy/i)
    })

    it('should throw error for negative sync interval', () => {
      expect(() => {
        createMongoDoCollectionOptions<User>({
          collectionName: 'users',
          syncInterval: -1000,
        })
      }).toThrow(/sync.*interval.*negative/i)
    })

    it('should throw error for negative batch size', () => {
      expect(() => {
        createMongoDoCollectionOptions<User>({
          collectionName: 'users',
          batchSize: -1,
        })
      }).toThrow(/batch.*size.*negative/i)
    })

    it('should throw error for zero batch size', () => {
      expect(() => {
        createMongoDoCollectionOptions<User>({
          collectionName: 'users',
          batchSize: 0,
        })
      }).toThrow(/batch.*size.*zero/i)
    })
  })
})

// =============================================================================
// 7. Defaults Tests
// =============================================================================

describe('Defaults', () => {
  describe('Sensible Default Values', () => {
    it('should apply default endpoint', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.endpoint).toBe('https://mongo.do/api')
    })

    it('should apply default database', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.database).toBe('default')
    })

    it('should apply default sync mode', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.syncMode).toBe('eager')
    })

    it('should apply default conflict strategy', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.conflictStrategy).toBe('last-write-wins')
    })

    it('should apply default batch size', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.batchSize).toBe(100)
    })

    it('should apply default sync interval', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.syncInterval).toBe(10000)
    })

    it('should apply default ID field', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.idField).toBe('_id')
    })

    it('should apply default enableChangeStream as false', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.enableChangeStream).toBe(false)
    })

    it('should generate default ID from collection name', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
      })

      expect(options.id).toBe('users')
    })
  })

  describe('Override Defaults with Custom Values', () => {
    it('should override default endpoint', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        endpoint: 'https://custom.endpoint.com',
      })

      expect(options.endpoint).toBe('https://custom.endpoint.com')
    })

    it('should override default database', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        database: 'custom-database',
      })

      expect(options.database).toBe('custom-database')
    })

    it('should override default sync mode', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        syncMode: 'progressive',
      })

      expect(options.syncMode).toBe('progressive')
    })

    it('should override default conflict strategy', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        conflictStrategy: 'server-wins',
      })

      expect(options.conflictStrategy).toBe('server-wins')
    })

    it('should override default batch size', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        batchSize: 500,
      })

      expect(options.batchSize).toBe(500)
    })

    it('should override default sync interval', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        syncInterval: 30000,
      })

      expect(options.syncInterval).toBe(30000)
    })

    it('should override default ID', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        id: 'custom-id',
      })

      expect(options.id).toBe('custom-id')
    })

    it('should override all defaults at once', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        id: 'custom-id',
        endpoint: 'https://custom.endpoint.com',
        database: 'custom-database',
        syncMode: 'on-demand',
        conflictStrategy: 'client-wins',
        batchSize: 50,
        syncInterval: 5000,
        enableChangeStream: true,
      })

      expect(options.id).toBe('custom-id')
      expect(options.endpoint).toBe('https://custom.endpoint.com')
      expect(options.database).toBe('custom-database')
      expect(options.syncMode).toBe('on-demand')
      expect(options.conflictStrategy).toBe('client-wins')
      expect(options.batchSize).toBe(50)
      expect(options.syncInterval).toBe(5000)
      expect(options.enableChangeStream).toBe(true)
    })
  })
})

// =============================================================================
// 8. validateCollectionConfig Tests
// =============================================================================

describe('validateCollectionConfig', () => {
  it('should export validateCollectionConfig function', () => {
    expect(validateCollectionConfig).toBeDefined()
    expect(typeof validateCollectionConfig).toBe('function')
  })

  it('should return true for valid config', () => {
    const config = {
      collectionName: 'users',
      endpoint: 'https://mongo.do/api',
      database: 'myapp',
    }

    const result = validateCollectionConfig(config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should return false for invalid config with empty collection name', () => {
    const config = {
      collectionName: '',
    }

    const result = validateCollectionConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'collectionName',
        message: expect.stringMatching(/required|empty/i),
      })
    )
  })

  it('should return multiple errors for multiple invalid fields', () => {
    const config = {
      collectionName: '',
      syncInterval: -1,
      batchSize: 0,
    }

    const result = validateCollectionConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
  })

  it('should validate endpoint URL format', () => {
    const config = {
      collectionName: 'users',
      endpoint: 'not-a-valid-url',
    }

    const result = validateCollectionConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'endpoint',
        message: expect.stringMatching(/url|invalid/i),
      })
    )
  })

  it('should validate sync mode value', () => {
    const config = {
      collectionName: 'users',
      syncMode: 'invalid' as SyncMode,
    }

    const result = validateCollectionConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'syncMode',
      })
    )
  })

  it('should validate conflict strategy value', () => {
    const config = {
      collectionName: 'users',
      conflictStrategy: 'invalid' as ConflictStrategy,
    }

    const result = validateCollectionConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'conflictStrategy',
      })
    )
  })

  it('should return typed validation errors', () => {
    const config = { collectionName: '' }
    const result = validateCollectionConfig(config)

    expectTypeOf(result.errors).toMatchTypeOf<CollectionConfigValidationError[]>()
  })
})

// =============================================================================
// 9. mergeWithDefaults Tests
// =============================================================================

describe('mergeWithDefaults', () => {
  it('should export mergeWithDefaults function', () => {
    expect(mergeWithDefaults).toBeDefined()
    expect(typeof mergeWithDefaults).toBe('function')
  })

  it('should apply defaults to empty config', () => {
    const config = {
      collectionName: 'users',
    }

    const merged = mergeWithDefaults(config)

    expect(merged.endpoint).toBe('https://mongo.do/api')
    expect(merged.database).toBe('default')
    expect(merged.syncMode).toBe('eager')
    expect(merged.batchSize).toBe(100)
    expect(merged.syncInterval).toBe(10000)
  })

  it('should not override provided values', () => {
    const config = {
      collectionName: 'users',
      endpoint: 'https://custom.endpoint.com',
      syncMode: 'progressive' as const,
    }

    const merged = mergeWithDefaults(config)

    expect(merged.endpoint).toBe('https://custom.endpoint.com')
    expect(merged.syncMode).toBe('progressive')
  })

  it('should deeply merge nested objects', () => {
    const config = {
      collectionName: 'users',
      timestamps: {
        createdAt: 'created_at',
      },
    }

    const merged = mergeWithDefaults(config)

    expect(merged.timestamps?.createdAt).toBe('created_at')
  })

  it('should accept custom defaults', () => {
    const config = {
      collectionName: 'users',
    }

    const customDefaults: CollectionConfigDefaults = {
      endpoint: 'https://custom-default.endpoint.com',
      batchSize: 200,
    }

    const merged = mergeWithDefaults(config, customDefaults)

    expect(merged.endpoint).toBe('https://custom-default.endpoint.com')
    expect(merged.batchSize).toBe(200)
  })

  it('should preserve undefined values when explicitly set', () => {
    const config = {
      collectionName: 'users',
      authToken: undefined,
    }

    const merged = mergeWithDefaults(config)

    expect(merged.authToken).toBeUndefined()
  })

  it('should handle null values', () => {
    const config = {
      collectionName: 'users',
      authToken: null as unknown as string,
    }

    const merged = mergeWithDefaults(config)

    // Should either preserve null or apply default
    expect(merged.authToken === null || merged.authToken === undefined).toBe(true)
  })

  it('should return new object without mutating original', () => {
    const config = {
      collectionName: 'users',
    }

    const merged = mergeWithDefaults(config)

    expect(merged).not.toBe(config)
    expect(config).not.toHaveProperty('endpoint')
  })
})

// =============================================================================
// 10. Advanced Configuration Tests
// =============================================================================

describe('Advanced Configuration', () => {
  describe('Retry Configuration', () => {
    it('should configure retry attempts', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        retry: {
          maxAttempts: 5,
        },
      })

      expect(options.retry?.maxAttempts).toBe(5)
    })

    it('should configure retry delay', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        retry: {
          delay: 1000,
        },
      })

      expect(options.retry?.delay).toBe(1000)
    })

    it('should configure exponential backoff', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        retry: {
          exponentialBackoff: true,
          maxDelay: 30000,
        },
      })

      expect(options.retry?.exponentialBackoff).toBe(true)
      expect(options.retry?.maxDelay).toBe(30000)
    })
  })

  describe('Caching Configuration', () => {
    it('should enable caching', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        cache: {
          enabled: true,
        },
      })

      expect(options.cache?.enabled).toBe(true)
    })

    it('should configure cache TTL', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        cache: {
          enabled: true,
          ttl: 60000,
        },
      })

      expect(options.cache?.ttl).toBe(60000)
    })

    it('should configure cache max size', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        cache: {
          enabled: true,
          maxSize: 1000,
        },
      })

      expect(options.cache?.maxSize).toBe(1000)
    })
  })

  describe('Offline Support Configuration', () => {
    it('should enable offline mode', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        offline: {
          enabled: true,
        },
      })

      expect(options.offline?.enabled).toBe(true)
    })

    it('should configure offline storage adapter', () => {
      const storageAdapter = {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
      }

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        offline: {
          enabled: true,
          storage: storageAdapter,
        },
      })

      expect(options.offline?.storage).toBe(storageAdapter)
    })

    it('should configure sync on reconnect', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        offline: {
          enabled: true,
          syncOnReconnect: true,
        },
      })

      expect(options.offline?.syncOnReconnect).toBe(true)
    })
  })

  describe('Hooks Configuration', () => {
    it('should configure beforeSync hook', () => {
      const beforeSync = vi.fn()

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        hooks: {
          beforeSync,
        },
      })

      expect(options.hooks?.beforeSync).toBe(beforeSync)
    })

    it('should configure afterSync hook', () => {
      const afterSync = vi.fn()

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        hooks: {
          afterSync,
        },
      })

      expect(options.hooks?.afterSync).toBe(afterSync)
    })

    it('should configure onError hook', () => {
      const onError = vi.fn()

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        hooks: {
          onError,
        },
      })

      expect(options.hooks?.onError).toBe(onError)
    })

    it('should configure onConflict hook', () => {
      const onConflict = vi.fn()

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        hooks: {
          onConflict,
        },
      })

      expect(options.hooks?.onConflict).toBe(onConflict)
    })
  })

  describe('Logging Configuration', () => {
    it('should configure log level', () => {
      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        logging: {
          level: 'debug',
        },
      })

      expect(options.logging?.level).toBe('debug')
    })

    it('should configure custom logger', () => {
      const customLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }

      const options = createMongoDoCollectionOptions<User>({
        collectionName: 'users',
        logging: {
          logger: customLogger,
        },
      })

      expect(options.logging?.logger).toBe(customLogger)
    })
  })
})

// =============================================================================
// 11. Type Safety Tests
// =============================================================================

describe('Type Safety', () => {
  it('should preserve document type through factory', () => {
    const options = createMongoDoCollectionOptions<User>({
      collectionName: 'users',
      schema: userSchema,
      getKey: (user) => user._id,
    })

    expectTypeOf(options).toMatchTypeOf<MongoDoCollectionOptionsResult<User>>()
  })

  it('should enforce correct schema type', () => {
    const options = createMongoDoCollectionOptions<User>({
      collectionName: 'users',
      schema: userSchema,
    })

    expectTypeOf(options.schema).toMatchTypeOf<ZodSchema<User>>()
  })

  it('should enforce correct getKey function type', () => {
    const getKey = (user: User) => user._id

    const options = createMongoDoCollectionOptions<User>({
      collectionName: 'users',
      getKey,
    })

    expectTypeOf(options.getKey).toMatchTypeOf<(item: User) => string>()
  })

  it('should infer document type from schema', () => {
    const options = createMongoDoCollectionOptions({
      collectionName: 'users',
      schema: userSchema,
      getKey: (user) => user._id,
    })

    // Document type should be inferred from schema
    expectTypeOf(options.getKey).toBeCallableWith({
      _id: 'test',
      name: 'Test',
      email: 'test@example.com',
    })
  })

  it('should type transforms correctly', () => {
    const options = createMongoDoCollectionOptions<User>({
      collectionName: 'users',
      transforms: {
        read: (doc) => doc as User,
        write: (doc) => doc,
      },
    })

    expectTypeOf(options.transforms!.read!).toBeCallableWith({})
    expectTypeOf(options.transforms!.write!).toBeCallableWith({
      _id: '1',
      name: 'Test',
      email: 'test@example.com',
    })
  })
})

// =============================================================================
// 12. Integration Tests
// =============================================================================

describe('Integration with Existing APIs', () => {
  it('should produce config compatible with mongoDoCollectionOptions', async () => {
    const { mongoDoCollectionOptions } = await import('../../src/index')

    const factoryConfig = createMongoDoCollectionOptions<User>({
      collectionName: 'users',
      id: 'users-collection',
      endpoint: 'https://api.mongo.do',
      database: 'myapp',
      schema: userSchema,
      getKey: (user) => user._id,
      syncMode: 'eager',
    })

    // Should be assignable to MongoDoCollectionConfig
    const directConfig = mongoDoCollectionOptions<User>({
      id: factoryConfig.id,
      endpoint: factoryConfig.endpoint,
      database: factoryConfig.database,
      collectionName: factoryConfig.collectionName,
      schema: factoryConfig.schema,
      getKey: factoryConfig.getKey,
      syncMode: factoryConfig.syncMode,
    })

    expect(factoryConfig.id).toBe(directConfig.id)
    expect(factoryConfig.endpoint).toBe(directConfig.endpoint)
    expect(factoryConfig.database).toBe(directConfig.database)
    expect(factoryConfig.collectionName).toBe(directConfig.collectionName)
    expect(factoryConfig.syncMode).toBe(directConfig.syncMode)
  })

  it('should produce config compatible with createMongoDoCollection', async () => {
    const { createMongoDoCollection } = await import('../../src/index')

    const factoryConfig = createMongoDoCollectionOptions<User>({
      collectionName: 'users',
      id: 'users-collection',
      endpoint: 'https://api.mongo.do',
      database: 'myapp',
      schema: userSchema,
      getKey: (user) => user._id,
    })

    const directConfig = createMongoDoCollection<User>({
      id: factoryConfig.id,
      endpoint: factoryConfig.endpoint,
      database: factoryConfig.database,
      collectionName: factoryConfig.collectionName,
      schema: factoryConfig.schema,
      getKey: factoryConfig.getKey,
    })

    expect(factoryConfig.id).toBe(directConfig.id)
    expect(factoryConfig.endpoint).toBe(directConfig.endpoint)
  })
})

// =============================================================================
// 13. Edge Cases Tests
// =============================================================================

describe('Edge Cases', () => {
  it('should handle collection name with unicode characters', () => {
    const options = createMongoDoCollectionOptions<User>({
      collectionName: 'usuarios_espanol',
    })

    expect(options.collectionName).toBe('usuarios_espanol')
  })

  it('should handle very long collection names within limits', () => {
    const longName = 'a'.repeat(120) // MongoDB limit is typically ~120 chars
    const options = createMongoDoCollectionOptions<User>({
      collectionName: longName,
    })

    expect(options.collectionName).toBe(longName)
  })

  it('should handle endpoint with query parameters', () => {
    const options = createMongoDoCollectionOptions<User>({
      collectionName: 'users',
      endpoint: 'https://api.mongo.do?version=2',
    })

    expect(options.endpoint).toBe('https://api.mongo.do?version=2')
  })

  it('should handle endpoint with port number', () => {
    const options = createMongoDoCollectionOptions<User>({
      collectionName: 'users',
      endpoint: 'http://localhost:3000/api',
    })

    expect(options.endpoint).toBe('http://localhost:3000/api')
  })

  it('should handle schema with circular references', () => {
    // This is a complex case - just verify it doesn't crash
    const selfRefSchema: z.ZodSchema<{ _id: string; parent?: { _id: string } }> = z.object({
      _id: z.string(),
      parent: z.lazy(() => selfRefSchema.optional()),
    }) as z.ZodSchema<{ _id: string; parent?: { _id: string } }>

    type SelfRefDoc = z.infer<typeof selfRefSchema>

    const options = createMongoDoCollectionOptions<SelfRefDoc>({
      collectionName: 'nodes',
      schema: selfRefSchema,
    })

    expect(options.schema).toBeDefined()
  })

  it('should handle empty transforms object', () => {
    const options = createMongoDoCollectionOptions<User>({
      collectionName: 'users',
      transforms: {},
    })

    expect(options.transforms).toEqual({})
  })

  it('should handle undefined optional fields', () => {
    const options = createMongoDoCollectionOptions<User>({
      collectionName: 'users',
      authToken: undefined,
      credentials: undefined,
      syncMode: undefined,
    })

    expect(options.collectionName).toBe('users')
  })
})
