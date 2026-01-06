/**
 * @file Schema Validation Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the schema validation module that validates
 * documents against a schema before writing to MongoDB.
 *
 * The schema validator is part of Layer 12 User Provisioning and ensures
 * data integrity by validating documents before they are persisted.
 *
 * Tests cover:
 * 1. Schema definition and creation
 * 2. Type validation (string, number, boolean, object, array)
 * 3. Required field validation
 * 4. Nested object validation
 * 5. Array item validation
 * 6. Custom validators
 * 7. Multiple validation errors collection
 * 8. Schema validation result types
 * 9. Integration with mutation handlers
 *
 * RED PHASE: These tests will fail until SchemaValidator is implemented
 * in src/provisioning/schema-validation.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSchemaValidator,
  validateDocument,
  SchemaValidationError,
  type Schema,
  type SchemaField,
  type ValidationResult,
  type SchemaValidatorConfig,
} from '../../src/provisioning/schema-validation'

// =============================================================================
// Test Document Types
// =============================================================================

/**
 * Basic user document for testing.
 */
interface UserDocument {
  _id: string
  name: string
  email: string
  age: number
  active: boolean
  createdAt: Date
}

/**
 * Document with nested objects.
 */
interface ProfileDocument {
  _id: string
  user: {
    firstName: string
    lastName: string
    address: {
      street: string
      city: string
      zipCode: string
    }
  }
  settings: {
    theme: 'light' | 'dark'
    notifications: boolean
  }
}

/**
 * Document with arrays.
 */
interface OrderDocument {
  _id: string
  customerId: string
  items: Array<{
    productId: string
    quantity: number
    price: number
  }>
  tags: string[]
  total: number
}

// =============================================================================
// Schema Definition Tests
// =============================================================================

describe('Schema Definition', () => {
  describe('createSchemaValidator', () => {
    it('should be a function', () => {
      expect(typeof createSchemaValidator).toBe('function')
    })

    it('should create a validator from a schema definition', () => {
      const schema: Schema<UserDocument> = {
        _id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
        age: { type: 'number', required: false },
        active: { type: 'boolean', required: false },
        createdAt: { type: 'date', required: false },
      }

      const validator = createSchemaValidator({ schema })

      expect(validator).toBeDefined()
      expect(typeof validator.validate).toBe('function')
    })

    it('should throw when schema is not provided', () => {
      expect(() =>
        createSchemaValidator({ schema: undefined as any })
      ).toThrow('schema is required')
    })

    it('should throw when schema is empty', () => {
      expect(() => createSchemaValidator({ schema: {} })).toThrow(
        'schema must define at least one field'
      )
    })

    it('should return a validator with validate and validateAsync methods', () => {
      const schema: Schema<{ _id: string }> = {
        _id: { type: 'string', required: true },
      }

      const validator = createSchemaValidator({ schema })

      expect(typeof validator.validate).toBe('function')
      expect(typeof validator.validateAsync).toBe('function')
    })
  })

  describe('schema field types', () => {
    it('should support string type', () => {
      const schema: Schema<{ name: string }> = {
        name: { type: 'string', required: true },
      }

      const validator = createSchemaValidator({ schema })
      const result = validator.validate({ name: 'John' })

      expect(result.valid).toBe(true)
    })

    it('should support number type', () => {
      const schema: Schema<{ age: number }> = {
        age: { type: 'number', required: true },
      }

      const validator = createSchemaValidator({ schema })
      const result = validator.validate({ age: 25 })

      expect(result.valid).toBe(true)
    })

    it('should support boolean type', () => {
      const schema: Schema<{ active: boolean }> = {
        active: { type: 'boolean', required: true },
      }

      const validator = createSchemaValidator({ schema })
      const result = validator.validate({ active: true })

      expect(result.valid).toBe(true)
    })

    it('should support date type', () => {
      const schema: Schema<{ createdAt: Date }> = {
        createdAt: { type: 'date', required: true },
      }

      const validator = createSchemaValidator({ schema })
      const result = validator.validate({ createdAt: new Date() })

      expect(result.valid).toBe(true)
    })

    it('should support object type', () => {
      const schema: Schema<{ metadata: object }> = {
        metadata: { type: 'object', required: true },
      }

      const validator = createSchemaValidator({ schema })
      const result = validator.validate({ metadata: { key: 'value' } })

      expect(result.valid).toBe(true)
    })

    it('should support array type', () => {
      const schema: Schema<{ tags: string[] }> = {
        tags: { type: 'array', required: true },
      }

      const validator = createSchemaValidator({ schema })
      const result = validator.validate({ tags: ['a', 'b', 'c'] })

      expect(result.valid).toBe(true)
    })

    it('should support any type', () => {
      const schema: Schema<{ data: any }> = {
        data: { type: 'any', required: true },
      }

      const validator = createSchemaValidator({ schema })

      expect(validator.validate({ data: 'string' }).valid).toBe(true)
      expect(validator.validate({ data: 123 }).valid).toBe(true)
      expect(validator.validate({ data: { nested: true } }).valid).toBe(true)
    })
  })
})

