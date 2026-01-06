/**
 * @file Pagination Compiler for MongoDB Queries
 *
 * This module provides functions to compile TanStack DB pagination options
 * into MongoDB query format (limit, skip, cursor-based pagination).
 *
 * The primary use case is translating client-side subset loading options
 * into server-side MongoDB pagination for the mongo.do service.
 *
 * Bead ID: po0.146 (GREEN implementation)
 *
 * @module @tanstack/mongo-db-collection/query/pagination-compiler
 */

import type { SortSpec, SortDirection, CursorValue, MongoFilterQuery } from '../types.js'
import type { SortExpression } from './sort-compiler.js'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Direction for cursor-based pagination.
 *
 * - 'asc': Fetch items after the cursor (greater than)
 * - 'desc': Fetch items before the cursor (less than)
 */
export type CursorDirection = 'asc' | 'desc'

/**
 * Direction for keyset pagination.
 */
export type KeysetDirection = 'forward' | 'backward'

/**
 * Input options for pagination compilation.
 *
 * This interface matches the pagination-related fields from LoadSubsetOptions
 * and adds cursor direction support.
 */
export interface PaginationInput {
  /** Maximum number of documents to return */
  limit?: number
  /** Number of documents to skip (offset-based pagination) */
  offset?: number
  /** Cursor value for cursor-based pagination */
  cursor?: CursorValue
  /** Field to use for cursor-based pagination */
  cursorField?: string
  /** Direction for cursor pagination (defaults to 'asc') */
  cursorDirection?: CursorDirection
  /** Sort specification for ordering results */
  orderBy?: SortSpec
  /** Include empty result info in response */
  includeEmptyResultInfo?: boolean
  /** Include total count in response */
  withTotalCount?: boolean
  /** Detect if there are more results (fetch limit + 1) */
  detectHasMore?: boolean
  /** Maximum allowed limit (for validation) */
  maxLimit?: number
  /** Maximum allowed offset (for validation) */
  maxOffset?: number
  /** Warn when large offset is used */
  warnOnLargeOffset?: boolean
}

/**
 * Input options for keyset pagination compilation.
 */
export interface KeysetPaginationInput {
  /** Fields to use for keyset pagination (in sort order) */
  keysetFields: string[]
  /** Values for each keyset field from the last document */
  keysetValues?: (CursorValue | null)[]
  /** Direction of pagination */
  direction: KeysetDirection
  /** Sort directions for each field (defaults to ascending) */
  sortDirections?: ('asc' | 'desc')[]
  /** Sort expressions (alternative to sortDirections) */
  sortExpressions?: SortExpression[]
  /** Maximum documents to return */
  limit?: number
  /** Validate that keyset fields match sort expressions order */
  validateFieldOrder?: boolean
}

/**
 * Result from compiling keyset pagination.
 */
export interface KeysetPaginationResult {
  /** Filter condition for keyset pagination */
  filter: MongoFilterQuery
  /** Sort specification in MongoDB format */
  sort: Record<string, 1 | -1>
  /** Limit for the query */
  limit?: number
}

/**
 * MongoDB pagination options output from the compiler.
 *
 * This represents the MongoDB-native format for pagination that can be
 * passed directly to MongoDB queries.
 */
export interface MongoPaginationOptions {
  /** Maximum documents to return (MongoDB limit) */
  limit?: number
  /** Documents to skip (MongoDB skip) */
  skip?: number
  /** Filter condition for cursor-based pagination */
  cursorFilter?: MongoFilterQuery
  /** The field used for cursor pagination (for reference) */
  cursorField?: string
  /** Sort specification in MongoDB format (1 for asc, -1 for desc) */
  sort?: Record<string, 1 | -1>
  /** Empty result handling configuration */
  emptyResultHandling?: {
    returnMetadata: boolean
  }
  /** Include total count in response */
  includeTotalCount?: boolean
  /** Has more detection enabled */
  hasMoreDetection?: boolean
  /** Warning message */
  warning?: string
}

/**
 * Result from compiling cursor pagination.
 */
interface CursorCompilationResult {
  cursorFilter?: MongoFilterQuery
  cursorField?: string
}

/**
 * Input for page number calculation.
 */
