/**
 * @file Client-Wins Conflict Resolution Strategy Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the Client-Wins conflict resolution strategy.
 * This strategy always resolves conflicts by accepting the client's version,
 * discarding any server-side changes when a conflict is detected.
 *
 * Layer 9 Conflict Resolution - Client-Wins Strategy
 *
 * RED PHASE: These tests will fail until the client-wins resolver is implemented
 * in src/sync/conflict/client-wins.ts
 *
 * Bead ID: po0.195 (RED tests)
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createClientWinsResolver,
  resolveWithClientWins,
  type ConflictContext,
  type ConflictResolution,
  type ClientWinsResolverConfig,
  type ClientWinsResolver,
} from '../../../src/sync/conflict/client-wins'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing conflict resolution.
 */
interface TestDocument {
  _id: string
  name: string
  value: number
  updatedAt: Date
}

/**
 * Document with nested objects for testing complex structures.
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
  version: number
}

/**
 * Document with arrays for testing array conflict scenarios.
 */
interface ArrayDocument {
  _id: string
  tags: string[]
  items: { id: string; quantity: number }[]
}

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createClientWinsResolver', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createClientWinsResolver).toBe('function')
    })

    it('should return a resolver object', () => {
      const resolver = createClientWinsResolver<TestDocument>()
      expect(resolver).toBeDefined()
      expect(typeof resolver).toBe('object')
    })

    it('should return resolver with resolve method', () => {
      const resolver = createClientWinsResolver<TestDocument>()
      expect(typeof resolver.resolve).toBe('function')
    })

    it('should return resolver with strategy property', () => {
      const resolver = createClientWinsResolver<TestDocument>()
      expect(resolver.strategy).toBe('client-wins')
    })

    it('should accept optional configuration', () => {
      const config: ClientWinsResolverConfig<TestDocument> = {
        onConflictResolved: vi.fn(),
        onConflictDetected: vi.fn(),
      }
      const resolver = createClientWinsResolver<TestDocument>(config)
      expect(resolver).toBeDefined()
    })
  })
})

// =============================================================================
// Resolve Method Tests
// =============================================================================

