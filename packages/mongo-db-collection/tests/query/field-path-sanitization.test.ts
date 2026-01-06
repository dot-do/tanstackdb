/**
 * @file Field Path Sanitization Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for field path sanitization in the predicate compiler.
 * Field paths from PropRef are used directly in MongoDB queries, which creates
 * security risks if malicious paths are not rejected.
 *
 * Security concerns addressed:
 * - Paths starting with $ (e.g., $where) could invoke MongoDB operators
 * - Paths containing __proto__ could cause prototype pollution
 * - Paths containing constructor could cause prototype pollution
 * - Paths with null bytes or control characters could cause injection attacks
 *
 * RED PHASE: These tests will fail until field path validation is implemented
 * in src/query/predicate-compiler.ts
 *
 * @see https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/05.6-Testing_for_NoSQL_Injection
 */

import { describe, it, expect } from 'vitest'
import {
  compilePredicate,
  compileEqualityPredicate,
  compileGtPredicate,
  compileGtePredicate,
  compileLtPredicate,
  compileLtePredicate,
  compileNePredicate,
  compileInPredicate,
  compileNinPredicate,
  createRef,
  createValue,
  createEqualityExpression,
  PredicateCompilationError,
} from '../../src/query/predicate-compiler'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a comparison predicate with a given function name.
 */
function createComparisonPredicate(
  funcName: string,
  fieldPath: string,
  value: unknown
) {
  return {
    type: 'func' as const,
    name: funcName,
    args: [createRef(fieldPath), createValue(value)],
  }
}

// =============================================================================
// Dollar Sign Prefix Tests ($where, $expr, etc.)
// =============================================================================

