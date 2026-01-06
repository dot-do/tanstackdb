/**
 * @file Insert Event Transform Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the transformInsertEvent function that transforms
 * MongoDB insert change stream events into TanStack DB ChangeMessage format.
 *
 * The transformInsertEvent function handles the transformation of:
 * - MongoInsertEvent<T> -> ChangeMessage<T>
 *
 * This enables TanStack DB to receive and process real-time insert events
 * from MongoDB change streams via the mongo.do service.
 *
 * RED PHASE: These tests will fail until transformInsertEvent is implemented
 * in src/sync/transforms/insert.ts
 *
 * @see https://www.mongodb.com/docs/manual/changeStreams/
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import { transformInsertEvent } from '../../../src/sync/transforms/insert'
import type { MongoInsertEvent, ChangeMessage } from '../../../src/types'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing insert transformations.
 */
interface TestDocument {
  _id: string
  name: string
  value: number
  createdAt: Date
}

/**
 * Document with nested objects for testing complex structures.
 */
interface NestedDocument {
  _id: string
  user: {
    profile: {
      firstName: string
      lastName: string
    }
    settings: {
      theme: 'light' | 'dark'
      notifications: boolean
    }
  }
  metadata: {
    version: number
    tags: string[]
  }
}

/**
 * Document with array fields for testing array handling.
 */
interface ArrayDocument {
  _id: string
  items: Array<{ id: number; name: string }>
  tags: string[]
  scores: number[]
}

/**
 * Document with optional fields for testing sparse documents.
 */
interface SparseDocument {
  _id: string
  required: string
  optional?: string
  nullable: string | null
  nested?: {
    deep?: {
      value?: number
    }
  }
}

/**
 * Document with various MongoDB BSON types.
 */
interface BSONDocument {
  _id: string
  date: Date
  timestamp: number
  binary: Uint8Array
  decimal: number
  objectId: string
  regex: RegExp
}

/**
 * Minimal document for edge case testing.
 */
interface MinimalDocument {
  _id: string
}

// =============================================================================
// Transform Function Existence Tests
// =============================================================================

