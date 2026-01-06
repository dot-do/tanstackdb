/**
 * @file Version Vector Strategy Tests (RED Phase - TDD)
 *
 * These tests verify the Version Vector conflict resolution strategy
 * that uses vector clocks to determine causality and resolve conflicts.
 *
 * Version vectors track the logical time at each node (client) in a
 * distributed system. They enable:
 * - Determining causal ordering of events
 * - Detecting concurrent modifications (true conflicts)
 * - Distinguishing causally-related changes from conflicts
 *
 * RED PHASE: These tests will fail until the Version Vector Strategy
 * is implemented in src/sync/conflict/version-vector.ts
 *
 * @see https://en.wikipedia.org/wiki/Version_vector
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createVersionVector,
  incrementVersion,
  mergeVersionVectors,
  compareVersionVectors,
  isAncestor,
  isConcurrent,
  createVersionVectorStrategy,
  resolveWithVersionVector,
  type VersionVector,
  type VersionVectorComparison,
  type VersionVectorConflictContext,
  type VersionVectorStrategyConfig,
} from '../../../src/sync/conflict/version-vector'

// =============================================================================
// Test Document Types
// =============================================================================

/**
 * Basic document type for testing version vector operations.
 */
interface TestDocument {
  _id: string
  name: string
  value: number
  updatedAt: Date
}

/**
 * Document with nested data for complex merge testing.
 */
interface NestedDocument {
  _id: string
  user: {
    profile: {
      firstName: string
      lastName: string
    }
    settings: {
      theme: 'light' | 'dark'
      notifications: boolean
    }
  }
  version: VersionVector
}

// =============================================================================
// Version Vector Creation Tests
// =============================================================================

describe('createVersionVector', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createVersionVector).toBe('function')
    })

    it('should create an empty version vector', () => {
      const vv = createVersionVector()

      expect(vv).toBeDefined()
      expect(typeof vv).toBe('object')
      expect(Object.keys(vv).length).toBe(0)
    })

    it('should create a version vector with initial node', () => {
      const vv = createVersionVector('node-1')

      expect(vv).toHaveProperty('node-1')
      expect(vv['node-1']).toBe(0)
    })

    it('should create a version vector with initial node and value', () => {
      const vv = createVersionVector('node-1', 5)

      expect(vv['node-1']).toBe(5)
    })

    it('should create from existing vector', () => {
      const existing: VersionVector = { 'node-1': 3, 'node-2': 5 }
      const vv = createVersionVector(existing)

      expect(vv).toEqual(existing)
      expect(vv).not.toBe(existing) // Should be a copy
    })

    it('should handle multiple nodes in initial state', () => {
      const vv = createVersionVector({ 'node-a': 1, 'node-b': 2, 'node-c': 3 })

      expect(vv['node-a']).toBe(1)
      expect(vv['node-b']).toBe(2)
      expect(vv['node-c']).toBe(3)
    })
  })
})

// =============================================================================
// Version Vector Increment Tests
// =============================================================================

describe('incrementVersion', () => {
  it('should be a function', () => {
    expect(typeof incrementVersion).toBe('function')
  })

  it('should increment version for existing node', () => {
    const vv: VersionVector = { 'node-1': 3, 'node-2': 5 }
    const result = incrementVersion(vv, 'node-1')

    expect(result['node-1']).toBe(4)
    expect(result['node-2']).toBe(5)
  })

  it('should add and initialize new node', () => {
    const vv: VersionVector = { 'node-1': 3 }
    const result = incrementVersion(vv, 'node-2')

    expect(result['node-1']).toBe(3)
    expect(result['node-2']).toBe(1)
  })

  it('should not mutate original vector', () => {
    const original: VersionVector = { 'node-1': 3 }
    const result = incrementVersion(original, 'node-1')

    expect(original['node-1']).toBe(3)
    expect(result['node-1']).toBe(4)
    expect(result).not.toBe(original)
  })

  it('should handle empty vector', () => {
    const vv: VersionVector = {}
    const result = incrementVersion(vv, 'node-1')

    expect(result['node-1']).toBe(1)
  })

  it('should handle increment by custom amount', () => {
    const vv: VersionVector = { 'node-1': 5 }
    const result = incrementVersion(vv, 'node-1', 3)

    expect(result['node-1']).toBe(8)
  })
})

// =============================================================================
// Version Vector Merge Tests
// =============================================================================

describe('mergeVersionVectors', () => {
  it('should be a function', () => {
    expect(typeof mergeVersionVectors).toBe('function')
  })

  it('should merge two non-overlapping vectors', () => {
    const vv1: VersionVector = { 'node-1': 3 }
    const vv2: VersionVector = { 'node-2': 5 }
    const result = mergeVersionVectors(vv1, vv2)

    expect(result['node-1']).toBe(3)
    expect(result['node-2']).toBe(5)
  })

  it('should take maximum for overlapping nodes', () => {
    const vv1: VersionVector = { 'node-1': 3, 'node-2': 7 }
    const vv2: VersionVector = { 'node-1': 5, 'node-2': 2 }
    const result = mergeVersionVectors(vv1, vv2)

    expect(result['node-1']).toBe(5)
    expect(result['node-2']).toBe(7)
  })

  it('should handle empty first vector', () => {
    const vv1: VersionVector = {}
    const vv2: VersionVector = { 'node-1': 3, 'node-2': 5 }
    const result = mergeVersionVectors(vv1, vv2)

    expect(result).toEqual(vv2)
  })

  it('should handle empty second vector', () => {
    const vv1: VersionVector = { 'node-1': 3, 'node-2': 5 }
    const vv2: VersionVector = {}
    const result = mergeVersionVectors(vv1, vv2)

    expect(result).toEqual(vv1)
  })

  it('should handle both empty vectors', () => {
    const result = mergeVersionVectors({}, {})
    expect(result).toEqual({})
  })

  it('should not mutate original vectors', () => {
    const vv1: VersionVector = { 'node-1': 3 }
    const vv2: VersionVector = { 'node-1': 5 }
    const result = mergeVersionVectors(vv1, vv2)

    expect(vv1['node-1']).toBe(3)
    expect(vv2['node-1']).toBe(5)
    expect(result['node-1']).toBe(5)
  })

  it('should merge multiple vectors', () => {
    const vv1: VersionVector = { 'node-1': 1 }
    const vv2: VersionVector = { 'node-2': 2 }
    const vv3: VersionVector = { 'node-1': 3, 'node-3': 4 }
    const result = mergeVersionVectors(vv1, vv2, vv3)

    expect(result['node-1']).toBe(3)
    expect(result['node-2']).toBe(2)
    expect(result['node-3']).toBe(4)
  })
})

// =============================================================================
// Version Vector Comparison Tests
// =============================================================================