// =============================================================================
// Type Validation Tests
// =============================================================================

describe('Type Validation', () => {
  describe('string validation', () => {
    const schema: Schema<{ name: string }> = {
      name: { type: 'string', required: true },
    }
    let validator: ReturnType<typeof createSchemaValidator>

    beforeEach(() => {
      validator = createSchemaValidator({ schema })
    })

    it('should pass for valid string', () => {
      const result = validator.validate({ name: 'John' })
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail for number when expecting string', () => {
      const result = validator.validate({ name: 123 as any })
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].field).toBe('name')
      expect(result.errors[0].message).toContain('expected string')
    })

    it('should fail for boolean when expecting string', () => {
      const result = validator.validate({ name: true as any })
      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toContain('expected string')
    })

    it('should fail for null when expecting string', () => {
      const result = validator.validate({ name: null as any })
      expect(result.valid).toBe(false)
    })

    it('should pass for empty string by default', () => {
      const result = validator.validate({ name: '' })
      expect(result.valid).toBe(true)
    })
  })

  describe('number validation', () => {
    const schema: Schema<{ age: number }> = {
      age: { type: 'number', required: true },
    }
    let validator: ReturnType<typeof createSchemaValidator>

    beforeEach(() => {
      validator = createSchemaValidator({ schema })
    })

    it('should pass for valid integer', () => {
      const result = validator.validate({ age: 25 })
      expect(result.valid).toBe(true)
    })

    it('should pass for valid float', () => {
      const result = validator.validate({ age: 25.5 })
      expect(result.valid).toBe(true)
    })

    it('should pass for zero', () => {
      const result = validator.validate({ age: 0 })
      expect(result.valid).toBe(true)
    })

    it('should pass for negative numbers', () => {
      const result = validator.validate({ age: -10 })
      expect(result.valid).toBe(true)
    })

    it('should fail for string when expecting number', () => {
      const result = validator.validate({ age: '25' as any })
      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toContain('expected number')
    })

    it('should fail for NaN', () => {
      const result = validator.validate({ age: NaN })
      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toContain('NaN')
    })

    it('should fail for Infinity', () => {
      const result = validator.validate({ age: Infinity })
      expect(result.valid).toBe(false)
    })
  })

  describe('boolean validation', () => {
    const schema: Schema<{ active: boolean }> = {
      active: { type: 'boolean', required: true },
    }
    let validator: ReturnType<typeof createSchemaValidator>

    beforeEach(() => {
      validator = createSchemaValidator({ schema })
    })

    it('should pass for true', () => {
      const result = validator.validate({ active: true })
      expect(result.valid).toBe(true)
    })

    it('should pass for false', () => {
      const result = validator.validate({ active: false })
      expect(result.valid).toBe(true)
    })

    it('should fail for string when expecting boolean', () => {
      const result = validator.validate({ active: 'true' as any })
      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toContain('expected boolean')
    })

    it('should fail for number when expecting boolean', () => {
      const result = validator.validate({ active: 1 as any })
      expect(result.valid).toBe(false)
    })
  })

  describe('date validation', () => {
    const schema: Schema<{ createdAt: Date }> = {
      createdAt: { type: 'date', required: true },
    }
    let validator: ReturnType<typeof createSchemaValidator>

    beforeEach(() => {
      validator = createSchemaValidator({ schema })
    })

    it('should pass for Date object', () => {
      const result = validator.validate({ createdAt: new Date() })
      expect(result.valid).toBe(true)
    })

    it('should pass for valid date string', () => {
      const result = validator.validate({ createdAt: '2024-01-01T00:00:00Z' as any })
      expect(result.valid).toBe(true)
    })

    it('should pass for valid timestamp number', () => {
      const result = validator.validate({ createdAt: Date.now() as any })
      expect(result.valid).toBe(true)
    })

    it('should fail for invalid date string', () => {
      const result = validator.validate({ createdAt: 'not-a-date' as any })
      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toContain('date')
    })

    it('should fail for object that is not a Date', () => {
      const result = validator.validate({ createdAt: {} as any })
      expect(result.valid).toBe(false)
    })
  })

  describe('object validation', () => {
    const schema: Schema<{ metadata: Record<string, unknown> }> = {
      metadata: { type: 'object', required: true },
    }
    let validator: ReturnType<typeof createSchemaValidator>

    beforeEach(() => {
      validator = createSchemaValidator({ schema })
    })

    it('should pass for plain object', () => {
      const result = validator.validate({ metadata: { key: 'value' } })
      expect(result.valid).toBe(true)
    })

    it('should pass for empty object', () => {
      const result = validator.validate({ metadata: {} })
      expect(result.valid).toBe(true)
    })

    it('should fail for array when expecting object', () => {
      const result = validator.validate({ metadata: [] as any })
      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toContain('expected object')
    })

    it('should fail for null when expecting object', () => {
      const result = validator.validate({ metadata: null as any })
      expect(result.valid).toBe(false)
    })

    it('should fail for string when expecting object', () => {
      const result = validator.validate({ metadata: 'string' as any })
      expect(result.valid).toBe(false)
    })
  })

  describe('array validation', () => {
    const schema: Schema<{ tags: string[] }> = {
      tags: { type: 'array', required: true },
    }
    let validator: ReturnType<typeof createSchemaValidator>

    beforeEach(() => {
      validator = createSchemaValidator({ schema })
    })

    it('should pass for array', () => {
      const result = validator.validate({ tags: ['a', 'b', 'c'] })
      expect(result.valid).toBe(true)
    })

    it('should pass for empty array', () => {
      const result = validator.validate({ tags: [] })
      expect(result.valid).toBe(true)
    })

    it('should fail for object when expecting array', () => {
      const result = validator.validate({ tags: {} as any })
      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toContain('expected array')
    })

    it('should fail for string when expecting array', () => {
      const result = validator.validate({ tags: 'not-an-array' as any })
      expect(result.valid).toBe(false)
    })
  })
})

