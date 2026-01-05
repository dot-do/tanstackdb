/**
 * @file Logical Predicate Compiler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the logical predicate compiler functions that
 * transform TanStack DB logical predicates into MongoDB query format.
 *
 * The logical predicate compiler handles the transformation of:
 * - 'and' function -> { $and: [...] }
 * - 'or' function -> { $or: [...] }
 * - 'not' function -> { $not: {...} } or field-level { field: { $not: {...} } }
 * - 'nor' function -> { $nor: [...] }
 *
 * This enables TanStack DB queries with complex boolean logic to be translated
 * into MongoDB queries for server-side filtering via the mongo.do service.
 *
 * RED PHASE: These tests will fail until logical predicate compilers are implemented
 * in src/query/predicate-compiler.ts
 *
 * @see https://www.mongodb.com/docs/manual/reference/operator/query/and/
 * @see https://www.mongodb.com/docs/manual/reference/operator/query/or/
 * @see https://www.mongodb.com/docs/manual/reference/operator/query/not/
 * @see https://www.mongodb.com/docs/manual/reference/operator/query/nor/
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  compilePredicate,
  createRef,
  createValue,
  createEqualityExpression,
  type Func,
  type BasicExpression,
} from '../../src/query/predicate-compiler'
import type { MongoFilterQuery } from '../../src/types'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing logical predicates.
 */
interface TestDocument {
  _id: string
  name: string
  age: number
  status: 'active' | 'inactive' | 'pending'
  email: string
  role: 'admin' | 'user' | 'guest'
  verified: boolean
  score: number
}

/**
 * Document with nested objects for testing deep logical conditions.
 */
interface NestedDocument {
  _id: string
  user: {
    profile: {
      firstName: string
      lastName: string
      age: number
    }
    settings: {
      theme: 'light' | 'dark'
      notifications: boolean
      emailFrequency: 'daily' | 'weekly' | 'never'
    }
  }
  metadata: {
    createdAt: Date
    updatedAt: Date
    version: number
  }
}

// =============================================================================
// Helper Factory Functions for Logical Expressions
// =============================================================================

/**
 * Creates an 'and' function expression that combines multiple predicates.
 *
 * @param predicates - Array of predicates to combine with AND
 * @returns A Func expression representing (p1 AND p2 AND ...)
 *
 * @example
 * ```typescript
 * createAndExpression([
 *   createEqualityExpression('status', 'active'),
 *   createEqualityExpression('verified', true)
 * ])
 * ```
 */
function createAndExpression(predicates: BasicExpression<boolean>[]): Func<boolean> {
  return {
    type: 'func',
    name: 'and',
    args: predicates,
  }
}

/**
 * Creates an 'or' function expression that combines multiple predicates.
 *
 * @param predicates - Array of predicates to combine with OR
 * @returns A Func expression representing (p1 OR p2 OR ...)
 *
 * @example
 * ```typescript
 * createOrExpression([
 *   createEqualityExpression('status', 'active'),
 *   createEqualityExpression('status', 'pending')
 * ])
 * ```
 */
function createOrExpression(predicates: BasicExpression<boolean>[]): Func<boolean> {
  return {
    type: 'func',
    name: 'or',
    args: predicates,
  }
}

/**
 * Creates a 'not' function expression that negates a predicate.
 *
 * @param predicate - The predicate to negate
 * @returns A Func expression representing NOT(predicate)
 *
 * @example
 * ```typescript
 * createNotExpression(createEqualityExpression('status', 'inactive'))
 * ```
 */
function createNotExpression(predicate: BasicExpression<boolean>): Func<boolean> {
  return {
    type: 'func',
    name: 'not',
    args: [predicate],
  }
}

/**
 * Creates a 'nor' function expression that combines multiple predicates with NOR.
 *
 * @param predicates - Array of predicates to combine with NOR
 * @returns A Func expression representing NOT(p1 OR p2 OR ...)
 *
 * @example
 * ```typescript
 * createNorExpression([
 *   createEqualityExpression('status', 'inactive'),
 *   createEqualityExpression('verified', false)
 * ])
 * ```
 */
function createNorExpression(predicates: BasicExpression<boolean>[]): Func<boolean> {
  return {
    type: 'func',
    name: 'nor',
    args: predicates,
  }
}

