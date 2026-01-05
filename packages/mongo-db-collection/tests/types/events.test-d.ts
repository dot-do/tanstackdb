/**
 * Type tests for MongoDB Change Event Types
 *
 * These tests verify the TypeScript types for:
 * 1. MongoChangeEvent<T> - Union type for MongoDB change stream events
 * 2. ChangeMessage<T> - TanStack DB compatible change message format
 *
 * @packageDocumentation
 */

import { describe, it, expectTypeOf } from 'vitest'
import type {
  MongoChangeEvent,
  MongoInsertEvent,
  MongoUpdateEvent,
  MongoDeleteEvent,
  MongoReplaceEvent,
  ChangeMessage,
} from '../../src/types/events'

// Test document type
interface TestDocument {
  _id: string
  name: string
  count: number
  tags: string[]
}

describe('MongoChangeEvent Types', () => {
  describe('MongoInsertEvent', () => {
    it('should have operationType "insert"', () => {
      expectTypeOf<MongoInsertEvent<TestDocument>>().toMatchTypeOf<{
        operationType: 'insert'
      }>()
    })

    it('should include fullDocument of type T', () => {
      expectTypeOf<MongoInsertEvent<TestDocument>>().toMatchTypeOf<{
        fullDocument: TestDocument
      }>()
    })

    it('should include documentKey with _id', () => {
      expectTypeOf<MongoInsertEvent<TestDocument>>().toMatchTypeOf<{
        documentKey: { _id: string }
      }>()
    })

    it('should have all required properties', () => {
      type Expected = {
        operationType: 'insert'
        fullDocument: TestDocument
        documentKey: { _id: string }
      }
      expectTypeOf<MongoInsertEvent<TestDocument>>().toMatchTypeOf<Expected>()
    })
  })

  describe('MongoUpdateEvent', () => {
    it('should have operationType "update"', () => {
      expectTypeOf<MongoUpdateEvent<TestDocument>>().toMatchTypeOf<{
        operationType: 'update'
      }>()
    })

    it('should include fullDocument of type T', () => {
      expectTypeOf<MongoUpdateEvent<TestDocument>>().toMatchTypeOf<{
        fullDocument: TestDocument
      }>()
    })

    it('should include documentKey with _id', () => {
      expectTypeOf<MongoUpdateEvent<TestDocument>>().toMatchTypeOf<{
        documentKey: { _id: string }
      }>()
    })

    it('should include updateDescription with updatedFields as Partial<T>', () => {
      expectTypeOf<MongoUpdateEvent<TestDocument>>().toMatchTypeOf<{
        updateDescription: {
          updatedFields: Partial<TestDocument>
        }
      }>()
    })

    it('should include updateDescription with removedFields as string[]', () => {
      expectTypeOf<MongoUpdateEvent<TestDocument>>().toMatchTypeOf<{
        updateDescription: {
          removedFields: string[]
        }
      }>()
    })

    it('should have all required properties', () => {
      type Expected = {
        operationType: 'update'
        fullDocument: TestDocument
        documentKey: { _id: string }
        updateDescription: {
          updatedFields: Partial<TestDocument>
          removedFields: string[]
        }
      }
      expectTypeOf<MongoUpdateEvent<TestDocument>>().toMatchTypeOf<Expected>()
    })
  })

  describe('MongoDeleteEvent', () => {
    it('should have operationType "delete"', () => {
      expectTypeOf<MongoDeleteEvent<TestDocument>>().toMatchTypeOf<{
        operationType: 'delete'
      }>()
    })

    it('should include documentKey with _id', () => {
      expectTypeOf<MongoDeleteEvent<TestDocument>>().toMatchTypeOf<{
        documentKey: { _id: string }
      }>()
    })

    it('should NOT include fullDocument property', () => {
      // Delete events do not have fullDocument - verify the property doesn't exist
      type DeleteEventKeys = keyof MongoDeleteEvent<TestDocument>
      // fullDocument should not be a key of MongoDeleteEvent
      type HasFullDocument = 'fullDocument' extends DeleteEventKeys ? true : false
      expectTypeOf<HasFullDocument>().toEqualTypeOf<false>()
    })

    it('should have all required properties', () => {
      type Expected = {
        operationType: 'delete'
        documentKey: { _id: string }
      }
      expectTypeOf<MongoDeleteEvent<TestDocument>>().toMatchTypeOf<Expected>()
    })
  })

  describe('MongoReplaceEvent', () => {
    it('should have operationType "replace"', () => {
      expectTypeOf<MongoReplaceEvent<TestDocument>>().toMatchTypeOf<{
        operationType: 'replace'
      }>()
    })

    it('should include fullDocument of type T', () => {
      expectTypeOf<MongoReplaceEvent<TestDocument>>().toMatchTypeOf<{
        fullDocument: TestDocument
      }>()
    })

    it('should include documentKey with _id', () => {
      expectTypeOf<MongoReplaceEvent<TestDocument>>().toMatchTypeOf<{
        documentKey: { _id: string }
      }>()
    })

    it('should have all required properties', () => {
      type Expected = {
        operationType: 'replace'
        fullDocument: TestDocument
        documentKey: { _id: string }
      }
      expectTypeOf<MongoReplaceEvent<TestDocument>>().toMatchTypeOf<Expected>()
    })
  })

  describe('MongoChangeEvent union type', () => {
    it('should be a union of all event types', () => {
      type ExpectedUnion =
        | MongoInsertEvent<TestDocument>
        | MongoUpdateEvent<TestDocument>
        | MongoDeleteEvent<TestDocument>
        | MongoReplaceEvent<TestDocument>

      expectTypeOf<MongoChangeEvent<TestDocument>>().toEqualTypeOf<ExpectedUnion>()
    })

    it('should narrow to InsertEvent when operationType is "insert"', () => {
      const event = {} as MongoChangeEvent<TestDocument>
      if (event.operationType === 'insert') {
        expectTypeOf(event).toEqualTypeOf<MongoInsertEvent<TestDocument>>()
        expectTypeOf(event.fullDocument).toEqualTypeOf<TestDocument>()
      }
    })

    it('should narrow to UpdateEvent when operationType is "update"', () => {
      const event = {} as MongoChangeEvent<TestDocument>
      if (event.operationType === 'update') {
        expectTypeOf(event).toEqualTypeOf<MongoUpdateEvent<TestDocument>>()
        expectTypeOf(event.updateDescription.updatedFields).toEqualTypeOf<Partial<TestDocument>>()
        expectTypeOf(event.updateDescription.removedFields).toEqualTypeOf<string[]>()
      }
    })

    it('should narrow to DeleteEvent when operationType is "delete"', () => {
      const event = {} as MongoChangeEvent<TestDocument>
      if (event.operationType === 'delete') {
        expectTypeOf(event).toEqualTypeOf<MongoDeleteEvent<TestDocument>>()
        expectTypeOf(event.documentKey._id).toEqualTypeOf<string>()
      }
    })

    it('should narrow to ReplaceEvent when operationType is "replace"', () => {
      const event = {} as MongoChangeEvent<TestDocument>
      if (event.operationType === 'replace') {
        expectTypeOf(event).toEqualTypeOf<MongoReplaceEvent<TestDocument>>()
        expectTypeOf(event.fullDocument).toEqualTypeOf<TestDocument>()
      }
    })

    it('should have operationType as discriminant', () => {
      expectTypeOf<MongoChangeEvent<TestDocument>['operationType']>().toEqualTypeOf<
        'insert' | 'update' | 'delete' | 'replace'
      >()
    })
  })
})

