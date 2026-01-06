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
 * Validates that an expression is a valid comparison predicate.
 *
 * Comparison predicates are functions like gt, gte, lt, lte, ne that take
 * a property reference as the first argument and a value as the second.
 *
 * @param predicate - The expression to validate
 * @param funcName - The expected function name (for error messages)
 * @throws PredicateCompilationError if the predicate is invalid
 */
function validateComparisonPredicate(predicate: BasicExpression, funcName: string): void {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func
  if (!func.args || func.args.length < 2) {
    throw new PredicateCompilationError(
      `${funcName} expression requires exactly 2 arguments, got ${func.args?.length ?? 0}`
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
 * Validates that an expression is a valid array predicate ($in or $nin).
 *
 * Array predicates require the second argument to be an array value.
 *
 * @param predicate - The expression to validate
 * @param funcName - The expected function name (for error messages)
 * @throws PredicateCompilationError if the predicate is invalid
 */
function validateArrayPredicate(predicate: BasicExpression, funcName: string): void {
  validateComparisonPredicate(predicate, funcName)

  const func = predicate as Func
  const value = func.args[1] as Value

  if (!Array.isArray(value.value)) {
    throw new PredicateCompilationError(
      `${funcName} expression requires an array value, got ${typeof value.value}`
    )
  }
}

/**
 * Validates that an expression is a valid $elemMatch predicate.
 *
 * $elemMatch predicates require a property reference as the first argument
 * and an object (conditions) as the second argument.
 *
 * @param predicate - The expression to validate
 * @throws PredicateCompilationError if the predicate is invalid
 */
function validateElemMatchPredicate(predicate: BasicExpression): void {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func
  if (!func.args || func.args.length < 2) {
    throw new PredicateCompilationError(
      `elemMatch expression requires exactly 2 arguments, got ${func.args?.length ?? 0}`
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

  const value = secondArg as Value
  if (typeof value.value !== 'object' || value.value === null || Array.isArray(value.value)) {
    throw new PredicateCompilationError(
      `elemMatch expression requires an object as conditions, got ${Array.isArray(value.value) ? 'array' : typeof value.value}`
    )
  }
}

/**
 * Validates that an expression is a valid $size predicate.
 *
 * $size predicates require a property reference as the first argument
 * and a non-negative integer as the second argument.
 *
 * @param predicate - The expression to validate
 * @throws PredicateCompilationError if the predicate is invalid
 */
function validateSizePredicate(predicate: BasicExpression): void {
  validateComparisonPredicate(predicate, 'size')

  const func = predicate as Func
  const value = func.args[1] as Value

  if (typeof value.value !== 'number') {
    throw new PredicateCompilationError(
      `size expression requires a number value, got ${typeof value.value}`
    )
  }

  if (value.value < 0) {
    throw new PredicateCompilationError(
      `size expression requires a non-negative number, got ${value.value}`
    )
  }

  if (!Number.isInteger(value.value)) {
    throw new PredicateCompilationError(
      `size expression requires an integer, got ${value.value}`
    )
  }
}

/**
 * Validates that an expression is a valid $exists predicate.
 *
 * $exists predicates require a property reference as the first argument
 * and a boolean value as the second argument.
 *
 * @param predicate - The expression to validate
 * @throws PredicateCompilationError if the predicate is invalid
 */
function validateExistsPredicate(predicate: BasicExpression): void {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func
  if (!func.args || func.args.length < 2) {
    throw new PredicateCompilationError(
      `exists expression requires exactly 2 arguments, got ${func.args?.length ?? 0}`
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

  const value = secondArg as Value
  if (typeof value.value !== 'boolean') {
    throw new PredicateCompilationError(
      `exists expression requires a boolean value, got ${typeof value.value}`
    )
  }
}

/**
 * Validates that an expression is a valid $type predicate.
 *
 * $type predicates require a property reference as the first argument
 * and a type value (string, number, or array of strings) as the second argument.
 *
 * @param predicate - The expression to validate
 * @throws PredicateCompilationError if the predicate is invalid
 */
function validateTypePredicate(predicate: BasicExpression): void {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func
  if (!func.args || func.args.length < 2) {
    throw new PredicateCompilationError(
      `type expression requires exactly 2 arguments, got ${func.args?.length ?? 0}`
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

  const value = secondArg as Value
  const validTypes = typeof value.value === 'string' ||
    typeof value.value === 'number' ||
    (Array.isArray(value.value) && value.value.every((v) => typeof v === 'string'))

  if (!validTypes) {
    throw new PredicateCompilationError(
      `type expression requires a string, number, or array of strings, got ${typeof value.value}`
    )
  }
}

/**
 * Validates that an expression is a valid isNull predicate.
 *
 * isNull predicates require a property reference as the only argument.
 *
 * @param predicate - The expression to validate
 * @throws PredicateCompilationError if the predicate is invalid
 */
function validateIsNullPredicate(predicate: BasicExpression): void {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func
  if (!func.args || func.args.length < 1) {
    throw new PredicateCompilationError(
      `isNull expression requires exactly 1 argument, got ${func.args?.length ?? 0}`
    )
  }

  const [firstArg] = func.args
  if (firstArg?.type !== 'ref') {
    throw new PredicateCompilationError(
      `First argument must be a property reference, got '${firstArg?.type}'`
    )
  }
}

/**
 * Validates that an expression is a valid isNotNull predicate.
 *
 * isNotNull predicates require a property reference as the only argument.
 *
 * @param predicate - The expression to validate
 * @throws PredicateCompilationError if the predicate is invalid
 */
function validateIsNotNullPredicate(predicate: BasicExpression): void {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func
  if (!func.args || func.args.length < 1) {
    throw new PredicateCompilationError(
      `isNotNull expression requires exactly 1 argument, got ${func.args?.length ?? 0}`
    )
  }

  const [firstArg] = func.args
  if (firstArg?.type !== 'ref') {
    throw new PredicateCompilationError(
      `First argument must be a property reference, got '${firstArg?.type}'`
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
// Comparison Predicate Compilers
// =============================================================================

/**
 * Compiles a comparison predicate into a MongoDB query filter with the specified operator.
 *
 * This is a generic helper used by specific comparison compilers (gt, gte, lt, lte, ne).
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The comparison predicate to compile
 * @param operator - The MongoDB operator ($gt, $gte, $lt, $lte, $ne)
 * @param funcName - The function name for error messages
 * @returns MongoDB filter query object
 * @throws PredicateCompilationError if the predicate is invalid
 */
function compileComparisonPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>,
  operator: '$gt' | '$gte' | '$lt' | '$lte' | '$ne',
  funcName: string
): MongoFilterQuery<T> {
  validateComparisonPredicate(predicate, funcName)

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const value = func.args[1] as Value

  const fieldPath = extractFieldPath(ref)
  const normalizedValue = normalizeValue(value.value)

  return {
    [fieldPath]: { [operator]: normalizedValue },
  } as MongoFilterQuery<T>
}

/**
 * Compiles a greater-than predicate into a MongoDB query filter.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The gt predicate to compile
 * @returns MongoDB filter query object with $gt operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'gt', args: [ref('age'), val(18)] }
 * // Result: { age: { $gt: 18 } }
 * ```
 */
export function compileGtPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  return compileComparisonPredicate<T>(predicate, '$gt', 'gt')
}

/**
 * Compiles a greater-than-or-equal predicate into a MongoDB query filter.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The gte predicate to compile
 * @returns MongoDB filter query object with $gte operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'gte', args: [ref('age'), val(18)] }
 * // Result: { age: { $gte: 18 } }
 * ```
 */
export function compileGtePredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  return compileComparisonPredicate<T>(predicate, '$gte', 'gte')
}

/**
 * Compiles a less-than predicate into a MongoDB query filter.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The lt predicate to compile
 * @returns MongoDB filter query object with $lt operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'lt', args: [ref('age'), val(65)] }
 * // Result: { age: { $lt: 65 } }
 * ```
 */
export function compileLtPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  return compileComparisonPredicate<T>(predicate, '$lt', 'lt')
}

/**
 * Compiles a less-than-or-equal predicate into a MongoDB query filter.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The lte predicate to compile
 * @returns MongoDB filter query object with $lte operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'lte', args: [ref('age'), val(100)] }
 * // Result: { age: { $lte: 100 } }
 * ```
 */
export function compileLtePredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  return compileComparisonPredicate<T>(predicate, '$lte', 'lte')
}

/**
 * Compiles a not-equal predicate into a MongoDB query filter.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The ne predicate to compile
 * @returns MongoDB filter query object with $ne operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'ne', args: [ref('status'), val('inactive')] }
 * // Result: { status: { $ne: 'inactive' } }
 * ```
 */
export function compileNePredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  return compileComparisonPredicate<T>(predicate, '$ne', 'ne')
}

/**
 * Compiles an in-array predicate into a MongoDB query filter.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The in predicate to compile
 * @returns MongoDB filter query object with $in operator
 * @throws PredicateCompilationError if the predicate is invalid or value is not an array
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'in', args: [ref('status'), val(['active', 'pending'])] }
 * // Result: { status: { $in: ['active', 'pending'] } }
 * ```
 */
export function compileInPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateArrayPredicate(predicate, 'in')

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const value = func.args[1] as Value

  const fieldPath = extractFieldPath(ref)

  return {
    [fieldPath]: { $in: value.value },
  } as MongoFilterQuery<T>
}

/**
 * Compiles a not-in-array predicate into a MongoDB query filter.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The nin predicate to compile
 * @returns MongoDB filter query object with $nin operator
 * @throws PredicateCompilationError if the predicate is invalid or value is not an array
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'nin', args: [ref('status'), val(['blocked', 'deleted'])] }
 * // Result: { status: { $nin: ['blocked', 'deleted'] } }
 * ```
 */
export function compileNinPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateArrayPredicate(predicate, 'nin')

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const value = func.args[1] as Value

  const fieldPath = extractFieldPath(ref)

  return {
    [fieldPath]: { $nin: value.value },
  } as MongoFilterQuery<T>
}

// =============================================================================
// Array Field Predicate Compilers
// =============================================================================

/**
 * Compiles an $elemMatch predicate into a MongoDB query filter.
 *
 * $elemMatch matches documents where at least one array element matches
 * all specified conditions.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The elemMatch predicate to compile
 * @returns MongoDB filter query object with $elemMatch operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'elemMatch', args: [ref('items'), val({ price: { $gt: 100 } })] }
 * // Result: { items: { $elemMatch: { price: { $gt: 100 } } } }
 * ```
 */
export function compileElemMatchPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateElemMatchPredicate(predicate)

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const value = func.args[1] as Value

  const fieldPath = extractFieldPath(ref)

  return {
    [fieldPath]: { $elemMatch: value.value },
  } as MongoFilterQuery<T>
}

/**
 * Compiles an $all predicate into a MongoDB query filter.
 *
 * $all matches documents where the array field contains all the specified values.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The all predicate to compile
 * @returns MongoDB filter query object with $all operator
 * @throws PredicateCompilationError if the predicate is invalid or value is not an array
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'all', args: [ref('tags'), val(['typescript', 'react'])] }
 * // Result: { tags: { $all: ['typescript', 'react'] } }
 * ```
 */
export function compileAllPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateArrayPredicate(predicate, 'all')

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const value = func.args[1] as Value

  const fieldPath = extractFieldPath(ref)

  return {
    [fieldPath]: { $all: value.value },
  } as MongoFilterQuery<T>
}

/**
 * Compiles a $size predicate into a MongoDB query filter.
 *
 * $size matches documents where the array field has the specified number of elements.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The size predicate to compile
 * @returns MongoDB filter query object with $size operator
 * @throws PredicateCompilationError if the predicate is invalid or value is not a non-negative integer
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'size', args: [ref('tags'), val(3)] }
 * // Result: { tags: { $size: 3 } }
 * ```
 */
export function compileSizePredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateSizePredicate(predicate)

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const value = func.args[1] as Value

  const fieldPath = extractFieldPath(ref)

  return {
    [fieldPath]: { $size: value.value },
  } as MongoFilterQuery<T>
}

// =============================================================================
// Null/Exists Predicate Compilers
// =============================================================================

/**
 * Compiles an $exists predicate into a MongoDB query filter.
 *
 * $exists matches documents where the field exists (or does not exist).
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The exists predicate to compile
 * @returns MongoDB filter query object with $exists operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'exists', args: [ref('email'), val(true)] }
 * // Result: { email: { $exists: true } }
 * ```
 */
export function compileExistsPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateExistsPredicate(predicate)

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const value = func.args[1] as Value

  const fieldPath = extractFieldPath(ref)

  return {
    [fieldPath]: { $exists: value.value },
  } as MongoFilterQuery<T>
}

