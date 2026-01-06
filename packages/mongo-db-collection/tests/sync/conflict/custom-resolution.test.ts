/**
 * Custom Conflict Resolution Strategy Tests (RED Phase - TDD)
 *
 * Layer 9: Custom Resolution Strategy for Conflict Resolution
 *
 * These tests verify the custom conflict resolution strategy which allows users
 * to provide their own conflict resolution function for fine-grained control
 * over how conflicts are resolved between client and server versions.
 *
 * RED PHASE: These tests will fail until the custom resolution strategy is implemented
 * in src/sync/conflict/custom-resolution.ts
 *
 * Bead ID: po0.215 (RED tests)
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createCustomResolutionStrategy,
  CustomResolutionStrategy,
  CustomResolutionStrategyConfig,
  applyCustomResolution,
  createMergeResolver,
  createFieldPriorityResolver,
  createTimestampResolver,
} from '../../../src/sync/conflict/custom-resolution'
import type {
  ConflictContext,
  ConflictResolution,
  ConflictResolver,
} from '../../../src/types'

// =============================================================================
// Test Types
// =============================================================================

/**
 * Test document type for basic conflict resolution testing.
 */
interface TestDocument {
  _id: string
  name: string
  value: number
  updatedAt: Date
  version?: number
}

/**
 * Complex document type for advanced conflict resolution testing.
 */
interface ComplexDocument {
  _id: string
  title: string
  content: string
  author: {
    id: string
    name: string
  }
  tags: string[]
  metadata: {
    views: number
    likes: number
    lastEditedBy: string
  }
  createdAt: Date
  updatedAt: Date
}

// =============================================================================
// Helper Functions
// =============================================================================

