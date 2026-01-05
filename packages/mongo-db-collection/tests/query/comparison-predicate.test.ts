/**
 * @file Comparison Predicate Compiler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for comparison predicate compilers that
 * transform TanStack DB comparison predicates into MongoDB query format.
 *
 * The comparison predicate compilers handle transformations of:
 * - $gt (greater than): BasicExpression<boolean> with 'gt' function -> { field: { $gt: value } }
 * - $gte (greater than or equal): 'gte' function -> { field: { $gte: value } }
 * - $lt (less than): 'lt' function -> { field: { $lt: value } }
 * - $lte (less than or equal): 'lte' function -> { field: { $lte: value } }
 * - $ne (not equal): 'ne' function -> { field: { $ne: value } }
 * - $in (in array): 'in' function -> { field: { $in: [values] } }
 * - $nin (not in array): 'nin' function -> { field: { $nin: [values] } }
 *
 * RED PHASE: These tests will fail until comparison predicate compilers are
 * implemented in src/query/predicate-compiler.ts
 *
 * @see https://www.mongodb.com/docs/manual/reference/operator/query-comparison/
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  compilePredicate,
  createRef,
  createValue,
  PredicateCompilationError,
} from '../../src/query/predicate-compiler'
import type { MongoFilterQuery, MongoComparisonOperators } from '../../src/types'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing comparison predicates.
 */
interface TestDocument {
  _id: string
  name: string
  age: number
  score: number
  price: number
  status: 'active' | 'inactive' | 'pending'
  createdAt: Date
  tags: string[]
}

/**
 * Document with nested objects for testing deep field comparisons.
 */
interface NestedDocument {
  _id: string
  user: {
    profile: {
      age: number
      score: number
    }
    settings: {
      level: number
      priority: 'low' | 'medium' | 'high'
    }
  }
  metrics: {
    views: number
    clicks: number
  }
}

/**
 * Document with various numeric types for comprehensive testing.
 */
interface NumericDocument {
  _id: string
  intValue: number
  floatValue: number
  negativeValue: number
  zeroValue: number
  bigNumber: number
}

// =============================================================================
// Helper Factory Functions
// =============================================================================

/**
 * Creates a greater-than expression (gt function).
 */
function createGtExpression<T>(fieldPath: string, value: T) {
  return {
    type: 'func' as const,
    name: 'gt',
    args: [createRef(fieldPath), createValue(value)],
  }
}

/**
 * Creates a greater-than-or-equal expression (gte function).
 */
function createGteExpression<T>(fieldPath: string, value: T) {
  return {
    type: 'func' as const,
    name: 'gte',
    args: [createRef(fieldPath), createValue(value)],
  }
}

/**
 * Creates a less-than expression (lt function).
 */
function createLtExpression<T>(fieldPath: string, value: T) {
  return {
    type: 'func' as const,
    name: 'lt',
    args: [createRef(fieldPath), createValue(value)],
  }
}

/**
 * Creates a less-than-or-equal expression (lte function).
 */
function createLteExpression<T>(fieldPath: string, value: T) {
  return {
    type: 'func' as const,
    name: 'lte',
    args: [createRef(fieldPath), createValue(value)],
  }
}

/**
 * Creates a not-equal expression (ne function).
 */
function createNeExpression<T>(fieldPath: string, value: T) {
  return {
    type: 'func' as const,
    name: 'ne',
    args: [createRef(fieldPath), createValue(value)],
  }
}

/**
 * Creates an in-array expression (in function).
 */
function createInExpression<T>(fieldPath: string, values: T[]) {
  return {
    type: 'func' as const,
    name: 'in',
    args: [createRef(fieldPath), createValue(values)],
  }
}

/**
 * Creates a not-in-array expression (nin function).
 */
function createNinExpression<T>(fieldPath: string, values: T[]) {
  return {
    type: 'func' as const,
    name: 'nin',
    args: [createRef(fieldPath), createValue(values)],
  }
}

// =============================================================================
// $gt (Greater Than) Predicate Tests
// =============================================================================