describe('compareVersionVectors', () => {
  it('should be a function', () => {
    expect(typeof compareVersionVectors).toBe('function')
  })

  it('should return EQUAL for identical vectors', () => {
    const vv1: VersionVector = { 'node-1': 3, 'node-2': 5 }
    const vv2: VersionVector = { 'node-1': 3, 'node-2': 5 }
    const result = compareVersionVectors(vv1, vv2)

    expect(result).toBe('equal')
  })

  it('should return BEFORE when first is ancestor', () => {
    const vv1: VersionVector = { 'node-1': 2 }
    const vv2: VersionVector = { 'node-1': 5 }
    const result = compareVersionVectors(vv1, vv2)

    expect(result).toBe('before')
  })

  it('should return AFTER when first is descendant', () => {
    const vv1: VersionVector = { 'node-1': 5 }
    const vv2: VersionVector = { 'node-1': 2 }
    const result = compareVersionVectors(vv1, vv2)

    expect(result).toBe('after')
  })

  it('should return CONCURRENT for concurrent vectors', () => {
    const vv1: VersionVector = { 'node-1': 3, 'node-2': 2 }
    const vv2: VersionVector = { 'node-1': 2, 'node-2': 4 }
    const result = compareVersionVectors(vv1, vv2)

    expect(result).toBe('concurrent')
  })

  it('should handle vectors with different node sets', () => {
    const vv1: VersionVector = { 'node-1': 3 }
    const vv2: VersionVector = { 'node-2': 5 }
    const result = compareVersionVectors(vv1, vv2)

    // Both have nodes the other doesn't know - concurrent
    expect(result).toBe('concurrent')
  })

  it('should return BEFORE when first has subset of nodes', () => {
    const vv1: VersionVector = { 'node-1': 3 }
    const vv2: VersionVector = { 'node-1': 3, 'node-2': 5 }
    const result = compareVersionVectors(vv1, vv2)

    expect(result).toBe('before')
  })

  it('should return AFTER when second has subset of nodes', () => {
    const vv1: VersionVector = { 'node-1': 3, 'node-2': 5 }
    const vv2: VersionVector = { 'node-1': 3 }
    const result = compareVersionVectors(vv1, vv2)

    expect(result).toBe('after')
  })

  it('should handle empty vectors', () => {
    expect(compareVersionVectors({}, {})).toBe('equal')
    expect(compareVersionVectors({}, { 'node-1': 1 })).toBe('before')
    expect(compareVersionVectors({ 'node-1': 1 }, {})).toBe('after')
  })
})

// =============================================================================
// Causality Helper Tests
// =============================================================================

describe('isAncestor', () => {
  it('should be a function', () => {
    expect(typeof isAncestor).toBe('function')
  })

  it('should return true when first is ancestor of second', () => {
    const ancestor: VersionVector = { 'node-1': 2 }
    const descendant: VersionVector = { 'node-1': 5 }

    expect(isAncestor(ancestor, descendant)).toBe(true)
  })

  it('should return false when first is not ancestor', () => {
    const vv1: VersionVector = { 'node-1': 5 }
    const vv2: VersionVector = { 'node-1': 2 }

    expect(isAncestor(vv1, vv2)).toBe(false)
  })

  it('should return false for concurrent vectors', () => {
    const vv1: VersionVector = { 'node-1': 3, 'node-2': 2 }
    const vv2: VersionVector = { 'node-1': 2, 'node-2': 4 }

    expect(isAncestor(vv1, vv2)).toBe(false)
    expect(isAncestor(vv2, vv1)).toBe(false)
  })

  it('should return false for equal vectors', () => {
    const vv1: VersionVector = { 'node-1': 3 }
    const vv2: VersionVector = { 'node-1': 3 }

    expect(isAncestor(vv1, vv2)).toBe(false)
  })
})

describe('isConcurrent', () => {
  it('should be a function', () => {
    expect(typeof isConcurrent).toBe('function')
  })

  it('should return true for concurrent vectors', () => {
    const vv1: VersionVector = { 'node-1': 3, 'node-2': 2 }
    const vv2: VersionVector = { 'node-1': 2, 'node-2': 4 }

    expect(isConcurrent(vv1, vv2)).toBe(true)
  })

  it('should return false for causally related vectors', () => {
    const vv1: VersionVector = { 'node-1': 2 }
    const vv2: VersionVector = { 'node-1': 5 }

    expect(isConcurrent(vv1, vv2)).toBe(false)
  })

  it('should return false for equal vectors', () => {
    const vv1: VersionVector = { 'node-1': 3, 'node-2': 5 }
    const vv2: VersionVector = { 'node-1': 3, 'node-2': 5 }

    expect(isConcurrent(vv1, vv2)).toBe(false)
  })

  it('should detect concurrent modifications from different nodes', () => {
    // Node 1 made a change (doesn't know about node 2)
    const vv1: VersionVector = { 'node-1': 5 }
    // Node 2 made a change (doesn't know about node 1)
    const vv2: VersionVector = { 'node-2': 3 }

    expect(isConcurrent(vv1, vv2)).toBe(true)
  })
})

// =============================================================================
// Version Vector Strategy Tests
// =============================================================================

