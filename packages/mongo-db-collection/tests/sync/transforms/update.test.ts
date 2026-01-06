/**
 * @file Update Event Transform Tests (RED Phase - TDD)
 *
 * These tests verify the transformUpdateEvent function that converts
 * MongoDB update change stream events into TanStack DB ChangeMessage format.
 *
 * Tests cover:
 * 1. Basic transformation of update events to ChangeMessage format
 * 2. Preservation of fullDocument in the value field
 * 3. Extraction of document key for the key field
 * 4. Setting correct change type ('update')
 * 5. Handling updateDescription field (updatedFields, removedFields)
 * 6. Support for generic document types
 * 7. Metadata attachment with source information
 * 8. Edge cases (empty updates, partial documents, nested fields)
 *
 * The transformUpdateEvent function enables TanStack DB to receive
 * real-time update notifications from MongoDB change streams and
 * convert them into a format compatible with the sync protocol.
 *
 * RED PHASE: These tests will fail until transformUpdateEvent is implemented
 * in src/sync/transforms/update.ts
 *
 * @see https://www.mongodb.com/docs/manual/changeStreams/#update-event
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  transformUpdateEvent,
  type UpdateEventTransformOptions,
  type UpdateEventTransformResult,
  type UpdateDescriptionMetadata,
} from '../../../src/sync/transforms/update'
import type { MongoUpdateEvent, ChangeMessage } from '../../../src/types/events'

// Helper type to access updateDescription in metadata with proper typing
type UpdateMetadata<T> = {
  updateDescription?: UpdateDescriptionMetadata<T>
  source?: string
  timestamp?: number
  operationType?: string
  [key: string]: unknown
}

// Sample document types for testing
interface User {
  _id: string
  name: string
  email: string
  age: number
  settings: {
    theme: string
    notifications: boolean
  }
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

interface Product {
  _id: string
  sku: string
  title: string
  price: number
  inventory: number
  category: string
}

describe('transformUpdateEvent', () => {
  describe('basic transformation', () => {
    it('should transform a MongoDB update event to ChangeMessage format', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-123',
          name: 'John Updated',
          email: 'john@example.com',
          age: 31,
          settings: { theme: 'dark', notifications: true },
          tags: ['developer', 'admin'],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-15'),
        },
        documentKey: { _id: 'user-123' },
        updateDescription: {
          updatedFields: { name: 'John Updated', age: 31 },
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent)

      expect(result).toEqual({
        type: 'update',
        key: 'user-123',
        value: updateEvent.fullDocument,
      })
    })

    it('should set type to "update"', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-456',
          name: 'Jane Doe',
          email: 'jane@example.com',
          age: 28,
          settings: { theme: 'light', notifications: false },
          tags: ['designer'],
          createdAt: new Date('2024-02-01'),
          updatedAt: new Date('2024-02-10'),
        },
        documentKey: { _id: 'user-456' },
        updateDescription: {
          updatedFields: { email: 'jane.new@example.com' },
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent)

      expect(result.type).toBe('update')
    })

    it('should extract key from documentKey._id', () => {
      const updateEvent: MongoUpdateEvent<Product> = {
        operationType: 'update',
        fullDocument: {
          _id: 'prod-789',
          sku: 'SKU-001',
          title: 'Widget Pro',
          price: 29.99,
          inventory: 100,
          category: 'electronics',
        },
        documentKey: { _id: 'prod-789' },
        updateDescription: {
          updatedFields: { price: 24.99 },
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent)

      expect(result.key).toBe('prod-789')
    })

    it('should preserve fullDocument in value field', () => {
      const fullDocument: User = {
        _id: 'user-999',
        name: 'Bob Smith',
        email: 'bob@example.com',
        age: 45,
        settings: { theme: 'system', notifications: true },
        tags: ['manager', 'reviewer'],
        createdAt: new Date('2023-06-15'),
        updatedAt: new Date('2024-01-20'),
      }

      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument,
        documentKey: { _id: 'user-999' },
        updateDescription: {
          updatedFields: { age: 45 },
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent)

      expect(result.value).toEqual(fullDocument)
      expect(result.value).toBe(fullDocument) // Should be the same reference
    })
  })

  describe('updateDescription handling', () => {
    it('should include updateDescription in metadata when options.includeUpdateDescription is true', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-123',
          name: 'Updated Name',
          email: 'updated@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: ['updated'],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-15'),
        },
        documentKey: { _id: 'user-123' },
        updateDescription: {
          updatedFields: { name: 'Updated Name', email: 'updated@example.com' },
          removedFields: ['oldField'],
        },
      }

      const result = transformUpdateEvent(updateEvent, { includeUpdateDescription: true })

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.updateDescription).toEqual({
        updatedFields: { name: 'Updated Name', email: 'updated@example.com' },
        removedFields: ['oldField'],
      })
    })

    it('should not include updateDescription by default', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-123',
          name: 'Test User',
          email: 'test@example.com',
          age: 25,
          settings: { theme: 'light', notifications: false },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-123' },
        updateDescription: {
          updatedFields: { name: 'Test User' },
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent)

      expect(result.metadata?.updateDescription).toBeUndefined()
    })

    it('should handle empty updatedFields', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-123',
          name: 'Test',
          email: 'test@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-123' },
        updateDescription: {
          updatedFields: {},
          removedFields: ['deletedField'],
        },
      }

      const result = transformUpdateEvent(updateEvent, { includeUpdateDescription: true })
      const metadata = result.metadata as UpdateMetadata<User>

      expect(metadata?.updateDescription?.updatedFields).toEqual({})
      expect(metadata?.updateDescription?.removedFields).toEqual(['deletedField'])
    })

    it('should handle empty removedFields', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-123',
          name: 'Updated',
          email: 'test@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-123' },
        updateDescription: {
          updatedFields: { name: 'Updated' },
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent, { includeUpdateDescription: true })
      const metadata = result.metadata as UpdateMetadata<User>

      expect(metadata?.updateDescription?.removedFields).toEqual([])
    })

    it('should handle nested field updates in updateDescription', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-123',
          name: 'Test',
          email: 'test@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: false },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-123' },
        updateDescription: {
          updatedFields: { 'settings.theme': 'dark', 'settings.notifications': false } as any,
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent, { includeUpdateDescription: true })
      const metadata = result.metadata as UpdateMetadata<User>

      expect(metadata?.updateDescription?.updatedFields).toEqual({
        'settings.theme': 'dark',
        'settings.notifications': false,
      })
    })
  })

  describe('metadata handling', () => {
    it('should include source metadata when options.includeSource is true', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-123',
          name: 'Test',
          email: 'test@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-123' },
        updateDescription: {
          updatedFields: {},
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent, { includeSource: true })

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.source).toBe('mongodb-change-stream')
    })

    it('should include timestamp in metadata when options.includeTimestamp is true', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-123',
          name: 'Test',
          email: 'test@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-123' },
        updateDescription: {
          updatedFields: {},
          removedFields: [],
        },
      }

      const before = Date.now()
      const result = transformUpdateEvent(updateEvent, { includeTimestamp: true })
      const after = Date.now()

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.timestamp).toBeGreaterThanOrEqual(before)
      expect(result.metadata?.timestamp).toBeLessThanOrEqual(after)
    })

    it('should include operationType in metadata when options.includeOperationType is true', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-123',
          name: 'Test',
          email: 'test@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-123' },
        updateDescription: {
          updatedFields: {},
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent, { includeOperationType: true })

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.operationType).toBe('update')
    })

    it('should combine multiple metadata options', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-123',
          name: 'Test',
          email: 'test@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-123' },
        updateDescription: {
          updatedFields: { name: 'Test' },
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent, {
        includeSource: true,
        includeTimestamp: true,
        includeOperationType: true,
        includeUpdateDescription: true,
      })

      expect(result.metadata?.source).toBe('mongodb-change-stream')
      expect(result.metadata?.timestamp).toBeDefined()
      expect(result.metadata?.operationType).toBe('update')
      expect(result.metadata?.updateDescription).toBeDefined()
    })

    it('should allow custom metadata to be merged', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-123',
          name: 'Test',
          email: 'test@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-123' },
        updateDescription: {
          updatedFields: {},
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent, {
        includeSource: true,
        customMetadata: {
          collectionName: 'users',
          database: 'myapp',
          customField: 'customValue',
        },
      })

      expect(result.metadata?.source).toBe('mongodb-change-stream')
      expect(result.metadata?.collectionName).toBe('users')
      expect(result.metadata?.database).toBe('myapp')
      expect(result.metadata?.customField).toBe('customValue')
    })
  })

  describe('custom key extraction', () => {
    it('should support custom getKey function', () => {
      const updateEvent: MongoUpdateEvent<Product> = {
        operationType: 'update',
        fullDocument: {
          _id: 'prod-123',
          sku: 'SKU-WIDGET-001',
          title: 'Widget',
          price: 19.99,
          inventory: 50,
          category: 'gadgets',
        },
        documentKey: { _id: 'prod-123' },
        updateDescription: {
          updatedFields: { price: 19.99 },
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent, {
        getKey: (doc) => doc.sku,
      })

      expect(result.key).toBe('SKU-WIDGET-001')
    })

    it('should use documentKey._id when getKey is not provided', () => {
      const updateEvent: MongoUpdateEvent<Product> = {
        operationType: 'update',
        fullDocument: {
          _id: 'prod-456',
          sku: 'SKU-002',
          title: 'Gadget',
          price: 29.99,
          inventory: 25,
          category: 'electronics',
        },
        documentKey: { _id: 'prod-456' },
        updateDescription: {
          updatedFields: {},
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent)

      expect(result.key).toBe('prod-456')
    })

    it('should support compound key generation', () => {
      const updateEvent: MongoUpdateEvent<Product> = {
        operationType: 'update',
        fullDocument: {
          _id: 'prod-789',
          sku: 'SKU-003',
          title: 'Super Gadget',
          price: 49.99,
          inventory: 10,
          category: 'premium',
        },
        documentKey: { _id: 'prod-789' },
        updateDescription: {
          updatedFields: {},
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent, {
        getKey: (doc) => `${doc.category}:${doc.sku}`,
      })

      expect(result.key).toBe('premium:SKU-003')
    })
  })

  describe('generic type support', () => {
    it('should preserve document type through transformation', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-typed',
          name: 'Typed User',
          email: 'typed@example.com',
          age: 35,
          settings: { theme: 'dark', notifications: true },
          tags: ['typed'],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-typed' },
        updateDescription: {
          updatedFields: {},
          removedFields: [],
        },
      }

      const result = transformUpdateEvent<User>(updateEvent)

      // Type assertion - this should compile without errors
      const value: User = result.value
      expect(value.name).toBe('Typed User')
      expect(value.email).toBe('typed@example.com')
    })

    it('should work with different document types', () => {
      const productEvent: MongoUpdateEvent<Product> = {
        operationType: 'update',
        fullDocument: {
          _id: 'prod-typed',
          sku: 'SKU-TYPED',
          title: 'Typed Product',
          price: 99.99,
          inventory: 100,
          category: 'typed',
        },
        documentKey: { _id: 'prod-typed' },
        updateDescription: {
          updatedFields: {},
          removedFields: [],
        },
      }

      const result = transformUpdateEvent<Product>(productEvent)

      const value: Product = result.value
      expect(value.sku).toBe('SKU-TYPED')
      expect(value.price).toBe(99.99)
    })
  })

  describe('edge cases', () => {
    it('should handle documents with special characters in _id', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user/special:chars@123',
          name: 'Special',
          email: 'special@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user/special:chars@123' },
        updateDescription: {
          updatedFields: {},
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent)

      expect(result.key).toBe('user/special:chars@123')
    })

    it('should handle documents with ObjectId-like string _id', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: '507f1f77bcf86cd799439011',
          name: 'ObjectId User',
          email: 'objectid@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: '507f1f77bcf86cd799439011' },
        updateDescription: {
          updatedFields: {},
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent)

      expect(result.key).toBe('507f1f77bcf86cd799439011')
    })

    it('should handle deeply nested document updates', () => {
      interface NestedDoc {
        _id: string
        level1: {
          level2: {
            level3: {
              value: string
            }
          }
        }
      }

      const updateEvent: MongoUpdateEvent<NestedDoc> = {
        operationType: 'update',
        fullDocument: {
          _id: 'nested-123',
          level1: {
            level2: {
              level3: {
                value: 'deep-updated',
              },
            },
          },
        },
        documentKey: { _id: 'nested-123' },
        updateDescription: {
          updatedFields: { 'level1.level2.level3.value': 'deep-updated' } as any,
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent, { includeUpdateDescription: true })
      const metadata = result.metadata as UpdateMetadata<NestedDoc>

      expect(result.value.level1.level2.level3.value).toBe('deep-updated')
      expect(metadata?.updateDescription?.updatedFields).toEqual({
        'level1.level2.level3.value': 'deep-updated',
      })
    })

    it('should handle array field updates', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-array',
          name: 'Array User',
          email: 'array@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: ['tag1', 'tag2', 'newTag'],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-array' },
        updateDescription: {
          updatedFields: { tags: ['tag1', 'tag2', 'newTag'] },
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent, { includeUpdateDescription: true })

      expect(result.value.tags).toEqual(['tag1', 'tag2', 'newTag'])
    })

    it('should handle multiple removed fields', () => {
      interface DocWithOptional {
        _id: string
        required: string
        optional1?: string
        optional2?: string
        optional3?: string
      }

      const updateEvent: MongoUpdateEvent<DocWithOptional> = {
        operationType: 'update',
        fullDocument: {
          _id: 'doc-removed',
          required: 'value',
        },
        documentKey: { _id: 'doc-removed' },
        updateDescription: {
          updatedFields: {},
          removedFields: ['optional1', 'optional2', 'optional3'],
        },
      }

      const result = transformUpdateEvent(updateEvent, { includeUpdateDescription: true })
      const metadata = result.metadata as UpdateMetadata<DocWithOptional>

      expect(metadata?.updateDescription?.removedFields).toEqual([
        'optional1',
        'optional2',
        'optional3',
      ])
    })

    it('should handle simultaneous field updates and removals', () => {
      interface DocWithMixed {
        _id: string
        kept: string
        updated: string
        removed?: string
      }

      const updateEvent: MongoUpdateEvent<DocWithMixed> = {
        operationType: 'update',
        fullDocument: {
          _id: 'doc-mixed',
          kept: 'unchanged',
          updated: 'new-value',
        },
        documentKey: { _id: 'doc-mixed' },
        updateDescription: {
          updatedFields: { updated: 'new-value' },
          removedFields: ['removed'],
        },
      }

      const result = transformUpdateEvent(updateEvent, { includeUpdateDescription: true })
      const metadata = result.metadata as UpdateMetadata<DocWithMixed>

      expect(metadata?.updateDescription?.updatedFields).toEqual({ updated: 'new-value' })
      expect(metadata?.updateDescription?.removedFields).toEqual(['removed'])
    })
  })

  describe('return type validation', () => {
    it('should return a valid ChangeMessage structure', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-return',
          name: 'Return User',
          email: 'return@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-return' },
        updateDescription: {
          updatedFields: {},
          removedFields: [],
        },
      }

      const result = transformUpdateEvent(updateEvent)

      // Verify ChangeMessage structure
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('key')
      expect(result).toHaveProperty('value')
      expect(['insert', 'update', 'delete']).toContain(result.type)
      expect(typeof result.key).toBe('string')
    })

    it('should return UpdateEventTransformResult type', () => {
      const updateEvent: MongoUpdateEvent<User> = {
        operationType: 'update',
        fullDocument: {
          _id: 'user-typed-result',
          name: 'Typed Result',
          email: 'typed@example.com',
          age: 30,
          settings: { theme: 'dark', notifications: true },
          tags: [],
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'user-typed-result' },
        updateDescription: {
          updatedFields: {},
          removedFields: [],
        },
      }

      const result: UpdateEventTransformResult<User> = transformUpdateEvent(updateEvent)

      expect(result.type).toBe('update')
    })
  })
})

describe('UpdateEventTransformOptions Types', () => {
  it('should have optional includeUpdateDescription property', () => {
    expectTypeOf<UpdateEventTransformOptions<User>>().toHaveProperty('includeUpdateDescription')
    expectTypeOf<UpdateEventTransformOptions<User>['includeUpdateDescription']>().toEqualTypeOf<
      boolean | undefined
    >()
  })

  it('should have optional includeSource property', () => {
    expectTypeOf<UpdateEventTransformOptions<User>>().toHaveProperty('includeSource')
    expectTypeOf<UpdateEventTransformOptions<User>['includeSource']>().toEqualTypeOf<
      boolean | undefined
    >()
  })

  it('should have optional includeTimestamp property', () => {
    expectTypeOf<UpdateEventTransformOptions<User>>().toHaveProperty('includeTimestamp')
    expectTypeOf<UpdateEventTransformOptions<User>['includeTimestamp']>().toEqualTypeOf<
      boolean | undefined
    >()
  })

  it('should have optional includeOperationType property', () => {
    expectTypeOf<UpdateEventTransformOptions<User>>().toHaveProperty('includeOperationType')
    expectTypeOf<UpdateEventTransformOptions<User>['includeOperationType']>().toEqualTypeOf<
      boolean | undefined
    >()
  })

  it('should have optional getKey function property', () => {
    expectTypeOf<UpdateEventTransformOptions<User>>().toHaveProperty('getKey')
    type GetKeyType = UpdateEventTransformOptions<User>['getKey']
    expectTypeOf<GetKeyType>().toEqualTypeOf<((doc: User) => string) | undefined>()
  })

  it('should have optional customMetadata property', () => {
    expectTypeOf<UpdateEventTransformOptions<User>>().toHaveProperty('customMetadata')
    expectTypeOf<UpdateEventTransformOptions<User>['customMetadata']>().toEqualTypeOf<
      Record<string, unknown> | undefined
    >()
  })
})

describe('UpdateEventTransformResult Types', () => {
  it('should have type property set to "update"', () => {
    expectTypeOf<UpdateEventTransformResult<User>['type']>().toEqualTypeOf<'update'>()
  })

  it('should have key property as string', () => {
    expectTypeOf<UpdateEventTransformResult<User>['key']>().toBeString()
  })

  it('should have value property matching the document type', () => {
    expectTypeOf<UpdateEventTransformResult<User>['value']>().toEqualTypeOf<User>()
  })

  it('should have optional metadata property', () => {
    expectTypeOf<UpdateEventTransformResult<User>>().toHaveProperty('metadata')
  })

  it('should extend ChangeMessage interface', () => {
    expectTypeOf<UpdateEventTransformResult<User>>().toMatchTypeOf<ChangeMessage<User>>()
  })
})
