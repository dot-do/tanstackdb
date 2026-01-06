/**
 * @file Custom Conflict Resolution Strategy (RED Phase - Stub Implementation)
 *
 * This module provides a custom conflict resolution strategy that allows users
 * to define their own conflict resolution logic.
 *
 * Layer 9 Conflict Resolution - Custom Resolution Strategy
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/conflict/custom-resolution
 */

import type { ConflictContext, ConflictResolution, ConflictResolver } from '../../types/index.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the custom resolution strategy.
 */
export interface CustomResolutionStrategyConfig<T> {
  /** The custom resolver function */
  resolver: ConflictResolver<T>
  /** Optional strategy name */
  name?: string
  /** Fallback strategy when resolver returns null/undefined */
  fallbackStrategy?: 'server-wins' | 'client-wins' | 'last-write-wins'
  /** How to handle resolver errors */
  onError?: 'throw' | 'fallback'
  /** Callback for resolver errors */
  onErrorCallback?: (error: Error, context: ConflictContext<T>) => void
  /** Hook called before resolution */
  onBeforeResolve?: (context: ConflictContext<T>) => void
  /** Hook called after resolution */
  onAfterResolve?: (context: ConflictContext<T>, result: ConflictResolution<T>) => void
  /** Whether to validate the resolution result */
  validateResolution?: boolean
  /** Cleanup callback when strategy is disposed */
  onDispose?: () => void
  /** Whether to track resolution metrics */
  enableMetrics?: boolean
}

/**
 * Statistics for the custom resolution strategy.
 */
export interface CustomResolutionStats {
  /** Total number of resolutions */
  totalResolutions: number
  /** Number of successful resolutions */
  successfulResolutions: number
  /** Number of failed resolutions */
  failedResolutions: number
}

/**
 * Custom resolution strategy interface.
 */
export interface CustomResolutionStrategy<T> {
  /** The strategy name */
  readonly name: string
  /** Resolve a conflict using the custom resolver */
  resolve(context: ConflictContext<T>): Promise<ConflictResolution<T>>
  /** Dispose of the strategy and cleanup resources */
  dispose(): void
  /** Get resolution statistics (if metrics enabled) */
  getStats(): CustomResolutionStats
}

/**
 * Configuration for merge resolver.
 */
export interface MergeResolverConfig<T> {
  /** Fields to take from server */
  serverFields?: Array<keyof T>
  /** Fields to take from client */
  clientFields?: Array<keyof T>
  /** Whether to perform deep merge for nested objects */
  deepMerge?: boolean
  /** Whether to use base version for three-way merge */
  useBaseVersion?: boolean
  /** How to resolve conflicting fields */
  conflictFieldResolver?: 'server' | 'client'
}

/**
 * Configuration for field priority resolver.
 */
export interface FieldPriorityResolverConfig<T> {
  /** Rules for each field */
  rules: Partial<
    Record<keyof T, 'server' | 'client' | 'latest' | ((serverValue: unknown, clientValue: unknown) => unknown)>
  >
  /** Default priority for unspecified fields */
  defaultPriority?: 'server' | 'client'
}

/**
 * Configuration for timestamp resolver.
 */