/**
 * Helper to create a comparison expression (gt, gte, lt, lte, ne).
 * Used for testing logical operators with comparison predicates.
 */
function createComparisonExpression(
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'ne',
  fieldPath: string,
  value: unknown
): Func<boolean> {
  return {
    type: 'func',
    name: operator,
    args: [createRef(fieldPath), createValue(value)],
  }
}

// =============================================================================
// $and Operator Tests
// =============================================================================

describe('$and Operator', () => {
  describe('Basic AND Operations', () => {
    it('should compile AND with two equality predicates', () => {
      const predicate = createAndExpression([
        createEqualityExpression('status', 'active'),
        createEqualityExpression('verified', true),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { status: 'active' },
          { verified: true },
        ],
      })
    })

    it('should compile AND with three equality predicates', () => {
      const predicate = createAndExpression([
        createEqualityExpression('status', 'active'),
        createEqualityExpression('verified', true),
        createEqualityExpression('role', 'admin'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { status: 'active' },
          { verified: true },
          { role: 'admin' },
        ],
      })
    })

    it('should compile AND with single predicate', () => {
      const predicate = createAndExpression([
        createEqualityExpression('status', 'active'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      // Single predicate AND could be simplified, but explicit $and is also valid
      expect(result).toEqual({
        $and: [{ status: 'active' }],
      })
    })

    it('should compile AND with empty array', () => {
      const predicate = createAndExpression([])
      const result = compilePredicate<TestDocument>(predicate)

      // Empty AND should match everything (true), MongoDB uses empty $and: []
      expect(result).toEqual({ $and: [] })
    })
  })

  describe('AND with Different Value Types', () => {
    it('should compile AND with string and number equality', () => {
      const predicate = createAndExpression([
        createEqualityExpression('name', 'John'),
        createEqualityExpression('age', 30),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { name: 'John' },
          { age: 30 },
        ],
      })
    })

    it('should compile AND with boolean and null values', () => {
      const predicate = createAndExpression([
        createEqualityExpression('verified', false),
        createEqualityExpression('deletedAt', null),
      ])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $and: [
          { verified: false },
          { deletedAt: null },
        ],
      })
    })
  })

  describe('AND with Nested Fields', () => {
    it('should compile AND with nested field predicates', () => {
      const predicate = createAndExpression([
        createEqualityExpression('user.profile.firstName', 'John'),
        createEqualityExpression('user.settings.theme', 'dark'),
      ])
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { 'user.profile.firstName': 'John' },
          { 'user.settings.theme': 'dark' },
        ],
      })
    })

    it('should compile AND with deeply nested boolean field', () => {
      const predicate = createAndExpression([
        createEqualityExpression('user.settings.notifications', true),
        createEqualityExpression('user.settings.emailFrequency', 'daily'),
      ])
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { 'user.settings.notifications': true },
          { 'user.settings.emailFrequency': 'daily' },
        ],
      })
    })
  })

  describe('Nested AND Operations', () => {
    it('should compile nested AND expressions', () => {
      const innerAnd = createAndExpression([
        createEqualityExpression('verified', true),
        createEqualityExpression('role', 'admin'),
      ])
      const predicate = createAndExpression([
        createEqualityExpression('status', 'active'),
        innerAnd,
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { status: 'active' },
          {
            $and: [
              { verified: true },
              { role: 'admin' },
            ],
          },
        ],
      })
    })
  })
})

// =============================================================================
// $or Operator Tests
// =============================================================================

