/**
 * @file Database/Collection Naming Conventions
 *
 * Full implementation of MongoDB database and collection naming conventions,
 * validation, sanitization, and generation utilities.
 *
 * @see https://www.mongodb.com/docs/manual/reference/limits/#naming-restrictions
 * @see tests/provisioning/database-naming.test.ts
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Naming convention options for conversion functions.
 */
export type NamingConvention =
  | 'camelCase'
  | 'snake_case'
  | 'kebab-case'
  | 'PascalCase'
  | 'auto'

/**
 * Result of database name validation.
 */
export interface DatabaseNameValidationResult {
  valid: boolean
  errors: string[]
  warnings?: string[]
  actualLength?: number
  maxLength?: number
}

/**
 * Result of collection name validation.
 */
export interface CollectionNameValidationResult {
  valid: boolean
  errors: string[]
  warnings?: string[]
}

/**
 * Options for database name validation.
 */
export interface DatabaseNameValidationOptions {
  maxLength?: number
  checkReserved?: boolean
  strict?: boolean
}

/**
 * Options for collection name validation.
 */
export interface CollectionNameValidationOptions {
  databaseName?: string
  maxLength?: number
}

/**
 * Options for database name generation.
 */
export interface DatabaseNameGenerationOptions {
  userId?: string
  tenantId?: string
  organizationId?: string
  environment?: 'development' | 'production' | 'staging' | 'test'
  environmentPrefix?: string
  unique?: boolean
  includeTimestamp?: boolean
  maxLength?: number
  separator?: string
  strategy?: 'prefix' | 'suffix' | 'hash' | 'uuid'
}

/**
 * Options for collection name generation.
 */
export interface CollectionNameGenerationOptions {
  baseName: string
  tenantId?: string
  appNamespace?: string
  version?: number
  shardKey?: string
}

/**
 * Result of database name generation.
 */
export interface GeneratedDatabaseName {
  name: string
  userId?: string
  tenantId?: string
  organizationId?: string
  timestamp?: number
  strategy?: string
}

/**
 * Result of collection name generation.
 */
export interface GeneratedCollectionName {
  name: string
  tenantId?: string
  appNamespace?: string
}

/**
 * Result of name sanitization.
 */
export interface SanitizationResult {
  name: string
  modified: boolean
  originalName: string
  removedCharacters?: string[]
  truncated?: boolean
  originalLength?: number
  collisionAvoided?: boolean
  reservedNameModified?: boolean
  systemPrefixModified?: boolean
}

/**
 * Options for sanitization.
 */
export interface SanitizationOptions {
  maxLength?: number
  existingNames?: string[]
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Invalid characters for MongoDB database names.
 */
const INVALID_DB_CHARS = ['/', '\\', '.', '"', '$', '*', '<', '>', ':', '|', '?']

/**
 * Reserved MongoDB database names (case-insensitive).
 */
const RESERVED_DB_NAMES = ['admin', 'local', 'config']

/**
 * Default max length for database names.
 */
const DEFAULT_DB_MAX_LENGTH = 64

/**
 * Max namespace length (database.collection) in bytes.
 */
const MAX_NAMESPACE_LENGTH = 255

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a simple hash from a string.
 */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16)
}

/**
 * Generate a pseudo-UUID v4-like string.
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

/**
 * Split a string into words based on the naming convention.
 * For 'auto' and mixed conventions, this handles hybrid cases like 'user_profileData'.
 */
function splitIntoWords(name: string, convention: NamingConvention): string[] {
  if (!name) return []

  switch (convention) {
    case 'snake_case':
      // Split on underscores, then also handle camelCase within segments
      return name.split('_').flatMap(segment => {
        // If the segment has camelCase, split it
        if (/[a-z][A-Z]/.test(segment)) {
          return segment
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
            .replace(/([a-z\d])([A-Z])/g, '$1_$2')
            .toLowerCase()
            .split('_')
        }
        return [segment]
      }).filter(Boolean)
    case 'kebab-case':
      return name.split('-').filter(Boolean)
    case 'camelCase':
    case 'PascalCase':
      // Split on uppercase letters, handling consecutive uppercase (acronyms)
      return name
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z\d])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .split('_')
        .filter(Boolean)
    case 'auto':
      return splitIntoWords(name, detectConvention(name))
    default:
      return [name]
  }
}

