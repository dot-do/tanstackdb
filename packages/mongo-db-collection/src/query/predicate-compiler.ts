/**
 * @file Predicate Compiler for MongoDB Queries
 *
 * This module provides functions to compile TanStack DB predicates
 * (BasicExpression<boolean>) into MongoDB query format (MongoFilterQuery).
 *
 * The primary use case is translating client-side query predicates into
 * server-side MongoDB queries for the mongo.do service.
 *
 * @module @tanstack/mongo-db-collection/query/predicate-compiler
 */

import type { MongoFilterQuery } from '../types.js'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Represents a property reference in a TanStack DB expression.
 * Points to a field path in a document.
 */
export interface PropRef<T = unknown> {
  type: 'ref'
  path: string[]
  /** @internal - Type brand for TypeScript inference */
  readonly __returnType?: T
}

/**
 * Represents a literal value in a TanStack DB expression.
 */
export interface Value<T = unknown> {
  type: 'val'
  value: T
  /** @internal - Type brand for TypeScript inference */
  readonly __returnType?: T
}

/**
 * Represents a function call in a TanStack DB expression.
 * Used for operations like eq, gt, lt, etc.
 */
export interface Func<T = unknown> {
  type: 'func'
  name: string
  args: BasicExpression[]
  /** @internal - Type brand for TypeScript inference */
  readonly __returnType?: T
}

/**
 * Union type for all basic expression types in TanStack DB.
 */
export type BasicExpression<T = unknown> = PropRef<T> | Value<T> | Func<T>

// =============================================================================
// Helper Factory Functions
// =============================================================================

/**
 * Creates a property reference (PropRef) from path segments.
 *
 * @param segments - Path segments to the property. Can be individual strings
 *                   or a single dot-notation string.
 * @returns A PropRef pointing to the specified path
 *
 * @example
 * ```typescript
 * // Single field
 * createRef('name') // { type: 'ref', path: ['name'] }
 *
 * // Nested field with separate arguments
 * createRef('user', 'profile', 'firstName') // { type: 'ref', path: ['user', 'profile', 'firstName'] }
 *
 * // Nested field with dot notation
 * createRef('user.profile.firstName') // { type: 'ref', path: ['user', 'profile', 'firstName'] }
 * ```
 */
export function createRef(...segments: string[]): PropRef {
  // If single argument with dot notation, split it
  if (segments.length === 1 && segments[0]!.includes('.')) {
    return {
      type: 'ref',
      path: segments[0]!.split('.'),
    }
  }

  return {
    type: 'ref',
    path: segments,
  }
}

/**
 * Creates a value wrapper (Value) for a literal value.
 *
 * @param value - The literal value to wrap
 * @returns A Value containing the specified value
 *
 * @example
 * ```typescript
 * createValue('John') // { type: 'val', value: 'John' }
 * createValue(42) // { type: 'val', value: 42 }
 * createValue(true) // { type: 'val', value: true }
 * ```
 */
export function createValue<T>(value: T): Value<T> {
  return {
    type: 'val',
    value,
  }
}

/**
 * Creates an equality expression (eq function) for comparing a field to a value.
 *
 * This is a convenience function that combines createRef and createValue
 * into a complete equality predicate.
 *
 * @param fieldPath - The field path (dot notation supported)
 * @param value - The value to compare against
 * @returns A Func expression representing field = value
 *
 * @example
 * ```typescript
 * // Simple equality
 * createEqualityExpression('name', 'John')
 * // Result: { type: 'func', name: 'eq', args: [PropRef, Value] }
 *
 * // Nested field equality
 * createEqualityExpression('user.profile.firstName', 'Jane')
 * ```
 */
export function createEqualityExpression<T>(
  fieldPath: string,
  value: T
): Func<boolean> {
  return {
    type: 'func',
    name: 'eq',
    args: [createRef(fieldPath), createValue(value)],
  }
}

// =============================================================================
// Equality Predicate Compiler
// =============================================================================

/**
 * Error thrown when predicate compilation fails.
 */
export class PredicateCompilationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PredicateCompilationError'
  }
}

/**
 * Validates that an expression is a valid equality predicate.
 *
 * @param predicate - The expression to validate
 * @throws PredicateCompilationError if the predicate is invalid
 */
