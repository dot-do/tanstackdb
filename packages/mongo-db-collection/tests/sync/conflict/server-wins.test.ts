/**
 * @file Server-Wins Conflict Resolution Strategy Tests (RED Phase - TDD)
 *
 * Tests for Layer 9 conflict resolution using the Server-Wins strategy.
 * The Server-Wins strategy always accepts the server's version when
 * conflicts occur between client and server modifications.
 *
 * RED PHASE: These tests will fail until the server-wins resolver is implemented
 * in src/sync/conflict/server-wins.ts
 *
 * @see ConflictStrategy type in types/index.ts
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  createServerWinsResolver,
  serverWinsResolver,
  resolveServerWins,
  type ServerWinsResolverConfig,
  type ServerWinsResolverResult,
} from '../../../src/sync/conflict/server-wins'
import type { ConflictContext, ConflictResolution } from '../../../src/types'

// =============================================================================
// Test Document Types
// =============================================================================

interface User {
  _id: string
  name: string
  email: string
  age: number
  role: 'admin' | 'user' | 'guest'
  updatedAt: Date
}

interface Product {
  _id: string
  sku: string
  title: string
  price: number
  inventory: number
  lastModifiedBy: string
}

interface Document {
  _id: string
  title: string
  content: string
  version: number
  tags: string[]
}

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createServerWinsResolver', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createServerWinsResolver).toBe('function')
    })

    it('should return a resolver function', () => {
      const resolver = createServerWinsResolver<User>()
      expect(typeof resolver).toBe('function')
    })

    it('should return a resolver that can be used as ConflictResolver', () => {
      const resolver = createServerWinsResolver<User>()

      const context: ConflictContext<User> = {
        serverVersion: {
          _id: 'user-1',
          name: 'Server Name',
          email: 'server@example.com',
          age: 30,
          role: 'admin',
          updatedAt: new Date('2024-01-15'),
        },
        clientVersion: {
          _id: 'user-1',
          name: 'Client Name',
          email: 'client@example.com',
          age: 25,
          role: 'user',
          updatedAt: new Date('2024-01-14'),
        },
        serverTimestamp: new Date('2024-01-15'),
        clientTimestamp: new Date('2024-01-14'),
        key: 'user-1',
      }

      const result = resolver(context)

      expect(result).toHaveProperty('resolved')
      expect(result.resolved).toEqual(context.serverVersion)
    })
  })

  describe('with configuration options', () => {
    it('should accept empty configuration', () => {
      const resolver = createServerWinsResolver<User>({})
      expect(typeof resolver).toBe('function')
    })

    it('should accept includeMetadata option', () => {
      const resolver = createServerWinsResolver<User>({
        includeMetadata: true,
      })

      const context: ConflictContext<User> = {
        serverVersion: {
          _id: 'user-1',
          name: 'Server',
          email: 'server@example.com',
          age: 30,
          role: 'admin',
          updatedAt: new Date(),
        },
        clientVersion: {
          _id: 'user-1',
          name: 'Client',
          email: 'client@example.com',
          age: 25,
          role: 'user',
          updatedAt: new Date(),
        },
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        key: 'user-1',
      }

      const result = resolver(context)

      expect(result.resolutionMetadata).toBeDefined()
      expect(result.resolutionMetadata?.strategy).toBe('server-wins')
    })

    it('should accept onResolve callback', () => {
      let callbackCalled = false
      let callbackContext: ConflictContext<User> | undefined

      const resolver = createServerWinsResolver<User>({
        onResolve: (ctx) => {
          callbackCalled = true
          callbackContext = ctx
        },
      })

      const context: ConflictContext<User> = {
        serverVersion: {
          _id: 'user-1',
          name: 'Server',
          email: 'server@example.com',
          age: 30,
          role: 'admin',
          updatedAt: new Date(),
        },
        clientVersion: {
          _id: 'user-1',
          name: 'Client',
          email: 'client@example.com',
          age: 25,
          role: 'user',
          updatedAt: new Date(),
        },
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        key: 'user-1',
      }

      resolver(context)

      expect(callbackCalled).toBe(true)
      expect(callbackContext).toEqual(context)
    })

    it('should accept preserveClientFields option', () => {
      const resolver = createServerWinsResolver<User>({
        preserveClientFields: ['email'],
      })

      const context: ConflictContext<User> = {
        serverVersion: {
          _id: 'user-1',
          name: 'Server Name',
          email: 'server@example.com',
          age: 30,
          role: 'admin',
          updatedAt: new Date('2024-01-15'),
        },
        clientVersion: {
          _id: 'user-1',
          name: 'Client Name',
          email: 'client@example.com',
          age: 25,
          role: 'user',
          updatedAt: new Date('2024-01-14'),
        },
        serverTimestamp: new Date('2024-01-15'),
        clientTimestamp: new Date('2024-01-14'),
        key: 'user-1',
      }

      const result = resolver(context)

      // Server wins for most fields, but client email is preserved
      expect(result.resolved.name).toBe('Server Name')
      expect(result.resolved.age).toBe(30)
      expect(result.resolved.email).toBe('client@example.com')
    })
  })
})

// =============================================================================
// Default Resolver Tests
// =============================================================================

describe('serverWinsResolver', () => {
  it('should be a pre-configured resolver function', () => {
    expect(typeof serverWinsResolver).toBe('function')
  })

  it('should always return server version', () => {
    const context: ConflictContext<User> = {
      serverVersion: {
        _id: 'user-123',
        name: 'Server User',
        email: 'server@example.com',
        age: 35,
        role: 'admin',
        updatedAt: new Date('2024-01-20'),
      },
      clientVersion: {
        _id: 'user-123',
        name: 'Client User',
        email: 'client@example.com',
        age: 28,
        role: 'user',
        updatedAt: new Date('2024-01-19'),
      },
      serverTimestamp: new Date('2024-01-20'),
      clientTimestamp: new Date('2024-01-19'),
      key: 'user-123',
    }

    const result = serverWinsResolver(context)

    expect(result.resolved).toEqual(context.serverVersion)
  })

  it('should work when client timestamp is newer than server', () => {
    const context: ConflictContext<User> = {
      serverVersion: {
        _id: 'user-1',
        name: 'Server',
        email: 'server@example.com',
        age: 30,
        role: 'admin',
        updatedAt: new Date('2024-01-10'),
      },
      clientVersion: {
        _id: 'user-1',
        name: 'Client',
        email: 'client@example.com',
        age: 25,
        role: 'user',
        updatedAt: new Date('2024-01-20'),
      },
      serverTimestamp: new Date('2024-01-10'),
      clientTimestamp: new Date('2024-01-20'),
      key: 'user-1',
    }

    const result = serverWinsResolver(context)

    // Server wins even when client is newer
    expect(result.resolved).toEqual(context.serverVersion)
    expect(result.resolved.name).toBe('Server')
  })

  it('should preserve _id from server version', () => {
    const context: ConflictContext<Product> = {
      serverVersion: {
        _id: 'prod-server-id',
        sku: 'SKU-001',
        title: 'Server Title',
        price: 100,
        inventory: 50,
        lastModifiedBy: 'admin',
      },
      clientVersion: {
        _id: 'prod-client-id',
        sku: 'SKU-001',
        title: 'Client Title',
        price: 90,
        inventory: 45,
        lastModifiedBy: 'user',
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'prod-server-id',
    }

    const result = serverWinsResolver(context)

    expect(result.resolved._id).toBe('prod-server-id')
  })

  it('should return valid ConflictResolution structure', () => {
    const context: ConflictContext<User> = {
      serverVersion: {
        _id: 'user-1',
        name: 'Server',
        email: 'server@example.com',
        age: 30,
        role: 'admin',
        updatedAt: new Date(),
      },
      clientVersion: {
        _id: 'user-1',
        name: 'Client',
        email: 'client@example.com',
        age: 25,
        role: 'user',
        updatedAt: new Date(),
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'user-1',
    }

    const result: ConflictResolution<User> = serverWinsResolver(context)

    expect(result).toHaveProperty('resolved')
    expect(typeof result.resolved).toBe('object')
  })
})

// =============================================================================
// Direct Resolution Function Tests
// =============================================================================

describe('resolveServerWins', () => {
  it('should be a function', () => {
    expect(typeof resolveServerWins).toBe('function')
  })

  it('should resolve conflict with server version', () => {
    const serverVersion: User = {
      _id: 'user-1',
      name: 'Server User',
      email: 'server@example.com',
      age: 40,
      role: 'admin',
      updatedAt: new Date('2024-01-15'),
    }

    const clientVersion: User = {
      _id: 'user-1',
      name: 'Client User',
      email: 'client@example.com',
      age: 35,
      role: 'user',
      updatedAt: new Date('2024-01-14'),
    }

    const result = resolveServerWins(serverVersion, clientVersion)

    expect(result).toEqual(serverVersion)
  })

  it('should return new object reference, not the same object', () => {
    const serverVersion: User = {
      _id: 'user-1',
      name: 'Server',
      email: 'server@example.com',
      age: 30,
      role: 'admin',
      updatedAt: new Date(),
    }

    const clientVersion: User = {
      _id: 'user-1',
      name: 'Client',
      email: 'client@example.com',
      age: 25,
      role: 'user',
      updatedAt: new Date(),
    }

    const result = resolveServerWins(serverVersion, clientVersion)

    // Should be equal in value
    expect(result).toEqual(serverVersion)
    // But should be a new reference (shallow copy)
    expect(result).not.toBe(serverVersion)
  })

  it('should handle documents with nested objects', () => {
    interface NestedDoc {
      _id: string
      metadata: {
        createdBy: string
        tags: string[]
      }
    }

    const serverVersion: NestedDoc = {
      _id: 'doc-1',
      metadata: {
        createdBy: 'server-user',
        tags: ['server', 'important'],
      },
    }

    const clientVersion: NestedDoc = {
      _id: 'doc-1',
      metadata: {
        createdBy: 'client-user',
        tags: ['client', 'draft'],
      },
    }

    const result = resolveServerWins(serverVersion, clientVersion)

    expect(result.metadata.createdBy).toBe('server-user')
    expect(result.metadata.tags).toEqual(['server', 'important'])
  })

  it('should handle documents with array fields', () => {
    const serverVersion: Document = {
      _id: 'doc-1',
      title: 'Server Title',
      content: 'Server content',
      version: 2,
      tags: ['server', 'approved'],
    }

    const clientVersion: Document = {
      _id: 'doc-1',
      title: 'Client Title',
      content: 'Client content',
      version: 1,
      tags: ['client', 'draft'],
    }

    const result = resolveServerWins(serverVersion, clientVersion)

    expect(result.tags).toEqual(['server', 'approved'])
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  it('should handle identical server and client versions', () => {
    const version: User = {
      _id: 'user-1',
      name: 'Same Name',
      email: 'same@example.com',
      age: 30,
      role: 'user',
      updatedAt: new Date('2024-01-15'),
    }

    const context: ConflictContext<User> = {
      serverVersion: { ...version },
      clientVersion: { ...version },
      serverTimestamp: new Date('2024-01-15'),
      clientTimestamp: new Date('2024-01-15'),
      key: 'user-1',
    }

    const result = serverWinsResolver(context)

    expect(result.resolved).toEqual(version)
  })

  it('should handle documents with null fields', () => {
    interface DocWithNullable {
      _id: string
      name: string
      description: string | null
    }

    const context: ConflictContext<DocWithNullable> = {
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        description: null,
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        description: 'Client description',
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'doc-1',
    }

    const result = serverWinsResolver(context)

    expect(result.resolved.description).toBeNull()
  })

  it('should handle documents with undefined fields', () => {
    interface DocWithOptional {
      _id: string
      name: string
      optionalField?: string
    }

    const context: ConflictContext<DocWithOptional> = {
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        // optionalField is undefined
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        optionalField: 'Client Value',
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'doc-1',
    }

    const result = serverWinsResolver(context)

    expect(result.resolved.optionalField).toBeUndefined()
  })

  it('should handle empty objects', () => {
    interface MinimalDoc {
      _id: string
    }

    const context: ConflictContext<MinimalDoc> = {
      serverVersion: { _id: 'doc-1' },
      clientVersion: { _id: 'doc-1' },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'doc-1',
    }

    const result = serverWinsResolver(context)

    expect(result.resolved).toEqual({ _id: 'doc-1' })
  })

  it('should handle documents with Date fields', () => {
    const serverDate = new Date('2024-01-15T10:00:00Z')
    const clientDate = new Date('2024-01-14T10:00:00Z')

    const context: ConflictContext<User> = {
      serverVersion: {
        _id: 'user-1',
        name: 'Server',
        email: 'server@example.com',
        age: 30,
        role: 'admin',
        updatedAt: serverDate,
      },
      clientVersion: {
        _id: 'user-1',
        name: 'Client',
        email: 'client@example.com',
        age: 25,
        role: 'user',
        updatedAt: clientDate,
      },
      serverTimestamp: serverDate,
      clientTimestamp: clientDate,
      key: 'user-1',
    }

    const result = serverWinsResolver(context)

    expect(result.resolved.updatedAt).toEqual(serverDate)
  })

  it('should handle context with conflictingFields', () => {
    const context: ConflictContext<User> = {
      serverVersion: {
        _id: 'user-1',
        name: 'Server Name',
        email: 'server@example.com',
        age: 30,
        role: 'admin',
        updatedAt: new Date(),
      },
      clientVersion: {
        _id: 'user-1',
        name: 'Client Name',
        email: 'client@example.com',
        age: 25,
        role: 'user',
        updatedAt: new Date(),
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'user-1',
      conflictingFields: ['name', 'email', 'age', 'role'],
    }

    const result = serverWinsResolver(context)

    // Server wins regardless of conflicting fields
    expect(result.resolved.name).toBe('Server Name')
    expect(result.resolved.email).toBe('server@example.com')
  })

  it('should handle context with baseVersion', () => {
    const context: ConflictContext<User> = {
      serverVersion: {
        _id: 'user-1',
        name: 'Server',
        email: 'server@example.com',
        age: 35,
        role: 'admin',
        updatedAt: new Date('2024-01-15'),
      },
      clientVersion: {
        _id: 'user-1',
        name: 'Client',
        email: 'client@example.com',
        age: 30,
        role: 'user',
        updatedAt: new Date('2024-01-14'),
      },
      baseVersion: {
        _id: 'user-1',
        name: 'Original',
        email: 'original@example.com',
        age: 25,
        role: 'guest',
        updatedAt: new Date('2024-01-01'),
      },
      serverTimestamp: new Date('2024-01-15'),
      clientTimestamp: new Date('2024-01-14'),
      key: 'user-1',
    }

    const result = serverWinsResolver(context)

    // Server wins, base version is ignored in server-wins strategy
    expect(result.resolved).toEqual(context.serverVersion)
  })

  it('should handle context with metadata', () => {
    const context: ConflictContext<User> = {
      serverVersion: {
        _id: 'user-1',
        name: 'Server',
        email: 'server@example.com',
        age: 30,
        role: 'admin',
        updatedAt: new Date(),
      },
      clientVersion: {
        _id: 'user-1',
        name: 'Client',
        email: 'client@example.com',
        age: 25,
        role: 'user',
        updatedAt: new Date(),
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'user-1',
      metadata: {
        source: 'websocket',
        conflictCount: 3,
      },
    }

    const result = serverWinsResolver(context)

    expect(result.resolved).toEqual(context.serverVersion)
  })
})

// =============================================================================
// Metadata Tests
// =============================================================================

describe('resolution metadata', () => {
  it('should include strategy in metadata when configured', () => {
    const resolver = createServerWinsResolver<User>({
      includeMetadata: true,
    })

    const context: ConflictContext<User> = {
      serverVersion: {
        _id: 'user-1',
        name: 'Server',
        email: 'server@example.com',
        age: 30,
        role: 'admin',
        updatedAt: new Date(),
      },
      clientVersion: {
        _id: 'user-1',
        name: 'Client',
        email: 'client@example.com',
        age: 25,
        role: 'user',
        updatedAt: new Date(),
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'user-1',
    }

    const result = resolver(context)

    expect(result.resolutionMetadata?.strategy).toBe('server-wins')
  })

  it('should include resolvedAt timestamp in metadata', () => {
    const resolver = createServerWinsResolver<User>({
      includeMetadata: true,
    })

    const context: ConflictContext<User> = {
      serverVersion: {
        _id: 'user-1',
        name: 'Server',
        email: 'server@example.com',
        age: 30,
        role: 'admin',
        updatedAt: new Date(),
      },
      clientVersion: {
        _id: 'user-1',
        name: 'Client',
        email: 'client@example.com',
        age: 25,
        role: 'user',
        updatedAt: new Date(),
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'user-1',
    }

    const before = new Date()
    const result = resolver(context)
    const after = new Date()

    expect(result.resolutionMetadata?.resolvedAt).toBeDefined()
    expect(result.resolutionMetadata?.resolvedAt!.getTime()).toBeGreaterThanOrEqual(
      before.getTime()
    )
    expect(result.resolutionMetadata?.resolvedAt!.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('should include serverFields in metadata showing all fields came from server', () => {
    const resolver = createServerWinsResolver<User>({
      includeMetadata: true,
    })

    const context: ConflictContext<User> = {
      serverVersion: {
        _id: 'user-1',
        name: 'Server',
        email: 'server@example.com',
        age: 30,
        role: 'admin',
        updatedAt: new Date(),
      },
      clientVersion: {
        _id: 'user-1',
        name: 'Client',
        email: 'client@example.com',
        age: 25,
        role: 'user',
        updatedAt: new Date(),
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'user-1',
    }

    const result = resolver(context)

    expect(result.resolutionMetadata?.serverFields).toBeDefined()
    expect(result.resolutionMetadata?.serverFields).toContain('name')
    expect(result.resolutionMetadata?.serverFields).toContain('email')
    expect(result.resolutionMetadata?.serverFields).toContain('age')
  })

  it('should have empty clientFields in metadata (server wins everything)', () => {
    const resolver = createServerWinsResolver<User>({
      includeMetadata: true,
    })

    const context: ConflictContext<User> = {
      serverVersion: {
        _id: 'user-1',
        name: 'Server',
        email: 'server@example.com',
        age: 30,
        role: 'admin',
        updatedAt: new Date(),
      },
      clientVersion: {
        _id: 'user-1',
        name: 'Client',
        email: 'client@example.com',
        age: 25,
        role: 'user',
        updatedAt: new Date(),
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'user-1',
    }

    const result = resolver(context)

    expect(result.resolutionMetadata?.clientFields).toBeDefined()
    expect(result.resolutionMetadata?.clientFields).toEqual([])
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('type safety', () => {
  it('should preserve document type through resolution', () => {
    const context: ConflictContext<User> = {
      serverVersion: {
        _id: 'user-1',
        name: 'Server',
        email: 'server@example.com',
        age: 30,
        role: 'admin',
        updatedAt: new Date(),
      },
      clientVersion: {
        _id: 'user-1',
        name: 'Client',
        email: 'client@example.com',
        age: 25,
        role: 'user',
        updatedAt: new Date(),
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'user-1',
    }

    const result = serverWinsResolver(context)

    // Type assertion - should compile without errors
    const resolved: User = result.resolved
    expect(resolved.name).toBe('Server')
    expect(resolved.email).toBe('server@example.com')
    expect(resolved.age).toBe(30)
    expect(resolved.role).toBe('admin')
  })

  it('should work with different document types', () => {
    const productResolver = createServerWinsResolver<Product>()

    const context: ConflictContext<Product> = {
      serverVersion: {
        _id: 'prod-1',
        sku: 'SKU-SERVER',
        title: 'Server Product',
        price: 100,
        inventory: 50,
        lastModifiedBy: 'admin',
      },
      clientVersion: {
        _id: 'prod-1',
        sku: 'SKU-CLIENT',
        title: 'Client Product',
        price: 90,
        inventory: 45,
        lastModifiedBy: 'user',
      },
      serverTimestamp: new Date(),
      clientTimestamp: new Date(),
      key: 'prod-1',
    }

    const result = productResolver(context)

    const resolved: Product = result.resolved
    expect(resolved.sku).toBe('SKU-SERVER')
    expect(resolved.price).toBe(100)
  })
})

// =============================================================================
// Type Definition Tests
// =============================================================================

describe('ServerWinsResolverConfig types', () => {
  it('should have optional includeMetadata property', () => {
    expectTypeOf<ServerWinsResolverConfig<User>>().toHaveProperty('includeMetadata')
    expectTypeOf<ServerWinsResolverConfig<User>['includeMetadata']>().toEqualTypeOf<
      boolean | undefined
    >()
  })

  it('should have optional onResolve callback property', () => {
    expectTypeOf<ServerWinsResolverConfig<User>>().toHaveProperty('onResolve')
  })

  it('should have optional preserveClientFields property', () => {
    expectTypeOf<ServerWinsResolverConfig<User>>().toHaveProperty('preserveClientFields')
    expectTypeOf<ServerWinsResolverConfig<User>['preserveClientFields']>().toEqualTypeOf<
      Array<keyof User> | undefined
    >()
  })
})

describe('ServerWinsResolverResult types', () => {
  it('should have resolved property matching document type', () => {
    expectTypeOf<ServerWinsResolverResult<User>['resolved']>().toEqualTypeOf<User>()
  })

  it('should have optional resolutionMetadata property', () => {
    expectTypeOf<ServerWinsResolverResult<User>>().toHaveProperty('resolutionMetadata')
  })

  it('should extend ConflictResolution interface', () => {
    expectTypeOf<ServerWinsResolverResult<User>>().toMatchTypeOf<ConflictResolution<User>>()
  })
})
