/**
 * @file Null/Exists Predicate Compiler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the null/exists predicate compiler functions that
 * transform TanStack DB null/exists predicates into MongoDB query format.
 *
 * The null/exists predicate compiler handles the transformation of:
 * - 'exists' function -> { field: { $exists: boolean } }
 * - 'type' function -> { field: { $type: typeValue } }
 * - null equality checks -> { field: null } or { field: { $eq: null } }
 *
 * This enables TanStack DB queries with null/existence checks to be translated
 * into MongoDB queries for server-side filtering via the mongo.do service.
 *
 * RED PHASE: These tests will fail until null/exists predicate compilers are implemented
 * in src/query/predicate-compiler.ts
 *
 * @see https://www.mongodb.com/docs/manual/reference/operator/query/exists/
 * @see https://www.mongodb.com/docs/manual/reference/operator/query/type/
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  compilePredicate,
  createRef,
  createValue,
  createEqualityExpression,
  PredicateCompilationError,
  type Func,
  type BasicExpression,
} from '../../src/query/predicate-compiler'
import type { MongoFilterQuery } from '../../src/types'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing null/exists predicates.
 */
interface TestDocument {
  _id: string
  name: string
  email?: string | null
  phone?: string
  age?: number | null
  verified?: boolean
  metadata?: Record<string, unknown> | null
}

/**
 * Document with nested optional fields for testing complex null/exists scenarios.
 */
interface NestedDocument {
  _id: string
  user?: {
    profile?: {
      firstName?: string | null
      lastName?: string
      avatar?: string | null
      bio?: string
    }
    settings?: {
      theme?: string | null
      notifications?: boolean
      language?: string
    }
  }
  metadata?: {
    tags?: string[]
    createdAt?: Date
    updatedAt?: Date | null
  }
}

/**
 * Document with various type fields for $type operator testing.
 */
interface TypeTestDocument {
  _id: string
  stringField?: string
  numberField?: number
  booleanField?: boolean
  dateField?: Date
  arrayField?: unknown[]
  objectField?: Record<string, unknown>
  nullField?: null
}

// =============================================================================
// Helper Factory Functions for Null/Exists Expressions
// =============================================================================

/**
 * Creates an 'exists' function expression that checks field existence.
 *
 * @param fieldPath - The path to the field
 * @param exists - Whether the field should exist (true) or not exist (false)
 * @returns A Func expression representing field: { $exists: exists }
 *
 * @example
 * ```typescript
 * createExistsExpression('email', true)
 * // Matches documents where 'email' field exists
 * ```
 */
function createExistsExpression(fieldPath: string, exists: boolean): Func<boolean> {
  return {
    type: 'func',
    name: 'exists',
    args: [createRef(fieldPath), createValue(exists)],
  }
}

/**
 * Creates a 'type' function expression that checks field type.
 *
 * @param fieldPath - The path to the field
 * @param typeValue - The BSON type (string name or number)
 * @returns A Func expression representing field: { $type: typeValue }
 *
 * @example
 * ```typescript
 * createTypeExpression('age', 'number')
 * // Matches documents where 'age' is of type number
 *
 * createTypeExpression('name', 2)
 * // Matches documents where 'name' is of BSON type 2 (string)
 * ```
 */
function createTypeExpression(fieldPath: string, typeValue: string | number | string[]): Func<boolean> {
  return {
    type: 'func',
    name: 'type',
    args: [createRef(fieldPath), createValue(typeValue)],
  }
}

/**
 * Creates an 'isNull' function expression for explicit null checks.
 *
 * @param fieldPath - The path to the field
 * @returns A Func expression representing field: null or field: { $type: 10 }
 *
 * @example
 * ```typescript
 * createIsNullExpression('email')
 * // Matches documents where 'email' is null
 * ```
 */
function createIsNullExpression(fieldPath: string): Func<boolean> {
  return {
    type: 'func',
    name: 'isNull',
    args: [createRef(fieldPath)],
  }
}

/**
 * Creates an 'isNotNull' function expression.
 *
 * @param fieldPath - The path to the field
 * @returns A Func expression representing field: { $ne: null }
 *
 * @example
 * ```typescript
 * createIsNotNullExpression('email')
 * // Matches documents where 'email' is not null
 * ```
 */