describe('createVersionVectorStrategy', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createVersionVectorStrategy).toBe('function')
    })

    it('should return a conflict resolver function', () => {
      const strategy = createVersionVectorStrategy()

      expect(typeof strategy).toBe('function')
    })

    it('should accept optional configuration', () => {
      const config: VersionVectorStrategyConfig = {
        nodeId: 'client-1',
        tieBreaker: 'server-wins',
      }
      const strategy = createVersionVectorStrategy(config)

      expect(typeof strategy).toBe('function')
    })
  })

  describe('conflict resolution', () => {
    let strategy: ReturnType<typeof createVersionVectorStrategy>

    beforeEach(() => {
      strategy = createVersionVectorStrategy({ nodeId: 'client-1' })
    })

    it('should resolve in favor of later version when causally related', () => {
      const context: VersionVectorConflictContext<TestDocument> = {
        key: 'doc-1',
        serverVersion: {
          _id: 'doc-1',
          name: 'Server Update',
          value: 200,
          updatedAt: new Date('2024-01-02'),
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client Update',
          value: 100,
          updatedAt: new Date('2024-01-01'),
        },
        serverTimestamp: new Date('2024-01-02'),
        clientTimestamp: new Date('2024-01-01'),
        serverVersionVector: { 'server-1': 5, 'client-1': 2 },
        clientVersionVector: { 'client-1': 2 },
      }

      const result = strategy(context)

      // Server version is causally after client - server should win
      expect(result.resolved.name).toBe('Server Update')
      expect(result.resolved.value).toBe(200)
    })

    it('should use tie breaker for concurrent modifications', () => {
      const serverWinsStrategy = createVersionVectorStrategy({
        nodeId: 'client-1',
        tieBreaker: 'server-wins',
      })

      const context: VersionVectorConflictContext<TestDocument> = {
        key: 'doc-1',
        serverVersion: {
          _id: 'doc-1',
          name: 'Server',
          value: 200,
          updatedAt: new Date('2024-01-01'),
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client',
          value: 100,
          updatedAt: new Date('2024-01-01'),
        },
        serverTimestamp: new Date('2024-01-01'),
        clientTimestamp: new Date('2024-01-01'),
        serverVersionVector: { 'server-1': 3 },
        clientVersionVector: { 'client-1': 4 },
      }

      const result = serverWinsStrategy(context)

      expect(result.resolved.name).toBe('Server')
      expect(result.resolutionMetadata?.strategy).toBe('version-vector')
      expect(result.resolutionMetadata?.comparison).toBe('concurrent')
      expect(result.resolutionMetadata?.tieBreaker).toBe('server-wins')
    })

    it('should use client-wins tie breaker when configured', () => {
      const clientWinsStrategy = createVersionVectorStrategy({
        nodeId: 'client-1',
        tieBreaker: 'client-wins',
      })

      const context: VersionVectorConflictContext<TestDocument> = {
        key: 'doc-1',
        serverVersion: {
          _id: 'doc-1',
          name: 'Server',
          value: 200,
          updatedAt: new Date('2024-01-01'),
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client',
          value: 100,
          updatedAt: new Date('2024-01-01'),
        },
        serverTimestamp: new Date('2024-01-01'),
        clientTimestamp: new Date('2024-01-01'),
        serverVersionVector: { 'server-1': 3 },
        clientVersionVector: { 'client-1': 4 },
      }

      const result = clientWinsStrategy(context)

      expect(result.resolved.name).toBe('Client')
    })

    it('should use last-write-wins tie breaker when configured', () => {
      const lwwStrategy = createVersionVectorStrategy({
        nodeId: 'client-1',
        tieBreaker: 'last-write-wins',
      })

      const context: VersionVectorConflictContext<TestDocument> = {
        key: 'doc-1',
        serverVersion: {
          _id: 'doc-1',
          name: 'Server',
          value: 200,
          updatedAt: new Date('2024-01-02'), // Later timestamp
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client',
          value: 100,
          updatedAt: new Date('2024-01-01'),
        },
        serverTimestamp: new Date('2024-01-02'),
        clientTimestamp: new Date('2024-01-01'),
        serverVersionVector: { 'server-1': 3 },
        clientVersionVector: { 'client-1': 4 },
      }

      const result = lwwStrategy(context)

      expect(result.resolved.name).toBe('Server') // Server has later timestamp
    })

    it('should include merged version vector in result', () => {
      const context: VersionVectorConflictContext<TestDocument> = {
        key: 'doc-1',
        serverVersion: {
          _id: 'doc-1',
          name: 'Server',
          value: 200,
          updatedAt: new Date(),
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client',
          value: 100,
          updatedAt: new Date(),
        },
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        serverVersionVector: { 'server-1': 3 },
        clientVersionVector: { 'client-1': 4 },
      }

      const result = strategy(context)

      expect(result.resolutionMetadata?.mergedVersionVector).toBeDefined()
      expect(result.resolutionMetadata?.mergedVersionVector['server-1']).toBe(3)
      expect(result.resolutionMetadata?.mergedVersionVector['client-1']).toBe(4)
    })
  })

  describe('custom merge function', () => {
    it('should use custom merge function when provided', () => {
      const customMerge = vi.fn().mockImplementation((server, client) => ({
        ...server,
        ...client,
        value: server.value + client.value,
      }))

      const strategy = createVersionVectorStrategy({
        nodeId: 'client-1',
        onConcurrent: customMerge,
      })

      const context: VersionVectorConflictContext<TestDocument> = {
        key: 'doc-1',
        serverVersion: {
          _id: 'doc-1',
          name: 'Server',
          value: 200,
          updatedAt: new Date(),
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client',
          value: 100,
          updatedAt: new Date(),
        },
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        serverVersionVector: { 'server-1': 3 },
        clientVersionVector: { 'client-1': 4 },
      }

      const result = strategy(context)

      expect(customMerge).toHaveBeenCalledWith(
        context.serverVersion,
        context.clientVersion,
        expect.any(Object)
      )
      expect(result.resolved.value).toBe(300) // Merged values
    })
  })
})

// =============================================================================
// Direct Resolution Function Tests
// =============================================================================

