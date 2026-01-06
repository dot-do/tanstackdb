/**
 * @file Schema Validation - TDD (RED Phase Stub)
 *
 * This file provides stub implementations for the Schema Validation functionality.
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

  return {
    validate: (_document: unknown): ValidationResult => {
      throw new Error('Not implemented: validate')
    },
    validateAsync: async (_document: unknown): Promise<ValidationResult> => {
      throw new Error('Not implemented: validateAsync')
    },
    validateBatch: (_documents: unknown[]): BatchValidationResult => {
      throw new Error('Not implemented: validateBatch')
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
