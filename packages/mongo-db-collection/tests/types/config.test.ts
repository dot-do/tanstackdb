/**
 * Type tests for MongoDoCollectionConfig
 *
 * These tests verify:
 * 1. MongoDoCollectionConfig<T> interface exists with required and optional properties
 * 2. Type inference works correctly (generic T flows through)
 * 3. Optional vs required fields are correct
 *
 * RED PHASE: These tests will fail until the types are implemented
 */

import { describe, it, expectTypeOf } from 'vitest'
import type { ZodSchema } from 'zod'
import type { MongoDoCollectionConfig } from '../../src/types'

// Sample types for testing generic inference
interface User {
  _id: string
  name: string
  email: string
  createdAt: Date
}

interface Product {
  _id: string
  sku: string
  title: string
  price: number
}

describe('MongoDoCollectionConfig Types', () => {
  describe('Interface Structure', () => {
    it('should have required "id" property as string', () => {
      expectTypeOf<MongoDoCollectionConfig<User>>().toHaveProperty('id')
      expectTypeOf<MongoDoCollectionConfig<User>['id']>().toBeString()
    })

    it('should have required "endpoint" property as string', () => {
      expectTypeOf<MongoDoCollectionConfig<User>>().toHaveProperty('endpoint')
      expectTypeOf<MongoDoCollectionConfig<User>['endpoint']>().toBeString()
    })

    it('should have required "database" property as string', () => {
      expectTypeOf<MongoDoCollectionConfig<User>>().toHaveProperty('database')
      expectTypeOf<MongoDoCollectionConfig<User>['database']>().toBeString()
    })

    it('should have required "collectionName" property as string', () => {
      expectTypeOf<MongoDoCollectionConfig<User>>().toHaveProperty('collectionName')
      expectTypeOf<MongoDoCollectionConfig<User>['collectionName']>().toBeString()
    })

    it('should have required "schema" property as ZodSchema<T>', () => {
      expectTypeOf<MongoDoCollectionConfig<User>>().toHaveProperty('schema')
      expectTypeOf<MongoDoCollectionConfig<User>['schema']>().toMatchTypeOf<ZodSchema<User>>()
    })

    it('should have required "getKey" property as function (item: T) => string', () => {
      expectTypeOf<MongoDoCollectionConfig<User>>().toHaveProperty('getKey')
      expectTypeOf<MongoDoCollectionConfig<User>['getKey']>().toBeFunction()
      expectTypeOf<MongoDoCollectionConfig<User>['getKey']>().parameter(0).toMatchTypeOf<User>()
      expectTypeOf<MongoDoCollectionConfig<User>['getKey']>().returns.toBeString()
    })
  })

  describe('Optional Properties', () => {
    it('should have optional "authToken" property as string', () => {
      expectTypeOf<MongoDoCollectionConfig<User>>().toHaveProperty('authToken')
      // authToken should be optional (string | undefined)
      expectTypeOf<MongoDoCollectionConfig<User>['authToken']>().toEqualTypeOf<string | undefined>()
    })

    it('should have optional "credentials" property with username and password', () => {
      expectTypeOf<MongoDoCollectionConfig<User>>().toHaveProperty('credentials')
      // credentials should be optional
      type Credentials = MongoDoCollectionConfig<User>['credentials']
      expectTypeOf<Credentials>().toEqualTypeOf<{ username: string; password: string } | undefined>()
    })

    it('should have optional "syncMode" property with specific literal types', () => {
      expectTypeOf<MongoDoCollectionConfig<User>>().toHaveProperty('syncMode')
      type SyncMode = MongoDoCollectionConfig<User>['syncMode']
      expectTypeOf<SyncMode>().toEqualTypeOf<'eager' | 'on-demand' | 'progressive' | undefined>()
    })

    it('should have optional "enableChangeStream" property as boolean', () => {
      expectTypeOf<MongoDoCollectionConfig<User>>().toHaveProperty('enableChangeStream')
      type ChangeStream = MongoDoCollectionConfig<User>['enableChangeStream']
      expectTypeOf<ChangeStream>().toEqualTypeOf<boolean | undefined>()
    })
  })

  describe('Generic Type Inference', () => {
    it('should correctly infer T in schema property', () => {
      // User config should have User schema
      expectTypeOf<MongoDoCollectionConfig<User>['schema']>().toMatchTypeOf<ZodSchema<User>>()
      // Product config should have Product schema
      expectTypeOf<MongoDoCollectionConfig<Product>['schema']>().toMatchTypeOf<ZodSchema<Product>>()
    })

    it('should correctly infer T in getKey function parameter', () => {
      // User config getKey should accept User
      expectTypeOf<MongoDoCollectionConfig<User>['getKey']>().parameter(0).toMatchTypeOf<User>()
      // Product config getKey should accept Product
      expectTypeOf<MongoDoCollectionConfig<Product>['getKey']>().parameter(0).toMatchTypeOf<Product>()
    })

    it('should not allow mismatched types between generic and schema', () => {
      // This tests that the generic flows through properly
      type UserConfig = MongoDoCollectionConfig<User>
      type ProductConfig = MongoDoCollectionConfig<Product>

      // These should be different types
      expectTypeOf<UserConfig['schema']>().not.toEqualTypeOf<ProductConfig['schema']>()
      expectTypeOf<UserConfig['getKey']>().not.toEqualTypeOf<ProductConfig['getKey']>()
    })
  })

  describe('Required vs Optional Field Enforcement', () => {
    it('should require all mandatory fields', () => {
      // Create a type that only has the required fields
      type RequiredKeys = {
        [K in keyof MongoDoCollectionConfig<User>]-?: undefined extends MongoDoCollectionConfig<User>[K]
          ? never
          : K
      }[keyof MongoDoCollectionConfig<User>]

      // The required keys should include these exact fields
      expectTypeOf<RequiredKeys>().toEqualTypeOf<'id' | 'endpoint' | 'database' | 'collectionName' | 'schema' | 'getKey'>()
    })

    it('should have exactly 4 optional fields', () => {
      // Create a type that only has the optional fields
      type OptionalKeys = {
        [K in keyof MongoDoCollectionConfig<User>]-?: undefined extends MongoDoCollectionConfig<User>[K]
          ? K
          : never
      }[keyof MongoDoCollectionConfig<User>]

      // The optional keys should include these exact fields
      expectTypeOf<OptionalKeys>().toEqualTypeOf<'authToken' | 'credentials' | 'syncMode' | 'enableChangeStream'>()
    })
  })

  describe('Config Object Assignability', () => {
    it('should accept a valid complete configuration', () => {
      // This would be a valid config object with all properties
      const validConfig = {
        id: 'users-collection',
        endpoint: 'https://mongo.do/api',
        database: 'myapp',
        collectionName: 'users',
        schema: {} as ZodSchema<User>,
        getKey: (user: User) => user._id,
        authToken: 'token123',
        credentials: { username: 'admin', password: 'secret' },
        syncMode: 'eager' as const,
        enableChangeStream: true,
      }

      expectTypeOf(validConfig).toMatchTypeOf<MongoDoCollectionConfig<User>>()
    })

    it('should accept a minimal configuration with only required fields', () => {
      const minimalConfig = {
        id: 'users-collection',
        endpoint: 'https://mongo.do/api',
        database: 'myapp',
        collectionName: 'users',
        schema: {} as ZodSchema<User>,
        getKey: (user: User) => user._id,
      }

      expectTypeOf(minimalConfig).toMatchTypeOf<MongoDoCollectionConfig<User>>()
    })

    it('should reject config with wrong getKey parameter type', () => {
      const wrongGetKey = {
        id: 'users-collection',
        endpoint: 'https://mongo.do/api',
        database: 'myapp',
        collectionName: 'users',
        schema: {} as ZodSchema<User>,
        getKey: (product: Product) => product.sku, // Wrong type!
      }

      // @ts-expect-error - getKey parameter should be User, not Product
      expectTypeOf(wrongGetKey).toMatchTypeOf<MongoDoCollectionConfig<User>>()
    })

    it('should reject invalid syncMode values', () => {
      type ValidSyncModes = NonNullable<MongoDoCollectionConfig<User>['syncMode']>

      // Valid modes
      expectTypeOf<'eager'>().toMatchTypeOf<ValidSyncModes>()
      expectTypeOf<'on-demand'>().toMatchTypeOf<ValidSyncModes>()
      expectTypeOf<'progressive'>().toMatchTypeOf<ValidSyncModes>()

      // Invalid modes should not match
      expectTypeOf<'invalid'>().not.toMatchTypeOf<ValidSyncModes>()
      expectTypeOf<'lazy'>().not.toMatchTypeOf<ValidSyncModes>()
    })
  })
})
