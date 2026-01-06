/**
 * @file Last-Write-Wins Conflict Resolution Strategy
 *
 * Implements the Last-Write-Wins (LWW) conflict resolution strategy for Layer 9
 * synchronization. This strategy compares timestamps of concurrent writes and
 * accepts the most recent one.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/conflict/last-write-wins
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Base interface for documents with timestamps.
 */
export interface TimestampedDocument {
  _id: string
  updatedAt?: Date
  [key: string]: unknown
}

/**
 * Function to extract timestamp from a document.
 */
export type TimestampExtractor<T> = (doc: T) => Date | undefined

/**
 * Tiebreaker function when timestamps are equal.
 */
export type TieBreakerFn<T> = (
  local: T,
  remote: T
) => 'local' | 'remote' | Promise<'local' | 'remote'>

/**
 * Missing timestamp handling strategies.
 */
export type MissingTimestampStrategy =
  | 'use-current-time'
  | 'prefer-with-timestamp'
  | 'use-default'
  | 'throw'

/**
 * Tiebreaker options for resolveLastWriteWins.
 */
export type TieBreakerOption = 'server-wins' | 'client-wins'

/**
 * Configuration for Last-Write-Wins strategy.
 */
export interface LastWriteWinsConfig<T> {
  /** Field name to extract timestamp from */
  timestampField?: string
  /** Array of field names to try in order */
  timestampFields?: string[]
  /** Format of the timestamp field */
  timestampFormat?: 'milliseconds' | 'seconds'
  /** Custom timestamp extractor function */
  getTimestamp?: TimestampExtractor<T>
  /** Custom comparator for timestamps */
  comparator?: (a: Date, b: Date) => number
  /** Tiebreaker function when timestamps are equal */
  tieBreaker?: TieBreakerFn<T>
  /** How to handle missing timestamps */
  handleMissingTimestamp?: MissingTimestampStrategy
  /** Default timestamp to use when missing */
  defaultTimestamp?: Date
  /** Whether to track which fields were overwritten */
  trackOverwrittenFields?: boolean
  /** Callback when a conflict is resolved */
  onConflict?: (local: T, remote: T, result: LastWriteWinsResult<T>) => void
  /** Custom error messages */
  errorMessages?: {
    missingLocal?: string
    missingRemote?: string
    invalidTimestamp?: string
  }
}

/**
 * Result of Last-Write-Wins conflict resolution.
 */
export interface LastWriteWinsResult<T> {
  /** The resolved document */
  resolved: T
  /** Which version won */
  winner: 'local' | 'remote'
  /** Whether a tiebreaker was used */
  tieBreaker?: boolean
  /** Additional metadata about the resolution */
  metadata?: {
    /** Sync context ID if provided */
    syncId?: string
    /** Fields that were overwritten */
    overwrittenFields?: string[]
    /** Whether a missing timestamp was handled */
    missingTimestampHandled?: boolean
  }
}

/**
 * Strategy object returned by createLastWriteWinsStrategy.
 */
export interface LastWriteWinsStrategy<T> {
  /** Strategy name identifier */
  name: 'last-write-wins'
  /** Resolve a conflict between local and remote documents */
  resolve(
    local: T,
    remote: T,
    options?: { syncContext?: { syncId: string } }
  ): LastWriteWinsResult<T>
  /** Resolve a conflict asynchronously (for async tiebreakers) */
  resolveAsync(
    local: T,
    remote: T,
    options?: { syncContext?: { syncId: string } }
  ): Promise<LastWriteWinsResult<T>>
  /** Detect if there's a conflict between documents */
  detectConflict(local: T, remote: T): ConflictDetectionResult
}

/**
 * Context for conflict resolution via resolver function.
 */
