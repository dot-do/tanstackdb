/**
 * @file Client-Wins Conflict Resolution Strategy (RED Phase - Stub Implementation)
 *
 * This strategy always resolves conflicts by accepting the client's version,
 * discarding any server-side changes when a conflict is detected.
 *
 * Layer 9 Conflict Resolution - Client-Wins Strategy
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/conflict/client-wins
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Context provided to the client-wins resolver.
 */
export interface ConflictContext<T> {
  /** The document key (typically _id) */
  readonly key: string
  /** The document version from the client (local changes) */
  readonly clientValue: T
  /** The document version from the server (remote state) */
  readonly serverValue: T
  /** The common ancestor version before the conflict occurred (if available) */
  readonly baseValue: T
  /** Timestamp when the conflict was detected */
  readonly timestamp: number
}

/**
 * Result returned from the client-wins resolver.
 */
export interface ConflictResolution<T> {
  /** The resolved document value that will be persisted */
  readonly resolvedValue: T
  /** Which strategy was used */
  readonly strategy: 'client-wins'
  /** Whether there was actually a conflict (values were different) */
  readonly hadConflict?: boolean
  /** Additional metadata about the resolution */
  readonly metadata?: {
    /** When the conflict was detected */
    conflictDetectedAt?: number
    /** The value that was discarded */
    discardedValue?: T
    /** Custom metadata */
    [key: string]: unknown
  }
}

/**
 * Configuration for the client-wins resolver.
 */
export interface ClientWinsResolverConfig<T> {
  /** Callback when a conflict is detected */
  onConflictDetected?: (context: ConflictContext<T>) => void
  /** Callback when a conflict is resolved */
  onConflictResolved?: (context: ConflictContext<T>, result: ConflictResolution<T>) => void
}

/**
 * Client-wins resolver interface.
 */
export interface ClientWinsResolver<T> {
  /** The strategy identifier */
  readonly strategy: 'client-wins'
  /** Resolve a conflict using client-wins strategy */
  resolve(context: ConflictContext<T>): ConflictResolution<T>
  /** Resolve multiple conflicts in batch */
  resolveBatch?(contexts: ConflictContext<T>[]): ConflictResolution<T>[]
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Deep equality check for two values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false

  const aJson = JSON.stringify(a)
  const bJson = JSON.stringify(b)
  return aJson === bJson
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Create a client-wins conflict resolver.
 *
 * @param config - Optional configuration for the resolver
 * @returns A ClientWinsResolver instance
 */
export function createClientWinsResolver<T>(
  config?: ClientWinsResolverConfig<T>
): ClientWinsResolver<T> {
  const resolve = (context: ConflictContext<T>): ConflictResolution<T> => {
    const { clientValue, serverValue } = context

    // Check if values are actually different
    const hadConflict = !deepEqual(clientValue, serverValue)

    // Call onConflictDetected if there was a conflict
    if (hadConflict && config?.onConflictDetected) {
      config.onConflictDetected(context)
    }

    const result: ConflictResolution<T> = {
      resolvedValue: clientValue,
      strategy: 'client-wins',
      hadConflict,
      metadata: {
        conflictDetectedAt: context.timestamp,
        discardedValue: serverValue,
      },
    }

    // Call onConflictResolved callback
    if (config?.onConflictResolved) {
      config.onConflictResolved(context, result)
    }

    return result
  }

  const resolveBatch = (contexts: ConflictContext<T>[]): ConflictResolution<T>[] => {
    return contexts.map((ctx) => resolve(ctx))
  }

  return {
    strategy: 'client-wins',
    resolve,
    resolveBatch,
  }
}

/**
 * Direct function to resolve a conflict using client-wins strategy.
 *
 * @param context - The conflict context
 * @returns The resolution result
 */
export function resolveWithClientWins<T>(context: ConflictContext<T>): ConflictResolution<T> {
  const resolver = createClientWinsResolver<T>()
  return resolver.resolve(context)
}