export interface PageNumberInput {
  /** Offset for calculating page number from offset */
  offset?: number
  /** Page number for calculating offset from page */
  page?: number
  /** Page size (limit) */
  limit: number
}

/**
 * Result from compiling total count query.
 */
export interface TotalCountQuery {
  /** Aggregation pipeline for counting */
  pipeline?: Array<Record<string, unknown>>
  /** Whether to use estimated count */
  useEstimatedCount?: boolean
  /** Warning message */
  warning?: string
  /** Whether the result may be truncated */
  hasMore?: boolean
}

/**
 * Input for page boundaries detection.
 */
export interface PageBoundaryInput {
  /** Offset for the current page */
  offset?: number
  /** Page number (alternative to offset) */
  page?: number
  /** Page size (limit) */
  limit: number
  /** Total number of documents */
  totalCount: number
}

/**
 * Result from detecting page boundaries.
 */
export interface PageBoundaries {
  /** Current page number (1-indexed) */
  currentPage: number
  /** Total number of pages */
  totalPages: number
  /** Whether this is the first page */
  isFirstPage: boolean
  /** Whether this is the last page */
  isLastPage: boolean
  /** Whether there is a next page */
  hasNextPage: boolean
  /** Whether there is a previous page */
  hasPreviousPage: boolean
  /** Whether the result set is empty */
  isEmpty: boolean
  /** Number of items on the current page */
  itemsOnPage: number
  /** Start index (0-indexed) */
  startIndex: number
  /** End index (0-indexed, inclusive) */
  endIndex: number
}

// =============================================================================
// Error Class
// =============================================================================

/**
 * Error thrown when pagination compilation fails.
 */
export class PaginationCompilationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaginationCompilationError'
  }
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validates that a value is a valid positive integer for limit.
 *
 * @param value - The value to validate
 * @throws PaginationCompilationError if validation fails
 */
function validateLimit(value: number): void {
  if (!Number.isFinite(value)) {
    throw new PaginationCompilationError(
      `Limit must be a finite number, got ${value}`
    )
  }

  if (!Number.isInteger(value)) {
    throw new PaginationCompilationError(
      `Limit must be an integer, got ${value}`
    )
  }

  if (value <= 0) {
    throw new PaginationCompilationError(
      `Limit must be a positive integer, got ${value}`
    )
  }
}

/**
 * Validates that a value is a valid non-negative integer for skip/offset.
 *
 * @param value - The value to validate
 * @throws PaginationCompilationError if validation fails
 */
function validateSkip(value: number): void {
  if (!Number.isFinite(value)) {
    throw new PaginationCompilationError(
      `Skip/offset must be a finite number, got ${value}`
    )
  }

  if (!Number.isInteger(value)) {
    throw new PaginationCompilationError(
      `Skip/offset must be an integer, got ${value}`
    )
  }

  if (value < 0) {
    throw new PaginationCompilationError(
      `Skip/offset must be a non-negative integer, got ${value}`
    )
  }
}

/**
 * Validates the cursor field name.
 *
 * @param field - The field name to validate
 * @throws PaginationCompilationError if validation fails
 */
function validateCursorField(field: string): void {
  if (field.trim() === '') {
    throw new PaginationCompilationError(
      'Cursor field cannot be empty'
    )
  }

  // Validate field doesn't start with $ (MongoDB reserved)
  if (field.startsWith('$')) {
    throw new PaginationCompilationError(
      `Cursor field cannot start with '$': '${field}'`
    )
  }
}

/**
 * Validates that a value is a valid cursor value.
 *
 * @param value - The cursor value to validate
 * @throws PaginationCompilationError if validation fails
 */
function validateCursorValue(value: unknown): void {
  if (value === undefined || value === null) {
    return // undefined and null are valid (no cursor)
  }

  // Check if it's a valid cursor type
  const valueType = typeof value

  if (valueType === 'string' || valueType === 'number') {
    return // Valid cursor types
  }

  if (value instanceof Date) {
    return // Date is a valid cursor type
  }

  // Array and non-Date objects are not valid cursors
  if (Array.isArray(value)) {
    throw new PaginationCompilationError(
      'Cursor value cannot be an array'
    )
  }

  if (valueType === 'object') {
    throw new PaginationCompilationError(
      'Cursor value must be a string, number, or Date'
    )
  }
}

