/**
 * @file Schema Validation - TDD (GREEN Phase Implementation)
 *
 * This file provides full implementations for the Schema Validation functionality.
 * Schema Validation validates documents against a schema before writing to MongoDB.
 *
 * @module @tanstack/mongo-db-collection/provisioning/schema-validation
 */

// =============================================================================
// Types
// =============================================================================

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array' | 'any'

export interface SchemaField {
  type: FieldType
  required?: boolean
  properties?: Record<string, SchemaField>
  items?: SchemaField
  validate?: (value: unknown, context: ValidationContext) => boolean | string
  validateAsync?: (value: unknown, context: ValidationContext) => Promise<boolean | string>
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  pattern?: RegExp
  enum?: string[]
  minItems?: number
  maxItems?: number
  messages?: {
    required?: string
    type?: string
  }
}

export type Schema<T> = {
  [K in keyof T]?: SchemaField
}

export interface ValidationContext {
  field: string
  document: unknown
  path: string[]
}

export interface ValidationError {
  field: string
  message: string
  expectedType?: string
  actualType?: string
  actualValue?: unknown
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  document?: unknown
}

export interface BatchValidationResult {
  valid: boolean
  results: ValidationResult[]
  failedCount: number
  failedIndices: number[]
}

export interface SchemaValidatorConfig {
  schema: Record<string, SchemaField>
  abortEarly?: boolean
  strict?: boolean
  coerce?: boolean
}

export interface SchemaValidator {
  validate(document: unknown): ValidationResult
  validateAsync(document: unknown): Promise<ValidationResult>
  validateBatch(documents: unknown[]): BatchValidationResult
}

// =============================================================================
// Error Class
// =============================================================================

export class SchemaValidationError extends Error {
  errors: ValidationError[]

  constructor(message: string, errors: ValidationError[]) {
    const errorCount = errors.length
    super(`${message} (${errorCount} error${errorCount !== 1 ? 's' : ''})`)
    this.name = 'SchemaValidationError'
    this.errors = errors
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function getActualType(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  return typeof value
}

function isValidDate(value: unknown): boolean {
  if (value instanceof Date) {
    return !isNaN(value.getTime())
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return !isNaN(date.getTime())
  }
  if (typeof value === 'number') {
    const date = new Date(value)
    return !isNaN(date.getTime())
  }
  return false
}

function coerceValue(value: unknown, targetType: FieldType): unknown {
  if (targetType === 'number' && typeof value === 'string') {
    const num = Number(value)
    if (!isNaN(num) && isFinite(num)) {
      return num
    }
  }
  if (targetType === 'boolean' && typeof value === 'string') {
    if (value === 'true') return true
    if (value === 'false') return false
  }
  if (targetType === 'string' && typeof value === 'number') {
    return String(value)
  }
  return value
}

// =============================================================================
// Factory Function
// =============================================================================

export function createSchemaValidator(config: SchemaValidatorConfig): SchemaValidator {
  // Validate config
  if (!config.schema) {
    throw new Error('schema is required')
  }
  if (Object.keys(config.schema).length === 0) {
    throw new Error('schema must define at least one field')
  }

  const { schema, abortEarly = false, strict = false, coerce = false } = config

  function validateFieldType(
    value: unknown,
    field: SchemaField,
    fieldPath: string,
    errors: ValidationError[],
    doc: Record<string, unknown>
  ): boolean {
    const actualType = getActualType(value)

    // Handle 'any' type - accepts everything
    if (field.type === 'any') {
      return true
    }

    // Type-specific validation
    switch (field.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push({
            field: fieldPath,
            message: field.messages?.type || `expected string, got ${actualType}`,
            expectedType: 'string',
            actualType,
            actualValue: value,
          })
          return false
        }
        break

      case 'number':
        if (typeof value !== 'number') {
          errors.push({
            field: fieldPath,
            message: field.messages?.type || `expected number, got ${actualType}`,
            expectedType: 'number',
            actualType,
            actualValue: value,
          })
          return false
        }
        if (isNaN(value)) {
          errors.push({
            field: fieldPath,
            message: field.messages?.type || 'value is NaN, which is not a valid number',
            expectedType: 'number',
            actualType: 'NaN',
            actualValue: value,
          })
          return false
        }
        if (!isFinite(value)) {
          errors.push({
            field: fieldPath,
            message: field.messages?.type || 'value is Infinity, which is not a valid number',
            expectedType: 'number',
            actualType: 'Infinity',
            actualValue: value,
          })
          return false
        }
        break

      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push({
            field: fieldPath,
            message: field.messages?.type || `expected boolean, got ${actualType}`,
            expectedType: 'boolean',
            actualType,
            actualValue: value,
          })
          return false
        }
        break

      case 'date':
        if (!isValidDate(value)) {
          errors.push({
            field: fieldPath,
            message: field.messages?.type || `expected valid date, got ${actualType}`,
            expectedType: 'date',
            actualType,
            actualValue: value,
          })
          return false
        }
        break

      case 'object':
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          errors.push({
            field: fieldPath,
            message: field.messages?.type || `expected object, got ${actualType}`,
            expectedType: 'object',
            actualType,
            actualValue: value,
          })
          return false
        }
        break

      case 'array':
        if (!Array.isArray(value)) {
          errors.push({
            field: fieldPath,
            message: field.messages?.type || `expected array, got ${actualType}`,
            expectedType: 'array',
            actualType,
            actualValue: value,
          })
          return false
        }
        break
    }

