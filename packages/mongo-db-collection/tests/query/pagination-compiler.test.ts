/**
 * @file Pagination Compiler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the pagination compiler functions that
 * transform TanStack DB pagination options into MongoDB query format.
 *
 * The pagination compiler handles the transformation of:
 * - limit/skip (offset-based pagination)
 * - cursor-based pagination with configurable cursor field
 * - Combined pagination with sorting
 *
 * This enables TanStack DB subset loading to be translated into MongoDB
 * queries for server-side pagination via the mongo.do service.
 *
 * RED PHASE: These tests will fail until pagination compiler is implemented
 * in src/query/pagination-compiler.ts
 *
 * Bead ID: po0.145 (RED tests)
 *
 * @see https://www.mongodb.com/docs/manual/reference/method/cursor.skip/
 * @see https://www.mongodb.com/docs/manual/reference/method/cursor.limit/
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  compilePagination,
  compileLimit,
  compileSkip,
  compileCursorPagination,
  compileKeysetPagination,
  calculatePageNumber,
  compileTotalCountQuery,
  detectPageBoundaries,
  PaginationCompilationError,
  type MongoPaginationOptions,
  type PaginationInput,
  type CursorDirection,
  type KeysetPaginationInput,
  type PageBoundaries,
  type TotalCountQuery,
} from '../../src/query/pagination-compiler'
import {
  compileSortExpression,
  compileSortExpressions,
  createSortExpression,
} from '../../src/query/sort-compiler'
import type { SortSpec, CursorValue, MongoFilterQuery } from '../../src/types'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing pagination.
 */
interface TestDocument {
  _id: string
  name: string
  age: number
  createdAt: Date
  score: number
}

// =============================================================================
// Limit Compiler Tests
// =============================================================================

describe('compileLimit', () => {
  describe('Basic Limit', () => {
    it('should compile a positive integer limit', () => {
      const result = compileLimit(10)
      expect(result).toEqual({ limit: 10 })
    })

    it('should compile limit of 1', () => {
      const result = compileLimit(1)
      expect(result).toEqual({ limit: 1 })
    })

    it('should compile large limit values', () => {
      const result = compileLimit(10000)
      expect(result).toEqual({ limit: 10000 })
    })

    it('should return empty object for undefined limit', () => {
      const result = compileLimit(undefined)
      expect(result).toEqual({})
    })
  })

  describe('Edge Cases', () => {
    it('should throw error for zero limit', () => {
      expect(() => compileLimit(0)).toThrow(PaginationCompilationError)
    })

    it('should throw error for negative limit', () => {
      expect(() => compileLimit(-5)).toThrow(PaginationCompilationError)
      expect(() => compileLimit(-1)).toThrow(PaginationCompilationError)
    })

    it('should throw error for non-integer limit', () => {
      expect(() => compileLimit(10.5)).toThrow(PaginationCompilationError)
      expect(() => compileLimit(1.1)).toThrow(PaginationCompilationError)
    })

    it('should throw error for NaN limit', () => {
      expect(() => compileLimit(NaN)).toThrow(PaginationCompilationError)
    })

    it('should throw error for Infinity limit', () => {
      expect(() => compileLimit(Infinity)).toThrow(PaginationCompilationError)
      expect(() => compileLimit(-Infinity)).toThrow(PaginationCompilationError)
    })
  })
})

// =============================================================================
// Skip/Offset Compiler Tests
// =============================================================================

describe('compileSkip', () => {
  describe('Basic Skip/Offset', () => {
    it('should compile a positive integer skip', () => {
      const result = compileSkip(20)
      expect(result).toEqual({ skip: 20 })
    })

    it('should compile skip of 0 (start from beginning)', () => {
      const result = compileSkip(0)
      expect(result).toEqual({ skip: 0 })
    })

    it('should compile large skip values', () => {
      const result = compileSkip(100000)
      expect(result).toEqual({ skip: 100000 })
    })

    it('should return empty object for undefined skip', () => {
      const result = compileSkip(undefined)
      expect(result).toEqual({})
    })
  })

  describe('Edge Cases', () => {
    it('should throw error for negative skip', () => {
      expect(() => compileSkip(-1)).toThrow(PaginationCompilationError)
      expect(() => compileSkip(-100)).toThrow(PaginationCompilationError)
    })

    it('should throw error for non-integer skip', () => {
      expect(() => compileSkip(10.5)).toThrow(PaginationCompilationError)
      expect(() => compileSkip(0.1)).toThrow(PaginationCompilationError)
    })

    it('should throw error for NaN skip', () => {
      expect(() => compileSkip(NaN)).toThrow(PaginationCompilationError)
    })

    it('should throw error for Infinity skip', () => {
      expect(() => compileSkip(Infinity)).toThrow(PaginationCompilationError)
    })
  })
})

// =============================================================================
// Cursor-Based Pagination Compiler Tests
// =============================================================================