describe('$or Operator', () => {
  describe('Basic OR Operations', () => {
    it('should compile OR with two equality predicates', () => {
      const predicate = createOrExpression([
        createEqualityExpression('status', 'active'),
        createEqualityExpression('status', 'pending'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { status: 'active' },
          { status: 'pending' },
        ],
      })
    })

    it('should compile OR with three equality predicates', () => {
      const predicate = createOrExpression([
        createEqualityExpression('role', 'admin'),
        createEqualityExpression('role', 'user'),
        createEqualityExpression('role', 'guest'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { role: 'admin' },
          { role: 'user' },
          { role: 'guest' },
        ],
      })
    })

    it('should compile OR with single predicate', () => {
      const predicate = createOrExpression([
        createEqualityExpression('status', 'active'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [{ status: 'active' }],
      })
    })

    it('should compile OR with empty array', () => {
      const predicate = createOrExpression([])
      const result = compilePredicate<TestDocument>(predicate)

      // Empty OR should match nothing (false), MongoDB uses empty $or: []
      expect(result).toEqual({ $or: [] })
    })
  })

  describe('OR with Different Fields', () => {
    it('should compile OR across different fields', () => {
      const predicate = createOrExpression([
        createEqualityExpression('email', 'admin@example.com'),
        createEqualityExpression('role', 'admin'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { email: 'admin@example.com' },
          { role: 'admin' },
        ],
      })
    })

    it('should compile OR with mixed value types', () => {
      const predicate = createOrExpression([
        createEqualityExpression('verified', true),
        createEqualityExpression('score', 100),
        createEqualityExpression('status', 'active'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { verified: true },
          { score: 100 },
          { status: 'active' },
        ],
      })
    })
  })

  describe('OR with Nested Fields', () => {
    it('should compile OR with nested field predicates', () => {
      const predicate = createOrExpression([
        createEqualityExpression('user.settings.theme', 'dark'),
        createEqualityExpression('user.settings.theme', 'light'),
      ])
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { 'user.settings.theme': 'dark' },
          { 'user.settings.theme': 'light' },
        ],
      })
    })
  })

  describe('Nested OR Operations', () => {
    it('should compile nested OR expressions', () => {
      const innerOr = createOrExpression([
        createEqualityExpression('role', 'admin'),
        createEqualityExpression('role', 'moderator'),
      ])
      const predicate = createOrExpression([
        createEqualityExpression('verified', true),
        innerOr,
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { verified: true },
          {
            $or: [
              { role: 'admin' },
              { role: 'moderator' },
            ],
          },
        ],
      })
    })
  })
})

// =============================================================================
// $not Operator Tests
// =============================================================================

describe('$not Operator', () => {
  describe('Basic NOT Operations', () => {
    it('should compile NOT with equality predicate', () => {
      const predicate = createNotExpression(
        createEqualityExpression('status', 'inactive')
      )
      const result = compilePredicate<TestDocument>(predicate)

      // MongoDB $not is typically used at field level: { field: { $not: { $eq: value } } }
      // or at document level with $nor for single negation
      expect(result).toEqual({
        status: { $not: { $eq: 'inactive' } },
      })
    })

    it('should compile NOT with boolean equality', () => {
      const predicate = createNotExpression(
        createEqualityExpression('verified', false)
      )
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        verified: { $not: { $eq: false } },
      })
    })

    it('should compile NOT with null equality', () => {
      const predicate = createNotExpression(
        createEqualityExpression('deletedAt', null)
      )
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        deletedAt: { $not: { $eq: null } },
      })
    })
  })

  describe('NOT with Nested Fields', () => {
    it('should compile NOT with nested field predicate', () => {
      const predicate = createNotExpression(
        createEqualityExpression('user.settings.notifications', false)
      )
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'user.settings.notifications': { $not: { $eq: false } },
      })
    })
  })

  describe('NOT with Compound Predicates', () => {
    it('should compile NOT with AND predicate', () => {
      const andPredicate = createAndExpression([
        createEqualityExpression('status', 'inactive'),
        createEqualityExpression('verified', false),
      ])
      const predicate = createNotExpression(andPredicate)
      const result = compilePredicate<TestDocument>(predicate)

      // NOT(A AND B) is equivalent to $nor with the AND, or could use $not at top level
      // MongoDB typically handles this as { $nor: [{ $and: [...] }] } or alternative formulations
      expect(result).toEqual({
        $nor: [
          {
            $and: [
              { status: 'inactive' },
              { verified: false },
            ],
          },
        ],
      })
    })

    it('should compile NOT with OR predicate', () => {
      const orPredicate = createOrExpression([
        createEqualityExpression('status', 'inactive'),
        createEqualityExpression('status', 'pending'),
      ])
      const predicate = createNotExpression(orPredicate)
      const result = compilePredicate<TestDocument>(predicate)

      // NOT(A OR B) = NOR(A, B)
      expect(result).toEqual({
        $nor: [
          { status: 'inactive' },
          { status: 'pending' },
        ],
      })
    })
  })

  describe('Double NOT', () => {
    it('should compile double NOT (NOT NOT A)', () => {
      const innerNot = createNotExpression(
        createEqualityExpression('status', 'inactive')
      )
      const predicate = createNotExpression(innerNot)
      const result = compilePredicate<TestDocument>(predicate)

      // Double negation - could be simplified, but explicit nesting is valid
      expect(result).toEqual({
        $nor: [
          { status: { $not: { $eq: 'inactive' } } },
        ],
      })
    })
  })
})

