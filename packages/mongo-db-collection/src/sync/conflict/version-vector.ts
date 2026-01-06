/**
 * @file Version Vector Conflict Resolution Strategy
 *
 * Implements the Version Vector conflict resolution strategy for Layer 9
 * synchronization. Version vectors track the logical time at each node
 * in a distributed system and enable:
 * - Determining causal ordering of events
 * - Detecting concurrent modifications (true conflicts)
 * - Distinguishing causally-related changes from conflicts
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync/conflict/version-vector
 * @see https://en.wikipedia.org/wiki/Version_vector
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Version Vector - a map from node IDs to version numbers.
 * Each entry represents the latest known event count from that node.
 */
export type VersionVector = Record<string, number>

/**
 * Result of comparing two version vectors.
 * - 'before': First vector is causally before second (ancestor)
 * - 'after': First vector is causally after second (descendant)
 * - 'equal': Vectors represent the same logical time
 * - 'concurrent': Vectors are concurrent (neither is ancestor of other)
 */
export type VersionVectorComparison = 'before' | 'after' | 'equal' | 'concurrent'

/**
 * Tiebreaker strategies for concurrent conflicts.
 */
export type TieBreakerStrategy =
  | 'server-wins'
  | 'client-wins'
  | 'last-write-wins'
  | 'deterministic'

/**
 * Configuration for Version Vector strategy.
 */
export interface VersionVectorStrategyConfig<T = unknown> {
  /** Identifier for this node/client */
  nodeId?: string
  /** Tiebreaker strategy for concurrent modifications */
  tieBreaker?: TieBreakerStrategy
  /** Custom merge function for concurrent modifications */
  onConcurrent?: (
    serverVersion: T,
    clientVersion: T,
    context: VersionVectorMergeContext
  ) => T | Promise<T>
}

/**
 * Context passed to custom merge function.
 */
export interface VersionVectorMergeContext {
  /** Document key */
  key: string
  /** Server's version vector */
  serverVersionVector: VersionVector
  /** Client's version vector */
  clientVersionVector: VersionVector
  /** Merged version vector */
  mergedVersionVector?: VersionVector
}

/**
 * Conflict context for version vector strategy.
 */
export interface VersionVectorConflictContext<T> {
  /** Document key */
  key: string
  /** Server version of the document */
  serverVersion: T
  /** Client version of the document */
  clientVersion: T
  /** Server document timestamp */
  serverTimestamp: Date
  /** Client document timestamp */
  clientTimestamp: Date
  /** Server's version vector */
  serverVersionVector: VersionVector
  /** Client's version vector */
  clientVersionVector: VersionVector
}

/**
 * Result of version vector conflict resolution.
 */
export interface VersionVectorResolutionResult<T> {
  /** The resolved document */
  resolved: T
  /** Metadata about the resolution */
  resolutionMetadata?: {
    /** Strategy used */
    strategy: 'version-vector'
    /** Comparison result */
    comparison?: VersionVectorComparison
    /** Which tiebreaker was used (if any) */
    tieBreaker?: TieBreakerStrategy
    /** The merged version vector */
    mergedVersionVector?: VersionVector
    /** When the resolution occurred */
    resolvedAt?: Date
  }
}

/**
 * Result of direct version vector resolution.
 */
export interface DirectResolutionResult<T> {
  /** The resolved document */
  resolved: T
  /** The comparison result */
  comparison: VersionVectorComparison
  /** Merged version vector */
  mergedVersionVector?: VersionVector
}

/**
 * Options for direct version vector resolution.
 */
export interface ResolveWithVersionVectorOptions<T> {
  /** Document key */
  key: string
  /** Server version of the document */
  serverVersion: T
  /** Client version of the document */
  clientVersion: T
  /** Server's version vector */
  serverVersionVector: VersionVector
  /** Client's version vector */
  clientVersionVector: VersionVector
  /** Tiebreaker strategy for concurrent modifications */
  tieBreaker?: TieBreakerStrategy
}