describe('resolveWithVersionVector', () => {
  it('should be a function', () => {
    expect(typeof resolveWithVersionVector).toBe('function')
  })

  it('should resolve when server is causally after', () => {
    const result = resolveWithVersionVector<TestDocument>({
      key: 'doc-1',
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        value: 200,
        updatedAt: new Date(),
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        value: 100,
        updatedAt: new Date(),
      },
      serverVersionVector: { 'server-1': 5, 'client-1': 3 },
      clientVersionVector: { 'client-1': 3 },
    })

    expect(result.resolved.name).toBe('Server')
    expect(result.comparison).toBe('after')
  })

  it('should resolve when client is causally after', () => {
    const result = resolveWithVersionVector<TestDocument>({
      key: 'doc-1',
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        value: 200,
        updatedAt: new Date(),
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        value: 100,
        updatedAt: new Date(),
      },
      serverVersionVector: { 'server-1': 3 },
      clientVersionVector: { 'server-1': 3, 'client-1': 5 },
    })

    expect(result.resolved.name).toBe('Client')
    expect(result.comparison).toBe('before')
  })

  it('should handle identical versions', () => {
    const doc: TestDocument = {
      _id: 'doc-1',
      name: 'Same',
      value: 100,
      updatedAt: new Date(),
    }
    const vv: VersionVector = { 'node-1': 3 }

    const result = resolveWithVersionVector<TestDocument>({
      key: 'doc-1',
      serverVersion: doc,
      clientVersion: doc,
      serverVersionVector: vv,
      clientVersionVector: vv,
    })

    expect(result.comparison).toBe('equal')
    expect(result.resolved).toEqual(doc)
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('edge cases', () => {
  describe('version vector validation', () => {
    it('should handle negative version numbers gracefully', () => {
      // Version numbers should never be negative, but the implementation
      // should handle this case gracefully
      const vv1: VersionVector = { 'node-1': -1 }
      const vv2: VersionVector = { 'node-1': 1 }

      // Should still be able to compare
      const result = compareVersionVectors(vv1, vv2)
      expect(result).toBe('before')
    })

    it('should handle very large version numbers', () => {
      const vv1: VersionVector = { 'node-1': Number.MAX_SAFE_INTEGER - 1 }
      const vv2: VersionVector = { 'node-1': Number.MAX_SAFE_INTEGER }

      const result = compareVersionVectors(vv1, vv2)
      expect(result).toBe('before')
    })

    it('should handle many nodes', () => {
      const vv1: VersionVector = {}
      const vv2: VersionVector = {}

      // Create vectors with 100 nodes
      for (let i = 0; i < 100; i++) {
        vv1[`node-${i}`] = i
        vv2[`node-${i}`] = i + 1
      }

      const result = compareVersionVectors(vv1, vv2)
      expect(result).toBe('before')
    })
  })

  describe('strategy edge cases', () => {
    it('should handle missing version vectors gracefully', () => {
      const strategy = createVersionVectorStrategy({ nodeId: 'client-1' })

      const context: VersionVectorConflictContext<TestDocument> = {
        key: 'doc-1',
        serverVersion: {
          _id: 'doc-1',
          name: 'Server',
          value: 200,
          updatedAt: new Date('2024-01-02'),
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client',
          value: 100,
          updatedAt: new Date('2024-01-01'),
        },
        serverTimestamp: new Date('2024-01-02'),
        clientTimestamp: new Date('2024-01-01'),
        // Missing version vectors - should fall back to timestamp
        serverVersionVector: undefined as any,
        clientVersionVector: undefined as any,
      }

      // Should not throw, fall back to timestamp-based resolution
      const result = strategy(context)
      expect(result.resolved).toBeDefined()
    })

    it('should handle null values in documents', () => {
      const strategy = createVersionVectorStrategy({ nodeId: 'client-1' })

      interface DocWithNulls {
        _id: string
        name: string | null
        value: number | null
      }

      const context: VersionVectorConflictContext<DocWithNulls> = {
        key: 'doc-1',
        serverVersion: { _id: 'doc-1', name: null, value: 200 },
        clientVersion: { _id: 'doc-1', name: 'Client', value: null },
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        serverVersionVector: { 'server-1': 3 },
        clientVersionVector: { 'client-1': 4 },
      }

      const result = strategy(context as any)
      expect(result.resolved).toBeDefined()
    })
  })
})

// =============================================================================
// Integration with TanStack DB Conflict Types
// =============================================================================

describe('TanStack DB integration', () => {
  it('should produce resolution compatible with ConflictResolution type', () => {
    const strategy = createVersionVectorStrategy({ nodeId: 'client-1' })

    const context: VersionVectorConflictContext<TestDocument> = {
      key: 'doc-1',
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        value: 200,
        updatedAt: new Date(),
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        value: 100,
        updatedAt: new Date(),
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      serverVersionVector: { 'server-1': 5, 'client-1': 3 },
      clientVersionVector: { 'client-1': 3 },
    }

    const result = strategy(context)

    // Verify structure matches ConflictResolution interface
    expect(result).toHaveProperty('resolved')
    expect(result).toHaveProperty('resolutionMetadata')
    expect(result.resolutionMetadata).toHaveProperty('strategy', 'version-vector')
    expect(result.resolutionMetadata).toHaveProperty('resolvedAt')
    expect(result.resolutionMetadata?.resolvedAt).toBeInstanceOf(Date)
  })

  it('should be usable as a ConflictResolver', () => {
    // This test verifies the strategy can be used in MongoDoCollectionConfig
    const strategy = createVersionVectorStrategy({
      nodeId: 'client-1',
      tieBreaker: 'server-wins',
    })

    // The strategy should accept ConflictContext and return ConflictResolution
    // This is a type-level test primarily
    expect(typeof strategy).toBe('function')
  })
})

// =============================================================================
// Performance Tests
// =============================================================================

describe('performance', () => {
  it('should compare vectors efficiently', () => {
    const vv1: VersionVector = {}
    const vv2: VersionVector = {}

    // Create large vectors
    for (let i = 0; i < 1000; i++) {
      vv1[`node-${i}`] = i
      vv2[`node-${i}`] = i
    }

    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      compareVersionVectors(vv1, vv2)
    }
    const duration = performance.now() - start

    // Should complete 1000 comparisons of 1000-node vectors in under 100ms
    expect(duration).toBeLessThan(100)
  })

  it('should merge vectors efficiently', () => {
    const vectors: VersionVector[] = []

    // Create 100 vectors with 100 nodes each
    for (let i = 0; i < 100; i++) {
      const vv: VersionVector = {}
      for (let j = 0; j < 100; j++) {
        vv[`node-${j}`] = Math.floor(Math.random() * 100)
      }
      vectors.push(vv)
    }

    const start = performance.now()
    mergeVersionVectors(...vectors)
    const duration = performance.now() - start

    // Should complete merge of 100 vectors in under 50ms
    expect(duration).toBeLessThan(50)
  })
})

// =============================================================================
// Multi-Node Scenarios
// =============================================================================

describe('multi-node scenarios', () => {
  describe('2-node synchronization', () => {
    it('should handle simple 2-node causally ordered writes', () => {
      // Node A makes a write
      let vectorA = createVersionVector('node-A', 1)
      // Node B receives and acknowledges
      let vectorB = mergeVersionVectors(createVersionVector(), vectorA)
      vectorB = incrementVersion(vectorB, 'node-B')

      // Node B is causally after Node A
      expect(compareVersionVectors(vectorA, vectorB)).toBe('before')
    })

    it('should detect concurrent writes from 2 nodes', () => {
      // Both nodes start from same base
      const base: VersionVector = { 'node-A': 1, 'node-B': 1 }

      // Node A makes an independent write
      const vectorA = incrementVersion(base, 'node-A')
      // Node B makes an independent write
      const vectorB = incrementVersion(base, 'node-B')

      expect(isConcurrent(vectorA, vectorB)).toBe(true)
    })

    it('should correctly merge after 2-node conflict resolution', () => {
      const vectorA: VersionVector = { 'node-A': 3, 'node-B': 1 }
      const vectorB: VersionVector = { 'node-A': 1, 'node-B': 4 }

      const merged = mergeVersionVectors(vectorA, vectorB)

      expect(merged['node-A']).toBe(3)
      expect(merged['node-B']).toBe(4)
    })

    it('should handle alternating writes between 2 nodes', () => {
      let vectorA: VersionVector = {}
      let vectorB: VersionVector = {}

      // A writes
      vectorA = incrementVersion(vectorA, 'node-A')
      // B syncs and writes
      vectorB = mergeVersionVectors(vectorB, vectorA)
      vectorB = incrementVersion(vectorB, 'node-B')
      // A syncs and writes
      vectorA = mergeVersionVectors(vectorA, vectorB)
      vectorA = incrementVersion(vectorA, 'node-A')

      expect(vectorA['node-A']).toBe(2)
      expect(vectorA['node-B']).toBe(1)
      expect(compareVersionVectors(vectorB, vectorA)).toBe('before')
    })
  })

  describe('3+ node convergence', () => {
    it('should handle 3 nodes with linear causality', () => {
      // A -> B -> C chain
      let vectorA = createVersionVector('node-A', 1)
      let vectorB = mergeVersionVectors({}, vectorA)
      vectorB = incrementVersion(vectorB, 'node-B')
      let vectorC = mergeVersionVectors({}, vectorB)
      vectorC = incrementVersion(vectorC, 'node-C')

      expect(isAncestor(vectorA, vectorB)).toBe(true)
      expect(isAncestor(vectorB, vectorC)).toBe(true)
      expect(isAncestor(vectorA, vectorC)).toBe(true)
    })

    it('should detect 3-way concurrent modifications', () => {
      const base: VersionVector = { 'node-A': 1, 'node-B': 1, 'node-C': 1 }

      const vectorA = incrementVersion(base, 'node-A')
      const vectorB = incrementVersion(base, 'node-B')
      const vectorC = incrementVersion(base, 'node-C')

      expect(isConcurrent(vectorA, vectorB)).toBe(true)
      expect(isConcurrent(vectorB, vectorC)).toBe(true)
      expect(isConcurrent(vectorA, vectorC)).toBe(true)
    })

    it('should converge 3 nodes to same state after merge', () => {
      const vectorA: VersionVector = { 'node-A': 3, 'node-B': 1, 'node-C': 2 }
      const vectorB: VersionVector = { 'node-A': 2, 'node-B': 4, 'node-C': 1 }
      const vectorC: VersionVector = { 'node-A': 1, 'node-B': 2, 'node-C': 5 }

      const mergedAB = mergeVersionVectors(vectorA, vectorB)
      const mergedBC = mergeVersionVectors(vectorB, vectorC)
      const mergedAC = mergeVersionVectors(vectorA, vectorC)

      // All should converge to same result
      const finalFromAB = mergeVersionVectors(mergedAB, vectorC)
      const finalFromBC = mergeVersionVectors(mergedBC, vectorA)
      const finalFromAC = mergeVersionVectors(mergedAC, vectorB)

      expect(finalFromAB).toEqual(finalFromBC)
      expect(finalFromBC).toEqual(finalFromAC)
    })

    it('should handle 5-node cluster synchronization', () => {
      const nodes = ['A', 'B', 'C', 'D', 'E']
      const vectors: Record<string, VersionVector> = {}

      // Initialize each node with its own counter
      nodes.forEach((node, i) => {
        vectors[node] = { [`node-${node}`]: i + 1 }
      })

      // Merge all vectors
      const merged = mergeVersionVectors(...Object.values(vectors))

      // Should have entries for all nodes
      nodes.forEach((node, i) => {
        expect(merged[`node-${node}`]).toBe(i + 1)
      })
    })

    it('should maintain causality through multi-hop propagation', () => {
      // A -> B -> C -> D chain
      let vectorA = incrementVersion({}, 'A')
      let vectorB = incrementVersion(mergeVersionVectors({}, vectorA), 'B')
      let vectorC = incrementVersion(mergeVersionVectors({}, vectorB), 'C')
      let vectorD = incrementVersion(mergeVersionVectors({}, vectorC), 'D')

      // D should know about all previous events
      expect(vectorD['A']).toBe(1)
      expect(vectorD['B']).toBe(1)
      expect(vectorD['C']).toBe(1)
      expect(vectorD['D']).toBe(1)

      // All should be causally related
      expect(isAncestor(vectorA, vectorD)).toBe(true)
      expect(isAncestor(vectorB, vectorD)).toBe(true)
      expect(isAncestor(vectorC, vectorD)).toBe(true)
    })
  })

  describe('network partitions', () => {
    it('should detect conflicts after network partition heals', () => {
      // Before partition: both nodes synced
      const baseVector: VersionVector = { 'node-A': 5, 'node-B': 3 }

      // During partition: each node makes independent writes
      const partitionA = incrementVersion(
        incrementVersion(baseVector, 'node-A'),
        'node-A'
      )
      const partitionB = incrementVersion(
        incrementVersion(baseVector, 'node-B'),
        'node-B'
      )

      // After partition: should detect concurrent modifications
      expect(isConcurrent(partitionA, partitionB)).toBe(true)
    })

    it('should correctly merge state after partition heals', () => {
      const baseVector: VersionVector = { 'node-A': 5, 'node-B': 3 }

      // Partition writes
      const partitionA: VersionVector = { 'node-A': 8, 'node-B': 3 }
      const partitionB: VersionVector = { 'node-A': 5, 'node-B': 7 }

      const merged = mergeVersionVectors(partitionA, partitionB)

      expect(merged['node-A']).toBe(8)
      expect(merged['node-B']).toBe(7)
    })

    it('should handle asymmetric partition (one node isolated)', () => {
      // Node A and B stay connected, C is isolated
      const sharedVector: VersionVector = { 'node-A': 3, 'node-B': 2, 'node-C': 1 }

      // A and B continue to sync
      let vectorAB = incrementVersion(sharedVector, 'node-A')
      vectorAB = incrementVersion(vectorAB, 'node-B')
      vectorAB = incrementVersion(vectorAB, 'node-A')

      // C is isolated and makes changes
      const vectorC = incrementVersion(
        incrementVersion(sharedVector, 'node-C'),
        'node-C'
      )

      // When C rejoins, there should be conflict
      expect(isConcurrent(vectorAB, vectorC)).toBe(true)
    })

    it('should preserve causal history through partition', () => {
      // Pre-partition state with known causality
      const baseVector: VersionVector = { 'node-A': 10, 'node-B': 8, 'node-C': 5 }

      // During partition, A and B diverge
      const vectorA: VersionVector = { 'node-A': 15, 'node-B': 8, 'node-C': 5 }
      const vectorB: VersionVector = { 'node-A': 10, 'node-B': 12, 'node-C': 5 }

      // After healing, merge preserves all known history
      const merged = mergeVersionVectors(vectorA, vectorB)
      expect(merged['node-A']).toBe(15)
      expect(merged['node-B']).toBe(12)
      expect(merged['node-C']).toBe(5)

      // Original base is ancestor of merged
      expect(isAncestor(baseVector, merged)).toBe(true)
    })

    it('should handle multiple sequential partitions', () => {
      let vectorA: VersionVector = { A: 1 }
      let vectorB: VersionVector = { B: 1 }

      // First partition: both increment independently
      vectorA = incrementVersion(vectorA, 'A')
      vectorB = incrementVersion(vectorB, 'B')

      // Heal: merge and both increment
      const merged1 = mergeVersionVectors(vectorA, vectorB)
      vectorA = incrementVersion(merged1, 'A')
      vectorB = incrementVersion(merged1, 'B')

      // Second partition: both increment again
      vectorA = incrementVersion(vectorA, 'A')
      vectorB = incrementVersion(vectorB, 'B')

      // Should still detect concurrent after second partition
      expect(isConcurrent(vectorA, vectorB)).toBe(true)

      // Final merge
      const finalMerged = mergeVersionVectors(vectorA, vectorB)
      expect(finalMerged['A']).toBe(4)
      expect(finalMerged['B']).toBe(4)
    })
  })
})

// =============================================================================
// Persistence Tests
// =============================================================================

describe('persistence', () => {
  describe('serialization', () => {
    it('should serialize version vector to JSON', () => {
      const vv: VersionVector = { 'node-1': 3, 'node-2': 5 }
      const json = JSON.stringify(vv)

      expect(json).toBe('{"node-1":3,"node-2":5}')
    })

    it('should serialize empty version vector', () => {
      const vv: VersionVector = {}
      const json = JSON.stringify(vv)

      expect(json).toBe('{}')
    })

    it('should serialize large version vector', () => {
      const vv: VersionVector = {}
      for (let i = 0; i < 100; i++) {
        vv[`node-${i}`] = i * 10
      }

      const json = JSON.stringify(vv)
      const parsed = JSON.parse(json)

      expect(Object.keys(parsed).length).toBe(100)
    })

    it('should handle special characters in node IDs during serialization', () => {
      const vv: VersionVector = {
        'node:with:colons': 1,
        'node.with.dots': 2,
        'node-with-dashes': 3,
        'node_with_underscores': 4,
      }

      const json = JSON.stringify(vv)
      const parsed = JSON.parse(json)

      expect(parsed['node:with:colons']).toBe(1)
      expect(parsed['node.with.dots']).toBe(2)
      expect(parsed['node-with-dashes']).toBe(3)
      expect(parsed['node_with_underscores']).toBe(4)
    })
  })

  describe('deserialization', () => {
    it('should deserialize JSON to version vector', () => {
      const json = '{"node-1":3,"node-2":5}'
      const vv = createVersionVector(JSON.parse(json))

      expect(vv['node-1']).toBe(3)
      expect(vv['node-2']).toBe(5)
    })

    it('should deserialize empty JSON object', () => {
      const json = '{}'
      const vv = createVersionVector(JSON.parse(json))

      expect(Object.keys(vv).length).toBe(0)
    })

    it('should handle string version numbers during deserialization', () => {
      // Some databases may return numbers as strings
      const json = '{"node-1":"3","node-2":"5"}'
      const parsed = JSON.parse(json)

      // Implementation should coerce to numbers
      const vv = createVersionVector(parsed)

      expect(typeof vv['node-1']).toBe('number')
      expect(vv['node-1']).toBe(3)
    })

    it('should round-trip serialize/deserialize correctly', () => {
      const original: VersionVector = { 'node-A': 100, 'node-B': 200, 'node-C': 300 }

      const json = JSON.stringify(original)
      const restored = createVersionVector(JSON.parse(json))

      expect(restored).toEqual(original)
    })

    it('should preserve comparison semantics after round-trip', () => {
      const vv1: VersionVector = { 'node-1': 3, 'node-2': 5 }
      const vv2: VersionVector = { 'node-1': 2, 'node-2': 6 }

      const originalComparison = compareVersionVectors(vv1, vv2)

      const restored1 = createVersionVector(JSON.parse(JSON.stringify(vv1)))
      const restored2 = createVersionVector(JSON.parse(JSON.stringify(vv2)))

      const restoredComparison = compareVersionVectors(restored1, restored2)

      expect(restoredComparison).toBe(originalComparison)
    })
  })

  describe('compaction', () => {
    it('should compact old entries with zero values', () => {
      const vv: VersionVector = {
        'node-1': 5,
        'node-2': 0,
        'node-3': 3,
        'node-4': 0,
      }

      // Implementation should provide a compact function
      // that removes zero entries
      const compacted = createVersionVector(
        Object.fromEntries(
          Object.entries(vv).filter(([_, v]) => v > 0)
        )
      )

      expect(compacted['node-1']).toBe(5)
      expect(compacted['node-3']).toBe(3)
      expect(compacted['node-2']).toBeUndefined()
      expect(compacted['node-4']).toBeUndefined()
    })

    it('should identify stale node entries', () => {
      // Nodes that haven't been updated in a long time
      // could potentially be removed (application-specific)
      const vv: VersionVector = {
        'active-node-1': 1000,
        'active-node-2': 950,
        'stale-node': 5, // Much lower version
      }

      const entries = Object.entries(vv)
      const maxVersion = Math.max(...Object.values(vv))
      const threshold = maxVersion * 0.1 // 10% of max

      const staleNodes = entries
        .filter(([_, v]) => v < threshold)
        .map(([k]) => k)

      expect(staleNodes).toContain('stale-node')
    })

    it('should maintain correctness after compaction', () => {
      const vv1: VersionVector = { 'node-1': 5, 'node-2': 0, 'node-3': 3 }
      const vv2: VersionVector = { 'node-1': 4, 'node-3': 4 }

      // Compact vv1 (remove zero entries)
      const compacted1 = createVersionVector({ 'node-1': 5, 'node-3': 3 })

      // Comparison should be same with or without zero entries
      // Both have some values higher - concurrent
      expect(compareVersionVectors(vv1, vv2)).toBe('concurrent')
      expect(compareVersionVectors(compacted1, vv2)).toBe('concurrent')
    })
  })
})

// =============================================================================
// Advanced Conflict Detection Tests
// =============================================================================

describe('conflict detection (advanced)', () => {
  describe('detectConcurrentModification scenarios', () => {
    it('should detect modification conflict with divergent histories', () => {
      const localVector: VersionVector = { 'client-1': 5, 'server': 3 }
      const remoteVector: VersionVector = { 'client-2': 4, 'server': 3 }

      // Both modified independently after server sync
      expect(isConcurrent(localVector, remoteVector)).toBe(true)
    })

    it('should detect no conflict when remote is ancestor', () => {
      const localVector: VersionVector = { 'client': 5, 'server': 4 }
      const remoteVector: VersionVector = { 'server': 3 }

      expect(isAncestor(remoteVector, localVector)).toBe(true)
      expect(isConcurrent(localVector, remoteVector)).toBe(false)
    })

    it('should handle rapid sequential modifications', () => {
      let vector: VersionVector = {}

      // Simulate rapid increments
      for (let i = 0; i < 100; i++) {
        vector = incrementVersion(vector, 'fast-node')
      }

      expect(vector['fast-node']).toBe(100)
    })

    it('should detect conflict with partial vector overlap', () => {
      // Vectors share some nodes but have different histories
      const vv1: VersionVector = { shared: 5, 'exclusive-1': 3 }
      const vv2: VersionVector = { shared: 5, 'exclusive-2': 4 }

      expect(isConcurrent(vv1, vv2)).toBe(true)
    })
  })

  describe('causal ordering edge cases', () => {
    it('should correctly order single-increment differences', () => {
      const vv1: VersionVector = { node: 5 }
      const vv2: VersionVector = { node: 6 }

      expect(isAncestor(vv1, vv2)).toBe(true)
      expect(isAncestor(vv2, vv1)).toBe(false)
    })

    it('should handle vector with only zeros', () => {
      const vv1: VersionVector = { 'node-1': 0, 'node-2': 0 }
      const vv2: VersionVector = {}

      // Should be treated as equal
      expect(compareVersionVectors(vv1, vv2)).toBe('equal')
    })

    it('should distinguish between new node and incremented node', () => {
      const vv1: VersionVector = { existing: 5 }
      const vv2: VersionVector = { existing: 5, new: 1 }

      // vv2 has more information - vv1 is ancestor
      expect(isAncestor(vv1, vv2)).toBe(true)
    })
  })
})

// =============================================================================
// Resolution Strategy Advanced Tests
// =============================================================================

describe('resolution strategy (advanced)', () => {
  describe('deterministic winner selection', () => {
    it('should select same winner regardless of argument order', () => {
      const strategy = createVersionVectorStrategy({
        nodeId: 'client',
        tieBreaker: 'server-wins',
      })

      const serverDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Server',
        value: 100,
        updatedAt: new Date('2024-01-01'),
      }

      const clientDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Client',
        value: 200,
        updatedAt: new Date('2024-01-01'),
      }

      const serverVector: VersionVector = { server: 3 }
      const clientVector: VersionVector = { client: 4 }

      const context1: VersionVectorConflictContext<TestDocument> = {
        key: 'doc-1',
        serverVersion: serverDoc,
        clientVersion: clientDoc,
        serverTimestamp: serverDoc.updatedAt,
        clientTimestamp: clientDoc.updatedAt,
        serverVersionVector: serverVector,
        clientVersionVector: clientVector,
      }

      const result = strategy(context1)

      // Server wins should always select server
      expect(result.resolved.name).toBe('Server')
    })

    it('should use deterministic tie breaker based on node ID ordering', () => {
      const strategy = createVersionVectorStrategy({
        nodeId: 'client',
        tieBreaker: 'deterministic',
      })

      const context: VersionVectorConflictContext<TestDocument> = {
        key: 'doc-1',
        serverVersion: {
          _id: 'doc-1',
          name: 'Server',
          value: 100,
          updatedAt: new Date(),
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client',
          value: 200,
          updatedAt: new Date(),
        },
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        serverVersionVector: { 'node-B': 3 },
        clientVersionVector: { 'node-A': 4 },
      }

      const result = strategy(context)

      // Deterministic should use consistent ordering (e.g., alphabetical)
      expect(result.resolutionMetadata?.tieBreaker).toBe('deterministic')
    })
  })

  describe('field-level merging', () => {
    it('should merge non-conflicting field updates', () => {
      const fieldMergeStrategy = createVersionVectorStrategy({
        nodeId: 'client',
        onConcurrent: (server, client) => {
          // Merge strategy: prefer server for name, client for value
          return {
            ...server,
            name: server.name,
            value: client.value,
          }
        },
      })

      const context: VersionVectorConflictContext<TestDocument> = {
        key: 'doc-1',
        serverVersion: {
          _id: 'doc-1',
          name: 'Server Name',
          value: 100,
          updatedAt: new Date(),
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client Name',
          value: 200,
          updatedAt: new Date(),
        },
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        serverVersionVector: { server: 3 },
        clientVersionVector: { client: 4 },
      }

      const result = fieldMergeStrategy(context)

      expect(result.resolved.name).toBe('Server Name')
      expect(result.resolved.value).toBe(200)
    })

    it('should handle nested object field merging', () => {
      interface DeepDoc {
        _id: string
        settings: {
          theme: string
          notifications: {
            email: boolean
            push: boolean
          }
        }
      }

      const deepMergeStrategy = createVersionVectorStrategy<DeepDoc>({
        nodeId: 'client',
        onConcurrent: (server, client) => ({
          _id: server._id,
          settings: {
            theme: client.settings.theme, // Client wins theme
            notifications: {
              email: server.settings.notifications.email, // Server wins email
              push: client.settings.notifications.push, // Client wins push
            },
          },
        }),
      })

      const context: VersionVectorConflictContext<DeepDoc> = {
        key: 'doc-1',
        serverVersion: {
          _id: 'doc-1',
          settings: {
            theme: 'light',
            notifications: { email: true, push: false },
          },
        },
        clientVersion: {
          _id: 'doc-1',
          settings: {
            theme: 'dark',
            notifications: { email: false, push: true },
          },
        },
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        serverVersionVector: { server: 3 },
        clientVersionVector: { client: 4 },
      }

      const result = deepMergeStrategy(context as any)

      expect(result.resolved.settings.theme).toBe('dark')
      expect(result.resolved.settings.notifications.email).toBe(true)
      expect(result.resolved.settings.notifications.push).toBe(true)
    })

    it('should apply field-level version vectors', () => {
      // Field-level tracking: each field has its own version
      interface FieldVersionedDoc {
        _id: string
        name: string
        value: number
        _fieldVersions: {
          name: VersionVector
          value: VersionVector
        }
      }

      // This tests the concept of per-field versioning
      const serverDoc: FieldVersionedDoc = {
        _id: 'doc-1',
        name: 'Server Name',
        value: 100,
        _fieldVersions: {
          name: { server: 5 }, // Server updated name more recently
          value: { client: 2, server: 1 }, // Value hasn't changed
        },
      }

      const clientDoc: FieldVersionedDoc = {
        _id: 'doc-1',
        name: 'Old Name',
        value: 200,
        _fieldVersions: {
          name: { server: 3 }, // Client has older name version
          value: { client: 4, server: 1 }, // Client updated value
        },
      }

      // Compare field versions
      const nameComparison = compareVersionVectors(
        serverDoc._fieldVersions.name,
        clientDoc._fieldVersions.name
      )
      const valueComparison = compareVersionVectors(
        serverDoc._fieldVersions.value,
        clientDoc._fieldVersions.value
      )

      expect(nameComparison).toBe('after') // Server name is newer
      expect(valueComparison).toBe('before') // Client value is newer
    })
  })

  describe('custom resolution callbacks', () => {
    it('should call onConflict callback with full context', () => {
      const onConflict = vi.fn().mockReturnValue({
        _id: 'doc-1',
        name: 'Merged',
        value: 300,
        updatedAt: new Date(),
      })

      const strategy = createVersionVectorStrategy({
        nodeId: 'client',
        onConcurrent: onConflict,
      })

      const context: VersionVectorConflictContext<TestDocument> = {
        key: 'doc-1',
        serverVersion: {
          _id: 'doc-1',
          name: 'Server',
          value: 100,
          updatedAt: new Date(),
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client',
          value: 200,
          updatedAt: new Date(),
        },
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        serverVersionVector: { server: 3 },
        clientVersionVector: { client: 4 },
      }

      strategy(context)

      expect(onConflict).toHaveBeenCalledWith(
        context.serverVersion,
        context.clientVersion,
        expect.objectContaining({
          key: 'doc-1',
          serverVersionVector: { server: 3 },
          clientVersionVector: { client: 4 },
        })
      )
    })

    it('should allow async resolution callbacks', async () => {
      const asyncMerge = vi.fn().mockImplementation(async (server, client) => {
        // Simulate async operation (e.g., external service call)
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { ...server, value: server.value + client.value }
      })

      const strategy = createVersionVectorStrategy({
        nodeId: 'client',
        onConcurrent: asyncMerge,
      })

      const context: VersionVectorConflictContext<TestDocument> = {
        key: 'doc-1',
        serverVersion: {
          _id: 'doc-1',
          name: 'Server',
          value: 100,
          updatedAt: new Date(),
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client',
          value: 200,
          updatedAt: new Date(),
        },
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        serverVersionVector: { server: 3 },
        clientVersionVector: { client: 4 },
      }

      const result = await strategy(context)

      expect(result.resolved.value).toBe(300)
    })
  })
})