/**
 * Compiles a $type predicate into a MongoDB query filter.
 *
 * $type matches documents where the field is of the specified BSON type.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The type predicate to compile
 * @returns MongoDB filter query object with $type operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'type', args: [ref('age'), val('number')] }
 * // Result: { age: { $type: 'number' } }
 *
 * // { type: 'func', name: 'type', args: [ref('field'), val(2)] }
 * // Result: { field: { $type: 2 } }
 * ```
 */
export function compileTypePredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateTypePredicate(predicate)

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const value = func.args[1] as Value

  const fieldPath = extractFieldPath(ref)

  return {
    [fieldPath]: { $type: value.value },
  } as MongoFilterQuery<T>
}

/**
 * Compiles an isNull predicate into a MongoDB query filter.
 *
 * isNull matches documents where the field value is null.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The isNull predicate to compile
 * @returns MongoDB filter query object with null check
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'isNull', args: [ref('email')] }
 * // Result: { email: null }
 * ```
 */
export function compileIsNullPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateIsNullPredicate(predicate)

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef

  const fieldPath = extractFieldPath(ref)

  return {
    [fieldPath]: null,
  } as MongoFilterQuery<T>
}

/**
 * Compiles an isNotNull predicate into a MongoDB query filter.
 *
 * isNotNull matches documents where the field value is not null.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The isNotNull predicate to compile
 * @returns MongoDB filter query object with $ne: null check
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'isNotNull', args: [ref('email')] }
 * // Result: { email: { $ne: null } }
 * ```
 */