/**
 * Validates the cursor direction.
 *
 * @param direction - The direction to validate
 * @throws PaginationCompilationError if validation fails
 */
function validateCursorDirection(direction: string): void {
  if (direction !== 'asc' && direction !== 'desc') {
    throw new PaginationCompilationError(
      `Invalid cursor direction: '${direction}'. Must be 'asc' or 'desc'`
    )
  }
}

// =============================================================================
// Sort Compilation Helper
// =============================================================================

/**
 * Converts a SortSpec to MongoDB sort format.
 *
 * @param orderBy - The sort specification
 * @returns MongoDB sort object with 1 for asc and -1 for desc
 */
function compileSortSpec(orderBy: SortSpec): Record<string, 1 | -1> {
  const result: Record<string, 1 | -1> = {}

  for (const [field, direction] of Object.entries(orderBy)) {
    result[field] = normalizeSortDirection(direction)
  }

  return result
}

/**
 * Normalizes a sort direction to MongoDB numeric format.
 *
 * @param direction - The sort direction ('asc', 'desc', 1, or -1)
 * @returns 1 for ascending, -1 for descending
 */
function normalizeSortDirection(direction: SortDirection): 1 | -1 {
  if (direction === 'asc' || direction === 1) {
    return 1
  }
  return -1
}

/**
 * Gets the cursor direction from a sort specification for a specific field.
 *
 * @param orderBy - The sort specification
 * @param cursorField - The field to get direction for
 * @returns The cursor direction or undefined if not found
 */
function getCursorDirectionFromSort(
  orderBy: SortSpec | undefined,
  cursorField: string
): CursorDirection | undefined {
  if (!orderBy) return undefined

  const direction = orderBy[cursorField]
  if (direction === undefined) return undefined

  if (direction === 'desc' || direction === -1) {
    return 'desc'
  }
  return 'asc'
}

// =============================================================================
// Limit Compiler
// =============================================================================

/**
 * Compiles a limit value into MongoDB pagination options.
 *
 * @param limit - The maximum number of documents to return
 * @returns MongoDB pagination options with limit, or empty object if undefined
 * @throws PaginationCompilationError if limit is invalid
 *
 * @example
 * ```typescript
 * compileLimit(10) // { limit: 10 }
 * compileLimit(undefined) // {}
 * ```
 */
export function compileLimit(limit: number | undefined): Pick<MongoPaginationOptions, 'limit'> {
  if (limit === undefined) {
    return {}
  }

  validateLimit(limit)

  return { limit }
}

// =============================================================================
// Skip/Offset Compiler
// =============================================================================

/**
 * Compiles a skip/offset value into MongoDB pagination options.
 *
 * @param offset - The number of documents to skip
 * @returns MongoDB pagination options with skip, or empty object if undefined
 * @throws PaginationCompilationError if offset is invalid
 *
 * @example
 * ```typescript
 * compileSkip(20) // { skip: 20 }
 * compileSkip(0) // { skip: 0 }
 * compileSkip(undefined) // {}
 * ```
 */
export function compileSkip(offset: number | undefined): Pick<MongoPaginationOptions, 'skip'> {
  if (offset === undefined) {
    return {}
  }

  validateSkip(offset)

  return { skip: offset }
}

// =============================================================================
// Cursor Pagination Compiler
// =============================================================================

/**
 * Compiles cursor-based pagination into MongoDB filter and field info.
 *
 * Cursor-based pagination is more efficient than offset-based pagination
 * for large datasets because it doesn't need to scan and skip documents.
 *
 * @param cursor - The cursor value (typically from the last document in previous page)
 * @param cursorField - The field to use for cursor comparison (default: '_id')
 * @param direction - The pagination direction ('asc' for $gt, 'desc' for $lt)
 * @returns Cursor filter and field info, or empty object if cursor is undefined
 * @throws PaginationCompilationError if cursor field is invalid
 *
 * @example String cursor with default field
 * ```typescript
 * compileCursorPagination('507f1f77bcf86cd799439011')
 * // { cursorFilter: { _id: { $gt: '507f...' } }, cursorField: '_id' }
 * ```
 *
 * @example Date cursor with descending direction
 * ```typescript
 * compileCursorPagination(new Date(), 'createdAt', 'desc')
 * // { cursorFilter: { createdAt: { $lt: Date } }, cursorField: 'createdAt' }
 * ```
 */
