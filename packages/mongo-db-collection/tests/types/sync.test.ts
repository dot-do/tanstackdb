/**
 * @file Sync Config Type Tests (RED Phase - TDD)
 *
 * These tests verify that sync configuration types for @tanstack/mongo-db-collection
 * are correctly defined and match TanStack DB's sync interface requirements.
 *
 * Types being tested:
 * - SyncParams<T>: Parameters passed to sync function
 * - SyncReturn: Return type from sync function
 * - SyncMode: Sync strategy types
 * - ConflictStrategy: Conflict resolution strategy types
 *
 * RED PHASE: These tests will fail until the types are implemented in src/types.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expectTypeOf } from 'vitest'
import type {
  SyncParams,
  SyncReturn,
  SyncMode,
  ConflictStrategy,
  ChangeMessage,
  LoadSubsetOptions,
} from '../../src/types'
import type { Collection } from '@tanstack/db'

// Test entity type
interface TestDocument {
  _id: string
  name: string
  value: number
  createdAt: Date
}

describe('Sync Config Types', () => {
  describe('SyncParams<T>', () => {
    it('should have begin method that returns void', () => {
      type BeginFn = SyncParams<TestDocument>['begin']
      expectTypeOf<BeginFn>().toBeFunction()
      expectTypeOf<ReturnType<BeginFn>>().toBeVoid()
    })

    it('should have write method that accepts ChangeMessage<T> and returns void', () => {
      type WriteFn = SyncParams<TestDocument>['write']
      expectTypeOf<WriteFn>().toBeFunction()
      expectTypeOf<Parameters<WriteFn>[0]>().toMatchTypeOf<ChangeMessage<TestDocument>>()
      expectTypeOf<ReturnType<WriteFn>>().toBeVoid()
    })

    it('should have commit method that returns void', () => {
      type CommitFn = SyncParams<TestDocument>['commit']
      expectTypeOf<CommitFn>().toBeFunction()
      expectTypeOf<ReturnType<CommitFn>>().toBeVoid()
    })

    it('should have markReady method that returns void', () => {
      type MarkReadyFn = SyncParams<TestDocument>['markReady']
      expectTypeOf<MarkReadyFn>().toBeFunction()
      expectTypeOf<ReturnType<MarkReadyFn>>().toBeVoid()
    })

    it('should have collection property of type Collection<T>', () => {
      type CollectionProp = SyncParams<TestDocument>['collection']
      expectTypeOf<CollectionProp>().toMatchTypeOf<Collection<TestDocument>>()
    })

    it('should be generic over document type T', () => {
      // Different document types should produce different SyncParams types
      interface AnotherDoc {
        id: number
        data: string
      }

      expectTypeOf<SyncParams<TestDocument>>()
        .not.toEqualTypeOf<SyncParams<AnotherDoc>>()
    })
  })

  describe('SyncReturn', () => {
    it('should have cleanup method that returns void', () => {
      type CleanupFn = SyncReturn['cleanup']
      expectTypeOf<CleanupFn>().toBeFunction()
      expectTypeOf<ReturnType<CleanupFn>>().toBeVoid()
    })

    it('should have optional loadSubset method', () => {
      type LoadSubsetFn = SyncReturn['loadSubset']
      expectTypeOf<LoadSubsetFn>().toMatchTypeOf<
        ((options: LoadSubsetOptions) => Promise<void>) | undefined
      >()
    })

    it('should allow loadSubset to be omitted', () => {
      const minimalReturn: SyncReturn = {
        cleanup: () => {},
      }
      expectTypeOf(minimalReturn).toMatchTypeOf<SyncReturn>()
    })

    it('should allow loadSubset to return Promise<void>', () => {
      const fullReturn: SyncReturn = {
        cleanup: () => {},
        loadSubset: async (_options: LoadSubsetOptions) => {},
      }
      expectTypeOf(fullReturn).toMatchTypeOf<SyncReturn>()
    })
  })

  describe('SyncMode', () => {
    it('should be a union of sync mode string literals', () => {
      expectTypeOf<SyncMode>().toEqualTypeOf<'eager' | 'on-demand' | 'progressive'>()
    })

    it('should accept "eager" mode', () => {
      const mode: SyncMode = 'eager'
      expectTypeOf(mode).toMatchTypeOf<SyncMode>()
    })

    it('should accept "on-demand" mode', () => {
      const mode: SyncMode = 'on-demand'
      expectTypeOf(mode).toMatchTypeOf<SyncMode>()
    })

    it('should accept "progressive" mode', () => {
      const mode: SyncMode = 'progressive'
      expectTypeOf(mode).toMatchTypeOf<SyncMode>()
    })

    it('should reject invalid mode strings', () => {
      // @ts-expect-error - 'invalid' is not a valid SyncMode
      const invalidMode: SyncMode = 'invalid'
      // The ts-expect-error above validates that 'invalid' is not assignable to SyncMode
      expectTypeOf(invalidMode).toBeString()
    })
  })

  describe('ConflictStrategy', () => {
    it('should be a union of conflict strategy string literals', () => {
      expectTypeOf<ConflictStrategy>().toEqualTypeOf<
        'last-write-wins' | 'server-wins' | 'client-wins' | 'custom'
      >()
    })

    it('should accept "last-write-wins" strategy', () => {
      const strategy: ConflictStrategy = 'last-write-wins'
      expectTypeOf(strategy).toMatchTypeOf<ConflictStrategy>()
    })

    it('should accept "server-wins" strategy', () => {
      const strategy: ConflictStrategy = 'server-wins'
      expectTypeOf(strategy).toMatchTypeOf<ConflictStrategy>()
    })

    it('should accept "client-wins" strategy', () => {
      const strategy: ConflictStrategy = 'client-wins'
      expectTypeOf(strategy).toMatchTypeOf<ConflictStrategy>()
    })

    it('should accept "custom" strategy', () => {
      const strategy: ConflictStrategy = 'custom'
      expectTypeOf(strategy).toMatchTypeOf<ConflictStrategy>()
    })

    it('should reject invalid strategy strings', () => {
      // @ts-expect-error - 'merge' is not a valid ConflictStrategy
      const invalidStrategy: ConflictStrategy = 'merge'
      // The ts-expect-error above validates that 'merge' is not assignable to ConflictStrategy
      expectTypeOf(invalidStrategy).toBeString()
    })
  })

  describe('ChangeMessage<T>', () => {
    it('should have key property as string or number', () => {
      type KeyType = ChangeMessage<TestDocument>['key']
      expectTypeOf<KeyType>().toMatchTypeOf<string | number>()
    })

    it('should have value property matching document type T', () => {
      type ValueType = ChangeMessage<TestDocument>['value']
      expectTypeOf<ValueType>().toMatchTypeOf<TestDocument>()
    })

    it('should have optional previousValue property matching document type T', () => {
      type PrevValueType = ChangeMessage<TestDocument>['previousValue']
      expectTypeOf<PrevValueType>().toMatchTypeOf<TestDocument | undefined>()
    })

    it('should have type property for operation type', () => {
      type OpType = ChangeMessage<TestDocument>['type']
      expectTypeOf<OpType>().toMatchTypeOf<'insert' | 'update' | 'delete'>()
    })

    it('should have optional metadata property', () => {
      type MetaType = ChangeMessage<TestDocument>['metadata']
      expectTypeOf<MetaType>().toMatchTypeOf<Record<string, unknown> | undefined>()
    })
  })

  describe('LoadSubsetOptions', () => {
    it('should have optional where property for filtering', () => {
      expectTypeOf<LoadSubsetOptions>()
        .toHaveProperty('where')
    })

    it('should have optional orderBy property for sorting', () => {
      expectTypeOf<LoadSubsetOptions>()
        .toHaveProperty('orderBy')
    })

    it('should have optional limit property for pagination', () => {
      type LimitType = LoadSubsetOptions['limit']
      expectTypeOf<LimitType>().toMatchTypeOf<number | undefined>()
    })

    it('should have optional offset property for pagination', () => {
      type OffsetType = LoadSubsetOptions['offset']
      expectTypeOf<OffsetType>().toMatchTypeOf<number | undefined>()
    })

    it('should have optional cursor property for cursor-based pagination', () => {
      expectTypeOf<LoadSubsetOptions>()
        .toHaveProperty('cursor')
    })
  })
})

describe('Type Compatibility', () => {
  it('should allow sync function to use SyncParams and return SyncReturn', () => {
    // This tests the contract between sync function signature and types
    type SyncFunction<T extends object> = (params: SyncParams<T>) => SyncReturn | void

    const mockSync: SyncFunction<TestDocument> = (params) => {
      params.begin()
      params.write({
        key: 'test-id',
        value: { _id: 'test-id', name: 'Test', value: 42, createdAt: new Date() },
        type: 'insert',
      })
      params.commit()
      params.markReady()

      return {
        cleanup: () => {},
        loadSubset: async () => {},
      }
    }

    expectTypeOf(mockSync).toBeFunction()
  })

  it('should allow SyncReturn cleanup to be called without arguments', () => {
    const syncReturn: SyncReturn = {
      cleanup: () => {},
    }

    // cleanup should be callable with no args
    expectTypeOf(syncReturn.cleanup).toBeCallableWith()
  })

  it('should allow loadSubset to accept LoadSubsetOptions', () => {
    const syncReturn: SyncReturn = {
      cleanup: () => {},
      loadSubset: async (options: LoadSubsetOptions) => {
        // should accept options with limit
        if (options.limit) {
          console.log(options.limit)
        }
      },
    }

    expectTypeOf(syncReturn.loadSubset!).toBeCallableWith({
      limit: 10,
      offset: 0,
    } as LoadSubsetOptions)
  })
})