export function compileIsNotNullPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateIsNotNullPredicate(predicate)

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef

  const fieldPath = extractFieldPath(ref)

  return {
    [fieldPath]: { $ne: null },
  } as MongoFilterQuery<T>
}

// =============================================================================
// Logical Predicate Compilers
// =============================================================================

/**
 * Compiles an AND predicate into a MongoDB query filter.
 *
 * Takes a TanStack DB 'and' function and converts it into MongoDB's $and operator.
 * Recursively compiles all nested predicates.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The and predicate to compile
 * @returns MongoDB filter query object with $and operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'and', args: [eq('status', 'active'), eq('verified', true)] }
 * // Result: { $and: [{ status: 'active' }, { verified: true }] }
 * ```
 */
export function compileAndPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func<boolean>
  if (func.name !== 'and') {
    throw new PredicateCompilationError(
      `Expected 'and' function, got '${func.name}'`
    )
  }

  // Compile each nested predicate
  const compiledPredicates = func.args.map((arg) =>
    compilePredicate<T>(arg as BasicExpression<boolean>)
  )

  return {
    $and: compiledPredicates,
  } as MongoFilterQuery<T>
}

/**
 * Compiles an OR predicate into a MongoDB query filter.
 *
 * Takes a TanStack DB 'or' function and converts it into MongoDB's $or operator.
 * Recursively compiles all nested predicates.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The or predicate to compile
 * @returns MongoDB filter query object with $or operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'or', args: [eq('status', 'active'), eq('status', 'pending')] }
 * // Result: { $or: [{ status: 'active' }, { status: 'pending' }] }
 * ```
 */
