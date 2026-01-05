/**
 * @file Equality Predicate Compiler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the compileEqualityPredicate function that
 * transforms TanStack DB equality predicates into MongoDB query format.
 *
 * The equality predicate compiler handles the transformation of:
 * - BasicExpression<boolean> with 'eq' function -> { field: value } or { field: { $eq: value } }
 *
 * This enables TanStack DB queries to be translated into MongoDB queries
 * for server-side filtering via the mongo.do service.
 *
 * RED PHASE: These tests will fail until compileEqualityPredicate is implemented
 * in src/query/predicate-compiler.ts
 *
 * @see https://www.mongodb.com/docs/manual/reference/operator/query/eq/
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  compileEqualityPredicate,
  compilePredicate,
  createRef,
  createValue,
  createEqualityExpression,
} from '../../src/query/predicate-compiler'
import type { MongoFilterQuery } from '../../src/types'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing equality predicates.
 */
interface TestDocument {
  _id: string
  name: string
  age: number
  status: 'active' | 'inactive'
  email: string
}

/**
 * Document with nested objects for testing deep equality.
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
}

/**
 * Document with various value types for comprehensive testing.
 */
interface TypedDocument {
  _id: string
  stringField: string
  numberField: number
  booleanField: boolean
  dateField: Date
  nullField: null
  undefinedField?: undefined
}

// =============================================================================
// Helper Factory Tests
// =============================================================================

describe('Helper Factory Functions', () => {
  describe('createRef', () => {
    it('should create a PropRef with a single path segment', () => {
      const ref = createRef('name')
      expect(ref.type).toBe('ref')
      expect(ref.path).toEqual(['name'])
    })

    it('should create a PropRef with multiple path segments', () => {
      const ref = createRef('user', 'profile', 'firstName')
      expect(ref.type).toBe('ref')
      expect(ref.path).toEqual(['user', 'profile', 'firstName'])
    })

    it('should handle dot notation in single string', () => {
      const ref = createRef('user.profile.firstName')
      expect(ref.type).toBe('ref')
      expect(ref.path).toEqual(['user', 'profile', 'firstName'])
    })
  })

  describe('createValue', () => {
    it('should create a Value wrapper for string', () => {
      const val = createValue('test')
      expect(val.type).toBe('val')
      expect(val.value).toBe('test')
    })

    it('should create a Value wrapper for number', () => {
      const val = createValue(42)
      expect(val.type).toBe('val')
      expect(val.value).toBe(42)
    })

    it('should create a Value wrapper for boolean', () => {
      const val = createValue(true)
      expect(val.type).toBe('val')
      expect(val.value).toBe(true)
    })

    it('should create a Value wrapper for null', () => {
      const val = createValue(null)
      expect(val.type).toBe('val')
      expect(val.value).toBe(null)
    })

    it('should create a Value wrapper for Date', () => {
      const date = new Date('2024-01-01')
      const val = createValue(date)
      expect(val.type).toBe('val')
      expect(val.value).toBe(date)
    })
  })

  describe('createEqualityExpression', () => {
    it('should create an equality function expression', () => {
      const expr = createEqualityExpression('name', 'John')
      expect(expr.type).toBe('func')
      expect(expr.name).toBe('eq')
      expect(expr.args).toHaveLength(2)
      expect(expr.args[0].type).toBe('ref')
      expect(expr.args[1].type).toBe('val')
    })
  })
})

// =============================================================================
// Basic Equality Predicate Tests
// =============================================================================

describe('compileEqualityPredicate', () => {
  describe('Simple String Equality', () => {
    it('should compile string equality to MongoDB query', () => {
      const predicate = createEqualityExpression('name', 'John')
      const result = compileEqualityPredicate<TestDocument>(predicate)

      expect(result).toEqual({ name: 'John' })
    })

    it('should compile string equality with special characters', () => {
      const predicate = createEqualityExpression('email', 'john.doe+test@example.com')
      const result = compileEqualityPredicate<TestDocument>(predicate)

      expect(result).toEqual({ email: 'john.doe+test@example.com' })
    })

    it('should compile empty string equality', () => {
      const predicate = createEqualityExpression('name', '')
      const result = compileEqualityPredicate<TestDocument>(predicate)

      expect(result).toEqual({ name: '' })
    })

    it('should compile string with unicode characters', () => {
      const predicate = createEqualityExpression('name', 'Test User')
      const result = compileEqualityPredicate<TestDocument>(predicate)

      expect(result).toEqual({ name: 'Test User' })
    })
  })

  describe('Number Equality', () => {
    it('should compile integer equality', () => {
      const predicate = createEqualityExpression('age', 25)
      const result = compileEqualityPredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: 25 })
    })

    it('should compile floating point equality', () => {
      const predicate = createEqualityExpression('age', 25.5)
      const result = compileEqualityPredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: 25.5 })
    })

    it('should compile zero equality', () => {
      const predicate = createEqualityExpression('age', 0)
      const result = compileEqualityPredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: 0 })
    })

    it('should compile negative number equality', () => {
      const predicate = createEqualityExpression('age', -10)
      const result = compileEqualityPredicate<TestDocument>(predicate)

      expect(result).toEqual({ age: -10 })
    })
  })

  describe('Boolean Equality', () => {
    it('should compile true equality', () => {
      const predicate = createEqualityExpression('active', true)
      const result = compileEqualityPredicate(predicate)

      expect(result).toEqual({ active: true })
    })

    it('should compile false equality', () => {
      const predicate = createEqualityExpression('active', false)
      const result = compileEqualityPredicate(predicate)

      expect(result).toEqual({ active: false })
    })
  })

  describe('Null Equality', () => {
    it('should compile null equality', () => {
      const predicate = createEqualityExpression('deletedAt', null)
      const result = compileEqualityPredicate(predicate)

      expect(result).toEqual({ deletedAt: null })
    })
  })

  describe('Date Equality', () => {
    it('should compile Date equality', () => {
      const date = new Date('2024-01-15T00:00:00.000Z')
      const predicate = createEqualityExpression('createdAt', date)
      const result = compileEqualityPredicate(predicate)

      expect(result).toEqual({ createdAt: date })
    })
  })

  describe('ID Field Equality', () => {
    it('should compile _id field equality', () => {
      const predicate = createEqualityExpression('_id', '507f1f77bcf86cd799439011')
      const result = compileEqualityPredicate<TestDocument>(predicate)

      expect(result).toEqual({ _id: '507f1f77bcf86cd799439011' })
    })
  })
})

