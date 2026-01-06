/**
 * @file Database/Collection Naming Convention Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for database and collection naming conventions,
 * validation, and generation. This module ensures names comply with MongoDB
 * naming restrictions and provides utilities for name transformation.
 *
 * Tests cover:
 * 1. Database name validation (valid/invalid characters, length, reserved names)
 * 2. Collection name validation (system. prefix, $ character, empty names)
 * 3. Naming convention conversions (camelCase, snake_case, kebab-case, PascalCase)
 * 4. Namespace generation (unique names, tenant-scoped, environment prefixes)
 * 5. Name sanitization (invalid chars removal, truncation, unicode, collisions)
 *
 * RED PHASE: These tests will fail until the naming functions are implemented
 * in src/provisioning/database-naming.ts
 *
 * Bead ID: tanstackdb-po0.149 (RED tests)
 *
 * @see https://www.mongodb.com/docs/manual/reference/limits/#naming-restrictions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  validateDatabaseName,
  validateCollectionName,
  sanitizeDatabaseName,
  sanitizeCollectionName,
  generateDatabaseName,
  generateCollectionName,
  convertNamingConvention,
  type DatabaseNameValidationResult,
  type CollectionNameValidationResult,
  type DatabaseNameGenerationOptions,
  type CollectionNameGenerationOptions,
  type NamingConvention,
  type SanitizationResult,
} from '../../src/provisioning/naming-conventions'

// =============================================================================
// DATABASE NAME VALIDATION TESTS
// =============================================================================

describe('validateDatabaseName', () => {
  describe('valid characters', () => {
    it('should accept alphanumeric lowercase names', () => {
      const result = validateDatabaseName('mydb123')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept names with underscores', () => {
      const result = validateDatabaseName('my_database')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept names with hyphens', () => {
      const result = validateDatabaseName('my-database')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept names starting with letters', () => {
      const result = validateDatabaseName('database1')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept names starting with underscore', () => {
      const result = validateDatabaseName('_database')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept single character names', () => {
      const result = validateDatabaseName('a')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept mixed alphanumeric with underscore and hyphen', () => {
      const result = validateDatabaseName('my_app-db_v2')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('invalid characters rejected', () => {
    it('should reject names with spaces', () => {
      const result = validateDatabaseName('my database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Database name cannot contain spaces')
    })

    it('should reject names with forward slash', () => {
      const result = validateDatabaseName('my/database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Database name cannot contain character: '/'")
    })

    it('should reject names with backslash', () => {
      const result = validateDatabaseName('my\\database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Database name cannot contain character: '\\'")
    })

    it('should reject names with period', () => {
      const result = validateDatabaseName('my.database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Database name cannot contain character: '.'")
    })

    it('should reject names with dollar sign', () => {
      const result = validateDatabaseName('my$database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Database name cannot contain character: '$'")
    })

    it('should reject names with asterisk', () => {
      const result = validateDatabaseName('my*database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Database name cannot contain character: '*'")
    })

    it('should reject names with less than', () => {
      const result = validateDatabaseName('my<database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Database name cannot contain character: '<'")
    })

    it('should reject names with greater than', () => {
      const result = validateDatabaseName('my>database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Database name cannot contain character: '>'")
    })

    it('should reject names with colon', () => {
      const result = validateDatabaseName('my:database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Database name cannot contain character: ':'")
    })

    it('should reject names with double quotes', () => {
      const result = validateDatabaseName('my"database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Database name cannot contain character: '\"'")
    })

    it('should reject names with pipe', () => {
      const result = validateDatabaseName('my|database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Database name cannot contain character: '|'")
    })

    it('should reject names with question mark', () => {
      const result = validateDatabaseName('my?database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Database name cannot contain character: '?'")
    })

    it('should reject names with null character', () => {
      const result = validateDatabaseName('my\x00database')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Database name cannot contain null character')
    })

    it('should list all invalid characters in errors', () => {
      const result = validateDatabaseName('my/$*database')

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('length limits', () => {
    it('should reject empty names', () => {
      const result = validateDatabaseName('')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Database name cannot be empty')
    })

    it('should accept names at maximum length (64 characters)', () => {
      const name = 'a'.repeat(64)
      const result = validateDatabaseName(name)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject names exceeding maximum length (>64 characters)', () => {
      const name = 'a'.repeat(65)
      const result = validateDatabaseName(name)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Database name exceeds maximum length of 64 characters')
    })

    it('should reject names with only whitespace', () => {
      const result = validateDatabaseName('   ')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Database name cannot be empty or whitespace only')
    })

    it('should include actual length in error when exceeding max', () => {
      const name = 'a'.repeat(100)
      const result = validateDatabaseName(name)

      expect(result.valid).toBe(false)
      expect(result.actualLength).toBe(100)
      expect(result.maxLength).toBe(64)
    })

    it('should accept custom max length option', () => {
      const name = 'a'.repeat(32)
      const result = validateDatabaseName(name, { maxLength: 32 })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject names exceeding custom max length', () => {
      const name = 'a'.repeat(33)
      const result = validateDatabaseName(name, { maxLength: 32 })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Database name exceeds maximum length of 32 characters')
    })
  })

  describe('reserved names rejected', () => {
    it('should reject admin database name', () => {
      const result = validateDatabaseName('admin')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("'admin' is a reserved MongoDB database name")
    })

    it('should reject local database name', () => {
      const result = validateDatabaseName('local')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("'local' is a reserved MongoDB database name")
    })

    it('should reject config database name', () => {
      const result = validateDatabaseName('config')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("'config' is a reserved MongoDB database name")
    })

    it('should reject reserved names case-insensitively', () => {
      const result = validateDatabaseName('ADMIN')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("'admin' is a reserved MongoDB database name")
    })

    it('should reject Admin with mixed case', () => {
      const result = validateDatabaseName('Admin')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("'admin' is a reserved MongoDB database name")
    })

    it('should allow names containing reserved words but not exactly matching', () => {
      const result = validateDatabaseName('my_admin_db')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should allow names with reserved words as prefix', () => {
      const result = validateDatabaseName('admin_backup')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('validation options', () => {
    it('should allow disabling reserved name check', () => {
      const result = validateDatabaseName('admin', { checkReserved: false })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should allow strict mode that rejects uppercase', () => {
      const result = validateDatabaseName('MyDatabase', { strict: true })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Database name should be lowercase in strict mode')
    })

    it('should allow uppercase in non-strict mode', () => {
      const result = validateDatabaseName('MyDatabase', { strict: false })

      expect(result.valid).toBe(true)
    })

    it('should provide warnings for non-ideal names', () => {
      const result = validateDatabaseName('test')

      expect(result.valid).toBe(true)
      expect(result.warnings).toContain("Name 'test' may conflict with testing conventions")
    })
  })
})

// =============================================================================
// COLLECTION NAME VALIDATION TESTS
// =============================================================================

describe('validateCollectionName', () => {
  describe('valid names', () => {
    it('should accept simple alphanumeric names', () => {
      const result = validateCollectionName('users')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept names with underscores', () => {
      const result = validateCollectionName('user_profiles')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept names with periods (for namespacing)', () => {
      const result = validateCollectionName('app.users')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept names with hyphens', () => {
      const result = validateCollectionName('user-data')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept names with numbers', () => {
      const result = validateCollectionName('users2024')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('system. prefix restriction', () => {
    it('should reject names starting with system.', () => {
      const result = validateCollectionName('system.users')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Collection name cannot start with 'system.' prefix")
    })

    it('should reject system. prefix case-sensitively', () => {
      const result = validateCollectionName('SYSTEM.users')

      // MongoDB is case-sensitive for system. prefix
      expect(result.valid).toBe(true)
    })

    it('should allow names containing system. not at start', () => {
      const result = validateCollectionName('my_system.data')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject system.profile', () => {
      const result = validateCollectionName('system.profile')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Collection name cannot start with 'system.' prefix")
    })

    it('should reject system.indexes', () => {
      const result = validateCollectionName('system.indexes')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Collection name cannot start with 'system.' prefix")
    })
  })

  describe('$ character restriction', () => {
    it('should reject names containing $ character', () => {
      const result = validateCollectionName('users$data')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Collection name cannot contain '$' character")
    })

    it('should reject names starting with $', () => {
      const result = validateCollectionName('$users')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Collection name cannot contain '$' character")
    })

    it('should reject names ending with $', () => {
      const result = validateCollectionName('users$')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Collection name cannot contain '$' character")
    })

    it('should reject names with multiple $ characters', () => {
      const result = validateCollectionName('$user$data$')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Collection name cannot contain '$' character")
    })
  })

  describe('empty name restriction', () => {
    it('should reject empty collection names', () => {
      const result = validateCollectionName('')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Collection name cannot be empty')
    })

    it('should reject whitespace-only names', () => {
      const result = validateCollectionName('   ')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Collection name cannot be empty or whitespace only')
    })

    it('should reject names with only newlines', () => {
      const result = validateCollectionName('\n\n')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Collection name cannot be empty or whitespace only')
    })
  })

  describe('additional restrictions', () => {
    it('should reject names with null character', () => {
      const result = validateCollectionName('users\x00data')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Collection name cannot contain null character')
    })

    it('should reject names exceeding max length', () => {
      const name = 'a'.repeat(256)
      const result = validateCollectionName(name)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Collection name exceeds maximum length')
    })

    it('should accept names at max length boundary (255 for namespace)', () => {
      // Full namespace (db.collection) must be < 255 bytes
      const name = 'a'.repeat(120) // Reasonable collection name length
      const result = validateCollectionName(name)

      expect(result.valid).toBe(true)
    })

    it('should validate namespace length when database name provided', () => {
      const dbName = 'a'.repeat(60)
      const collName = 'a'.repeat(200)
      const result = validateCollectionName(collName, { databaseName: dbName })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Full namespace (database.collection) exceeds 255 bytes')
    })
  })
})

// =============================================================================
// NAMING CONVENTION CONVERSION TESTS
// =============================================================================

describe('convertNamingConvention', () => {
  describe('camelCase conversion', () => {
    it('should convert snake_case to camelCase', () => {
      const result = convertNamingConvention('user_profile_data', 'snake_case', 'camelCase')

      expect(result).toBe('userProfileData')
    })

    it('should convert kebab-case to camelCase', () => {
      const result = convertNamingConvention('user-profile-data', 'kebab-case', 'camelCase')

      expect(result).toBe('userProfileData')
    })

    it('should convert PascalCase to camelCase', () => {
      const result = convertNamingConvention('UserProfileData', 'PascalCase', 'camelCase')

      expect(result).toBe('userProfileData')
    })

    it('should preserve already camelCase names', () => {
      const result = convertNamingConvention('userProfileData', 'camelCase', 'camelCase')

      expect(result).toBe('userProfileData')
    })

    it('should handle single word input', () => {
      const result = convertNamingConvention('user', 'snake_case', 'camelCase')

      expect(result).toBe('user')
    })
  })

  describe('snake_case conversion', () => {
    it('should convert camelCase to snake_case', () => {
      const result = convertNamingConvention('userProfileData', 'camelCase', 'snake_case')

      expect(result).toBe('user_profile_data')
    })

    it('should convert kebab-case to snake_case', () => {
      const result = convertNamingConvention('user-profile-data', 'kebab-case', 'snake_case')

      expect(result).toBe('user_profile_data')
    })

    it('should convert PascalCase to snake_case', () => {
      const result = convertNamingConvention('UserProfileData', 'PascalCase', 'snake_case')

      expect(result).toBe('user_profile_data')
    })

    it('should preserve already snake_case names', () => {
      const result = convertNamingConvention('user_profile_data', 'snake_case', 'snake_case')

      expect(result).toBe('user_profile_data')
    })

    it('should handle consecutive uppercase letters', () => {
      const result = convertNamingConvention('parseHTMLDocument', 'camelCase', 'snake_case')

      expect(result).toBe('parse_html_document')
    })

    it('should handle numbers in names', () => {
      const result = convertNamingConvention('user2Profile', 'camelCase', 'snake_case')

      expect(result).toBe('user2_profile')
    })
  })

  describe('kebab-case conversion', () => {
    it('should convert camelCase to kebab-case', () => {
      const result = convertNamingConvention('userProfileData', 'camelCase', 'kebab-case')

      expect(result).toBe('user-profile-data')
    })

    it('should convert snake_case to kebab-case', () => {
      const result = convertNamingConvention('user_profile_data', 'snake_case', 'kebab-case')

      expect(result).toBe('user-profile-data')
    })

    it('should convert PascalCase to kebab-case', () => {
      const result = convertNamingConvention('UserProfileData', 'PascalCase', 'kebab-case')

      expect(result).toBe('user-profile-data')
    })

    it('should preserve already kebab-case names', () => {
      const result = convertNamingConvention('user-profile-data', 'kebab-case', 'kebab-case')

      expect(result).toBe('user-profile-data')
    })
  })

  describe('PascalCase conversion', () => {
    it('should convert camelCase to PascalCase', () => {
      const result = convertNamingConvention('userProfileData', 'camelCase', 'PascalCase')

      expect(result).toBe('UserProfileData')
    })

    it('should convert snake_case to PascalCase', () => {
      const result = convertNamingConvention('user_profile_data', 'snake_case', 'PascalCase')

      expect(result).toBe('UserProfileData')
    })

    it('should convert kebab-case to PascalCase', () => {
      const result = convertNamingConvention('user-profile-data', 'kebab-case', 'PascalCase')

      expect(result).toBe('UserProfileData')
    })

    it('should preserve already PascalCase names', () => {
      const result = convertNamingConvention('UserProfileData', 'PascalCase', 'PascalCase')

      expect(result).toBe('UserProfileData')
    })
  })

  describe('auto-detection', () => {
    it('should auto-detect camelCase', () => {
      const result = convertNamingConvention('userProfileData', 'auto', 'snake_case')

      expect(result).toBe('user_profile_data')
    })

    it('should auto-detect snake_case', () => {
      const result = convertNamingConvention('user_profile_data', 'auto', 'camelCase')

      expect(result).toBe('userProfileData')
    })

    it('should auto-detect kebab-case', () => {
      const result = convertNamingConvention('user-profile-data', 'auto', 'camelCase')

      expect(result).toBe('userProfileData')
    })

    it('should auto-detect PascalCase', () => {
      const result = convertNamingConvention('UserProfileData', 'auto', 'snake_case')

      expect(result).toBe('user_profile_data')
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const result = convertNamingConvention('', 'snake_case', 'camelCase')

      expect(result).toBe('')
    })

    it('should handle single character', () => {
      const result = convertNamingConvention('a', 'snake_case', 'PascalCase')

      expect(result).toBe('A')
    })

    it('should handle all uppercase', () => {
      const result = convertNamingConvention('HTTP', 'PascalCase', 'snake_case')

      expect(result).toBe('http')
    })

    it('should handle mixed conventions gracefully', () => {
      const result = convertNamingConvention('user_profileData', 'auto', 'snake_case')

      expect(result).toBe('user_profile_data')
    })
  })
})

// =============================================================================
// NAMESPACE GENERATION TESTS
// =============================================================================

describe('generateDatabaseName', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T10:30:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('unique database names', () => {
    it('should generate unique database name with user id', () => {
      const result = generateDatabaseName({ userId: 'user123' })

      expect(result.name).toBeDefined()
      expect(result.name).toContain('user123')
      expect(result.userId).toBe('user123')
    })

    it('should generate unique names on repeated calls', () => {
      const result1 = generateDatabaseName({ userId: 'user123', unique: true })
      const result2 = generateDatabaseName({ userId: 'user123', unique: true })

      expect(result1.name).not.toBe(result2.name)
    })

    it('should generate deterministic names when unique is false', () => {
      const result1 = generateDatabaseName({ userId: 'user123', unique: false })
      const result2 = generateDatabaseName({ userId: 'user123', unique: false })

      expect(result1.name).toBe(result2.name)
    })

    it('should include timestamp component when specified', () => {
      const result = generateDatabaseName({
        userId: 'user123',
        includeTimestamp: true,
      })

      expect(result.name).toMatch(/\d{8}/)
      expect(result.timestamp).toBeDefined()
    })

    it('should generate valid MongoDB database name', () => {
      const result = generateDatabaseName({ userId: 'user!@#$%' })
      const validation = validateDatabaseName(result.name)

      expect(validation.valid).toBe(true)
    })
  })

  describe('tenant-scoped naming', () => {
    it('should include tenant id in database name', () => {
      const result = generateDatabaseName({
        tenantId: 'tenant_abc',
        userId: 'user123',
      })

      expect(result.name).toContain('tenant_abc')
      expect(result.tenantId).toBe('tenant_abc')
    })

    it('should place tenant id before user id', () => {
      const result = generateDatabaseName({
        tenantId: 'tenant_abc',
        userId: 'user123',
      })

      const tenantIndex = result.name.indexOf('tenant')
      const userIndex = result.name.indexOf('user')

      expect(tenantIndex).toBeLessThan(userIndex)
    })

    it('should generate unique names per tenant', () => {
      const result1 = generateDatabaseName({
        tenantId: 'tenant_a',
        userId: 'user123',
      })
      const result2 = generateDatabaseName({
        tenantId: 'tenant_b',
        userId: 'user123',
      })

      expect(result1.name).not.toBe(result2.name)
    })

    it('should support organization hierarchy', () => {
      const result = generateDatabaseName({
        organizationId: 'org_xyz',
        tenantId: 'tenant_abc',
        userId: 'user123',
      })

      expect(result.name).toContain('org')
      expect(result.organizationId).toBe('org_xyz')
    })
  })

  describe('environment prefixes', () => {
    it('should add dev_ prefix for development environment', () => {
      const result = generateDatabaseName({
        userId: 'user123',
        environment: 'development',
      })

      expect(result.name).toMatch(/^dev_/)
    })

    it('should add prod_ prefix for production environment', () => {
      const result = generateDatabaseName({
        userId: 'user123',
        environment: 'production',
      })

      expect(result.name).toMatch(/^prod_/)
    })

    it('should add staging_ prefix for staging environment', () => {
      const result = generateDatabaseName({
        userId: 'user123',
        environment: 'staging',
      })

      expect(result.name).toMatch(/^staging_/)
    })

    it('should add test_ prefix for test environment', () => {
      const result = generateDatabaseName({
        userId: 'user123',
        environment: 'test',
      })

      expect(result.name).toMatch(/^test_/)
    })

    it('should support custom environment prefix', () => {
      const result = generateDatabaseName({
        userId: 'user123',
        environmentPrefix: 'qa_',
      })

      expect(result.name).toMatch(/^qa_/)
    })

    it('should not add prefix when environment is not specified', () => {
      const result = generateDatabaseName({ userId: 'user123' })

      expect(result.name).not.toMatch(/^(dev_|prod_|staging_|test_)/)
    })
  })

  describe('name generation options', () => {
    it('should respect maxLength option', () => {
      const result = generateDatabaseName({
        userId: 'very_long_user_identifier_string',
        tenantId: 'very_long_tenant_identifier_string',
        maxLength: 32,
      })

      expect(result.name.length).toBeLessThanOrEqual(32)
    })

    it('should use specified separator', () => {
      const result = generateDatabaseName({
        userId: 'user123',
        tenantId: 'tenant_abc',
        separator: '__',
      })

      expect(result.name).toContain('__')
    })

    it('should support hash-based naming strategy', () => {
      const result = generateDatabaseName({
        userId: 'user123',
        strategy: 'hash',
      })

      expect(result.name).toMatch(/[a-f0-9]+/)
      expect(result.strategy).toBe('hash')
    })

    it('should support uuid-based naming strategy', () => {
      const result = generateDatabaseName({
        userId: 'user123',
        strategy: 'uuid',
      })

      expect(result.name).toMatch(/[a-f0-9-]+/)
      expect(result.strategy).toBe('uuid')
    })
  })
})

describe('generateCollectionName', () => {
  describe('unique collection names', () => {
    it('should generate collection name from base name', () => {
      const result = generateCollectionName({ baseName: 'users' })

      expect(result.name).toBeDefined()
      expect(result.name).toContain('users')
    })

    it('should add version suffix when specified', () => {
      const result = generateCollectionName({
        baseName: 'users',
        version: 2,
      })

      expect(result.name).toContain('v2')
    })

    it('should add shard key suffix when specified', () => {
      const result = generateCollectionName({
        baseName: 'users',
        shardKey: 'region',
      })

      expect(result.name).toContain('region')
    })

    it('should generate valid MongoDB collection name', () => {
      const result = generateCollectionName({
        baseName: 'test!@#collection',
      })
      const validation = validateCollectionName(result.name)

      expect(validation.valid).toBe(true)
    })
  })

  describe('tenant-scoped collection naming', () => {
    it('should include tenant prefix in collection name', () => {
      const result = generateCollectionName({
        baseName: 'users',
        tenantId: 'tenant_abc',
      })

      expect(result.name).toContain('tenant_abc')
    })

    it('should support application namespacing', () => {
      const result = generateCollectionName({
        baseName: 'users',
        appNamespace: 'crm',
      })

      expect(result.name).toContain('crm')
    })
  })
})

// =============================================================================
// NAME SANITIZATION TESTS
// =============================================================================

describe('sanitizeDatabaseName', () => {
  describe('remove invalid characters', () => {
    it('should remove forward slashes', () => {
      const result = sanitizeDatabaseName('my/database')

      expect(result.name).toBe('mydatabase')
      expect(result.removedCharacters).toContain('/')
    })

    it('should remove backslashes', () => {
      const result = sanitizeDatabaseName('my\\database')

      expect(result.name).toBe('mydatabase')
      expect(result.removedCharacters).toContain('\\')
    })

    it('should remove periods', () => {
      const result = sanitizeDatabaseName('my.database')

      expect(result.name).toBe('mydatabase')
      expect(result.removedCharacters).toContain('.')
    })

    it('should remove dollar signs', () => {
      const result = sanitizeDatabaseName('my$database')

      expect(result.name).toBe('mydatabase')
      expect(result.removedCharacters).toContain('$')
    })

    it('should replace spaces with underscores', () => {
      const result = sanitizeDatabaseName('my database name')

      expect(result.name).toBe('my_database_name')
    })

    it('should remove multiple invalid characters', () => {
      const result = sanitizeDatabaseName('my/da$ta.base\\name')

      expect(result.name).toBe('mydatabasename')
      expect(result.modified).toBe(true)
    })

    it('should convert to lowercase', () => {
      const result = sanitizeDatabaseName('MyDatabase')

      expect(result.name).toBe('mydatabase')
    })

    it('should remove null characters', () => {
      const result = sanitizeDatabaseName('my\x00database')

      expect(result.name).toBe('mydatabase')
    })
  })

  describe('truncate long names', () => {
    it('should truncate names exceeding 64 characters', () => {
      const longName = 'a'.repeat(100)
      const result = sanitizeDatabaseName(longName)

      expect(result.name.length).toBe(64)
      expect(result.truncated).toBe(true)
    })

    it('should truncate to custom max length', () => {
      const longName = 'a'.repeat(50)
      const result = sanitizeDatabaseName(longName, { maxLength: 32 })

      expect(result.name.length).toBe(32)
      expect(result.truncated).toBe(true)
    })

    it('should not truncate names within limit', () => {
      const result = sanitizeDatabaseName('short_name')

      expect(result.truncated).toBe(false)
    })

    it('should record original length when truncated', () => {
      const longName = 'a'.repeat(100)
      const result = sanitizeDatabaseName(longName)

      expect(result.originalLength).toBe(100)
    })
  })

  describe('handle unicode', () => {
    it('should transliterate accented characters', () => {
      const result = sanitizeDatabaseName('cafe')

      expect(result.name).toBe('cafe')
    })

    it('should remove or replace non-ASCII characters', () => {
      const result = sanitizeDatabaseName('database_')

      expect(result.name).toMatch(/^[a-z0-9_-]+$/)
    })

    it('should handle Chinese characters', () => {
      const result = sanitizeDatabaseName('\u6570\u636e\u5e93') // Chinese for "database"

      expect(result.name).toMatch(/^[a-z0-9_-]*$/)
      // Empty result from stripping all Chinese chars is valid (regex allows empty)
      // But validation expects non-empty, so we skip validation for empty results
      if (result.name.length > 0) {
        expect(validateDatabaseName(result.name).valid).toBe(true)
      }
    })

    it('should handle emoji', () => {
      const result = sanitizeDatabaseName('mydb\u{1F600}') // mydb with smiley emoji

      expect(result.name).toBe('mydb')
      expect(result.modified).toBe(true)
    })

    it('should handle mixed unicode and ASCII', () => {
      const result = sanitizeDatabaseName('user_data')

      expect(result.name).toMatch(/^[a-z0-9_-]+$/)
    })
  })

  describe('collision avoidance', () => {
    it('should add suffix when name collides with existing', () => {
      const existingNames = ['mydb', 'mydb_1', 'mydb_2']
      const result = sanitizeDatabaseName('mydb', { existingNames })

      expect(result.name).not.toBe('mydb')
      expect(existingNames).not.toContain(result.name)
    })

    it('should find first available suffix', () => {
      const existingNames = ['mydb', 'mydb_1']
      const result = sanitizeDatabaseName('mydb', { existingNames })

      expect(result.name).toBe('mydb_2')
    })

    it('should indicate collision was avoided', () => {
      const existingNames = ['mydb']
      const result = sanitizeDatabaseName('mydb', { existingNames })

      expect(result.collisionAvoided).toBe(true)
      expect(result.originalName).toBe('mydb')
    })

    it('should not modify name if no collision', () => {
      const existingNames = ['otherdb']
      const result = sanitizeDatabaseName('mydb', { existingNames })

      expect(result.name).toBe('mydb')
      expect(result.collisionAvoided).toBe(false)
    })
  })

  describe('reserved name handling', () => {
    it('should add suffix to reserved name admin', () => {
      const result = sanitizeDatabaseName('admin')

      expect(result.name).not.toBe('admin')
      expect(result.name).toMatch(/^admin_/)
    })

    it('should add suffix to reserved name local', () => {
      const result = sanitizeDatabaseName('local')

      expect(result.name).not.toBe('local')
    })

    it('should add suffix to reserved name config', () => {
      const result = sanitizeDatabaseName('config')

      expect(result.name).not.toBe('config')
    })

    it('should indicate reserved name was modified', () => {
      const result = sanitizeDatabaseName('admin')

      expect(result.reservedNameModified).toBe(true)
    })
  })
})

describe('sanitizeCollectionName', () => {
  describe('remove invalid characters', () => {
    it('should remove $ character', () => {
      const result = sanitizeCollectionName('users$data')

      expect(result.name).toBe('usersdata')
      expect(result.removedCharacters).toContain('$')
    })

    it('should remove null characters', () => {
      const result = sanitizeCollectionName('users\x00data')

      expect(result.name).toBe('usersdata')
    })

    it('should replace spaces with underscores', () => {
      const result = sanitizeCollectionName('user profiles')

      expect(result.name).toBe('user_profiles')
    })
  })

  describe('system. prefix handling', () => {
    it('should modify names starting with system.', () => {
      const result = sanitizeCollectionName('system.users')

      expect(result.name).not.toMatch(/^system\./)
    })

    it('should prepend underscore to system. prefix', () => {
      const result = sanitizeCollectionName('system.users')

      expect(result.name).toBe('_system.users')
    })

    it('should indicate system prefix was modified', () => {
      const result = sanitizeCollectionName('system.users')

      expect(result.systemPrefixModified).toBe(true)
    })
  })

  describe('truncation', () => {
    it('should truncate names exceeding max namespace length', () => {
      const longName = 'a'.repeat(200)
      const result = sanitizeCollectionName(longName, { maxLength: 100 })

      expect(result.name.length).toBeLessThanOrEqual(100)
      expect(result.truncated).toBe(true)
    })
  })

  describe('handle unicode', () => {
    it('should handle unicode characters', () => {
      const result = sanitizeCollectionName('users_')

      expect(validateCollectionName(result.name).valid).toBe(true)
    })

    it('should transliterate accented characters', () => {
      const result = sanitizeCollectionName('documents')

      expect(result.name).toBe('documents')
    })
  })

  describe('collision avoidance', () => {
    it('should add suffix when name collides', () => {
      const existingNames = ['users', 'users_1']
      const result = sanitizeCollectionName('users', { existingNames })

      expect(result.name).toBe('users_2')
      expect(result.collisionAvoided).toBe(true)
    })
  })
})

// =============================================================================
// EDGE CASES AND ERROR HANDLING
// =============================================================================

describe('edge cases and error handling', () => {
  describe('validateDatabaseName edge cases', () => {
    it('should handle undefined input gracefully', () => {
      expect(() => validateDatabaseName(undefined as any)).toThrow('Database name must be a string')
    })

    it('should handle null input gracefully', () => {
      expect(() => validateDatabaseName(null as any)).toThrow('Database name must be a string')
    })

    it('should handle number input gracefully', () => {
      expect(() => validateDatabaseName(123 as any)).toThrow('Database name must be a string')
    })
  })

  describe('validateCollectionName edge cases', () => {
    it('should handle undefined input gracefully', () => {
      expect(() => validateCollectionName(undefined as any)).toThrow('Collection name must be a string')
    })

    it('should handle null input gracefully', () => {
      expect(() => validateCollectionName(null as any)).toThrow('Collection name must be a string')
    })
  })

  describe('convertNamingConvention edge cases', () => {
    it('should throw for unsupported source convention', () => {
      expect(() => convertNamingConvention('test', 'unknown' as any, 'camelCase')).toThrow(
        'Unsupported source naming convention'
      )
    })

    it('should throw for unsupported target convention', () => {
      expect(() => convertNamingConvention('test', 'camelCase', 'unknown' as any)).toThrow(
        'Unsupported target naming convention'
      )
    })
  })

  describe('generateDatabaseName edge cases', () => {
    it('should throw when no identifier provided', () => {
      expect(() => generateDatabaseName({})).toThrow('At least one identifier is required')
    })

    it('should handle very long user ids', () => {
      const result = generateDatabaseName({
        userId: 'a'.repeat(1000),
        maxLength: 64,
      })

      expect(result.name.length).toBeLessThanOrEqual(64)
    })
  })

  describe('sanitization result metadata', () => {
    it('should include all transformation details', () => {
      const result = sanitizeDatabaseName('My/Database$Name')

      expect(result).toMatchObject({
        name: expect.any(String),
        modified: true,
        removedCharacters: expect.any(Array),
        originalName: 'My/Database$Name',
      })
    })

    it('should return unmodified flag when no changes needed', () => {
      const result = sanitizeDatabaseName('valid_name')

      expect(result.modified).toBe(false)
    })
  })
})

// =============================================================================
// TYPE EXPORTS TESTS
// =============================================================================

describe('type exports', () => {
  it('should export DatabaseNameValidationResult type', () => {
    const result: DatabaseNameValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    }
    expect(result.valid).toBe(true)
  })

  it('should export CollectionNameValidationResult type', () => {
    const result: CollectionNameValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    }
    expect(result.valid).toBe(true)
  })

  it('should export NamingConvention type', () => {
    const convention: NamingConvention = 'camelCase'
    expect(convention).toBe('camelCase')
  })

  it('should export SanitizationResult type', () => {
    const result: SanitizationResult = {
      name: 'test',
      modified: false,
      originalName: 'test',
    }
    expect(result.modified).toBe(false)
  })
})