// =============================================================================
// Required Field Validation Tests
// =============================================================================

describe('Required Field Validation', () => {
  describe('required: true', () => {
    const schema: Schema<UserDocument> = {
      _id: { type: 'string', required: true },
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      age: { type: 'number', required: false },
      active: { type: 'boolean', required: false },
      createdAt: { type: 'date', required: false },
    }
    let validator: ReturnType<typeof createSchemaValidator>

    beforeEach(() => {
      validator = createSchemaValidator({ schema })
    })

    it('should pass when all required fields are present', () => {
      const result = validator.validate({
        _id: '123',
        name: 'John',
        email: 'john@example.com',
      })
      expect(result.valid).toBe(true)
    })

    it('should fail when required field is missing', () => {
      const result = validator.validate({
        _id: '123',
        name: 'John',
        // email is missing
      } as any)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].field).toBe('email')
      expect(result.errors[0].message).toContain('required')
    })

    it('should fail when required field is undefined', () => {
      const result = validator.validate({
        _id: '123',
        name: 'John',
        email: undefined as any,
      })
      expect(result.valid).toBe(false)
      expect(result.errors[0].field).toBe('email')
    })

    it('should fail when multiple required fields are missing', () => {
      const result = validator.validate({
        _id: '123',
        // name and email are missing
      } as any)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('required: false (optional)', () => {
    const schema: Schema<{ name?: string; age?: number }> = {
      name: { type: 'string', required: false },
      age: { type: 'number', required: false },
    }
    let validator: ReturnType<typeof createSchemaValidator>

    beforeEach(() => {
      validator = createSchemaValidator({ schema })
    })

    it('should pass when optional field is missing', () => {
      const result = validator.validate({})
      expect(result.valid).toBe(true)
    })

    it('should pass when optional field is present with valid value', () => {
      const result = validator.validate({ name: 'John' })
      expect(result.valid).toBe(true)
    })

    it('should fail when optional field is present with invalid type', () => {
      const result = validator.validate({ name: 123 as any })
      expect(result.valid).toBe(false)
      expect(result.errors[0].field).toBe('name')
    })

    it('should pass when optional field is null (treated as absent)', () => {
      const result = validator.validate({ name: null as any })
      expect(result.valid).toBe(true)
    })
  })
})

// =============================================================================
// Nested Object Validation Tests
// =============================================================================

describe('Nested Object Validation', () => {
  const schema: Schema<ProfileDocument> = {
    _id: { type: 'string', required: true },
    user: {
      type: 'object',
      required: true,
      properties: {
        firstName: { type: 'string', required: true },
        lastName: { type: 'string', required: true },
        address: {
          type: 'object',
          required: true,
          properties: {
            street: { type: 'string', required: true },
            city: { type: 'string', required: true },
            zipCode: { type: 'string', required: true },
          },
        },
      },
    },
    settings: {
      type: 'object',
      required: false,
      properties: {
        theme: { type: 'string', required: false },
        notifications: { type: 'boolean', required: false },
      },
    },
  }
  let validator: ReturnType<typeof createSchemaValidator>

  beforeEach(() => {
    validator = createSchemaValidator({ schema })
  })

  it('should pass for valid nested document', () => {
    const result = validator.validate({
      _id: '123',
      user: {
        firstName: 'John',
        lastName: 'Doe',
        address: {
          street: '123 Main St',
          city: 'Springfield',
          zipCode: '12345',
        },
      },
      settings: {
        theme: 'dark',
        notifications: true,
      },
    })
    expect(result.valid).toBe(true)
  })

  it('should fail when nested required field is missing', () => {
    const result = validator.validate({
      _id: '123',
      user: {
        firstName: 'John',
        // lastName is missing
        address: {
          street: '123 Main St',
          city: 'Springfield',
          zipCode: '12345',
        },
      },
    } as any)
    expect(result.valid).toBe(false)
    expect(result.errors[0].field).toBe('user.lastName')
  })

  it('should fail when deeply nested required field is missing', () => {
    const result = validator.validate({
      _id: '123',
      user: {
        firstName: 'John',
        lastName: 'Doe',
        address: {
          street: '123 Main St',
          // city is missing
          zipCode: '12345',
        },
      },
    } as any)
    expect(result.valid).toBe(false)
    expect(result.errors[0].field).toBe('user.address.city')
  })

  it('should fail when nested field has wrong type', () => {
    const result = validator.validate({
      _id: '123',
      user: {
        firstName: 'John',
        lastName: 123 as any, // should be string
        address: {
          street: '123 Main St',
          city: 'Springfield',
          zipCode: '12345',
        },
      },
    })
    expect(result.valid).toBe(false)
    expect(result.errors[0].field).toBe('user.lastName')
  })

  it('should pass when optional nested object is missing', () => {
    const result = validator.validate({
      _id: '123',
      user: {
        firstName: 'John',
        lastName: 'Doe',
        address: {
          street: '123 Main St',
          city: 'Springfield',
          zipCode: '12345',
        },
      },
      // settings is optional, so this should pass
    })
    expect(result.valid).toBe(true)
  })
})

// =============================================================================
// Array Item Validation Tests
// =============================================================================

describe('Array Item Validation', () => {
  describe('simple array items', () => {
    const schema: Schema<{ tags: string[] }> = {
      tags: {
        type: 'array',
        required: true,
        items: { type: 'string' },
      },
    }
    let validator: ReturnType<typeof createSchemaValidator>

    beforeEach(() => {
      validator = createSchemaValidator({ schema })
    })

    it('should pass for array with valid item types', () => {
      const result = validator.validate({ tags: ['a', 'b', 'c'] })
      expect(result.valid).toBe(true)
    })

    it('should fail when array item has wrong type', () => {
      const result = validator.validate({ tags: ['a', 123 as any, 'c'] })
      expect(result.valid).toBe(false)
      expect(result.errors[0].field).toBe('tags[1]')
      expect(result.errors[0].message).toContain('expected string')
    })

    it('should fail for multiple invalid items', () => {
      const result = validator.validate({ tags: [1 as any, 2 as any, 3 as any] })
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBe(3)
    })
  })

  describe('object array items', () => {
    const schema: Schema<OrderDocument> = {
      _id: { type: 'string', required: true },
      customerId: { type: 'string', required: true },
      items: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          properties: {
            productId: { type: 'string', required: true },
            quantity: { type: 'number', required: true },
            price: { type: 'number', required: true },
          },
        },
      },
      tags: {
        type: 'array',
        required: false,
        items: { type: 'string' },
      },
      total: { type: 'number', required: true },
    }
    let validator: ReturnType<typeof createSchemaValidator>

    beforeEach(() => {
      validator = createSchemaValidator({ schema })
    })

    it('should pass for valid order document', () => {
      const result = validator.validate({
        _id: 'order-123',
        customerId: 'cust-456',
        items: [
          { productId: 'prod-1', quantity: 2, price: 10.99 },
          { productId: 'prod-2', quantity: 1, price: 25.00 },
        ],
        tags: ['urgent', 'wholesale'],
        total: 46.98,
      })
      expect(result.valid).toBe(true)
    })

    it('should fail when array item object is missing required field', () => {
      const result = validator.validate({
        _id: 'order-123',
        customerId: 'cust-456',
        items: [
          { productId: 'prod-1', quantity: 2 }, // missing price
        ],
        total: 21.98,
      } as any)
      expect(result.valid).toBe(false)
      expect(result.errors[0].field).toBe('items[0].price')
    })

    it('should fail when array item object has wrong type', () => {
      const result = validator.validate({
        _id: 'order-123',
        customerId: 'cust-456',
        items: [
          { productId: 'prod-1', quantity: 'two' as any, price: 10.99 },
        ],
        total: 10.99,
      })
      expect(result.valid).toBe(false)
      expect(result.errors[0].field).toBe('items[0].quantity')
    })
  })
})

