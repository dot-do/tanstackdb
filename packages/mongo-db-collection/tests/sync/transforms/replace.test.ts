/**
 * @file Replace Event Transform Tests
 *
 * These tests verify the transformReplaceEvent function which converts
 * MongoDB replace events to TanStack DB ChangeMessage format.
 *
 * A MongoDB replace event occurs when a document is completely replaced
 * (as opposed to an update which modifies specific fields). In TanStack DB,
 * this maps to an 'update' type since the document still exists but has
 * new content.
 *
 * @packageDocumentation
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import type { MongoReplaceEvent, ChangeMessage } from '../../../src/types/events'

import {
  transformReplaceEvent,
  generateDocumentDiff,
  type ReplaceTransformOptions,
  type DocumentDiff,
} from '../../../src/sync/transforms/replace'

// ============================================================================
// Test Document Types
// ============================================================================

interface TestDocument {
  _id: string
  name: string
  count: number
  tags: string[]
}

interface UserDocument {
  _id: string
  email: string
  profile: {
    firstName: string
    lastName: string
    age: number
  }
  roles: string[]
  createdAt: string
  updatedAt: string
}

interface MinimalDocument {
  _id: string
}

// ============================================================================
// Basic Transformation Tests
// ============================================================================

describe('transformReplaceEvent', () => {
  describe('Basic Transformation', () => {
    it('should transform a replace event to a ChangeMessage', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'doc-123',
          name: 'Replaced Document',
          count: 42,
          tags: ['new', 'replaced'],
        },
        documentKey: { _id: 'doc-123' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result).toBeDefined()
      expect(result.type).toBe('update')
      expect(result.key).toBe('doc-123')
      expect(result.value).toEqual(replaceEvent.fullDocument)
    })

    it('should return type "update" for replace events', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'test-1',
          name: 'Test',
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'test-1' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.type).toBe('update')
    })

    it('should extract key from documentKey._id', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'unique-key-abc',
          name: 'Key Test',
          count: 0,
          tags: [],
        },
        documentKey: { _id: 'unique-key-abc' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.key).toBe('unique-key-abc')
    })

    it('should include the full document as value', () => {
      const fullDocument: TestDocument = {
        _id: 'full-doc-test',
        name: 'Full Document',
        count: 100,
        tags: ['tag1', 'tag2', 'tag3'],
      }

      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument,
        documentKey: { _id: 'full-doc-test' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.value).toEqual(fullDocument)
      expect(result.value._id).toBe('full-doc-test')
      expect(result.value.name).toBe('Full Document')
      expect(result.value.count).toBe(100)
      expect(result.value.tags).toEqual(['tag1', 'tag2', 'tag3'])
    })
  })

  // ============================================================================
  // Complex Document Tests
  // ============================================================================

  describe('Complex Document Handling', () => {
    it('should handle nested object structures', () => {
      const replaceEvent: MongoReplaceEvent<UserDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'user-456',
          email: 'john@example.com',
          profile: {
            firstName: 'John',
            lastName: 'Doe',
            age: 30,
          },
          roles: ['admin', 'user'],
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-06-15T12:00:00Z',
        },
        documentKey: { _id: 'user-456' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.type).toBe('update')
      expect(result.key).toBe('user-456')
      expect(result.value.profile).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        age: 30,
      })
      expect(result.value.roles).toEqual(['admin', 'user'])
    })

    it('should handle minimal documents with only _id', () => {
      const replaceEvent: MongoReplaceEvent<MinimalDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'minimal-1',
        },
        documentKey: { _id: 'minimal-1' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.type).toBe('update')
      expect(result.key).toBe('minimal-1')
      expect(result.value).toEqual({ _id: 'minimal-1' })
    })

    it('should handle documents with empty arrays', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'empty-arrays',
          name: 'Empty Arrays',
          count: 0,
          tags: [],
        },
        documentKey: { _id: 'empty-arrays' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.value.tags).toEqual([])
      expect(Array.isArray(result.value.tags)).toBe(true)
    })

    it('should handle documents with special characters in _id', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'doc/with:special-chars_123',
          name: 'Special Chars',
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'doc/with:special-chars_123' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.key).toBe('doc/with:special-chars_123')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle documents with numeric zero values', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'zero-count',
          name: '',
          count: 0,
          tags: [],
        },
        documentKey: { _id: 'zero-count' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.value.count).toBe(0)
      expect(result.value.name).toBe('')
    })

    it('should handle documents with negative numbers', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'negative',
          name: 'Negative Count',
          count: -42,
          tags: [],
        },
        documentKey: { _id: 'negative' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.value.count).toBe(-42)
    })

    it('should handle documents with unicode characters', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'unicode-test',
          name: 'Unicode: \u00e9\u00e8\u00ea \u4e2d\u6587 \u0420\u0443\u0441\u0441\u043a\u0438\u0439',
          count: 1,
          tags: ['\ud83d\ude80', '\ud83c\udf89', '\u2728'],
        },
        documentKey: { _id: 'unicode-test' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.value.name).toContain('\u00e9')
      expect(result.value.tags).toContain('\ud83d\ude80')
    })

    it('should handle very long string values', () => {
      const longString = 'a'.repeat(10000)
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'long-string',
          name: longString,
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'long-string' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.value.name).toBe(longString)
      expect(result.value.name.length).toBe(10000)
    })
  })

  // ============================================================================
  // Return Value Structure Tests
  // ============================================================================

  describe('Return Value Structure', () => {
    it('should return an object with exactly type, key, and value properties', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'structure-test',
          name: 'Structure',
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'structure-test' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(Object.keys(result)).toContain('type')
      expect(Object.keys(result)).toContain('key')
      expect(Object.keys(result)).toContain('value')
    })

    it('should not include previousValue by default', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'no-prev-value',
          name: 'No Previous',
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'no-prev-value' },
      }

      const result = transformReplaceEvent(replaceEvent)

      // previousValue should be undefined for basic replace transforms
      expect(result.previousValue).toBeUndefined()
    })

    it('should return a plain object, not a class instance', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'plain-object',
          name: 'Plain',
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'plain-object' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.constructor).toBe(Object)
    })
  })

  // ============================================================================
  // Type Safety Tests
  // ============================================================================

  describe('Type Safety', () => {
    it('should return ChangeMessage<T> type', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'type-test',
          name: 'Type Test',
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'type-test' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expectTypeOf(result).toMatchTypeOf<ChangeMessage<TestDocument>>()
    })

    it('should preserve generic type T through transformation', () => {
      const replaceEvent: MongoReplaceEvent<UserDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'user-type',
          email: 'test@test.com',
          profile: { firstName: 'Test', lastName: 'User', age: 25 },
          roles: [],
          createdAt: '',
          updatedAt: '',
        },
        documentKey: { _id: 'user-type' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expectTypeOf(result.value).toMatchTypeOf<UserDocument>()
      expectTypeOf(result.value.profile).toMatchTypeOf<{
        firstName: string
        lastName: string
        age: number
      }>()
    })

    it('should have type property as literal "update"', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'literal-type',
          name: 'Literal',
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'literal-type' },
      }

      const result = transformReplaceEvent(replaceEvent)

      // The type should be 'update' not just any string
      expect(result.type).toBe('update')
    })

    it('should have key property as string', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'key-string',
          name: 'Key String',
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'key-string' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expectTypeOf(result.key).toBeString()
    })
  })

  // ============================================================================
  // Immutability Tests
  // ============================================================================

  describe('Immutability', () => {
    it('should not modify the original event', () => {
      const originalDocument: TestDocument = {
        _id: 'immutable-test',
        name: 'Original',
        count: 1,
        tags: ['original'],
      }

      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: { ...originalDocument },
        documentKey: { _id: 'immutable-test' },
      }

      const eventCopy = JSON.parse(JSON.stringify(replaceEvent))

      transformReplaceEvent(replaceEvent)

      expect(replaceEvent).toEqual(eventCopy)
    })

    it('should return a new object reference', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'ref-test',
          name: 'Reference',
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'ref-test' },
      }

      const result1 = transformReplaceEvent(replaceEvent)
      const result2 = transformReplaceEvent(replaceEvent)

      expect(result1).not.toBe(result2)
    })

    it('should return value as a new reference (not same as fullDocument)', () => {
      const fullDocument: TestDocument = {
        _id: 'value-ref',
        name: 'Value Reference',
        count: 1,
        tags: ['test'],
      }

      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument,
        documentKey: { _id: 'value-ref' },
      }

      const result = transformReplaceEvent(replaceEvent)

      // Value should be a copy, not the same reference
      // This ensures immutability
      expect(result.value).toEqual(fullDocument)
    })
  })

  // ============================================================================
  // Consistency Tests
  // ============================================================================

  describe('Consistency', () => {
    it('should produce consistent output for the same input', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'consistent',
          name: 'Consistent',
          count: 42,
          tags: ['a', 'b'],
        },
        documentKey: { _id: 'consistent' },
      }

      const result1 = transformReplaceEvent(replaceEvent)
      const result2 = transformReplaceEvent(replaceEvent)

      expect(result1).toEqual(result2)
    })

    it('should handle multiple different events correctly', () => {
      const events: MongoReplaceEvent<TestDocument>[] = [
        {
          operationType: 'replace',
          fullDocument: { _id: '1', name: 'First', count: 1, tags: [] },
          documentKey: { _id: '1' },
        },
        {
          operationType: 'replace',
          fullDocument: { _id: '2', name: 'Second', count: 2, tags: ['tag'] },
          documentKey: { _id: '2' },
        },
        {
          operationType: 'replace',
          fullDocument: { _id: '3', name: 'Third', count: 3, tags: ['a', 'b', 'c'] },
          documentKey: { _id: '3' },
        },
      ]

      const results = events.map(transformReplaceEvent)

      expect(results).toHaveLength(3)
      expect(results[0].key).toBe('1')
      expect(results[1].key).toBe('2')
      expect(results[2].key).toBe('3')
      results.forEach((result) => {
        expect(result.type).toBe('update')
      })
    })
  })
})

// ============================================================================
// Function Signature Tests
// ============================================================================

describe('transformReplaceEvent Function Signature', () => {
  it('should be a function', () => {
    expect(typeof transformReplaceEvent).toBe('function')
  })

  it('should accept MongoReplaceEvent as parameter', () => {
    expectTypeOf(transformReplaceEvent).parameter(0).toMatchTypeOf<MongoReplaceEvent<unknown>>()
  })

  it('should return ChangeMessage type', () => {
    expectTypeOf(transformReplaceEvent).returns.toMatchTypeOf<ChangeMessage<unknown>>()
  })
})

// ============================================================================
// Options Configuration Tests
// ============================================================================

describe('transformReplaceEvent Options', () => {
  describe('Custom Key Extractor', () => {
    it('should use custom getKey function when provided', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'doc-123',
          name: 'Test',
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'doc-123' },
      }

      const result = transformReplaceEvent(replaceEvent, {
        getKey: (doc) => `custom:${doc._id}`,
      })

      expect(result.key).toBe('custom:doc-123')
    })

    it('should support composite key generation', () => {
      interface TenantDocument {
        _id: string
        tenantId: string
        name: string
      }

      const replaceEvent: MongoReplaceEvent<TenantDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'doc-456',
          tenantId: 'tenant-001',
          name: 'Tenant Doc',
        },
        documentKey: { _id: 'doc-456' },
      }

      const result = transformReplaceEvent(replaceEvent, {
        getKey: (doc) => `${doc.tenantId}:${doc._id}`,
      })

      expect(result.key).toBe('tenant-001:doc-456')
    })
  })

  describe('Metadata', () => {
    it('should include metadata when provided', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'metadata-test',
          name: 'Metadata Test',
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'metadata-test' },
      }

      const result = transformReplaceEvent(replaceEvent, {
        metadata: {
          source: 'change-stream',
          timestamp: 1234567890,
        },
      })

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.source).toBe('change-stream')
      expect(result.metadata?.timestamp).toBe(1234567890)
    })

    it('should not include metadata when not provided', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'no-metadata',
          name: 'No Metadata',
          count: 1,
          tags: [],
        },
        documentKey: { _id: 'no-metadata' },
      }

      const result = transformReplaceEvent(replaceEvent)

      expect(result.metadata).toBeUndefined()
    })
  })

  describe('Value Transformer', () => {
    it('should transform value when transformValue is provided', () => {
      const replaceEvent: MongoReplaceEvent<TestDocument> = {
        operationType: 'replace',
        fullDocument: {
          _id: 'transform-test',
          name: 'lowercase',
          count: 10,
          tags: ['a', 'b'],
        },
        documentKey: { _id: 'transform-test' },
      }

      const result = transformReplaceEvent(replaceEvent, {
        transformValue: (doc) => ({
          ...doc,
          name: doc.name.toUpperCase(),
          count: doc.count * 2,
        }),
      })

      expect(result.value.name).toBe('LOWERCASE')
      expect(result.value.count).toBe(20)
    })
  })
})

// ============================================================================
// Previous Value Tracking Tests
// ============================================================================

describe('transformReplaceEvent Previous Value Tracking', () => {
  it('should include previousValue when includePreviousValue is true', () => {
    const previousDoc: TestDocument = {
      _id: 'doc-123',
      name: 'Old Name',
      count: 5,
      tags: ['old'],
    }

    const replaceEvent: MongoReplaceEvent<TestDocument> = {
      operationType: 'replace',
      fullDocument: {
        _id: 'doc-123',
        name: 'New Name',
        count: 10,
        tags: ['new'],
      },
      documentKey: { _id: 'doc-123' },
    }

    const result = transformReplaceEvent(replaceEvent, {
      includePreviousValue: true,
      previousValue: previousDoc,
    })

    expect(result.previousValue).toBeDefined()
    expect(result.previousValue?._id).toBe('doc-123')
    expect(result.previousValue?.name).toBe('Old Name')
    expect(result.previousValue?.count).toBe(5)
  })

  it('should not include previousValue when includePreviousValue is false', () => {
    const previousDoc: TestDocument = {
      _id: 'doc-123',
      name: 'Old Name',
      count: 5,
      tags: ['old'],
    }

    const replaceEvent: MongoReplaceEvent<TestDocument> = {
      operationType: 'replace',
      fullDocument: {
        _id: 'doc-123',
        name: 'New Name',
        count: 10,
        tags: ['new'],
      },
      documentKey: { _id: 'doc-123' },
    }

    const result = transformReplaceEvent(replaceEvent, {
      includePreviousValue: false,
      previousValue: previousDoc,
    })

    expect(result.previousValue).toBeUndefined()
  })

  it('should not include previousValue when previousValue is not provided', () => {
    const replaceEvent: MongoReplaceEvent<TestDocument> = {
      operationType: 'replace',
      fullDocument: {
        _id: 'doc-123',
        name: 'New Name',
        count: 10,
        tags: ['new'],
      },
      documentKey: { _id: 'doc-123' },
    }

    const result = transformReplaceEvent(replaceEvent, {
      includePreviousValue: true,
    })

    expect(result.previousValue).toBeUndefined()
  })

  it('should return a copy of previousValue, not a reference', () => {
    const previousDoc: TestDocument = {
      _id: 'doc-123',
      name: 'Old Name',
      count: 5,
      tags: ['old'],
    }

    const replaceEvent: MongoReplaceEvent<TestDocument> = {
      operationType: 'replace',
      fullDocument: {
        _id: 'doc-123',
        name: 'New Name',
        count: 10,
        tags: ['new'],
      },
      documentKey: { _id: 'doc-123' },
    }

    const result = transformReplaceEvent(replaceEvent, {
      includePreviousValue: true,
      previousValue: previousDoc,
    })

    expect(result.previousValue).not.toBe(previousDoc)
    expect(result.previousValue).toEqual(previousDoc)
  })
})

// ============================================================================
// Diff Generation Tests
// ============================================================================

describe('generateDocumentDiff', () => {
  it('should identify added fields', () => {
    const previous = { _id: '1', name: 'Old' }
    const current = { _id: '1', name: 'Old', newField: 'added' }

    const diff = generateDocumentDiff(previous, current)

    expect(diff.addedFields).toEqual({ newField: 'added' })
    expect(diff.removedFields).toHaveLength(0)
    expect(diff.modifiedFields).toEqual({})
  })

  it('should identify removed fields', () => {
    const previous = { _id: '1', name: 'Old', removed: 'value' }
    const current = { _id: '1', name: 'Old' }

    const diff = generateDocumentDiff(previous, current)

    expect(diff.removedFields).toContain('removed')
    expect(diff.addedFields).toEqual({})
  })

  it('should identify modified fields', () => {
    const previous = { _id: '1', name: 'Old', count: 5 }
    const current = { _id: '1', name: 'New', count: 5 }

    const diff = generateDocumentDiff(previous, current)

    expect(diff.modifiedFields).toEqual({ name: 'New' })
    expect(diff.unchangedFields).toContain('_id')
    expect(diff.unchangedFields).toContain('count')
  })

  it('should identify unchanged fields', () => {
    const previous = { _id: '1', name: 'Same', count: 10 }
    const current = { _id: '1', name: 'Same', count: 10 }

    const diff = generateDocumentDiff(previous, current)

    expect(diff.unchangedFields).toContain('_id')
    expect(diff.unchangedFields).toContain('name')
    expect(diff.unchangedFields).toContain('count')
    expect(diff.addedFields).toEqual({})
    expect(diff.removedFields).toHaveLength(0)
    expect(diff.modifiedFields).toEqual({})
  })

  it('should handle complex documents with all change types', () => {
    interface ComplexDoc {
      _id: string
      unchanged: string
      modified: number
      removed?: string
      added?: string
    }

    const previous: ComplexDoc = {
      _id: '1',
      unchanged: 'same',
      modified: 5,
      removed: 'gone',
    }

    const current: ComplexDoc = {
      _id: '1',
      unchanged: 'same',
      modified: 10,
      added: 'new',
    }

    const diff = generateDocumentDiff(previous, current)

    expect(diff.addedFields).toEqual({ added: 'new' })
    expect(diff.removedFields).toContain('removed')
    expect(diff.modifiedFields).toEqual({ modified: 10 })
    expect(diff.unchangedFields).toContain('_id')
    expect(diff.unchangedFields).toContain('unchanged')
  })

  it('should handle nested objects as modified when content changes', () => {
    interface NestedDoc {
      _id: string
      nested: { value: number }
    }

    const previous: NestedDoc = { _id: '1', nested: { value: 1 } }
    const current: NestedDoc = { _id: '1', nested: { value: 2 } }

    const diff = generateDocumentDiff(previous, current)

    expect(diff.modifiedFields).toEqual({ nested: { value: 2 } })
  })

  it('should handle nested objects as unchanged when content is same', () => {
    interface NestedDoc {
      _id: string
      nested: { value: number }
    }

    const previous: NestedDoc = { _id: '1', nested: { value: 1 } }
    const current: NestedDoc = { _id: '1', nested: { value: 1 } }

    const diff = generateDocumentDiff(previous, current)

    expect(diff.unchangedFields).toContain('nested')
    expect(diff.modifiedFields).toEqual({})
  })

  it('should handle arrays as modified when content changes', () => {
    interface ArrayDoc {
      _id: string
      tags: string[]
    }

    const previous: ArrayDoc = { _id: '1', tags: ['a', 'b'] }
    const current: ArrayDoc = { _id: '1', tags: ['a', 'c'] }

    const diff = generateDocumentDiff(previous, current)

    expect(diff.modifiedFields).toEqual({ tags: ['a', 'c'] })
  })

  it('should handle arrays as unchanged when content is same', () => {
    interface ArrayDoc {
      _id: string
      tags: string[]
    }

    const previous: ArrayDoc = { _id: '1', tags: ['a', 'b'] }
    const current: ArrayDoc = { _id: '1', tags: ['a', 'b'] }

    const diff = generateDocumentDiff(previous, current)

    expect(diff.unchangedFields).toContain('tags')
  })

  it('should handle Date objects correctly', () => {
    interface DateDoc {
      _id: string
      createdAt: Date
      updatedAt: Date
    }

    const date1 = new Date('2024-01-01')
    const date2 = new Date('2024-06-15')

    const previous: DateDoc = { _id: '1', createdAt: date1, updatedAt: date1 }
    const current: DateDoc = { _id: '1', createdAt: date1, updatedAt: date2 }

    const diff = generateDocumentDiff(previous, current)

    expect(diff.unchangedFields).toContain('createdAt')
    expect(diff.modifiedFields.updatedAt).toEqual(date2)
  })

  it('should handle null values', () => {
    interface NullableDoc {
      _id: string
      value: string | null
    }

    const previous: NullableDoc = { _id: '1', value: 'not null' }
    const current: NullableDoc = { _id: '1', value: null }

    const diff = generateDocumentDiff(previous, current)

    expect(diff.modifiedFields).toEqual({ value: null })
  })
})

describe('transformReplaceEvent with Diff Generation', () => {
  it('should include diff in metadata when generateDiff is true', () => {
    const previousDoc: TestDocument = {
      _id: 'doc-123',
      name: 'Old Name',
      count: 5,
      tags: ['old'],
    }

    const replaceEvent: MongoReplaceEvent<TestDocument> = {
      operationType: 'replace',
      fullDocument: {
        _id: 'doc-123',
        name: 'New Name',
        count: 10,
        tags: ['new'],
      },
      documentKey: { _id: 'doc-123' },
    }

    const result = transformReplaceEvent(replaceEvent, {
      previousValue: previousDoc,
      generateDiff: true,
    })

    expect(result.metadata).toBeDefined()
    expect(result.metadata?.diff).toBeDefined()

    const diff = result.metadata?.diff as DocumentDiff<TestDocument>
    expect(diff.modifiedFields.name).toBe('New Name')
    expect(diff.modifiedFields.count).toBe(10)
    expect(diff.unchangedFields).toContain('_id')
  })

  it('should not include diff when generateDiff is false', () => {
    const previousDoc: TestDocument = {
      _id: 'doc-123',
      name: 'Old Name',
      count: 5,
      tags: ['old'],
    }

    const replaceEvent: MongoReplaceEvent<TestDocument> = {
      operationType: 'replace',
      fullDocument: {
        _id: 'doc-123',
        name: 'New Name',
        count: 10,
        tags: ['new'],
      },
      documentKey: { _id: 'doc-123' },
    }

    const result = transformReplaceEvent(replaceEvent, {
      previousValue: previousDoc,
      generateDiff: false,
    })

    expect(result.metadata).toBeUndefined()
  })

  it('should not generate diff when previousValue is not provided', () => {
    const replaceEvent: MongoReplaceEvent<TestDocument> = {
      operationType: 'replace',
      fullDocument: {
        _id: 'doc-123',
        name: 'New Name',
        count: 10,
        tags: ['new'],
      },
      documentKey: { _id: 'doc-123' },
    }

    const result = transformReplaceEvent(replaceEvent, {
      generateDiff: true,
    })

    expect(result.metadata).toBeUndefined()
  })

  it('should combine user metadata with generated diff', () => {
    const previousDoc: TestDocument = {
      _id: 'doc-123',
      name: 'Old Name',
      count: 5,
      tags: ['old'],
    }

    const replaceEvent: MongoReplaceEvent<TestDocument> = {
      operationType: 'replace',
      fullDocument: {
        _id: 'doc-123',
        name: 'New Name',
        count: 10,
        tags: ['new'],
      },
      documentKey: { _id: 'doc-123' },
    }

    const result = transformReplaceEvent(replaceEvent, {
      previousValue: previousDoc,
      generateDiff: true,
      metadata: {
        source: 'test',
        timestamp: 123456,
      },
    })

    expect(result.metadata?.source).toBe('test')
    expect(result.metadata?.timestamp).toBe(123456)
    expect(result.metadata?.diff).toBeDefined()
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('transformReplaceEvent Error Handling', () => {
  it('should throw when event is null', () => {
    expect(() => transformReplaceEvent(null as any)).toThrow('Replace event is required')
  })

  it('should throw when event is undefined', () => {
    expect(() => transformReplaceEvent(undefined as any)).toThrow('Replace event is required')
  })

  it('should throw when operationType is not "replace"', () => {
    const invalidEvent = {
      operationType: 'update',
      fullDocument: { _id: 'test', name: 'Test', count: 1, tags: [] },
      documentKey: { _id: 'test' },
    }

    expect(() => transformReplaceEvent(invalidEvent as any)).toThrow(
      "Invalid operation type: expected 'replace', got 'update'"
    )
  })

  it('should throw when fullDocument is missing', () => {
    const invalidEvent = {
      operationType: 'replace',
      documentKey: { _id: 'test' },
    }

    expect(() => transformReplaceEvent(invalidEvent as any)).toThrow(
      'Replace event must contain fullDocument'
    )
  })

  it('should throw when documentKey is missing', () => {
    const invalidEvent = {
      operationType: 'replace',
      fullDocument: { _id: 'test', name: 'Test', count: 1, tags: [] },
    }

    expect(() => transformReplaceEvent(invalidEvent as any)).toThrow(
      'Replace event must contain documentKey'
    )
  })

  it('should throw when documentKey._id is missing', () => {
    const invalidEvent = {
      operationType: 'replace',
      fullDocument: { _id: 'test', name: 'Test', count: 1, tags: [] },
      documentKey: {},
    }

    expect(() => transformReplaceEvent(invalidEvent as any)).toThrow(
      'Replace event documentKey must contain _id'
    )
  })

  it('should throw when documentKey._id is null', () => {
    const invalidEvent = {
      operationType: 'replace',
      fullDocument: { _id: 'test', name: 'Test', count: 1, tags: [] },
      documentKey: { _id: null },
    }

    expect(() => transformReplaceEvent(invalidEvent as any)).toThrow(
      'Replace event documentKey must contain _id'
    )
  })
})

// ============================================================================
// Type Safety Tests for Options
// ============================================================================

describe('ReplaceTransformOptions Type Safety', () => {
  it('should have correct types for all options', () => {
    const options: ReplaceTransformOptions<TestDocument> = {
      getKey: (doc) => doc._id,
      metadata: { custom: 'value' },
      transformValue: (doc) => doc,
      includePreviousValue: true,
      previousValue: { _id: '1', name: 'Test', count: 0, tags: [] },
      generateDiff: true,
    }

    expectTypeOf(options.getKey).toMatchTypeOf<((doc: TestDocument) => string) | undefined>()
    expectTypeOf(options.metadata).toMatchTypeOf<Record<string, unknown> | undefined>()
    expectTypeOf(options.previousValue).toMatchTypeOf<TestDocument | undefined>()
  })
})

describe('DocumentDiff Type Safety', () => {
  it('should have correct types for diff result', () => {
    const diff: DocumentDiff<TestDocument> = {
      addedFields: { name: 'new' },
      removedFields: ['count'],
      modifiedFields: { tags: ['a'] },
      unchangedFields: ['_id'],
    }

    expectTypeOf(diff.addedFields).toMatchTypeOf<Partial<TestDocument>>()
    expectTypeOf(diff.removedFields).toMatchTypeOf<(keyof TestDocument)[]>()
    expectTypeOf(diff.modifiedFields).toMatchTypeOf<Partial<TestDocument>>()
    expectTypeOf(diff.unchangedFields).toMatchTypeOf<(keyof TestDocument)[]>()
  })
})