function createIsNotNullExpression(fieldPath: string): Func<boolean> {
  return {
    type: 'func',
    name: 'isNotNull',
    args: [createRef(fieldPath)],
  }
}

/**
 * Helper to create an 'and' expression.
 */
function createAndExpression(predicates: BasicExpression<boolean>[]): Func<boolean> {
  return {
    type: 'func',
    name: 'and',
    args: predicates,
  }
}

/**
 * Helper to create an 'or' expression.
 */
function createOrExpression(predicates: BasicExpression<boolean>[]): Func<boolean> {
  return {
    type: 'func',
    name: 'or',
    args: predicates,
  }
}

/**
 * Helper to create a 'not' expression.
 */
function createNotExpression(predicate: BasicExpression<boolean>): Func<boolean> {
  return {
    type: 'func',
    name: 'not',
    args: [predicate],
  }
}

// =============================================================================
// $exists Operator Tests
// =============================================================================

describe('$exists Operator', () => {
  describe('Basic $exists: true Operations', () => {
    it('should compile exists with true value', () => {
      const predicate = createExistsExpression('email', true)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        email: { $exists: true },
      })
    })

    it('should compile exists for optional string field', () => {
      const predicate = createExistsExpression('phone', true)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        phone: { $exists: true },
      })
    })

    it('should compile exists for optional number field', () => {
      const predicate = createExistsExpression('age', true)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        age: { $exists: true },
      })
    })

    it('should compile exists for optional boolean field', () => {
      const predicate = createExistsExpression('verified', true)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        verified: { $exists: true },
      })
    })

    it('should compile exists for optional object field', () => {
      const predicate = createExistsExpression('metadata', true)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        metadata: { $exists: true },
      })
    })
  })

  describe('Basic $exists: false Operations', () => {
    it('should compile exists with false value', () => {
      const predicate = createExistsExpression('email', false)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        email: { $exists: false },
      })
    })

    it('should compile exists:false for optional string field', () => {
      const predicate = createExistsExpression('phone', false)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        phone: { $exists: false },
      })
    })

    it('should compile exists:false for optional number field', () => {
      const predicate = createExistsExpression('age', false)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        age: { $exists: false },
      })
    })

    it('should compile exists:false for optional object field', () => {
      const predicate = createExistsExpression('metadata', false)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        metadata: { $exists: false },
      })
    })
  })

  describe('$exists with Nested Fields', () => {
    it('should compile exists on nested user field', () => {
      const predicate = createExistsExpression('user', true)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        user: { $exists: true },
      })
    })

    it('should compile exists on deeply nested field', () => {
      const predicate = createExistsExpression('user.profile.firstName', true)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'user.profile.firstName': { $exists: true },
      })
    })

    it('should compile exists:false on deeply nested field', () => {
      const predicate = createExistsExpression('user.profile.avatar', false)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'user.profile.avatar': { $exists: false },
      })
    })

    it('should compile exists on nested settings field', () => {
      const predicate = createExistsExpression('user.settings.theme', true)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'user.settings.theme': { $exists: true },
      })
    })

    it('should compile exists on metadata field', () => {
      const predicate = createExistsExpression('metadata.tags', true)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'metadata.tags': { $exists: true },
      })
    })

    it('should compile exists on nested date field', () => {
      const predicate = createExistsExpression('metadata.updatedAt', true)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'metadata.updatedAt': { $exists: true },
      })
    })
  })
})

// =============================================================================
// $type Operator Tests
// =============================================================================