export function compileCursorPagination(
  cursor: CursorValue | undefined,
  cursorField: string = '_id',
  direction: CursorDirection = 'asc'
): CursorCompilationResult {
  if (cursor === undefined) {
    return {}
  }

  validateCursorField(cursorField)
  validateCursorDirection(direction)

  // Determine the comparison operator based on direction
  const operator = direction === 'asc' ? '$gt' : '$lt'

  return {
    cursorFilter: {
      [cursorField]: { [operator]: cursor },
    } as MongoFilterQuery,
    cursorField,
  }
}

// =============================================================================
// Combined Pagination Compiler
// =============================================================================

/**
 * Compiles pagination options into MongoDB-compatible pagination format.
 *
 * This is the main entry point for pagination compilation. It handles:
 * - Limit (maximum documents to return)
 * - Skip/Offset (traditional offset-based pagination)
 * - Cursor-based pagination (efficient for large datasets)
 * - Sort specifications
 *
 * @param input - The pagination input options
 * @returns MongoDB pagination options
 * @throws PaginationCompilationError if input is invalid
 *
 * @example Offset-based pagination
 * ```typescript
 * compilePagination({ limit: 20, offset: 40 })
 * // { limit: 20, skip: 40 }
 * ```
 *
 * @example Cursor-based pagination
 * ```typescript
 * compilePagination({
 *   cursor: 'lastId',
 *   cursorField: '_id',
 *   limit: 20,
 *   orderBy: { createdAt: 'desc' }
 * })
 * // { cursorFilter: {...}, cursorField: '_id', limit: 20, sort: {...} }
 * ```
 */
export function compilePagination(
  input: PaginationInput | undefined
): MongoPaginationOptions {
  if (!input) {
    return {}
  }

  const {
    limit,
    offset,
    cursor,
    cursorField,
    cursorDirection,
    orderBy,
    includeEmptyResultInfo,
    withTotalCount,
    detectHasMore,
    maxLimit,
    maxOffset,
    warnOnLargeOffset,
  } = input

  // Type validation for limit
  if (limit !== undefined && typeof limit !== 'number') {
    throw new PaginationCompilationError(
      `Limit must be a number, got ${typeof limit}`
    )
  }

  // Type validation for offset
  if (offset !== undefined && typeof offset !== 'number') {
    throw new PaginationCompilationError(
      `Offset must be a number, got ${typeof offset}`
    )
  }

  // Validate cursor value type
  if (cursor !== undefined) {
    validateCursorValue(cursor)
  }

  // Validate mutual exclusivity of cursor and offset
  if (cursor !== undefined && offset !== undefined) {
    throw new PaginationCompilationError(
      'Cannot use both cursor and offset pagination simultaneously. Choose one approach.'
    )
  }

  // Validate cursor field is specified when multiple sort fields are used
  if (cursor !== undefined && !cursorField && orderBy) {
    const sortFields = Object.keys(orderBy)
    if (sortFields.length > 1) {
      throw new PaginationCompilationError(
        'cursorField must be specified when using cursor pagination with multiple sort fields'
      )
    }
  }

  // Boundary validation for limit
  if (limit !== undefined && maxLimit !== undefined && limit > maxLimit) {
    throw new PaginationCompilationError(
      `Limit ${limit} exceeds maximum allowed limit of ${maxLimit}`
    )
  }

  // Boundary validation for offset
  if (offset !== undefined && maxOffset !== undefined && offset > maxOffset) {
    throw new PaginationCompilationError(
      `Offset ${offset} exceeds maximum allowed offset of ${maxOffset}`
    )
  }

  const result: MongoPaginationOptions = {}

  // Compile limit (with hasMore detection adjustment)
  if (limit !== undefined) {
    if (detectHasMore) {
      // Fetch one extra to detect if there are more results
      const limitResult = compileLimit(limit + 1)
      Object.assign(result, limitResult)
      result.hasMoreDetection = true
    } else {
      const limitResult = compileLimit(limit)
      Object.assign(result, limitResult)
    }
  }

  // Compile skip/offset
  if (offset !== undefined) {
    const skipResult = compileSkip(offset)
    Object.assign(result, skipResult)
  }

  // Warn about large offset
  if (warnOnLargeOffset && offset !== undefined && offset >= 100000) {
    result.warning = 'Large offset detected. Consider using cursor-based pagination for better performance.'
  }

  // Compile cursor pagination
  if (cursor !== undefined) {
    // Determine effective direction:
    // 1. Use explicit cursorDirection if provided
    // 2. Otherwise, derive from orderBy if the cursor field is in the sort
    // 3. Default to 'asc'
    let effectiveDirection: CursorDirection = cursorDirection ?? 'asc'

    if (!cursorDirection && orderBy && cursorField) {
      const derivedDirection = getCursorDirectionFromSort(orderBy, cursorField)
      if (derivedDirection) {
        effectiveDirection = derivedDirection
      }
    }

    const cursorResult = compileCursorPagination(
      cursor,
      cursorField ?? '_id',
      effectiveDirection
    )
    Object.assign(result, cursorResult)
  }

  // Compile sort specification
  if (orderBy) {
    result.sort = compileSortSpec(orderBy)
  }

  // Include empty result info
  if (includeEmptyResultInfo) {
    result.emptyResultHandling = { returnMetadata: true }
  }

  // Include total count
  if (withTotalCount) {
    result.includeTotalCount = true
  }

  return result
}