export function compileOrPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func<boolean>
  if (func.name !== 'or') {
    throw new PredicateCompilationError(
      `Expected 'or' function, got '${func.name}'`
    )
  }

  // Compile each nested predicate
  const compiledPredicates = func.args.map((arg) =>
    compilePredicate<T>(arg as BasicExpression<boolean>)
  )

  return {
    $or: compiledPredicates,
  } as MongoFilterQuery<T>
}

/**
 * Compiles a NOT predicate into a MongoDB query filter.
 *
 * MongoDB's $not operator works at the field level, so the behavior depends
 * on the type of inner predicate:
 *
 * - For equality predicates: { field: { $not: { $eq: value } } }
 * - For comparison predicates: { field: { $not: { $operator: value } } }
 * - For compound predicates (and, or): uses $nor for negation
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The not predicate to compile
 * @returns MongoDB filter query object with appropriate negation
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // NOT(eq('status', 'inactive'))
 * // Result: { status: { $not: { $eq: 'inactive' } } }
 *
 * // NOT(or([eq('a', 1), eq('b', 2)]))
 * // Result: { $nor: [{ a: 1 }, { b: 2 }] }
 * ```
 */
export function compileNotPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func<boolean>
  if (func.name !== 'not') {
    throw new PredicateCompilationError(
      `Expected 'not' function, got '${func.name}'`
    )
  }

  if (!func.args || func.args.length < 1) {
    throw new PredicateCompilationError(
      `not expression requires exactly 1 argument, got ${func.args?.length ?? 0}`
    )
  }

  const innerPredicate = func.args[0] as BasicExpression<boolean>

  // Handle different inner predicate types
  if (innerPredicate.type === 'func') {
    const innerFunc = innerPredicate as Func<boolean>

    // For OR predicates, NOT(OR(a, b)) = NOR(a, b)
    if (innerFunc.name === 'or') {
      const compiledPredicates = innerFunc.args.map((arg) =>
        compilePredicate<T>(arg as BasicExpression<boolean>)
      )
      return {
        $nor: compiledPredicates,
      } as MongoFilterQuery<T>
    }

    // For AND predicates or other compound predicates, wrap in $nor
    if (innerFunc.name === 'and' || innerFunc.name === 'nor' || innerFunc.name === 'not') {
      const compiledInner = compilePredicate<T>(innerPredicate)
      return {
        $nor: [compiledInner],
      } as MongoFilterQuery<T>
    }

    // For field-level predicates (eq, gt, gte, lt, lte, ne, in, nin)
    // Use field-level $not
    if (['eq', 'gt', 'gte', 'lt', 'lte', 'ne', 'in', 'nin'].includes(innerFunc.name)) {
      const ref = innerFunc.args[0] as PropRef
      const value = innerFunc.args[1] as Value
      const fieldPath = extractFieldPath(ref)
      const normalizedValue = normalizeValue(value.value)

      // Map function name to MongoDB operator
      const operatorMap: Record<string, string> = {
        eq: '$eq',
        gt: '$gt',
        gte: '$gte',
        lt: '$lt',
        lte: '$lte',
        ne: '$ne',
        in: '$in',
        nin: '$nin',
      }

      const operator = operatorMap[innerFunc.name]

      return {
        [fieldPath]: { $not: { [operator!]: normalizedValue } },
      } as MongoFilterQuery<T>
    }

    // For string predicates (regex, startsWith, endsWith, contains)
    // Use field-level $not with the compiled regex
    if (['regex', 'startsWith', 'endsWith', 'contains'].includes(innerFunc.name)) {
      // Compile the string predicate to get the regex structure
      const compiled = compilePredicate<T>(innerPredicate)

      // Extract the field path and regex from the compiled result
      const fieldPath = Object.keys(compiled)[0]!
      const regexObj = (compiled as Record<string, unknown>)[fieldPath]

      return {
        [fieldPath]: { $not: regexObj },
      } as MongoFilterQuery<T>
    }

    // For exists predicate, use field-level $not
    if (innerFunc.name === 'exists') {
      const ref = innerFunc.args[0] as PropRef
      const value = innerFunc.args[1] as Value
      const fieldPath = extractFieldPath(ref)

      return {
        [fieldPath]: { $not: { $exists: value.value } },
      } as MongoFilterQuery<T>
    }

    // For isNull predicate, wrap the compiled result
    if (innerFunc.name === 'isNull') {
      const compiled = compilePredicate<T>(innerPredicate)
      return {
        $nor: [compiled],
      } as MongoFilterQuery<T>
    }
  }

  // Fallback: wrap the compiled predicate in $nor
  const compiledInner = compilePredicate<T>(innerPredicate)
  return {
    $nor: [compiledInner],
  } as MongoFilterQuery<T>
}