describe('transformInsertEvent', () => {
  describe('function existence', () => {
    it('should be a function', () => {
      expect(typeof transformInsertEvent).toBe('function')
    })

    it('should accept a MongoInsertEvent parameter', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'doc-123',
          name: 'Test Doc',
          value: 42,
          createdAt: new Date('2024-01-01'),
        },
        documentKey: { _id: 'doc-123' },
      }

      // Should not throw when called with valid event
      expect(() => transformInsertEvent(event)).not.toThrow()
    })

    it('should return a ChangeMessage', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'doc-456',
          name: 'Another Doc',
          value: 100,
          createdAt: new Date(),
        },
        documentKey: { _id: 'doc-456' },
      }

      const result = transformInsertEvent(event)

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })
  })

  // =============================================================================
  // Basic Transformation Tests
  // =============================================================================

  describe('basic transformation', () => {
    it('should transform a simple insert event', () => {
      const now = new Date('2024-06-15T10:30:00Z')
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'simple-123',
          name: 'Simple Document',
          value: 999,
          createdAt: now,
        },
        documentKey: { _id: 'simple-123' },
      }

      const result = transformInsertEvent(event)

      expect(result.type).toBe('insert')
      expect(result.key).toBe('simple-123')
      expect(result.value).toEqual({
        _id: 'simple-123',
        name: 'Simple Document',
        value: 999,
        createdAt: now,
      })
    })

    it('should set type to "insert"', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'type-test',
          name: 'Type Test',
          value: 1,
          createdAt: new Date(),
        },
        documentKey: { _id: 'type-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.type).toBe('insert')
    })

    it('should extract key from documentKey._id', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'key-extraction-test',
          name: 'Key Test',
          value: 2,
          createdAt: new Date(),
        },
        documentKey: { _id: 'key-extraction-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.key).toBe('key-extraction-test')
    })

    it('should include fullDocument as value', () => {
      const document: TestDocument = {
        _id: 'full-doc-test',
        name: 'Full Document',
        value: 42,
        createdAt: new Date('2024-03-20'),
      }

      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: document,
        documentKey: { _id: 'full-doc-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.value).toEqual(document)
      expect(result.value._id).toBe('full-doc-test')
      expect(result.value.name).toBe('Full Document')
      expect(result.value.value).toBe(42)
    })

    it('should not include previousValue for insert events', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'no-prev-test',
          name: 'No Previous',
          value: 0,
          createdAt: new Date(),
        },
        documentKey: { _id: 'no-prev-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.previousValue).toBeUndefined()
    })
  })

  // =============================================================================
  // Key Extraction Tests
  // =============================================================================

  describe('key extraction', () => {
    it('should handle standard ObjectId-style string IDs', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: '507f1f77bcf86cd799439011',
          name: 'ObjectId Test',
          value: 1,
          createdAt: new Date(),
        },
        documentKey: { _id: '507f1f77bcf86cd799439011' },
      }

      const result = transformInsertEvent(event)

      expect(result.key).toBe('507f1f77bcf86cd799439011')
    })

    it('should handle UUID-style IDs', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000'
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: uuid,
          name: 'UUID Test',
          value: 2,
          createdAt: new Date(),
        },
        documentKey: { _id: uuid },
      }

      const result = transformInsertEvent(event)

      expect(result.key).toBe(uuid)
    })

    it('should handle custom string IDs', () => {
      const customId = 'user:john:profile:main'
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: customId,
          name: 'Custom ID Test',
          value: 3,
          createdAt: new Date(),
        },
        documentKey: { _id: customId },
      }

      const result = transformInsertEvent(event)

      expect(result.key).toBe(customId)
    })

    it('should handle IDs with special characters', () => {
      const specialId = 'doc/with/slashes#and$special@chars!'
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: specialId,
          name: 'Special Chars Test',
          value: 4,
          createdAt: new Date(),
        },
        documentKey: { _id: specialId },
      }

      const result = transformInsertEvent(event)

      expect(result.key).toBe(specialId)
    })

    it('should handle empty string IDs', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: '',
          name: 'Empty ID Test',
          value: 5,
          createdAt: new Date(),
        },
        documentKey: { _id: '' },
      }

      const result = transformInsertEvent(event)

      expect(result.key).toBe('')
    })

    it('should handle numeric-like string IDs', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: '12345',
          name: 'Numeric String Test',
          value: 6,
          createdAt: new Date(),
        },
        documentKey: { _id: '12345' },
      }

      const result = transformInsertEvent(event)

      expect(result.key).toBe('12345')
      expect(typeof result.key).toBe('string')
    })
  })

  // =============================================================================
  // Complex Document Structure Tests
  // =============================================================================

  describe('complex document structures', () => {
    it('should preserve nested object structures', () => {
      const event: MongoInsertEvent<NestedDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'nested-123',
          user: {
            profile: {
              firstName: 'John',
              lastName: 'Doe',
            },
            settings: {
              theme: 'dark',
              notifications: true,
            },
          },
          metadata: {
            version: 1,
            tags: ['admin', 'verified'],
          },
        },
        documentKey: { _id: 'nested-123' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.user.profile.firstName).toBe('John')
      expect(result.value.user.profile.lastName).toBe('Doe')
      expect(result.value.user.settings.theme).toBe('dark')
      expect(result.value.user.settings.notifications).toBe(true)
      expect(result.value.metadata.version).toBe(1)
      expect(result.value.metadata.tags).toEqual(['admin', 'verified'])
    })

    it('should preserve array fields', () => {
      const event: MongoInsertEvent<ArrayDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'array-123',
          items: [
            { id: 1, name: 'Item A' },
            { id: 2, name: 'Item B' },
            { id: 3, name: 'Item C' },
          ],
          tags: ['tag1', 'tag2', 'tag3'],
          scores: [95, 87, 92, 100],
        },
        documentKey: { _id: 'array-123' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.items).toHaveLength(3)
      expect(result.value.items[0]).toEqual({ id: 1, name: 'Item A' })
      expect(result.value.tags).toEqual(['tag1', 'tag2', 'tag3'])
      expect(result.value.scores).toEqual([95, 87, 92, 100])
    })

    it('should handle empty arrays', () => {
      const event: MongoInsertEvent<ArrayDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'empty-arrays',
          items: [],
          tags: [],
          scores: [],
        },
        documentKey: { _id: 'empty-arrays' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.items).toEqual([])
      expect(result.value.tags).toEqual([])
      expect(result.value.scores).toEqual([])
    })

    it('should handle documents with optional fields present', () => {
      const event: MongoInsertEvent<SparseDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'sparse-with-optional',
          required: 'required value',
          optional: 'optional value',
          nullable: 'not null',
          nested: {
            deep: {
              value: 42,
            },
          },
        },
        documentKey: { _id: 'sparse-with-optional' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.required).toBe('required value')
      expect(result.value.optional).toBe('optional value')
      expect(result.value.nullable).toBe('not null')
      expect(result.value.nested?.deep?.value).toBe(42)
    })

    it('should handle documents with optional fields missing', () => {
      const event: MongoInsertEvent<SparseDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'sparse-without-optional',
          required: 'required only',
          nullable: null,
        },
        documentKey: { _id: 'sparse-without-optional' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.required).toBe('required only')
      expect(result.value.optional).toBeUndefined()
      expect(result.value.nullable).toBeNull()
      expect(result.value.nested).toBeUndefined()
    })

    it('should handle minimal documents with only _id', () => {
      const event: MongoInsertEvent<MinimalDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'minimal-only',
        },
        documentKey: { _id: 'minimal-only' },
      }

      const result = transformInsertEvent(event)

      expect(result.key).toBe('minimal-only')
      expect(result.value).toEqual({ _id: 'minimal-only' })
    })
  })

  // =============================================================================
  // BSON Type Handling Tests
  // =============================================================================

  describe('BSON type handling', () => {
    it('should preserve Date objects', () => {
      const testDate = new Date('2024-06-15T12:00:00Z')
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'date-test',
          name: 'Date Test',
          value: 1,
          createdAt: testDate,
        },
        documentKey: { _id: 'date-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.createdAt).toEqual(testDate)
      expect(result.value.createdAt).toBeInstanceOf(Date)
    })

    it('should handle Date at epoch', () => {
      const epochDate = new Date(0)
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'epoch-test',
          name: 'Epoch Date',
          value: 0,
          createdAt: epochDate,
        },
        documentKey: { _id: 'epoch-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.createdAt.getTime()).toBe(0)
    })

    it('should handle future dates', () => {
      const futureDate = new Date('2099-12-31T23:59:59Z')
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'future-test',
          name: 'Future Date',
          value: 99,
          createdAt: futureDate,
        },
        documentKey: { _id: 'future-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.createdAt).toEqual(futureDate)
    })

    it('should preserve numeric values correctly', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'number-test',
          name: 'Number Test',
          value: 3.14159265359,
          createdAt: new Date(),
        },
        documentKey: { _id: 'number-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.value).toBe(3.14159265359)
    })

    it('should handle large numbers', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'large-number',
          name: 'Large Number',
          value: Number.MAX_SAFE_INTEGER,
          createdAt: new Date(),
        },
        documentKey: { _id: 'large-number' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.value).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('should handle negative numbers', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'negative-number',
          name: 'Negative Number',
          value: -999999,
          createdAt: new Date(),
        },
        documentKey: { _id: 'negative-number' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.value).toBe(-999999)
    })

    it('should handle zero values', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'zero-value',
          name: 'Zero',
          value: 0,
          createdAt: new Date(),
        },
        documentKey: { _id: 'zero-value' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.value).toBe(0)
    })
  })

  // =============================================================================
  // Immutability Tests
  // =============================================================================

  describe('immutability', () => {
    it('should not modify the original event', () => {
      const originalDocument: TestDocument = {
        _id: 'immutable-test',
        name: 'Original Name',
        value: 100,
        createdAt: new Date('2024-01-01'),
      }

      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: { ...originalDocument },
        documentKey: { _id: 'immutable-test' },
      }

      const eventCopy = JSON.parse(JSON.stringify(event))
      transformInsertEvent(event)

      expect(event.fullDocument.name).toBe(eventCopy.fullDocument.name)
      expect(event.fullDocument.value).toBe(eventCopy.fullDocument.value)
      expect(event.documentKey._id).toBe(eventCopy.documentKey._id)
    })

    it('should return a new object, not a reference', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'reference-test',
          name: 'Reference Test',
          value: 50,
          createdAt: new Date(),
        },
        documentKey: { _id: 'reference-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.value).not.toBe(event.fullDocument)
    })

    it('should return independent copies when called multiple times', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'multi-call-test',
          name: 'Multi Call',
          value: 25,
          createdAt: new Date(),
        },
        documentKey: { _id: 'multi-call-test' },
      }

      const result1 = transformInsertEvent(event)
      const result2 = transformInsertEvent(event)

      expect(result1).not.toBe(result2)
      expect(result1.value).not.toBe(result2.value)
      expect(result1).toEqual(result2)
    })
  })

  // =============================================================================
  // Type Safety Tests
  // =============================================================================

  describe('type safety', () => {
    it('should preserve document type through transformation', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'type-safe-test',
          name: 'Type Safe',
          value: 123,
          createdAt: new Date(),
        },
        documentKey: { _id: 'type-safe-test' },
      }

      const result = transformInsertEvent(event)

      // Type assertion checks - these verify TypeScript types at compile time
      expectTypeOf(result).toMatchTypeOf<ChangeMessage<TestDocument>>()
      expectTypeOf(result.value).toMatchTypeOf<TestDocument>()
      expectTypeOf(result.key).toBeString()
      expectTypeOf(result.type).toMatchTypeOf<'insert' | 'update' | 'delete'>()
    })

    it('should maintain generic type parameter', () => {
      const event: MongoInsertEvent<NestedDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'generic-test',
          user: {
            profile: { firstName: 'Jane', lastName: 'Smith' },
            settings: { theme: 'light', notifications: false },
          },
          metadata: { version: 2, tags: [] },
        },
        documentKey: { _id: 'generic-test' },
      }

      const result = transformInsertEvent(event)

      expectTypeOf(result.value).toMatchTypeOf<NestedDocument>()
      expectTypeOf(result.value.user.profile.firstName).toBeString()
      expectTypeOf(result.value.metadata.version).toBeNumber()
    })

    it('should type result.type as "insert" literal', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'literal-type-test',
          name: 'Literal Type',
          value: 1,
          createdAt: new Date(),
        },
        documentKey: { _id: 'literal-type-test' },
      }

      const result = transformInsertEvent(event)

      // The type should specifically be 'insert', not just string
      expect(result.type).toBe('insert')
    })
  })

  // =============================================================================
  // Metadata Handling Tests
  // =============================================================================

  describe('metadata handling', () => {
    it('should include metadata when provided', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'metadata-test',
          name: 'With Metadata',
          value: 10,
          createdAt: new Date(),
        },
        documentKey: { _id: 'metadata-test' },
      }

      const metadata = {
        source: 'change-stream',
        timestamp: Date.now(),
        clusterTime: '7300000000000000001',
      }

      const result = transformInsertEvent(event, { metadata })

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.source).toBe('change-stream')
      expect(result.metadata?.timestamp).toBeDefined()
      expect(result.metadata?.clusterTime).toBe('7300000000000000001')
    })

    it('should not include metadata when not provided', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'no-metadata-test',
          name: 'No Metadata',
          value: 20,
          createdAt: new Date(),
        },
        documentKey: { _id: 'no-metadata-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.metadata).toBeUndefined()
    })

    it('should preserve custom metadata fields', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'custom-metadata-test',
          name: 'Custom Metadata',
          value: 30,
          createdAt: new Date(),
        },
        documentKey: { _id: 'custom-metadata-test' },
      }

      const metadata = {
        customField: 'custom-value',
        nestedData: { level: 1, info: 'nested' },
        arrayData: [1, 2, 3],
      }

      const result = transformInsertEvent(event, { metadata })

      expect(result.metadata?.customField).toBe('custom-value')
      expect(result.metadata?.nestedData).toEqual({ level: 1, info: 'nested' })
      expect(result.metadata?.arrayData).toEqual([1, 2, 3])
    })
  })

  // =============================================================================
  // Options Configuration Tests
  // =============================================================================

  describe('options configuration', () => {
    it('should accept custom key extractor', () => {
      interface CustomKeyDoc {
        _id: string
        compositeKey: {
          tenantId: string
          recordId: string
        }
      }

      const event: MongoInsertEvent<CustomKeyDoc> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'original-id',
          compositeKey: {
            tenantId: 'tenant-001',
            recordId: 'record-123',
          },
        },
        documentKey: { _id: 'original-id' },
      }

      const customKeyExtractor = (doc: CustomKeyDoc) =>
        `${doc.compositeKey.tenantId}:${doc.compositeKey.recordId}`

      const result = transformInsertEvent(event, {
        getKey: customKeyExtractor,
      })

      expect(result.key).toBe('tenant-001:record-123')
    })

    it('should use documentKey._id as default key', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'default-key-test',
          name: 'Default Key',
          value: 40,
          createdAt: new Date(),
        },
        documentKey: { _id: 'default-key-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.key).toBe('default-key-test')
    })

    it('should support value transformer option', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'transform-value-test',
          name: 'Transform Value',
          value: 50,
          createdAt: new Date(),
        },
        documentKey: { _id: 'transform-value-test' },
      }

      const valueTransformer = (doc: TestDocument): TestDocument => ({
        ...doc,
        name: doc.name.toUpperCase(),
        value: doc.value * 2,
      })

      const result = transformInsertEvent(event, {
        transformValue: valueTransformer,
      })

      expect(result.value.name).toBe('TRANSFORM VALUE')
      expect(result.value.value).toBe(100)
    })
  })

  // =============================================================================
  // Edge Cases and Error Handling Tests
  // =============================================================================

  describe('edge cases', () => {
    it('should handle documents with very long string fields', () => {
      const longString = 'a'.repeat(100000)
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'long-string-test',
          name: longString,
          value: 1,
          createdAt: new Date(),
        },
        documentKey: { _id: 'long-string-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.name).toBe(longString)
      expect(result.value.name.length).toBe(100000)
    })

    it('should handle documents with unicode characters', () => {
      const unicodeString = 'Hello \u4e16\u754c \u{1F600} \u{1F4BB}'
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'unicode-test',
          name: unicodeString,
          value: 1,
          createdAt: new Date(),
        },
        documentKey: { _id: 'unicode-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.name).toBe(unicodeString)
    })

    it('should handle documents with null values in fields', () => {
      interface NullableDoc {
        _id: string
        nullableField: string | null
        anotherField: number | null
      }

      const event: MongoInsertEvent<NullableDoc> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'null-fields-test',
          nullableField: null,
          anotherField: null,
        },
        documentKey: { _id: 'null-fields-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.nullableField).toBeNull()
      expect(result.value.anotherField).toBeNull()
    })

    it('should handle deeply nested documents', () => {
      interface DeepDocument {
        _id: string
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: string
                }
              }
            }
          }
        }
      }

      const event: MongoInsertEvent<DeepDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'deep-nested-test',
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: {
                    value: 'deep value',
                  },
                },
              },
            },
          },
        },
        documentKey: { _id: 'deep-nested-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.level1.level2.level3.level4.level5.value).toBe('deep value')
    })

    it('should handle arrays of objects with various types', () => {
      interface MixedArrayDoc {
        _id: string
        items: Array<{
          id: number
          name: string
          date: Date
          nested: { flag: boolean }
        }>
      }

      const event: MongoInsertEvent<MixedArrayDoc> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'mixed-array-test',
          items: [
            { id: 1, name: 'first', date: new Date('2024-01-01'), nested: { flag: true } },
            { id: 2, name: 'second', date: new Date('2024-02-01'), nested: { flag: false } },
          ],
        },
        documentKey: { _id: 'mixed-array-test' },
      }

      const result = transformInsertEvent(event)

      expect(result.value.items).toHaveLength(2)
      expect(result.value.items[0]!.nested.flag).toBe(true)
      expect(result.value.items[1]!.nested.flag).toBe(false)
    })
  })

  // =============================================================================
  // Error Handling Tests
  // =============================================================================

  describe('error handling', () => {
    it('should throw when event is null', () => {
      expect(() => transformInsertEvent(null as any)).toThrow()
    })

    it('should throw when event is undefined', () => {
      expect(() => transformInsertEvent(undefined as any)).toThrow()
    })

    it('should throw when operationType is not "insert"', () => {
      const invalidEvent = {
        operationType: 'update',
        fullDocument: { _id: 'test' },
        documentKey: { _id: 'test' },
      }

      expect(() => transformInsertEvent(invalidEvent as any)).toThrow()
    })

    it('should throw when fullDocument is missing', () => {
      const invalidEvent = {
        operationType: 'insert',
        documentKey: { _id: 'test' },
      }

      expect(() => transformInsertEvent(invalidEvent as any)).toThrow()
    })

    it('should throw when documentKey is missing', () => {
      const invalidEvent = {
        operationType: 'insert',
        fullDocument: { _id: 'test', name: 'Test' },
      }

      expect(() => transformInsertEvent(invalidEvent as any)).toThrow()
    })

    it('should throw when documentKey._id is missing', () => {
      const invalidEvent = {
        operationType: 'insert',
        fullDocument: { _id: 'test', name: 'Test' },
        documentKey: {},
      }

      expect(() => transformInsertEvent(invalidEvent as any)).toThrow()
    })

    it('should provide descriptive error messages', () => {
      try {
        transformInsertEvent(null as any)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBeTruthy()
      }
    })
  })

  // =============================================================================
  // Consistency Tests
  // =============================================================================

  describe('consistency', () => {
    it('should produce consistent output for same input', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'consistency-test',
          name: 'Consistency',
          value: 100,
          createdAt: new Date('2024-06-15'),
        },
        documentKey: { _id: 'consistency-test' },
      }

      const result1 = transformInsertEvent(event)
      const result2 = transformInsertEvent(event)

      expect(result1).toEqual(result2)
    })

    it('should handle rapid successive transformations', () => {
      const results: ChangeMessage<TestDocument>[] = []

      for (let i = 0; i < 1000; i++) {
        const event: MongoInsertEvent<TestDocument> = {
          operationType: 'insert',
          fullDocument: {
            _id: `rapid-${i}`,
            name: `Document ${i}`,
            value: i,
            createdAt: new Date(),
          },
          documentKey: { _id: `rapid-${i}` },
        }

        results.push(transformInsertEvent(event))
      }

      expect(results).toHaveLength(1000)
      expect(results[0]!.key).toBe('rapid-0')
      expect(results[999]!.key).toBe('rapid-999')
    })

    it('should maintain referential integrity between key and value._id', () => {
      const event: MongoInsertEvent<TestDocument> = {
        operationType: 'insert',
        fullDocument: {
          _id: 'ref-integrity-test',
          name: 'Referential Integrity',
          value: 1,
          createdAt: new Date(),
        },
        documentKey: { _id: 'ref-integrity-test' },
      }

      const result = transformInsertEvent(event)

      // Key should match the document's _id
      expect(result.key).toBe(result.value._id)
    })
  })
})