/**
 * Detect the naming convention of a string.
 */
function detectConvention(name: string): NamingConvention {
  if (!name) return 'snake_case'

  if (name.includes('_')) return 'snake_case'
  if (name.includes('-')) return 'kebab-case'
  if (name[0] === name[0].toUpperCase() && /[a-z]/.test(name)) return 'PascalCase'
  if (/[A-Z]/.test(name)) return 'camelCase'
  return 'snake_case'
}

/**
 * Convert words array to the target convention.
 */
function wordsToConvention(words: string[], convention: NamingConvention): string {
  if (words.length === 0) return ''

  switch (convention) {
    case 'snake_case':
      return words.map(w => w.toLowerCase()).join('_')
    case 'kebab-case':
      return words.map(w => w.toLowerCase()).join('-')
    case 'camelCase':
      return words
        .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('')
    case 'PascalCase':
      return words
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('')
    default:
      return words.join('')
  }
}

/**
 * Remove non-ASCII characters from a string, keeping alphanumeric, underscore, and hyphen.
 */
function removeNonAscii(str: string): string {
  // Simple transliteration for common accented characters using unicode code points
  const translitMap: Record<string, string> = {
    '\u00e0': 'a', '\u00e1': 'a', '\u00e2': 'a', '\u00e3': 'a', '\u00e4': 'a', '\u00e5': 'a', // a variants
    '\u00e8': 'e', '\u00e9': 'e', '\u00ea': 'e', '\u00eb': 'e', // e variants
    '\u00ec': 'i', '\u00ed': 'i', '\u00ee': 'i', '\u00ef': 'i', // i variants
    '\u00f2': 'o', '\u00f3': 'o', '\u00f4': 'o', '\u00f5': 'o', '\u00f6': 'o', // o variants
    '\u00f9': 'u', '\u00fa': 'u', '\u00fb': 'u', '\u00fc': 'u', // u variants
    '\u00f1': 'n', '\u00e7': 'c', // n tilde, c cedilla
    '\u00c0': 'A', '\u00c1': 'A', '\u00c2': 'A', '\u00c3': 'A', '\u00c4': 'A', '\u00c5': 'A', // A variants
    '\u00c8': 'E', '\u00c9': 'E', '\u00ca': 'E', '\u00cb': 'E', // E variants
    '\u00cc': 'I', '\u00cd': 'I', '\u00ce': 'I', '\u00cf': 'I', // I variants
    '\u00d2': 'O', '\u00d3': 'O', '\u00d4': 'O', '\u00d5': 'O', '\u00d6': 'O', // O variants
    '\u00d9': 'U', '\u00da': 'U', '\u00db': 'U', '\u00dc': 'U', // U variants
    '\u00d1': 'N', '\u00c7': 'C', // N tilde, C cedilla
  }

  let result = ''
  for (const char of str) {
    if (translitMap[char]) {
      result += translitMap[char]
    } else if (/^[a-zA-Z0-9_-]$/.test(char)) {
      result += char
    }
    // Non-ASCII characters that aren't in the translitMap are simply removed
  }
  return result
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate a database name against MongoDB naming restrictions.
 */
export function validateDatabaseName(
  name: string,
  options: DatabaseNameValidationOptions = {}
): DatabaseNameValidationResult {
  // Type check
  if (typeof name !== 'string') {
    throw new Error('Database name must be a string')
  }

  const {
    maxLength = DEFAULT_DB_MAX_LENGTH,
    checkReserved = true,
    strict = false,
  } = options

  const errors: string[] = []
  const warnings: string[] = []

  // Empty check
  if (name === '') {
    errors.push('Database name cannot be empty')
    return { valid: false, errors, warnings }
  }

  // Whitespace only check
  if (name.trim() === '') {
    errors.push('Database name cannot be empty or whitespace only')
    return { valid: false, errors, warnings }
  }

  // Null character check
  if (name.includes('\x00')) {
    errors.push('Database name cannot contain null character')
  }

  // Space check
  if (name.includes(' ')) {
    errors.push('Database name cannot contain spaces')
  }

  // Invalid character checks
  for (const char of INVALID_DB_CHARS) {
    if (name.includes(char)) {
      errors.push(`Database name cannot contain character: '${char}'`)
    }
  }

  // Length check
  if (name.length > maxLength) {
    errors.push(`Database name exceeds maximum length of ${maxLength} characters`)
  }

  // Reserved name check
  if (checkReserved) {
    const lowerName = name.toLowerCase()
    if (RESERVED_DB_NAMES.includes(lowerName)) {
      errors.push(`'${lowerName}' is a reserved MongoDB database name`)
    }
  }

  // Strict mode: lowercase only
  if (strict && /[A-Z]/.test(name)) {
    errors.push('Database name should be lowercase in strict mode')
  }

  // Warnings for common naming issues
  if (name === 'test') {
    warnings.push("Name 'test' may conflict with testing conventions")
  }

  const result: DatabaseNameValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
  }

  // Include length info when exceeding max
  if (name.length > maxLength) {
    result.actualLength = name.length
    result.maxLength = maxLength
  }

  return result
}

