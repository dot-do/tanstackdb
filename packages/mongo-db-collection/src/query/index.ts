/**
 * @file Query Module Exports
 *
 * This module exports all query-related functionality for
 * the @tanstack/mongo-db-collection package.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/query
 */

// Predicate compilation
export {
  // Factory functions
  createRef,
  createValue,
  createEqualityExpression,
  // Equality Compiler
  compileEqualityPredicate,
  // Comparison Compilers
  compileGtPredicate,
  compileGtePredicate,
  compileLtPredicate,
  compileLtePredicate,
  compileNePredicate,
  // Array Compilers
  compileInPredicate,
  compileNinPredicate,
  // Generic Compiler
  compilePredicate,
  // Error class
  PredicateCompilationError,
} from './predicate-compiler.js'

// Types
export type {
  PropRef,
  Value,
  Func,
  BasicExpression,
} from './predicate-compiler.js'

// Pagination compilation
export {
  // Pagination Compilers
  compileLimit,
  compileSkip,
  compileCursorPagination,
  compilePagination,
  // Error class
  PaginationCompilationError,
} from './pagination-compiler.js'

// Pagination Types
export type {
  CursorDirection,
  PaginationInput,
  MongoPaginationOptions,
} from './pagination-compiler.js'

// Sort compilation
export {
  // Sort Compilers
  createSortExpression,
  compileSortExpression,
  compileSortExpressions,
  // Error class
  SortCompilationError,
} from './sort-compiler.js'

// Sort Types
export type { SortExpression } from './sort-compiler.js'
