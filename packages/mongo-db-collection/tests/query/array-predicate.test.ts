/**
 * @file Array Predicate Compiler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the array predicate compiler functions that
 * transform TanStack DB array predicates into MongoDB query format.
 *
 * The array predicate compiler handles the transformation of:
 * - 'elemMatch' function -> { field: { $elemMatch: {...} } }
 * - 'all' function -> { field: { $all: [...] } }
 * - 'size' function -> { field: { $size: number } }
 *
 * This enables TanStack DB queries with array operations to be translated
 * into MongoDB queries for server-side filtering via the mongo.do service.
 *
 * RED PHASE: These tests will fail until array predicate compilers are implemented
 * in src/query/predicate-compiler.ts
 *
 * @see https://www.mongodb.com/docs/manual/reference/operator/query/elemMatch/
 * @see https://www.mongodb.com/docs/manual/reference/operator/query/all/
 * @see https://www.mongodb.com/docs/manual/reference/operator/query/size/
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
 * Basic document type for testing array predicates.
 */
interface TestDocument {
  _id: string
  name: string
  tags: string[]
  scores: number[]
  categories: string[]
}

/**
 * Document with nested array objects for testing $elemMatch.
 */
interface DocumentWithArrayObjects {
  _id: string
  items: Array<{
    name: string
    price: number
    quantity: number
    inStock: boolean
  }>
  comments: Array<{
    author: string
    text: string
    rating: number
    timestamp: Date
  }>
  versions: Array<{
    major: number
    minor: number
    patch: number
  }>
}

/**
 * Document with deeply nested arrays for testing complex scenarios.
 */
interface NestedArrayDocument {
  _id: string
  user: {
    profile: {
      skills: string[]
      experience: Array<{
        company: string
        years: number
        role: string
      }>
    }
    settings: {
      favorites: string[]
      recentItems: Array<{
        id: string
        accessedAt: Date
      }>
    }
  }
  metadata: {
    tags: string[]
    features: Array<{
      name: string
      enabled: boolean
    }>
  }
}

// =============================================================================
// Helper Factory Functions for Array Expressions
// =============================================================================

/**
 * Creates an 'elemMatch' function expression that matches array elements.
 *
 * @param fieldPath - The path to the array field
 * @param conditions - The conditions to match against array elements
 * @returns A Func expression representing field: { $elemMatch: conditions }
 *
 * @example
 * ```typescript
 * createElemMatchExpression('items', { price: { $gt: 100 } })
 * // Matches documents where at least one item has price > 100
 * ```
 */
function createElemMatchExpression(
  fieldPath: string,
  conditions: Record<string, unknown>
): Func<boolean> {
  return {
    type: 'func',
    name: 'elemMatch',
    args: [createRef(fieldPath), createValue(conditions)],
  }
}

/**
 * Creates an 'all' function expression that matches all elements in array.
 *
 * @param fieldPath - The path to the array field
 * @param values - The values that must all be present in the array
 * @returns A Func expression representing field: { $all: values }
 *
 * @example
 * ```typescript
 * createAllExpression('tags', ['typescript', 'react'])
 * // Matches documents where tags contains both 'typescript' AND 'react'
 * ```
 */
function createAllExpression<T>(fieldPath: string, values: T[]): Func<boolean> {
  return {
    type: 'func',
    name: 'all',
    args: [createRef(fieldPath), createValue(values)],
  }
}

/**
 * Creates a 'size' function expression that matches array length.
 *
 * @param fieldPath - The path to the array field
 * @param length - The exact length the array must have
 * @returns A Func expression representing field: { $size: length }
 *
 * @example
 * ```typescript
 * createSizeExpression('tags', 3)
 * // Matches documents where tags has exactly 3 elements
 * ```
 */
function createSizeExpression(fieldPath: string, length: number): Func<boolean> {
  return {
    type: 'func',
    name: 'size',
    args: [createRef(fieldPath), createValue(length)],
  }
}

