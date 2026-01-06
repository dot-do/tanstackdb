/**
 * @file Config Merging Tests - Layer 13 Factory/Options (RED Phase - TDD)
 *
 * These tests verify the config merging functionality that combines
 * default, global, and instance-level configurations.
 *
 * Config Merging is responsible for:
 * 1. Providing sensible default configuration values
 * 2. Allowing global configuration to override defaults
 * 3. Allowing instance-level configuration to override global and defaults
 * 4. Properly merging nested configuration objects
 * 5. Type-safe configuration handling
 * 6. Validation of merged configurations
 *
 * RED PHASE: These tests will fail until the config merging is implemented
 * Bead ID: po0.165
 *
 * @module tests/factory/config-merging
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

// =============================================================================
// Test Setup - Import Types and Functions
// =============================================================================

import {
  mergeConfig,
  setGlobalConfig,
  getGlobalConfig,
  resetGlobalConfig,
  getDefaultConfig,
  createConfiguredCollection,
  setEnvironmentConfig,
  resetEnvironmentConfig,
  resetAllEnvironmentConfigs,
  type CollectionConfig,
  type GlobalConfig,
  type DefaultConfig,
  type MergedConfig,
  type MergeOptions,
} from '../../src/factory/config-merging'

// Test document type
interface TestDocument {
  _id: string
  name: string
  value: number
}

const testSchema = z.object({
  _id: z.string(),
  name: z.string(),
  value: z.number(),
})

// =============================================================================
// Default Configuration Tests
// =============================================================================

describe('Config Merging - Default Configuration', () => {
  describe('getDefaultConfig', () => {
    it('should return default configuration with sensible values', () => {
      const defaults = getDefaultConfig()

      expect(defaults).toBeDefined()
      expect(defaults.syncMode).toBe('eager')
      expect(defaults.enableChangeStream).toBe(false)
    })

    it('should include default retry configuration', () => {
      const defaults = getDefaultConfig()

      expect(defaults.retry).toBeDefined()
      expect(defaults.retry?.maxRetries).toBe(3)
      expect(defaults.retry?.retryDelayMs).toBe(1000)
      expect(defaults.retry?.backoffMultiplier).toBe(2)
    })

    it('should include default batch configuration', () => {
      const defaults = getDefaultConfig()

      expect(defaults.batch).toBeDefined()
      expect(defaults.batch?.batchSize).toBe(100)
      expect(defaults.batch?.batchTimeoutMs).toBe(50)
    })

    it('should include default timeout configuration', () => {
      const defaults = getDefaultConfig()

      expect(defaults.timeout).toBeDefined()
      expect(defaults.timeout?.connectionTimeoutMs).toBe(10000)
      expect(defaults.timeout?.requestTimeoutMs).toBe(30000)
    })

    it('should return a frozen object to prevent modification', () => {
      const defaults = getDefaultConfig()

      expect(Object.isFrozen(defaults)).toBe(true)
      expect(() => {
        ;(defaults as any).syncMode = 'on-demand'
      }).toThrow()
    })

    it('should return the same instance on multiple calls', () => {
      const defaults1 = getDefaultConfig()
      const defaults2 = getDefaultConfig()

      expect(defaults1).toBe(defaults2)
    })
  })
})

// =============================================================================
// Global Configuration Tests
// =============================================================================

describe('Config Merging - Global Configuration', () => {
  afterEach(() => {
    resetGlobalConfig()
  })

  describe('setGlobalConfig', () => {
    it('should set global configuration', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
        syncMode: 'progressive',
      })

      const global = getGlobalConfig()
      expect(global.endpoint).toBe('https://global.mongo.do/api')
      expect(global.syncMode).toBe('progressive')
    })

    it('should allow partial global configuration', () => {
      setGlobalConfig({
        enableChangeStream: true,
      })

      const global = getGlobalConfig()
      expect(global.enableChangeStream).toBe(true)
      expect(global.endpoint).toBeUndefined()
    })

    it('should merge with existing global configuration', () => {
      setGlobalConfig({
        endpoint: 'https://first.mongo.do/api',
      })

      setGlobalConfig({
        database: 'my-database',
      })

      const global = getGlobalConfig()
      expect(global.endpoint).toBe('https://first.mongo.do/api')
      expect(global.database).toBe('my-database')
    })

    it('should allow overwriting existing global values', () => {
      setGlobalConfig({
        endpoint: 'https://old.mongo.do/api',
      })

      setGlobalConfig({
        endpoint: 'https://new.mongo.do/api',
      })

      const global = getGlobalConfig()
      expect(global.endpoint).toBe('https://new.mongo.do/api')
    })

    it('should accept nested configuration objects', () => {
      setGlobalConfig({
        retry: {
          maxRetries: 5,
        },
      })

      const global = getGlobalConfig()
      expect(global.retry?.maxRetries).toBe(5)
    })

    it('should validate global configuration values', () => {
      expect(() => {
        setGlobalConfig({
          syncMode: 'invalid-mode' as any,
        })
      }).toThrow(/invalid.*sync.*mode/i)
    })
  })

  describe('getGlobalConfig', () => {
    it('should return empty object when no global config is set', () => {
      const global = getGlobalConfig()

      expect(global).toBeDefined()
      expect(Object.keys(global)).toHaveLength(0)
    })

    it('should return a copy to prevent external modification', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
      })

      const global = getGlobalConfig()
      ;(global as any).endpoint = 'https://modified.mongo.do/api'

      const globalAgain = getGlobalConfig()
      expect(globalAgain.endpoint).toBe('https://global.mongo.do/api')
    })
  })

  describe('resetGlobalConfig', () => {
    it('should reset all global configuration', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
        database: 'test-db',
        syncMode: 'on-demand',
      })

      resetGlobalConfig()

      const global = getGlobalConfig()
      expect(Object.keys(global)).toHaveLength(0)
    })

    it('should allow setting new global config after reset', () => {
      setGlobalConfig({ endpoint: 'https://old.mongo.do/api' })
      resetGlobalConfig()
      setGlobalConfig({ endpoint: 'https://new.mongo.do/api' })

      const global = getGlobalConfig()
      expect(global.endpoint).toBe('https://new.mongo.do/api')
    })
  })
})

// =============================================================================
// Config Merging Tests
// =============================================================================

describe('Config Merging - mergeConfig Function', () => {
  afterEach(() => {
    resetGlobalConfig()
  })

  describe('Basic merging', () => {
    it('should merge instance config with defaults', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged = mergeConfig(instanceConfig)

      // Instance values should be present
      expect(merged.id).toBe('test-collection')
      expect(merged.endpoint).toBe('https://instance.mongo.do/api')

      // Default values should be present
      expect(merged.syncMode).toBe('eager')
      expect(merged.enableChangeStream).toBe(false)
    })

    it('should merge instance config with global and defaults', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
        syncMode: 'progressive',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged = mergeConfig(instanceConfig)

      // Instance should inherit global endpoint
      expect(merged.endpoint).toBe('https://global.mongo.do/api')
      // Instance should inherit global syncMode
      expect(merged.syncMode).toBe('progressive')
    })

    it('should prioritize instance over global over defaults', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
        syncMode: 'progressive',
        enableChangeStream: true,
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api', // Should override global
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        // syncMode not specified - should use global
        // enableChangeStream not specified - should use global
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.endpoint).toBe('https://instance.mongo.do/api') // Instance
      expect(merged.syncMode).toBe('progressive') // Global
      expect(merged.enableChangeStream).toBe(true) // Global
    })
  })

  describe('Nested object merging', () => {
    it('should deep merge nested retry configuration', () => {
      setGlobalConfig({
        retry: {
          maxRetries: 5,
        },
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        retry: {
          retryDelayMs: 2000,
        },
      }

      const merged = mergeConfig(instanceConfig)

      // Should have global maxRetries
      expect(merged.retry?.maxRetries).toBe(5)
      // Should have instance retryDelayMs
      expect(merged.retry?.retryDelayMs).toBe(2000)
      // Should have default backoffMultiplier
      expect(merged.retry?.backoffMultiplier).toBe(2)
    })

    it('should deep merge nested batch configuration', () => {
      setGlobalConfig({
        batch: {
          batchSize: 200,
        },
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        batch: {
          batchTimeoutMs: 100,
        },
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.batch?.batchSize).toBe(200) // Global
      expect(merged.batch?.batchTimeoutMs).toBe(100) // Instance
    })

    it('should deep merge nested timeout configuration', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        timeout: {
          connectionTimeoutMs: 5000,
        },
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.timeout?.connectionTimeoutMs).toBe(5000) // Instance
      expect(merged.timeout?.requestTimeoutMs).toBe(30000) // Default
    })

    it('should allow instance to completely override nested objects when specified', () => {
      setGlobalConfig({
        retry: {
          maxRetries: 5,
          retryDelayMs: 500,
        },
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        retry: {
          maxRetries: 1,
          retryDelayMs: 100,
          backoffMultiplier: 1,
        },
      }

      const merged = mergeConfig(instanceConfig)

      // All should be from instance since all keys provided
      expect(merged.retry?.maxRetries).toBe(1)
      expect(merged.retry?.retryDelayMs).toBe(100)
      expect(merged.retry?.backoffMultiplier).toBe(1)
    })
  })

  describe('Credentials and authentication merging', () => {
    it('should use instance authToken over global', () => {
      setGlobalConfig({
        authToken: 'global-token',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        authToken: 'instance-token',
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.authToken).toBe('instance-token')
    })

    it('should fall back to global authToken when instance not provided', () => {
      setGlobalConfig({
        authToken: 'global-token',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.authToken).toBe('global-token')
    })

    it('should use instance credentials over global', () => {
      setGlobalConfig({
        credentials: {
          username: 'global-user',
          password: 'global-pass',
        },
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        credentials: {
          username: 'instance-user',
          password: 'instance-pass',
        },
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.credentials?.username).toBe('instance-user')
      expect(merged.credentials?.password).toBe('instance-pass')
    })

    it('should not partially merge credentials (all or nothing)', () => {
      setGlobalConfig({
        credentials: {
          username: 'global-user',
          password: 'global-pass',
        },
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        // No credentials - should use full global credentials
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.credentials?.username).toBe('global-user')
      expect(merged.credentials?.password).toBe('global-pass')
    })
  })

  describe('Required fields validation', () => {
    it('should require id field', () => {
      const instanceConfig = {
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc: TestDocument) => doc._id,
      } as CollectionConfig<TestDocument>

      expect(() => mergeConfig(instanceConfig)).toThrow(/id.*required/i)
    })

    it('should require endpoint from any source', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      expect(() => mergeConfig(instanceConfig)).toThrow(/endpoint.*required/i)
    })

    it('should accept endpoint from global config', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged = mergeConfig(instanceConfig)
      expect(merged.endpoint).toBe('https://global.mongo.do/api')
    })

    it('should require database from any source', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      expect(() => mergeConfig(instanceConfig)).toThrow(/database.*required/i)
    })

    it('should accept database from global config', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
        database: 'global-db',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged = mergeConfig(instanceConfig)
      expect(merged.database).toBe('global-db')
    })

    it('should require collectionName at instance level', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
        database: 'global-db',
      })

      const instanceConfig = {
        id: 'test-collection',
        schema: testSchema,
        getKey: (doc: TestDocument) => doc._id,
      } as CollectionConfig<TestDocument>

      expect(() => mergeConfig(instanceConfig)).toThrow(/collectionName.*required/i)
    })

    it('should require schema at instance level', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
        database: 'global-db',
      })

      const instanceConfig = {
        id: 'test-collection',
        collectionName: 'items',
        getKey: (doc: TestDocument) => doc._id,
      } as CollectionConfig<TestDocument>

      expect(() => mergeConfig(instanceConfig)).toThrow(/schema.*required/i)
    })

    it('should require getKey at instance level', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
        database: 'global-db',
      })

      const instanceConfig = {
        id: 'test-collection',
        collectionName: 'items',
        schema: testSchema,
      } as CollectionConfig<TestDocument>

      expect(() => mergeConfig(instanceConfig)).toThrow(/getKey.*required/i)
    })
  })

  describe('Type preservation', () => {
    it('should preserve schema type in merged config', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged = mergeConfig(instanceConfig)

      // Type check - schema should be correctly typed
      expect(merged.schema).toBe(testSchema)
    })

    it('should preserve getKey function in merged config', () => {
      const getKeyFn = (doc: TestDocument) => doc._id

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: getKeyFn,
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.getKey).toBe(getKeyFn)
      expect(merged.getKey({ _id: 'test-123', name: 'Test', value: 42 })).toBe('test-123')
    })

    it('should return MergedConfig type with all required fields', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
        database: 'global-db',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged: MergedConfig<TestDocument> = mergeConfig(instanceConfig)

      // These should all be defined (not optional) in MergedConfig
      expect(merged.id).toBeDefined()
      expect(merged.endpoint).toBeDefined()
      expect(merged.database).toBeDefined()
      expect(merged.collectionName).toBeDefined()
      expect(merged.schema).toBeDefined()
      expect(merged.getKey).toBeDefined()
      expect(merged.syncMode).toBeDefined()
      expect(merged.enableChangeStream).toBeDefined()
    })
  })
})

// =============================================================================
// createConfiguredCollection Tests
// =============================================================================

describe('Config Merging - createConfiguredCollection', () => {
  afterEach(() => {
    resetGlobalConfig()
  })

  it('should create a configured collection with merged config', () => {
    setGlobalConfig({
      endpoint: 'https://global.mongo.do/api',
    })

    const collection = createConfiguredCollection<TestDocument>({
      id: 'users',
      database: 'test-db',
      collectionName: 'users',
      schema: testSchema,
      getKey: (doc) => doc._id,
    })

    expect(collection).toBeDefined()
    expect(collection.config.id).toBe('users')
    expect(collection.config.endpoint).toBe('https://global.mongo.do/api')
    expect(collection.config.syncMode).toBe('eager') // Default
  })

  it('should expose the merged configuration', () => {
    const collection = createConfiguredCollection<TestDocument>({
      id: 'products',
      endpoint: 'https://instance.mongo.do/api',
      database: 'test-db',
      collectionName: 'products',
      schema: testSchema,
      getKey: (doc) => doc._id,
      syncMode: 'on-demand',
    })

    expect(collection.config.syncMode).toBe('on-demand')
    expect(collection.config.enableChangeStream).toBe(false) // Default
  })

  it('should freeze the merged configuration to prevent modification', () => {
    const collection = createConfiguredCollection<TestDocument>({
      id: 'items',
      endpoint: 'https://instance.mongo.do/api',
      database: 'test-db',
      collectionName: 'items',
      schema: testSchema,
      getKey: (doc) => doc._id,
    })

    expect(Object.isFrozen(collection.config)).toBe(true)
  })

  it('should allow multiple collections with different configurations', () => {
    setGlobalConfig({
      endpoint: 'https://global.mongo.do/api',
      database: 'shared-db',
    })

    const usersCollection = createConfiguredCollection<TestDocument>({
      id: 'users',
      collectionName: 'users',
      schema: testSchema,
      getKey: (doc) => doc._id,
      syncMode: 'eager',
    })

    const logsCollection = createConfiguredCollection<TestDocument>({
      id: 'logs',
      collectionName: 'logs',
      schema: testSchema,
      getKey: (doc) => doc._id,
      syncMode: 'on-demand',
    })

    expect(usersCollection.config.syncMode).toBe('eager')
    expect(logsCollection.config.syncMode).toBe('on-demand')

    // Both should share global config
    expect(usersCollection.config.endpoint).toBe('https://global.mongo.do/api')
    expect(logsCollection.config.endpoint).toBe('https://global.mongo.do/api')
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Config Merging - Edge Cases', () => {
  afterEach(() => {
    resetGlobalConfig()
  })

  describe('Undefined and null handling', () => {
    it('should ignore undefined values in instance config', () => {
      setGlobalConfig({
        syncMode: 'progressive',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        syncMode: undefined, // Should not override global
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.syncMode).toBe('progressive')
    })

    it('should allow explicit false values', () => {
      setGlobalConfig({
        enableChangeStream: true,
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        enableChangeStream: false, // Should override global
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.enableChangeStream).toBe(false)
    })

    it('should allow explicit zero values', () => {
      setGlobalConfig({
        retry: {
          maxRetries: 5,
        },
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        retry: {
          maxRetries: 0, // Should override global
        },
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.retry?.maxRetries).toBe(0)
    })

    it('should allow empty string values', () => {
      setGlobalConfig({
        authToken: 'global-token',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        authToken: '', // Empty string should override
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.authToken).toBe('')
    })
  })

  describe('Array handling', () => {
    it('should replace arrays entirely by default (replace strategy)', () => {
      setGlobalConfig({
        allowedOrigins: ['https://global1.com', 'https://global2.com'],
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        allowedOrigins: ['https://instance1.com'],
      }

      const merged = mergeConfig(instanceConfig)

      // Array should be replaced entirely, not merged
      expect(merged.allowedOrigins).toEqual(['https://instance1.com'])
      expect(merged.allowedOrigins).toHaveLength(1)
    })

    it('should use global arrays when instance does not provide array', () => {
      setGlobalConfig({
        allowedOrigins: ['https://global1.com', 'https://global2.com'],
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        // No allowedOrigins provided
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.allowedOrigins).toEqual(['https://global1.com', 'https://global2.com'])
    })

    it('should use default arrays when neither global nor instance provide array', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged = mergeConfig(instanceConfig)

      // Should use default empty array or undefined based on implementation
      expect(merged.allowedOrigins === undefined || Array.isArray(merged.allowedOrigins)).toBe(true)
    })

    it('should allow empty array to override non-empty global array', () => {
      setGlobalConfig({
        allowedOrigins: ['https://global1.com', 'https://global2.com'],
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        allowedOrigins: [], // Explicitly empty array
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.allowedOrigins).toEqual([])
    })

    it('should support merge strategy option for arrays when specified', () => {
      setGlobalConfig({
        allowedOrigins: ['https://global1.com', 'https://global2.com'],
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        allowedOrigins: ['https://instance1.com'],
      }

      // With merge strategy, arrays should be concatenated
      const merged = mergeConfig(instanceConfig, { arrayStrategy: 'merge' })

      expect(merged.allowedOrigins).toContain('https://global1.com')
      expect(merged.allowedOrigins).toContain('https://global2.com')
      expect(merged.allowedOrigins).toContain('https://instance1.com')
      expect(merged.allowedOrigins).toHaveLength(3)
    })

    it('should deduplicate arrays when using merge strategy with dedup option', () => {
      setGlobalConfig({
        allowedOrigins: ['https://shared.com', 'https://global.com'],
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        allowedOrigins: ['https://shared.com', 'https://instance.com'], // shared.com is duplicate
      }

      const merged = mergeConfig(instanceConfig, { arrayStrategy: 'merge', deduplicateArrays: true })

      expect(merged.allowedOrigins).toContain('https://shared.com')
      expect(merged.allowedOrigins).toContain('https://global.com')
      expect(merged.allowedOrigins).toContain('https://instance.com')
      // Should only have 3 unique items
      expect(merged.allowedOrigins).toHaveLength(3)
    })

    it('should handle nested arrays in configuration objects', () => {
      setGlobalConfig({
        hooks: {
          events: ['connect', 'disconnect'],
        },
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        hooks: {
          events: ['sync', 'error'],
        },
      }

      const merged = mergeConfig(instanceConfig)

      // Nested arrays should also be replaced by default
      expect(merged.hooks?.events).toEqual(['sync', 'error'])
    })
  })

  describe('Validation of merged config', () => {
    it('should validate syncMode in final merged config', () => {
      setGlobalConfig({
        syncMode: 'invalid' as any, // Invalid value set globally
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      expect(() => mergeConfig(instanceConfig)).toThrow(/invalid.*sync.*mode/i)
    })

    it('should validate numeric values are positive where required', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        retry: {
          retryDelayMs: -100, // Invalid negative value
        },
      }

      expect(() => mergeConfig(instanceConfig)).toThrow(/retryDelayMs/i)
    })

    it('should validate endpoint is a valid URL format', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'not-a-url',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      expect(() => mergeConfig(instanceConfig)).toThrow(/endpoint.*url/i)
    })
  })

  describe('Immutability', () => {
    it('should not modify the original instance config', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const originalId = instanceConfig.id

      mergeConfig(instanceConfig)

      expect(instanceConfig.id).toBe(originalId)
      expect(instanceConfig.syncMode).toBeUndefined() // Should not have been added
    })

    it('should not allow modifying merged config values', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged = mergeConfig(instanceConfig)

      expect(() => {
        ;(merged as any).id = 'modified'
      }).toThrow()
    })
  })
})

// =============================================================================
// Performance Tests
// =============================================================================

describe('Config Merging - Performance', () => {
  afterEach(() => {
    resetGlobalConfig()
  })

  it('should merge configs quickly', () => {
    setGlobalConfig({
      endpoint: 'https://global.mongo.do/api',
      database: 'perf-db',
      syncMode: 'progressive',
      retry: { maxRetries: 5 },
    })

    const instanceConfig: CollectionConfig<TestDocument> = {
      id: 'perf-test',
      collectionName: 'items',
      schema: testSchema,
      getKey: (doc) => doc._id,
      batch: { batchSize: 50 },
    }

    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      mergeConfig(instanceConfig)
    }
    const duration = performance.now() - start

    // 10000 merges should complete in under 100ms
    expect(duration).toBeLessThan(100)
  })

  it('should not leak memory on repeated global config changes', () => {
    for (let i = 0; i < 1000; i++) {
      setGlobalConfig({
        endpoint: `https://endpoint-${i}.mongo.do/api`,
      })
    }

    const global = getGlobalConfig()
    expect(global.endpoint).toBe('https://endpoint-999.mongo.do/api')
  })
})

// =============================================================================
// Environment-Specific Config Overrides Tests
// =============================================================================

describe('Config Merging - Environment-Specific Overrides', () => {
  afterEach(() => {
    resetGlobalConfig()
  })

  describe('Environment detection', () => {
    it('should support environment-specific configuration via setEnvironmentConfig', () => {
      setEnvironmentConfig('development', {
        endpoint: 'https://dev.mongo.do/api',
        enableChangeStream: false,
      })

      setEnvironmentConfig('production', {
        endpoint: 'https://prod.mongo.do/api',
        enableChangeStream: true,
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      // When environment is 'development'
      const devMerged = mergeConfig(instanceConfig, { environment: 'development' })
      expect(devMerged.endpoint).toBe('https://dev.mongo.do/api')
      expect(devMerged.enableChangeStream).toBe(false)

      // When environment is 'production'
      const prodMerged = mergeConfig(instanceConfig, { environment: 'production' })
      expect(prodMerged.endpoint).toBe('https://prod.mongo.do/api')
      expect(prodMerged.enableChangeStream).toBe(true)
    })

    it('should fall back to global config when environment not specified', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
      })

      setEnvironmentConfig('development', {
        endpoint: 'https://dev.mongo.do/api',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      // Without environment option, should use global
      const merged = mergeConfig(instanceConfig)
      expect(merged.endpoint).toBe('https://global.mongo.do/api')
    })

    it('should prioritize: instance > environment > global > defaults', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
        syncMode: 'eager',
        enableChangeStream: false,
      })

      setEnvironmentConfig('staging', {
        endpoint: 'https://staging.mongo.do/api',
        syncMode: 'progressive',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api', // Should win
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        // syncMode not specified - should use environment
        // enableChangeStream not specified - should use global
      }

      const merged = mergeConfig(instanceConfig, { environment: 'staging' })

      expect(merged.endpoint).toBe('https://instance.mongo.do/api') // Instance wins
      expect(merged.syncMode).toBe('progressive') // Environment wins
      expect(merged.enableChangeStream).toBe(false) // Global wins
    })
  })

  describe('Environment-specific nested configs', () => {
    it('should deep merge environment-specific nested configurations', () => {
      setEnvironmentConfig('production', {
        retry: {
          maxRetries: 5,
          retryDelayMs: 2000,
        },
        timeout: {
          connectionTimeoutMs: 5000,
        },
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        retry: {
          backoffMultiplier: 3,
        },
      }

      const merged = mergeConfig(instanceConfig, { environment: 'production' })

      // Environment + instance merged
      expect(merged.retry?.maxRetries).toBe(5)
      expect(merged.retry?.retryDelayMs).toBe(2000)
      expect(merged.retry?.backoffMultiplier).toBe(3)
      expect(merged.timeout?.connectionTimeoutMs).toBe(5000)
    })
  })

  describe('Environment config reset', () => {
    it('should reset specific environment configuration', () => {
      setEnvironmentConfig('development', {
        endpoint: 'https://dev.mongo.do/api',
      })

      resetEnvironmentConfig('development')

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://fallback.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged = mergeConfig(instanceConfig, { environment: 'development' })

      // Should use instance since env config was reset
      expect(merged.endpoint).toBe('https://fallback.mongo.do/api')
    })

    it('should reset all environment configurations', () => {
      setEnvironmentConfig('development', { endpoint: 'https://dev.mongo.do/api' })
      setEnvironmentConfig('staging', { endpoint: 'https://staging.mongo.do/api' })
      setEnvironmentConfig('production', { endpoint: 'https://prod.mongo.do/api' })

      resetAllEnvironmentConfigs()

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const devMerged = mergeConfig(instanceConfig, { environment: 'development' })
      const prodMerged = mergeConfig(instanceConfig, { environment: 'production' })

      expect(devMerged.endpoint).toBe('https://instance.mongo.do/api')
      expect(prodMerged.endpoint).toBe('https://instance.mongo.do/api')
    })
  })

  describe('Custom environment names', () => {
    it('should support custom environment names', () => {
      setEnvironmentConfig('feature-branch-123', {
        endpoint: 'https://feature-123.mongo.do/api',
        database: 'feature-123-db',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged = mergeConfig(instanceConfig, { environment: 'feature-branch-123' })

      expect(merged.endpoint).toBe('https://feature-123.mongo.do/api')
      expect(merged.database).toBe('feature-123-db')
    })

    it('should handle unknown environment gracefully', () => {
      setGlobalConfig({
        endpoint: 'https://global.mongo.do/api',
        database: 'global-db',
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      // Environment that was never configured
      const merged = mergeConfig(instanceConfig, { environment: 'nonexistent-env' })

      // Should fall back to global
      expect(merged.endpoint).toBe('https://global.mongo.do/api')
      expect(merged.database).toBe('global-db')
    })
  })

  describe('Environment config validation', () => {
    it('should validate environment-specific config values', () => {
      expect(() => {
        setEnvironmentConfig('production', {
          syncMode: 'invalid-mode' as any,
        })
      }).toThrow(/invalid.*sync.*mode/i)
    })

    it('should validate merged config with environment values', () => {
      setEnvironmentConfig('production', {
        retry: {
          retryDelayMs: -500, // Invalid negative value
        },
      })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test-collection',
        endpoint: 'https://instance.mongo.do/api',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      expect(() => mergeConfig(instanceConfig, { environment: 'production' })).toThrow(/retryDelayMs/i)
    })
  })
})

// =============================================================================
// Advanced Type Safety Tests
// =============================================================================

describe('Config Merging - Type Safety', () => {
  afterEach(() => {
    resetGlobalConfig()
  })

  describe('Generic type preservation', () => {
    it('should preserve document type through merging', () => {
      interface User {
        _id: string
        name: string
        email: string
      }

      const userSchema = z.object({
        _id: z.string(),
        name: z.string(),
        email: z.string().email(),
      })

      const instanceConfig: CollectionConfig<User> = {
        id: 'users',
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collectionName: 'users',
        schema: userSchema,
        getKey: (user) => user._id, // Type-safe: user is typed as User
      }

      const merged: MergedConfig<User> = mergeConfig(instanceConfig)

      // getKey should accept User type
      const user: User = { _id: '123', name: 'John', email: 'john@example.com' }
      expect(merged.getKey(user)).toBe('123')
    })

    it('should enforce type compatibility for schema and getKey', () => {
      interface Product {
        _id: string
        sku: string
        price: number
      }

      const productSchema = z.object({
        _id: z.string(),
        sku: z.string(),
        price: z.number(),
      })

      const instanceConfig: CollectionConfig<Product> = {
        id: 'products',
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collectionName: 'products',
        schema: productSchema,
        getKey: (product) => product.sku, // Can use any field that returns string
      }

      const merged = mergeConfig(instanceConfig)

      const product: Product = { _id: 'p1', sku: 'ABC-123', price: 99.99 }
      expect(merged.getKey(product)).toBe('ABC-123')
    })
  })

  describe('Type inference for merged config', () => {
    it('should infer correct types for optional fields after merge', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test',
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged = mergeConfig(instanceConfig)

      // These fields should be defined after merge (from defaults)
      expect(typeof merged.syncMode).toBe('string')
      expect(typeof merged.enableChangeStream).toBe('boolean')

      // Required fields should be string/function
      expect(typeof merged.id).toBe('string')
      expect(typeof merged.endpoint).toBe('string')
      expect(typeof merged.getKey).toBe('function')
    })

    it('should properly type nested configuration objects', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test',
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        retry: {
          maxRetries: 5,
        },
      }

      const merged = mergeConfig(instanceConfig)

      // Nested retry config should be properly typed
      if (merged.retry) {
        expect(typeof merged.retry.maxRetries).toBe('number')
        expect(merged.retry.retryDelayMs === undefined || typeof merged.retry.retryDelayMs === 'number').toBe(true)
      }
    })
  })

  describe('Strict type checking', () => {
    it('should reject invalid syncMode values at runtime', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test',
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        syncMode: 'invalid' as any, // Cast to bypass TS check
      }

      expect(() => mergeConfig(instanceConfig)).toThrow()
    })

    it('should reject invalid conflictStrategy values at runtime', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test',
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        conflictStrategy: 'invalid-strategy' as any,
      }

      expect(() => mergeConfig(instanceConfig)).toThrow(/invalid.*conflict.*strategy/i)
    })
  })

  describe('ReadOnly and immutable types', () => {
    it('should return a deeply frozen configuration', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test',
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        retry: {
          maxRetries: 3,
        },
      }

      const merged = mergeConfig(instanceConfig)

      // Top level should be frozen
      expect(Object.isFrozen(merged)).toBe(true)

      // Nested objects should also be frozen
      if (merged.retry) {
        expect(Object.isFrozen(merged.retry)).toBe(true)
      }
    })

    it('should throw when attempting to modify merged config', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test',
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
      }

      const merged = mergeConfig(instanceConfig)

      expect(() => {
        ;(merged as any).id = 'modified'
      }).toThrow()

      expect(() => {
        ;(merged as any).newField = 'value'
      }).toThrow()
    })
  })

  describe('Discriminated union types', () => {
    it('should handle conflictStrategy with required resolver for custom', () => {
      const customResolver = (context: any) => ({ resolved: context.serverVersion })

      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test',
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        conflictStrategy: 'custom',
        conflictResolver: customResolver,
      }

      const merged = mergeConfig(instanceConfig)

      expect(merged.conflictStrategy).toBe('custom')
      expect(merged.conflictResolver).toBeDefined()
    })

    it('should throw if custom strategy without resolver', () => {
      const instanceConfig: CollectionConfig<TestDocument> = {
        id: 'test',
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collectionName: 'items',
        schema: testSchema,
        getKey: (doc) => doc._id,
        conflictStrategy: 'custom',
        // Missing conflictResolver
      }

      expect(() => mergeConfig(instanceConfig)).toThrow(/conflictResolver.*required.*custom/i)
    })
  })
})
