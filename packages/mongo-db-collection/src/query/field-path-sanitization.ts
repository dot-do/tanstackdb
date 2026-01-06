/**
 * @file Field Path Sanitization
 *
 * This module provides field path validation and sanitization to prevent
 * security vulnerabilities in MongoDB queries.
 *
 * Security concerns addressed:
 * - Paths starting with $ (e.g., $where) could invoke MongoDB operators
 * - Paths containing __proto__ could cause prototype pollution
 * - Paths containing constructor could cause prototype pollution
 * - Paths with null bytes or control characters could cause injection attacks
 * - Empty path segments (double dots, leading/trailing dots)
 *
 * @see https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/05.6-Testing_for_NoSQL_Injection
 *
 * @module @tanstack/mongo-db-collection/query/field-path-sanitization
 */

// =============================================================================
// Error Class
// =============================================================================

/**
 * Error thrown when field path validation fails.
 */
export class FieldPathValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FieldPathValidationError'
  }
}

// =============================================================================
// Constants for Validation
// =============================================================================

/**
 * Regex pattern for control characters (ASCII 0-31, including null byte, tab, newline, etc.)
 */
const CONTROL_CHARS_REGEX = /[\x00-\x1F]/

/**
 * List of dangerous prototype pollution property names (case-insensitive)
 */
const DANGEROUS_PROPERTIES = ['__proto__', 'constructor', 'prototype']

// =============================================================================
// Field Path Validation Functions
// =============================================================================

/**
 * Validates a single path segment for security issues.
 *
 * @param segment - The path segment to validate
 * @param fullPath - The full path (for error messages)
 * @throws FieldPathValidationError if the segment is invalid
 */
function validateSegment(segment: string, fullPath: string): void {
  // Check for empty segment
  if (segment === '') {
    throw new FieldPathValidationError(
      `Invalid field path '${fullPath}': empty path segment`
    )
  }

  // Check for $ prefix (MongoDB operator injection)
  if (segment.startsWith('$')) {
    throw new FieldPathValidationError(
      `Invalid field path '${fullPath}': path segment '${segment}' starts with '$' which could be interpreted as a MongoDB operator`
    )
  }

  // Check for control characters (including null byte)
  if (CONTROL_CHARS_REGEX.test(segment)) {
    throw new FieldPathValidationError(
      `Invalid field path '${fullPath}': contains control characters`
    )
  }

  // Check for prototype pollution properties (case-insensitive)
  const lowerSegment = segment.toLowerCase()
  for (const dangerous of DANGEROUS_PROPERTIES) {
    if (lowerSegment === dangerous.toLowerCase()) {
      throw new FieldPathValidationError(
        `Invalid field path '${fullPath}': path segment '${segment}' is a dangerous property name`
      )
    }
  }
}

/**
 * Validates a field path for security issues.
 *
 * This function checks the entire path for:
 * - Empty paths
 * - Segments starting with $ (MongoDB operator injection)
 * - Prototype pollution properties (__proto__, constructor, prototype)
 * - Control characters (null bytes, tabs, newlines, etc.)
 * - Empty segments (double dots)
 *
 * @param path - The field path as an array of segments
 * @throws FieldPathValidationError if the path is invalid
 *
 * @example
 * ```typescript
 * // Valid paths
 * validateFieldPath(['user', 'profile', 'name']) // OK
 * validateFieldPath(['_id']) // OK
 * validateFieldPath(['items', '0', 'name']) // OK
 *
 * // Invalid paths - will throw
 * validateFieldPath(['$where']) // Throws - MongoDB operator
 * validateFieldPath(['user', '__proto__']) // Throws - prototype pollution
 * validateFieldPath(['field\x00']) // Throws - null byte
 * validateFieldPath(['user', '', 'name']) // Throws - empty segment
 * ```
 */
export function validateFieldPath(path: string[]): void {
  // Check for empty path array
  if (path.length === 0) {
    throw new FieldPathValidationError(
      `Invalid field path: path is empty`
    )
  }

  // Check if the full path has control characters (when joined)
  const fullPath = path.join('.')

  // Check for empty full path
  if (fullPath === '') {
    throw new FieldPathValidationError(
      `Invalid field path: path is empty`
    )
  }

  // Validate each segment
  for (const segment of path) {
    validateSegment(segment, fullPath)
  }
}

/**
 * Sanitizes a field path by validating it and returning the dot-notation string.
 *
 * This is the main entry point for field path sanitization. It validates
 * the path for security issues and returns the sanitized dot-notation string.
 *
 * @param path - The field path as an array of segments
 * @returns The field path as a dot-notation string
 * @throws FieldPathValidationError if the path is invalid
 *
 * @example
 * ```typescript
 * // Valid paths
 * sanitizeFieldPath(['user', 'profile', 'name']) // Returns: 'user.profile.name'
 * sanitizeFieldPath(['_id']) // Returns: '_id'
 *
 * // Invalid paths - will throw
 * sanitizeFieldPath(['$where']) // Throws FieldPathValidationError
 * sanitizeFieldPath(['user', '__proto__']) // Throws FieldPathValidationError
 * ```
 */
export function sanitizeFieldPath(path: string[]): string {
  validateFieldPath(path)
  return path.join('.')
}