describe('Greater Than ($gt) Predicate', () => {
  describe('Numeric Comparisons', () => {
    it('should compile integer greater than comparison', () => {
      const predicate = createGtExpression('age', 18)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: { $gt: 18 } })
    })

    it('should compile floating point greater than comparison', () => {
      const predicate = createGtExpression('price', 99.99)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ price: { $gt: 99.99 } })
    })

    it('should compile zero greater than comparison', () => {
      const predicate = createGtExpression('score', 0)
      const result = compilePredicate<NumericDocument>(predicate)

      expect(result).toEqual({ score: { $gt: 0 } })
    })

    it('should compile negative number greater than comparison', () => {
      const predicate = createGtExpression('negativeValue', -100)
      const result = compilePredicate<NumericDocument>(predicate)

      expect(result).toEqual({ negativeValue: { $gt: -100 } })
    })

    it('should compile large number greater than comparison', () => {
      const predicate = createGtExpression('bigNumber', 1000000000)
      const result = compilePredicate<NumericDocument>(predicate)

      expect(result).toEqual({ bigNumber: { $gt: 1000000000 } })
    })
  })

  describe('Date Comparisons', () => {
    it('should compile Date greater than comparison', () => {
      const date = new Date('2024-01-01T00:00:00.000Z')
      const predicate = createGtExpression('createdAt', date)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ createdAt: { $gt: date } })
    })

    it('should compile timestamp greater than comparison', () => {
      const timestamp = Date.now()
      const predicate = createGtExpression('timestamp', timestamp)
      const result = compilePredicate(predicate)

      expect(result).toEqual({ timestamp: { $gt: timestamp } })
    })
  })

  describe('String Comparisons', () => {
    it('should compile string greater than comparison (lexicographic)', () => {
      const predicate = createGtExpression('name', 'John')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ name: { $gt: 'John' } })
    })
  })

  describe('Nested Field Comparisons', () => {
    it('should compile nested field greater than with dot notation', () => {
      const predicate = createGtExpression('user.profile.age', 21)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'user.profile.age': { $gt: 21 } })
    })

    it('should compile deeply nested field greater than', () => {
      const predicate = createGtExpression('metrics.views', 1000)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'metrics.views': { $gt: 1000 } })
    })
  })
})

// =============================================================================
// $gte (Greater Than or Equal) Predicate Tests
// =============================================================================

describe('Greater Than or Equal ($gte) Predicate', () => {
  describe('Numeric Comparisons', () => {
    it('should compile integer greater than or equal comparison', () => {
      const predicate = createGteExpression('age', 18)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: { $gte: 18 } })
    })

    it('should compile floating point greater than or equal comparison', () => {
      const predicate = createGteExpression('price', 49.99)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ price: { $gte: 49.99 } })
    })

    it('should compile zero greater than or equal comparison', () => {
      const predicate = createGteExpression('score', 0)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ score: { $gte: 0 } })
    })

    it('should compile negative number greater than or equal comparison', () => {
      const predicate = createGteExpression('negativeValue', -50)
      const result = compilePredicate<NumericDocument>(predicate)

      expect(result).toEqual({ negativeValue: { $gte: -50 } })
    })
  })

  describe('Date Comparisons', () => {
    it('should compile Date greater than or equal comparison', () => {
      const date = new Date('2024-06-15T12:00:00.000Z')
      const predicate = createGteExpression('createdAt', date)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ createdAt: { $gte: date } })
    })
  })

  describe('Nested Field Comparisons', () => {
    it('should compile nested field greater than or equal', () => {
      const predicate = createGteExpression('user.settings.level', 5)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'user.settings.level': { $gte: 5 } })
    })
  })
})

// =============================================================================
// $lt (Less Than) Predicate Tests
// =============================================================================

describe('Less Than ($lt) Predicate', () => {
  describe('Numeric Comparisons', () => {
    it('should compile integer less than comparison', () => {
      const predicate = createLtExpression('age', 65)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: { $lt: 65 } })
    })

    it('should compile floating point less than comparison', () => {
      const predicate = createLtExpression('price', 100.00)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ price: { $lt: 100.00 } })
    })

    it('should compile zero less than comparison', () => {
      const predicate = createLtExpression('score', 0)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ score: { $lt: 0 } })
    })

    it('should compile negative number less than comparison', () => {
      const predicate = createLtExpression('negativeValue', -10)
      const result = compilePredicate<NumericDocument>(predicate)

      expect(result).toEqual({ negativeValue: { $lt: -10 } })
    })
  })

  describe('Date Comparisons', () => {
    it('should compile Date less than comparison', () => {
      const date = new Date('2025-12-31T23:59:59.999Z')
      const predicate = createLtExpression('createdAt', date)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ createdAt: { $lt: date } })
    })
  })

  describe('String Comparisons', () => {
    it('should compile string less than comparison (lexicographic)', () => {
      const predicate = createLtExpression('name', 'Zebra')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ name: { $lt: 'Zebra' } })
    })
  })

  describe('Nested Field Comparisons', () => {
    it('should compile nested field less than', () => {
      const predicate = createLtExpression('metrics.clicks', 500)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'metrics.clicks': { $lt: 500 } })
    })
  })
})

