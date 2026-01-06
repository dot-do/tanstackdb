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
 * ```
 */
export function createSortExpression(
  fieldPath: string,
  direction: 'asc' | 'desc'
): SortExpression {
  return {
    type: 'func',
    name: direction,
    args: [createRef(fieldPath)],
  }
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
