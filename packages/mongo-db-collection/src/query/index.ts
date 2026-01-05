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