describe('ChangeMessage Types (TanStack DB Compatibility)', () => {
  describe('ChangeMessage structure', () => {
    it('should have type as insert | update | delete', () => {
      expectTypeOf<ChangeMessage<TestDocument>['type']>().toEqualTypeOf<
        'insert' | 'update' | 'delete'
      >()
    })

    it('should have key as string', () => {
      expectTypeOf<ChangeMessage<TestDocument>['key']>().toEqualTypeOf<string>()
    })

    it('should have value of type T', () => {
      expectTypeOf<ChangeMessage<TestDocument>['value']>().toEqualTypeOf<TestDocument>()
    })

    it('should have optional previousValue of type T', () => {
      expectTypeOf<ChangeMessage<TestDocument>['previousValue']>().toEqualTypeOf<
        TestDocument | undefined
      >()
    })

    it('should have all required properties', () => {
      type Expected = {
        type: 'insert' | 'update' | 'delete'
        key: string
        value: TestDocument
        previousValue?: TestDocument
      }
      expectTypeOf<ChangeMessage<TestDocument>>().toMatchTypeOf<Expected>()
    })
  })

  describe('ChangeMessage usage patterns', () => {
    it('should allow creating insert messages', () => {
      const insertMessage: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', count: 1, tags: [] },
      }
      expectTypeOf(insertMessage).toMatchTypeOf<ChangeMessage<TestDocument>>()
    })

    it('should allow creating update messages with previousValue', () => {
      const updateMessage: ChangeMessage<TestDocument> = {
        type: 'update',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Updated', count: 2, tags: ['new'] },
        previousValue: { _id: 'doc-1', name: 'Test', count: 1, tags: [] },
      }
      expectTypeOf(updateMessage).toMatchTypeOf<ChangeMessage<TestDocument>>()
    })

    it('should allow creating delete messages', () => {
      const deleteMessage: ChangeMessage<TestDocument> = {
        type: 'delete',
        key: 'doc-1',
        value: { _id: 'doc-1', name: 'Test', count: 1, tags: [] },
      }
      expectTypeOf(deleteMessage).toMatchTypeOf<ChangeMessage<TestDocument>>()
    })
  })

  describe('Type narrowing with ChangeMessage', () => {
    it('should narrow type based on type property', () => {
      const message = {} as ChangeMessage<TestDocument>

      if (message.type === 'insert') {
        expectTypeOf(message.type).toEqualTypeOf<'insert'>()
      }

      if (message.type === 'update') {
        expectTypeOf(message.type).toEqualTypeOf<'update'>()
      }

      if (message.type === 'delete') {
        expectTypeOf(message.type).toEqualTypeOf<'delete'>()
      }
    })
  })
})