// =============================================================================
// Custom Validator Tests
// =============================================================================

describe('Custom Validators', () => {
  describe('custom validate function', () => {
    it('should call custom validator for field', () => {
      const customValidator = vi.fn().mockReturnValue(true)

      const schema: Schema<{ email: string }> = {
        email: {
          type: 'string',
          required: true,
          validate: customValidator,
        },
      }

      const validator = createSchemaValidator({ schema })
      validator.validate({ email: 'test@example.com' })

      expect(customValidator).toHaveBeenCalledWith(
        'test@example.com',
        expect.objectContaining({ field: 'email' })
      )
    })

    it('should fail when custom validator returns false', () => {
      const schema: Schema<{ email: string }> = {
        email: {
          type: 'string',
          required: true,
          validate: (value) => (value as string).includes('@'),
        },
      }

      const validator = createSchemaValidator({ schema })
      const result = validator.validate({ email: 'invalid-email' })

      expect(result.valid).toBe(false)
      expect(result.errors[0].field).toBe('email')
    })

    it('should pass when custom validator returns true', () => {
      const schema: Schema<{ email: string }> = {
        email: {
          type: 'string',
          required: true,
          validate: (value) => (value as string).includes('@'),
        },
      }

      const validator = createSchemaValidator({ schema })
      const result = validator.validate({ email: 'valid@example.com' })

      expect(result.valid).toBe(true)
    })

    it('should support custom error message from validator', () => {
      const schema: Schema<{ email: string }> = {
        email: {
          type: 'string',
          required: true,
          validate: (value) => {
            if (!(value as string).includes('@')) {
              return 'must be a valid email address'
            }
            return true
          },
        },
      }

      const validator = createSchemaValidator({ schema })
      const result = validator.validate({ email: 'invalid' })

      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toBe('must be a valid email address')
    })

    it('should support async custom validators', async () => {
      const asyncValidator = vi.fn().mockResolvedValue(true)

      const schema: Schema<{ username: string }> = {
        username: {
          type: 'string',
          required: true,
          validateAsync: asyncValidator,
        },
      }

      const validator = createSchemaValidator({ schema })
      const result = await validator.validateAsync({ username: 'johndoe' })

      expect(asyncValidator).toHaveBeenCalledWith(
        'johndoe',
        expect.objectContaining({ field: 'username' })
      )
      expect(result.valid).toBe(true)
    })

    it('should fail when async validator rejects', async () => {
      const schema: Schema<{ username: string }> = {
        username: {
          type: 'string',
          required: true,
          validateAsync: async () => {
            return 'username already taken'
          },
        },
      }

      const validator = createSchemaValidator({ schema })
      const result = await validator.validateAsync({ username: 'existing-user' })

      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toBe('username already taken')
    })
  })

  describe('built-in validators', () => {
    it('should validate minimum string length', () => {
      const schema: Schema<{ password: string }> = {
        password: {
          type: 'string',
          required: true,
          minLength: 8,
        },
      }

      const validator = createSchemaValidator({ schema })

      expect(validator.validate({ password: 'short' }).valid).toBe(false)
      expect(validator.validate({ password: 'longenough123' }).valid).toBe(true)
    })

    it('should validate maximum string length', () => {
      const schema: Schema<{ bio: string }> = {
        bio: {
          type: 'string',
          required: true,
          maxLength: 100,
        },
      }

      const validator = createSchemaValidator({ schema })

      expect(validator.validate({ bio: 'Short bio' }).valid).toBe(true)
      expect(validator.validate({ bio: 'A'.repeat(101) }).valid).toBe(false)
    })

    it('should validate minimum number value', () => {
      const schema: Schema<{ age: number }> = {
        age: {
          type: 'number',
          required: true,
          min: 0,
        },
      }

      const validator = createSchemaValidator({ schema })

      expect(validator.validate({ age: -1 }).valid).toBe(false)
      expect(validator.validate({ age: 0 }).valid).toBe(true)
      expect(validator.validate({ age: 25 }).valid).toBe(true)
    })

    it('should validate maximum number value', () => {
      const schema: Schema<{ quantity: number }> = {
        quantity: {
          type: 'number',
          required: true,
          max: 100,
        },
      }

      const validator = createSchemaValidator({ schema })

      expect(validator.validate({ quantity: 50 }).valid).toBe(true)
      expect(validator.validate({ quantity: 101 }).valid).toBe(false)
    })

    it('should validate pattern with regex', () => {
      const schema: Schema<{ email: string }> = {
        email: {
          type: 'string',
          required: true,
          pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        },
      }

      const validator = createSchemaValidator({ schema })

      expect(validator.validate({ email: 'test@example.com' }).valid).toBe(true)
      expect(validator.validate({ email: 'invalid-email' }).valid).toBe(false)
    })

    it('should validate enum values', () => {
      const schema: Schema<{ status: string }> = {
        status: {
          type: 'string',
          required: true,
          enum: ['pending', 'active', 'completed'],
        },
      }

      const validator = createSchemaValidator({ schema })

      expect(validator.validate({ status: 'active' }).valid).toBe(true)
      expect(validator.validate({ status: 'invalid' }).valid).toBe(false)
    })

    it('should validate minimum array length', () => {
      const schema: Schema<{ tags: string[] }> = {
        tags: {
          type: 'array',
          required: true,
          minItems: 1,
        },
      }

      const validator = createSchemaValidator({ schema })

      expect(validator.validate({ tags: [] }).valid).toBe(false)
      expect(validator.validate({ tags: ['one'] }).valid).toBe(true)
    })

    it('should validate maximum array length', () => {
      const schema: Schema<{ tags: string[] }> = {
        tags: {
          type: 'array',
          required: true,
          maxItems: 5,
        },
      }

      const validator = createSchemaValidator({ schema })

      expect(validator.validate({ tags: ['a', 'b', 'c'] }).valid).toBe(true)
      expect(validator.validate({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }).valid).toBe(false)
    })
  })
})