    return true
  }

  function validateBuiltInConstraints(
    value: unknown,
    field: SchemaField,
    fieldPath: string,
    errors: ValidationError[]
  ): boolean {
    let valid = true

    // String constraints
    if (field.type === 'string' && typeof value === 'string') {
      if (field.minLength !== undefined && value.length < field.minLength) {
        errors.push({
          field: fieldPath,
          message: `must have minimum length of ${field.minLength}`,
          expectedType: 'string',
          actualType: 'string',
          actualValue: value,
        })
        valid = false
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        errors.push({
          field: fieldPath,
          message: `must have maximum length of ${field.maxLength}`,
          expectedType: 'string',
          actualType: 'string',
          actualValue: value,
        })
        valid = false
      }
      if (field.pattern && !field.pattern.test(value)) {
        errors.push({
          field: fieldPath,
          message: `must match pattern ${field.pattern}`,
          expectedType: 'string',
          actualType: 'string',
          actualValue: value,
        })
        valid = false
      }
      if (field.enum && !field.enum.includes(value)) {
        errors.push({
          field: fieldPath,
          message: `must be one of: ${field.enum.join(', ')}`,
          expectedType: 'string',
          actualType: 'string',
          actualValue: value,
        })
        valid = false
      }
    }

    // Number constraints
    if (field.type === 'number' && typeof value === 'number') {
      if (field.min !== undefined && value < field.min) {
        errors.push({
          field: fieldPath,
          message: `must be at least ${field.min}`,
          expectedType: 'number',
          actualType: 'number',
          actualValue: value,
        })
        valid = false
      }
      if (field.max !== undefined && value > field.max) {
        errors.push({
          field: fieldPath,
          message: `must be at most ${field.max}`,
          expectedType: 'number',
          actualType: 'number',
          actualValue: value,
        })
        valid = false
      }
    }

    // Array constraints
    if (field.type === 'array' && Array.isArray(value)) {
      if (field.minItems !== undefined && value.length < field.minItems) {
        errors.push({
          field: fieldPath,
          message: `must have at least ${field.minItems} items`,
          expectedType: 'array',
          actualType: 'array',
          actualValue: value,
        })
        valid = false
      }
      if (field.maxItems !== undefined && value.length > field.maxItems) {
        errors.push({
          field: fieldPath,
          message: `must have at most ${field.maxItems} items`,
          expectedType: 'array',
          actualType: 'array',
          actualValue: value,
        })
        valid = false
      }
    }

    return valid
  }

  function validateCustomValidator(
    value: unknown,
    field: SchemaField,
    fieldPath: string,
    errors: ValidationError[],
    doc: Record<string, unknown>
  ): boolean {
    if (!field.validate) return true

    const context: ValidationContext = {
      field: fieldPath,
      document: doc,
      path: fieldPath.split('.'),
    }

    const result = field.validate(value, context)

    if (result === true) {
      return true
    }

    if (result === false) {
      errors.push({
        field: fieldPath,
        message: 'custom validation failed',
        actualValue: value,
      })
      return false
    }

    // result is a string (custom error message)
    errors.push({
      field: fieldPath,
      message: result,
      actualValue: value,
    })
    return false
  }

  async function validateCustomAsyncValidator(
    value: unknown,
    field: SchemaField,
    fieldPath: string,
    errors: ValidationError[],
    doc: Record<string, unknown>
  ): Promise<boolean> {
    if (!field.validateAsync) return true

    const context: ValidationContext = {
      field: fieldPath,
      document: doc,
      path: fieldPath.split('.'),
    }

    const result = await field.validateAsync(value, context)

    if (result === true) {
      return true
    }

    if (result === false) {
      errors.push({
        field: fieldPath,
        message: 'async custom validation failed',
        actualValue: value,
      })
      return false
    }

    // result is a string (custom error message)
    errors.push({
      field: fieldPath,
      message: result,
      actualValue: value,
    })
    return false
  }

  function validateField(
    value: unknown,
    field: SchemaField,
    fieldPath: string,
    errors: ValidationError[],
    doc: Record<string, unknown>
  ): boolean {
    // Check if type validation passes
    if (!validateFieldType(value, field, fieldPath, errors, doc)) {
      return false
    }

    // Check built-in constraints
    if (!validateBuiltInConstraints(value, field, fieldPath, errors)) {
      return false
    }

    // Check custom validator
    if (!validateCustomValidator(value, field, fieldPath, errors, doc)) {
      return false
    }

    // Validate nested object properties
    if (field.type === 'object' && field.properties && typeof value === 'object' && value !== null) {
      const objValue = value as Record<string, unknown>
      for (const [propName, propField] of Object.entries(field.properties)) {
        const propPath = `${fieldPath}.${propName}`
        const propValue = objValue[propName]

        // Check if required field is missing
        if (propField.required && (propValue === undefined || propValue === null)) {
          errors.push({
            field: propPath,
            message: propField.messages?.required || `${propPath} is required`,
            expectedType: propField.type,
            actualType: getActualType(propValue),
            actualValue: propValue,
          })
          if (abortEarly) return false
          continue
        }

        // Skip optional fields that are not present
        if (!propField.required && (propValue === undefined || propValue === null)) {
          continue
        }

        // Validate the property
        if (!validateField(propValue, propField, propPath, errors, doc)) {
          if (abortEarly) return false
        }
      }
    }

    // Validate array items
    if (field.type === 'array' && field.items && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const itemPath = `${fieldPath}[${i}]`
        const itemValue = value[i]

        // For object items with properties, validate nested structure
        if (field.items.type === 'object' && field.items.properties) {
          if (typeof itemValue !== 'object' || itemValue === null) {
            errors.push({
              field: itemPath,
              message: `expected object, got ${getActualType(itemValue)}`,
              expectedType: 'object',
              actualType: getActualType(itemValue),
              actualValue: itemValue,
            })
            if (abortEarly) return false
            continue
          }

          // Validate each property of the array item
          for (const [propName, propField] of Object.entries(field.items.properties)) {
            const propPath = `${itemPath}.${propName}`
            const propValue = (itemValue as Record<string, unknown>)[propName]

            if (propField.required && (propValue === undefined || propValue === null)) {
              errors.push({
                field: propPath,
                message: propField.messages?.required || `${propPath} is required`,
                expectedType: propField.type,
                actualType: getActualType(propValue),
                actualValue: propValue,
              })
              if (abortEarly) return false
              continue
            }

            if (!propField.required && (propValue === undefined || propValue === null)) {
              continue
            }

            if (!validateField(propValue, propField, propPath, errors, doc)) {
              if (abortEarly) return false
            }
          }
        } else {
          // Simple array items
          if (!validateField(itemValue, field.items, itemPath, errors, doc)) {
            if (abortEarly) return false
          }
        }
      }
    }

    return errors.length === 0 || !errors.some(e => e.field.startsWith(fieldPath))
  }

  async function validateFieldAsync(
    value: unknown,
    field: SchemaField,
    fieldPath: string,
    errors: ValidationError[],
    doc: Record<string, unknown>
  ): Promise<boolean> {
    // First run sync validation
    const initialErrorCount = errors.length
    validateField(value, field, fieldPath, errors, doc)

    // If there were sync validation errors, skip async validation
    if (errors.length > initialErrorCount) {
      return false
    }

    // Run async custom validator
    if (field.validateAsync) {
      await validateCustomAsyncValidator(value, field, fieldPath, errors, doc)
    }

    // Handle nested objects
    if (field.type === 'object' && field.properties && typeof value === 'object' && value !== null) {
      const objValue = value as Record<string, unknown>
      for (const [propName, propField] of Object.entries(field.properties)) {
        const propPath = `${fieldPath}.${propName}`
        const propValue = objValue[propName]

        if (!propField.required && (propValue === undefined || propValue === null)) {
          continue
        }

        if (propValue !== undefined && propValue !== null) {
          await validateFieldAsync(propValue, propField, propPath, errors, doc)
          if (abortEarly && errors.length > 0) return false
        }
      }
    }

    // Handle arrays
    if (field.type === 'array' && field.items && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const itemPath = `${fieldPath}[${i}]`
        await validateFieldAsync(value[i], field.items, itemPath, errors, doc)
        if (abortEarly && errors.length > 0) return false
      }
    }

    return errors.length === 0
  }

  function validateDocument(document: unknown, isAsync = false): ValidationResult {
    const errors: ValidationError[] = []

    if (typeof document !== 'object' || document === null) {
      return {
        valid: false,
        errors: [{
          field: '',
          message: 'document must be an object',
          expectedType: 'object',
          actualType: getActualType(document),
          actualValue: document,
        }],
        document,
      }
    }

    let doc = document as Record<string, unknown>

    // Coerce values if enabled
    if (coerce) {
      doc = { ...doc }
      for (const [fieldName, field] of Object.entries(schema)) {
        if (fieldName in doc) {
          const coerced = coerceValue(doc[fieldName], field.type)
          doc[fieldName] = coerced
        }
      }
    }

    // Check for unknown fields in strict mode
    if (strict) {
      for (const key of Object.keys(doc)) {
        if (!(key in schema)) {
          errors.push({
            field: key,
            message: `unknown field '${key}' is not allowed in strict mode`,
            actualValue: doc[key],
          })
          if (abortEarly) {
            return { valid: false, errors, document: doc }
          }
        }
      }
    }

    // Validate each field in the schema
    for (const [fieldName, field] of Object.entries(schema)) {
      const value = doc[fieldName]

      // Check required fields
      if (field.required) {
        if (value === undefined) {
          errors.push({
            field: fieldName,
            message: field.messages?.required || `${fieldName} is required`,
            expectedType: field.type,
            actualType: 'undefined',
            actualValue: value,
          })
          if (abortEarly) {
            return { valid: false, errors, document: doc }
          }
          continue
        }
      }

      // Skip validation for optional fields that are null (treated as absent)
      if (!field.required && (value === undefined || value === null)) {
        continue
      }

      // Validate the field
      validateField(value, field, fieldName, errors, doc)

      if (abortEarly && errors.length > 0) {
        return { valid: false, errors, document: doc }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      document: doc,
    }
  }

  async function validateDocumentAsync(document: unknown): Promise<ValidationResult> {
    const errors: ValidationError[] = []

    if (typeof document !== 'object' || document === null) {
      return {
        valid: false,
        errors: [{
          field: '',
          message: 'document must be an object',
          expectedType: 'object',
          actualType: getActualType(document),
          actualValue: document,
        }],
        document,
      }
    }

    let doc = document as Record<string, unknown>

    // Coerce values if enabled
    if (coerce) {
      doc = { ...doc }
      for (const [fieldName, field] of Object.entries(schema)) {
        if (fieldName in doc) {
          const coerced = coerceValue(doc[fieldName], field.type)
          doc[fieldName] = coerced
        }
      }
    }

    // Check for unknown fields in strict mode
    if (strict) {
      for (const key of Object.keys(doc)) {
        if (!(key in schema)) {
          errors.push({
            field: key,
            message: `unknown field '${key}' is not allowed in strict mode`,
            actualValue: doc[key],
          })
          if (abortEarly) {
            return { valid: false, errors, document: doc }
          }
        }
      }
    }

    // Validate each field in the schema
    for (const [fieldName, field] of Object.entries(schema)) {
      const value = doc[fieldName]

      // Check required fields
      if (field.required) {
        if (value === undefined) {
          errors.push({
            field: fieldName,
            message: field.messages?.required || `${fieldName} is required`,
            expectedType: field.type,
            actualType: 'undefined',
            actualValue: value,
          })
          if (abortEarly) {
            return { valid: false, errors, document: doc }
          }
          continue
        }
      }

      // Skip validation for optional fields that are null (treated as absent)
      if (!field.required && (value === undefined || value === null)) {
        continue
      }

      // Validate the field (sync validation)
      const initialErrorCount = errors.length
      validateField(value, field, fieldName, errors, doc)

      // Run async validation if sync passed
      if (errors.length === initialErrorCount && field.validateAsync) {
        await validateCustomAsyncValidator(value, field, fieldName, errors, doc)
      }

      if (abortEarly && errors.length > 0) {
        return { valid: false, errors, document: doc }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      document: doc,
    }
  }

  return {
    validate: (document: unknown): ValidationResult => {
      return validateDocument(document)
    },
    validateAsync: async (document: unknown): Promise<ValidationResult> => {
      return validateDocumentAsync(document)
    },
    validateBatch: (documents: unknown[]): BatchValidationResult => {
      const results = documents.map(doc => validateDocument(doc))
      const failedIndices: number[] = []

      results.forEach((result, index) => {
        if (!result.valid) {
          failedIndices.push(index)
        }
      })

      return {
        valid: failedIndices.length === 0,
        results,
        failedCount: failedIndices.length,
        failedIndices,
      }
    },
  }
}

// =============================================================================
// Direct Validation Function
// =============================================================================

export interface ValidateDocumentOptions {
  throwOnError?: boolean
}

export function validateDocument(
  document: unknown,
  schema: Record<string, SchemaField>,
  options?: ValidateDocumentOptions
): ValidationResult {
  const validator = createSchemaValidator({ schema })
  const result = validator.validate(document)

  if (options?.throwOnError && !result.valid) {
    throw new SchemaValidationError('Document validation failed', result.errors)
  }

  return result
}