// =============================================================================
// Keyset Pagination Compiler
// =============================================================================

/**
 * Compiles keyset pagination into MongoDB filter and sort.
 *
 * Keyset pagination (also known as cursor-based pagination) uses the values
 * of specific fields from the last document to efficiently fetch the next page.
 * This is more efficient than offset-based pagination for large datasets.
 *
 * @param input - The keyset pagination input options
 * @returns MongoDB filter, sort, and limit
 * @throws PaginationCompilationError if input is invalid
 *
 * @example Single field keyset pagination
 * ```typescript
 * compileKeysetPagination({
 *   keysetFields: ['createdAt'],
 *   keysetValues: [new Date('2024-01-15')],
 *   direction: 'forward',
 *   limit: 20,
 * })
 * // { filter: { createdAt: { $gt: Date } }, sort: { createdAt: 1 }, limit: 20 }
 * ```
 *
 * @example Multi-field keyset pagination (composite key)
 * ```typescript
 * compileKeysetPagination({
 *   keysetFields: ['score', 'createdAt', '_id'],
 *   keysetValues: [850, new Date('2024-01-15'), 'abc123'],
 *   direction: 'forward',
 *   limit: 25,
 * })
 * // Returns $or filter for composite keyset comparison
 * ```
 */
export function compileKeysetPagination(input: KeysetPaginationInput): KeysetPaginationResult {
  const {
    keysetFields,
    keysetValues,
    direction,
    sortDirections,
    sortExpressions,
    limit,
    validateFieldOrder,
  } = input

  // Validate keysetFields is not empty
  if (keysetFields.length === 0) {
    throw new PaginationCompilationError(
      'keysetFields must contain at least one field'
    )
  }

  // Validate direction
  if (direction !== 'forward' && direction !== 'backward') {
    throw new PaginationCompilationError(
      `Invalid keyset direction: '${direction}'. Must be 'forward' or 'backward'`
    )
  }

  // Validate keysetFields and keysetValues length match
  if (keysetValues !== undefined && keysetFields.length !== keysetValues.length) {
    throw new PaginationCompilationError(
      `keysetFields and keysetValues length mismatch: ${keysetFields.length} fields, ${keysetValues.length} values`
    )
  }

  // Validate sort directions length if provided
  if (sortDirections && sortDirections.length !== keysetFields.length) {
    throw new PaginationCompilationError(
      `sortDirections length must match keysetFields length: ${sortDirections.length} vs ${keysetFields.length}`
    )
  }

  // Extract sort directions from sortExpressions if provided
  let effectiveSortDirections: ('asc' | 'desc')[] = sortDirections || keysetFields.map(() => 'asc')

  if (sortExpressions && sortExpressions.length > 0) {
    // Validate field order if required
    if (validateFieldOrder) {
      for (let i = 0; i < sortExpressions.length; i++) {
        const expr = sortExpressions[i]
        const expectedField = keysetFields[i]
        const actualField = expr.args[0].path.join('.')

        if (actualField !== expectedField) {
          throw new PaginationCompilationError(
            `Sort expression field order mismatch at index ${i}: expected '${expectedField}', got '${actualField}'`
          )
        }
      }
    }

    // Extract sort directions from expressions
    effectiveSortDirections = sortExpressions.map((expr) => expr.name as 'asc' | 'desc')
  }

  // Build sort specification
  const sort: Record<string, 1 | -1> = {}
  for (let i = 0; i < keysetFields.length; i++) {
    const field = keysetFields[i]
    const sortDir = effectiveSortDirections[i]
    // For backward direction, we reverse the sort
    if (direction === 'backward') {
      sort[field] = sortDir === 'asc' ? -1 : 1
    } else {
      sort[field] = sortDir === 'asc' ? 1 : -1
    }
  }

  // If no values provided (first page), return empty filter
  if (keysetValues === undefined) {
    return {
      filter: {},
      sort,
      limit,
    }
  }

  // Build filter for keyset pagination
  let filter: MongoFilterQuery

  if (keysetFields.length === 1) {
    // Single field: simple comparison
    const field = keysetFields[0]
    const value = keysetValues[0]
    const sortDir = effectiveSortDirections[0]

    // Determine operator based on direction and sort
    // forward + asc => $gt
    // forward + desc => $lt
    // backward + asc => $lt
    // backward + desc => $gt
    let operator: '$gt' | '$lt'
    if (direction === 'forward') {
      operator = sortDir === 'asc' ? '$gt' : '$lt'
    } else {
      operator = sortDir === 'asc' ? '$lt' : '$gt'
    }

    filter = {
      [field]: { [operator]: value },
    } as MongoFilterQuery
  } else {
    // Multiple fields: build $or conditions for tie-breaking
    const orConditions: MongoFilterQuery[] = []

    for (let i = 0; i < keysetFields.length; i++) {
      const condition: Record<string, unknown> = {}

      // Add equality conditions for all previous fields
      for (let j = 0; j < i; j++) {
        condition[keysetFields[j]] = keysetValues[j]
      }

      // Add comparison condition for current field
      const field = keysetFields[i]
      const value = keysetValues[i]
      const sortDir = effectiveSortDirections[i]

      let operator: '$gt' | '$lt'
      if (direction === 'forward') {
        operator = sortDir === 'asc' ? '$gt' : '$lt'
      } else {
        operator = sortDir === 'asc' ? '$lt' : '$gt'
      }

      condition[field] = { [operator]: value }
      orConditions.push(condition as MongoFilterQuery)
    }

    filter = { $or: orConditions } as MongoFilterQuery
  }

  return {
    filter,
    sort,
    limit,
  }
}