// =============================================================================
// Document Versioning with Embedded Vectors
// =============================================================================

describe('embedded version vectors', () => {
  it('should work with documents containing embedded version vectors', () => {
    interface VersionedDoc {
      _id: string
      data: string
      _vv: VersionVector
    }

    const doc1: VersionedDoc = {
      _id: 'doc-1',
      data: 'Hello',
      _vv: { 'node-A': 3 },
    }

    const doc2: VersionedDoc = {
      _id: 'doc-1',
      data: 'World',
      _vv: { 'node-A': 3, 'node-B': 2 },
    }

    // Compare using embedded vectors
    const comparison = compareVersionVectors(doc1._vv, doc2._vv)
    expect(comparison).toBe('before')
  })

  it('should update embedded vector on modification', () => {
    interface VersionedDoc {
      _id: string
      data: string
      _vv: VersionVector
    }

    const original: VersionedDoc = {
      _id: 'doc-1',
      data: 'Original',
      _vv: { 'node-A': 3 },
    }

    // Simulate local modification
    const modified: VersionedDoc = {
      ...original,
      data: 'Modified',
      _vv: incrementVersion(original._vv, 'node-A'),
    }

    expect(modified._vv['node-A']).toBe(4)
    expect(isAncestor(original._vv, modified._vv)).toBe(true)
  })

  it('should merge embedded vectors during sync', () => {
    interface VersionedDoc {
      _id: string
      data: string
      _vv: VersionVector
    }

    const localDoc: VersionedDoc = {
      _id: 'doc-1',
      data: 'Local',
      _vv: { 'node-A': 5, 'node-B': 3 },
    }

    const remoteDoc: VersionedDoc = {
      _id: 'doc-1',
      data: 'Remote',
      _vv: { 'node-A': 4, 'node-B': 6 },
    }

    const mergedVV = mergeVersionVectors(localDoc._vv, remoteDoc._vv)

    expect(mergedVV['node-A']).toBe(5)
    expect(mergedVV['node-B']).toBe(6)
  })
})