describe('compileCursorPagination', () => {
  describe('String Cursor (ObjectId)', () => {
    it('should compile string cursor with default _id field', () => {
      const result = compileCursorPagination('507f1f77bcf86cd799439011')
      expect(result).toEqual({
        cursorFilter: { _id: { $gt: '507f1f77bcf86cd799439011' } },
        cursorField: '_id',
      })
    })

    it('should compile string cursor with custom field', () => {
      const result = compileCursorPagination('abc123', 'userId')
      expect(result).toEqual({
        cursorFilter: { userId: { $gt: 'abc123' } },
        cursorField: 'userId',
      })
    })

    it('should compile string cursor with descending direction', () => {
      const result = compileCursorPagination('507f1f77bcf86cd799439011', '_id', 'desc')
      expect(result).toEqual({
        cursorFilter: { _id: { $lt: '507f1f77bcf86cd799439011' } },
        cursorField: '_id',
      })
    })
  })

  describe('Number Cursor', () => {
    it('should compile numeric cursor with default field', () => {
      const result = compileCursorPagination(1000, 'timestamp')
      expect(result).toEqual({
        cursorFilter: { timestamp: { $gt: 1000 } },
        cursorField: 'timestamp',
      })
    })

    it('should compile numeric cursor with descending direction', () => {
      const result = compileCursorPagination(500, 'score', 'desc')
      expect(result).toEqual({
        cursorFilter: { score: { $lt: 500 } },
        cursorField: 'score',
      })
    })

    it('should compile zero cursor value', () => {
      const result = compileCursorPagination(0, 'index')
      expect(result).toEqual({
        cursorFilter: { index: { $gt: 0 } },
        cursorField: 'index',
      })
    })

    it('should compile negative cursor value', () => {
      const result = compileCursorPagination(-100, 'temperature')
      expect(result).toEqual({
        cursorFilter: { temperature: { $gt: -100 } },
        cursorField: 'temperature',
      })
    })
  })

  describe('Date Cursor', () => {
    it('should compile Date cursor with default field', () => {
      const date = new Date('2024-01-15T10:30:00.000Z')
      const result = compileCursorPagination(date, 'createdAt')
      expect(result).toEqual({
        cursorFilter: { createdAt: { $gt: date } },
        cursorField: 'createdAt',
      })
    })

    it('should compile Date cursor with descending direction', () => {
      const date = new Date('2024-06-01T00:00:00.000Z')
      const result = compileCursorPagination(date, 'updatedAt', 'desc')
      expect(result).toEqual({
        cursorFilter: { updatedAt: { $lt: date } },
        cursorField: 'updatedAt',
      })
    })
  })

  describe('Nested Field Cursor', () => {
    it('should compile cursor with nested field path', () => {
      const result = compileCursorPagination('value123', 'metadata.sortKey')
      expect(result).toEqual({
        cursorFilter: { 'metadata.sortKey': { $gt: 'value123' } },
        cursorField: 'metadata.sortKey',
      })
    })

    it('should compile cursor with deeply nested field path', () => {
      const result = compileCursorPagination(42, 'data.analytics.lastScore', 'desc')
      expect(result).toEqual({
        cursorFilter: { 'data.analytics.lastScore': { $lt: 42 } },
        cursorField: 'data.analytics.lastScore',
      })
    })
  })

  describe('Edge Cases', () => {
    it('should return empty object for undefined cursor', () => {
      const result = compileCursorPagination(undefined)
      expect(result).toEqual({})
    })

    it('should throw error for empty string cursor field', () => {
      expect(() => compileCursorPagination('abc', '')).toThrow(PaginationCompilationError)
    })

    it('should throw error for invalid direction', () => {
      // @ts-expect-error Testing invalid input
      expect(() => compileCursorPagination('abc', '_id', 'invalid')).toThrow(
        PaginationCompilationError
      )
    })
  })
})

// =============================================================================
// Combined Pagination Compiler Tests
// =============================================================================