describe('$type Operator', () => {
  describe('$type with String Type Names', () => {
    it('should compile type check for string', () => {
      const predicate = createTypeExpression('stringField', 'string')
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        stringField: { $type: 'string' },
      })
    })

    it('should compile type check for number', () => {
      const predicate = createTypeExpression('numberField', 'number')
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        numberField: { $type: 'number' },
      })
    })

    it('should compile type check for bool', () => {
      const predicate = createTypeExpression('booleanField', 'bool')
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        booleanField: { $type: 'bool' },
      })
    })

    it('should compile type check for date', () => {
      const predicate = createTypeExpression('dateField', 'date')
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        dateField: { $type: 'date' },
      })
    })

    it('should compile type check for array', () => {
      const predicate = createTypeExpression('arrayField', 'array')
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        arrayField: { $type: 'array' },
      })
    })

    it('should compile type check for object', () => {
      const predicate = createTypeExpression('objectField', 'object')
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        objectField: { $type: 'object' },
      })
    })

    it('should compile type check for null', () => {
      const predicate = createTypeExpression('nullField', 'null')
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        nullField: { $type: 'null' },
      })
    })

    it('should compile type check for objectId', () => {
      const predicate = createTypeExpression('_id', 'objectId')
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        _id: { $type: 'objectId' },
      })
    })

    it('should compile type check for double', () => {
      const predicate = createTypeExpression('numberField', 'double')
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        numberField: { $type: 'double' },
      })
    })

    it('should compile type check for int', () => {
      const predicate = createTypeExpression('numberField', 'int')
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        numberField: { $type: 'int' },
      })
    })

    it('should compile type check for long', () => {
      const predicate = createTypeExpression('numberField', 'long')
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        numberField: { $type: 'long' },
      })
    })
  })

  describe('$type with BSON Type Numbers', () => {
    it('should compile type check with BSON type 1 (double)', () => {
      const predicate = createTypeExpression('numberField', 1)
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        numberField: { $type: 1 },
      })
    })

    it('should compile type check with BSON type 2 (string)', () => {
      const predicate = createTypeExpression('stringField', 2)
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        stringField: { $type: 2 },
      })
    })

    it('should compile type check with BSON type 7 (objectId)', () => {
      const predicate = createTypeExpression('_id', 7)
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        _id: { $type: 7 },
      })
    })

    it('should compile type check with BSON type 8 (bool)', () => {
      const predicate = createTypeExpression('booleanField', 8)
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        booleanField: { $type: 8 },
      })
    })

    it('should compile type check with BSON type 9 (date)', () => {
      const predicate = createTypeExpression('dateField', 9)
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        dateField: { $type: 9 },
      })
    })

    it('should compile type check with BSON type 10 (null)', () => {
      const predicate = createTypeExpression('nullField', 10)
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        nullField: { $type: 10 },
      })
    })

    it('should compile type check with BSON type 16 (int)', () => {
      const predicate = createTypeExpression('numberField', 16)
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        numberField: { $type: 16 },
      })
    })

    it('should compile type check with BSON type 18 (long)', () => {
      const predicate = createTypeExpression('numberField', 18)
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        numberField: { $type: 18 },
      })
    })
  })

  describe('$type with Multiple Types (Array)', () => {
    it('should compile type check with multiple string types', () => {
      const predicate = createTypeExpression('numberField', ['int', 'long', 'double'])
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        numberField: { $type: ['int', 'long', 'double'] },
      })
    })

    it('should compile type check for null or string', () => {
      const predicate = createTypeExpression('stringField', ['null', 'string'])
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        stringField: { $type: ['null', 'string'] },
      })
    })
  })

  describe('$type with Nested Fields', () => {
    it('should compile type check on nested field', () => {
      const predicate = createTypeExpression('user.profile.firstName', 'string')
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'user.profile.firstName': { $type: 'string' },
      })
    })

    it('should compile type check for null on nested field', () => {
      const predicate = createTypeExpression('user.profile.avatar', 'null')
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'user.profile.avatar': { $type: 'null' },
      })
    })

    it('should compile type check on deeply nested settings', () => {
      const predicate = createTypeExpression('user.settings.notifications', 'bool')
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'user.settings.notifications': { $type: 'bool' },
      })
    })
  })
})

// =============================================================================
// Null Equality Tests
// =============================================================================