// =============================================================================
// Version Vector Core Functions
// =============================================================================

/**
 * Create a new version vector.
 *
 * @param nodeIdOrExisting - Optional node ID to initialize with, or existing vector to copy
 * @param initialValue - Optional initial value for the node (defaults to 0)
 * @returns A new version vector
 *
 * @example
 * ```ts
 * const empty = createVersionVector()
 * const withNode = createVersionVector('node-1')
 * const withValue = createVersionVector('node-1', 5)
 * const copy = createVersionVector({ 'node-1': 3, 'node-2': 5 })
 * ```
 */
export function createVersionVector(
  nodeIdOrExisting?: string | VersionVector,
  initialValue?: number
): VersionVector {
  // No arguments - return empty vector
  if (nodeIdOrExisting === undefined) {
    return {}
  }

  // Copy existing vector
  if (typeof nodeIdOrExisting === 'object') {
    const result: VersionVector = {}
    for (const [key, value] of Object.entries(nodeIdOrExisting)) {
      // Coerce string values to numbers (for deserialization)
      result[key] = typeof value === 'string' ? Number(value) : value
    }
    return result
  }

  // Create with initial node
  return { [nodeIdOrExisting]: initialValue ?? 0 }
}

/**
 * Increment the version for a specific node.
 *
 * @param vector - The version vector to update
 * @param nodeId - The node ID to increment
 * @param amount - Amount to increment by (defaults to 1)
 * @returns A new version vector with the incremented value
 *
 * @example
 * ```ts
 * const vv = { 'node-1': 3 }
 * const updated = incrementVersion(vv, 'node-1') // { 'node-1': 4 }
 * const newNode = incrementVersion(vv, 'node-2') // { 'node-1': 3, 'node-2': 1 }
 * ```
 */
export function incrementVersion(
  vector: VersionVector,
  nodeId: string,
  amount: number = 1
): VersionVector {
  const result = { ...vector }
  const currentValue = result[nodeId] ?? 0
  result[nodeId] = currentValue + amount
  return result
}

/**
 * Merge multiple version vectors by taking the maximum version for each node.
 *
 * @param vectors - Version vectors to merge
 * @returns A new version vector with the maximum versions
 *
 * @example
 * ```ts
 * const vv1 = { 'node-1': 3, 'node-2': 1 }
 * const vv2 = { 'node-1': 1, 'node-2': 4 }
 * const merged = mergeVersionVectors(vv1, vv2)
 * // { 'node-1': 3, 'node-2': 4 }
 * ```
 */
export function mergeVersionVectors(...vectors: VersionVector[]): VersionVector {
  const result: VersionVector = {}

  for (const vector of vectors) {
    for (const [nodeId, version] of Object.entries(vector)) {
      const currentMax = result[nodeId] ?? 0
      result[nodeId] = Math.max(currentMax, version)
    }
  }

  return result
}

/**
 * Compare two version vectors to determine their causal relationship.
 *
 * A version vector vv1 is "before" vv2 if for all nodes n:
 *   vv1[n] <= vv2[n] AND there exists at least one node where vv1[n] < vv2[n]
 *
 * @param vv1 - First version vector
 * @param vv2 - Second version vector
 * @returns The comparison result
 *
 * @example
 * ```ts
 * compareVersionVectors({ node: 2 }, { node: 5 }) // 'before'
 * compareVersionVectors({ node: 5 }, { node: 2 }) // 'after'
 * compareVersionVectors({ node: 3 }, { node: 3 }) // 'equal'
 * compareVersionVectors({ a: 3, b: 1 }, { a: 1, b: 3 }) // 'concurrent'
 * ```
 */