/**
 * Helper to create a comparison expression for use within $elemMatch.
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

// =============================================================================
// $elemMatch Operator Tests
// =============================================================================

describe('$elemMatch Operator', () => {
  describe('Basic $elemMatch with Single Condition', () => {
    it('should compile elemMatch with equality condition', () => {
      const predicate = createElemMatchExpression('items', { name: 'Widget' })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: { $elemMatch: { name: 'Widget' } },
      })
    })

    it('should compile elemMatch with numeric equality', () => {
      const predicate = createElemMatchExpression('items', { price: 100 })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: { $elemMatch: { price: 100 } },
      })
    })

    it('should compile elemMatch with boolean condition', () => {
      const predicate = createElemMatchExpression('items', { inStock: true })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: { $elemMatch: { inStock: true } },
      })
    })
  })

  describe('$elemMatch with Comparison Operators', () => {
    it('should compile elemMatch with $gt condition', () => {
      const predicate = createElemMatchExpression('items', { price: { $gt: 50 } })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: { $elemMatch: { price: { $gt: 50 } } },
      })
    })

    it('should compile elemMatch with $gte condition', () => {
      const predicate = createElemMatchExpression('items', { quantity: { $gte: 10 } })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: { $elemMatch: { quantity: { $gte: 10 } } },
      })
    })

    it('should compile elemMatch with $lt condition', () => {
      const predicate = createElemMatchExpression('comments', { rating: { $lt: 3 } })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        comments: { $elemMatch: { rating: { $lt: 3 } } },
      })
    })

    it('should compile elemMatch with $lte condition', () => {
      const predicate = createElemMatchExpression('items', { price: { $lte: 100 } })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: { $elemMatch: { price: { $lte: 100 } } },
      })
    })

    it('should compile elemMatch with $ne condition', () => {
      const predicate = createElemMatchExpression('items', { name: { $ne: 'Discontinued' } })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: { $elemMatch: { name: { $ne: 'Discontinued' } } },
      })
    })

    it('should compile elemMatch with range conditions', () => {
      const predicate = createElemMatchExpression('items', {
        price: { $gte: 10, $lte: 100 },
      })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: { $elemMatch: { price: { $gte: 10, $lte: 100 } } },
      })
    })
  })

  describe('$elemMatch with Multiple Conditions', () => {
    it('should compile elemMatch with two conditions on same element', () => {
      const predicate = createElemMatchExpression('items', {
        name: 'Widget',
        price: { $lt: 50 },
      })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: {
          $elemMatch: {
            name: 'Widget',
            price: { $lt: 50 },
          },
        },
      })
    })

    it('should compile elemMatch with three conditions', () => {
      const predicate = createElemMatchExpression('items', {
        name: 'Widget',
        price: { $gte: 10, $lte: 100 },
        inStock: true,
      })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: {
          $elemMatch: {
            name: 'Widget',
            price: { $gte: 10, $lte: 100 },
            inStock: true,
          },
        },
      })
    })

    it('should compile elemMatch matching comment by author and rating', () => {
      const predicate = createElemMatchExpression('comments', {
        author: 'John',
        rating: { $gte: 4 },
      })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        comments: {
          $elemMatch: {
            author: 'John',
            rating: { $gte: 4 },
          },
        },
      })
    })
  })

  describe('$elemMatch with $in and $nin', () => {
    it('should compile elemMatch with $in condition', () => {
      const predicate = createElemMatchExpression('items', {
        name: { $in: ['Widget', 'Gadget', 'Tool'] },
      })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: {
          $elemMatch: {
            name: { $in: ['Widget', 'Gadget', 'Tool'] },
          },
        },
      })
    })

    it('should compile elemMatch with $nin condition', () => {
      const predicate = createElemMatchExpression('comments', {
        author: { $nin: ['Anonymous', 'Spam'] },
      })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        comments: {
          $elemMatch: {
            author: { $nin: ['Anonymous', 'Spam'] },
          },
        },
      })
    })
  })

  describe('$elemMatch with Nested Fields', () => {
    it('should compile elemMatch on deeply nested array field', () => {
      const predicate = createElemMatchExpression('user.profile.experience', {
        company: 'Acme Corp',
        years: { $gte: 2 },
      })
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'user.profile.experience': {
          $elemMatch: {
            company: 'Acme Corp',
            years: { $gte: 2 },
          },
        },
      })
    })

    it('should compile elemMatch on nested settings array', () => {
      const predicate = createElemMatchExpression('user.settings.recentItems', {
        id: 'item-123',
      })
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'user.settings.recentItems': {
          $elemMatch: {
            id: 'item-123',
          },
        },
      })
    })

    it('should compile elemMatch on metadata features', () => {
      const predicate = createElemMatchExpression('metadata.features', {
        name: 'dark-mode',
        enabled: true,
      })
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'metadata.features': {
          $elemMatch: {
            name: 'dark-mode',
            enabled: true,
          },
        },
      })
    })
  })

  describe('$elemMatch with Logical Operators Inside', () => {
    it('should compile elemMatch with $and inside conditions', () => {
      const predicate = createElemMatchExpression('items', {
        $and: [{ price: { $gte: 10 } }, { price: { $lte: 100 } }],
      })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: {
          $elemMatch: {
            $and: [{ price: { $gte: 10 } }, { price: { $lte: 100 } }],
          },
        },
      })
    })

    it('should compile elemMatch with $or inside conditions', () => {
      const predicate = createElemMatchExpression('items', {
        $or: [{ name: 'Widget' }, { name: 'Gadget' }],
      })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: {
          $elemMatch: {
            $or: [{ name: 'Widget' }, { name: 'Gadget' }],
          },
        },
      })
    })
  })

  describe('$elemMatch with Empty Conditions', () => {
    it('should compile elemMatch with empty condition object', () => {
      const predicate = createElemMatchExpression('items', {})
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: { $elemMatch: {} },
      })
    })
  })
})

// =============================================================================
// $all Operator Tests
// =============================================================================

describe('$all Operator', () => {
  describe('Basic $all Operations', () => {
    it('should compile all with single string value', () => {
      const predicate = createAllExpression('tags', ['typescript'])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        tags: { $all: ['typescript'] },
      })
    })

    it('should compile all with two string values', () => {
      const predicate = createAllExpression('tags', ['typescript', 'react'])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        tags: { $all: ['typescript', 'react'] },
      })
    })

    it('should compile all with multiple string values', () => {
      const predicate = createAllExpression('tags', [
        'typescript',
        'react',
        'nodejs',
        'mongodb',
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        tags: { $all: ['typescript', 'react', 'nodejs', 'mongodb'] },
      })
    })

    it('should compile all with empty array', () => {
      const predicate = createAllExpression('tags', [])
      const result = compilePredicate<TestDocument>(predicate)

      // Empty $all should match all documents that have the field
      expect(result).toEqual({
        tags: { $all: [] },
      })
    })
  })

  describe('$all with Numeric Values', () => {
    it('should compile all with single number', () => {
      const predicate = createAllExpression('scores', [100])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        scores: { $all: [100] },
      })
    })

    it('should compile all with multiple numbers', () => {
      const predicate = createAllExpression('scores', [85, 90, 95])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        scores: { $all: [85, 90, 95] },
      })
    })

    it('should compile all with negative numbers', () => {
      const predicate = createAllExpression('scores', [-10, 0, 10])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        scores: { $all: [-10, 0, 10] },
      })
    })

    it('should compile all with floating point numbers', () => {
      const predicate = createAllExpression('scores', [3.14, 2.71, 1.41])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        scores: { $all: [3.14, 2.71, 1.41] },
      })
    })
  })

  describe('$all with Nested Fields', () => {
    it('should compile all on nested string array', () => {
      const predicate = createAllExpression('user.profile.skills', [
        'javascript',
        'python',
      ])
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'user.profile.skills': { $all: ['javascript', 'python'] },
      })
    })

    it('should compile all on nested favorites array', () => {
      const predicate = createAllExpression('user.settings.favorites', [
        'item-1',
        'item-2',
      ])
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'user.settings.favorites': { $all: ['item-1', 'item-2'] },
      })
    })

    it('should compile all on metadata tags', () => {
      const predicate = createAllExpression('metadata.tags', ['featured', 'popular'])
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'metadata.tags': { $all: ['featured', 'popular'] },
      })
    })
  })

  describe('$all with Categories', () => {
    it('should compile all for required categories', () => {
      const predicate = createAllExpression('categories', ['electronics', 'sale'])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        categories: { $all: ['electronics', 'sale'] },
      })
    })

    it('should compile all with many required categories', () => {
      const predicate = createAllExpression('categories', [
        'electronics',
        'featured',
        'new',
        'sale',
        'popular',
      ])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        categories: {
          $all: ['electronics', 'featured', 'new', 'sale', 'popular'],
        },
      })
    })
  })

  describe('$all with Duplicates', () => {
    it('should compile all with duplicate values', () => {
      // MongoDB handles duplicates, we just pass through
      const predicate = createAllExpression('tags', ['react', 'react', 'typescript'])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        tags: { $all: ['react', 'react', 'typescript'] },
      })
    })
  })
})

// =============================================================================
// $size Operator Tests
// =============================================================================

describe('$size Operator', () => {
  describe('Basic $size Operations', () => {
    it('should compile size with zero', () => {
      const predicate = createSizeExpression('tags', 0)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        tags: { $size: 0 },
      })
    })

    it('should compile size with one', () => {
      const predicate = createSizeExpression('tags', 1)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        tags: { $size: 1 },
      })
    })

    it('should compile size with small number', () => {
      const predicate = createSizeExpression('tags', 3)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        tags: { $size: 3 },
      })
    })

    it('should compile size with larger number', () => {
      const predicate = createSizeExpression('scores', 100)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        scores: { $size: 100 },
      })
    })
  })

  describe('$size with Different Array Fields', () => {
    it('should compile size on tags field', () => {
      const predicate = createSizeExpression('tags', 5)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        tags: { $size: 5 },
      })
    })

    it('should compile size on scores field', () => {
      const predicate = createSizeExpression('scores', 10)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        scores: { $size: 10 },
      })
    })

    it('should compile size on categories field', () => {
      const predicate = createSizeExpression('categories', 2)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        categories: { $size: 2 },
      })
    })
  })

  describe('$size with Nested Array Fields', () => {
    it('should compile size on nested skills array', () => {
      const predicate = createSizeExpression('user.profile.skills', 5)
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'user.profile.skills': { $size: 5 },
      })
    })

    it('should compile size on nested experience array', () => {
      const predicate = createSizeExpression('user.profile.experience', 3)
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'user.profile.experience': { $size: 3 },
      })
    })

    it('should compile size on nested favorites array', () => {
      const predicate = createSizeExpression('user.settings.favorites', 10)
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'user.settings.favorites': { $size: 10 },
      })
    })

    it('should compile size on metadata tags', () => {
      const predicate = createSizeExpression('metadata.tags', 7)
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'metadata.tags': { $size: 7 },
      })
    })

    it('should compile size on metadata features', () => {
      const predicate = createSizeExpression('metadata.features', 4)
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'metadata.features': { $size: 4 },
      })
    })
  })

  describe('$size with Object Arrays', () => {
    it('should compile size on items array', () => {
      const predicate = createSizeExpression('items', 5)
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: { $size: 5 },
      })
    })

    it('should compile size on comments array', () => {
      const predicate = createSizeExpression('comments', 0)
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        comments: { $size: 0 },
      })
    })

    it('should compile size on versions array', () => {
      const predicate = createSizeExpression('versions', 3)
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        versions: { $size: 3 },
      })
    })
  })
})

// =============================================================================
// Combined Array Operators Tests
// =============================================================================

describe('Combined Array Operators', () => {
  describe('$elemMatch with AND', () => {
    it('should compile AND containing $elemMatch', () => {
      const elemMatchPredicate = createElemMatchExpression('items', {
        price: { $gt: 100 },
      })
      const predicate = createAndExpression([
        createEqualityExpression('status', 'active'),
        elemMatchPredicate,
      ])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $and: [
          { status: 'active' },
          { items: { $elemMatch: { price: { $gt: 100 } } } },
        ],
      })
    })

    it('should compile AND with multiple $elemMatch', () => {
      const elemMatch1 = createElemMatchExpression('items', { inStock: true })
      const elemMatch2 = createElemMatchExpression('comments', { rating: { $gte: 4 } })
      const predicate = createAndExpression([elemMatch1, elemMatch2])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $and: [
          { items: { $elemMatch: { inStock: true } } },
          { comments: { $elemMatch: { rating: { $gte: 4 } } } },
        ],
      })
    })
  })

  describe('$all with AND', () => {
    it('should compile AND containing $all', () => {
      const allPredicate = createAllExpression('tags', ['typescript', 'react'])
      const predicate = createAndExpression([
        createEqualityExpression('status', 'published'),
        allPredicate,
      ])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $and: [
          { status: 'published' },
          { tags: { $all: ['typescript', 'react'] } },
        ],
      })
    })
  })

  describe('$size with AND', () => {
    it('should compile AND containing $size', () => {
      const sizePredicate = createSizeExpression('tags', 3)
      const predicate = createAndExpression([
        createEqualityExpression('verified', true),
        sizePredicate,
      ])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $and: [{ verified: true }, { tags: { $size: 3 } }],
      })
    })
  })

  describe('$elemMatch with OR', () => {
    it('should compile OR containing $elemMatch', () => {
      const elemMatchPredicate = createElemMatchExpression('items', {
        price: { $lt: 10 },
      })
      const predicate = createOrExpression([
        createEqualityExpression('featured', true),
        elemMatchPredicate,
      ])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $or: [
          { featured: true },
          { items: { $elemMatch: { price: { $lt: 10 } } } },
        ],
      })
    })
  })

  describe('$all with OR', () => {
    it('should compile OR with $all predicates', () => {
      const allTags = createAllExpression('tags', ['javascript'])
      const allCategories = createAllExpression('categories', ['tutorial'])
      const predicate = createOrExpression([allTags, allCategories])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $or: [
          { tags: { $all: ['javascript'] } },
          { categories: { $all: ['tutorial'] } },
        ],
      })
    })
  })

  describe('$size with OR', () => {
    it('should compile OR with $size predicates', () => {
      const size0 = createSizeExpression('tags', 0)
      const size5Plus = createComparisonExpression('gte', 'tagCount', 5)
      const predicate = createOrExpression([size0, size5Plus])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $or: [{ tags: { $size: 0 } }, { tagCount: { $gte: 5 } }],
      })
    })
  })

  describe('Multiple Array Operators Combined', () => {
    it('should compile AND with $elemMatch, $all, and $size', () => {
      const elemMatch = createElemMatchExpression('items', { inStock: true })
      const all = createAllExpression('tags', ['featured'])
      const size = createSizeExpression('categories', 2)
      const predicate = createAndExpression([elemMatch, all, size])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $and: [
          { items: { $elemMatch: { inStock: true } } },
          { tags: { $all: ['featured'] } },
          { categories: { $size: 2 } },
        ],
      })
    })

    it('should compile complex query with nested logical and array operators', () => {
      // (items has inStock:true AND tags contains 'featured') OR categories.size = 5
      const innerAnd = createAndExpression([
        createElemMatchExpression('items', { inStock: true }),
        createAllExpression('tags', ['featured']),
      ])
      const predicate = createOrExpression([innerAnd, createSizeExpression('categories', 5)])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $or: [
          {
            $and: [
              { items: { $elemMatch: { inStock: true } } },
              { tags: { $all: ['featured'] } },
            ],
          },
          { categories: { $size: 5 } },
        ],
      })
    })
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Edge Cases and Error Handling', () => {
  describe('Invalid $elemMatch Predicates', () => {
    it('should throw error for elemMatch with missing field reference', () => {
      const predicate = {
        type: 'func' as const,
        name: 'elemMatch',
        args: [createValue({ name: 'Widget' })],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for elemMatch with non-object conditions', () => {
      const predicate = {
        type: 'func' as const,
        name: 'elemMatch',
        args: [createRef('items'), createValue('invalid')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for elemMatch with missing arguments', () => {
      const predicate = {
        type: 'func' as const,
        name: 'elemMatch',
        args: [],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })
  })

  describe('Invalid $all Predicates', () => {
    it('should throw error for all with non-array value', () => {
      const predicate = {
        type: 'func' as const,
        name: 'all',
        args: [createRef('tags'), createValue('single-value')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for all with missing arguments', () => {
      const predicate = {
        type: 'func' as const,
        name: 'all',
        args: [createRef('tags')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for all with missing field reference', () => {
      const predicate = {
        type: 'func' as const,
        name: 'all',
        args: [createValue(['a', 'b']), createValue(['c', 'd'])],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })
  })

  describe('Invalid $size Predicates', () => {
    it('should throw error for size with non-number value', () => {
      const predicate = {
        type: 'func' as const,
        name: 'size',
        args: [createRef('tags'), createValue('three')],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for size with negative number', () => {
      const predicate = {
        type: 'func' as const,
        name: 'size',
        args: [createRef('tags'), createValue(-1)],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for size with floating point number', () => {
      const predicate = {
        type: 'func' as const,
        name: 'size',
        args: [createRef('tags'), createValue(3.5)],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })

    it('should throw error for size with missing arguments', () => {
      const predicate = {
        type: 'func' as const,
        name: 'size',
        args: [],
      }

      expect(() => compilePredicate(predicate)).toThrow()
    })
  })

  describe('Special Values', () => {
    it('should handle $elemMatch with null field values', () => {
      const predicate = createElemMatchExpression('items', { name: null })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: { $elemMatch: { name: null } },
      })
    })

    it('should handle $all with empty strings', () => {
      const predicate = createAllExpression('tags', ['', 'nonempty'])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        tags: { $all: ['', 'nonempty'] },
      })
    })
  })

  describe('Unicode and Special Characters', () => {
    it('should handle $all with unicode values', () => {
      const predicate = createAllExpression('tags', ['TypeScript', 'React'])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        tags: { $all: ['TypeScript', 'React'] },
      })
    })

    it('should handle $elemMatch with unicode in conditions', () => {
      const predicate = createElemMatchExpression('items', {
        name: 'Widget Pro',
      })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: { $elemMatch: { name: 'Widget Pro' } },
      })
    })
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('Type Safety', () => {
  it('should return MongoFilterQuery type for $elemMatch', () => {
    const predicate = createElemMatchExpression('items', { name: 'Widget' })
    const result = compilePredicate<DocumentWithArrayObjects>(predicate)

    expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<DocumentWithArrayObjects>>()
  })

  it('should return MongoFilterQuery type for $all', () => {
    const predicate = createAllExpression('tags', ['typescript'])
    const result = compilePredicate<TestDocument>(predicate)

    expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
  })

  it('should return MongoFilterQuery type for $size', () => {
    const predicate = createSizeExpression('tags', 3)
    const result = compilePredicate<TestDocument>(predicate)

    expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
  })
})

// =============================================================================
// Real-world Usage Patterns
// =============================================================================

describe('Real-world Usage Patterns', () => {
  describe('E-commerce Product Queries', () => {
    it('should compile query for products with specific item in stock', () => {
      const predicate = createElemMatchExpression('items', {
        inStock: true,
        quantity: { $gte: 1 },
      })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        items: {
          $elemMatch: {
            inStock: true,
            quantity: { $gte: 1 },
          },
        },
      })
    })

    it('should compile query for products with all required tags', () => {
      const predicate = createAllExpression('tags', ['electronics', 'featured', 'sale'])
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        tags: { $all: ['electronics', 'featured', 'sale'] },
      })
    })

    it('should compile query for products with exactly 3 categories', () => {
      const predicate = createSizeExpression('categories', 3)
      const result = compilePredicate<TestDocument>(predicate)

      expect(result).toEqual({
        categories: { $size: 3 },
      })
    })
  })

  describe('Content Management Queries', () => {
    it('should compile query for posts with high-rated comments', () => {
      const predicate = createElemMatchExpression('comments', {
        rating: { $gte: 4 },
      })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        comments: {
          $elemMatch: {
            rating: { $gte: 4 },
          },
        },
      })
    })

    it('should compile query for posts with no comments', () => {
      const predicate = createSizeExpression('comments', 0)
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        comments: { $size: 0 },
      })
    })
  })

  describe('User Profile Queries', () => {
    it('should compile query for users with specific skills', () => {
      const predicate = createAllExpression('user.profile.skills', [
        'javascript',
        'typescript',
        'react',
      ])
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'user.profile.skills': { $all: ['javascript', 'typescript', 'react'] },
      })
    })

    it('should compile query for users with experience at specific company', () => {
      const predicate = createElemMatchExpression('user.profile.experience', {
        company: 'Google',
        years: { $gte: 2 },
      })
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'user.profile.experience': {
          $elemMatch: {
            company: 'Google',
            years: { $gte: 2 },
          },
        },
      })
    })

    it('should compile query for users with exactly 5 favorites', () => {
      const predicate = createSizeExpression('user.settings.favorites', 5)
      const result = compilePredicate<NestedArrayDocument>(predicate)

      expect(result).toEqual({
        'user.settings.favorites': { $size: 5 },
      })
    })
  })

  describe('Version Filtering Queries', () => {
    it('should compile query for documents with major version 2', () => {
      const predicate = createElemMatchExpression('versions', {
        major: 2,
      })
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        versions: { $elemMatch: { major: 2 } },
      })
    })

    it('should compile query for documents with single version', () => {
      const predicate = createSizeExpression('versions', 1)
      const result = compilePredicate<DocumentWithArrayObjects>(predicate)

      expect(result).toEqual({
        versions: { $size: 1 },
      })
    })
  })

  describe('Complex Combined Queries', () => {
    it('should compile query for featured products with in-stock items and multiple tags', () => {
      const predicate = createAndExpression([
        createElemMatchExpression('items', { inStock: true }),
        createAllExpression('tags', ['featured', 'new']),
        createComparisonExpression('gte', 'rating', 4),
      ])
      const result = compilePredicate(predicate)

      expect(result).toEqual({
        $and: [
          { items: { $elemMatch: { inStock: true } } },
          { tags: { $all: ['featured', 'new'] } },
          { rating: { $gte: 4 } },
        ],
      })
    })
  })
})

// =============================================================================
// Performance Tests
// =============================================================================

describe('Performance', () => {
  it('should compile array predicates efficiently', () => {
    const predicate = createAllExpression('tags', ['a', 'b', 'c'])

    // Compile the same predicate multiple times
    const results: MongoFilterQuery[] = []
    for (let i = 0; i < 100; i++) {
      results.push(compilePredicate(predicate))
    }

    // All results should be structurally equal
    results.forEach((result) => {
      expect(result).toEqual({ tags: { $all: ['a', 'b', 'c'] } })
    })
  })

  it('should compile large $all arrays efficiently', () => {
    const tags = Array.from({ length: 100 }, (_, i) => `tag-${i}`)
    const predicate = createAllExpression('tags', tags)
    const result = compilePredicate(predicate)

    expect(result).toEqual({ tags: { $all: tags } })
  })

  it('should compile complex $elemMatch efficiently', () => {
    const predicate = createElemMatchExpression('items', {
      name: { $in: ['a', 'b', 'c', 'd', 'e'] },
      price: { $gte: 10, $lte: 100 },
      quantity: { $gt: 0 },
      inStock: true,
    })

    const results: MongoFilterQuery[] = []
    for (let i = 0; i < 100; i++) {
      results.push(compilePredicate(predicate))
    }

    // All results should be structurally equal
    results.forEach((result) => {
      expect(result).toEqual({
        items: {
          $elemMatch: {
            name: { $in: ['a', 'b', 'c', 'd', 'e'] },
            price: { $gte: 10, $lte: 100 },
            quantity: { $gt: 0 },
            inStock: true,
          },
        },
      })
    })
  })
})