/**
 * Compiles a NOR predicate into a MongoDB query filter.
 *
 * Takes a TanStack DB 'nor' function and converts it into MongoDB's $nor operator.
 * NOR matches documents that fail all of the specified query expressions.
 * Recursively compiles all nested predicates.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The nor predicate to compile
 * @returns MongoDB filter query object with $nor operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'nor', args: [eq('status', 'banned'), eq('verified', false)] }
 * // Result: { $nor: [{ status: 'banned' }, { verified: false }] }
 * ```
 */
export function compileNorPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func<boolean>
  if (func.name !== 'nor') {
    throw new PredicateCompilationError(
      `Expected 'nor' function, got '${func.name}'`
    )
  }

  // Compile each nested predicate
  const compiledPredicates = func.args.map((arg) =>
    compilePredicate<T>(arg as BasicExpression<boolean>)
  )

  return {
    $nor: compiledPredicates,
  } as MongoFilterQuery<T>
}

// =============================================================================
// String Predicate Compilers
// =============================================================================

/**
 * Escapes special regex characters in a string.
 *
 * This ensures that literal strings used in startsWith, endsWith, and contains
 * predicates don't get interpreted as regex patterns.
 *
 * @param str - The string to escape
 * @returns The escaped string safe for use in regex
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}[\]()|\\\/]/g, '\\$&')
}

/**
 * Validates that an expression is a valid regex predicate.
 *
 * @param predicate - The expression to validate
 * @param funcName - The expected function name (for error messages)
 * @throws PredicateCompilationError if the predicate is invalid
 */