// =============================================================================
// $lte (Less Than or Equal) Predicate Tests
// =============================================================================

describe('Less Than or Equal ($lte) Predicate', () => {
  describe('Numeric Comparisons', () => {
    it('should compile integer less than or equal comparison', () => {
      const predicate = createLteExpression('age', 100)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: { $lte: 100 } })
    })

    it('should compile floating point less than or equal comparison', () => {
      const predicate = createLteExpression('price', 999.99)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ price: { $lte: 999.99 } })
    })

    it('should compile zero less than or equal comparison', () => {
      const predicate = createLteExpression('score', 0)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ score: { $lte: 0 } })
    })
  })

  describe('Date Comparisons', () => {
    it('should compile Date less than or equal comparison', () => {
      const date = new Date('2024-12-31')
      const predicate = createLteExpression('createdAt', date)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ createdAt: { $lte: date } })
    })
  })

  describe('Nested Field Comparisons', () => {
    it('should compile nested field less than or equal', () => {
      const predicate = createLteExpression('user.profile.score', 100)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'user.profile.score': { $lte: 100 } })
    })
  })
})

// =============================================================================
// $ne (Not Equal) Predicate Tests
// =============================================================================

describe('Not Equal ($ne) Predicate', () => {
  describe('String Comparisons', () => {
    it('should compile string not equal comparison', () => {
      const predicate = createNeExpression('name', 'Anonymous')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ name: { $ne: 'Anonymous' } })
    })

    it('should compile empty string not equal comparison', () => {
      const predicate = createNeExpression('name', '')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ name: { $ne: '' } })
    })

    it('should compile status enum not equal comparison', () => {
      const predicate = createNeExpression('status', 'inactive')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ status: { $ne: 'inactive' } })
    })
  })

  describe('Numeric Comparisons', () => {
    it('should compile integer not equal comparison', () => {
      const predicate = createNeExpression('age', 0)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: { $ne: 0 } })
    })

    it('should compile floating point not equal comparison', () => {
      const predicate = createNeExpression('price', 0.00)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ price: { $ne: 0.00 } })
    })
  })

  describe('Boolean Comparisons', () => {
    it('should compile boolean not equal to false', () => {
      const predicate = createNeExpression('active', false)
      const result = compilePredicate(predicate)

      expect(result).toEqual({ active: { $ne: false } })
    })

    it('should compile boolean not equal to true', () => {
      const predicate = createNeExpression('active', true)
      const result = compilePredicate(predicate)

      expect(result).toEqual({ active: { $ne: true } })
    })
  })

  describe('Null Comparisons', () => {
    it('should compile null not equal comparison', () => {
      const predicate = createNeExpression('deletedAt', null)
      const result = compilePredicate(predicate)

      expect(result).toEqual({ deletedAt: { $ne: null } })
    })
  })

  describe('Date Comparisons', () => {
    it('should compile Date not equal comparison', () => {
      const date = new Date('2024-01-01')
      const predicate = createNeExpression('createdAt', date)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ createdAt: { $ne: date } })
    })
  })

  describe('Nested Field Comparisons', () => {
    it('should compile nested field not equal', () => {
      const predicate = createNeExpression('user.settings.priority', 'low')
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'user.settings.priority': { $ne: 'low' } })
    })
  })
})

// =============================================================================
// $in (In Array) Predicate Tests
// =============================================================================

describe('In Array ($in) Predicate', () => {
  describe('String Array', () => {
    it('should compile string in-array comparison', () => {
      const predicate = createInExpression('status', ['active', 'pending'])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ status: { $in: ['active', 'pending'] } })
    })

    it('should compile single-element string array', () => {
      const predicate = createInExpression('status', ['active'])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ status: { $in: ['active'] } })
    })

    it('should compile empty array', () => {
      const predicate = createInExpression('status', [])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ status: { $in: [] } })
    })

    it('should compile name lookup in-array', () => {
      const predicate = createInExpression('name', ['Alice', 'Bob', 'Charlie'])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ name: { $in: ['Alice', 'Bob', 'Charlie'] } })
    })
  })

  describe('Numeric Array', () => {
    it('should compile integer in-array comparison', () => {
      const predicate = createInExpression('age', [18, 21, 25, 30])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: { $in: [18, 21, 25, 30] } })
    })

    it('should compile floating point in-array comparison', () => {
      const predicate = createInExpression('price', [9.99, 19.99, 29.99])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ price: { $in: [9.99, 19.99, 29.99] } })
    })

    it('should compile mixed numeric values', () => {
      const predicate = createInExpression('score', [0, 50, 100, -10])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ score: { $in: [0, 50, 100, -10] } })
    })
  })

  describe('ID Lookup', () => {
    it('should compile _id in-array lookup', () => {
      const ids = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012']
      const predicate = createInExpression('_id', ids)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ _id: { $in: ids } })
    })
  })

  describe('Nested Field Array', () => {
    it('should compile nested field in-array comparison', () => {
      const predicate = createInExpression('user.settings.priority', ['high', 'medium'])
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'user.settings.priority': { $in: ['high', 'medium'] } })
    })
  })

  describe('Date Array', () => {
    it('should compile Date in-array comparison', () => {
      const dates = [
        new Date('2024-01-01'),
        new Date('2024-06-01'),
        new Date('2024-12-01'),
      ]
      const predicate = createInExpression('createdAt', dates)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ createdAt: { $in: dates } })
    })
  })
})