// =============================================================================
// Page Number Calculation
// =============================================================================

/**
 * Calculates page number from offset or offset from page number.
 *
 * @param input - The input containing offset/page and limit
 * @param mode - 'toPage' (default) calculates page from offset, 'toOffset' calculates offset from page
 * @returns The calculated page number or offset
 * @throws PaginationCompilationError if input is invalid
 *
 * @example Calculate page from offset
 * ```typescript
 * calculatePageNumber({ offset: 20, limit: 10 }) // 3 (page 3 starts at offset 20)
 * ```
 *
 * @example Calculate offset from page
 * ```typescript
 * calculatePageNumber({ page: 3, limit: 10 }, 'toOffset') // 20
 * ```
 */
export function calculatePageNumber(
  input: PageNumberInput,
  mode: 'toPage' | 'toOffset' = 'toPage'
): number {
  const { offset, page, limit } = input

  // Validate limit
  if (limit <= 0) {
    throw new PaginationCompilationError(
      `Limit must be a positive integer, got ${limit}`
    )
  }

  if (mode === 'toOffset') {
    // Convert page number to offset
    if (page === undefined) {
      throw new PaginationCompilationError(
        'Page number is required when mode is "toOffset"'
      )
    }

    if (page < 1) {
      throw new PaginationCompilationError(
        `Page number must be at least 1, got ${page}`
      )
    }

    return (page - 1) * limit
  } else {
    // Convert offset to page number
    if (offset === undefined) {
      throw new PaginationCompilationError(
        'Offset is required when mode is "toPage"'
      )
    }

    if (offset < 0) {
      throw new PaginationCompilationError(
        `Offset must be non-negative, got ${offset}`
      )
    }

    // Page number is 1-indexed
    return Math.floor(offset / limit) + 1
  }
}