describe('ClientWinsResolver.resolve', () => {
  let resolver: ClientWinsResolver<TestDocument>

  beforeEach(() => {
    resolver = createClientWinsResolver<TestDocument>()
  })

  describe('basic conflict resolution', () => {
    it('should return client value when conflict occurs', () => {
      const clientValue: TestDocument = {
        _id: 'doc-1',
        name: 'Client Version',
        value: 100,
        updatedAt: new Date('2024-01-02'),
      }

      const serverValue: TestDocument = {
        _id: 'doc-1',
        name: 'Server Version',
        value: 50,
        updatedAt: new Date('2024-01-01'),
      }

      const context: ConflictContext<TestDocument> = {
        key: 'doc-1',
        clientValue,
        serverValue,
        baseValue: serverValue,
        timestamp: Date.now(),
      }

      const result = resolver.resolve(context)

      expect(result.resolvedValue).toEqual(clientValue)
      expect(result.strategy).toBe('client-wins')
    })

    it('should return client value even when server is newer', () => {
      const clientValue: TestDocument = {
        _id: 'doc-1',
        name: 'Client Version',
        value: 100,
        updatedAt: new Date('2024-01-01'), // Older
      }

      const serverValue: TestDocument = {
        _id: 'doc-1',
        name: 'Server Version',
        value: 50,
        updatedAt: new Date('2024-01-02'), // Newer
      }

      const context: ConflictContext<TestDocument> = {
        key: 'doc-1',
        clientValue,
        serverValue,
        baseValue: clientValue,
        timestamp: Date.now(),
      }

      const result = resolver.resolve(context)

      // Client-wins ALWAYS chooses client, regardless of timestamps
      expect(result.resolvedValue).toEqual(clientValue)
    })

    it('should include conflict metadata in result', () => {
      const clientValue: TestDocument = {
        _id: 'doc-1',
        name: 'Client',
        value: 100,
        updatedAt: new Date(),
      }

      const serverValue: TestDocument = {
        _id: 'doc-1',
        name: 'Server',
        value: 50,
        updatedAt: new Date(),
      }

      const context: ConflictContext<TestDocument> = {
        key: 'doc-1',
        clientValue,
        serverValue,
        baseValue: serverValue,
        timestamp: Date.now(),
      }

      const result = resolver.resolve(context)

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.conflictDetectedAt).toBeDefined()
      expect(result.metadata?.discardedValue).toEqual(serverValue)
    })
  })

  describe('edge cases', () => {
    it('should handle null server value', () => {
      const clientValue: TestDocument = {
        _id: 'doc-1',
        name: 'New Document',
        value: 100,
        updatedAt: new Date(),
      }

      const context: ConflictContext<TestDocument> = {
        key: 'doc-1',
        clientValue,
        serverValue: null as unknown as TestDocument,
        baseValue: null as unknown as TestDocument,
        timestamp: Date.now(),
      }

      const result = resolver.resolve(context)

      expect(result.resolvedValue).toEqual(clientValue)
    })

    it('should handle null client value (delete operation)', () => {
      const serverValue: TestDocument = {
        _id: 'doc-1',
        name: 'Server Document',
        value: 50,
        updatedAt: new Date(),
      }

      const context: ConflictContext<TestDocument> = {
        key: 'doc-1',
        clientValue: null as unknown as TestDocument,
        serverValue,
        baseValue: serverValue,
        timestamp: Date.now(),
      }

      const result = resolver.resolve(context)

      // Client-wins should respect client's delete
      expect(result.resolvedValue).toBeNull()
    })

    it('should handle identical values', () => {
      const document: TestDocument = {
        _id: 'doc-1',
        name: 'Same Document',
        value: 100,
        updatedAt: new Date(),
      }

      const context: ConflictContext<TestDocument> = {
        key: 'doc-1',
        clientValue: { ...document },
        serverValue: { ...document },
        baseValue: { ...document },
        timestamp: Date.now(),
      }

      const result = resolver.resolve(context)

      expect(result.resolvedValue).toEqual(document)
      expect(result.hadConflict).toBe(false)
    })
  })

  describe('nested document conflicts', () => {
    let nestedResolver: ClientWinsResolver<NestedDocument>

    beforeEach(() => {
      nestedResolver = createClientWinsResolver<NestedDocument>()
    })

    it('should preserve entire client document structure', () => {
      const clientValue: NestedDocument = {
        _id: 'nested-1',
        user: {
          profile: {
            firstName: 'Client',
            lastName: 'User',
          },
          settings: {
            theme: 'dark',
            notifications: true,
          },
        },
        version: 2,
      }

      const serverValue: NestedDocument = {
        _id: 'nested-1',
        user: {
          profile: {
            firstName: 'Server',
            lastName: 'User',
          },
          settings: {
            theme: 'light',
            notifications: false,
          },
        },
        version: 3,
      }

      const context: ConflictContext<NestedDocument> = {
        key: 'nested-1',
        clientValue,
        serverValue,
        baseValue: serverValue,
        timestamp: Date.now(),
      }

      const result = nestedResolver.resolve(context)

      expect(result.resolvedValue).toEqual(clientValue)
      expect(result.resolvedValue.user.profile.firstName).toBe('Client')
      expect(result.resolvedValue.user.settings.theme).toBe('dark')
    })
  })

  describe('array document conflicts', () => {
    let arrayResolver: ClientWinsResolver<ArrayDocument>

    beforeEach(() => {
      arrayResolver = createClientWinsResolver<ArrayDocument>()
    })

    it('should use client array values completely', () => {
      const clientValue: ArrayDocument = {
        _id: 'array-1',
        tags: ['client-tag-1', 'client-tag-2'],
        items: [{ id: 'item-1', quantity: 10 }],
      }

      const serverValue: ArrayDocument = {
        _id: 'array-1',
        tags: ['server-tag-1'],
        items: [
          { id: 'item-1', quantity: 5 },
          { id: 'item-2', quantity: 3 },
        ],
      }

      const context: ConflictContext<ArrayDocument> = {
        key: 'array-1',
        clientValue,
        serverValue,
        baseValue: serverValue,
        timestamp: Date.now(),
      }

      const result = arrayResolver.resolve(context)

      expect(result.resolvedValue.tags).toEqual(['client-tag-1', 'client-tag-2'])
      expect(result.resolvedValue.items).toEqual([{ id: 'item-1', quantity: 10 }])
    })
  })
})

// =============================================================================
// Callback Tests
// =============================================================================