describe('Field Path Sanitization: Dollar Sign Prefix ($)', () => {
  describe('Paths starting with $ should be rejected', () => {
    it('should reject $where as field path in equality predicate', () => {
      const predicate = createEqualityExpression('$where', 'function() { return true; }')

      expect(() => compileEqualityPredicate(predicate)).toThrow(PredicateCompilationError)
      expect(() => compileEqualityPredicate(predicate)).toThrow(/invalid field path/i)
    })

    it('should reject $expr as field path', () => {
      const predicate = createEqualityExpression('$expr', { $eq: ['$a', '$b'] })

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject $gt as field path (operator injection)', () => {
      const predicate = createEqualityExpression('$gt', 100)

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject $regex as field path', () => {
      const predicate = createEqualityExpression('$regex', '.*')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject $comment as field path', () => {
      const predicate = createEqualityExpression('$comment', 'test')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject paths starting with $ in gt predicate', () => {
      const predicate = createComparisonPredicate('gt', '$where', 0)

      expect(() => compileGtPredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject paths starting with $ in gte predicate', () => {
      const predicate = createComparisonPredicate('gte', '$where', 0)

      expect(() => compileGtePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject paths starting with $ in lt predicate', () => {
      const predicate = createComparisonPredicate('lt', '$where', 0)

      expect(() => compileLtPredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject paths starting with $ in lte predicate', () => {
      const predicate = createComparisonPredicate('lte', '$where', 0)

      expect(() => compileLtePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject paths starting with $ in ne predicate', () => {
      const predicate = createComparisonPredicate('ne', '$where', 'value')

      expect(() => compileNePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject paths starting with $ in in predicate', () => {
      const predicate = createComparisonPredicate('in', '$where', ['a', 'b'])

      expect(() => compileInPredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject paths starting with $ in nin predicate', () => {
      const predicate = createComparisonPredicate('nin', '$where', ['a', 'b'])

      expect(() => compileNinPredicate(predicate)).toThrow(PredicateCompilationError)
    })
  })

  describe('Nested paths with $ prefix in any segment should be rejected', () => {
    it('should reject nested path where segment starts with $', () => {
      const predicate = createEqualityExpression('user.$where', 'malicious')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject deeply nested path with $ in middle', () => {
      const predicate = createEqualityExpression('a.b.$c.d', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject path with $ at end segment', () => {
      const predicate = createEqualityExpression('user.profile.$expr', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })
  })
})

// =============================================================================
// Prototype Pollution Tests (__proto__)
// =============================================================================

describe('Field Path Sanitization: Prototype Pollution (__proto__)', () => {
  describe('Paths containing __proto__ should be rejected', () => {
    it('should reject __proto__ as field path', () => {
      const predicate = createEqualityExpression('__proto__', { polluted: true })

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
      expect(() => compilePredicate(predicate)).toThrow(/invalid field path/i)
    })

    it('should reject nested __proto__ path', () => {
      const predicate = createEqualityExpression('user.__proto__', { polluted: true })

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject __proto__ in middle of path', () => {
      const predicate = createEqualityExpression('user.__proto__.isAdmin', true)

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject __proto__ at end of deep path', () => {
      const predicate = createEqualityExpression('a.b.c.__proto__', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject __proto__ in gt predicate', () => {
      const predicate = createComparisonPredicate('gt', '__proto__', 0)

      expect(() => compileGtPredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject __proto__ in in predicate', () => {
      const predicate = createComparisonPredicate('in', '__proto__', ['a'])

      expect(() => compileInPredicate(predicate)).toThrow(PredicateCompilationError)
    })
  })

  describe('Case sensitivity for __proto__', () => {
    it('should reject __PROTO__ (uppercase)', () => {
      const predicate = createEqualityExpression('__PROTO__', { polluted: true })

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject __Proto__ (mixed case)', () => {
      const predicate = createEqualityExpression('__Proto__', { polluted: true })

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })
  })
})

// =============================================================================
// Constructor Pollution Tests
// =============================================================================

describe('Field Path Sanitization: Constructor Pollution', () => {
  describe('Paths containing constructor should be rejected', () => {
    it('should reject constructor as field path', () => {
      const predicate = createEqualityExpression('constructor', { polluted: true })

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
      expect(() => compilePredicate(predicate)).toThrow(/invalid field path/i)
    })

    it('should reject nested constructor path', () => {
      const predicate = createEqualityExpression('user.constructor', 'malicious')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject constructor in middle of path', () => {
      const predicate = createEqualityExpression('user.constructor.prototype', { x: 1 })

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject constructor.prototype chain', () => {
      const predicate = createEqualityExpression('constructor.prototype.isAdmin', true)

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject constructor in gt predicate', () => {
      const predicate = createComparisonPredicate('gt', 'constructor', 0)

      expect(() => compileGtPredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject constructor in in predicate', () => {
      const predicate = createComparisonPredicate('in', 'constructor', ['a'])

      expect(() => compileInPredicate(predicate)).toThrow(PredicateCompilationError)
    })
  })

  describe('Case sensitivity for constructor', () => {
    it('should reject CONSTRUCTOR (uppercase)', () => {
      const predicate = createEqualityExpression('CONSTRUCTOR', { polluted: true })

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject Constructor (mixed case)', () => {
      const predicate = createEqualityExpression('Constructor', { polluted: true })

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })
  })
})

// =============================================================================
// Null Bytes and Control Characters Tests
// =============================================================================

describe('Field Path Sanitization: Null Bytes and Control Characters', () => {
  describe('Paths with null bytes should be rejected', () => {
    it('should reject path containing null byte', () => {
      const predicate = createEqualityExpression('field\x00name', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
      expect(() => compilePredicate(predicate)).toThrow(/invalid field path/i)
    })

    it('should reject path starting with null byte', () => {
      const predicate = createEqualityExpression('\x00field', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject path ending with null byte', () => {
      const predicate = createEqualityExpression('field\x00', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject nested path with null byte', () => {
      const predicate = createEqualityExpression('user.field\x00name', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })
  })

  describe('Paths with control characters should be rejected', () => {
    it('should reject path with tab character', () => {
      const predicate = createEqualityExpression('field\tname', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject path with newline character', () => {
      const predicate = createEqualityExpression('field\nname', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject path with carriage return', () => {
      const predicate = createEqualityExpression('field\rname', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject path with form feed', () => {
      const predicate = createEqualityExpression('field\fname', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject path with backspace character', () => {
      const predicate = createEqualityExpression('field\bname', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject path with vertical tab', () => {
      const predicate = createEqualityExpression('field\x0Bname', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject path with escape character', () => {
      const predicate = createEqualityExpression('field\x1Bname', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject path with bell character', () => {
      const predicate = createEqualityExpression('field\x07name', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })
  })

  describe('Paths with multiple control characters', () => {
    it('should reject path with multiple null bytes', () => {
      const predicate = createEqualityExpression('field\x00\x00name', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject path with mixed control characters', () => {
      const predicate = createEqualityExpression('field\x00\t\nname', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })
  })
})

// =============================================================================
// Additional Dangerous Patterns
// =============================================================================

describe('Field Path Sanitization: Additional Dangerous Patterns', () => {
  describe('prototype should be rejected', () => {
    it('should reject prototype as field path', () => {
      const predicate = createEqualityExpression('prototype', { polluted: true })

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject nested prototype path', () => {
      const predicate = createEqualityExpression('user.prototype', { polluted: true })

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })
  })

  describe('Empty path segments should be rejected', () => {
    it('should reject empty path segment (double dot)', () => {
      const predicate = createEqualityExpression('user..name', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject path starting with dot', () => {
      const predicate = createEqualityExpression('.field', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject path ending with dot', () => {
      const predicate = createEqualityExpression('field.', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject empty path', () => {
      const predicate = createEqualityExpression('', 'value')

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })
  })
})

// =============================================================================
// Valid Paths Should Still Work
// =============================================================================

describe('Field Path Sanitization: Valid Paths Should Pass', () => {
  describe('Normal field paths should be accepted', () => {
    it('should accept simple field name', () => {
      const predicate = createEqualityExpression('name', 'John')
      const result = compilePredicate(predicate)

      expect(result).toEqual({ name: 'John' })
    })

    it('should accept nested field path', () => {
      const predicate = createEqualityExpression('user.profile.name', 'John')
      const result = compilePredicate(predicate)

      expect(result).toEqual({ 'user.profile.name': 'John' })
    })

    it('should accept field names with underscores', () => {
      const predicate = createEqualityExpression('first_name', 'John')
      const result = compilePredicate(predicate)

      expect(result).toEqual({ first_name: 'John' })
    })

    it('should accept field names with numbers', () => {
      const predicate = createEqualityExpression('field1', 'value')
      const result = compilePredicate(predicate)

      expect(result).toEqual({ field1: 'value' })
    })

    it('should accept _id field', () => {
      const predicate = createEqualityExpression('_id', '123')
      const result = compilePredicate(predicate)

      expect(result).toEqual({ _id: '123' })
    })

    it('should accept field names starting with underscore', () => {
      const predicate = createEqualityExpression('_private', 'value')
      const result = compilePredicate(predicate)

      expect(result).toEqual({ _private: 'value' })
    })

    it('should accept array index notation', () => {
      const predicate = createEqualityExpression('items.0.name', 'value')
      const result = compilePredicate(predicate)

      expect(result).toEqual({ 'items.0.name': 'value' })
    })

    it('should accept field named $field (containing but not starting with $)', () => {
      // This is a tricky case - we only reject paths that START with $
      // A field containing $ in the middle should be allowed if it's valid
      // Actually, we should reject any segment that starts with $
      const predicate = createEqualityExpression('my$field', 'value')
      const result = compilePredicate(predicate)

      expect(result).toEqual({ my$field: 'value' })
    })
  })
})

// =============================================================================
// PropRef Array Path Tests
// =============================================================================

describe('Field Path Sanitization: PropRef Array Paths', () => {
  describe('Path arrays with invalid segments should be rejected', () => {
    it('should reject PropRef with $ segment in path array', () => {
      const ref = createRef('user', '$where', 'field')
      const predicate = {
        type: 'func' as const,
        name: 'eq',
        args: [ref, createValue('value')],
      }

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject PropRef with __proto__ segment in path array', () => {
      const ref = createRef('user', '__proto__', 'field')
      const predicate = {
        type: 'func' as const,
        name: 'eq',
        args: [ref, createValue('value')],
      }

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject PropRef with constructor segment in path array', () => {
      const ref = createRef('user', 'constructor', 'prototype')
      const predicate = {
        type: 'func' as const,
        name: 'eq',
        args: [ref, createValue('value')],
      }

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject PropRef with null byte in segment', () => {
      const ref = createRef('user', 'field\x00', 'name')
      const predicate = {
        type: 'func' as const,
        name: 'eq',
        args: [ref, createValue('value')],
      }

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })

    it('should reject PropRef with empty segment in path array', () => {
      const ref = createRef('user', '', 'name')
      const predicate = {
        type: 'func' as const,
        name: 'eq',
        args: [ref, createValue('value')],
      }

      expect(() => compilePredicate(predicate)).toThrow(PredicateCompilationError)
    })
  })
})