describe('compilePagination', () => {
  describe('Empty/No Pagination', () => {
    it('should return empty object for empty input', () => {
      const result = compilePagination({})
      expect(result).toEqual({})
    })

    it('should return empty object for undefined input', () => {
      const result = compilePagination(undefined)
      expect(result).toEqual({})
    })
  })

  describe('Limit Only', () => {
    it('should compile pagination with only limit', () => {
      const result = compilePagination({ limit: 25 })
      expect(result).toEqual({ limit: 25 })
    })
  })

  describe('Offset Only', () => {
    it('should compile pagination with only offset', () => {
      const result = compilePagination({ offset: 100 })
      expect(result).toEqual({ skip: 100 })
    })
  })

  describe('Limit + Offset (Traditional Pagination)', () => {
    it('should compile limit and offset together', () => {
      const result = compilePagination({ limit: 20, offset: 40 })
      expect(result).toEqual({ limit: 20, skip: 40 })
    })

    it('should compile page 1 (offset 0)', () => {
      const result = compilePagination({ limit: 10, offset: 0 })
      expect(result).toEqual({ limit: 10, skip: 0 })
    })

    it('should compile page 5 of 10 items per page', () => {
      const result = compilePagination({ limit: 10, offset: 40 })
      expect(result).toEqual({ limit: 10, skip: 40 })
    })
  })

  describe('Cursor-Based Pagination', () => {
    it('should compile cursor pagination with default field', () => {
      const result = compilePagination({ cursor: '507f1f77bcf86cd799439011' })
      expect(result).toEqual({
        cursorFilter: { _id: { $gt: '507f1f77bcf86cd799439011' } },
        cursorField: '_id',
      })
    })

    it('should compile cursor pagination with custom field', () => {
      const result = compilePagination({
        cursor: new Date('2024-01-01'),
        cursorField: 'createdAt',
      })
      expect(result).toEqual({
        cursorFilter: { createdAt: { $gt: new Date('2024-01-01') } },
        cursorField: 'createdAt',
      })
    })

    it('should compile cursor pagination with limit', () => {
      const result = compilePagination({
        cursor: 'lastId123',
        cursorField: '_id',
        limit: 50,
      })
      expect(result).toEqual({
        cursorFilter: { _id: { $gt: 'lastId123' } },
        cursorField: '_id',
        limit: 50,
      })
    })
  })

  describe('Cursor with Sort Direction', () => {
    it('should compile cursor with ascending sort (default)', () => {
      const result = compilePagination({
        cursor: 100,
        cursorField: 'score',
        cursorDirection: 'asc',
      })
      expect(result).toEqual({
        cursorFilter: { score: { $gt: 100 } },
        cursorField: 'score',
      })
    })

    it('should compile cursor with descending sort', () => {
      const result = compilePagination({
        cursor: 100,
        cursorField: 'score',
        cursorDirection: 'desc',
      })
      expect(result).toEqual({
        cursorFilter: { score: { $lt: 100 } },
        cursorField: 'score',
      })
    })

    it('should derive direction from orderBy when cursorDirection not specified', () => {
      const result = compilePagination({
        cursor: 'abc',
        cursorField: 'name',
        orderBy: { name: 'desc' },
      })
      expect(result).toEqual({
        cursorFilter: { name: { $lt: 'abc' } },
        cursorField: 'name',
        sort: { name: -1 },
      })
    })

    it('should use cursorDirection over orderBy when both specified', () => {
      const result = compilePagination({
        cursor: 500,
        cursorField: 'score',
        cursorDirection: 'asc',
        orderBy: { score: 'desc' }, // conflicting direction
      })
      expect(result).toEqual({
        cursorFilter: { score: { $gt: 500 } },
        cursorField: 'score',
        sort: { score: -1 },
      })
    })
  })

  describe('Pagination with Sort', () => {
    it('should compile pagination with sort specification', () => {
      const result = compilePagination({
        limit: 10,
        orderBy: { createdAt: 'desc' },
      })
      expect(result).toEqual({
        limit: 10,
        sort: { createdAt: -1 },
      })
    })

    it('should compile multi-field sort', () => {
      const result = compilePagination({
        limit: 20,
        orderBy: { status: 'asc', createdAt: 'desc' },
      })
      expect(result).toEqual({
        limit: 20,
        sort: { status: 1, createdAt: -1 },
      })
    })

    it('should compile sort with numeric notation', () => {
      const result = compilePagination({
        orderBy: { score: -1, name: 1 },
      })
      expect(result).toEqual({
        sort: { score: -1, name: 1 },
      })
    })
  })

  describe('Complex Combined Pagination', () => {
    it('should compile cursor + limit + sort', () => {
      const date = new Date('2024-01-15')
      const result = compilePagination({
        cursor: date,
        cursorField: 'createdAt',
        limit: 25,
        orderBy: { createdAt: 'desc', _id: 'desc' },
      })
      expect(result).toEqual({
        cursorFilter: { createdAt: { $lt: date } },
        cursorField: 'createdAt',
        limit: 25,
        sort: { createdAt: -1, _id: -1 },
      })
    })
  })

  describe('Cursor vs Offset Mutual Exclusivity', () => {
    it('should throw error when both cursor and offset are provided', () => {
      expect(() =>
        compilePagination({
          cursor: 'abc',
          offset: 100,
        })
      ).toThrow(PaginationCompilationError)
    })

    it('should throw error when cursor, cursorField, and offset are all provided', () => {
      expect(() =>
        compilePagination({
          cursor: 'abc',
          cursorField: '_id',
          offset: 50,
          limit: 10,
        })
      ).toThrow(PaginationCompilationError)
    })
  })

  describe('Error Handling', () => {
    it('should propagate limit validation errors', () => {
      expect(() => compilePagination({ limit: -1 })).toThrow(PaginationCompilationError)
    })

    it('should propagate offset validation errors', () => {
      expect(() => compilePagination({ offset: -50 })).toThrow(PaginationCompilationError)
    })

    it('should propagate cursor field validation errors', () => {
      expect(() => compilePagination({ cursor: 'abc', cursorField: '' })).toThrow(
        PaginationCompilationError
      )
    })
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('Type Safety', () => {
  it('should return MongoPaginationOptions type from compilePagination', () => {
    const result = compilePagination({ limit: 10 })
    expectTypeOf(result).toMatchTypeOf<MongoPaginationOptions>()
  })

  it('should accept PaginationInput type', () => {
    const input: PaginationInput = {
      limit: 10,
      offset: 20,
      cursor: 'abc',
      cursorField: '_id',
      cursorDirection: 'asc',
      orderBy: { createdAt: 'desc' },
    }
    // Should compile without type errors
    expectTypeOf(input).toMatchTypeOf<PaginationInput>()
  })

  it('should accept CursorValue types for cursor', () => {
    // All these should type-check correctly
    const stringCursor: CursorValue = '507f1f77bcf86cd799439011'
    const numberCursor: CursorValue = 12345
    const dateCursor: CursorValue = new Date()

    expectTypeOf(stringCursor).toMatchTypeOf<CursorValue>()
    expectTypeOf(numberCursor).toMatchTypeOf<CursorValue>()
    expectTypeOf(dateCursor).toMatchTypeOf<CursorValue>()
  })

  it('should accept valid CursorDirection values', () => {
    const ascDir: CursorDirection = 'asc'
    const descDir: CursorDirection = 'desc'

    expectTypeOf(ascDir).toMatchTypeOf<CursorDirection>()
    expectTypeOf(descDir).toMatchTypeOf<CursorDirection>()
  })
})

// =============================================================================
// Real-World Usage Patterns
// =============================================================================

describe('Real-World Usage Patterns', () => {
  describe('Offset-Based Pagination (Traditional)', () => {
    it('should compile pagination for page navigation UI', () => {
      const pageSize = 20
      const currentPage = 3

      const result = compilePagination({
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
      })

      expect(result).toEqual({
        limit: 20,
        skip: 40, // Page 3 starts at offset 40
      })
    })

    it('should compile first page request', () => {
      const result = compilePagination({
        limit: 50,
        offset: 0,
      })

      expect(result).toEqual({
        limit: 50,
        skip: 0,
      })
    })
  })

  describe('Cursor-Based Pagination (Infinite Scroll)', () => {
    it('should compile initial load (no cursor)', () => {
      const result = compilePagination({
        limit: 20,
        orderBy: { createdAt: 'desc' },
      })

      expect(result).toEqual({
        limit: 20,
        sort: { createdAt: -1 },
      })
    })

    it('should compile subsequent loads with cursor from last item', () => {
      const lastItemDate = new Date('2024-01-15T10:30:00Z')

      const result = compilePagination({
        cursor: lastItemDate,
        cursorField: 'createdAt',
        limit: 20,
        orderBy: { createdAt: 'desc' },
      })

      expect(result).toEqual({
        cursorFilter: { createdAt: { $lt: lastItemDate } },
        cursorField: 'createdAt',
        limit: 20,
        sort: { createdAt: -1 },
      })
    })
  })

  describe('Leaderboard Pagination', () => {
    it('should compile leaderboard top scores query', () => {
      const result = compilePagination({
        limit: 100,
        orderBy: { score: 'desc', _id: 'asc' },
      })

      expect(result).toEqual({
        limit: 100,
        sort: { score: -1, _id: 1 },
      })
    })

    it('should compile next page of leaderboard with cursor', () => {
      const result = compilePagination({
        cursor: 850, // Last score on previous page
        cursorField: 'score',
        cursorDirection: 'desc',
        limit: 100,
        orderBy: { score: 'desc' },
      })

      expect(result).toEqual({
        cursorFilter: { score: { $lt: 850 } },
        cursorField: 'score',
        limit: 100,
        sort: { score: -1 },
      })
    })
  })

  describe('Activity Feed Pagination', () => {
    it('should compile activity feed with timestamp cursor', () => {
      const lastSeenTimestamp = new Date('2024-01-20T15:00:00Z')

      const result = compilePagination({
        cursor: lastSeenTimestamp,
        cursorField: 'timestamp',
        cursorDirection: 'desc',
        limit: 30,
        orderBy: { timestamp: 'desc' },
      })

      expect(result).toEqual({
        cursorFilter: { timestamp: { $lt: lastSeenTimestamp } },
        cursorField: 'timestamp',
        limit: 30,
        sort: { timestamp: -1 },
      })
    })
  })
})

// =============================================================================
// Performance and Edge Cases
// =============================================================================

describe('Performance and Edge Cases', () => {
  it('should handle very large offset values', () => {
    const result = compilePagination({
      limit: 10,
      offset: 1000000,
    })

    expect(result).toEqual({
      limit: 10,
      skip: 1000000,
    })
  })

  it('should handle maximum safe integer for limit', () => {
    const result = compilePagination({
      limit: Number.MAX_SAFE_INTEGER,
    })

    expect(result).toEqual({
      limit: Number.MAX_SAFE_INTEGER,
    })
  })

  it('should compile efficiently (no excessive object creation)', () => {
    const input = { limit: 10, offset: 20 }

    // Compile the same pagination multiple times
    const results: MongoPaginationOptions[] = []
    for (let i = 0; i < 100; i++) {
      results.push(compilePagination(input))
    }

    // All results should be structurally equal
    results.forEach((result) => {
      expect(result).toEqual({ limit: 10, skip: 20 })
    })
  })
})

// =============================================================================
// Keyset Pagination Tests (RED Phase - Unimplemented)
// =============================================================================

describe('compileKeysetPagination', () => {
  describe('Basic Keyset Pagination', () => {
    it('should compile keyset pagination with single field', () => {
      const input: KeysetPaginationInput = {
        keysetFields: ['createdAt'],
        keysetValues: [new Date('2024-01-15')],
        direction: 'forward',
        limit: 20,
      }

      const result = compileKeysetPagination(input)

      expect(result).toEqual({
        filter: { createdAt: { $gt: new Date('2024-01-15') } },
        sort: { createdAt: 1 },
        limit: 20,
      })
    })

    it('should compile keyset pagination with multiple fields (composite key)', () => {
      const input: KeysetPaginationInput = {
        keysetFields: ['score', 'createdAt', '_id'],
        keysetValues: [850, new Date('2024-01-15'), 'abc123'],
        direction: 'forward',
        limit: 25,
      }

      const result = compileKeysetPagination(input)

      // Composite keyset pagination requires OR conditions for tie-breaking
      expect(result.filter).toEqual({
        $or: [
          { score: { $gt: 850 } },
          { score: 850, createdAt: { $gt: new Date('2024-01-15') } },
          { score: 850, createdAt: new Date('2024-01-15'), _id: { $gt: 'abc123' } },
        ],
      })
      expect(result.sort).toEqual({ score: 1, createdAt: 1, _id: 1 })
      expect(result.limit).toBe(25)
    })

    it('should compile keyset pagination in backward direction', () => {
      const input: KeysetPaginationInput = {
        keysetFields: ['createdAt'],
        keysetValues: [new Date('2024-01-15')],
        direction: 'backward',
        limit: 20,
      }

      const result = compileKeysetPagination(input)

      expect(result).toEqual({
        filter: { createdAt: { $lt: new Date('2024-01-15') } },
        sort: { createdAt: -1 },
        limit: 20,
      })
    })
  })

  describe('Keyset with Descending Sort', () => {
    it('should compile descending keyset pagination', () => {
      const input: KeysetPaginationInput = {
        keysetFields: ['score'],
        keysetValues: [1000],
        direction: 'forward',
        sortDirections: ['desc'],
        limit: 10,
      }

      const result = compileKeysetPagination(input)

      expect(result).toEqual({
        filter: { score: { $lt: 1000 } },
        sort: { score: -1 },
        limit: 10,
      })
    })

    it('should compile mixed ascending/descending keyset pagination', () => {
      const input: KeysetPaginationInput = {
        keysetFields: ['status', 'createdAt'],
        keysetValues: ['active', new Date('2024-01-15')],
        direction: 'forward',
        sortDirections: ['asc', 'desc'],
        limit: 15,
      }

      const result = compileKeysetPagination(input)

      expect(result.filter).toEqual({
        $or: [
          { status: { $gt: 'active' } },
          { status: 'active', createdAt: { $lt: new Date('2024-01-15') } },
        ],
      })
      expect(result.sort).toEqual({ status: 1, createdAt: -1 })
    })
  })

  describe('Keyset Without Values (First Page)', () => {
    it('should compile initial keyset query without values', () => {
      const input: KeysetPaginationInput = {
        keysetFields: ['createdAt', '_id'],
        keysetValues: undefined,
        direction: 'forward',
        limit: 20,
      }

      const result = compileKeysetPagination(input)

      expect(result).toEqual({
        filter: {},
        sort: { createdAt: 1, _id: 1 },
        limit: 20,
      })
    })
  })

  describe('Keyset Edge Cases', () => {
    it('should throw error when keysetFields and keysetValues length mismatch', () => {
      const input: KeysetPaginationInput = {
        keysetFields: ['score', 'createdAt'],
        keysetValues: [850], // Missing second value
        direction: 'forward',
        limit: 10,
      }

      expect(() => compileKeysetPagination(input)).toThrow(PaginationCompilationError)
    })

    it('should throw error for empty keysetFields', () => {
      const input: KeysetPaginationInput = {
        keysetFields: [],
        keysetValues: [],
        direction: 'forward',
        limit: 10,
      }

      expect(() => compileKeysetPagination(input)).toThrow(PaginationCompilationError)
    })

    it('should throw error for invalid direction', () => {
      const input = {
        keysetFields: ['score'],
        keysetValues: [100],
        direction: 'sideways' as any,
        limit: 10,
      }

      expect(() => compileKeysetPagination(input)).toThrow(PaginationCompilationError)
    })

    it('should handle null keyset value', () => {
      const input: KeysetPaginationInput = {
        keysetFields: ['deletedAt'],
        keysetValues: [null],
        direction: 'forward',
        limit: 10,
      }

      const result = compileKeysetPagination(input)

      expect(result.filter).toEqual({ deletedAt: { $gt: null } })
    })
  })
})

// =============================================================================
// Page Number Calculation Tests (RED Phase - Unimplemented)
// =============================================================================

describe('calculatePageNumber', () => {
  describe('Basic Page Calculation', () => {
    it('should calculate page number from offset and limit', () => {
      expect(calculatePageNumber({ offset: 0, limit: 10 })).toBe(1)
      expect(calculatePageNumber({ offset: 10, limit: 10 })).toBe(2)
      expect(calculatePageNumber({ offset: 20, limit: 10 })).toBe(3)
      expect(calculatePageNumber({ offset: 90, limit: 10 })).toBe(10)
    })

    it('should calculate page number with different page sizes', () => {
      expect(calculatePageNumber({ offset: 0, limit: 25 })).toBe(1)
      expect(calculatePageNumber({ offset: 25, limit: 25 })).toBe(2)
      expect(calculatePageNumber({ offset: 50, limit: 25 })).toBe(3)
    })

    it('should handle non-aligned offset (partial page)', () => {
      // When offset is not perfectly aligned, return the page that contains the first item
      expect(calculatePageNumber({ offset: 5, limit: 10 })).toBe(1)
      expect(calculatePageNumber({ offset: 15, limit: 10 })).toBe(2)
      expect(calculatePageNumber({ offset: 27, limit: 10 })).toBe(3)
    })
  })

  describe('Edge Cases', () => {
    it('should return 1 for first page (offset 0)', () => {
      expect(calculatePageNumber({ offset: 0, limit: 20 })).toBe(1)
    })

    it('should handle limit of 1 (single item pages)', () => {
      expect(calculatePageNumber({ offset: 0, limit: 1 })).toBe(1)
      expect(calculatePageNumber({ offset: 1, limit: 1 })).toBe(2)
      expect(calculatePageNumber({ offset: 99, limit: 1 })).toBe(100)
    })

    it('should throw error for zero limit', () => {
      expect(() => calculatePageNumber({ offset: 0, limit: 0 })).toThrow(
        PaginationCompilationError
      )
    })

    it('should throw error for negative offset', () => {
      expect(() => calculatePageNumber({ offset: -10, limit: 10 })).toThrow(
        PaginationCompilationError
      )
    })

    it('should throw error for negative limit', () => {
      expect(() => calculatePageNumber({ offset: 0, limit: -5 })).toThrow(
        PaginationCompilationError
      )
    })
  })

  describe('Calculate Offset from Page Number', () => {
    it('should support reverse calculation (page to offset)', () => {
      expect(calculatePageNumber({ page: 1, limit: 10 }, 'toOffset')).toBe(0)
      expect(calculatePageNumber({ page: 2, limit: 10 }, 'toOffset')).toBe(10)
      expect(calculatePageNumber({ page: 5, limit: 20 }, 'toOffset')).toBe(80)
    })

    it('should throw error for page number less than 1', () => {
      expect(() => calculatePageNumber({ page: 0, limit: 10 }, 'toOffset')).toThrow(
        PaginationCompilationError
      )
      expect(() => calculatePageNumber({ page: -1, limit: 10 }, 'toOffset')).toThrow(
        PaginationCompilationError
      )
    })
  })
})

// =============================================================================
// Total Count Query Tests (RED Phase - Unimplemented)
// =============================================================================

describe('compileTotalCountQuery', () => {
  describe('Basic Count Query', () => {
    it('should compile count query without filter', () => {
      const result = compileTotalCountQuery({})

      expect(result).toEqual({
        pipeline: [{ $count: 'total' }],
      })
    })

    it('should compile count query with existing filter', () => {
      const filter: MongoFilterQuery = { status: 'active' }
      const result = compileTotalCountQuery({ filter })

      expect(result).toEqual({
        pipeline: [{ $match: { status: 'active' } }, { $count: 'total' }],
      })
    })

    it('should compile count query with complex filter', () => {
      const filter: MongoFilterQuery = {
        $and: [{ status: 'active' }, { age: { $gte: 18 } }],
      }
      const result = compileTotalCountQuery({ filter })

      expect(result).toEqual({
        pipeline: [
          { $match: { $and: [{ status: 'active' }, { age: { $gte: 18 } }] } },
          { $count: 'total' },
        ],
      })
    })
  })

  describe('Count with Field Name', () => {
    it('should support custom count field name', () => {
      const result = compileTotalCountQuery({ countFieldName: 'totalCount' })

      expect(result).toEqual({
        pipeline: [{ $count: 'totalCount' }],
      })
    })
  })

  describe('Estimated Count', () => {
    it('should compile estimated count query for better performance', () => {
      const result = compileTotalCountQuery({ estimated: true })

      expect(result).toEqual({
        useEstimatedCount: true,
      })
    })

    it('should ignore filter for estimated count', () => {
      const filter: MongoFilterQuery = { status: 'active' }
      const result = compileTotalCountQuery({ filter, estimated: true })

      // Estimated count cannot use filter - should throw or warn
      expect(result.useEstimatedCount).toBe(true)
      expect(result.warning).toBe(
        'Estimated count ignores filter. Use exact count for filtered results.'
      )
    })
  })

  describe('Count with Limit', () => {
    it('should compile count with upper limit for performance', () => {
      const result = compileTotalCountQuery({ maxCount: 1000 })

      expect(result).toEqual({
        pipeline: [{ $limit: 1001 }, { $count: 'total' }],
        hasMore: true, // Indicates result might be truncated
      })
    })

    it('should compile count with limit and filter', () => {
      const filter: MongoFilterQuery = { status: 'active' }
      const result = compileTotalCountQuery({ filter, maxCount: 500 })

      expect(result).toEqual({
        pipeline: [{ $match: { status: 'active' } }, { $limit: 501 }, { $count: 'total' }],
        hasMore: true,
      })
    })
  })
})

// =============================================================================
// Page Boundary Detection Tests (RED Phase - Unimplemented)
// =============================================================================

describe('detectPageBoundaries', () => {
  describe('First Page Detection', () => {
    it('should detect first page with offset 0', () => {
      const result = detectPageBoundaries({
        offset: 0,
        limit: 10,
        totalCount: 100,
      })

      expect(result.isFirstPage).toBe(true)
      expect(result.isLastPage).toBe(false)
      expect(result.currentPage).toBe(1)
      expect(result.totalPages).toBe(10)
    })

    it('should detect first page when using page number', () => {
      const result = detectPageBoundaries({
        page: 1,
        limit: 20,
        totalCount: 50,
      })

      expect(result.isFirstPage).toBe(true)
      expect(result.isLastPage).toBe(false)
    })
  })

  describe('Last Page Detection', () => {
    it('should detect last page with high offset', () => {
      const result = detectPageBoundaries({
        offset: 90,
        limit: 10,
        totalCount: 100,
      })

      expect(result.isFirstPage).toBe(false)
      expect(result.isLastPage).toBe(true)
      expect(result.currentPage).toBe(10)
    })

    it('should detect last page when items remaining < limit', () => {
      const result = detectPageBoundaries({
        offset: 95,
        limit: 10,
        totalCount: 100,
      })

      expect(result.isLastPage).toBe(true)
      expect(result.itemsOnPage).toBe(5)
    })

    it('should detect last page when offset + limit >= totalCount', () => {
      const result = detectPageBoundaries({
        offset: 45,
        limit: 20,
        totalCount: 50,
      })

      expect(result.isLastPage).toBe(true)
      expect(result.itemsOnPage).toBe(5)
    })
  })

  describe('Middle Page Detection', () => {
    it('should detect middle page correctly', () => {
      const result = detectPageBoundaries({
        offset: 50,
        limit: 10,
        totalCount: 100,
      })

      expect(result.isFirstPage).toBe(false)
      expect(result.isLastPage).toBe(false)
      expect(result.currentPage).toBe(6)
      expect(result.hasNextPage).toBe(true)
      expect(result.hasPreviousPage).toBe(true)
    })
  })

  describe('Single Page', () => {
    it('should detect when there is only one page', () => {
      const result = detectPageBoundaries({
        offset: 0,
        limit: 20,
        totalCount: 15,
      })

      expect(result.isFirstPage).toBe(true)
      expect(result.isLastPage).toBe(true)
      expect(result.totalPages).toBe(1)
      expect(result.hasNextPage).toBe(false)
      expect(result.hasPreviousPage).toBe(false)
    })
  })

  describe('Empty Results', () => {
    it('should handle empty result set', () => {
      const result = detectPageBoundaries({
        offset: 0,
        limit: 10,
        totalCount: 0,
      })

      expect(result.isFirstPage).toBe(true)
      expect(result.isLastPage).toBe(true)
      expect(result.totalPages).toBe(0)
      expect(result.isEmpty).toBe(true)
      expect(result.hasNextPage).toBe(false)
      expect(result.hasPreviousPage).toBe(false)
    })
  })

  describe('Page Info', () => {
    it('should provide complete page info', () => {
      const result = detectPageBoundaries({
        offset: 20,
        limit: 10,
        totalCount: 95,
      })

      expect(result).toEqual({
        currentPage: 3,
        totalPages: 10,
        isFirstPage: false,
        isLastPage: false,
        hasNextPage: true,
        hasPreviousPage: true,
        isEmpty: false,
        itemsOnPage: 10,
        startIndex: 20,
        endIndex: 29,
      })
    })

    it('should calculate start and end indices correctly', () => {
      const result = detectPageBoundaries({
        offset: 50,
        limit: 25,
        totalCount: 100,
      })

      expect(result.startIndex).toBe(50)
      expect(result.endIndex).toBe(74)
    })

    it('should clamp end index to totalCount - 1', () => {
      const result = detectPageBoundaries({
        offset: 90,
        limit: 20,
        totalCount: 95,
      })

      expect(result.startIndex).toBe(90)
      expect(result.endIndex).toBe(94)
      expect(result.itemsOnPage).toBe(5)
    })
  })

  describe('Edge Cases', () => {
    it('should throw error for negative totalCount', () => {
      expect(() =>
        detectPageBoundaries({
          offset: 0,
          limit: 10,
          totalCount: -1,
        })
      ).toThrow(PaginationCompilationError)
    })

    it('should handle offset beyond totalCount', () => {
      const result = detectPageBoundaries({
        offset: 150,
        limit: 10,
        totalCount: 100,
      })

      expect(result.isEmpty).toBe(true)
      expect(result.itemsOnPage).toBe(0)
      expect(result.isLastPage).toBe(true)
    })
  })
})

// =============================================================================
// Empty Result Handling Tests (RED Phase - Unimplemented)
// =============================================================================

describe('Empty Result Handling', () => {
  describe('compilePagination with empty indicators', () => {
    it('should support includeEmptyResultInfo option', () => {
      const result = compilePagination({
        limit: 10,
        offset: 0,
        includeEmptyResultInfo: true,
      })

      expect(result.emptyResultHandling).toBeDefined()
      expect(result.emptyResultHandling?.returnMetadata).toBe(true)
    })
  })

  describe('Pagination with actual count', () => {
    it('should compile pagination with total count request', () => {
      const result = compilePagination({
        limit: 20,
        offset: 40,
        withTotalCount: true,
      })

      expect(result.includeTotalCount).toBe(true)
    })

    it('should compile cursor pagination with has-more detection', () => {
      const result = compilePagination({
        cursor: 'abc123',
        cursorField: '_id',
        limit: 20,
        detectHasMore: true,
      })

      // When detectHasMore is true, fetch limit + 1 items
      expect(result.limit).toBe(21)
      expect(result.hasMoreDetection).toBe(true)
    })
  })
})

// =============================================================================
// Integration with Sort Compiler Tests (RED Phase - Unimplemented)
// =============================================================================

describe('Integration with Sort Compiler', () => {
  describe('compilePagination with SortExpression array', () => {
    it('should compile pagination with sort expressions from sort compiler', () => {
      const sortExprs = [
        createSortExpression('createdAt', 'desc'),
        createSortExpression('_id', 'asc'),
      ]
      const compiledSort = compileSortExpressions(sortExprs)

      const result = compilePagination({
        limit: 20,
        orderBy: compiledSort,
      })

      expect(result).toEqual({
        limit: 20,
        sort: { createdAt: -1, _id: 1 },
      })
    })

    it('should compile cursor pagination using sort expression for direction inference', () => {
      const sortExpr = createSortExpression('score', 'desc')
      const compiledSort = compileSortExpression(sortExpr)

      const result = compilePagination({
        cursor: 500,
        cursorField: 'score',
        limit: 25,
        orderBy: compiledSort,
      })

      // Should infer desc direction from orderBy
      expect(result.cursorFilter).toEqual({ score: { $lt: 500 } })
      expect(result.sort).toEqual({ score: -1 })
    })
  })

  describe('Keyset pagination with sort expressions', () => {
    it('should compile keyset pagination using sort compiler output', () => {
      const sortExprs = [
        createSortExpression('priority', 'desc'),
        createSortExpression('createdAt', 'asc'),
      ]

      const result = compileKeysetPagination({
        keysetFields: ['priority', 'createdAt'],
        keysetValues: [5, new Date('2024-01-15')],
        direction: 'forward',
        sortExpressions: sortExprs,
        limit: 20,
      })

      expect(result.sort).toEqual({ priority: -1, createdAt: 1 })
    })
  })

  describe('Sort order consistency', () => {
    it('should validate sort order matches keyset fields order', () => {
      const sortExprs = [
        createSortExpression('createdAt', 'desc'),
        createSortExpression('priority', 'asc'),
      ]

      // keysetFields order doesn't match sort expressions order
      expect(() =>
        compileKeysetPagination({
          keysetFields: ['priority', 'createdAt'], // Wrong order
          keysetValues: [5, new Date('2024-01-15')],
          direction: 'forward',
          sortExpressions: sortExprs,
          limit: 20,
          validateFieldOrder: true,
        })
      ).toThrow(PaginationCompilationError)
    })
  })
})

// =============================================================================
// Invalid Pagination Params Tests (Additional RED Phase)
// =============================================================================

describe('Invalid Pagination Parameters', () => {
  describe('Type Validation', () => {
    it('should throw error for string limit', () => {
      expect(() =>
        compilePagination({
          limit: '10' as any,
        })
      ).toThrow(PaginationCompilationError)
    })

    it('should throw error for string offset', () => {
      expect(() =>
        compilePagination({
          offset: '20' as any,
        })
      ).toThrow(PaginationCompilationError)
    })

    it('should throw error for array as cursor', () => {
      expect(() =>
        compilePagination({
          cursor: [1, 2, 3] as any,
          cursorField: '_id',
        })
      ).toThrow(PaginationCompilationError)
    })

    it('should throw error for object as cursor (except Date)', () => {
      expect(() =>
        compilePagination({
          cursor: { value: 123 } as any,
          cursorField: '_id',
        })
      ).toThrow(PaginationCompilationError)
    })
  })

  describe('Boundary Validation', () => {
    it('should throw error for limit exceeding maximum', () => {
      // Maximum configurable limit
      expect(() =>
        compilePagination({
          limit: 100001,
          maxLimit: 100000,
        })
      ).toThrow(PaginationCompilationError)
    })

    it('should throw error for offset exceeding maximum', () => {
      expect(() =>
        compilePagination({
          offset: 1000001,
          maxOffset: 1000000,
        })
      ).toThrow(PaginationCompilationError)
    })
  })

  describe('Logical Validation', () => {
    it('should warn when skip-based pagination used with large offset', () => {
      const result = compilePagination({
        limit: 10,
        offset: 100000,
        warnOnLargeOffset: true,
      })

      expect(result.warning).toBe(
        'Large offset detected. Consider using cursor-based pagination for better performance.'
      )
    })

    it('should throw error for cursor without cursorField when multiple sort fields', () => {
      expect(() =>
        compilePagination({
          cursor: 'abc',
          // Missing cursorField
          orderBy: { score: 'desc', createdAt: 'desc' },
        })
      ).toThrow(PaginationCompilationError)
    })
  })

  describe('Whitespace and Special Characters', () => {
    it('should throw error for whitespace-only cursor field', () => {
      expect(() =>
        compilePagination({
          cursor: 'abc',
          cursorField: '   ',
        })
      ).toThrow(PaginationCompilationError)
    })

    it('should handle field paths with array notation', () => {
      // Array index in field path should be allowed
      const result = compileCursorPagination('value', 'items.0.name')
      expect(result.cursorField).toBe('items.0.name')
    })

    it('should handle field paths starting with $', () => {
      // $ prefix is special in MongoDB, should validate or escape
      expect(() => compileCursorPagination('value', '$invalid')).toThrow(
        PaginationCompilationError
      )
    })
  })
})