function validateRegexPredicate(predicate: BasicExpression, funcName: string): void {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func
  if (func.name !== funcName) {
    throw new PredicateCompilationError(
      `Expected '${funcName}' function, got '${func.name}'`
    )
  }

  if (!func.args || func.args.length < 2) {
    throw new PredicateCompilationError(
      `${funcName} expression requires at least 2 arguments, got ${func.args?.length ?? 0}`
    )
  }

  const [firstArg, secondArg, thirdArg] = func.args
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

  const patternValue = secondArg as Value
  if (typeof patternValue.value !== 'string') {
    throw new PredicateCompilationError(
      `${funcName} expression requires a string pattern, got ${typeof patternValue.value}`
    )
  }

  // Validate options if provided
  if (thirdArg !== undefined) {
    if (thirdArg.type !== 'val') {
      throw new PredicateCompilationError(
        `Third argument (options) must be a value, got '${thirdArg.type}'`
      )
    }
    const optionsValue = thirdArg as Value
    if (typeof optionsValue.value !== 'string') {
      throw new PredicateCompilationError(
        `${funcName} options must be a string, got ${typeof optionsValue.value}`
      )
    }
  }
}

/**
 * Validates that an expression is a valid string predicate (startsWith, endsWith, contains).
 *
 * @param predicate - The expression to validate
 * @param funcName - The expected function name (for error messages)
 * @throws PredicateCompilationError if the predicate is invalid
 */
function validateStringPredicate(predicate: BasicExpression, funcName: string): void {
  if (predicate.type !== 'func') {
    throw new PredicateCompilationError(
      `Expected function expression, got '${predicate.type}'`
    )
  }

  const func = predicate as Func
  if (func.name !== funcName) {
    throw new PredicateCompilationError(
      `Expected '${funcName}' function, got '${func.name}'`
    )
  }

  if (!func.args || func.args.length < 2) {
    throw new PredicateCompilationError(
      `${funcName} expression requires exactly 2 arguments, got ${func.args?.length ?? 0}`
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

  const value = secondArg as Value
  if (typeof value.value !== 'string') {
    throw new PredicateCompilationError(
      `${funcName} expression requires a string value, got ${typeof value.value}`
    )
  }
}

/**
 * Compiles a regex predicate into a MongoDB query filter.
 *
 * Takes a TanStack DB regex expression and converts it into MongoDB's $regex operator.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The regex predicate to compile
 * @returns MongoDB filter query object with $regex operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'regex', args: [ref('name'), val('^John'), val('i')] }
 * // Result: { name: { $regex: '^John', $options: 'i' } }
 * ```
 */
export function compileRegexPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateRegexPredicate(predicate, 'regex')

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const patternValue = func.args[1] as Value
  const optionsValue = func.args[2] as Value | undefined

  const fieldPath = extractFieldPath(ref)
  const pattern = patternValue.value as string

  if (optionsValue?.value) {
    return {
      [fieldPath]: { $regex: pattern, $options: optionsValue.value as string },
    } as MongoFilterQuery<T>
  }

  return {
    [fieldPath]: { $regex: pattern },
  } as MongoFilterQuery<T>
}

/**
 * Compiles a startsWith predicate into a MongoDB query filter.
 *
 * Converts the value into a regex pattern anchored at the start (^).
 * Special regex characters in the value are escaped.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The startsWith predicate to compile
 * @returns MongoDB filter query object with $regex operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'startsWith', args: [ref('name'), val('Dr.')] }
 * // Result: { name: { $regex: '^Dr\\.' } }
 * ```
 */
export function compileStartsWithPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateStringPredicate(predicate, 'startsWith')

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const value = func.args[1] as Value

  const fieldPath = extractFieldPath(ref)
  const escapedValue = escapeRegex(value.value as string)

  return {
    [fieldPath]: { $regex: `^${escapedValue}` },
  } as MongoFilterQuery<T>
}

