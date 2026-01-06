/**
 * @file Sort Compiler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the sort compiler functions that
 * transform TanStack DB sort expressions into MongoDB $sort format.
 *
 * The sort compiler handles the transformation of:
 * - Single field sorting (ascending/descending)
 * - Multi-field sorting with priority order
 * - Nested field path sorting (e.g., "address.city")
 * - Array field sorting
 * - Case-insensitive sorting options
 * - Null value handling in sort order
 * - Sort stability guarantees
 * - Integration with MongoDB $sort
 *
 * This enables TanStack DB collections to be sorted via the mongo.do service.
 *
 * RED PHASE: These tests define expected behavior. Some will pass (basic features
 * already implemented), others will fail for unimplemented features.
 *
 * Bead ID: tanstackdb-po0.141 (RED tests)
 *
 * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/sort/
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  compileSortExpression,
  compileSortExpressions,
  createSortExpression,
  SortCompilationError,
  type SortExpression,
} from '../../src/query/sort-compiler'
import { createRef } from '../../src/query/predicate-compiler'
import type { SortSpec, SortDirection } from '../../src/types'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing sort operations.
 */
interface TestDocument {
  _id: string
  name: string
  age: number
  createdAt: Date
  score: number
  status: 'active' | 'inactive' | 'pending'
  address: {
    city: string
    country: string
    zip: string
  }
  tags: string[]
  metrics: {
    views: number
    likes: number
    engagement: {
      shares: number
      comments: number
    }
  }
}

// =============================================================================
// createSortExpression Helper Tests
// =============================================================================

describe('createSortExpression', () => {
  describe('Basic Field Sorting', () => {
    it('should create ascending sort expression for simple field', () => {
      const expr = createSortExpression('name', 'asc')
      expect(expr).toEqual({
        type: 'func',
        name: 'asc',
        args: [{ type: 'ref', path: ['name'] }],
      })
    })

    it('should create descending sort expression for simple field', () => {
      const expr = createSortExpression('createdAt', 'desc')
      expect(expr).toEqual({
        type: 'func',
        name: 'desc',
        args: [{ type: 'ref', path: ['createdAt'] }],
      })
    })

    it('should create sort expression for _id field', () => {
      const expr = createSortExpression('_id', 'asc')
      expect(expr).toEqual({
        type: 'func',
        name: 'asc',
        args: [{ type: 'ref', path: ['_id'] }],
      })
    })
  })

  describe('Nested Field Paths', () => {
    it('should create sort expression for single-level nested field', () => {
      const expr = createSortExpression('address.city', 'asc')
      expect(expr).toEqual({
        type: 'func',
        name: 'asc',
        args: [{ type: 'ref', path: ['address', 'city'] }],
      })
    })

    it('should create sort expression for deeply nested field', () => {
      const expr = createSortExpression('metrics.engagement.shares', 'desc')
      expect(expr).toEqual({
        type: 'func',
        name: 'desc',
        args: [{ type: 'ref', path: ['metrics', 'engagement', 'shares'] }],
      })
    })

    it('should handle multiple levels of nesting', () => {
      const expr = createSortExpression('a.b.c.d.e', 'asc')
      expect(expr).toEqual({
        type: 'func',
        name: 'asc',
        args: [{ type: 'ref', path: ['a', 'b', 'c', 'd', 'e'] }],
      })
    })
  })

  describe('Type Safety', () => {
    it('should return correct SortExpression type', () => {
      const expr = createSortExpression('name', 'asc')
      expectTypeOf(expr).toMatchTypeOf<SortExpression>()
    })

    it('should have correct type property', () => {
      const expr = createSortExpression('name', 'asc')
      expect(expr.type).toBe('func')
    })

    it('should only accept asc or desc as direction (compile-time check)', () => {
      // These should compile
      createSortExpression('name', 'asc')
      createSortExpression('name', 'desc')

      // TypeScript catches invalid directions at compile time
      // The @ts-expect-error directive proves the type system rejects invalid values
      // @ts-expect-error - Invalid direction (TypeScript will error here)
      const _invalidExpr = createSortExpression('name', 'ascending')

      // Runtime behavior: the function will still create an expression
      // but it won't be a valid SortExpression type for compile
      expect(_invalidExpr.type).toBe('func')
    })
  })
})