// =============================================================================
// Vector Clock Theory Tests
// =============================================================================

describe('vector clock mathematical properties', () => {
  describe('partial order properties', () => {
    it('should be reflexive (a <= a)', () => {
      const vv: VersionVector = { 'node-1': 3, 'node-2': 5 }
      const comparison = compareVersionVectors(vv, vv)

      expect(comparison).toBe('equal')
    })

    it('should be antisymmetric (a <= b and b <= a implies a = b)', () => {
      const vv1: VersionVector = { 'node-1': 3, 'node-2': 5 }
      const vv2: VersionVector = { 'node-1': 3, 'node-2': 5 }

      const comp1 = compareVersionVectors(vv1, vv2)
      const comp2 = compareVersionVectors(vv2, vv1)

      expect(comp1).toBe('equal')
      expect(comp2).toBe('equal')
    })

    it('should be transitive (a <= b and b <= c implies a <= c)', () => {
      const a: VersionVector = { node: 1 }
      const b: VersionVector = { node: 2 }
      const c: VersionVector = { node: 3 }

      expect(compareVersionVectors(a, b)).toBe('before')
      expect(compareVersionVectors(b, c)).toBe('before')
      expect(compareVersionVectors(a, c)).toBe('before')
    })
  })

  describe('merge operation properties', () => {
    it('should be commutative (merge(a,b) = merge(b,a))', () => {
      const vv1: VersionVector = { 'node-1': 3, 'node-2': 5 }
      const vv2: VersionVector = { 'node-1': 5, 'node-2': 3 }

      const merge1 = mergeVersionVectors(vv1, vv2)
      const merge2 = mergeVersionVectors(vv2, vv1)

      expect(merge1).toEqual(merge2)
    })

    it('should be associative (merge(merge(a,b),c) = merge(a,merge(b,c)))', () => {
      const a: VersionVector = { 'node-1': 1 }
      const b: VersionVector = { 'node-2': 2 }
      const c: VersionVector = { 'node-3': 3 }

      const leftAssoc = mergeVersionVectors(mergeVersionVectors(a, b), c)
      const rightAssoc = mergeVersionVectors(a, mergeVersionVectors(b, c))

      expect(leftAssoc).toEqual(rightAssoc)
    })

    it('should be idempotent (merge(a,a) = a)', () => {
      const vv: VersionVector = { 'node-1': 3, 'node-2': 5 }
      const merged = mergeVersionVectors(vv, vv)

      expect(merged).toEqual(vv)
    })

    it('should have identity element (merge(a,{}) = a)', () => {
      const vv: VersionVector = { 'node-1': 3, 'node-2': 5 }
      const merged = mergeVersionVectors(vv, {})

      expect(merged).toEqual(vv)
    })
  })

  describe('least upper bound (LUB) property', () => {
    it('should produce LUB of two vectors', () => {
      const vv1: VersionVector = { 'node-1': 3, 'node-2': 1 }
      const vv2: VersionVector = { 'node-1': 1, 'node-2': 4 }

      const lub = mergeVersionVectors(vv1, vv2)

      // LUB should be >= both inputs
      expect(compareVersionVectors(vv1, lub)).not.toBe('after')
      expect(compareVersionVectors(vv2, lub)).not.toBe('after')

      // LUB should be minimal (equal to max of each component)
      expect(lub['node-1']).toBe(3)
      expect(lub['node-2']).toBe(4)
    })
  })
})