export function compareVersionVectors(
  vv1: VersionVector,
  vv2: VersionVector
): VersionVectorComparison {
  // Collect all node IDs from both vectors
  const allNodeIds = new Set([...Object.keys(vv1), ...Object.keys(vv2)])

  let vv1HasGreater = false // vv1 has at least one component > vv2
  let vv2HasGreater = false // vv2 has at least one component > vv1

  for (const nodeId of allNodeIds) {
    const v1 = vv1[nodeId] ?? 0
    const v2 = vv2[nodeId] ?? 0

    if (v1 > v2) {
      vv1HasGreater = true
    }
    if (v2 > v1) {
      vv2HasGreater = true
    }
  }

  // Neither has any greater component - they are equal
  if (!vv1HasGreater && !vv2HasGreater) {
    return 'equal'
  }

  // Only vv2 has greater components - vv1 is before vv2
  if (!vv1HasGreater && vv2HasGreater) {
    return 'before'
  }

  // Only vv1 has greater components - vv1 is after vv2
  if (vv1HasGreater && !vv2HasGreater) {
    return 'after'
  }

  // Both have greater components - concurrent
  return 'concurrent'
}

// =============================================================================
// Causality Helper Functions
// =============================================================================

/**
 * Check if the first version vector is a causal ancestor of the second.
 *
 * @param potentialAncestor - The potential ancestor version vector
 * @param potentialDescendant - The potential descendant version vector
 * @returns True if potentialAncestor is strictly before potentialDescendant
 *
 * @example
 * ```ts
 * isAncestor({ node: 2 }, { node: 5 }) // true
 * isAncestor({ node: 5 }, { node: 2 }) // false
 * isAncestor({ node: 3 }, { node: 3 }) // false (equal, not strictly before)
 * ```
 */
export function isAncestor(
  potentialAncestor: VersionVector,
  potentialDescendant: VersionVector
): boolean {
  return compareVersionVectors(potentialAncestor, potentialDescendant) === 'before'
}

/**
 * Check if two version vectors are concurrent (neither is ancestor of other).
 *
 * @param vv1 - First version vector
 * @param vv2 - Second version vector
 * @returns True if the vectors are concurrent
 *
 * @example
 * ```ts
 * isConcurrent({ a: 3, b: 1 }, { a: 1, b: 3 }) // true
 * isConcurrent({ node: 2 }, { node: 5 }) // false
 * ```
 */
export function isConcurrent(vv1: VersionVector, vv2: VersionVector): boolean {
  return compareVersionVectors(vv1, vv2) === 'concurrent'
}

// =============================================================================
// Strategy Factory
// =============================================================================

/**
 * Create a version vector conflict resolution strategy.
 *
 * @param config - Configuration options
 * @returns A conflict resolver function
 *
 * @example
 * ```ts
 * const strategy = createVersionVectorStrategy({
 *   nodeId: 'client-1',
 *   tieBreaker: 'server-wins',
 * })
 *
 * const result = strategy(context)
 * ```
 */