// =============================================================================
// $nor Operator Tests
// =============================================================================

describe('$nor Operator', () => {
  describe('Basic NOR Operations', () => {
    it('should compile NOR with two equality predicates', () => {
      const predicate = createNorExpression([
        createEqualityExpression('status', 'inactive'),
        createEqualityExpression('verified', false),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $nor: [
          { status: 'inactive' },
          { verified: false },
        ],
      })
    })

    it('should compile NOR with three equality predicates', () => {
      const predicate = createNorExpression([
        createEqualityExpression('status', 'inactive'),
        createEqualityExpression('status', 'pending'),
        createEqualityExpression('status', 'deleted'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $nor: [
          { status: 'inactive' },
          { status: 'pending' },
          { status: 'deleted' },
        ],
      })
    })

    it('should compile NOR with single predicate', () => {
      const predicate = createNorExpression([
        createEqualityExpression('status', 'inactive'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $nor: [{ status: 'inactive' }],
      })
    })

    it('should compile NOR with empty array', () => {
      const predicate = createNorExpression([])
      const result = compilePredicate<TestDocument>(predicate)

      // Empty NOR should match everything (true since there's nothing to negate)
      expect(result).toEqual({ $nor: [] })
    })
  })

  describe('NOR with Different Fields', () => {
    it('should compile NOR across different fields', () => {
      const predicate = createNorExpression([
        createEqualityExpression('status', 'banned'),
        createEqualityExpression('role', 'guest'),
        createEqualityExpression('verified', false),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $nor: [
          { status: 'banned' },
          { role: 'guest' },
          { verified: false },
        ],
      })
    })
  })

  describe('NOR with Nested Fields', () => {
    it('should compile NOR with nested field predicates', () => {
      const predicate = createNorExpression([
        createEqualityExpression('user.settings.notifications', false),
        createEqualityExpression('user.settings.emailFrequency', 'never'),
      ])
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        $nor: [
          { 'user.settings.notifications': false },
          { 'user.settings.emailFrequency': 'never' },
        ],
      })
    })
  })

  describe('Nested NOR Operations', () => {
    it('should compile nested NOR expressions', () => {
      const innerNor = createNorExpression([
        createEqualityExpression('role', 'guest'),
        createEqualityExpression('role', 'banned'),
      ])
      const predicate = createNorExpression([
        createEqualityExpression('status', 'inactive'),
        innerNor,
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $nor: [
          { status: 'inactive' },
          {
            $nor: [
              { role: 'guest' },
              { role: 'banned' },
            ],
          },
        ],
      })
    })
  })
})

// =============================================================================
// Combined Logical Operators Tests
// =============================================================================

