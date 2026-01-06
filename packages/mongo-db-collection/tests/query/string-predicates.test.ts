/**
 * @file String Predicate Compiler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for string predicate compilers that
 * transform TanStack DB string predicates into MongoDB query format.
 *
 * The string predicate compilers handle transformations of:
 * - $regex: BasicExpression<boolean> with 'regex' function -> { field: { $regex: pattern, $options?: flags } }
 * - startsWith: 'startsWith' function -> { field: { $regex: '^value' } }
 * - endsWith: 'endsWith' function -> { field: { $regex: 'value$' } }
 * - contains: 'contains' function -> { field: { $regex: 'value' } }
 *
 * RED PHASE: These tests will fail until string predicate compilers are
 * implemented in src/query/predicate-compiler.ts
 *
 * @see https://www.mongodb.com/docs/manual/reference/operator/query/regex/
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  compilePredicate,
  createRef,
  createValue,
  PredicateCompilationError,
  compileRegexPredicate,
  compileStartsWithPredicate,
  compileEndsWithPredicate,
  compileContainsPredicate,
} from '../../src/query/predicate-compiler'
import type { MongoFilterQuery } from '../../src/types'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing string predicates.
 */
interface TestDocument {
  _id: string
  name: string
  email: string
  description: string
  slug: string
  status: 'active' | 'inactive' | 'pending'
  tags: string[]
}

/**
 * Document with nested objects for testing deep field string comparisons.
 */
interface NestedDocument {
  _id: string
  user: {
    profile: {
      firstName: string
      lastName: string
      bio: string
    }
    contact: {
      email: string
      phone: string
    }
  }
  metadata: {
    title: string
    keywords: string[]
  }
}

// =============================================================================
// Helper Factory Functions
// =============================================================================

/**
 * Creates a regex expression (regex function).
 */
function createRegexExpression(fieldPath: string, pattern: string, options?: string) {
  const args = [createRef(fieldPath), createValue(pattern)]
  if (options) {
    args.push(createValue(options))
  }
  return {
    type: 'func' as const,
    name: 'regex',
    args,
  }
}

/**
 * Creates a startsWith expression.
 */
function createStartsWithExpression(fieldPath: string, value: string) {
  return {
    type: 'func' as const,
    name: 'startsWith',
    args: [createRef(fieldPath), createValue(value)],
  }
}

/**
 * Creates an endsWith expression.
 */
function createEndsWithExpression(fieldPath: string, value: string) {
  return {
    type: 'func' as const,
    name: 'endsWith',
    args: [createRef(fieldPath), createValue(value)],
  }
}

/**
 * Creates a contains expression.
 */
function createContainsExpression(fieldPath: string, value: string) {
  return {
    type: 'func' as const,
    name: 'contains',
    args: [createRef(fieldPath), createValue(value)],
  }
}

// =============================================================================
// $regex Predicate Tests
// =============================================================================