// =============================================================================
// Integration-Style Tests
// =============================================================================

describe('transformInsertEvent integration scenarios', () => {
  it('should work with real-world user document', () => {
    interface User {
      _id: string
      email: string
      name: { first: string; last: string }
      role: 'admin' | 'user' | 'guest'
      createdAt: Date
      updatedAt: Date
      profile: {
        avatar?: string
        bio?: string
        preferences: {
          theme: 'light' | 'dark'
          language: string
          emailNotifications: boolean
        }
      }
    }

    const event: MongoInsertEvent<User> = {
      operationType: 'insert',
      fullDocument: {
        _id: 'user-507f1f77bcf86cd799439011',
        email: 'john.doe@example.com',
        name: { first: 'John', last: 'Doe' },
        role: 'user',
        createdAt: new Date('2024-06-15T10:00:00Z'),
        updatedAt: new Date('2024-06-15T10:00:00Z'),
        profile: {
          avatar: 'https://example.com/avatar.jpg',
          bio: 'Software developer',
          preferences: {
            theme: 'dark',
            language: 'en',
            emailNotifications: true,
          },
        },
      },
      documentKey: { _id: 'user-507f1f77bcf86cd799439011' },
    }

    const result = transformInsertEvent(event)

    expect(result.type).toBe('insert')
    expect(result.key).toBe('user-507f1f77bcf86cd799439011')
    expect(result.value.email).toBe('john.doe@example.com')
    expect(result.value.profile.preferences.theme).toBe('dark')
    expect(result.previousValue).toBeUndefined()
  })

  it('should work with e-commerce product document', () => {
    interface Product {
      _id: string
      sku: string
      name: string
      description: string
      price: {
        amount: number
        currency: string
      }
      inventory: {
        quantity: number
        warehouse: string
      }
      categories: string[]
      tags: string[]
      variants: Array<{
        id: string
        name: string
        price: number
        stock: number
      }>
      createdAt: Date
    }

    const event: MongoInsertEvent<Product> = {
      operationType: 'insert',
      fullDocument: {
        _id: 'prod-12345',
        sku: 'WIDGET-001',
        name: 'Premium Widget',
        description: 'A high-quality widget for all your needs',
        price: { amount: 29.99, currency: 'USD' },
        inventory: { quantity: 100, warehouse: 'WH-01' },
        categories: ['electronics', 'gadgets', 'accessories'],
        tags: ['premium', 'bestseller', 'new'],
        variants: [
          { id: 'var-1', name: 'Small', price: 24.99, stock: 30 },
          { id: 'var-2', name: 'Medium', price: 29.99, stock: 50 },
          { id: 'var-3', name: 'Large', price: 34.99, stock: 20 },
        ],
        createdAt: new Date('2024-06-01'),
      },
      documentKey: { _id: 'prod-12345' },
    }

    const result = transformInsertEvent(event)

    expect(result.type).toBe('insert')
    expect(result.key).toBe('prod-12345')
    expect(result.value.sku).toBe('WIDGET-001')
    expect(result.value.variants).toHaveLength(3)
    expect(result.value.price.amount).toBe(29.99)
  })

  it('should work with audit log document', () => {
    interface AuditLog {
      _id: string
      timestamp: Date
      action: 'create' | 'read' | 'update' | 'delete'
      resource: {
        type: string
        id: string
      }
      actor: {
        userId: string
        ip: string
        userAgent: string
      }
      changes?: {
        before: Record<string, unknown>
        after: Record<string, unknown>
      }
    }

    const event: MongoInsertEvent<AuditLog> = {
      operationType: 'insert',
      fullDocument: {
        _id: 'audit-789',
        timestamp: new Date('2024-06-15T15:30:00Z'),
        action: 'create',
        resource: {
          type: 'user',
          id: 'user-123',
        },
        actor: {
          userId: 'admin-001',
          ip: '192.168.1.100',
          userAgent: 'Mozilla/5.0...',
        },
      },
      documentKey: { _id: 'audit-789' },
    }

    const result = transformInsertEvent(event)

    expect(result.type).toBe('insert')
    expect(result.key).toBe('audit-789')
    expect(result.value.action).toBe('create')
    expect(result.value.resource.type).toBe('user')
    expect(result.value.changes).toBeUndefined()
  })
})