function createConflictContext<T>(
  serverVersion: T,
  clientVersion: T,
  options: Partial<Omit<ConflictContext<T>, 'serverVersion' | 'clientVersion'>> = {}
): ConflictContext<T> {
  return {
    serverVersion,
    clientVersion,
    serverTimestamp: options.serverTimestamp ?? new Date('2024-01-01T12:00:00Z'),
    clientTimestamp: options.clientTimestamp ?? new Date('2024-01-01T11:00:00Z'),
    key: options.key ?? 'test-key-1',
    baseVersion: options.baseVersion,
    conflictingFields: options.conflictingFields,
    metadata: options.metadata,
  }
}

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createCustomResolutionStrategy', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createCustomResolutionStrategy).toBe('function')
    })

    it('should return a CustomResolutionStrategy instance', () => {
      const resolver: ConflictResolver<TestDocument> = (context) => ({
        resolved: context.serverVersion,
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
      })

      expect(strategy).toBeDefined()
      expect(strategy.resolve).toBeInstanceOf(Function)
    })

    it('should throw when resolver is not provided', () => {
      expect(() =>
        createCustomResolutionStrategy<TestDocument>({
          resolver: undefined as unknown as ConflictResolver<TestDocument>,
        })
      ).toThrow('resolver is required')
    })

    it('should throw when resolver is not a function', () => {
      expect(() =>
        createCustomResolutionStrategy<TestDocument>({
          resolver: 'not a function' as unknown as ConflictResolver<TestDocument>,
        })
      ).toThrow('resolver must be a function')
    })

    it('should accept optional name for the strategy', () => {
      const resolver: ConflictResolver<TestDocument> = (context) => ({
        resolved: context.serverVersion,
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
        name: 'my-custom-strategy',
      })

      expect(strategy.name).toBe('my-custom-strategy')
    })

    it('should use default name when not provided', () => {
      const resolver: ConflictResolver<TestDocument> = (context) => ({
        resolved: context.serverVersion,
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
      })

      expect(strategy.name).toBe('custom')
    })
  })

  describe('resolution execution', () => {
    it('should call the resolver with the conflict context', async () => {
      const resolver = vi.fn().mockReturnValue({
        resolved: { _id: 'doc-1', name: 'Resolved', value: 100, updatedAt: new Date() },
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      await strategy.resolve(context)

      expect(resolver).toHaveBeenCalledTimes(1)
      expect(resolver).toHaveBeenCalledWith(context)
    })

    it('should return the resolution from the resolver', async () => {
      const expectedResolution: ConflictResolution<TestDocument> = {
        resolved: { _id: 'doc-1', name: 'Merged', value: 100, updatedAt: new Date() },
        resolutionMetadata: {
          strategy: 'merge',
          resolvedAt: new Date(),
        },
      }

      const resolver = vi.fn().mockReturnValue(expectedResolution)

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      const result = await strategy.resolve(context)

      expect(result).toEqual(expectedResolution)
    })

    it('should handle async resolvers', async () => {
      const resolver = vi.fn().mockResolvedValue({
        resolved: { _id: 'doc-1', name: 'Async Resolved', value: 100, updatedAt: new Date() },
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      const result = await strategy.resolve(context)

      expect(result.resolved.name).toBe('Async Resolved')
    })

    it('should propagate resolver errors', async () => {
      const resolver = vi.fn().mockImplementation(() => {
        throw new Error('Resolver failed')
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      await expect(strategy.resolve(context)).rejects.toThrow('Resolver failed')
    })
  })

  describe('fallback handling', () => {
    it('should use fallback when resolver returns null', async () => {
      const resolver = vi.fn().mockReturnValue(null)

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
        fallbackStrategy: 'server-wins',
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      const result = await strategy.resolve(context)

      expect(result.resolved).toEqual(context.serverVersion)
    })

    it('should use fallback when resolver returns undefined', async () => {
      const resolver = vi.fn().mockReturnValue(undefined)

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
        fallbackStrategy: 'client-wins',
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      const result = await strategy.resolve(context)

      expect(result.resolved).toEqual(context.clientVersion)
    })

    it('should use fallback when resolver throws and onError is set to fallback', async () => {
      const resolver = vi.fn().mockImplementation(() => {
        throw new Error('Resolver failed')
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
        fallbackStrategy: 'server-wins',
        onError: 'fallback',
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      const result = await strategy.resolve(context)

      expect(result.resolved).toEqual(context.serverVersion)
    })

    it('should throw when resolver throws and onError is set to throw', async () => {
      const resolver = vi.fn().mockImplementation(() => {
        throw new Error('Resolver failed')
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
        onError: 'throw',
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      await expect(strategy.resolve(context)).rejects.toThrow('Resolver failed')
    })

    it('should default to last-write-wins when no fallback specified', async () => {
      const resolver = vi.fn().mockReturnValue(null)

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
      })

      // Client timestamp is more recent
      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() },
        {
          serverTimestamp: new Date('2024-01-01T10:00:00Z'),
          clientTimestamp: new Date('2024-01-01T12:00:00Z'),
        }
      )

      const result = await strategy.resolve(context)

      expect(result.resolved).toEqual(context.clientVersion)
    })
  })

  describe('hooks and callbacks', () => {
    it('should call onBeforeResolve hook', async () => {
      const onBeforeResolve = vi.fn()
      const resolver: ConflictResolver<TestDocument> = (context) => ({
        resolved: context.serverVersion,
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
        onBeforeResolve,
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      await strategy.resolve(context)

      expect(onBeforeResolve).toHaveBeenCalledWith(context)
    })

    it('should call onAfterResolve hook with resolution', async () => {
      const onAfterResolve = vi.fn()
      const expectedResolution = {
        resolved: { _id: 'doc-1', name: 'Resolved', value: 100, updatedAt: new Date() },
      }
      const resolver = vi.fn().mockReturnValue(expectedResolution)

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
        onAfterResolve,
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      await strategy.resolve(context)

      expect(onAfterResolve).toHaveBeenCalledWith(context, expectedResolution)
    })

    it('should call onError hook when resolver throws', async () => {
      const onErrorCallback = vi.fn()
      const error = new Error('Resolver failed')
      const resolver = vi.fn().mockImplementation(() => {
        throw error
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
        onErrorCallback,
        onError: 'throw',
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      await expect(strategy.resolve(context)).rejects.toThrow()

      expect(onErrorCallback).toHaveBeenCalledWith(error, context)
    })
  })

  describe('validation', () => {
    it('should validate resolution has resolved property', async () => {
      const resolver = vi.fn().mockReturnValue({})

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
        validateResolution: true,
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      await expect(strategy.resolve(context)).rejects.toThrow(/resolved/)
    })

    it('should validate resolved document has _id', async () => {
      const resolver = vi.fn().mockReturnValue({
        resolved: { name: 'No ID', value: 100, updatedAt: new Date() },
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
        validateResolution: true,
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      await expect(strategy.resolve(context)).rejects.toThrow(/_id/)
    })

    it('should validate resolved document _id matches context key', async () => {
      const resolver = vi.fn().mockReturnValue({
        resolved: { _id: 'different-id', name: 'Wrong ID', value: 100, updatedAt: new Date() },
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
        validateResolution: true,
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() },
        { key: 'doc-1' }
      )

      await expect(strategy.resolve(context)).rejects.toThrow(/key/)
    })

    it('should skip validation when validateResolution is false', async () => {
      const resolver = vi.fn().mockReturnValue({
        resolved: { name: 'No ID', value: 100, updatedAt: new Date() },
      })

      const strategy = createCustomResolutionStrategy<TestDocument>({
        resolver,
        validateResolution: false,
      })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      const result = await strategy.resolve(context)

      expect(result.resolved).toEqual({ name: 'No ID', value: 100, updatedAt: expect.any(Date) })
    })
  })
})

// =============================================================================
// Direct Apply Function Tests
// =============================================================================

describe('applyCustomResolution', () => {
  it('should be a function', () => {
    expect(typeof applyCustomResolution).toBe('function')
  })

  it('should apply a resolver to a conflict context', async () => {
    const resolver: ConflictResolver<TestDocument> = (context) => ({
      resolved: {
        ...context.serverVersion,
        value: context.clientVersion.value,
      },
    })

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
      { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
    )

    const result = await applyCustomResolution(context, resolver)

    expect(result.resolved.name).toBe('Server')
    expect(result.resolved.value).toBe(75)
  })

  it('should handle async resolvers', async () => {
    const resolver: ConflictResolver<TestDocument> = async (context) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        resolved: context.clientVersion,
      }
    }

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
      { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
    )

    const result = await applyCustomResolution(context, resolver)

    expect(result.resolved).toEqual(context.clientVersion)
  })
})

// =============================================================================
// Built-in Resolver Factory Tests
// =============================================================================

describe('createMergeResolver', () => {
  it('should be a function', () => {
    expect(typeof createMergeResolver).toBe('function')
  })

  it('should create a resolver that merges server and client versions', async () => {
    const resolver = createMergeResolver<TestDocument>()

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server Name', value: 50, updatedAt: new Date('2024-01-01') },
      { _id: 'doc-1', name: 'Client Name', value: 75, updatedAt: new Date('2024-01-02') }
    )

    const result = resolver(context)

    // Default merge: client wins for all fields
    expect(result.resolved.name).toBe('Client Name')
    expect(result.resolved.value).toBe(75)
  })

  it('should accept field priority configuration', async () => {
    const resolver = createMergeResolver<TestDocument>({
      serverFields: ['name'],
      clientFields: ['value'],
    })

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server Name', value: 50, updatedAt: new Date() },
      { _id: 'doc-1', name: 'Client Name', value: 75, updatedAt: new Date() }
    )

    const result = resolver(context)

    expect(result.resolved.name).toBe('Server Name')
    expect(result.resolved.value).toBe(75)
  })

  it('should include resolution metadata', async () => {
    const resolver = createMergeResolver<TestDocument>({
      serverFields: ['name'],
      clientFields: ['value'],
    })

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server Name', value: 50, updatedAt: new Date() },
      { _id: 'doc-1', name: 'Client Name', value: 75, updatedAt: new Date() }
    )

    const result = resolver(context)

    expect(result.resolutionMetadata).toBeDefined()
    expect(result.resolutionMetadata?.strategy).toBe('merge')
    expect(result.resolutionMetadata?.serverFields).toContain('name')
    expect(result.resolutionMetadata?.clientFields).toContain('value')
  })

  it('should handle nested objects with deep merge', async () => {
    const resolver = createMergeResolver<ComplexDocument>({
      deepMerge: true,
    })

    const serverDoc: ComplexDocument = {
      _id: 'doc-1',
      title: 'Server Title',
      content: 'Server Content',
      author: { id: 'author-1', name: 'Server Author' },
      tags: ['server-tag'],
      metadata: { views: 100, likes: 10, lastEditedBy: 'server' },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const clientDoc: ComplexDocument = {
      _id: 'doc-1',
      title: 'Client Title',
      content: 'Client Content',
      author: { id: 'author-1', name: 'Client Author' },
      tags: ['client-tag'],
      metadata: { views: 150, likes: 15, lastEditedBy: 'client' },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const context = createConflictContext<ComplexDocument>(serverDoc, clientDoc)

    const result = resolver(context)

    // Deep merge should combine nested properties
    expect(result.resolved.metadata.views).toBe(150) // Client wins for nested
  })
})

describe('createFieldPriorityResolver', () => {
  it('should be a function', () => {
    expect(typeof createFieldPriorityResolver).toBe('function')
  })

  it('should resolve based on field priority rules', async () => {
    const resolver = createFieldPriorityResolver<TestDocument>({
      rules: {
        name: 'server',
        value: 'client',
        updatedAt: 'latest',
      },
    })

    const context = createConflictContext<TestDocument>(
      {
        _id: 'doc-1',
        name: 'Server Name',
        value: 50,
        updatedAt: new Date('2024-01-01'),
      },
      {
        _id: 'doc-1',
        name: 'Client Name',
        value: 75,
        updatedAt: new Date('2024-01-02'),
      }
    )

    const result = resolver(context)

    expect(result.resolved.name).toBe('Server Name')
    expect(result.resolved.value).toBe(75)
    expect(result.resolved.updatedAt).toEqual(new Date('2024-01-02'))
  })

  it('should support custom field resolvers', async () => {
    const resolver = createFieldPriorityResolver<TestDocument>({
      rules: {
        value: (serverValue, clientValue) => Math.max(serverValue as number, clientValue as number),
      },
    })

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server', value: 100, updatedAt: new Date() },
      { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
    )

    const result = resolver(context)

    expect(result.resolved.value).toBe(100)
  })

  it('should fall back to default for unspecified fields', async () => {
    const resolver = createFieldPriorityResolver<TestDocument>({
      rules: {
        name: 'server',
      },
      defaultPriority: 'client',
    })

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
      { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
    )

    const result = resolver(context)

    expect(result.resolved.name).toBe('Server')
    expect(result.resolved.value).toBe(75) // Client wins (default)
  })
})

describe('createTimestampResolver', () => {
  it('should be a function', () => {
    expect(typeof createTimestampResolver).toBe('function')
  })

  it('should resolve to the most recent version', async () => {
    const resolver = createTimestampResolver<TestDocument>()

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
      { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() },
      {
        serverTimestamp: new Date('2024-01-01T10:00:00Z'),
        clientTimestamp: new Date('2024-01-01T12:00:00Z'),
      }
    )

    const result = resolver(context)

    expect(result.resolved).toEqual(context.clientVersion)
  })

  it('should resolve to server when server is more recent', async () => {
    const resolver = createTimestampResolver<TestDocument>()

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
      { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() },
      {
        serverTimestamp: new Date('2024-01-01T14:00:00Z'),
        clientTimestamp: new Date('2024-01-01T12:00:00Z'),
      }
    )

    const result = resolver(context)

    expect(result.resolved).toEqual(context.serverVersion)
  })

  it('should use custom timestamp extractor when provided', async () => {
    const resolver = createTimestampResolver<TestDocument>({
      getTimestamp: (doc) => doc.updatedAt,
    })

    const serverDoc = { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date('2024-01-01T10:00:00Z') }
    const clientDoc = { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date('2024-01-01T12:00:00Z') }

    const context = createConflictContext<TestDocument>(serverDoc, clientDoc)

    const result = resolver(context)

    expect(result.resolved).toEqual(clientDoc)
  })

  it('should handle tie-breaker when timestamps are equal', async () => {
    const sameTime = new Date('2024-01-01T12:00:00Z')
    const resolver = createTimestampResolver<TestDocument>({
      tieBreaker: 'server',
    })

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
      { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() },
      {
        serverTimestamp: sameTime,
        clientTimestamp: sameTime,
      }
    )

    const result = resolver(context)

    expect(result.resolved).toEqual(context.serverVersion)
  })
})

// =============================================================================
// Complex Resolution Scenarios
// =============================================================================

describe('complex resolution scenarios', () => {
  describe('three-way merge with base version', () => {
    it('should detect actual conflicts using base version', async () => {
      const resolver = createMergeResolver<TestDocument>({
        useBaseVersion: true,
      })

      const baseDoc = { _id: 'doc-1', name: 'Original', value: 50, updatedAt: new Date('2024-01-01') }
      const serverDoc = { _id: 'doc-1', name: 'Server Change', value: 50, updatedAt: new Date('2024-01-02') }
      const clientDoc = { _id: 'doc-1', name: 'Original', value: 75, updatedAt: new Date('2024-01-02') }

      const context = createConflictContext<TestDocument>(serverDoc, clientDoc, {
        baseVersion: baseDoc,
      })

      const result = resolver(context)

      // Only 'name' changed on server, only 'value' changed on client - no real conflict
      expect(result.resolved.name).toBe('Server Change')
      expect(result.resolved.value).toBe(75)
    })

    it('should identify conflicting fields when both sides changed same field', async () => {
      const resolver = createMergeResolver<TestDocument>({
        useBaseVersion: true,
        conflictFieldResolver: 'client',
      })

      const baseDoc = { _id: 'doc-1', name: 'Original', value: 50, updatedAt: new Date('2024-01-01') }
      const serverDoc = { _id: 'doc-1', name: 'Server Change', value: 100, updatedAt: new Date('2024-01-02') }
      const clientDoc = { _id: 'doc-1', name: 'Client Change', value: 75, updatedAt: new Date('2024-01-02') }

      const context = createConflictContext<TestDocument>(serverDoc, clientDoc, {
        baseVersion: baseDoc,
        conflictingFields: ['name', 'value'],
      })

      const result = resolver(context)

      // Both 'name' and 'value' are true conflicts - client wins
      expect(result.resolved.name).toBe('Client Change')
      expect(result.resolved.value).toBe(75)
    })
  })

  describe('version-based resolution', () => {
    it('should resolve based on version numbers when available', async () => {
      const resolver: ConflictResolver<TestDocument> = (context) => {
        const serverVersion = context.serverVersion.version ?? 0
        const clientVersion = context.clientVersion.version ?? 0

        if (serverVersion > clientVersion) {
          return { resolved: context.serverVersion }
        }
        return { resolved: context.clientVersion }
      }

      const strategy = createCustomResolutionStrategy<TestDocument>({ resolver })

      const context = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date(), version: 5 },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date(), version: 3 }
      )

      const result = await strategy.resolve(context)

      expect(result.resolved.name).toBe('Server')
      expect(result.resolved.version).toBe(5)
    })
  })

  describe('conditional resolution', () => {
    it('should apply different strategies based on document state', async () => {
      const resolver: ConflictResolver<TestDocument> = (context) => {
        // If server value is much higher, prefer server
        if (context.serverVersion.value > context.clientVersion.value * 2) {
          return { resolved: context.serverVersion }
        }
        // Otherwise, merge
        return {
          resolved: {
            ...context.serverVersion,
            value: Math.max(context.serverVersion.value, context.clientVersion.value),
          },
        }
      }

      const strategy = createCustomResolutionStrategy<TestDocument>({ resolver })

      // Case 1: Server value is much higher
      const context1 = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 200, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 50, updatedAt: new Date() }
      )

      const result1 = await strategy.resolve(context1)
      expect(result1.resolved.value).toBe(200)

      // Case 2: Values are closer - merge
      const context2 = createConflictContext<TestDocument>(
        { _id: 'doc-1', name: 'Server', value: 80, updatedAt: new Date() },
        { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
      )

      const result2 = await strategy.resolve(context2)
      expect(result2.resolved.value).toBe(80)
    })
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('type safety', () => {
  it('should maintain generic type through resolution', async () => {
    const resolver: ConflictResolver<TestDocument> = (context) => ({
      resolved: {
        _id: context.clientVersion._id,
        name: context.clientVersion.name,
        value: context.serverVersion.value,
        updatedAt: new Date(),
      },
    })

    const strategy = createCustomResolutionStrategy<TestDocument>({ resolver })

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
      { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
    )

    const result = await strategy.resolve(context)

    // TypeScript should infer the correct type
    const doc: TestDocument = result.resolved
    expect(doc._id).toBe('doc-1')
    expect(doc.name).toBe('Client')
    expect(doc.value).toBe(50)
  })
})

// =============================================================================
// Strategy Lifecycle Tests
// =============================================================================

describe('strategy lifecycle', () => {
  it('should support dispose method', async () => {
    const cleanup = vi.fn()
    const resolver: ConflictResolver<TestDocument> = (context) => ({
      resolved: context.serverVersion,
    })

    const strategy = createCustomResolutionStrategy<TestDocument>({
      resolver,
      onDispose: cleanup,
    })

    strategy.dispose()

    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('should reject resolution after dispose', async () => {
    const resolver: ConflictResolver<TestDocument> = (context) => ({
      resolved: context.serverVersion,
    })

    const strategy = createCustomResolutionStrategy<TestDocument>({ resolver })

    strategy.dispose()

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
      { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
    )

    await expect(strategy.resolve(context)).rejects.toThrow(/disposed/)
  })

  it('should track resolution statistics when enabled', async () => {
    const resolver: ConflictResolver<TestDocument> = (context) => ({
      resolved: context.serverVersion,
    })

    const strategy = createCustomResolutionStrategy<TestDocument>({
      resolver,
      enableMetrics: true,
    })

    const context = createConflictContext<TestDocument>(
      { _id: 'doc-1', name: 'Server', value: 50, updatedAt: new Date() },
      { _id: 'doc-1', name: 'Client', value: 75, updatedAt: new Date() }
    )

    await strategy.resolve(context)
    await strategy.resolve(context)

    const stats = strategy.getStats()

    expect(stats.totalResolutions).toBe(2)
    expect(stats.successfulResolutions).toBe(2)
    expect(stats.failedResolutions).toBe(0)
  })
})