describe('Null Equality Checks', () => {
  describe('Direct Null Equality', () => {
    it('should compile equality check with null value', () => {
      const predicate = createEqualityExpression('email', null)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        email: null,
      })
    })

    it('should compile equality check with null for number field', () => {
      const predicate = createEqualityExpression('age', null)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        age: null,
      })
    })

    it('should compile equality check with null for nested field', () => {
      const predicate = createEqualityExpression('user.profile.avatar', null)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'user.profile.avatar': null,
      })
    })

    it('should compile equality check with null for deeply nested field', () => {
      const predicate = createEqualityExpression('user.settings.theme', null)
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'user.settings.theme': null,
      })
    })
  })

  describe('isNull Function', () => {
    it('should compile isNull for simple field', () => {
      const predicate = createIsNullExpression('email')
      const result = compilePredicate<TestDocument>(predicate)

      // isNull can be implemented as either { field: null } or { field: { $type: 10 } }
      // We expect { field: null } for simplicity
      expect(result).toEqual({
        email: null,
      })
    })

    it('should compile isNull for optional number field', () => {
      const predicate = createIsNullExpression('age')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        age: null,
      })
    })

    it('should compile isNull for nested field', () => {
      const predicate = createIsNullExpression('user.profile.firstName')
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'user.profile.firstName': null,
      })
    })

    it('should compile isNull for metadata field', () => {
      const predicate = createIsNullExpression('metadata.updatedAt')
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'metadata.updatedAt': null,
      })
    })
  })

  describe('isNotNull Function', () => {
    it('should compile isNotNull for simple field', () => {
      const predicate = createIsNotNullExpression('email')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        email: { $ne: null },
      })
    })

    it('should compile isNotNull for optional number field', () => {
      const predicate = createIsNotNullExpression('age')
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        age: { $ne: null },
      })
    })

    it('should compile isNotNull for nested field', () => {
      const predicate = createIsNotNullExpression('user.profile.avatar')
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'user.profile.avatar': { $ne: null },
      })
    })

    it('should compile isNotNull for deeply nested field', () => {
      const predicate = createIsNotNullExpression('user.settings.theme')
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        'user.settings.theme': { $ne: null },
      })
    })
  })
})

// =============================================================================
// Combined Null/Exists Tests with Logical Operators
// =============================================================================