describe('Type compatibility between MongoDB events and ChangeMessage', () => {
  it('should be able to convert InsertEvent to ChangeMessage', () => {
    // This tests that the types are compatible for conversion
    type InsertToChange<T> = MongoInsertEvent<T> extends { fullDocument: infer D }
      ? { type: 'insert'; key: string; value: D }
      : never

    expectTypeOf<InsertToChange<TestDocument>>().toMatchTypeOf<{
      type: 'insert'
      key: string
      value: TestDocument
    }>()
  })

  it('should be able to convert UpdateEvent to ChangeMessage', () => {
    type UpdateToChange<T> = MongoUpdateEvent<T> extends { fullDocument: infer D }
      ? { type: 'update'; key: string; value: D; previousValue?: D }
      : never

    expectTypeOf<UpdateToChange<TestDocument>>().toMatchTypeOf<{
      type: 'update'
      key: string
      value: TestDocument
    }>()
  })

  it('should be able to convert DeleteEvent to ChangeMessage', () => {
    type DeleteToChange<T> = MongoDeleteEvent<T> extends { documentKey: { _id: string } }
      ? { type: 'delete'; key: string; value: T }
      : never

    expectTypeOf<DeleteToChange<TestDocument>>().toMatchTypeOf<{
      type: 'delete'
      key: string
      value: TestDocument
    }>()
  })
})
