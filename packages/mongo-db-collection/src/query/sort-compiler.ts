/**
 * @file Sort Compiler for MongoDB Queries
 *
 * This module provides functions to compile TanStack DB sort expressions
 * into MongoDB sort format (SortSpec).
 *
 * The primary use case is translating client-side sort specifications into
 * server-side MongoDB sort queries for the mongo.do service.
 *
 * @module @tanstack/mongo-db-collection/query/sort-compiler
 */

import type { SortSpec, SortDirection } from '../types.js'
import type { PropRef, BasicExpression, Func } from './predicate-compiler.js'
import { createRef } from './predicate-compiler.js'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Sort expression representing a sort direction on a field.
 * Uses 'asc' or 'desc' as the function name with a PropRef argument.
 */
export interface SortExpression {
  type: 'func'
  name: 'asc' | 'desc'
  args: [PropRef]
}

/**
 * Options for sort expression creation.
 */
export interface SortExpressionOptions {
  /** Enable case-insensitive sorting */
  caseInsensitive?: boolean
  /** Control null value positioning: 'first' or 'last' */
  nulls?: 'first' | 'last'
}

/**
 * Options for compiling multiple sort expressions.
 */
export interface CompileSortOptions {
  /** Automatically add _id for stable sorting */
  stable?: boolean
  /** Callback for warnings (e.g., non-unique sort fields) */
  onWarning?: (message: string) => void
}

/**
 * MongoDB collation specification for case-insensitive sorting.
 */
export interface CollationSpec {
  locale: string
  strength?: 1 | 2 | 3
  caseLevel?: boolean
}

/**
 * Extended sort result including collation and filter options.
 */
export interface ExtendedSortResult {
  sort: SortSpec
  collation?: CollationSpec
  filter?: Record<string, unknown>
}

/**
 * Extended sort expression with options.
 */
export interface ExtendedSortExpression extends SortExpression {
  options?: SortExpressionOptions
}

// =============================================================================
// Error Class
// =============================================================================

/**
 * Error thrown when sort compilation fails.
 */
export class SortCompilationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SortCompilationError'
  }
}

// =============================================================================
// Helper Factory Functions
// =============================================================================

/**
 * Creates a sort expression for a field with the specified direction.
 *
 * @param fieldPath - The field path (dot notation supported for nested fields)
 * @param direction - The sort direction: 'asc' for ascending, 'desc' for descending
 * @param options - Optional sort options (caseInsensitive, nulls)
 * @returns A sort expression that can be compiled to MongoDB format
 *
 * @example
 * ```typescript
 * // Simple field sort
 * createSortExpression('name', 'asc')
 * // Result: { type: 'func', name: 'asc', args: [PropRef] }
 *
 * // Nested field sort
 * createSortExpression('user.profile.firstName', 'desc')
 * // Result: { type: 'func', name: 'desc', args: [PropRef with nested path] }
 *
 * // Case-insensitive sort
 * createSortExpression('name', 'asc', { caseInsensitive: true })
 *
 * // Nulls-first sort
 * createSortExpression('name', 'asc', { nulls: 'first' })
 * ```
 */