// =============================================================================
// $nin (Not In Array) Predicate Tests
// =============================================================================

describe('Not In Array ($nin) Predicate', () => {
  describe('String Array', () => {
    it('should compile string not-in-array comparison', () => {
      const predicate = createNinExpression('status', ['inactive', 'pending'])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ status: { $nin: ['inactive', 'pending'] } })
    })

    it('should compile single-element not-in-array', () => {
      const predicate = createNinExpression('status', ['deleted'])
      const result = compilePredicate(predicate)

      expect(result).toEqual({ status: { $nin: ['deleted'] } })
    })

    it('should compile empty not-in-array', () => {
      const predicate = createNinExpression('status', [])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ status: { $nin: [] } })
    })
  })

  describe('Numeric Array', () => {
    it('should compile integer not-in-array comparison', () => {
      const predicate = createNinExpression('age', [0, -1, 999])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: { $nin: [0, -1, 999] } })
    })

    it('should compile score exclusion', () => {
      const predicate = createNinExpression('score', [0, 100])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ score: { $nin: [0, 100] } })
    })
  })

  describe('ID Exclusion', () => {
    it('should compile _id not-in-array exclusion', () => {
      const excludedIds = ['blocked-user-1', 'blocked-user-2']
      const predicate = createNinExpression('_id', excludedIds)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ _id: { $nin: excludedIds } })
    })
  })

  describe('Nested Field Exclusion', () => {
    it('should compile nested field not-in-array', () => {
      const predicate = createNinExpression('user.settings.level', [0, 1])
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'user.settings.level': { $nin: [0, 1] } })
    })
  })

  describe('Boolean Array', () => {
    it('should compile boolean not-in-array', () => {
      const predicate = createNinExpression('enabled', [false])
      const result = compilePredicate(predicate)

      expect(result).toEqual({ enabled: { $nin: [false] } })
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Edge Cases and Error Handling', () => {
  describe('Invalid Comparison Predicates', () => {
    it('should throw error for missing arguments in gt', () => {
      const predicate = {
        type: 'func' as const,
        name: 'gt',
        args: [createRef('age')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for missing arguments in gte', () => {
      const predicate = {
        type: 'func' as const,
        name: 'gte',
        args: [],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error when first argument is not a ref', () => {
      const predicate = {
        type: 'func' as const,
        name: 'lt',
        args: [createValue(25), createValue(30)],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error when second argument is not a value', () => {
      const predicate = {
        type: 'func' as const,
        name: 'lte',
        args: [createRef('age'), createRef('maxAge')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for in with non-array value', () => {
      const predicate = {
        type: 'func' as const,
        name: 'in',
        args: [createRef('status'), createValue('active')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for nin with non-array value', () => {
      const predicate = {
        type: 'func' as const,
        name: 'nin',
        args: [createRef('status'), createValue('inactive')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })
  })

  describe('Special Values', () => {
    it('should handle undefined value in ne by converting to null', () => {
      const predicate = createNeExpression('field', undefined)
      const result = compilePredicate(predicate)

      expect(result).toEqual({ field: { $ne: null } })
    })

    it('should handle Infinity in greater than comparison', () => {
      const predicate = createGtExpression('value', -Infinity)
      const result = compilePredicate(predicate)

      expect(result).toEqual({ value: { $gt: -Infinity } })
    })

    it('should handle NaN in comparison (MongoDB behavior)', () => {
      const predicate = createNeExpression('value', NaN)
      const result = compilePredicate(predicate)

      // NaN should be passed through; MongoDB handles NaN comparisons
      expect(result).toEqual({ value: { $ne: NaN } })
    })
  })

  describe('Unicode and Special Characters', () => {
    it('should handle unicode in string ne comparison', () => {
      const predicate = createNeExpression('name', 'User Name')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ name: { $ne: 'User Name' } })
    })

    it('should handle unicode in in-array comparison', () => {
      const predicate = createInExpression('category', ['Food', 'Sports'])
      const result = compilePredicate(predicate)

      expect(result).toEqual({ category: { $in: ['Food', 'Sports'] } })
    })
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('Type Safety', () => {
  describe('Return Type', () => {
    it('should return MongoFilterQuery type for gt', () => {
      const predicate = createGtExpression('age', 18)
      const result = compilePredicate<TestDocument>(predicate)

      expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
    })

    it('should return MongoFilterQuery type for in', () => {
      const predicate = createInExpression('status', ['active'])
      const result = compilePredicate<TestDocument>(predicate)

      expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
    })
  })

  describe('Comparison Operators Type', () => {
    it('should produce valid MongoComparisonOperators structure', () => {
      const predicate = createGteExpression('score', 50)
      const result = compilePredicate<TestDocument>(predicate)

      // Verify the result has the expected operator structure
      expect(result.score).toHaveProperty('$gte')
    })
  })
})

// =============================================================================
// Integration-style Tests
// =============================================================================

describe('Real-world Usage Patterns', () => {
  describe('Age Range Queries', () => {
    it('should compile minimum age filter', () => {
      const predicate = createGteExpression('age', 18)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: { $gte: 18 } })
    })

    it('should compile maximum age filter', () => {
      const predicate = createLtExpression('age', 65)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: { $lt: 65 } })
    })
  })

  describe('Price Range Queries', () => {
    it('should compile minimum price filter', () => {
      const predicate = createGtExpression('price', 0)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ price: { $gt: 0 } })
    })

    it('should compile maximum price filter', () => {
      const predicate = createLteExpression('price', 1000)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ price: { $lte: 1000 } })
    })
  })

  describe('Status Filtering', () => {
    it('should compile active status exclusion', () => {
      const predicate = createNeExpression('status', 'inactive')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ status: { $ne: 'inactive' } })
    })

    it('should compile multiple status inclusion', () => {
      const predicate = createInExpression('status', ['active', 'pending'])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ status: { $in: ['active', 'pending'] } })
    })

    it('should compile blocked status exclusion', () => {
      const predicate = createNinExpression('status', ['blocked', 'deleted'])
      const result = compilePredicate(predicate)

      expect(result).toEqual({ status: { $nin: ['blocked', 'deleted'] } })
    })
  })

  describe('Date Range Queries', () => {
    it('should compile created after date filter', () => {
      const startDate = new Date('2024-01-01')
      const predicate = createGteExpression('createdAt', startDate)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ createdAt: { $gte: startDate } })
    })

    it('should compile created before date filter', () => {
      const endDate = new Date('2024-12-31')
      const predicate = createLtExpression('createdAt', endDate)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ createdAt: { $lt: endDate } })
    })
  })

  describe('User Exclusion Queries', () => {
    it('should compile blocked user ID exclusion', () => {
      const blockedIds = ['user-123', 'user-456', 'user-789']
      const predicate = createNinExpression('_id', blockedIds)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ _id: { $nin: blockedIds } })
    })
  })

  describe('Score Threshold Queries', () => {
    it('should compile passing score filter', () => {
      const predicate = createGteExpression('score', 60)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ score: { $gte: 60 } })
    })

    it('should compile non-zero score filter', () => {
      const predicate = createNeExpression('score', 0)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ score: { $ne: 0 } })
    })
  })
})

// =============================================================================
// Performance Considerations
// =============================================================================

describe('Performance', () => {
  it('should compile comparison predicates efficiently', () => {
    const predicate = createGtExpression('age', 18)

    // Compile multiple times to ensure no memory leaks or excessive allocations
    const results: MongoFilterQuery[] = []
    for (let i = 0; i < 100; i++) {
      results.push(compilePredicate(predicate))
    }

    // All results should be structurally equal
    results.forEach((result) => {
      expect(result).toEqual({ age: { $gt: 18 } })
    })
  })

  it('should compile in-array predicates efficiently', () => {
    const values = Array.from({ length: 100 }, (_, i) => `status-${i}`)
    const predicate = createInExpression('status', values)

    const result = compilePredicate(predicate)

    expect(result).toEqual({ status: { $in: values } })
  })
})