describe('Combined Logical Operators', () => {
  describe('AND with OR', () => {
    it('should compile AND containing OR predicates', () => {
      const orPredicate = createOrExpression([
        createEqualityExpression('role', 'admin'),
        createEqualityExpression('role', 'moderator'),
      ])
      const predicate = createAndExpression([
        createEqualityExpression('status', 'active'),
        orPredicate,
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { status: 'active' },
          {
            $or: [
              { role: 'admin' },
              { role: 'moderator' },
            ],
          },
        ],
      })
    })

    it('should compile OR containing AND predicates', () => {
      const andPredicate = createAndExpression([
        createEqualityExpression('verified', true),
        createEqualityExpression('role', 'admin'),
      ])
      const predicate = createOrExpression([
        createEqualityExpression('status', 'superuser'),
        andPredicate,
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { status: 'superuser' },
          {
            $and: [
              { verified: true },
              { role: 'admin' },
            ],
          },
        ],
      })
    })
  })

  describe('AND with NOT', () => {
    it('should compile AND containing NOT predicate', () => {
      const notPredicate = createNotExpression(
        createEqualityExpression('status', 'banned')
      )
      const predicate = createAndExpression([
        createEqualityExpression('verified', true),
        notPredicate,
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { verified: true },
          { status: { $not: { $eq: 'banned' } } },
        ],
      })
    })
  })

  describe('OR with NOT', () => {
    it('should compile OR containing NOT predicate', () => {
      const notPredicate = createNotExpression(
        createEqualityExpression('verified', false)
      )
      const predicate = createOrExpression([
        createEqualityExpression('role', 'admin'),
        notPredicate,
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { role: 'admin' },
          { verified: { $not: { $eq: false } } },
        ],
      })
    })
  })

  describe('AND with NOR', () => {
    it('should compile AND containing NOR predicate', () => {
      const norPredicate = createNorExpression([
        createEqualityExpression('status', 'banned'),
        createEqualityExpression('status', 'suspended'),
      ])
      const predicate = createAndExpression([
        createEqualityExpression('verified', true),
        norPredicate,
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { verified: true },
          {
            $nor: [
              { status: 'banned' },
              { status: 'suspended' },
            ],
          },
        ],
      })
    })
  })

  describe('Complex Nested Combinations', () => {
    it('should compile deeply nested logical expressions', () => {
      // ((status = 'active' AND verified = true) OR role = 'admin') AND NOT(score = 0)
      const innerAnd = createAndExpression([
        createEqualityExpression('status', 'active'),
        createEqualityExpression('verified', true),
      ])
      const orWithAdmin = createOrExpression([
        innerAnd,
        createEqualityExpression('role', 'admin'),
      ])
      const notZeroScore = createNotExpression(
        createEqualityExpression('score', 0)
      )
      const predicate = createAndExpression([
        orWithAdmin,
        notZeroScore,
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          {
            $or: [
              {
                $and: [
                  { status: 'active' },
                  { verified: true },
                ],
              },
              { role: 'admin' },
            ],
          },
          { score: { $not: { $eq: 0 } } },
        ],
      })
    })

    it('should compile mixed NOR with AND and OR', () => {
      // NOR(status = 'banned', (verified = false AND role = 'guest'))
      const andPredicate = createAndExpression([
        createEqualityExpression('verified', false),
        createEqualityExpression('role', 'guest'),
      ])
      const predicate = createNorExpression([
        createEqualityExpression('status', 'banned'),
        andPredicate,
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $nor: [
          { status: 'banned' },
          {
            $and: [
              { verified: false },
              { role: 'guest' },
            ],
          },
        ],
      })
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Logical Operator Edge Cases', () => {
  describe('Empty and Single Element Arrays', () => {
    it('should handle AND with all same-field predicates', () => {
      const predicate = createAndExpression([
        createEqualityExpression('age', 25),
        createEqualityExpression('age', 30),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      // This is logically impossible (age cannot be both 25 and 30)
      // but should still compile correctly
      expect(result).toEqual({
        $and: [
          { age: 25 },
          { age: 30 },
        ],
      })
    })

    it('should handle OR with all same values', () => {
      const predicate = createOrExpression([
        createEqualityExpression('status', 'active'),
        createEqualityExpression('status', 'active'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      // Redundant but valid
      expect(result).toEqual({
        $or: [
          { status: 'active' },
          { status: 'active' },
        ],
      })
    })
  })

  describe('Many Predicates', () => {
    it('should handle AND with many predicates', () => {
      const predicates = Array.from({ length: 10 }, (_, i) =>
        createEqualityExpression(`field${i}`, i)
      )
      const predicate = createAndExpression(predicates)
      const result = compilePredicate(predicate)

      expect(result.$and).toHaveLength(10)
      expect(result.$and[0]).toEqual({ field0: 0 })
      expect(result.$and[9]).toEqual({ field9: 9 })
    })

    it('should handle OR with many predicates', () => {
      const predicates = Array.from({ length: 10 }, (_, i) =>
        createEqualityExpression('status', `status${i}`)
      )
      const predicate = createOrExpression(predicates)
      const result = compilePredicate(predicate)

      expect(result.$or).toHaveLength(10)
    })
  })

  describe('Special Characters in Field Names', () => {
    it('should handle fields with underscores in logical operators', () => {
      const predicate = createAndExpression([
        createEqualityExpression('created_at', '2024-01-01'),
        createEqualityExpression('updated_at', '2024-01-02'),
      ])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $and: [
          { created_at: '2024-01-01' },
          { updated_at: '2024-01-02' },
        ],
      })
    })
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('Type Safety', () => {
  it('should return MongoFilterQuery type for AND', () => {
    const predicate = createAndExpression([
      createEqualityExpression('name', 'John'),
    ])
    const result = compilePredicate<TestDocument>(predicate)

    expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
  })

  it('should return MongoFilterQuery type for OR', () => {
    const predicate = createOrExpression([
      createEqualityExpression('status', 'active'),
    ])
    const result = compilePredicate<TestDocument>(predicate)

    expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
  })

  it('should return MongoFilterQuery type for NOT', () => {
    const predicate = createNotExpression(
      createEqualityExpression('status', 'inactive')
    )
    const result = compilePredicate<TestDocument>(predicate)

    expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
  })

  it('should return MongoFilterQuery type for NOR', () => {
    const predicate = createNorExpression([
      createEqualityExpression('status', 'inactive'),
    ])
    const result = compilePredicate<TestDocument>(predicate)

    expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
  })
})

// =============================================================================
// Real-world Usage Patterns
// =============================================================================

describe('Real-world Usage Patterns', () => {
  describe('User Authentication Queries', () => {
    it('should compile active and verified user query', () => {
      const predicate = createAndExpression([
        createEqualityExpression('status', 'active'),
        createEqualityExpression('verified', true),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { status: 'active' },
          { verified: true },
        ],
      })
    })

    it('should compile admin or moderator query', () => {
      const predicate = createOrExpression([
        createEqualityExpression('role', 'admin'),
        createEqualityExpression('role', 'moderator'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { role: 'admin' },
          { role: 'moderator' },
        ],
      })
    })

    it('should compile not banned users query', () => {
      const predicate = createNorExpression([
        createEqualityExpression('status', 'banned'),
        createEqualityExpression('status', 'suspended'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $nor: [
          { status: 'banned' },
          { status: 'suspended' },
        ],
      })
    })
  })

  describe('Content Filtering Queries', () => {
    it('should compile published and not deleted content query', () => {
      const notDeleted = createNotExpression(
        createEqualityExpression('deleted', true)
      )
      const predicate = createAndExpression([
        createEqualityExpression('status', 'published'),
        notDeleted,
      ])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $and: [
          { status: 'published' },
          { deleted: { $not: { $eq: true } } },
        ],
      })
    })
  })

  describe('Notification Preferences Queries', () => {
    it('should compile users who want notifications query', () => {
      const predicate = createAndExpression([
        createEqualityExpression('user.settings.notifications', true),
        createOrExpression([
          createEqualityExpression('user.settings.emailFrequency', 'daily'),
          createEqualityExpression('user.settings.emailFrequency', 'weekly'),
        ]),
      ])
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { 'user.settings.notifications': true },
          {
            $or: [
              { 'user.settings.emailFrequency': 'daily' },
              { 'user.settings.emailFrequency': 'weekly' },
            ],
          },
        ],
      })
    })
  })
})

// =============================================================================
// Performance Tests
// =============================================================================

describe('Performance', () => {
  it('should compile logical predicates efficiently', () => {
    const orPredicate = createOrExpression([
      createEqualityExpression('status', 'active'),
      createEqualityExpression('status', 'pending'),
    ])
    const predicate = createAndExpression([
      createEqualityExpression('verified', true),
      orPredicate,
    ])

    // Compile the same predicate multiple times
    const results: MongoFilterQuery[] = []
    for (let i = 0; i < 100; i++) {
      results.push(compilePredicate(predicate))
    }

    // All results should be structurally equal
    const expected = {
      $and: [
        { verified: true },
        {
          $or: [
            { status: 'active' },
            { status: 'pending' },
          ],
        },
      ],
    }
    results.forEach((result) => {
      expect(result).toEqual(expected)
    })
  })
})