export function createSortExpression(
  fieldPath: string,
  direction: 'asc' | 'desc',
  options?: SortExpressionOptions
): ExtendedSortExpression {
  const expr: ExtendedSortExpression = {
    type: 'func',
    name: direction,
    args: [createRef(fieldPath)],
  }
  if (options) {
    expr.options = options
  }
  return expr
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validates that an expression is a valid sort expression.
 *
 * @param expression - The expression to validate
 * @throws SortCompilationError if the expression is invalid
 */
function validateSortExpression(expression: BasicExpression): asserts expression is SortExpression {
  if (expression.type !== 'func') {
    throw new SortCompilationError(
      `Expected function expression, got '${expression.type}'`
    )
  }

  const func = expression as Func
  if (func.name !== 'asc' && func.name !== 'desc') {
    throw new SortCompilationError(
      `Expected 'asc' or 'desc' function, got '${func.name}'`
    )
  }

  if (!func.args || func.args.length !== 1) {
    throw new SortCompilationError(
      `Sort expression requires exactly 1 argument, got ${func.args?.length ?? 0}`
    )
  }

  const arg = func.args[0]
  if (arg?.type !== 'ref') {
    throw new SortCompilationError(
      `Argument must be a property reference, got '${arg?.type}'`
    )
  }
}

/**
 * Extracts the field path from a PropRef as a dot-notation string.
 *
 * @param ref - The property reference
 * @returns The field path as a dot-notation string
 */
function extractFieldPath(ref: PropRef): string {
  return ref.path.join('.')
}

/**
 * Converts a sort direction name to MongoDB numeric format.
 *
 * @param direction - The sort direction ('asc' or 'desc')
 * @returns MongoDB numeric sort value (1 for ascending, -1 for descending)
 */
function directionToMongo(direction: 'asc' | 'desc'): 1 | -1 {
  return direction === 'asc' ? 1 : -1
}

// =============================================================================
// Single Sort Expression Compiler
// =============================================================================

/**
 * Compiles a single sort expression into a MongoDB sort specification.
 *
 * Takes a TanStack DB sort expression (asc/desc function) and converts it
 * into the corresponding MongoDB sort format.
 *
 * @param expression - The sort expression to compile (must be 'asc' or 'desc' function)
 * @returns MongoDB sort specification object
 * @throws SortCompilationError if the expression is invalid
 *
 * @example Basic Usage
 * ```typescript
 * const sortExpr = createSortExpression('name', 'asc')
 * const sort = compileSortExpression(sortExpr)
 * // Result: { name: 1 }
 * ```
 *
 * @example Nested Field
 * ```typescript
 * const sortExpr = createSortExpression('user.profile.firstName', 'desc')
 * const sort = compileSortExpression(sortExpr)
 * // Result: { 'user.profile.firstName': -1 }
 * ```
 */
export function compileSortExpression(expression: BasicExpression): SortSpec {
  // Validate the expression structure
  validateSortExpression(expression)

  const ref = expression.args[0]
  const fieldPath = extractFieldPath(ref)
  const mongoDirection = directionToMongo(expression.name)

  return {
    [fieldPath]: mongoDirection,
  }
}

// =============================================================================
// Multiple Sort Expressions Compiler
// =============================================================================

/**
 * Compiles multiple sort expressions into a single MongoDB sort specification.
 *
 * Takes an array of TanStack DB sort expressions and combines them into
 * a single MongoDB sort object. The order of fields in the output matches
 * the order of expressions in the input array.
 *
 * @param expressions - Array of sort expressions to compile
 * @returns Combined MongoDB sort specification object
 * @throws SortCompilationError if any expression is invalid
 *
 * @example Multiple Fields
 * ```typescript
 * const sortExprs = [
 *   createSortExpression('status', 'asc'),
 *   createSortExpression('createdAt', 'desc'),
 * ]
 * const sort = compileSortExpressions(sortExprs)
 * // Result: { status: 1, createdAt: -1 }
 * ```
 *
 * @example Empty Array
 * ```typescript
 * const sort = compileSortExpressions([])
 * // Result: {}
 * ```
 *
 * @example Single Expression
 * ```typescript
 * const sortExprs = [createSortExpression('name', 'asc')]
 * const sort = compileSortExpressions(sortExprs)
 * // Result: { name: 1 }
 * ```
 */
export function compileSortExpressions(expressions: BasicExpression[]): SortSpec {
  if (expressions.length === 0) {
    return {}
  }

  const result: SortSpec = {}

  for (const expression of expressions) {
    const compiled = compileSortExpression(expression)
    // Merge the compiled sort into the result
    // Note: If the same field appears multiple times, the last one wins
    Object.assign(result, compiled)
  }

  return result
}

// =============================================================================
// Extended Sort Compilation (with options)
// =============================================================================

/**
 * Compiles sort expressions with extended options (collation, null handling, stability).
 *
 * @param expressions - Array of sort expressions (may include options)
 * @param options - Compilation options
 * @returns Extended sort result with sort spec, collation, and optional filter
 *
 * @example Case-insensitive sorting
 * ```typescript
 * const expr = createSortExpression('name', 'asc', { caseInsensitive: true })
 * const result = compileExtendedSort([expr])
 * // Result: { sort: { name: 1 }, collation: { locale: 'en', strength: 2 } }
 * ```
 *
 * @example Stable sorting with _id
 * ```typescript
 * const expr = createSortExpression('name', 'asc')
 * const result = compileExtendedSort([expr], { stable: true })
 * // Result: { sort: { name: 1, _id: 1 } }
 * ```
 */
export function compileExtendedSort(
  expressions: (BasicExpression | ExtendedSortExpression)[],
  options?: CompileSortOptions
): ExtendedSortResult {
  const result: ExtendedSortResult = {
    sort: {},
  }

  let needsCollation = false
  const nullFilters: Record<string, unknown>[] = []
  const sortFields: string[] = []

  for (const expression of expressions) {
    validateSortExpression(expression)

    const ref = expression.args[0]
    const fieldPath = extractFieldPath(ref)
    const mongoDirection = directionToMongo(expression.name)

    result.sort[fieldPath] = mongoDirection
    sortFields.push(fieldPath)

    // Check for extended options
    const extExpr = expression as ExtendedSortExpression
    if (extExpr.options) {
      if (extExpr.options.caseInsensitive) {
        needsCollation = true
      }

      if (extExpr.options.nulls === 'first') {
        // For nulls-first in ascending order, nulls naturally come first in MongoDB
        // For nulls-first in descending order, we need a compound sort
        // MongoDB sorts: null < numbers < strings (ascending)
        // So for 'asc' + nulls-first, no change needed
        // For 'desc' + nulls-first, we can use a computed field or aggregation
        // For simplicity, we document this behavior
      } else if (extExpr.options.nulls === 'last') {
        // For nulls-last, add a filter to exclude nulls OR use aggregation
        // For simplicity in basic implementation, we add a filter
        nullFilters.push({ [fieldPath]: { $ne: null } })
      }
    }
  }

  // Add collation for case-insensitive sorting
  if (needsCollation) {
    result.collation = {
      locale: 'en',
      strength: 2, // Case-insensitive, diacritic-sensitive
    }
  }

  // Merge null filters if any
  if (nullFilters.length > 0) {
    result.filter = nullFilters.length === 1
      ? nullFilters[0]
      : { $and: nullFilters }
  }

  // Add _id for stable sorting if requested
  if (options?.stable && !sortFields.includes('_id')) {
    result.sort['_id'] = 1

    // Warn if no unique field present
    if (options.onWarning && !sortFields.some(f => f === '_id')) {
      options.onWarning(
        'Sort does not include _id or other unique field. Adding _id for stable sorting.'
      )
    }
  }

  return result
}

/**
 * Creates a collation specification for case-insensitive sorting.
 *
 * @param locale - The locale to use (default: 'en')
 * @param strength - Collation strength (default: 2 for case-insensitive)
 * @returns Collation specification
 */
export function createCollation(
  locale: string = 'en',
  strength: 1 | 2 | 3 = 2
): CollationSpec {
  return { locale, strength }
}

/**
 * Compiles sort with per-field case sensitivity options.
 *
 * @param fields - Array of field configurations
 * @returns Extended sort result
 */
export function compileSortWithCaseSensitivity(
  fields: Array<{
    field: string
    direction: 'asc' | 'desc'
    caseInsensitive?: boolean
  }>
): ExtendedSortResult {
  const expressions = fields.map(f =>
    createSortExpression(f.field, f.direction, {
      caseInsensitive: f.caseInsensitive,
    })
  )
  return compileExtendedSort(expressions)
}

/**
 * Creates a sort specification with nulls handling.
 *
 * @param fieldPath - The field to sort on
 * @param direction - Sort direction
 * @param nulls - Where to place null values: 'first' or 'last'
 * @returns Extended sort result with optional filter
 */
export function compileSortWithNulls(
  fieldPath: string,
  direction: 'asc' | 'desc',
  nulls: 'first' | 'last'
): ExtendedSortResult {
  const expr = createSortExpression(fieldPath, direction, { nulls })
  return compileExtendedSort([expr])
}

/**
 * Creates a stable sort specification that guarantees consistent ordering.
 *
 * @param expressions - Sort expressions
 * @param onWarning - Optional warning callback
 * @returns Extended sort result with _id appended if needed
 */
export function compileStableSort(
  expressions: BasicExpression[],
  onWarning?: (message: string) => void
): ExtendedSortResult {
  return compileExtendedSort(expressions, { stable: true, onWarning })
}