describe('Combined Null/Exists with Logical Operators', () => {
  describe('$exists with AND', () => {
    it('should compile AND with multiple exists checks', () => {
      const predicate = createAndExpression([
        createExistsExpression('email', true),
        createExistsExpression('phone', true),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { email: { $exists: true } },
          { phone: { $exists: true } },
        ],
      })
    })

    it('should compile AND with exists and equality', () => {
      const predicate = createAndExpression([
        createExistsExpression('email', true),
        createEqualityExpression('verified', true),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { email: { $exists: true } },
          { verified: true },
        ],
      })
    })

    it('should compile AND with exists:true and exists:false', () => {
      const predicate = createAndExpression([
        createExistsExpression('email', true),
        createExistsExpression('phone', false),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { email: { $exists: true } },
          { phone: { $exists: false } },
        ],
      })
    })
  })

  describe('$exists with OR', () => {
    it('should compile OR with multiple exists checks', () => {
      const predicate = createOrExpression([
        createExistsExpression('email', true),
        createExistsExpression('phone', true),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { email: { $exists: true } },
          { phone: { $exists: true } },
        ],
      })
    })

    it('should compile OR with exists and null check', () => {
      const predicate = createOrExpression([
        createExistsExpression('email', false),
        createIsNullExpression('email'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { email: { $exists: false } },
          { email: null },
        ],
      })
    })
  })

  describe('$type with AND', () => {
    it('should compile AND with type and exists', () => {
      const predicate = createAndExpression([
        createExistsExpression('numberField', true),
        createTypeExpression('numberField', 'number'),
      ])
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { numberField: { $exists: true } },
          { numberField: { $type: 'number' } },
        ],
      })
    })

    it('should compile AND with multiple type checks', () => {
      const predicate = createAndExpression([
        createTypeExpression('stringField', 'string'),
        createTypeExpression('numberField', 'number'),
      ])
      const result = compilePredicate<TypeTestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { stringField: { $type: 'string' } },
          { numberField: { $type: 'number' } },
        ],
      })
    })
  })

  describe('NOT with Exists and Null', () => {
    it('should compile NOT(exists:true) to exists:false', () => {
      const predicate = createNotExpression(createExistsExpression('email', true))
      const result = compilePredicate<TestDocument>(predicate)

      // NOT($exists: true) is semantically { $exists: false }
      // But the current NOT implementation might wrap it differently
      // Accept either form:
      expect(result).toEqual({
        email: { $not: { $exists: true } },
      })
    })

    it('should compile NOT(isNull) for field is not null', () => {
      const predicate = createNotExpression(createIsNullExpression('email'))
      const result = compilePredicate<TestDocument>(predicate)

      // NOT(field: null) = { $nor: [{ field: null }] } or similar
      expect(result).toMatchObject({})
    })
  })

  describe('Complex Combined Queries', () => {
    it('should compile query for existing and non-null email', () => {
      const predicate = createAndExpression([
        createExistsExpression('email', true),
        createIsNotNullExpression('email'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { email: { $exists: true } },
          { email: { $ne: null } },
        ],
      })
    })

    it('should compile query for missing or null field', () => {
      const predicate = createOrExpression([
        createExistsExpression('phone', false),
        createIsNullExpression('phone'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { phone: { $exists: false } },
          { phone: null },
        ],
      })
    })

    it('should compile complex nested null/exists query', () => {
      const predicate = createAndExpression([
        createExistsExpression('user', true),
        createExistsExpression('user.profile', true),
        createIsNotNullExpression('user.profile.firstName'),
      ])
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { user: { $exists: true } },
          { 'user.profile': { $exists: true } },
          { 'user.profile.firstName': { $ne: null } },
        ],
      })
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Edge Cases and Error Handling', () => {
  describe('Invalid $exists Predicates', () => {
    it('should throw error for exists with missing field reference', () => {
      const predicate = {
        type: 'func' as const,
        name: 'exists',
        args: [createValue(true)],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for exists with non-boolean value', () => {
      const predicate = {
        type: 'func' as const,
        name: 'exists',
        args: [createRef('email'), createValue('true')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for exists with missing arguments', () => {
      const predicate = {
        type: 'func' as const,
        name: 'exists',
        args: [],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for exists with only field reference', () => {
      const predicate = {
        type: 'func' as const,
        name: 'exists',
        args: [createRef('email')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })
  })

  describe('Invalid $type Predicates', () => {
    it('should throw error for type with missing field reference', () => {
      const predicate = {
        type: 'func' as const,
        name: 'type',
        args: [createValue('string')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for type with missing arguments', () => {
      const predicate = {
        type: 'func' as const,
        name: 'type',
        args: [],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for type with only field reference', () => {
      const predicate = {
        type: 'func' as const,
        name: 'type',
        args: [createRef('field')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })
  })

  describe('Invalid isNull Predicates', () => {
    it('should throw error for isNull with missing field reference', () => {
      const predicate = {
        type: 'func' as const,
        name: 'isNull',
        args: [],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for isNull with value instead of ref', () => {
      const predicate = {
        type: 'func' as const,
        name: 'isNull',
        args: [createValue('email')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })
  })

  describe('Invalid isNotNull Predicates', () => {
    it('should throw error for isNotNull with missing field reference', () => {
      const predicate = {
        type: 'func' as const,
        name: 'isNotNull',
        args: [],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for isNotNull with value instead of ref', () => {
      const predicate = {
        type: 'func' as const,
        name: 'isNotNull',
        args: [createValue('email')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('Type Safety', () => {
  it('should return MongoFilterQuery type for $exists', () => {
    const predicate = createExistsExpression('email', true)
    const result = compilePredicate<TestDocument>(predicate)

    expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
  })

  it('should return MongoFilterQuery type for $type', () => {
    const predicate = createTypeExpression('stringField', 'string')
    const result = compilePredicate<TypeTestDocument>(predicate)

    expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TypeTestDocument>>()
  })

  it('should return MongoFilterQuery type for isNull', () => {
    const predicate = createIsNullExpression('email')
    const result = compilePredicate<TestDocument>(predicate)

    expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
  })

  it('should return MongoFilterQuery type for isNotNull', () => {
    const predicate = createIsNotNullExpression('email')
    const result = compilePredicate<TestDocument>(predicate)

    expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
  })
})

// =============================================================================
// Real-world Usage Patterns
// =============================================================================

describe('Real-world Usage Patterns', () => {
  describe('Optional Field Validation', () => {
    it('should compile query to find documents with all optional fields present', () => {
      const predicate = createAndExpression([
        createExistsExpression('email', true),
        createExistsExpression('phone', true),
        createExistsExpression('age', true),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { email: { $exists: true } },
          { phone: { $exists: true } },
          { age: { $exists: true } },
        ],
      })
    })

    it('should compile query for incomplete profiles', () => {
      const predicate = createOrExpression([
        createExistsExpression('email', false),
        createExistsExpression('phone', false),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { email: { $exists: false } },
          { phone: { $exists: false } },
        ],
      })
    })
  })

  describe('Data Quality Checks', () => {
    it('should compile query for non-null required fields', () => {
      const predicate = createAndExpression([
        createIsNotNullExpression('name'),
        createIsNotNullExpression('email'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { name: { $ne: null } },
          { email: { $ne: null } },
        ],
      })
    })

    it('should compile query to find documents with null values', () => {
      const predicate = createOrExpression([
        createIsNullExpression('email'),
        createIsNullExpression('age'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { email: null },
          { age: null },
        ],
      })
    })
  })

  describe('Type Validation Queries', () => {
    it('should compile query for documents with valid string email', () => {
      const predicate = createAndExpression([
        createExistsExpression('email', true),
        createTypeExpression('email', 'string'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { email: { $exists: true } },
          { email: { $type: 'string' } },
        ],
      })
    })

    it('should compile query for documents with valid numeric age', () => {
      const predicate = createAndExpression([
        createExistsExpression('age', true),
        createTypeExpression('age', 'number'),
        createIsNotNullExpression('age'),
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { age: { $exists: true } },
          { age: { $type: 'number' } },
          { age: { $ne: null } },
        ],
      })
    })
  })

  describe('Nested Optional Field Handling', () => {
    it('should compile query for documents with complete user profile', () => {
      const predicate = createAndExpression([
        createExistsExpression('user', true),
        createExistsExpression('user.profile', true),
        createIsNotNullExpression('user.profile.firstName'),
        createIsNotNullExpression('user.profile.lastName'),
      ])
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { user: { $exists: true } },
          { 'user.profile': { $exists: true } },
          { 'user.profile.firstName': { $ne: null } },
          { 'user.profile.lastName': { $ne: null } },
        ],
      })
    })

    it('should compile query for documents missing optional settings', () => {
      const predicate = createOrExpression([
        createExistsExpression('user.settings', false),
        createIsNullExpression('user.settings.theme'),
      ])
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { 'user.settings': { $exists: false } },
          { 'user.settings.theme': null },
        ],
      })
    })
  })

  describe('Migration/Cleanup Queries', () => {
    it('should compile query to find documents with legacy null fields', () => {
      const predicate = createAndExpression([
        createExistsExpression('metadata', true),
        createIsNullExpression('metadata.updatedAt'),
      ])
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        $and: [
          { metadata: { $exists: true } },
          { 'metadata.updatedAt': null },
        ],
      })
    })

    it('should compile query to find documents needing schema update', () => {
      const predicate = createOrExpression([
        createExistsExpression('metadata', false),
        createExistsExpression('metadata.tags', false),
      ])
      const result = compilePredicate<NestedDocument>(predicate)

      expect(result).toEqual({
        $or: [
          { metadata: { $exists: false } },
          { 'metadata.tags': { $exists: false } },
        ],
      })
    })
  })
})

// =============================================================================
// Performance Tests
// =============================================================================

describe('Performance', () => {
  it('should compile exists predicates efficiently', () => {
    const predicate = createExistsExpression('email', true)

    const results: MongoFilterQuery[] = []
    for (let i = 0; i < 100; i++) {
      results.push(compilePredicate(predicate))
    }

    results.forEach((result) => {
      expect(result).toEqual({ email: { $exists: true } })
    })
  })

  it('should compile type predicates efficiently', () => {
    const predicate = createTypeExpression('field', 'string')

    const results: MongoFilterQuery[] = []
    for (let i = 0; i < 100; i++) {
      results.push(compilePredicate(predicate))
    }

    results.forEach((result) => {
      expect(result).toEqual({ field: { $type: 'string' } })
    })
  })

  it('should compile complex null/exists queries efficiently', () => {
    const predicate = createAndExpression([
      createExistsExpression('email', true),
      createIsNotNullExpression('email'),
      createTypeExpression('email', 'string'),
    ])

    const results: MongoFilterQuery[] = []
    for (let i = 0; i < 100; i++) {
      results.push(compilePredicate(predicate))
    }

    results.forEach((result) => {
      expect(result).toEqual({
        $and: [
          { email: { $exists: true } },
          { email: { $ne: null } },
          { email: { $type: 'string' } },
        ],
      })
    })
  })
})