// =============================================================================
// Validation Result Tests
// =============================================================================

describe('Validation Result', () => {
  const schema: Schema<UserDocument> = {
    _id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    email: { type: 'string', required: true },
    age: { type: 'number', required: false },
    active: { type: 'boolean', required: false },
    createdAt: { type: 'date', required: false },
  }
  let validator: ReturnType<typeof createSchemaValidator>

  beforeEach(() => {
    validator = createSchemaValidator({ schema })
  })

  describe('valid result', () => {
    it('should return valid: true for valid document', () => {
      const result = validator.validate({
        _id: '123',
        name: 'John',
        email: 'john@example.com',
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('should include the validated document', () => {
      const doc = {
        _id: '123',
        name: 'John',
        email: 'john@example.com',
      }
      const result = validator.validate(doc)

      expect(result.document).toEqual(doc)
    })
  })

  describe('invalid result', () => {
    it('should return valid: false for invalid document', () => {
      const result = validator.validate({
        _id: '123',
        // name and email missing
      } as any)

      expect(result.valid).toBe(false)
    })

    it('should include all validation errors', () => {
      const result = validator.validate({
        _id: '123',
        name: 123 as any,
        email: true as any,
      })

      expect(result.errors.length).toBe(2)
    })

    it('should include field path in error', () => {
      const result = validator.validate({
        _id: '123',
        name: 123 as any,
        email: 'valid@example.com',
      })

      expect(result.errors[0].field).toBe('name')
    })

    it('should include expected type in error', () => {
      const result = validator.validate({
        _id: '123',
        name: 123 as any,
        email: 'valid@example.com',
      })

      expect(result.errors[0].expectedType).toBe('string')
    })

    it('should include actual value in error', () => {
      const result = validator.validate({
        _id: '123',
        name: 123 as any,
        email: 'valid@example.com',
      })

      expect(result.errors[0].actualValue).toBe(123)
    })

    it('should include actual type in error', () => {
      const result = validator.validate({
        _id: '123',
        name: 123 as any,
        email: 'valid@example.com',
      })

      expect(result.errors[0].actualType).toBe('number')
    })
  })

  describe('error collection mode', () => {
    it('should collect all errors by default', () => {
      const result = validator.validate({
        _id: 123 as any,
        name: true as any,
        email: [],
      } as any)

      expect(result.errors.length).toBe(3)
    })

    it('should stop at first error when abortEarly is true', () => {
      const earlyValidator = createSchemaValidator({
        schema,
        abortEarly: true,
      })

      const result = earlyValidator.validate({
        _id: 123 as any,
        name: true as any,
        email: [],
      } as any)

      expect(result.errors.length).toBe(1)
    })
  })
})

// =============================================================================
// SchemaValidationError Tests
// =============================================================================

describe('SchemaValidationError', () => {
  it('should be an Error instance', () => {
    const error = new SchemaValidationError('Validation failed', [])
    expect(error).toBeInstanceOf(Error)
  })

  it('should have correct name', () => {
    const error = new SchemaValidationError('Validation failed', [])
    expect(error.name).toBe('SchemaValidationError')
  })

  it('should include validation errors', () => {
    const validationErrors = [
      { field: 'name', message: 'is required' },
    ]
    const error = new SchemaValidationError('Validation failed', validationErrors as any)

    expect(error.errors).toEqual(validationErrors)
  })

  it('should include error count in message', () => {
    const validationErrors = [
      { field: 'name', message: 'is required' },
      { field: 'email', message: 'is required' },
    ]
    const error = new SchemaValidationError('Validation failed', validationErrors as any)

    expect(error.message).toContain('2')
  })
})

// =============================================================================
// Direct validateDocument Function Tests
// =============================================================================

describe('validateDocument function', () => {
  it('should be a function', () => {
    expect(typeof validateDocument).toBe('function')
  })

  it('should validate document against schema', () => {
    const schema: Schema<{ name: string }> = {
      name: { type: 'string', required: true },
    }

    const result = validateDocument({ name: 'John' }, schema)
    expect(result.valid).toBe(true)
  })

  it('should return errors for invalid document', () => {
    const schema: Schema<{ name: string }> = {
      name: { type: 'string', required: true },
    }

    const result = validateDocument({}, schema)
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
  })

  it('should throw SchemaValidationError when throwOnError is true', () => {
    const schema: Schema<{ name: string }> = {
      name: { type: 'string', required: true },
    }

    expect(() =>
      validateDocument({}, schema, { throwOnError: true })
    ).toThrow(SchemaValidationError)
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration with Mutation Handlers', () => {
  it('should be usable as a pre-insert hook', async () => {
    const schema: Schema<UserDocument> = {
      _id: { type: 'string', required: true },
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      age: { type: 'number', required: false },
      active: { type: 'boolean', required: false },
      createdAt: { type: 'date', required: false },
    }

    const validator = createSchemaValidator({ schema })

    // Simulate pre-insert validation
    const documentToInsert = {
      _id: '123',
      name: 'John',
      email: 'john@example.com',
      age: 25,
      active: true,
      createdAt: new Date(),
    }

    const result = validator.validate(documentToInsert)
    expect(result.valid).toBe(true)
  })

  it('should validate multiple documents for batch insert', () => {
    const schema: Schema<{ _id: string; name: string }> = {
      _id: { type: 'string', required: true },
      name: { type: 'string', required: true },
    }

    const validator = createSchemaValidator({ schema })

    const documents = [
      { _id: '1', name: 'John' },
      { _id: '2', name: 'Jane' },
      { _id: '3', name: 'Bob' },
    ]

    const results = documents.map((doc) => validator.validate(doc))

    expect(results.every((r) => r.valid)).toBe(true)
  })

  it('should identify which document failed in batch validation', () => {
    const schema: Schema<{ _id: string; name: string }> = {
      _id: { type: 'string', required: true },
      name: { type: 'string', required: true },
    }

    const validator = createSchemaValidator({ schema })

    const documents = [
      { _id: '1', name: 'John' },
      { _id: '2' }, // missing name
      { _id: '3', name: 'Bob' },
    ]

    const results = documents.map((doc, index) => ({
      index,
      result: validator.validate(doc),
    }))

    const failedDoc = results.find((r) => !r.result.valid)
    expect(failedDoc?.index).toBe(1)
  })

  it('should provide validateBatch method for batch validation', () => {
    const schema: Schema<{ _id: string; name: string }> = {
      _id: { type: 'string', required: true },
      name: { type: 'string', required: true },
    }

    const validator = createSchemaValidator({ schema })

    const documents = [
      { _id: '1', name: 'John' },
      { _id: '2' }, // missing name
      { _id: '3', name: 'Bob' },
    ]

    const batchResult = validator.validateBatch(documents)

    expect(batchResult.valid).toBe(false)
    expect(batchResult.results).toHaveLength(3)
    expect(batchResult.failedCount).toBe(1)
    expect(batchResult.failedIndices).toEqual([1])
  })
})

// =============================================================================
// Configuration Options Tests
// =============================================================================

describe('Configuration Options', () => {
  describe('strict mode', () => {
    it('should fail for unknown fields when strict is true', () => {
      const schema: Schema<{ name: string }> = {
        name: { type: 'string', required: true },
      }

      const validator = createSchemaValidator({
        schema,
        strict: true,
      })

      const result = validator.validate({
        name: 'John',
        unknownField: 'value',
      } as any)

      expect(result.valid).toBe(false)
      expect(result.errors[0].field).toBe('unknownField')
      expect(result.errors[0].message).toContain('unknown field')
    })

    it('should allow unknown fields when strict is false (default)', () => {
      const schema: Schema<{ name: string }> = {
        name: { type: 'string', required: true },
      }

      const validator = createSchemaValidator({ schema })

      const result = validator.validate({
        name: 'John',
        unknownField: 'value',
      } as any)

      expect(result.valid).toBe(true)
    })
  })

  describe('coerce mode', () => {
    it('should coerce string to number when coerce is true', () => {
      const schema: Schema<{ age: number }> = {
        age: { type: 'number', required: true },
      }

      const validator = createSchemaValidator({
        schema,
        coerce: true,
      })

      const result = validator.validate({ age: '25' as any })

      expect(result.valid).toBe(true)
      expect(result.document?.age).toBe(25)
    })

    it('should not coerce when coerce is false (default)', () => {
      const schema: Schema<{ age: number }> = {
        age: { type: 'number', required: true },
      }

      const validator = createSchemaValidator({ schema })

      const result = validator.validate({ age: '25' as any })

      expect(result.valid).toBe(false)
    })
  })

  describe('custom error messages', () => {
    it('should use custom error message for required validation', () => {
      const schema: Schema<{ name: string }> = {
        name: {
          type: 'string',
          required: true,
          messages: {
            required: 'Name cannot be empty',
          },
        },
      }

      const validator = createSchemaValidator({ schema })
      const result = validator.validate({})

      expect(result.errors[0].message).toBe('Name cannot be empty')
    })

    it('should use custom error message for type validation', () => {
      const schema: Schema<{ age: number }> = {
        age: {
          type: 'number',
          required: true,
          messages: {
            type: 'Age must be a number',
          },
        },
      }

      const validator = createSchemaValidator({ schema })
      const result = validator.validate({ age: 'not-a-number' as any })

      expect(result.errors[0].message).toBe('Age must be a number')
    })
  })
})