export interface ConflictContext<T> {
  /** Server version of the document */
  serverVersion: T
  /** Client version of the document */
  clientVersion: T
  /** Base version (optional) */
  baseVersion?: T
  /** Server document timestamp */
  serverTimestamp: Date
  /** Client document timestamp */
  clientTimestamp: Date
  /** Document key */
  key: string
  /** Fields that are conflicting (optional) */
  conflictingFields?: string[]
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Result from resolver function.
 */
export interface ResolverResult<T> {
  /** The resolved document */
  resolved: T
  /** Metadata about the resolution */
  resolutionMetadata?: {
    /** Strategy used */
    strategy: 'last-write-wins'
    /** Which version won */
    winner: 'server' | 'client'
    /** Whether a tiebreaker was used */
    tieBreaker?: boolean
    /** Timestamp difference in milliseconds */
    timestampDiffMs?: number
    /** When the resolution occurred */
    resolvedAt?: Date
    /** Document key */
    documentKey?: string
    /** Metadata passed from context */
    contextMetadata?: Record<string, unknown>
  }
}

/**
 * Resolver function type.
 */
export type LastWriteWinsResolver<T> = (context: ConflictContext<T>) => ResolverResult<T>

/**
 * Result of conflict detection.
 */
export interface ConflictDetectionResult {
  /** Whether there's a conflict */
  hasConflict: boolean
  /** Fields that are in conflict */
  conflictingFields?: string[]
  /** Whether both documents modified since base */
  concurrentModification?: boolean
  /** Whether there's a version mismatch */
  versionConflict?: boolean
  /** Local document version */
  localVersion?: number
  /** Remote document version */
  remoteVersion?: number
  /** Whether optimistic locking failed */
  optimisticLockFailure?: boolean
}

/**
 * Options for conflict detection.
 */
export interface ConflictDetectionOptions<T> {
  /** Base version to compare against */
  baseVersion?: T
  /** Field name for version number */
  versionField?: string
  /** Enable optimistic locking detection */
  optimisticLocking?: boolean
}

/**
 * Options for timestamp extraction.
 */
export interface ExtractTimestampOptions {
  /** Format of numeric timestamps */
  format?: 'milliseconds' | 'seconds'
}

/**
 * Options for resolveLastWriteWins.
 */
export interface ResolveLastWriteWinsOptions {
  /** Tiebreaker preference */
  tieBreaker?: TieBreakerOption
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get a value from an object using a dot-separated path or array path.
 */
function getNestedValue(obj: unknown, path: string | string[]): unknown {
  const parts = Array.isArray(path) ? path : path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Check if a value is a valid date.
 */
function isValidDate(date: unknown): date is Date {
  return date instanceof Date && !isNaN(date.getTime())
}

/**
 * Convert a timestamp value to a Date object.
 */
function toDate(
  value: unknown,
  options?: ExtractTimestampOptions
): Date | undefined {
  if (value === null || value === undefined) {
    return undefined
  }

  // Already a Date
  if (value instanceof Date) {
    return isValidDate(value) ? value : undefined
  }

  // ISO string
  if (typeof value === 'string') {
    const date = new Date(value)
    return isValidDate(date) ? date : undefined
  }

  // Unix timestamp
  if (typeof value === 'number') {
    // If format is seconds, convert to milliseconds
    if (options?.format === 'seconds') {
      return new Date(value * 1000)
    }
    // Otherwise, assume milliseconds if value is small (likely seconds)
    // or just use as-is
    return new Date(value)
  }

  return undefined
}

/**
 * Find differing fields between two objects.
 */
function findDifferingFields(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): string[] {
  const differences: string[] = []
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])

  for (const key of allKeys) {
    if (key === '_id') continue // Skip _id comparison
    const aVal = a[key]
    const bVal = b[key]

    if (aVal instanceof Date && bVal instanceof Date) {
      if (aVal.getTime() !== bVal.getTime()) {
        differences.push(key)
      }
    } else if (JSON.stringify(aVal) !== JSON.stringify(bVal)) {
      differences.push(key)
    }
  }