// =============================================================================
// compileSortExpression Single Field Tests
// =============================================================================

describe('compileSortExpression', () => {
  describe('Single Field Ascending', () => {
    it('should compile ascending sort to MongoDB format', () => {
      const expr = createSortExpression('name', 'asc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ name: 1 })
    })

    it('should compile ascending sort for _id field', () => {
      const expr = createSortExpression('_id', 'asc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ _id: 1 })
    })

    it('should compile ascending sort for numeric field', () => {
      const expr = createSortExpression('age', 'asc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ age: 1 })
    })

    it('should compile ascending sort for date field', () => {
      const expr = createSortExpression('createdAt', 'asc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ createdAt: 1 })
    })
  })

  describe('Single Field Descending', () => {
    it('should compile descending sort to MongoDB format', () => {
      const expr = createSortExpression('name', 'desc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ name: -1 })
    })

    it('should compile descending sort for _id field', () => {
      const expr = createSortExpression('_id', 'desc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ _id: -1 })
    })

    it('should compile descending sort for score field', () => {
      const expr = createSortExpression('score', 'desc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ score: -1 })
    })

    it('should compile descending sort for createdAt (newest first)', () => {
      const expr = createSortExpression('createdAt', 'desc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ createdAt: -1 })
    })
  })

  describe('Nested Field Path Sorting', () => {
    it('should compile single-level nested field sort', () => {
      const expr = createSortExpression('address.city', 'asc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ 'address.city': 1 })
    })

    it('should compile double-level nested field sort', () => {
      const expr = createSortExpression('metrics.engagement.shares', 'desc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ 'metrics.engagement.shares': -1 })
    })

    it('should compile nested field with ascending direction', () => {
      const expr = createSortExpression('address.country', 'asc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ 'address.country': 1 })
    })

    it('should compile deeply nested field path correctly', () => {
      const expr = createSortExpression('a.b.c.d', 'desc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ 'a.b.c.d': -1 })
    })
  })

  describe('Error Handling', () => {
    it('should throw SortCompilationError for invalid expression type', () => {
      const invalidExpr = {
        type: 'val',
        value: 'name',
      }
      // @ts-expect-error - Testing invalid input
      expect(() => compileSortExpression(invalidExpr)).toThrow(SortCompilationError)
    })

    it('should throw SortCompilationError for invalid function name', () => {
      const invalidExpr = {
        type: 'func',
        name: 'eq',
        args: [{ type: 'ref', path: ['name'] }],
      }
      // @ts-expect-error - Testing invalid input
      expect(() => compileSortExpression(invalidExpr)).toThrow(SortCompilationError)
    })

    it('should throw SortCompilationError for missing arguments', () => {
      const invalidExpr = {
        type: 'func',
        name: 'asc',
        args: [],
      }
      // @ts-expect-error - Testing invalid input
      expect(() => compileSortExpression(invalidExpr)).toThrow(SortCompilationError)
    })

    it('should throw SortCompilationError for non-ref argument', () => {
      const invalidExpr = {
        type: 'func',
        name: 'asc',
        args: [{ type: 'val', value: 'name' }],
      }
      // @ts-expect-error - Testing invalid input
      expect(() => compileSortExpression(invalidExpr)).toThrow(SortCompilationError)
    })

    it('should throw SortCompilationError for too many arguments', () => {
      const invalidExpr = {
        type: 'func',
        name: 'asc',
        args: [
          { type: 'ref', path: ['name'] },
          { type: 'ref', path: ['age'] },
        ],
      }
      // @ts-expect-error - Testing invalid input
      expect(() => compileSortExpression(invalidExpr)).toThrow(SortCompilationError)
    })
  })
})

// =============================================================================
// compileSortExpressions Multi-Field Tests
// =============================================================================

describe('compileSortExpressions', () => {
  describe('Empty and Single Field', () => {
    it('should return empty object for empty array', () => {
      const result = compileSortExpressions([])
      expect(result).toEqual({})
    })

    it('should compile single expression correctly', () => {
      const expr = createSortExpression('name', 'asc')
      const result = compileSortExpressions([expr])
      expect(result).toEqual({ name: 1 })
    })
  })

  describe('Multi-Field Priority Sorting', () => {
    it('should compile multiple fields in priority order', () => {
      const expressions = [
        createSortExpression('status', 'asc'),
        createSortExpression('createdAt', 'desc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({ status: 1, createdAt: -1 })
    })

    it('should preserve field order for proper priority', () => {
      const expressions = [
        createSortExpression('lastName', 'asc'),
        createSortExpression('firstName', 'asc'),
        createSortExpression('age', 'desc'),
      ]
      const result = compileSortExpressions(expressions)

      // Check keys are in correct order
      const keys = Object.keys(result)
      expect(keys).toEqual(['lastName', 'firstName', 'age'])
      expect(result).toEqual({ lastName: 1, firstName: 1, age: -1 })
    })

    it('should handle mixed ascending and descending', () => {
      const expressions = [
        createSortExpression('priority', 'desc'),
        createSortExpression('name', 'asc'),
        createSortExpression('updatedAt', 'desc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({ priority: -1, name: 1, updatedAt: -1 })
    })

    it('should compile three-field sort for tie-breaking', () => {
      const expressions = [
        createSortExpression('score', 'desc'),
        createSortExpression('createdAt', 'asc'),
        createSortExpression('_id', 'asc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({ score: -1, createdAt: 1, _id: 1 })
    })
  })

  describe('Multi-Field with Nested Paths', () => {
    it('should compile mix of top-level and nested fields', () => {
      const expressions = [
        createSortExpression('address.country', 'asc'),
        createSortExpression('address.city', 'asc'),
        createSortExpression('name', 'asc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({
        'address.country': 1,
        'address.city': 1,
        name: 1,
      })
    })

    it('should compile deeply nested multi-field sort', () => {
      const expressions = [
        createSortExpression('metrics.views', 'desc'),
        createSortExpression('metrics.engagement.shares', 'desc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({
        'metrics.views': -1,
        'metrics.engagement.shares': -1,
      })
    })
  })

  describe('Duplicate Field Handling', () => {
    it('should let last occurrence win for duplicate fields', () => {
      const expressions = [
        createSortExpression('name', 'asc'),
        createSortExpression('name', 'desc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({ name: -1 })
    })

    it('should handle duplicate nested field paths', () => {
      const expressions = [
        createSortExpression('address.city', 'asc'),
        createSortExpression('address.city', 'desc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({ 'address.city': -1 })
    })
  })
})

// =============================================================================
// Array Field Sorting Tests (RED - May need implementation)
// =============================================================================

describe('Array Field Sorting', () => {
  describe('Basic Array Field Sort', () => {
    it('should compile sort on array field (first element comparison)', () => {
      const expr = createSortExpression('tags', 'asc')
      const result = compileSortExpression(expr)
      // MongoDB sorts arrays by their smallest/largest element
      expect(result).toEqual({ tags: 1 })
    })

    it('should compile descending sort on array field', () => {
      const expr = createSortExpression('tags', 'desc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ tags: -1 })
    })
  })

  describe('Array Element Access Sorting (RED - Unimplemented)', () => {
    it.skip('should compile sort on specific array index', () => {
      // This would require extended syntax like "tags.0"
      const expr = createSortExpression('tags.0', 'asc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ 'tags.0': 1 })
    })

    it.skip('should compile sort using $first array operator', () => {
      // Future: Support for array operators in sort
      // { $sort: { tags: { $first: 1 } } }
      expect(true).toBe(false) // Placeholder
    })
  })
})

// =============================================================================
// Case-Insensitive Sorting Tests (RED - Unimplemented)
// =============================================================================

describe('Case-Insensitive Sorting (RED - Unimplemented)', () => {
  describe('Collation-Based Case Insensitivity', () => {
    it.skip('should support case-insensitive sort option', () => {
      // Future feature: createSortExpression('name', 'asc', { caseInsensitive: true })
      // Should generate collation option for MongoDB
      expect(true).toBe(false) // Placeholder
    })

    it.skip('should compile sort with collation strength 2 (case-insensitive)', () => {
      // MongoDB collation: { locale: 'en', strength: 2 }
      expect(true).toBe(false) // Placeholder
    })

    it.skip('should allow per-field case sensitivity options', () => {
      // Some fields case-sensitive, others not
      expect(true).toBe(false) // Placeholder
    })
  })

  describe('Manual Case Normalization', () => {
    it.skip('should support $toLower projection for sorting', () => {
      // Alternative: Use $toLower in aggregation pipeline
      expect(true).toBe(false) // Placeholder
    })
  })
})

// =============================================================================
// Null Value Handling Tests (RED - Unimplemented)
// =============================================================================

describe('Null Value Handling in Sort Order (RED - Unimplemented)', () => {
  describe('Default Null Behavior', () => {
    it.skip('should compile sort with nulls-first option', () => {
      // Future: createSortExpression('name', 'asc', { nulls: 'first' })
      expect(true).toBe(false) // Placeholder
    })

    it.skip('should compile sort with nulls-last option', () => {
      // Future: createSortExpression('name', 'asc', { nulls: 'last' })
      expect(true).toBe(false) // Placeholder
    })

    it.skip('should handle missing fields in sort (treated as null)', () => {
      // MongoDB treats missing fields as null
      expect(true).toBe(false) // Placeholder
    })
  })

  describe('Null Filtering with Sort', () => {
    it.skip('should support excluding nulls from sort results', () => {
      // Future: Combine with filter { field: { $ne: null } }
      expect(true).toBe(false) // Placeholder
    })
  })
})

// =============================================================================
// Sort Stability Tests (RED - Unimplemented)
// =============================================================================

describe('Sort Stability Guarantees (RED - Unimplemented)', () => {
  describe('Tie-Breaking with _id', () => {
    it.skip('should automatically add _id for stable sorting', () => {
      // Future: compileSortExpressions([...], { stable: true })
      // Should append _id: 1 if not present
      expect(true).toBe(false) // Placeholder
    })

    it.skip('should not duplicate _id if already present', () => {
      // If _id is in sort, don't add again
      expect(true).toBe(false) // Placeholder
    })

    it.skip('should preserve user-specified _id direction', () => {
      // If user specified _id: -1, keep it
      expect(true).toBe(false) // Placeholder
    })
  })

  describe('Deterministic Ordering', () => {
    it.skip('should warn when sort lacks unique field', () => {
      // Dev warning if sort doesn't include _id or unique field
      expect(true).toBe(false) // Placeholder
    })
  })
})

// =============================================================================
// MongoDB $sort Integration Tests
// =============================================================================

describe('MongoDB $sort Integration', () => {
  describe('$sort Operator Compatibility', () => {
    it('should produce output compatible with MongoDB $sort stage', () => {
      const expressions = [
        createSortExpression('status', 'asc'),
        createSortExpression('createdAt', 'desc'),
      ]
      const result = compileSortExpressions(expressions)

      // Result should be directly usable in: { $sort: result }
      expect(result).toEqual({ status: 1, createdAt: -1 })
      expect(typeof result).toBe('object')
      expect(Object.values(result).every((v) => v === 1 || v === -1)).toBe(true)
    })

    it('should produce numeric sort directions (1/-1)', () => {
      const expr = createSortExpression('name', 'asc')
      const result = compileSortExpression(expr)

      expect(result.name).toBe(1)
      expect(typeof result.name).toBe('number')
    })

    it('should use dot notation for nested paths', () => {
      const expr = createSortExpression('user.profile.lastName', 'asc')
      const result = compileSortExpression(expr)

      // Must use dot notation, not nested object
      expect(result).toEqual({ 'user.profile.lastName': 1 })
      expect(Object.keys(result)).toEqual(['user.profile.lastName'])
    })
  })

  describe('Aggregation Pipeline Usage', () => {
    it('should compile sort for use in aggregation pipeline', () => {
      const expressions = [
        createSortExpression('score', 'desc'),
        createSortExpression('_id', 'asc'),
      ]
      const sortSpec = compileSortExpressions(expressions)

      // Verify it can be used in pipeline
      const pipeline = [
        { $match: { status: 'active' } },
        { $sort: sortSpec },
      ]

      expect(pipeline[1]).toEqual({ $sort: { score: -1, _id: 1 } })
    })
  })

  describe('Find Query Usage', () => {
    it('should compile sort for use with find().sort()', () => {
      const expressions = [
        createSortExpression('name', 'asc'),
      ]
      const sortSpec = compileSortExpressions(expressions)

      // The result should work with: collection.find().sort(sortSpec)
      expect(sortSpec).toEqual({ name: 1 })
    })
  })
})

// =============================================================================
// Type Safety and Return Type Tests
// =============================================================================

describe('Type Safety', () => {
  it('should return SortSpec type from compileSortExpression', () => {
    const result = compileSortExpression(createSortExpression('name', 'asc'))
    expectTypeOf(result).toMatchTypeOf<SortSpec>()
  })

  it('should return SortSpec type from compileSortExpressions', () => {
    const result = compileSortExpressions([createSortExpression('name', 'asc')])
    expectTypeOf(result).toMatchTypeOf<SortSpec>()
  })

  it('should have SortDirection values in result', () => {
    const result = compileSortExpression(createSortExpression('name', 'asc'))
    expectTypeOf(result.name).toMatchTypeOf<SortDirection>()
  })

  it('should accept SortExpression type', () => {
    const expr: SortExpression = {
      type: 'func',
      name: 'asc',
      args: [{ type: 'ref', path: ['name'] }],
    }
    expectTypeOf(expr).toMatchTypeOf<SortExpression>()

    // Should compile without error
    const result = compileSortExpression(expr)
    expect(result).toEqual({ name: 1 })
  })
})

// =============================================================================
// Real-World Usage Patterns
// =============================================================================

describe('Real-World Usage Patterns', () => {
  describe('Leaderboard Sorting', () => {
    it('should compile leaderboard sort (highest score first)', () => {
      const expressions = [
        createSortExpression('score', 'desc'),
        createSortExpression('createdAt', 'asc'), // Earlier submission wins tie
        createSortExpression('_id', 'asc'), // Deterministic tie-breaker
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({ score: -1, createdAt: 1, _id: 1 })
    })
  })

  describe('Timeline/Feed Sorting', () => {
    it('should compile timeline sort (newest first)', () => {
      const expressions = [
        createSortExpression('createdAt', 'desc'),
        createSortExpression('_id', 'desc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({ createdAt: -1, _id: -1 })
    })

    it('should compile activity feed with priority', () => {
      const expressions = [
        createSortExpression('isPinned', 'desc'), // Pinned items first
        createSortExpression('timestamp', 'desc'), // Then by time
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({ isPinned: -1, timestamp: -1 })
    })
  })

  describe('Alphabetical Directory Sorting', () => {
    it('should compile alphabetical name sort', () => {
      const expressions = [
        createSortExpression('lastName', 'asc'),
        createSortExpression('firstName', 'asc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({ lastName: 1, firstName: 1 })
    })
  })

  describe('E-commerce Product Sorting', () => {
    it('should compile price low-to-high sort', () => {
      const expressions = [
        createSortExpression('price', 'asc'),
        createSortExpression('_id', 'asc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({ price: 1, _id: 1 })
    })

    it('should compile price high-to-low sort', () => {
      const expressions = [
        createSortExpression('price', 'desc'),
        createSortExpression('_id', 'asc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({ price: -1, _id: 1 })
    })

    it('should compile popularity sort with nested rating', () => {
      const expressions = [
        createSortExpression('metrics.rating', 'desc'),
        createSortExpression('metrics.reviewCount', 'desc'),
        createSortExpression('_id', 'asc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({
        'metrics.rating': -1,
        'metrics.reviewCount': -1,
        _id: 1,
      })
    })
  })

  describe('Geographic Sorting', () => {
    it('should compile location-based sort by region', () => {
      const expressions = [
        createSortExpression('address.country', 'asc'),
        createSortExpression('address.city', 'asc'),
        createSortExpression('name', 'asc'),
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({
        'address.country': 1,
        'address.city': 1,
        name: 1,
      })
    })
  })

  describe('Task/Todo Sorting', () => {
    it('should compile task priority sort', () => {
      const expressions = [
        createSortExpression('priority', 'desc'), // Highest priority first
        createSortExpression('dueDate', 'asc'), // Earliest deadline first
        createSortExpression('createdAt', 'asc'), // Oldest task first for equal priority/date
      ]
      const result = compileSortExpressions(expressions)
      expect(result).toEqual({
        priority: -1,
        dueDate: 1,
        createdAt: 1,
      })
    })
  })
})

// =============================================================================
// Edge Cases and Boundary Conditions
// =============================================================================

describe('Edge Cases and Boundary Conditions', () => {
  describe('Field Name Edge Cases', () => {
    it('should handle single-character field names', () => {
      const expr = createSortExpression('x', 'asc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ x: 1 })
    })

    it('should handle very long field names', () => {
      const longName = 'a'.repeat(100)
      const expr = createSortExpression(longName, 'asc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ [longName]: 1 })
    })

    it('should handle field names with numbers', () => {
      const expr = createSortExpression('field123', 'asc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ field123: 1 })
    })

    it('should handle field names starting with underscore', () => {
      const expr = createSortExpression('_customField', 'desc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ _customField: -1 })
    })

    it('should handle camelCase field names', () => {
      const expr = createSortExpression('createdByUserId', 'asc')
      const result = compileSortExpression(expr)
      expect(result).toEqual({ createdByUserId: 1 })
    })
  })

  describe('Large Sort Specifications', () => {
    it('should handle many sort fields', () => {
      const expressions = Array.from({ length: 10 }, (_, i) =>
        createSortExpression(`field${i}`, i % 2 === 0 ? 'asc' : 'desc')
      )
      const result = compileSortExpressions(expressions)

      expect(Object.keys(result).length).toBe(10)
      expect(result.field0).toBe(1)
      expect(result.field1).toBe(-1)
      expect(result.field9).toBe(-1)
    })
  })

  describe('PropRef Compatibility', () => {
    it('should work with manually created PropRef', () => {
      const ref = createRef('name')
      const expr: SortExpression = {
        type: 'func',
        name: 'desc',
        args: [ref],
      }
      const result = compileSortExpression(expr)
      expect(result).toEqual({ name: -1 })
    })

    it('should work with nested PropRef', () => {
      const ref = createRef('metrics.engagement.shares')
      const expr: SortExpression = {
        type: 'func',
        name: 'asc',
        args: [ref],
      }
      const result = compileSortExpression(expr)
      expect(result).toEqual({ 'metrics.engagement.shares': 1 })
    })
  })
})

// =============================================================================
// Performance Considerations
// =============================================================================

describe('Performance Considerations', () => {
  it('should compile single expression efficiently', () => {
    const expr = createSortExpression('name', 'asc')

    // Compile multiple times to ensure consistent performance
    const results: SortSpec[] = []
    for (let i = 0; i < 100; i++) {
      results.push(compileSortExpression(expr))
    }

    // All results should be structurally equal
    results.forEach((result) => {
      expect(result).toEqual({ name: 1 })
    })
  })

  it('should compile multiple expressions efficiently', () => {
    const expressions = [
      createSortExpression('status', 'asc'),
      createSortExpression('createdAt', 'desc'),
      createSortExpression('_id', 'asc'),
    ]

    const results: SortSpec[] = []
    for (let i = 0; i < 100; i++) {
      results.push(compileSortExpressions(expressions))
    }

    results.forEach((result) => {
      expect(result).toEqual({ status: 1, createdAt: -1, _id: 1 })
    })
  })
})