describe('String Predicate Compiler', () => {
  describe('compileRegexPredicate', () => {
    describe('basic regex patterns', () => {
      it('should compile simple regex pattern', () => {
        const predicate = createRegexExpression('name', 'John')
        const result = compileRegexPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          name: { $regex: 'John' },
        })
      })

      it('should compile regex pattern with options', () => {
        const predicate = createRegexExpression('name', 'john', 'i')
        const result = compileRegexPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          name: { $regex: 'john', $options: 'i' },
        })
      })

      it('should compile regex with multiple options', () => {
        const predicate = createRegexExpression('description', 'test.*pattern', 'im')
        const result = compileRegexPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          description: { $regex: 'test.*pattern', $options: 'im' },
        })
      })

      it('should compile regex for email validation pattern', () => {
        const predicate = createRegexExpression('email', '^[a-zA-Z0-9]+@[a-zA-Z0-9]+\\.[a-zA-Z]{2,}$')
        const result = compileRegexPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          email: { $regex: '^[a-zA-Z0-9]+@[a-zA-Z0-9]+\\.[a-zA-Z]{2,}$' },
        })
      })
    })

    describe('nested field regex', () => {
      it('should compile regex for nested field using dot notation', () => {
        const predicate = createRegexExpression('user.profile.firstName', '^J')
        const result = compileRegexPredicate<NestedDocument>(predicate)

        expect(result).toEqual({
          'user.profile.firstName': { $regex: '^J' },
        })
      })

      it('should compile regex for deeply nested field', () => {
        const predicate = createRegexExpression('user.contact.email', '@gmail\\.com$', 'i')
        const result = compileRegexPredicate<NestedDocument>(predicate)

        expect(result).toEqual({
          'user.contact.email': { $regex: '@gmail\\.com$', $options: 'i' },
        })
      })
    })

    describe('special regex characters', () => {
      it('should handle patterns with special regex characters', () => {
        const predicate = createRegexExpression('slug', 'hello-world\\.test')
        const result = compileRegexPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          slug: { $regex: 'hello-world\\.test' },
        })
      })

      it('should handle patterns with capturing groups', () => {
        const predicate = createRegexExpression('description', '(test|example)')
        const result = compileRegexPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          description: { $regex: '(test|example)' },
        })
      })

      it('should handle patterns with character classes', () => {
        const predicate = createRegexExpression('name', '[A-Z][a-z]+')
        const result = compileRegexPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          name: { $regex: '[A-Z][a-z]+' },
        })
      })
    })

    describe('error handling', () => {
      it('should throw error for non-function expression', () => {
        const predicate = createValue('invalid')

        expect(() => compileRegexPredicate(predicate as any)).toThrow(
          PredicateCompilationError
        )
      })

      it('should throw error for wrong function name', () => {
        const predicate = {
          type: 'func' as const,
          name: 'eq',
          args: [createRef('name'), createValue('test')],
        }

        expect(() => compileRegexPredicate(predicate)).toThrow(
          PredicateCompilationError
        )
      })

      it('should throw error when first argument is not a ref', () => {
        const predicate = {
          type: 'func' as const,
          name: 'regex',
          args: [createValue('name'), createValue('test')],
        }

        expect(() => compileRegexPredicate(predicate)).toThrow(
          PredicateCompilationError
        )
      })

      it('should throw error when pattern is not a string', () => {
        const predicate = {
          type: 'func' as const,
          name: 'regex',
          args: [createRef('name'), createValue(123)],
        }

        expect(() => compileRegexPredicate(predicate)).toThrow(
          PredicateCompilationError
        )
      })

      it('should throw error when options is not a string', () => {
        const predicate = {
          type: 'func' as const,
          name: 'regex',
          args: [createRef('name'), createValue('test'), createValue(123)],
        }

        expect(() => compileRegexPredicate(predicate)).toThrow(
          PredicateCompilationError
        )
      })

      it('should throw error for missing arguments', () => {
        const predicate = {
          type: 'func' as const,
          name: 'regex',
          args: [createRef('name')],
        }

        expect(() => compileRegexPredicate(predicate)).toThrow(
          PredicateCompilationError
        )
      })
    })
  })

  // =============================================================================
  // startsWith Predicate Tests
  // =============================================================================

  describe('compileStartsWithPredicate', () => {
    describe('basic startsWith patterns', () => {
      it('should compile startsWith for simple string', () => {
        const predicate = createStartsWithExpression('name', 'John')
        const result = compileStartsWithPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          name: { $regex: '^John' },
        })
      })

      it('should escape special regex characters in startsWith', () => {
        const predicate = createStartsWithExpression('slug', 'hello.world')
        const result = compileStartsWithPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          slug: { $regex: '^hello\\.world' },
        })
      })

      it('should escape multiple special characters', () => {
        const predicate = createStartsWithExpression('name', 'user+name[test]')
        const result = compileStartsWithPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          name: { $regex: '^user\\+name\\[test\\]' },
        })
      })

      it('should handle empty string', () => {
        const predicate = createStartsWithExpression('name', '')
        const result = compileStartsWithPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          name: { $regex: '^' },
        })
      })
    })

    describe('nested field startsWith', () => {
      it('should compile startsWith for nested field', () => {
        const predicate = createStartsWithExpression('user.profile.firstName', 'Dr.')
        const result = compileStartsWithPredicate<NestedDocument>(predicate)

        expect(result).toEqual({
          'user.profile.firstName': { $regex: '^Dr\\.' },
        })
      })
    })

    describe('error handling', () => {
      it('should throw error for non-function expression', () => {
        const predicate = createValue('invalid')

        expect(() => compileStartsWithPredicate(predicate as any)).toThrow(
          PredicateCompilationError
        )
      })

      it('should throw error when value is not a string', () => {
        const predicate = {
          type: 'func' as const,
          name: 'startsWith',
          args: [createRef('name'), createValue(123)],
        }

        expect(() => compileStartsWithPredicate(predicate)).toThrow(
          PredicateCompilationError
        )
      })
    })
  })

  // =============================================================================
  // endsWith Predicate Tests
  // =============================================================================

  describe('compileEndsWithPredicate', () => {
    describe('basic endsWith patterns', () => {
      it('should compile endsWith for simple string', () => {
        const predicate = createEndsWithExpression('email', '@gmail.com')
        const result = compileEndsWithPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          email: { $regex: '@gmail\\.com$' },
        })
      })

      it('should escape special regex characters in endsWith', () => {
        const predicate = createEndsWithExpression('slug', '.html')
        const result = compileEndsWithPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          slug: { $regex: '\\.html$' },
        })
      })

      it('should escape multiple special characters', () => {
        const predicate = createEndsWithExpression('name', '(v1.0)')
        const result = compileEndsWithPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          name: { $regex: '\\(v1\\.0\\)$' },
        })
      })

      it('should handle empty string', () => {
        const predicate = createEndsWithExpression('name', '')
        const result = compileEndsWithPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          name: { $regex: '$' },
        })
      })
    })

    describe('nested field endsWith', () => {
      it('should compile endsWith for nested field', () => {
        const predicate = createEndsWithExpression('user.contact.email', '@company.io')
        const result = compileEndsWithPredicate<NestedDocument>(predicate)

        expect(result).toEqual({
          'user.contact.email': { $regex: '@company\\.io$' },
        })
      })
    })

    describe('error handling', () => {
      it('should throw error for non-function expression', () => {
        const predicate = createRef('name')

        expect(() => compileEndsWithPredicate(predicate as any)).toThrow(
          PredicateCompilationError
        )
      })

      it('should throw error when value is not a string', () => {
        const predicate = {
          type: 'func' as const,
          name: 'endsWith',
          args: [createRef('email'), createValue(null)],
        }

        expect(() => compileEndsWithPredicate(predicate)).toThrow(
          PredicateCompilationError
        )
      })
    })
  })

  // =============================================================================
  // contains Predicate Tests
  // =============================================================================

  describe('compileContainsPredicate', () => {
    describe('basic contains patterns', () => {
      it('should compile contains for simple string', () => {
        const predicate = createContainsExpression('description', 'important')
        const result = compileContainsPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          description: { $regex: 'important' },
        })
      })

      it('should escape special regex characters in contains', () => {
        const predicate = createContainsExpression('name', 'c++')
        const result = compileContainsPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          name: { $regex: 'c\\+\\+' },
        })
      })

      it('should escape multiple special characters', () => {
        const predicate = createContainsExpression('description', '[TODO]')
        const result = compileContainsPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          description: { $regex: '\\[TODO\\]' },
        })
      })

      it('should handle empty string', () => {
        const predicate = createContainsExpression('name', '')
        const result = compileContainsPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          name: { $regex: '' },
        })
      })

      it('should handle string with spaces', () => {
        const predicate = createContainsExpression('description', 'hello world')
        const result = compileContainsPredicate<TestDocument>(predicate)

        expect(result).toEqual({
          description: { $regex: 'hello world' },
        })
      })
    })

    describe('nested field contains', () => {
      it('should compile contains for nested field', () => {
        const predicate = createContainsExpression('user.profile.bio', 'developer')
        const result = compileContainsPredicate<NestedDocument>(predicate)

        expect(result).toEqual({
          'user.profile.bio': { $regex: 'developer' },
        })
      })
    })

    describe('error handling', () => {
      it('should throw error for non-function expression', () => {
        const predicate = { type: 'val' as const, value: 'invalid' }

        expect(() => compileContainsPredicate(predicate as any)).toThrow(
          PredicateCompilationError
        )
      })

      it('should throw error when value is not a string', () => {
        const predicate = {
          type: 'func' as const,
          name: 'contains',
          args: [createRef('description'), createValue(['array'])],
        }

        expect(() => compileContainsPredicate(predicate)).toThrow(
          PredicateCompilationError
        )
      })
    })
  })

  // =============================================================================
  // Generic compilePredicate Integration Tests
  // =============================================================================

  describe('compilePredicate integration', () => {
    describe('dispatches to correct string compiler', () => {
      it('should dispatch regex to compileRegexPredicate', () => {
        const predicate = createRegexExpression('name', '^John')
        const result = compilePredicate<TestDocument>(predicate)

        expect(result).toEqual({
          name: { $regex: '^John' },
        })
      })

      it('should dispatch startsWith to compileStartsWithPredicate', () => {
        const predicate = createStartsWithExpression('name', 'Dr')
        const result = compilePredicate<TestDocument>(predicate)

        expect(result).toEqual({
          name: { $regex: '^Dr' },
        })
      })

      it('should dispatch endsWith to compileEndsWithPredicate', () => {
        const predicate = createEndsWithExpression('email', '@test.com')
        const result = compilePredicate<TestDocument>(predicate)

        expect(result).toEqual({
          email: { $regex: '@test\\.com$' },
        })
      })

      it('should dispatch contains to compileContainsPredicate', () => {
        const predicate = createContainsExpression('description', 'keyword')
        const result = compilePredicate<TestDocument>(predicate)

        expect(result).toEqual({
          description: { $regex: 'keyword' },
        })
      })
    })

    describe('string predicates with logical operators', () => {
      it('should work with AND logical operator', () => {
        const andPredicate = {
          type: 'func' as const,
          name: 'and',
          args: [
            createStartsWithExpression('name', 'John'),
            createEndsWithExpression('email', '@gmail.com'),
          ],
        }
        const result = compilePredicate<TestDocument>(andPredicate)

        expect(result).toEqual({
          $and: [
            { name: { $regex: '^John' } },
            { email: { $regex: '@gmail\\.com$' } },
          ],
        })
      })

      it('should work with OR logical operator', () => {
        const orPredicate = {
          type: 'func' as const,
          name: 'or',
          args: [
            createContainsExpression('name', 'admin'),
            createContainsExpression('email', 'admin'),
          ],
        }
        const result = compilePredicate<TestDocument>(orPredicate)

        expect(result).toEqual({
          $or: [
            { name: { $regex: 'admin' } },
            { email: { $regex: 'admin' } },
          ],
        })
      })

      it('should work with NOT logical operator', () => {
        const notPredicate = {
          type: 'func' as const,
          name: 'not',
          args: [createRegexExpression('name', '^test')],
        }
        const result = compilePredicate<TestDocument>(notPredicate)

        expect(result).toEqual({
          name: { $not: { $regex: '^test' } },
        })
      })

      it('should work with NOT on startsWith', () => {
        const notPredicate = {
          type: 'func' as const,
          name: 'not',
          args: [createStartsWithExpression('name', 'banned')],
        }
        const result = compilePredicate<TestDocument>(notPredicate)

        expect(result).toEqual({
          name: { $not: { $regex: '^banned' } },
        })
      })
    })

    describe('complex nested string predicates', () => {
      it('should compile complex nested string conditions', () => {
        const complexPredicate = {
          type: 'func' as const,
          name: 'and',
          args: [
            {
              type: 'func' as const,
              name: 'or',
              args: [
                createStartsWithExpression('name', 'Dr.'),
                createStartsWithExpression('name', 'Prof.'),
              ],
            },
            createEndsWithExpression('email', '@university.edu'),
            createContainsExpression('description', 'research'),
          ],
        }
        const result = compilePredicate<TestDocument>(complexPredicate)

        expect(result).toEqual({
          $and: [
            {
              $or: [
                { name: { $regex: '^Dr\\.' } },
                { name: { $regex: '^Prof\\.' } },
              ],
            },
            { email: { $regex: '@university\\.edu$' } },
            { description: { $regex: 'research' } },
          ],
        })
      })
    })
  })

  // =============================================================================
  // Type Safety Tests
  // =============================================================================

  describe('type safety', () => {
    it('should return MongoFilterQuery type for regex', () => {
      const predicate = createRegexExpression('name', 'test')
      const result = compileRegexPredicate<TestDocument>(predicate)

      expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
    })

    it('should return MongoFilterQuery type for startsWith', () => {
      const predicate = createStartsWithExpression('name', 'test')
      const result = compileStartsWithPredicate<TestDocument>(predicate)

      expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
    })

    it('should return MongoFilterQuery type for endsWith', () => {
      const predicate = createEndsWithExpression('email', '@test.com')
      const result = compileEndsWithPredicate<TestDocument>(predicate)

      expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
    })

    it('should return MongoFilterQuery type for contains', () => {
      const predicate = createContainsExpression('description', 'test')
      const result = compileContainsPredicate<TestDocument>(predicate)

      expectTypeOf(result).toMatchTypeOf<MongoFilterQuery<TestDocument>>()
    })
  })

  // =============================================================================
  // Edge Cases
  // =============================================================================

  describe('edge cases', () => {
    it('should handle unicode characters in patterns', () => {
      const predicate = createContainsExpression('name', '日本語')
      const result = compileContainsPredicate<TestDocument>(predicate)

      expect(result).toEqual({
        name: { $regex: '日本語' },
      })
    })

    it('should handle emoji in patterns', () => {
      const predicate = createContainsExpression('description', '👍')
      const result = compileContainsPredicate<TestDocument>(predicate)

      expect(result).toEqual({
        description: { $regex: '👍' },
      })
    })

    it('should handle very long patterns', () => {
      const longPattern = 'a'.repeat(1000)
      const predicate = createContainsExpression('description', longPattern)
      const result = compileContainsPredicate<TestDocument>(predicate)

      expect(result).toEqual({
        description: { $regex: longPattern },
      })
    })

    it('should handle patterns with newlines', () => {
      const predicate = createContainsExpression('description', 'line1\nline2')
      const result = compileContainsPredicate<TestDocument>(predicate)

      expect(result).toEqual({
        description: { $regex: 'line1\nline2' },
      })
    })

    it('should escape all special regex characters', () => {
      // All special regex chars: . * + ? ^ $ { } [ ] ( ) | \ /
      const predicate = createContainsExpression('description', '.*+?^${}[]()|\\/test')
      const result = compileContainsPredicate<TestDocument>(predicate)

      // Should escape all special characters
      expect(result).toEqual({
        description: { $regex: '\\.\\*\\+\\?\\^\\$\\{\\}\\[\\]\\(\\)\\|\\\\\\/test' },
      })
    })
  })

  // =============================================================================
  // Regex Options Tests
  // =============================================================================

  describe('regex options', () => {
    it('should support case-insensitive option (i)', () => {
      const predicate = createRegexExpression('name', 'john', 'i')
      const result = compileRegexPredicate<TestDocument>(predicate)

      expect(result).toEqual({
        name: { $regex: 'john', $options: 'i' },
      })
    })

    it('should support multiline option (m)', () => {
      const predicate = createRegexExpression('description', '^line', 'm')
      const result = compileRegexPredicate<TestDocument>(predicate)

      expect(result).toEqual({
        description: { $regex: '^line', $options: 'm' },
      })
    })

    it('should support extended option (x)', () => {
      const predicate = createRegexExpression('name', 'pattern # comment', 'x')
      const result = compileRegexPredicate<TestDocument>(predicate)

      expect(result).toEqual({
        name: { $regex: 'pattern # comment', $options: 'x' },
      })
    })

    it('should support dotall option (s)', () => {
      const predicate = createRegexExpression('description', 'start.*end', 's')
      const result = compileRegexPredicate<TestDocument>(predicate)

      expect(result).toEqual({
        description: { $regex: 'start.*end', $options: 's' },
      })
    })

    it('should support combined options (ims)', () => {
      const predicate = createRegexExpression('description', 'test', 'ims')
      const result = compileRegexPredicate<TestDocument>(predicate)

      expect(result).toEqual({
        description: { $regex: 'test', $options: 'ims' },
      })
    })
  })
})