describe('resolver callbacks', () => {
  describe('onConflictDetected', () => {
    it('should call onConflictDetected when conflict is found', () => {
      const onConflictDetected = vi.fn()
      const resolver = createClientWinsResolver<TestDocument>({
        onConflictDetected,
      })

      const clientValue: TestDocument = {
        _id: 'doc-1',
        name: 'Client',
        value: 100,
        updatedAt: new Date(),
      }

      const serverValue: TestDocument = {
        _id: 'doc-1',
        name: 'Server',
        value: 50,
        updatedAt: new Date(),
      }

      const context: ConflictContext<TestDocument> = {
        key: 'doc-1',
        clientValue,
        serverValue,
        baseValue: serverValue,
        timestamp: Date.now(),
      }

      resolver.resolve(context)

      expect(onConflictDetected).toHaveBeenCalledWith(context)
    })

    it('should not call onConflictDetected when values are identical', () => {
      const onConflictDetected = vi.fn()
      const resolver = createClientWinsResolver<TestDocument>({
        onConflictDetected,
      })

      const document: TestDocument = {
        _id: 'doc-1',
        name: 'Same',
        value: 100,
        updatedAt: new Date(),
      }

      const context: ConflictContext<TestDocument> = {
        key: 'doc-1',
        clientValue: { ...document },
        serverValue: { ...document },
        baseValue: { ...document },
        timestamp: Date.now(),
      }

      resolver.resolve(context)

      expect(onConflictDetected).not.toHaveBeenCalled()
    })
  })

  describe('onConflictResolved', () => {
    it('should call onConflictResolved after resolution', () => {
      const onConflictResolved = vi.fn()
      const resolver = createClientWinsResolver<TestDocument>({
        onConflictResolved,
      })

      const clientValue: TestDocument = {
        _id: 'doc-1',
        name: 'Client',
        value: 100,
        updatedAt: new Date(),
      }

      const serverValue: TestDocument = {
        _id: 'doc-1',
        name: 'Server',
        value: 50,
        updatedAt: new Date(),
      }

      const context: ConflictContext<TestDocument> = {
        key: 'doc-1',
        clientValue,
        serverValue,
        baseValue: serverValue,
        timestamp: Date.now(),
      }

      const result = resolver.resolve(context)

      expect(onConflictResolved).toHaveBeenCalledWith(context, result)
    })

    it('should pass resolved value to callback', () => {
      const onConflictResolved = vi.fn()
      const resolver = createClientWinsResolver<TestDocument>({
        onConflictResolved,
      })

      const clientValue: TestDocument = {
        _id: 'doc-1',
        name: 'Client',
        value: 100,
        updatedAt: new Date(),
      }

      const serverValue: TestDocument = {
        _id: 'doc-1',
        name: 'Server',
        value: 50,
        updatedAt: new Date(),
      }

      const context: ConflictContext<TestDocument> = {
        key: 'doc-1',
        clientValue,
        serverValue,
        baseValue: serverValue,
        timestamp: Date.now(),
      }

      resolver.resolve(context)

      const callArgs = onConflictResolved.mock.calls[0]
      expect(callArgs[1].resolvedValue).toEqual(clientValue)
    })
  })
})

// =============================================================================
// Direct Function Tests
// =============================================================================