export function createVersionVectorStrategy<T = unknown>(
  config?: VersionVectorStrategyConfig<T>
): (
  context: VersionVectorConflictContext<T>
) => VersionVectorResolutionResult<T> | Promise<VersionVectorResolutionResult<T>> {
  const { tieBreaker = 'server-wins', onConcurrent } = config ?? {}

  return (
    context: VersionVectorConflictContext<T>
  ): VersionVectorResolutionResult<T> | Promise<VersionVectorResolutionResult<T>> => {
    const {
      serverVersion,
      clientVersion,
      serverVersionVector,
      clientVersionVector,
      serverTimestamp,
      clientTimestamp,
      key,
    } = context

    // Handle missing version vectors - fall back to timestamp comparison
    const serverVV = serverVersionVector ?? {}
    const clientVV = clientVersionVector ?? {}

    // Compare version vectors
    const comparison = compareVersionVectors(serverVV, clientVV)

    // Merge version vectors for result
    const mergedVersionVector = mergeVersionVectors(serverVV, clientVV)

    const resolvedAt = new Date()

    // Server is causally after client - server wins
    if (comparison === 'after') {
      return {
        resolved: serverVersion,
        resolutionMetadata: {
          strategy: 'version-vector',
          comparison,
          mergedVersionVector,
          resolvedAt,
        },
      }
    }

    // Client is causally after server - client wins
    if (comparison === 'before') {
      return {
        resolved: clientVersion,
        resolutionMetadata: {
          strategy: 'version-vector',
          comparison,
          mergedVersionVector,
          resolvedAt,
        },
      }
    }

    // Equal - return either (prefer server for consistency)
    if (comparison === 'equal') {
      return {
        resolved: serverVersion,
        resolutionMetadata: {
          strategy: 'version-vector',
          comparison,
          mergedVersionVector,
          resolvedAt,
        },
      }
    }

    // Concurrent - use custom merge or tiebreaker
    if (onConcurrent) {
      const mergeContext: VersionVectorMergeContext = {
        key,
        serverVersionVector: serverVV,
        clientVersionVector: clientVV,
        mergedVersionVector,
      }

      const mergeResult = onConcurrent(serverVersion, clientVersion, mergeContext)

      // Handle async merge function
      if (mergeResult instanceof Promise) {
        return mergeResult.then((resolved) => ({
          resolved,
          resolutionMetadata: {
            strategy: 'version-vector' as const,
            comparison,
            mergedVersionVector,
            resolvedAt,
          },
        }))
      }

      return {
        resolved: mergeResult,
        resolutionMetadata: {
          strategy: 'version-vector',
          comparison,
          mergedVersionVector,
          resolvedAt,
        },
      }
    }

    // Use tiebreaker strategy
    let resolved: T

    switch (tieBreaker) {
      case 'client-wins':
        resolved = clientVersion
        break

      case 'last-write-wins':
        resolved =
          clientTimestamp.getTime() >= serverTimestamp.getTime()
            ? clientVersion
            : serverVersion
        break

      case 'deterministic': {
        // Use deterministic ordering based on node IDs
        const serverNodes = Object.keys(serverVV).sort()
        const clientNodes = Object.keys(clientVV).sort()
        const firstServerNode = serverNodes[0] ?? ''
        const firstClientNode = clientNodes[0] ?? ''

        // Alphabetically earlier node wins
        resolved = firstServerNode <= firstClientNode ? serverVersion : clientVersion
        break
      }

      case 'server-wins':
      default:
        resolved = serverVersion
        break
    }

    return {
      resolved,
      resolutionMetadata: {
        strategy: 'version-vector',
        comparison,
        tieBreaker,
        mergedVersionVector,
        resolvedAt,
      },
    }
  }
}

// =============================================================================
// Direct Resolution Function
// =============================================================================

/**
 * Resolve a conflict directly using version vectors.
 *
 * @param options - Resolution options
 * @returns Resolution result
 *
 * @example
 * ```ts
 * const result = resolveWithVersionVector({
 *   key: 'doc-1',
 *   serverVersion: serverDoc,
 *   clientVersion: clientDoc,
 *   serverVersionVector: { 'server-1': 5 },
 *   clientVersionVector: { 'client-1': 3 },
 * })
 * ```
 */
export function resolveWithVersionVector<T>(
  options: ResolveWithVersionVectorOptions<T>
): DirectResolutionResult<T> {
  const {
    serverVersion,
    clientVersion,
    serverVersionVector,
    clientVersionVector,
    tieBreaker = 'server-wins',
  } = options

  const comparison = compareVersionVectors(serverVersionVector, clientVersionVector)
  const mergedVersionVector = mergeVersionVectors(
    serverVersionVector,
    clientVersionVector
  )

  let resolved: T

  switch (comparison) {
    case 'after':
      // Server is causally after client
      resolved = serverVersion
      break

    case 'before':
      // Client is causally after server
      resolved = clientVersion
      break

    case 'equal':
      // Equal - return server for consistency
      resolved = serverVersion
      break

    case 'concurrent':
      // Use tiebreaker
      resolved = tieBreaker === 'client-wins' ? clientVersion : serverVersion
      break

    default:
      resolved = serverVersion
  }

  return {
    resolved,
    comparison,
    mergedVersionVector,
  }
}