// =============================================================================
// Total Count Query Compiler
// =============================================================================

/**
 * Input for total count query compilation.
 */
export interface TotalCountQueryInput {
  /** Filter to apply before counting */
  filter?: MongoFilterQuery
  /** Custom field name for count result */
  countFieldName?: string
  /** Use estimated count for better performance (ignores filter) */
  estimated?: boolean
  /** Maximum count to return (for performance) */
  maxCount?: number
}

/**
 * Compiles a total count query for MongoDB.
 *
 * @param input - The total count query input options
 * @returns The compiled count query configuration
 *
 * @example Basic count query
 * ```typescript
 * compileTotalCountQuery({})
 * // { pipeline: [{ $count: 'total' }] }
 * ```
 *
 * @example Count with filter
 * ```typescript
 * compileTotalCountQuery({ filter: { status: 'active' } })
 * // { pipeline: [{ $match: { status: 'active' } }, { $count: 'total' }] }
 * ```
 *
 * @example Estimated count
 * ```typescript
 * compileTotalCountQuery({ estimated: true })
 * // { useEstimatedCount: true }
 * ```
 */
export function compileTotalCountQuery(input: TotalCountQueryInput): TotalCountQuery {
  const { filter, countFieldName = 'total', estimated, maxCount } = input

  // Use estimated count for better performance
  if (estimated) {
    const result: TotalCountQuery = { useEstimatedCount: true }

    // Warn if filter is provided with estimated count
    if (filter && Object.keys(filter).length > 0) {
      result.warning = 'Estimated count ignores filter. Use exact count for filtered results.'
    }

    return result
  }

  const pipeline: Array<Record<string, unknown>> = []

  // Add match stage if filter provided
  if (filter && Object.keys(filter).length > 0) {
    pipeline.push({ $match: filter })
  }

  // Add limit stage if maxCount provided (for performance)
  if (maxCount !== undefined) {
    pipeline.push({ $limit: maxCount + 1 })
    pipeline.push({ $count: countFieldName })
    return { pipeline, hasMore: true }
  }

  // Add count stage
  pipeline.push({ $count: countFieldName })

  return { pipeline }
}

// =============================================================================
// Page Boundary Detection
// =============================================================================

/**
 * Detects page boundaries and provides page info.
 *
 * @param input - The page boundary input
 * @returns Page boundary information
 * @throws PaginationCompilationError if input is invalid
 *
 * @example
 * ```typescript
 * detectPageBoundaries({ offset: 20, limit: 10, totalCount: 95 })
 * // Returns: {
 * //   currentPage: 3,
 * //   totalPages: 10,
 * //   isFirstPage: false,
 * //   isLastPage: false,
 * //   hasNextPage: true,
 * //   hasPreviousPage: true,
 * //   isEmpty: false,
 * //   itemsOnPage: 10,
 * //   startIndex: 20,
 * //   endIndex: 29,
 * // }
 * ```
 */
export function detectPageBoundaries(input: PageBoundaryInput): PageBoundaries {
  const { page, limit, totalCount } = input
  let { offset } = input

  // Validate totalCount
  if (totalCount < 0) {
    throw new PaginationCompilationError(
      `Total count must be non-negative, got ${totalCount}`
    )
  }

  // Calculate offset from page if provided
  if (page !== undefined && offset === undefined) {
    offset = (page - 1) * limit
  }

  // Default offset to 0
  if (offset === undefined) {
    offset = 0
  }

  // Handle empty result set
  if (totalCount === 0) {
    return {
      currentPage: 1,
      totalPages: 0,
      isFirstPage: true,
      isLastPage: true,
      hasNextPage: false,
      hasPreviousPage: false,
      isEmpty: true,
      itemsOnPage: 0,
      startIndex: 0,
      endIndex: -1,
    }
  }

  // Handle offset beyond totalCount
  if (offset >= totalCount) {
    return {
      currentPage: Math.floor(offset / limit) + 1,
      totalPages: Math.ceil(totalCount / limit),
      isFirstPage: false,
      isLastPage: true,
      hasNextPage: false,
      hasPreviousPage: true,
      isEmpty: true,
      itemsOnPage: 0,
      startIndex: offset,
      endIndex: offset - 1,
    }
  }

  // Calculate page info
  const currentPage = Math.floor(offset / limit) + 1
  const totalPages = Math.ceil(totalCount / limit)
  const isFirstPage = offset === 0
  const isLastPage = offset + limit >= totalCount
  const hasNextPage = !isLastPage
  const hasPreviousPage = !isFirstPage
  const itemsOnPage = Math.min(limit, totalCount - offset)
  const startIndex = offset
  const endIndex = offset + itemsOnPage - 1

  return {
    currentPage,
    totalPages,
    isFirstPage,
    isLastPage,
    hasNextPage,
    hasPreviousPage,
    isEmpty: false,
    itemsOnPage,
    startIndex,
    endIndex,
  }
}

