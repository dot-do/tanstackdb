/**
 * Options Factory Tests - TDD (RED/GREEN)
 *
 * Tests for the fluent builder pattern for configuring MongoDB collection options.
 * The mongoDoCollectionOptions factory provides a chainable API for building
 * type-safe collection configurations.
 *
 * Bead ID: po0.151 (RED tests)
 *
 * @module @tanstack/mongo-db-collection/tests/factory/options-factory
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import { z } from 'zod'
import type { ZodSchema } from 'zod'
import type { MongoDoCollectionConfig, SyncMode } from '../../src/types'

// Import the factory - this will fail until implemented
import { createOptionsBuilder, type OptionsBuilder } from '../../src/factory/options-factory'

// =============================================================================
// Test Types and Schemas
// =============================================================================

const userSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
  createdAt: z.date().optional(),
})

type User = z.infer<typeof userSchema>

const productSchema = z.object({
  _id: z.string(),
  sku: z.string(),
  title: z.string(),
  price: z.number().positive(),
  inStock: z.boolean(),
})

type Product = z.infer<typeof productSchema>

// =============================================================================
// Factory Creation Tests
// =============================================================================

describe('Options Factory Creation', () => {
  describe('createOptionsBuilder function', () => {
    it('should export createOptionsBuilder function', () => {
      expect(createOptionsBuilder).toBeDefined()
      expect(typeof createOptionsBuilder).toBe('function')
    })

    it('should return an OptionsBuilder instance', () => {
      const builder = createOptionsBuilder<User>()
      expect(builder).toBeDefined()
      expect(typeof builder).toBe('object')
    })

    it('should create independent builder instances', () => {
      const builder1 = createOptionsBuilder<User>()
      const builder2 = createOptionsBuilder<Product>()

      // Should be different instances
      expect(builder1).not.toBe(builder2)
    })
  })
})

// =============================================================================
// Fluent Builder API Tests
// =============================================================================

describe('Fluent Builder API', () => {
  describe('Required Field Methods', () => {
    it('should have id() method that returns builder for chaining', () => {
      const builder = createOptionsBuilder<User>()
      const result = builder.id('users-collection')

      expect(result).toBe(builder)
    })

    it('should have endpoint() method that returns builder for chaining', () => {
      const builder = createOptionsBuilder<User>()
      const result = builder.endpoint('https://api.mongo.do')

      expect(result).toBe(builder)
    })

    it('should have database() method that returns builder for chaining', () => {
      const builder = createOptionsBuilder<User>()
      const result = builder.database('myapp')

      expect(result).toBe(builder)
    })

    it('should have collectionName() method that returns builder for chaining', () => {
      const builder = createOptionsBuilder<User>()
      const result = builder.collectionName('users')

      expect(result).toBe(builder)
    })

    it('should have schema() method that returns builder for chaining', () => {
      const builder = createOptionsBuilder<User>()
      const result = builder.schema(userSchema)

      expect(result).toBe(builder)
    })

    it('should have getKey() method that returns builder for chaining', () => {
      const builder = createOptionsBuilder<User>()
      const result = builder.getKey((user) => user._id)

      expect(result).toBe(builder)
    })
  })

  describe('Optional Field Methods', () => {
    it('should have authToken() method that returns builder for chaining', () => {
      const builder = createOptionsBuilder<User>()
      const result = builder.authToken('my-secret-token')

      expect(result).toBe(builder)
    })

    it('should have credentials() method that returns builder for chaining', () => {
      const builder = createOptionsBuilder<User>()
      const result = builder.credentials({ username: 'admin', password: 'secret' })

      expect(result).toBe(builder)
    })

    it('should have syncMode() method that returns builder for chaining', () => {
      const builder = createOptionsBuilder<User>()
      const result = builder.syncMode('eager')

      expect(result).toBe(builder)
    })

    it('should have enableChangeStream() method that returns builder for chaining', () => {
      const builder = createOptionsBuilder<User>()
      const result = builder.enableChangeStream(true)

      expect(result).toBe(builder)
    })
  })

  describe('Method Chaining', () => {
    it('should allow chaining all methods together', () => {
      const config = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)
        .authToken('my-token')
        .syncMode('eager')
        .enableChangeStream(true)
        .build()

      expect(config).toBeDefined()
    })

    it('should allow methods to be called in any order', () => {
      const config = createOptionsBuilder<User>()
        .syncMode('progressive')
        .database('myapp')
        .id('users-collection')
        .schema(userSchema)
        .enableChangeStream(false)
        .endpoint('https://api.mongo.do')
        .getKey((user) => user._id)
        .collectionName('users')
        .build()

      expect(config).toBeDefined()
    })
  })
})

// =============================================================================
// Build Method Tests
// =============================================================================

describe('Build Method', () => {
  describe('Successful Build', () => {
    it('should build a valid MongoDoCollectionConfig with all required fields', () => {
      const config = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)
        .build()

      expect(config.id).toBe('users-collection')
      expect(config.endpoint).toBe('https://api.mongo.do')
      expect(config.database).toBe('myapp')
      expect(config.collectionName).toBe('users')
      expect(config.schema).toBe(userSchema)
      expect(typeof config.getKey).toBe('function')
    })

    it('should include optional fields when provided', () => {
      const config = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)
        .authToken('token123')
        .credentials({ username: 'admin', password: 'secret' })
        .syncMode('on-demand')
        .enableChangeStream(true)
        .build()

      expect(config.authToken).toBe('token123')
      expect(config.credentials).toEqual({ username: 'admin', password: 'secret' })
      expect(config.syncMode).toBe('on-demand')
      expect(config.enableChangeStream).toBe(true)
    })

    it('should not include optional fields when not provided', () => {
      const config = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)
        .build()

      expect(config.authToken).toBeUndefined()
      expect(config.credentials).toBeUndefined()
      expect(config.syncMode).toBeUndefined()
      expect(config.enableChangeStream).toBeUndefined()
    })

    it('should return a config that matches MongoDoCollectionConfig type', () => {
      const config = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)
        .build()

      // Type assertion to verify type compatibility
      const typed: MongoDoCollectionConfig<User> = config
      expect(typed).toBe(config)
    })
  })

  describe('Build Validation', () => {
    it('should throw error if id is missing', () => {
      const builder = createOptionsBuilder<User>()
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)

      expect(() => builder.build()).toThrow('id is required')
    })

    it('should throw error if endpoint is missing', () => {
      const builder = createOptionsBuilder<User>()
        .id('users-collection')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)

      expect(() => builder.build()).toThrow('endpoint is required')
    })

    it('should throw error if database is missing', () => {
      const builder = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)

      expect(() => builder.build()).toThrow('database is required')
    })

    it('should throw error if collectionName is missing', () => {
      const builder = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .schema(userSchema)
        .getKey((user) => user._id)

      expect(() => builder.build()).toThrow('collectionName is required')
    })

    it('should throw error if schema is missing', () => {
      const builder = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .getKey((user) => user._id)

      expect(() => builder.build()).toThrow('schema is required')
    })

    it('should throw error if getKey is missing', () => {
      const builder = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)

      expect(() => builder.build()).toThrow('getKey is required')
    })

    it('should throw error with all missing required fields listed', () => {
      const builder = createOptionsBuilder<User>()

      expect(() => builder.build()).toThrow()
    })
  })
})

// =============================================================================
// Value Overwriting Tests
// =============================================================================

describe('Value Overwriting', () => {
  it('should allow overwriting id', () => {
    const config = createOptionsBuilder<User>()
      .id('first-id')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)
      .id('second-id')
      .build()

    expect(config.id).toBe('second-id')
  })

  it('should allow overwriting endpoint', () => {
    const config = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://first.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)
      .endpoint('https://second.mongo.do')
      .build()

    expect(config.endpoint).toBe('https://second.mongo.do')
  })

  it('should allow overwriting syncMode', () => {
    const config = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)
      .syncMode('eager')
      .syncMode('progressive')
      .build()

    expect(config.syncMode).toBe('progressive')
  })

  it('should allow overwriting authToken', () => {
    const config = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)
      .authToken('first-token')
      .authToken('second-token')
      .build()

    expect(config.authToken).toBe('second-token')
  })
})

// =============================================================================
// GetKey Function Tests
// =============================================================================

describe('GetKey Function', () => {
  it('should correctly use the provided getKey function', () => {
    const config = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)
      .build()

    const user: User = { _id: 'user-123', name: 'John', email: 'john@example.com' }
    expect(config.getKey(user)).toBe('user-123')
  })

  it('should work with custom key extraction logic', () => {
    const config = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => `user:${user.email}`)
      .build()

    const user: User = { _id: 'user-123', name: 'John', email: 'john@example.com' }
    expect(config.getKey(user)).toBe('user:john@example.com')
  })

  it('should work with composite keys', () => {
    const config = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => `${user._id}:${user.name}`)
      .build()

    const user: User = { _id: 'user-123', name: 'John', email: 'john@example.com' }
    expect(config.getKey(user)).toBe('user-123:John')
  })
})

// =============================================================================
// Clone/Copy Tests
// =============================================================================

describe('Builder Cloning', () => {
  it('should have a clone() method that creates a new builder with same values', () => {
    const original = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .syncMode('eager')

    const cloned = original.clone()

    // Cloned should be a different instance
    expect(cloned).not.toBe(original)
  })

  it('should allow modifying cloned builder without affecting original', () => {
    const original = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)

    const cloned = original.clone()
    cloned.id('different-id')

    const originalConfig = original.build()
    const clonedConfig = cloned.build()

    expect(originalConfig.id).toBe('users-collection')
    expect(clonedConfig.id).toBe('different-id')
  })

  it('should preserve all values in cloned builder', () => {
    const original = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)
      .authToken('my-token')
      .syncMode('progressive')
      .enableChangeStream(true)

    const clonedConfig = original.clone().build()

    expect(clonedConfig.id).toBe('users-collection')
    expect(clonedConfig.endpoint).toBe('https://api.mongo.do')
    expect(clonedConfig.database).toBe('myapp')
    expect(clonedConfig.collectionName).toBe('users')
    expect(clonedConfig.authToken).toBe('my-token')
    expect(clonedConfig.syncMode).toBe('progressive')
    expect(clonedConfig.enableChangeStream).toBe(true)
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('Type Safety', () => {
  it('should preserve document type through the builder', () => {
    const config = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)
      .build()

    // Type check: config should be typed as MongoDoCollectionConfig<User>
    expectTypeOf(config).toMatchTypeOf<MongoDoCollectionConfig<User>>()
  })

  it('should enforce correct schema type', () => {
    const builder = createOptionsBuilder<User>()

    // The schema method should accept ZodSchema<User>
    expectTypeOf(builder.schema).toBeCallableWith(userSchema)
  })

  it('should enforce correct getKey function type', () => {
    const builder = createOptionsBuilder<User>()

    // The getKey method should accept a function (User) => string
    const getKeyFn = (user: User) => user._id
    expectTypeOf(builder.getKey).toBeCallableWith(getKeyFn)
  })

  it('should enforce syncMode literal types', () => {
    const builder = createOptionsBuilder<User>()

    // Valid sync modes
    expectTypeOf(builder.syncMode).toBeCallableWith('eager')
    expectTypeOf(builder.syncMode).toBeCallableWith('on-demand')
    expectTypeOf(builder.syncMode).toBeCallableWith('progressive')
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  it('should handle empty string values', () => {
    const builder = createOptionsBuilder<User>()
      .id('')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)

    // Empty id should be set but may be invalid for business logic
    expect(() => builder.build()).toThrow()
  })

  it('should handle undefined authToken gracefully', () => {
    const config = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)
      .authToken(undefined as unknown as string)
      .build()

    expect(config.authToken).toBeUndefined()
  })

  it('should handle special characters in id', () => {
    const config = createOptionsBuilder<User>()
      .id('users-collection:v2@prod')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)
      .build()

    expect(config.id).toBe('users-collection:v2@prod')
  })

  it('should be reusable - build can be called multiple times', () => {
    const builder = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)

    const config1 = builder.build()
    const config2 = builder.build()

    // Should produce equivalent configs
    expect(config1.id).toBe(config2.id)
    expect(config1.endpoint).toBe(config2.endpoint)

    // But should be different objects
    expect(config1).not.toBe(config2)
  })
})

// =============================================================================
// Integration with Existing APIs
// =============================================================================

describe('Integration with Existing APIs', () => {
  it('should produce config compatible with mongoDoCollectionOptions', async () => {
    // Import the existing function
    const { mongoDoCollectionOptions } = await import('../../src/index')

    const builderConfig = createOptionsBuilder<User>()
      .id('users-collection')
      .endpoint('https://api.mongo.do')
      .database('myapp')
      .collectionName('users')
      .schema(userSchema)
      .getKey((user) => user._id)
      .syncMode('eager')
      .build()

    const directConfig = mongoDoCollectionOptions<User>({
      id: 'users-collection',
      endpoint: 'https://api.mongo.do',
      database: 'myapp',
      collectionName: 'users',
      schema: userSchema,
      getKey: (user) => user._id,
      syncMode: 'eager',
    })

    // Both should have the same structure
    expect(builderConfig.id).toBe(directConfig.id)
    expect(builderConfig.endpoint).toBe(directConfig.endpoint)
    expect(builderConfig.database).toBe(directConfig.database)
    expect(builderConfig.collectionName).toBe(directConfig.collectionName)
    expect(builderConfig.syncMode).toBe(directConfig.syncMode)
  })
})

// =============================================================================
// Convenience Methods Tests
// =============================================================================

describe('Convenience Methods', () => {
  describe('withEagerSync', () => {
    it('should have withEagerSync() convenience method', () => {
      const config = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)
        .withEagerSync()
        .build()

      expect(config.syncMode).toBe('eager')
    })
  })

  describe('withOnDemandSync', () => {
    it('should have withOnDemandSync() convenience method', () => {
      const config = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)
        .withOnDemandSync()
        .build()

      expect(config.syncMode).toBe('on-demand')
    })
  })

  describe('withProgressiveSync', () => {
    it('should have withProgressiveSync() convenience method', () => {
      const config = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)
        .withProgressiveSync()
        .build()

      expect(config.syncMode).toBe('progressive')
    })
  })

  describe('withRealtime', () => {
    it('should have withRealtime() convenience method that enables change stream', () => {
      const config = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)
        .withRealtime()
        .build()

      expect(config.enableChangeStream).toBe(true)
    })
  })

  describe('withAuth', () => {
    it('should have withAuth() convenience method that sets authToken', () => {
      const config = createOptionsBuilder<User>()
        .id('users-collection')
        .endpoint('https://api.mongo.do')
        .database('myapp')
        .collectionName('users')
        .schema(userSchema)
        .getKey((user) => user._id)
        .withAuth('my-token')
        .build()

      expect(config.authToken).toBe('my-token')
    })
  })
})

// =============================================================================
// From Config Tests
// =============================================================================

describe('From Existing Config', () => {
  it('should have fromConfig() static method to create builder from existing config', () => {
    const existingConfig: MongoDoCollectionConfig<User> = {
      id: 'users-collection',
      endpoint: 'https://api.mongo.do',
      database: 'myapp',
      collectionName: 'users',
      schema: userSchema,
      getKey: (user) => user._id,
      syncMode: 'eager',
    }

    const builder = createOptionsBuilder<User>().fromConfig(existingConfig)
    const newConfig = builder.build()

    expect(newConfig.id).toBe('users-collection')
    expect(newConfig.endpoint).toBe('https://api.mongo.do')
    expect(newConfig.database).toBe('myapp')
    expect(newConfig.collectionName).toBe('users')
    expect(newConfig.syncMode).toBe('eager')
  })

  it('should allow modifying values after fromConfig()', () => {
    const existingConfig: MongoDoCollectionConfig<User> = {
      id: 'users-collection',
      endpoint: 'https://api.mongo.do',
      database: 'myapp',
      collectionName: 'users',
      schema: userSchema,
      getKey: (user) => user._id,
      syncMode: 'eager',
    }

    const newConfig = createOptionsBuilder<User>()
      .fromConfig(existingConfig)
      .id('modified-id')
      .syncMode('progressive')
      .build()

    expect(newConfig.id).toBe('modified-id')
    expect(newConfig.syncMode).toBe('progressive')
    // Original values preserved
    expect(newConfig.endpoint).toBe('https://api.mongo.do')
    expect(newConfig.database).toBe('myapp')
  })
})