  return differences
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Extract timestamp from a document.
 *
 * @param doc - The document to extract timestamp from
 * @param pathOrExtractor - Field path (string or array) or custom extractor function
 * @param options - Extraction options
 * @returns The extracted Date or undefined
 */
export function extractTimestamp<T>(
  doc: T,
  pathOrExtractor: string | string[] | TimestampExtractor<T>,
  options?: ExtractTimestampOptions
): Date | undefined {
  // Use custom extractor if provided
  if (typeof pathOrExtractor === 'function') {
    return pathOrExtractor(doc)
  }

  const value = getNestedValue(doc, pathOrExtractor)

  // Auto-detect _ts field as seconds (Cosmos DB convention)
  const fieldName = Array.isArray(pathOrExtractor)
    ? pathOrExtractor[pathOrExtractor.length - 1]
    : pathOrExtractor.split('.').pop()

  const effectiveOptions: ExtractTimestampOptions = { ...options }
  if (fieldName === '_ts' && !options?.format && typeof value === 'number') {
    effectiveOptions.format = 'seconds'
  }

  return toDate(value, effectiveOptions)
}

/**
 * Compare two timestamps.
 *
 * @param a - First timestamp
 * @param b - Second timestamp
 * @returns Negative if a < b, positive if a > b, 0 if equal
 */
export function compareTimestamps(a: Date, b: Date): number {
  return a.getTime() - b.getTime()
}

/**
 * Detect if there's a conflict between two documents.
 *
 * @param local - Local document version
 * @param remote - Remote document version
 * @param options - Detection options
 * @returns Conflict detection result
 */
export function detectConflict<T extends Record<string, unknown>>(
  local: T,
  remote: T,
  options?: ConflictDetectionOptions<T>
): ConflictDetectionResult {
  // Check if documents are identical
  const localJson = JSON.stringify(local)
  const remoteJson = JSON.stringify(remote)

  if (localJson === remoteJson) {
    return {
      hasConflict: false,
      concurrentModification: false,
      versionConflict: false,
      optimisticLockFailure: false,
    }
  }

  // Find differing fields
  const conflictingFields = findDifferingFields(local, remote)

  // Check for concurrent modification with base version
  let concurrentModification = false
  if (options?.baseVersion) {
    const base = options.baseVersion
    const localChangedFromBase =
      JSON.stringify(local) !== JSON.stringify(base)
    const remoteChangedFromBase =
      JSON.stringify(remote) !== JSON.stringify(base)
    concurrentModification = localChangedFromBase && remoteChangedFromBase

    // If only remote changed, it's not a conflict
    if (!localChangedFromBase && remoteChangedFromBase) {
      return {
        hasConflict: false,
        conflictingFields,
        concurrentModification: false,
        versionConflict: false,
        optimisticLockFailure: false,
      }
    }
  }

  // Check version field conflict
  let versionConflict = false
  let localVersion: number | undefined
  let remoteVersion: number | undefined

  if (options?.versionField) {
    localVersion = local[options.versionField] as number | undefined
    remoteVersion = remote[options.versionField] as number | undefined

    if (
      localVersion !== undefined &&
      remoteVersion !== undefined &&
      localVersion !== remoteVersion
    ) {
      versionConflict = true
    }
  }

  // Check optimistic locking failure
  let optimisticLockFailure = false
  if (options?.optimisticLocking && options?.baseVersion && options?.versionField) {
    const baseVersion = options.baseVersion[options.versionField] as
      | number
      | undefined
    if (
      baseVersion !== undefined &&
      remoteVersion !== undefined &&
      remoteVersion !== baseVersion
    ) {
      optimisticLockFailure = true
    }
  }

  return {
    hasConflict: conflictingFields.length > 0 || versionConflict,
    conflictingFields,
    concurrentModification,
    versionConflict,
    localVersion,
    remoteVersion,
    optimisticLockFailure,
  }
}

/**
 * Resolve a conflict between local and remote documents using a strategy.
 *
 * @param local - Local document version
 * @param remote - Remote document version
 * @param strategy - Strategy to use for resolution
 * @returns Resolution result
 */
export function resolveConflict<T>(
  local: T,
  remote: T,
  strategy: LastWriteWinsStrategy<T>
): LastWriteWinsResult<T> {
  return strategy.resolve(local, remote)
}

/**
 * Direct API for Last-Write-Wins resolution.
 *
 * @param context - Conflict context with server and client versions
 * @param options - Resolution options
 * @returns Resolution result
 */
export function resolveLastWriteWins<T>(
  context: ConflictContext<T>,
  options?: ResolveLastWriteWinsOptions
): ResolverResult<T> {
  // Validate inputs
  if (context.serverVersion === null || context.serverVersion === undefined) {
    throw new Error('serverVersion is required')
  }
  if (context.clientVersion === null || context.clientVersion === undefined) {
    throw new Error('clientVersion is required')
  }
  if (!isValidDate(context.serverTimestamp)) {
    throw new Error('serverTimestamp must be a valid date')
  }
  if (!isValidDate(context.clientTimestamp)) {
    throw new Error('clientTimestamp must be a valid date')
  }

  const comparison = compareTimestamps(
    context.clientTimestamp,
    context.serverTimestamp
  )

  const resolvedAt = new Date()
  const timestampDiffMs = Math.abs(
    context.clientTimestamp.getTime() - context.serverTimestamp.getTime()
  )

  // Client is newer
  if (comparison > 0) {
    return {
      resolved: context.clientVersion,
      resolutionMetadata: {
        strategy: 'last-write-wins',
        winner: 'client',
        timestampDiffMs,
        resolvedAt,
        documentKey: context.key,
        contextMetadata: context.metadata,
      },
    }
  }

  // Server is newer
  if (comparison < 0) {
    return {
      resolved: context.serverVersion,
      resolutionMetadata: {
        strategy: 'last-write-wins',
        winner: 'server',
        timestampDiffMs,
        resolvedAt,
        documentKey: context.key,
        contextMetadata: context.metadata,
      },
    }
  }

  // Timestamps are equal - use tiebreaker
  const tieBreaker = options?.tieBreaker ?? 'server-wins'
  const winner = tieBreaker === 'client-wins' ? 'client' : 'server'
  const resolved =
    winner === 'client' ? context.clientVersion : context.serverVersion

  return {
    resolved,
    resolutionMetadata: {
      strategy: 'last-write-wins',
      winner,
      tieBreaker: true,
      timestampDiffMs: 0,
      resolvedAt,
      documentKey: context.key,
      contextMetadata: context.metadata,
    },
  }
}

/**
 * Create a Last-Write-Wins resolver function.
 *
 * @param config - Configuration options
 * @returns Resolver function
 */
export function createLastWriteWinsResolver<T>(
  config?: LastWriteWinsConfig<T>
): LastWriteWinsResolver<T> {
  return (context: ConflictContext<T>): ResolverResult<T> => {
    const comparison = compareTimestamps(
      context.clientTimestamp,
      context.serverTimestamp
    )

    const resolvedAt = new Date()
    const timestampDiffMs = Math.abs(
      context.clientTimestamp.getTime() - context.serverTimestamp.getTime()
    )

    // Client is newer
    if (comparison > 0) {
      return {
        resolved: context.clientVersion,
        resolutionMetadata: {
          strategy: 'last-write-wins',
          winner: 'client',
          timestampDiffMs,
          resolvedAt,
          documentKey: context.key,
          contextMetadata: context.metadata,
        },
      }
    }

    // Server is newer
    if (comparison < 0) {
      return {
        resolved: context.serverVersion,
        resolutionMetadata: {
          strategy: 'last-write-wins',
          winner: 'server',
          timestampDiffMs,
          resolvedAt,
          documentKey: context.key,
          contextMetadata: context.metadata,
        },
      }
    }

    // Timestamps are equal - use default tiebreaker (server wins)
    return {
      resolved: context.serverVersion,
      resolutionMetadata: {
        strategy: 'last-write-wins',
        winner: 'server',
        tieBreaker: true,
        timestampDiffMs: 0,
        resolvedAt,
        documentKey: context.key,
        contextMetadata: context.metadata,
      },
    }
  }
}

/**
 * Create a Last-Write-Wins conflict resolution strategy.
 *
 * @param config - Configuration options
 * @returns Strategy object
 */
export function createLastWriteWinsStrategy<T extends Record<string, unknown>>(
  config?: LastWriteWinsConfig<T>
): LastWriteWinsStrategy<T> {
  const {
    timestampField = 'updatedAt',
    timestampFields,
    timestampFormat,
    getTimestamp,
    comparator = compareTimestamps,
    tieBreaker,
    handleMissingTimestamp = 'prefer-with-timestamp',
    defaultTimestamp,
    trackOverwrittenFields = false,
    onConflict,
    errorMessages = {},
  } = config ?? {}

  const {
    missingLocal = 'local document is required',
    missingRemote = 'remote document is required',
  } = errorMessages

  /**
   * Get timestamp from a document using configured extractors.
   */
  function getDocTimestamp(doc: T): Date | undefined {
    // Use custom extractor if provided
    if (getTimestamp) {
      return getTimestamp(doc)
    }

    // Try timestampFields array first
    if (timestampFields && timestampFields.length > 0) {
      for (const field of timestampFields) {
        const ts = extractTimestamp(doc, field, { format: timestampFormat })
        if (ts) return ts
      }
      return undefined
    }

    // Use single timestampField
    return extractTimestamp(doc, timestampField, { format: timestampFormat })
  }

  /**
   * Handle missing timestamp based on strategy.
   */
  function handleMissing(
    doc: T,
    otherDoc: T,
    otherTs: Date | undefined
  ): {
    timestamp: Date | undefined
    missingHandled: boolean
  } {
    switch (handleMissingTimestamp) {
      case 'use-current-time':
        return { timestamp: new Date(), missingHandled: true }

      case 'prefer-with-timestamp':
        // If other has timestamp, this one "loses"
        // Return a very old timestamp so other wins
        if (otherTs) {
          return { timestamp: new Date(0), missingHandled: true }
        }
        // Both missing - fall through to default
        return { timestamp: defaultTimestamp ?? new Date(0), missingHandled: true }

      case 'use-default':
        return { timestamp: defaultTimestamp ?? new Date(0), missingHandled: true }

      case 'throw':
        throw new Error('Missing timestamp')

      default:
        // Default: prefer document with timestamp
        if (otherTs) {
          return { timestamp: new Date(0), missingHandled: true }
        }
        return { timestamp: new Date(0), missingHandled: true }
    }
  }

  /**
   * Resolve conflict synchronously.
   */
  function resolve(
    local: T,
    remote: T,
    options?: { syncContext?: { syncId: string } }
  ): LastWriteWinsResult<T> {
    // Validate inputs
    if (local === null || local === undefined) {
      throw new Error(missingLocal)
    }
    if (remote === null || remote === undefined) {
      throw new Error(missingRemote)
    }

    // Extract timestamps
    let localTs = getDocTimestamp(local)
    let remoteTs = getDocTimestamp(remote)
    let missingTimestampHandled = false

    // Handle missing timestamps
    if (!localTs) {
      const handled = handleMissing(local, remote, remoteTs)
      localTs = handled.timestamp
      missingTimestampHandled = handled.missingHandled
    }
    if (!remoteTs) {
      const handled = handleMissing(remote, local, localTs)
      remoteTs = handled.timestamp
      missingTimestampHandled = handled.missingHandled
    }

    // Compare timestamps
    const comparison = comparator(localTs!, remoteTs!)

    let result: LastWriteWinsResult<T>

    // Local is newer
    if (comparison > 0) {
      result = {
        resolved: local,
        winner: 'local',
        metadata: {
          syncId: options?.syncContext?.syncId,
          missingTimestampHandled: missingTimestampHandled || undefined,
        },
      }
    }
    // Remote is newer
    else if (comparison < 0) {
      result = {
        resolved: remote,
        winner: 'remote',
        metadata: {
          syncId: options?.syncContext?.syncId,
          missingTimestampHandled: missingTimestampHandled || undefined,
        },
      }
    }
    // Timestamps are equal - use tiebreaker
    else {
      let winner: 'local' | 'remote' = 'local' // Default

      if (tieBreaker) {
        const tieBreakerResult = tieBreaker(local, remote)
        // Handle sync tiebreaker only in sync resolve
        if (typeof tieBreakerResult === 'string') {
          winner = tieBreakerResult
        } else {
          // Promise - can't handle in sync, default to local
          winner = 'local'
        }
      }

      result = {
        resolved: winner === 'local' ? local : remote,
        winner,
        tieBreaker: true,
        metadata: {
          syncId: options?.syncContext?.syncId,
          missingTimestampHandled: missingTimestampHandled || undefined,
        },
      }
    }

    // Track overwritten fields if configured
    if (trackOverwrittenFields && result.winner === 'remote') {
      result.metadata = result.metadata ?? {}
      result.metadata.overwrittenFields = findDifferingFields(
        local as Record<string, unknown>,
        remote as Record<string, unknown>
      )
    } else if (trackOverwrittenFields && result.winner === 'local') {
      result.metadata = result.metadata ?? {}
      result.metadata.overwrittenFields = findDifferingFields(
        remote as Record<string, unknown>,
        local as Record<string, unknown>
      )
    }

    // Call onConflict callback if provided
    onConflict?.(local, remote, result)

    return result
  }

  /**
   * Resolve conflict asynchronously (supports async tiebreakers).
   */
  async function resolveAsync(
    local: T,
    remote: T,
    options?: { syncContext?: { syncId: string } }
  ): Promise<LastWriteWinsResult<T>> {
    // Validate inputs
    if (local === null || local === undefined) {
      throw new Error(missingLocal)
    }
    if (remote === null || remote === undefined) {
      throw new Error(missingRemote)
    }

    // Extract timestamps
    let localTs = getDocTimestamp(local)
    let remoteTs = getDocTimestamp(remote)
    let missingTimestampHandled = false

    // Handle missing timestamps
    if (!localTs) {
      const handled = handleMissing(local, remote, remoteTs)
      localTs = handled.timestamp
      missingTimestampHandled = handled.missingHandled
    }
    if (!remoteTs) {
      const handled = handleMissing(remote, local, localTs)
      remoteTs = handled.timestamp
      missingTimestampHandled = handled.missingHandled
    }

    // Compare timestamps
    const comparison = comparator(localTs!, remoteTs!)

    let result: LastWriteWinsResult<T>

    // Local is newer
    if (comparison > 0) {
      result = {
        resolved: local,
        winner: 'local',
        metadata: {
          syncId: options?.syncContext?.syncId,
          missingTimestampHandled: missingTimestampHandled || undefined,
        },
      }
    }
    // Remote is newer
    else if (comparison < 0) {
      result = {
        resolved: remote,
        winner: 'remote',
        metadata: {
          syncId: options?.syncContext?.syncId,
          missingTimestampHandled: missingTimestampHandled || undefined,
        },
      }
    }
    // Timestamps are equal - use tiebreaker
    else {
      let winner: 'local' | 'remote' = 'local' // Default

      if (tieBreaker) {
        const tieBreakerResult = tieBreaker(local, remote)
        if (typeof tieBreakerResult === 'string') {
          winner = tieBreakerResult
        } else {
          // Await promise
          winner = await tieBreakerResult
        }
      }

      result = {
        resolved: winner === 'local' ? local : remote,
        winner,
        tieBreaker: true,
        metadata: {
          syncId: options?.syncContext?.syncId,
          missingTimestampHandled: missingTimestampHandled || undefined,
        },
      }
    }

    // Track overwritten fields if configured
    if (trackOverwrittenFields && result.winner === 'remote') {
      result.metadata = result.metadata ?? {}
      result.metadata.overwrittenFields = findDifferingFields(
        local as Record<string, unknown>,
        remote as Record<string, unknown>
      )
    } else if (trackOverwrittenFields && result.winner === 'local') {
      result.metadata = result.metadata ?? {}
      result.metadata.overwrittenFields = findDifferingFields(
        remote as Record<string, unknown>,
        local as Record<string, unknown>
      )
    }

    // Call onConflict callback if provided
    onConflict?.(local, remote, result)

    return result
  }

  return {
    name: 'last-write-wins',
    resolve,
    resolveAsync,
    detectConflict: (local: T, remote: T) =>
      detectConflict(
        local as Record<string, unknown>,
        remote as Record<string, unknown>
      ),
  }
}