// =============================================================================
// Offset-Based Pagination Compiler (Alias)
// =============================================================================

/**
 * Compiles offset-based pagination options.
 * This is a convenience function that wraps compilePagination for offset-based scenarios.
 *
 * @param options - Offset pagination options
 * @returns MongoDB pagination options
 */
export function compileOffsetPagination(options: {
  limit?: number
  offset?: number
  orderBy?: SortSpec
}): MongoPaginationOptions {
  return compilePagination(options)
}

// =============================================================================
// Cursor Creation and Parsing
// =============================================================================

/**
 * Creates a pagination cursor from the last document and sort fields.
 *
 * @param lastDoc - The last document from the current page
 * @param sortFields - The fields used for sorting (in order)
 * @returns Base64-encoded cursor string
 *
 * @example
 * ```typescript
 * const cursor = createPaginationCursor(
 *   { _id: 'abc123', score: 850, createdAt: new Date() },
 *   ['score', 'createdAt', '_id']
 * )
 * // Returns: base64-encoded JSON with field values
 * ```
 */
export function createPaginationCursor(
  lastDoc: Record<string, unknown>,
  sortFields: string[]
): string {
  const values: unknown[] = []

  for (const field of sortFields) {
    const value = getNestedValue(lastDoc, field)
    // Serialize Date objects for proper JSON encoding
    if (value instanceof Date) {
      values.push({ __type: 'date', __value: value.toISOString() })
    } else {
      values.push(value)
    }
  }

  const cursorData = {
    fields: sortFields,
    values,
  }

  return Buffer.from(JSON.stringify(cursorData)).toString('base64')
}

/**
 * Parses a pagination cursor back into field values.
 *
 * @param cursor - The base64-encoded cursor string
 * @returns Parsed cursor data with fields and values
 *
 * @example
 * ```typescript
 * const { fields, values } = parsePaginationCursor(cursor)
 * // fields: ['score', 'createdAt', '_id']
 * // values: [850, Date, 'abc123']
 * ```
 */
export function parsePaginationCursor(cursor: string): {
  fields: string[]
  values: (CursorValue | null)[]
} {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8')
    const data = JSON.parse(decoded) as {
      fields: string[]
      values: unknown[]
    }

    // Deserialize Date objects
    const values = data.values.map((v) => {
      if (v && typeof v === 'object' && '__type' in v && v.__type === 'date') {
        return new Date((v as { __value: string }).__value)
      }
      return v as CursorValue | null
    })

    return {
      fields: data.fields,
      values,
    }
  } catch {
    throw new PaginationCompilationError(
      'Invalid pagination cursor format'
    )
  }
}

/**
 * Calculates page boundaries from total count and page size.
 * Alias for detectPageBoundaries with simpler interface.
 *
 * @param total - Total number of documents
 * @param pageSize - Number of documents per page
 * @returns Page boundary calculations
 */
export function calculatePageBoundaries(
  total: number,
  pageSize: number
): { totalPages: number; lastPageSize: number } {
  if (total === 0) {
    return { totalPages: 0, lastPageSize: 0 }
  }

  const totalPages = Math.ceil(total / pageSize)
  const lastPageSize = total % pageSize || pageSize

  return { totalPages, lastPageSize }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Gets a nested value from an object using dot notation path.
 *
 * @param obj - The object to get the value from
 * @param path - The dot-notation path (e.g., 'user.profile.name')
 * @returns The value at the path, or undefined if not found
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}