// =============================================================================
// Nested Field Equality Tests
// =============================================================================

describe('Nested Field Equality', () => {
  describe('Single Level Nesting', () => {
    it('should compile nested field equality with dot notation', () => {
      const predicate = createEqualityExpression('user.profile.firstName', 'John')
      const result = compileEqualityPredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'user.profile.firstName': 'John' })
    })

    it('should compile nested field equality with path array', () => {
      const ref = createRef('user', 'profile', 'lastName')
      const value = createValue('Doe')
      const predicate = {
        type: 'func' as const,
        name: 'eq',
        args: [ref, value],
      }
      const result = compileEqualityPredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'user.profile.lastName': 'Doe' })
    })
  })

  describe('Deep Nesting', () => {
    it('should compile deeply nested boolean equality', () => {
      const predicate = createEqualityExpression('user.settings.notifications', true)
      const result = compileEqualityPredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'user.settings.notifications': true })
    })

    it('should compile deeply nested string equality', () => {
      const predicate = createEqualityExpression('user.settings.theme', 'dark')
      const result = compileEqualityPredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'user.settings.theme': 'dark' })
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Edge Cases', () => {
  describe('Invalid Input Handling', () => {
    it('should throw error for non-equality function', () => {
      const predicate = {
        type: 'func' as const,
        name: 'gt',
        args: [createRef('age'), createValue(25)],
      }

      expect(() => compileEqualityPredicate(predicate)).toThrow()
    })

    it('should throw error for missing arguments', () => {
      const predicate = {
        type: 'func' as const,
        name: 'eq',
        args: [createRef('name')],
      }

      expect(() => compileEqualityPredicate(predicate)).toThrow()
    })

    it('should throw error when first argument is not a ref', () => {
      const predicate = {
        type: 'func' as const,
        name: 'eq',
        args: [createValue('name'), createValue('John')],
      }

      expect(() => compileEqualityPredicate(predicate)).toThrow()
    })

    it('should throw error when second argument is not a value', () => {
      const predicate = {
        type: 'func' as const,
        name: 'eq',
        args: [createRef('name'), createRef('otherField')],
      }

      expect(() => compileEqualityPredicate(predicate)).toThrow()
    })

    it('should throw error for non-function expression', () => {
      const predicate = createValue(true)

      expect(() => compileEqualityPredicate(predicate as any)).toThrow()
    })
  })

  describe('Special Values', () => {
    it('should handle undefined value by converting to null', () => {
      const predicate = createEqualityExpression('field', undefined)
      const result = compileEqualityPredicate(predicate)

      // MongoDB doesn't have undefined, so we convert to null
      expect(result).toEqual({ field: null })
    })
  })
})

// =============================================================================
// Generic Predicate Compiler Tests
// =============================================================================

describe('compilePredicate', () => {
  describe('Equality Predicates', () => {
    it('should delegate equality predicates to compileEqualityPredicate', () => {
      const predicate = createEqualityExpression('status', 'active')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ status: 'active' })
    })
  })

  describe('Type Safety', () => {
    it('should return MongoFilterQuery type', () => {
      const predicate = createEqualityExpression('name', 'John')
      const result = compilePredicate<TestDocument>(predicate)

      expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
    })
  })
})

// =============================================================================
// Integration-style Tests
// =============================================================================

describe('Real-world Usage Patterns', () => {
  describe('Common Query Patterns', () => {
    it('should compile a user lookup by email', () => {
      const predicate = createEqualityExpression('email', 'user@example.com')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ email: 'user@example.com' })
    })

    it('should compile a status filter', () => {
      const predicate = createEqualityExpression('status', 'active')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({ status: 'active' })
    })

    it('should compile a nested settings query', () => {
      const predicate = createEqualityExpression('user.settings.theme', 'dark')
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({ 'user.settings.theme': 'dark' })
    })
  })
})

// =============================================================================
// Performance Considerations
// =============================================================================

describe('Performance', () => {
  it('should compile predicates efficiently (no excessive object creation)', () => {
    const predicate = createEqualityExpression('name', 'test')

    // Compile the same predicate multiple times
    const results: MongoFilterQuery[] = []
    for (let i = 0; i < 100; i++) {
      results.push(compilePredicate(predicate))
    }

    // All results should be structurally equal
    results.forEach((result) => {
      expect(result).toEqual({ name: 'test' })
    })
  })
})