export interface TimestampResolverConfig<T> {
  /** Custom timestamp extractor */
  getTimestamp?: (doc: T) => Date
  /** How to handle ties */
  tieBreaker?: 'server' | 'client'
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Create a custom resolution strategy.
 *
 * @param config - Configuration for the strategy
 * @returns A CustomResolutionStrategy instance
 */
export function createCustomResolutionStrategy<T>(
  config: CustomResolutionStrategyConfig<T>
): CustomResolutionStrategy<T> {
  // Validate config
  if (!config.resolver) {
    throw new Error('resolver is required')
  }
  if (typeof config.resolver !== 'function') {
    throw new Error('resolver must be a function')
  }

  const name = config.name ?? 'custom'
  let disposed = false
  let totalResolutions = 0
  let successfulResolutions = 0
  let failedResolutions = 0

  const resolve = async (context: ConflictContext<T>): Promise<ConflictResolution<T>> => {
    if (disposed) {
      throw new Error('Strategy has been disposed')
    }

    // Call onBeforeResolve hook
    if (config.onBeforeResolve) {
      config.onBeforeResolve(context)
    }

    try {
      // Call the resolver
      const result = await Promise.resolve(config.resolver(context))

      // Handle null/undefined result with fallback
      if (result === null || result === undefined) {
        const fallbackResult = applyFallback(context, config.fallbackStrategy)
        if (config.onAfterResolve) {
          config.onAfterResolve(context, fallbackResult)
        }
        if (config.enableMetrics) {
          totalResolutions++
          successfulResolutions++
        }
        return fallbackResult
      }

      // Validate result if configured
      if (config.validateResolution) {
        validateResolutionResult(result, context)
      }

      // Call onAfterResolve hook
      if (config.onAfterResolve) {
        config.onAfterResolve(context, result)
      }

      if (config.enableMetrics) {
        totalResolutions++
        successfulResolutions++
      }

      return result
    } catch (error) {
      if (config.enableMetrics) {
        totalResolutions++
        failedResolutions++
      }

      // Call error callback
      if (config.onErrorCallback) {
        config.onErrorCallback(error as Error, context)
      }

      // Handle error based on config
      if (config.onError === 'fallback' && config.fallbackStrategy) {
        return applyFallback(context, config.fallbackStrategy)
      }

      throw error
    }
  }

  const dispose = (): void => {
    if (config.onDispose) {
      config.onDispose()
    }
    disposed = true
  }

  const getStats = (): CustomResolutionStats => ({
    totalResolutions,
    successfulResolutions,
    failedResolutions,
  })

  return {
    name,
    resolve,
    dispose,
    getStats,
  }
}

/**
 * Apply a fallback strategy.
 */
function applyFallback<T>(
  context: ConflictContext<T>,
  fallbackStrategy?: 'server-wins' | 'client-wins' | 'last-write-wins'
): ConflictResolution<T> {
  switch (fallbackStrategy) {
    case 'server-wins':
      return { resolved: context.serverVersion }
    case 'client-wins':
      return { resolved: context.clientVersion }
    case 'last-write-wins':
    default:
      // Default to client if client timestamp is newer
      if (context.clientTimestamp > context.serverTimestamp) {
        return { resolved: context.clientVersion }
      }
      return { resolved: context.serverVersion }
  }
}

/**
 * Validate a resolution result.
 */
function validateResolutionResult<T>(
  result: ConflictResolution<T>,
  context: ConflictContext<T>
): void {
  if (!result.resolved) {
    throw new Error('Resolution must have a resolved property')
  }

  const resolved = result.resolved as Record<string, unknown>
  if (!resolved._id) {
    throw new Error('Resolved document must have an _id')
  }

  if (resolved._id !== context.key) {
    throw new Error('Resolved document _id must match context key')
  }
}

/**
 * Apply a custom resolution to a conflict context.
 *
 * @param context - The conflict context
 * @param resolver - The resolver function
 * @returns The resolution result
 */
export async function applyCustomResolution<T>(
  context: ConflictContext<T>,
  resolver: ConflictResolver<T>
): Promise<ConflictResolution<T>> {
  return Promise.resolve(resolver(context))
}

/**
 * Create a merge resolver that combines fields from server and client.
 *
 * @param config - Configuration for the merge resolver
 * @returns A resolver function
 */
export function createMergeResolver<T>(
  config?: MergeResolverConfig<T>
): ConflictResolver<T> {
  return (context: ConflictContext<T>): ConflictResolution<T> => {
    const { serverVersion, clientVersion, baseVersion } = context
    const serverFields = config?.serverFields ?? []
    const clientFields = config?.clientFields ?? []

    // Start with client version (default)
    let resolved = { ...clientVersion } as Record<string, unknown>

    // Apply server fields
    for (const field of serverFields) {
      resolved[field as string] = (serverVersion as Record<string, unknown>)[field as string]
    }

    // Three-way merge if base version is provided
    if (config?.useBaseVersion && baseVersion) {
      const base = baseVersion as Record<string, unknown>
      const server = serverVersion as Record<string, unknown>
      const client = clientVersion as Record<string, unknown>

      // Find fields that changed only on server
      for (const key of Object.keys(server)) {
        if (key === '_id') continue
        const baseVal = JSON.stringify(base[key])
        const serverVal = JSON.stringify(server[key])
        const clientVal = JSON.stringify(client[key])

        // Server changed, client didn't -> use server
        if (serverVal !== baseVal && clientVal === baseVal) {
          resolved[key] = server[key]
        }
        // Both changed -> use conflict resolver
        else if (serverVal !== baseVal && clientVal !== baseVal && serverVal !== clientVal) {
          resolved[key] = config.conflictFieldResolver === 'server' ? server[key] : client[key]
        }
      }
    }

    // Handle deep merge if configured
    if (config?.deepMerge) {
      // For now, just use shallow merge
      // Deep merge would recursively merge nested objects
    }

    return {
      resolved: resolved as T,
      resolutionMetadata: {
        strategy: 'merge',
        serverFields: serverFields.map(String),
        clientFields: clientFields.map(String),
        resolvedAt: new Date(),
      },
    }
  }
}

/**
 * Create a field priority resolver.
 *
 * @param config - Configuration for the field priority resolver
 * @returns A resolver function
 */
export function createFieldPriorityResolver<T>(
  config: FieldPriorityResolverConfig<T>
): ConflictResolver<T> {
  return (context: ConflictContext<T>): ConflictResolution<T> => {
    const { serverVersion, clientVersion } = context
    const server = serverVersion as Record<string, unknown>
    const client = clientVersion as Record<string, unknown>

    // Start with all fields from default priority
    const defaultPriority = config.defaultPriority ?? 'client'
    const base = defaultPriority === 'server' ? { ...server } : { ...client }

    // Apply rules
    for (const [field, rule] of Object.entries(config.rules)) {
      if (typeof rule === 'function') {
        base[field] = rule(server[field], client[field])
      } else if (rule === 'server') {
        base[field] = server[field]
      } else if (rule === 'client') {
        base[field] = client[field]
      } else if (rule === 'latest') {
        // Compare timestamps from the values if they are dates
        const serverVal = server[field]
        const clientVal = client[field]
        if (serverVal instanceof Date && clientVal instanceof Date) {
          base[field] = serverVal > clientVal ? serverVal : clientVal
        } else if (context.serverTimestamp > context.clientTimestamp) {
          base[field] = serverVal
        } else {
          base[field] = clientVal
        }
      }
    }

    return {
      resolved: base as T,
    }
  }
}

/**
 * Create a timestamp-based resolver.
 *
 * @param config - Configuration for the timestamp resolver
 * @returns A resolver function
 */
export function createTimestampResolver<T>(
  config?: TimestampResolverConfig<T>
): ConflictResolver<T> {
  return (context: ConflictContext<T>): ConflictResolution<T> => {
    let serverTs: Date
    let clientTs: Date

    if (config?.getTimestamp) {
      serverTs = config.getTimestamp(context.serverVersion)
      clientTs = config.getTimestamp(context.clientVersion)
    } else {
      serverTs = context.serverTimestamp
      clientTs = context.clientTimestamp
    }

    // Handle ties
    if (serverTs.getTime() === clientTs.getTime()) {
      const tieBreaker = config?.tieBreaker ?? 'client'
      return {
        resolved: tieBreaker === 'server' ? context.serverVersion : context.clientVersion,
      }
    }

    // Return the newer version
    if (clientTs > serverTs) {
      return { resolved: context.clientVersion }
    }
    return { resolved: context.serverVersion }
  }
}
