/**
 * @file Server-Wins Conflict Resolution Strategy (RED Phase - Stub Implementation)
 *
 * This strategy always resolves conflicts by accepting the server's version,
 * discarding any client-side changes when a conflict is detected.
 *
 * Layer 9 Conflict Resolution - Server-Wins Strategy
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/conflict/server-wins
 */

import type { ConflictContext, ConflictResolution } from '../../types/index.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the server-wins resolver.
 */
export interface ServerWinsResolverConfig<T> {
  /** Whether to include resolution metadata */
  includeMetadata?: boolean
  /** Callback when a conflict is resolved */
  onResolve?: (context: ConflictContext<T>) => void
  /** Fields from client to preserve even when server wins */
  preserveClientFields?: Array<keyof T>
}

/**
 * Result from the server-wins resolver.
 */
export interface ServerWinsResolverResult<T> extends ConflictResolution<T> {
  /** The resolved document (server version) */
  readonly resolved: T
  /** Optional resolution metadata */
  readonly resolutionMetadata?: {
    /** Strategy used */
    strategy: 'server-wins'
    /** When the resolution occurred */
    resolvedAt?: Date
    /** Fields that came from server */
    serverFields?: string[]
    /** Fields that came from client */
    clientFields?: string[]
    /** Custom metadata */
    [key: string]: unknown
  }
}

/**
 * Server-wins resolver function type.
 */
export type ServerWinsResolver<T> = (context: ConflictContext<T>) => ServerWinsResolverResult<T>

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Create a server-wins conflict resolver.
 *
 * @param config - Optional configuration for the resolver
 * @returns A resolver function
 */
export function createServerWinsResolver<T>(
  config?: ServerWinsResolverConfig<T>
): ServerWinsResolver<T> {
  return (context: ConflictContext<T>): ServerWinsResolverResult<T> => {
    const { serverVersion, clientVersion } = context

    // Call onResolve callback if provided
    if (config?.onResolve) {
      config.onResolve(context)
    }

    // Create a shallow copy of server version
    let resolved = { ...serverVersion } as T

    // Preserve specified client fields if configured
    if (config?.preserveClientFields && config.preserveClientFields.length > 0) {
      for (const field of config.preserveClientFields) {
        if (field in clientVersion) {
          ;(resolved as Record<string, unknown>)[field as string] = (
            clientVersion as Record<string, unknown>
          )[field as string]
        }
      }
    }

    // Build result
    const result: ServerWinsResolverResult<T> = {
      resolved,
    }

    // Add metadata if configured
    if (config?.includeMetadata) {
      const serverFields = Object.keys(serverVersion as object).filter(
        (key) =>
          !config?.preserveClientFields?.includes(key as keyof T)
      )
      const clientFields = config?.preserveClientFields?.map(String) ?? []

      result.resolutionMetadata = {
        strategy: 'server-wins',
        resolvedAt: new Date(),
        serverFields,
        clientFields,
      }
    }

    return result
  }
}

/**
 * Pre-configured server-wins resolver with default settings.
 */
export const serverWinsResolver = <T>(context: ConflictContext<T>): ServerWinsResolverResult<T> => {
  return {
    resolved: { ...context.serverVersion } as T,
  }
}

/**
 * Direct function to resolve using server-wins strategy.
 *
 * @param serverVersion - The server version of the document
 * @param clientVersion - The client version of the document
 * @returns The resolved document (a shallow copy of server version)
 */
export function resolveServerWins<T>(serverVersion: T, clientVersion: T): T {
  // Return a shallow copy of the server version
  return { ...serverVersion } as T
}