// =============================================================================
// Conflict Statistics and Monitoring
// =============================================================================

describe('conflict monitoring', () => {
  it('should track conflict count', () => {
    let conflictCount = 0

    const trackingStrategy = createVersionVectorStrategy({
      nodeId: 'client',
      tieBreaker: 'server-wins',
      onConcurrent: (server, client, context) => {
        conflictCount++
        return server // Server wins
      },
    })

    // Simulate multiple conflicts
    for (let i = 0; i < 5; i++) {
      const context: VersionVectorConflictContext<TestDocument> = {
        key: `doc-${i}`,
        serverVersion: {
          _id: `doc-${i}`,
          name: 'Server',
          value: 100,
          updatedAt: new Date(),
        },
        clientVersion: {
          _id: `doc-${i}`,
          name: 'Client',
          value: 200,
          updatedAt: new Date(),
        },
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        serverVersionVector: { server: 3 },
        clientVersionVector: { client: 4 },
      }

      trackingStrategy(context)
    }

    expect(conflictCount).toBe(5)
  })

  it('should provide resolution metadata for analytics', () => {
    const strategy = createVersionVectorStrategy({
      nodeId: 'client',
      tieBreaker: 'server-wins',
    })

    const context: VersionVectorConflictContext<TestDocument> = {
      key: 'doc-1',
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        value: 100,
        updatedAt: new Date(),
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        value: 200,
        updatedAt: new Date(),
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      serverVersionVector: { server: 3 },
      clientVersionVector: { client: 4 },
    }

    const result = strategy(context)

    expect(result.resolutionMetadata).toBeDefined()
    expect(result.resolutionMetadata?.strategy).toBe('version-vector')
    expect(result.resolutionMetadata?.comparison).toBeDefined()
    expect(result.resolutionMetadata?.resolvedAt).toBeInstanceOf(Date)
  })
})