/**
 * Validate a collection name against MongoDB naming restrictions.
 */
export function validateCollectionName(
  name: string,
  options: CollectionNameValidationOptions = {}
): CollectionNameValidationResult {
  // Type check
  if (typeof name !== 'string') {
    throw new Error('Collection name must be a string')
  }

  const { databaseName, maxLength = 200 } = options

  const errors: string[] = []
  const warnings: string[] = []

  // Empty check
  if (name === '') {
    errors.push('Collection name cannot be empty')
    return { valid: false, errors, warnings }
  }

  // Whitespace only check
  if (name.trim() === '') {
    errors.push('Collection name cannot be empty or whitespace only')
    return { valid: false, errors, warnings }
  }

  // Null character check
  if (name.includes('\x00')) {
    errors.push('Collection name cannot contain null character')
  }

  // system. prefix check (case-sensitive)
  if (name.startsWith('system.')) {
    errors.push("Collection name cannot start with 'system.' prefix")
  }

  // $ character check
  if (name.includes('$')) {
    errors.push("Collection name cannot contain '$' character")
  }

  // Length check
  if (name.length > maxLength) {
    errors.push('Collection name exceeds maximum length')
  }

  // Namespace length check when database name is provided
  if (databaseName) {
    const namespaceLength = databaseName.length + 1 + name.length // db.collection
    if (namespaceLength > MAX_NAMESPACE_LENGTH) {
      errors.push('Full namespace (database.collection) exceeds 255 bytes')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// =============================================================================
// NAMING CONVENTION CONVERSION
// =============================================================================

/**
 * Convert a name between naming conventions.
 */
export function convertNamingConvention(
  name: string,
  from: NamingConvention,
  to: NamingConvention
): string {
  // Handle empty string
  if (!name) return ''

  // Validate conventions
  const validConventions: NamingConvention[] = ['camelCase', 'snake_case', 'kebab-case', 'PascalCase', 'auto']

  if (!validConventions.includes(from)) {
    throw new Error('Unsupported source naming convention')
  }

  if (to === 'auto') {
    throw new Error('Unsupported target naming convention')
  }

  if (!validConventions.includes(to)) {
    throw new Error('Unsupported target naming convention')
  }

  // Split into words based on source convention
  const words = splitIntoWords(name, from)

  // Convert to target convention
  return wordsToConvention(words, to)
}

// =============================================================================
// NAME GENERATION FUNCTIONS
// =============================================================================

/**
 * Generate a unique database name.
 */
export function generateDatabaseName(
  options: DatabaseNameGenerationOptions
): GeneratedDatabaseName {
  const {
    userId,
    tenantId,
    organizationId,
    environment,
    environmentPrefix,
    unique = true,
    includeTimestamp = false,
    maxLength = DEFAULT_DB_MAX_LENGTH,
    separator = '_',
    strategy = 'prefix',
  } = options

  // Require at least one identifier
  if (!userId && !tenantId && !organizationId) {
    throw new Error('At least one identifier is required')
  }

  const parts: string[] = []
  const result: GeneratedDatabaseName = { name: '' }

  // Add environment prefix
  if (environmentPrefix) {
    parts.push(environmentPrefix.replace(/_$/, ''))
  } else if (environment) {
    const envPrefixes: Record<string, string> = {
      development: 'dev',
      production: 'prod',
      staging: 'staging',
      test: 'test',
    }
    parts.push(envPrefixes[environment])
  }

  // Add organization if provided
  if (organizationId) {
    const sanitizedOrg = sanitizeForDbName(organizationId)
    parts.push(sanitizedOrg)
    result.organizationId = organizationId
  }

  // Add tenant if provided
  if (tenantId) {
    const sanitizedTenant = sanitizeForDbName(tenantId)
    parts.push(sanitizedTenant)
    result.tenantId = tenantId
  }

  // Add user id
  if (userId) {
    const sanitizedUser = sanitizeForDbName(userId)
    parts.push(sanitizedUser)
    result.userId = userId
  }

  // Add uniqueness based on strategy
  if (unique) {
    if (strategy === 'hash') {
      const hashInput = `${Date.now()}-${Math.random()}`
      parts.push(simpleHash(hashInput))
      result.strategy = 'hash'
    } else if (strategy === 'uuid') {
      const uuid = generateUUID().replace(/-/g, '').substring(0, 12)
      parts.push(uuid)
      result.strategy = 'uuid'
    } else {
      // Default: add random suffix
      const randomSuffix = Math.random().toString(36).substring(2, 8)
      parts.push(randomSuffix)
    }
  }

  // Add timestamp if requested
  if (includeTimestamp) {
    const timestamp = Date.now()
    const dateStr = new Date(timestamp).toISOString().slice(0, 10).replace(/-/g, '')
    parts.push(dateStr)
    result.timestamp = timestamp
  }

  // Join parts
  let name = parts.join(separator)

  // Truncate if needed
  if (name.length > maxLength) {
    name = name.substring(0, maxLength)
    // Ensure we don't end with a separator
    while (name.endsWith(separator) || name.endsWith('_') || name.endsWith('-')) {
      name = name.slice(0, -1)
    }
  }

  result.name = name.toLowerCase()
  return result
}

/**
 * Helper to sanitize a string for use in database names.
 */
function sanitizeForDbName(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
}

/**
 * Generate a collection name.
 */
export function generateCollectionName(
  options: CollectionNameGenerationOptions
): GeneratedCollectionName {
  const { baseName, tenantId, appNamespace, version, shardKey } = options

  const parts: string[] = []
  const result: GeneratedCollectionName = { name: '' }

  // Add app namespace
  if (appNamespace) {
    parts.push(sanitizeForCollectionName(appNamespace))
    result.appNamespace = appNamespace
  }

  // Add tenant id
  if (tenantId) {
    parts.push(sanitizeForCollectionName(tenantId))
    result.tenantId = tenantId
  }

  // Add base name (sanitized)
  parts.push(sanitizeForCollectionName(baseName))

  // Add shard key
  if (shardKey) {
    parts.push(sanitizeForCollectionName(shardKey))
  }

  // Add version
  if (version !== undefined) {
    parts.push(`v${version}`)
  }

  result.name = parts.join('_')
  return result
}

/**
 * Helper to sanitize a string for use in collection names.
 */
function sanitizeForCollectionName(str: string): string {
  return str
    .replace(/\$/g, '')
    .replace(/\x00/g, '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

// =============================================================================
// SANITIZATION FUNCTIONS
// =============================================================================

/**
 * Sanitize a database name to comply with MongoDB restrictions.
 */
export function sanitizeDatabaseName(
  name: string,
  options: SanitizationOptions = {}
): SanitizationResult {
  const { maxLength = DEFAULT_DB_MAX_LENGTH, existingNames = [] } = options

  const originalName = name
  const originalLength = name.length
  const removedCharacters: string[] = []
  let modified = false
  let truncated = false
  let collisionAvoided = false
  let reservedNameModified = false

  // Track removed characters
  for (const char of INVALID_DB_CHARS) {
    if (name.includes(char)) {
      removedCharacters.push(char)
    }
  }

  // Remove null characters
  if (name.includes('\x00')) {
    name = name.replace(/\x00/g, '')
    modified = true
  }

  // Replace spaces with underscores
  if (name.includes(' ')) {
    name = name.replace(/ /g, '_')
    modified = true
  }

  // Remove invalid characters
  for (const char of INVALID_DB_CHARS) {
    if (name.includes(char)) {
      name = name.split(char).join('')
      modified = true
    }
  }

  // Handle unicode/non-ASCII
  const asciiName = removeNonAscii(name)
  if (asciiName !== name) {
    name = asciiName
    modified = true
  }

  // Convert to lowercase
  const lowerName = name.toLowerCase()
  if (lowerName !== name) {
    name = lowerName
    modified = true
  }

  // Truncate if needed
  if (name.length > maxLength) {
    name = name.substring(0, maxLength)
    truncated = true
    modified = true
  }

  // Handle reserved names
  if (RESERVED_DB_NAMES.includes(name.toLowerCase())) {
    name = `${name}_db`
    reservedNameModified = true
    modified = true
  }

  // Handle collisions
  const baseName = name
  let suffix = 1
  while (existingNames.includes(name)) {
    name = `${baseName}_${suffix}`
    suffix++
    collisionAvoided = true
    modified = true
  }

  return {
    name,
    modified,
    originalName,
    removedCharacters: removedCharacters.length > 0 ? removedCharacters : undefined,
    truncated,
    originalLength: truncated ? originalLength : undefined,
    collisionAvoided,
    reservedNameModified: reservedNameModified || undefined,
  }
}

/**
 * Sanitize a collection name to comply with MongoDB restrictions.
 */
export function sanitizeCollectionName(
  name: string,
  options: SanitizationOptions = {}
): SanitizationResult {
  const { maxLength = 200, existingNames = [] } = options

  const originalName = name
  const originalLength = name.length
  const removedCharacters: string[] = []
  let modified = false
  let truncated = false
  let collisionAvoided = false
  let systemPrefixModified = false

  // Track and remove $ characters
  if (name.includes('$')) {
    removedCharacters.push('$')
    name = name.replace(/\$/g, '')
    modified = true
  }

  // Remove null characters
  if (name.includes('\x00')) {
    name = name.replace(/\x00/g, '')
    modified = true
  }

  // Replace spaces with underscores
  if (name.includes(' ')) {
    name = name.replace(/ /g, '_')
    modified = true
  }

  // Handle unicode/non-ASCII (but allow periods for collection namespacing)
  let asciiName = ''
  for (const char of name) {
    if (/^[a-zA-Z0-9_.-]$/.test(char)) {
      asciiName += char
    } else if (char === ' ') {
      asciiName += '_'
    }
    // Other chars are removed
  }
  if (asciiName !== name) {
    // Only update if different and not empty
    if (asciiName) {
      name = asciiName
      modified = true
    }
  }

  // Handle system. prefix
  if (name.startsWith('system.')) {
    name = `_${name}`
    systemPrefixModified = true
    modified = true
  }

  // Truncate if needed
  if (name.length > maxLength) {
    name = name.substring(0, maxLength)
    truncated = true
    modified = true
  }

  // Handle collisions
  const baseName = name
  let suffix = 1
  while (existingNames.includes(name)) {
    name = `${baseName}_${suffix}`
    suffix++
    collisionAvoided = true
    modified = true
  }

  return {
    name,
    modified,
    originalName,
    removedCharacters: removedCharacters.length > 0 ? removedCharacters : undefined,
    truncated: truncated || undefined,
    originalLength: truncated ? originalLength : undefined,
    collisionAvoided: collisionAvoided || undefined,
    systemPrefixModified: systemPrefixModified || undefined,
  }
}