/**
 * Compiles an endsWith predicate into a MongoDB query filter.
 *
 * Converts the value into a regex pattern anchored at the end ($).
 * Special regex characters in the value are escaped.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The endsWith predicate to compile
 * @returns MongoDB filter query object with $regex operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'endsWith', args: [ref('email'), val('@gmail.com')] }
 * // Result: { email: { $regex: '@gmail\\.com$' } }
 * ```
 */
export function compileEndsWithPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateStringPredicate(predicate, 'endsWith')

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const value = func.args[1] as Value

  const fieldPath = extractFieldPath(ref)
  const escapedValue = escapeRegex(value.value as string)

  return {
    [fieldPath]: { $regex: `${escapedValue}$` },
  } as MongoFilterQuery<T>
}

/**
 * Compiles a contains predicate into a MongoDB query filter.
 *
 * Converts the value into a regex pattern (unanchored).
 * Special regex characters in the value are escaped.
 *
 * @typeParam T - The document type for type-safe query generation
 * @param predicate - The contains predicate to compile
 * @returns MongoDB filter query object with $regex operator
 * @throws PredicateCompilationError if the predicate is invalid
 *
 * @example
 * ```typescript
 * // { type: 'func', name: 'contains', args: [ref('description'), val('important')] }
 * // Result: { description: { $regex: 'important' } }
 * ```
 */
export function compileContainsPredicate<T = Record<string, unknown>>(
  predicate: BasicExpression<boolean>
): MongoFilterQuery<T> {
  validateStringPredicate(predicate, 'contains')

  const func = predicate as Func<boolean>
  const ref = func.args[0] as PropRef
  const value = func.args[1] as Value

  const fieldPath = extractFieldPath(ref)
  const escapedValue = escapeRegex(value.value as string)

  return {
    [fieldPath]: { $regex: escapedValue },
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
 * - Comparison predicates ('gt', 'gte', 'lt', 'lte', 'ne' functions)
 * - Array predicates ('in', 'nin' functions)
 * - Array field predicates ('elemMatch', 'all', 'size' functions)
 * - Logical predicates ('and', 'or', 'not', 'nor' functions)
 * - String predicates ('regex', 'startsWith', 'endsWith', 'contains' functions)
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

      // Comparison predicates
      case 'gt':
        return compileGtPredicate<T>(predicate)
      case 'gte':
        return compileGtePredicate<T>(predicate)
      case 'lt':
        return compileLtPredicate<T>(predicate)
      case 'lte':
        return compileLtePredicate<T>(predicate)
      case 'ne':
        return compileNePredicate<T>(predicate)

      // Array predicates
      case 'in':
        return compileInPredicate<T>(predicate)
      case 'nin':
        return compileNinPredicate<T>(predicate)

      // Array field predicates
      case 'elemMatch':
        return compileElemMatchPredicate<T>(predicate)
      case 'all':
        return compileAllPredicate<T>(predicate)
      case 'size':
        return compileSizePredicate<T>(predicate)

      // Null/exists predicates
      case 'exists':
        return compileExistsPredicate<T>(predicate)
      case 'type':
        return compileTypePredicate<T>(predicate)
      case 'isNull':
        return compileIsNullPredicate<T>(predicate)
      case 'isNotNull':
        return compileIsNotNullPredicate<T>(predicate)

      // Logical predicates
      case 'and':
        return compileAndPredicate<T>(predicate)
      case 'or':
        return compileOrPredicate<T>(predicate)
      case 'not':
        return compileNotPredicate<T>(predicate)
      case 'nor':
        return compileNorPredicate<T>(predicate)

      // String predicates
      case 'regex':
        return compileRegexPredicate<T>(predicate)
      case 'startsWith':
        return compileStartsWithPredicate<T>(predicate)
      case 'endsWith':
        return compileEndsWithPredicate<T>(predicate)
      case 'contains':
        return compileContainsPredicate<T>(predicate)

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