function validateEqualityPredicate(predicate: BasicExpression): void {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func
  if (func.name !== 'eq') {
    throw new PredicateCompilationError(
      `Expected 'eq' function, got '${func.name}'`
    )
  }

  if (!func.args || func.args.length < 2) {
    throw new PredicateCompilationError(
      `Equality expression requires exactly 2 arguments, got ${func.args?.length ?? 0}`
    )
  }

  const [firstArg, secondArg] = func.args
  if (firstArg?.type !== 'ref') {
    throw new PredicateCompilationError(
      `First argument must be a property reference, got '${firstArg?.type}'`
    )
  }

  if (secondArg?.type !== 'val') {
    throw new PredicateCompilationError(
      `Second argument must be a value, got '${secondArg?.type}'`
    )
  }
}

/**
 * Extracts the field path from a PropRef as a dot-notation string.
 *
 * @param ref - The property reference
 * @returns The field path as a dot-notation string
 *
 * @example
 * ```typescript
 * extractFieldPath({ type: 'ref', path: ['user', 'profile', 'name'] })
 * // Returns: 'user.profile.name'
 * ```
 */
function extractFieldPath(ref: PropRef): string {
  return ref.path.join('.')
}

/**
 * Normalizes a value for MongoDB queries.
 *
 * Handles special cases like undefined (converts to null) since
 * MongoDB does not have an undefined type.
 *
 * @param value - The value to normalize
 * @returns The normalized value suitable for MongoDB
 */
function normalizeValue<T>(value: T): T | null {
  if (value === undefined) {
    return null
  }
  return value
}

/**
 * Compiles an equality predicate into a MongoDB query filter.
 *
 * Takes a TanStack DB equality expression (eq function) and converts it
 * into the corresponding MongoDB query format.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The equality predicate to compile (must be an 'eq' function)
 * @returns MongoDB filter query object
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example Basic Usage
 * ```typescript
 * const predicate = createEqualityExpression('name', 'John')
 * const filter = compileEqualityPredicate(predicate)
 * // Result: { name: 'John' }
 * ```
 *
 * @example Nested Field
 * ```typescript
 * const predicate = createEqualityExpression('user.profile.firstName', 'Jane')
 * const filter = compileEqualityPredicate(predicate)
 * // Result: { 'user.profile.firstName': 'Jane' }
 * ```
 *
 * @example With Type Parameter
 * ```typescript
 * interface User { _id: string; name: string; age: number }
 * const filter = compileEqualityPredicate<User>(predicate)
 * // filter is typed as MongoFilterQuery<User>
 * ```
 */
export function compileEqualityPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  // Validate the predicate structure
  validateEqualityPredicate(predicate)

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const value = func.args[1] as Value

  // Extract the field path
  const fieldPath = extractFieldPath(ref)

  // Normalize the value
  const normalizedValue = normalizeValue(value.value)

  // Build the MongoDB query
  // For simple equality, we use the shorthand { field: value }
  // instead of { field: { $eq: value } } for better performance
  return {
    [fieldPath]: normalizedValue,
  } as MongoFilterQuery<T>
}

// =============================================================================
// Generic Predicate Compiler
// =============================================================================

/**
 * Compiles a TanStack DB predicate into a MongoDB query filter.
 *
 * This is the main entry point for predicate compilation. It automatically
 * dispatches to the appropriate specialized compiler based on the predicate type.
 *
 * Currently supports:
 * - Equality predicates ('eq' function)
 *
 * Future versions will add support for:
 * - Comparison predicates (gt, gte, lt, lte, ne)
 * - Logical predicates (and, or, not)
 * - Array predicates (in, nin, all)
 * - Pattern predicates (regex)
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The predicate to compile
 * @returns MongoDB filter query object
 * @throws PredicateCompilationError if the predicate cannot be compiled
 *
 * @example
 * ```typescript
 * const predicate = createEqualityExpression('status', 'active')
 * const filter = compilePredicate<User>(predicate)
 * // Result: { status: 'active' }
 * ```
 */
export function compilePredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  // Dispatch based on predicate type
  if (predicate.type === 'func') {
    const func = predicate as Func<boolean>

    switch (func.name) {
      case 'eq':
        return compileEqualityPredicate<T>(predicate)

      // Future: Add cases for other predicate types
      // case 'gt':
      // case 'gte':
      // case 'lt':
      // case 'lte':
      // case 'ne':
      // case 'in':
      // case 'and':
      // case 'or':

      default:
        throw new PredicateCompilationError(
          `Unsupported predicate function: '${func.name}'`
        )
    }
  }

  throw new PredicateCompilationError(
    `Cannot compile predicate of type '${predicate.type}'`
  )
}

// =============================================================================
// Exports
// =============================================================================

export type {
  PropRef,
  Value,
  Func,
  BasicExpression,
}