describe('resolveWithClientWins', () => {
  it('should be a function', () => {
    expect(typeof resolveWithClientWins).toBe('function')
  })

  it('should resolve conflict with client value', () => {
    const clientValue: TestDocument = {
      _id: 'doc-1',
      name: 'Client',
      value: 100,
      updatedAt: new Date(),
    }

    const serverValue: TestDocument = {
      _id: 'doc-1',
      name: 'Server',
      value: 50,
      updatedAt: new Date(),
    }

    const result = resolveWithClientWins<TestDocument>({
      key: 'doc-1',
      clientValue,
      serverValue,
      baseValue: serverValue,
      timestamp: Date.now(),
    })

    expect(result.resolvedValue).toEqual(clientValue)
    expect(result.strategy).toBe('client-wins')
  })

  it('should work without creating a resolver instance', () => {
    const clientValue: TestDocument = {
      _id: 'standalone-doc',
      name: 'Standalone',
      value: 999,
      updatedAt: new Date(),
    }

    const serverValue: TestDocument = {
      _id: 'standalone-doc',
      name: 'Server Standalone',
      value: 1,
      updatedAt: new Date(),
    }

    const result = resolveWithClientWins<TestDocument>({
      key: 'standalone-doc',
      clientValue,
      serverValue,
      baseValue: serverValue,
      timestamp: Date.now(),
    })

    expect(result.resolvedValue).toEqual(clientValue)
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('type safety', () => {
  it('should maintain generic type through resolver', () => {
    const resolver = createClientWinsResolver<TestDocument>()

    const clientValue: TestDocument = {
      _id: 'typed-doc',
      name: 'Typed',
      value: 42,
      updatedAt: new Date(),
    }

    const serverValue: TestDocument = {
      _id: 'typed-doc',
      name: 'Server Typed',
      value: 1,
      updatedAt: new Date(),
    }

    const context: ConflictContext<TestDocument> = {
      key: 'typed-doc',
      clientValue,
      serverValue,
      baseValue: serverValue,
      timestamp: Date.now(),
    }

    const result = resolver.resolve(context)

    // TypeScript should infer result.resolvedValue as TestDocument
    expect(result.resolvedValue._id).toBe('typed-doc')
    expect(result.resolvedValue.name).toBe('Typed')
    expect(result.resolvedValue.value).toBe(42)
  })
})

// =============================================================================
// Batch Resolution Tests
// =============================================================================

describe('batch conflict resolution', () => {
  it('should resolve multiple conflicts consistently', () => {
    const resolver = createClientWinsResolver<TestDocument>()

    const conflicts: ConflictContext<TestDocument>[] = [
      {
        key: 'doc-1',
        clientValue: { _id: 'doc-1', name: 'Client 1', value: 100, updatedAt: new Date() },
        serverValue: { _id: 'doc-1', name: 'Server 1', value: 10, updatedAt: new Date() },
        baseValue: { _id: 'doc-1', name: 'Base 1', value: 1, updatedAt: new Date() },
        timestamp: Date.now(),
      },
      {
        key: 'doc-2',
        clientValue: { _id: 'doc-2', name: 'Client 2', value: 200, updatedAt: new Date() },
        serverValue: { _id: 'doc-2', name: 'Server 2', value: 20, updatedAt: new Date() },
        baseValue: { _id: 'doc-2', name: 'Base 2', value: 2, updatedAt: new Date() },
        timestamp: Date.now(),
      },
      {
        key: 'doc-3',
        clientValue: { _id: 'doc-3', name: 'Client 3', value: 300, updatedAt: new Date() },
        serverValue: { _id: 'doc-3', name: 'Server 3', value: 30, updatedAt: new Date() },
        baseValue: { _id: 'doc-3', name: 'Base 3', value: 3, updatedAt: new Date() },
        timestamp: Date.now(),
      },
    ]

    const results = conflicts.map((conflict) => resolver.resolve(conflict))

    expect(results).toHaveLength(3)
    expect(results[0].resolvedValue.name).toBe('Client 1')
    expect(results[1].resolvedValue.name).toBe('Client 2')
    expect(results[2].resolvedValue.name).toBe('Client 3')

    // All should use client-wins strategy
    results.forEach((result) => {
      expect(result.strategy).toBe('client-wins')
    })
  })

  it('should support resolveBatch method if available', () => {
    const resolver = createClientWinsResolver<TestDocument>()

    // Check if batch resolution is supported
    if (typeof resolver.resolveBatch === 'function') {
      const conflicts: ConflictContext<TestDocument>[] = [
        {
          key: 'batch-1',
          clientValue: { _id: 'batch-1', name: 'Client', value: 1, updatedAt: new Date() },
          serverValue: { _id: 'batch-1', name: 'Server', value: 2, updatedAt: new Date() },
          baseValue: { _id: 'batch-1', name: 'Base', value: 0, updatedAt: new Date() },
          timestamp: Date.now(),
        },
      ]

      const results = resolver.resolveBatch(conflicts)

      expect(results).toHaveLength(1)
      expect(results[0].resolvedValue.name).toBe('Client')
    }
  })
})

// =============================================================================
// Integration Scenarios
// =============================================================================

describe('integration scenarios', () => {
  describe('offline-first scenario', () => {
    it('should preserve client changes made while offline', () => {
      const resolver = createClientWinsResolver<TestDocument>()

      // User made changes while offline
      const clientValue: TestDocument = {
        _id: 'offline-doc',
        name: 'Offline Edit',
        value: 999,
        updatedAt: new Date('2024-01-02T10:00:00Z'),
      }

      // Server had concurrent changes
      const serverValue: TestDocument = {
        _id: 'offline-doc',
        name: 'Server Edit',
        value: 500,
        updatedAt: new Date('2024-01-02T09:00:00Z'),
      }

      const context: ConflictContext<TestDocument> = {
        key: 'offline-doc',
        clientValue,
        serverValue,
        baseValue: {
          _id: 'offline-doc',
          name: 'Original',
          value: 100,
          updatedAt: new Date('2024-01-01'),
        },
        timestamp: Date.now(),
      }

      const result = resolver.resolve(context)

      // Client-wins ensures offline edits are preserved
      expect(result.resolvedValue).toEqual(clientValue)
    })
  })

  describe('concurrent editing scenario', () => {
    it('should always choose local user edits over remote edits', () => {
      const resolver = createClientWinsResolver<TestDocument>()

      // Two users editing the same document
      const localUserEdit: TestDocument = {
        _id: 'shared-doc',
        name: 'Local User Edit',
        value: 42,
        updatedAt: new Date(),
      }

      const remoteUserEdit: TestDocument = {
        _id: 'shared-doc',
        name: 'Remote User Edit',
        value: 100,
        updatedAt: new Date(),
      }

      const context: ConflictContext<TestDocument> = {
        key: 'shared-doc',
        clientValue: localUserEdit,
        serverValue: remoteUserEdit,
        baseValue: {
          _id: 'shared-doc',
          name: 'Original',
          value: 1,
          updatedAt: new Date(),
        },
        timestamp: Date.now(),
      }

      const result = resolver.resolve(context)

      // Local user's edits should win
      expect(result.resolvedValue).toEqual(localUserEdit)
    })
  })
})
