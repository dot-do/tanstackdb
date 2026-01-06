/**
 * Tests for Delete Event Transform
 *
 * These tests verify the transformation of MongoDB delete change stream events
 * into TanStack DB compatible DeleteKeyMessage format.
 *
 * Delete events are unique because:
 * - They do NOT contain a fullDocument (the document is already gone)
 * - They only provide the documentKey with the _id
 * - They must be transformed to DeleteKeyMessage (not ChangeMessage)
 *
 * RED PHASE: These tests will fail until transformDeleteEvent is implemented
 */

import { describe, it, expect } from 'vitest'
import type { MongoDeleteEvent } from '../../../src/types/events.js'
import type { DeleteKeyMessage } from '@tanstack/db'

// Import the transform function (GREEN phase - now implemented)
import { transformDeleteEvent } from '../../../src/sync/transforms/delete.js'

// Sample types for testing
interface User {
  _id: string
  name: string
  email: string
  role: 'admin' | 'user'
}

interface Product {
  _id: string
  sku: string
  title: string
  price: number
  inStock: boolean
}

interface Order {
  _id: string
  userId: string
  productIds: string[]
  total: number
  status: 'pending' | 'completed' | 'cancelled'
}

describe('Delete Event Transform', () => {
  describe('Basic Delete Transformation', () => {
    it('should transform a delete event with simple ID', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: '507f1f77bcf86cd799439011' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result).toEqual({
        key: '507f1f77bcf86cd799439011',
        type: 'delete',
      })
    })

    it('should transform a delete event for Product type', () => {
      const deleteEvent: MongoDeleteEvent<Product> = {
        operationType: 'delete',
        documentKey: { _id: 'prod-12345' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result).toEqual({
        key: 'prod-12345',
        type: 'delete',
      })
    })

    it('should transform a delete event for Order type', () => {
      const deleteEvent: MongoDeleteEvent<Order> = {
        operationType: 'delete',
        documentKey: { _id: 'order-abc-123' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result).toEqual({
        key: 'order-abc-123',
        type: 'delete',
      })
    })
  })

  describe('Delete Event Structure', () => {
    it('should produce DeleteKeyMessage with only key and type properties', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: 'user-456' },
      }

      const result = transformDeleteEvent(deleteEvent)

      // DeleteKeyMessage should only have key and type, NOT value or previousValue
      expect(Object.keys(result).sort()).toEqual(['key', 'type'])
    })

    it('should always set type to "delete"', () => {
      const deleteEvent: MongoDeleteEvent<Product> = {
        operationType: 'delete',
        documentKey: { _id: 'any-id' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result.type).toBe('delete')
    })

    it('should NOT include value property', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: 'deleted-user' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result).not.toHaveProperty('value')
    })

    it('should NOT include previousValue property', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: 'deleted-user' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result).not.toHaveProperty('previousValue')
    })
  })

  describe('Custom Key Extraction', () => {
    it('should use custom getKey function when provided', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: 'raw-mongo-id' },
      }

      const customGetKey = (id: string) => `user:${id}`
      const result = transformDeleteEvent(deleteEvent, customGetKey)

      expect(result.key).toBe('user:raw-mongo-id')
    })

    it('should support namespaced key patterns', () => {
      const deleteEvent: MongoDeleteEvent<Product> = {
        operationType: 'delete',
        documentKey: { _id: 'prod-123' },
      }

      const namespaceKey = (id: string) => `products/${id}`
      const result = transformDeleteEvent(deleteEvent, namespaceKey)

      expect(result.key).toBe('products/prod-123')
    })

    it('should support complex key transformations', () => {
      const deleteEvent: MongoDeleteEvent<Order> = {
        operationType: 'delete',
        documentKey: { _id: 'ORD-2024-001' },
      }

      const transformKey = (id: string) => {
        const parts = id.split('-')
        return `${parts[0]!.toLowerCase()}:${parts[1]}:${parts[2]}`
      }

      const result = transformDeleteEvent(deleteEvent, transformKey)

      expect(result.key).toBe('ord:2024:001')
    })

    it('should use identity function when getKey is not provided', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: 'original-id-unchanged' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result.key).toBe('original-id-unchanged')
    })
  })

  describe('ID Format Handling', () => {
    it('should handle MongoDB ObjectId string format', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: '507f1f77bcf86cd799439011' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result.key).toBe('507f1f77bcf86cd799439011')
      expect(result.key).toMatch(/^[a-f0-9]{24}$/)
    })

    it('should handle UUID format', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: '550e8400-e29b-41d4-a716-446655440000' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result.key).toBe('550e8400-e29b-41d4-a716-446655440000')
    })

    it('should handle custom string IDs', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: 'user_john_doe_123' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result.key).toBe('user_john_doe_123')
    })

    it('should handle numeric string IDs', () => {
      const deleteEvent: MongoDeleteEvent<Product> = {
        operationType: 'delete',
        documentKey: { _id: '12345' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result.key).toBe('12345')
      expect(typeof result.key).toBe('string')
    })

    it('should preserve special characters in IDs', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: 'user@domain.com' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result.key).toBe('user@domain.com')
    })
  })

  describe('Type Safety', () => {
    it('should return correct type signature', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: 'test-id' },
      }

      const result = transformDeleteEvent(deleteEvent)

      // Type assertion to verify the shape matches DeleteKeyMessage
      const _typeCheck: DeleteKeyMessage<string> = result
      expect(_typeCheck).toBeDefined()
    })

    it('should work with generic document types', () => {
      interface CustomDoc {
        _id: string
        [key: string]: unknown
      }

      const deleteEvent: MongoDeleteEvent<CustomDoc> = {
        operationType: 'delete',
        documentKey: { _id: 'custom-doc-id' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result.type).toBe('delete')
      expect(result.key).toBe('custom-doc-id')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string ID (edge case)', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: '' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result.key).toBe('')
      expect(result.type).toBe('delete')
    })

    it('should handle very long IDs', () => {
      const longId = 'a'.repeat(1000)
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: longId },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result.key).toBe(longId)
      expect(result.key.length).toBe(1000)
    })

    it('should handle IDs with unicode characters', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: 'user-\u4e2d\u6587-\u65e5\u672c\u8a9e' },
      }

      const result = transformDeleteEvent(deleteEvent)

      expect(result.key).toBe('user-\u4e2d\u6587-\u65e5\u672c\u8a9e')
    })

    it('should handle IDs with whitespace', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: '  spaced  id  ' },
      }

      const result = transformDeleteEvent(deleteEvent)

      // Should preserve whitespace exactly as-is
      expect(result.key).toBe('  spaced  id  ')
    })
  })

  describe('Batch Processing', () => {
    it('should correctly transform multiple delete events', () => {
      const deleteEvents: MongoDeleteEvent<User>[] = [
        { operationType: 'delete', documentKey: { _id: 'user-1' } },
        { operationType: 'delete', documentKey: { _id: 'user-2' } },
        { operationType: 'delete', documentKey: { _id: 'user-3' } },
      ]

      const results = deleteEvents.map((event) => transformDeleteEvent(event))

      expect(results).toHaveLength(3)
      expect(results[0]!.key).toBe('user-1')
      expect(results[1]!.key).toBe('user-2')
      expect(results[2]!.key).toBe('user-3')
      results.forEach((result) => {
        expect(result.type).toBe('delete')
      })
    })

    it('should maintain order when transforming batch', () => {
      const ids = ['first', 'second', 'third', 'fourth', 'fifth']
      const deleteEvents: MongoDeleteEvent<Product>[] = ids.map((id) => ({
        operationType: 'delete' as const,
        documentKey: { _id: id },
      }))

      const results = deleteEvents.map((event) => transformDeleteEvent(event))
      const resultKeys = results.map((r) => r.key)

      expect(resultKeys).toEqual(ids)
    })
  })

  describe('Integration with TanStack DB', () => {
    it('should produce output compatible with write() function', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: 'user-to-delete' },
      }

      const result = transformDeleteEvent(deleteEvent)

      // The result should be directly usable with TanStack DB's write function
      // write(message: ChangeMessageOrDeleteKeyMessage<T, TKey>)
      expect(result).toMatchObject({
        key: expect.any(String),
        type: 'delete',
      })
    })

    it('should be distinguishable from ChangeMessage by absence of value', () => {
      const deleteEvent: MongoDeleteEvent<User> = {
        operationType: 'delete',
        documentKey: { _id: 'test-id' },
      }

      const result = transformDeleteEvent(deleteEvent)

      // This is how TanStack DB distinguishes DeleteKeyMessage from ChangeMessage
      const isDeleteKeyMessage = result.type === 'delete' && !('value' in result)
      expect(isDeleteKeyMessage).toBe(true)
    })
  })
})
