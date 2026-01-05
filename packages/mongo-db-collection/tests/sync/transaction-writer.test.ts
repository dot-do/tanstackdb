/**
 * Transaction Writer Tests (TDD RED Phase)
 *
 * These tests verify the TransactionWriter class which:
 * 1. Wraps begin/write/commit from SyncParams
 * 2. Batches writes within transaction
 * 3. Auto-commits on flush
 * 4. Handles write errors
 * 5. Supports rollback
 *
 * RED PHASE: These tests will fail until TransactionWriter is implemented
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TransactionWriter } from '../../src/sync/transaction-writer'
import type { SyncParams, ChangeMessage } from '../../src/types'
import type { Collection } from '@tanstack/db'

// Test document type
interface TestDocument {
  _id: string
  name: string
  value: number
  updatedAt?: Date
}

// Mock SyncParams factory
function createMockSyncParams(): {
  syncParams: SyncParams<TestDocument>
  mocks: {
    begin: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    commit: ReturnType<typeof vi.fn>
    markReady: ReturnType<typeof vi.fn>
  }
} {
  const begin = vi.fn()
  const write = vi.fn()
  const commit = vi.fn()
  const markReady = vi.fn()

  return {
    syncParams: {
      collection: {} as Collection<TestDocument>,
      begin,
      write,
      commit,
      markReady,
    },
    mocks: { begin, write, commit, markReady },
  }
}

describe('TransactionWriter', () => {
  let mockSyncParams: ReturnType<typeof createMockSyncParams>

  beforeEach(() => {
    mockSyncParams = createMockSyncParams()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('construction and configuration', () => {
    it('should create writer with SyncParams', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      expect(writer).toBeInstanceOf(TransactionWriter)
    })

    it('should accept optional configuration', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        autoFlushMs: 100,
        maxBatchSize: 50,
      })

      expect(writer).toBeInstanceOf(TransactionWriter)
      expect(writer.autoFlushMs).toBe(100)
      expect(writer.maxBatchSize).toBe(50)
    })

    it('should have default configuration values', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      expect(writer.autoFlushMs).toBe(0) // No auto-flush by default
      expect(writer.maxBatchSize).toBe(1000) // Default max batch size
    })

    it('should reject invalid autoFlushMs (negative)', () => {
      expect(
        () =>
          new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
            autoFlushMs: -1,
          })
      ).toThrow(/autoFlushMs/i)
    })

    it('should reject invalid maxBatchSize (zero or negative)', () => {
      expect(
        () =>
          new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
            maxBatchSize: 0,
          })
      ).toThrow(/maxBatchSize/i)

      expect(
        () =>
          new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
            maxBatchSize: -5,
          })
      ).toThrow(/maxBatchSize/i)
    })
  })

  describe('wraps begin/write/commit from SyncParams', () => {
    it('should call SyncParams.begin when transaction starts', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()

      expect(mockSyncParams.mocks.begin).toHaveBeenCalledTimes(1)
    })

    it('should call SyncParams.write for each change in transaction', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.write({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.write({
        type: 'update',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Updated', value: 2 },
      })

      expect(mockSyncParams.mocks.write).toHaveBeenCalledTimes(2)
    })

    it('should call SyncParams.commit when transaction commits', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.write({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.commitTransaction()

      expect(mockSyncParams.mocks.commit).toHaveBeenCalledTimes(1)
    })

    it('should pass change messages through to SyncParams.write', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)
      const change: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 42 },
        metadata: { source: 'test' },
      }

      writer.beginTransaction()
      writer.write(change)
      writer.commitTransaction()

      expect(mockSyncParams.mocks.write).toHaveBeenCalledWith(change)
    })

    it('should call begin/commit in correct order', () => {
      const callOrder: string[] = []
      mockSyncParams.mocks.begin.mockImplementation(() => callOrder.push('begin'))
      mockSyncParams.mocks.write.mockImplementation(() => callOrder.push('write'))
      mockSyncParams.mocks.commit.mockImplementation(() => callOrder.push('commit'))

      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.write({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.commitTransaction()

      expect(callOrder).toEqual(['begin', 'write', 'commit'])
    })
  })

  describe('batches writes within transaction', () => {
    it('should collect writes and batch them', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()

      // Queue multiple writes
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Doc 1', value: 1 },
      })
      writer.queueWrite({
        type: 'insert',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Doc 2', value: 2 },
      })
      writer.queueWrite({
        type: 'insert',
        key: 'doc3',
        value: { _id: 'doc3', name: 'Doc 3', value: 3 },
      })

      // Writes not yet sent
      expect(mockSyncParams.mocks.write).not.toHaveBeenCalled()

      // Flush the batch
      writer.flush()

      // All writes sent at once
      expect(mockSyncParams.mocks.write).toHaveBeenCalledTimes(3)
    })

    it('should report pending write count', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      expect(writer.pendingCount).toBe(0)

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Doc 1', value: 1 },
      })

      expect(writer.pendingCount).toBe(1)

      writer.queueWrite({
        type: 'insert',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Doc 2', value: 2 },
      })

      expect(writer.pendingCount).toBe(2)
    })

    it('should clear pending count after flush', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Doc 1', value: 1 },
      })

      expect(writer.pendingCount).toBe(1)

      writer.flush()

      expect(writer.pendingCount).toBe(0)
    })

    it('should trigger flush when max batch size is reached', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        maxBatchSize: 3,
      })

      writer.beginTransaction()

      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Doc 1', value: 1 },
      })
      writer.queueWrite({
        type: 'insert',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Doc 2', value: 2 },
      })

      // Not yet at limit
      expect(mockSyncParams.mocks.write).not.toHaveBeenCalled()

      writer.queueWrite({
        type: 'insert',
        key: 'doc3',
        value: { _id: 'doc3', name: 'Doc 3', value: 3 },
      })

      // Batch size reached, should auto-flush
      expect(mockSyncParams.mocks.write).toHaveBeenCalledTimes(3)
    })

    it('should preserve write order within batch', () => {
      const writes: ChangeMessage<TestDocument>[] = []
      mockSyncParams.mocks.write.mockImplementation((change: ChangeMessage<TestDocument>) => {
        writes.push(change)
      })

      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'First', value: 1 },
      })
      writer.queueWrite({
        type: 'update',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Second', value: 2 },
      })
      writer.queueWrite({
        type: 'delete',
        key: 'doc3',
        value: { _id: 'doc3', name: 'Third', value: 3 },
      })
      writer.flush()

      expect(writes.map((w) => w.key)).toEqual(['doc1', 'doc2', 'doc3'])
      expect(writes.map((w) => w.type)).toEqual(['insert', 'update', 'delete'])
    })
  })

  describe('auto-commits on flush', () => {
    it('should auto-commit on flush when transaction is active', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        autoCommit: true,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.flush()

      expect(mockSyncParams.mocks.commit).toHaveBeenCalledTimes(1)
    })

    it('should not auto-commit when autoCommit is disabled', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        autoCommit: false,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.flush()

      expect(mockSyncParams.mocks.write).toHaveBeenCalled()
      expect(mockSyncParams.mocks.commit).not.toHaveBeenCalled()
    })

    it('should auto-flush after configured time interval', async () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        autoFlushMs: 100,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })

      // Before auto-flush
      expect(mockSyncParams.mocks.write).not.toHaveBeenCalled()

      // Wait for auto-flush timer
      await vi.advanceTimersByTimeAsync(100)

      expect(mockSyncParams.mocks.write).toHaveBeenCalledTimes(1)
    })

    it('should reset auto-flush timer on each write', async () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        autoFlushMs: 100,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Doc 1', value: 1 },
      })

      // Advance 80ms
      await vi.advanceTimersByTimeAsync(80)
      expect(mockSyncParams.mocks.write).not.toHaveBeenCalled()

      // Queue another write (should reset timer)
      writer.queueWrite({
        type: 'insert',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Doc 2', value: 2 },
      })

      // Advance another 80ms (total 160ms from first write, but only 80ms from second)
      await vi.advanceTimersByTimeAsync(80)
      expect(mockSyncParams.mocks.write).not.toHaveBeenCalled()

      // Final 20ms to trigger flush
      await vi.advanceTimersByTimeAsync(20)
      expect(mockSyncParams.mocks.write).toHaveBeenCalledTimes(2)
    })

    it('should start new transaction on flush when autoBegin is enabled', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        autoCommit: true,
        autoBegin: true,
      })

      writer.beginTransaction()
      expect(mockSyncParams.mocks.begin).toHaveBeenCalledTimes(1)

      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.flush()

      // Should commit and begin new transaction
      expect(mockSyncParams.mocks.commit).toHaveBeenCalledTimes(1)
      expect(mockSyncParams.mocks.begin).toHaveBeenCalledTimes(2)
    })

    it('should not flush empty transaction', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        autoCommit: true,
      })

      writer.beginTransaction()
      writer.flush()

      // Should not call commit for empty transaction
      expect(mockSyncParams.mocks.write).not.toHaveBeenCalled()
      expect(mockSyncParams.mocks.commit).not.toHaveBeenCalled()
    })
  })

  describe('handles write errors', () => {
    it('should catch and report write errors', () => {
      const onError = vi.fn()
      mockSyncParams.mocks.write.mockImplementation(() => {
        throw new Error('Write failed')
      })

      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        onError,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.flush()

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ key: 'doc1' })
      )
    })

    it('should continue processing after write error', () => {
      const onError = vi.fn()
      let callCount = 0
      mockSyncParams.mocks.write.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          throw new Error('First write failed')
        }
      })

      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        onError,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Doc 1', value: 1 },
      })
      writer.queueWrite({
        type: 'insert',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Doc 2', value: 2 },
      })
      writer.flush()

      expect(onError).toHaveBeenCalledTimes(1)
      expect(mockSyncParams.mocks.write).toHaveBeenCalledTimes(2)
    })

    it('should throw by default if no error handler configured', () => {
      mockSyncParams.mocks.write.mockImplementation(() => {
        throw new Error('Write failed')
      })

      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })

      expect(() => writer.flush()).toThrow('Write failed')
    })

    it('should track failed writes', () => {
      const onError = vi.fn()
      mockSyncParams.mocks.write.mockImplementation((change: ChangeMessage<TestDocument>) => {
        if (change.key === 'doc2') {
          throw new Error('Write failed for doc2')
        }
      })

      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        onError,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Doc 1', value: 1 },
      })
      writer.queueWrite({
        type: 'insert',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Doc 2', value: 2 },
      })
      writer.queueWrite({
        type: 'insert',
        key: 'doc3',
        value: { _id: 'doc3', name: 'Doc 3', value: 3 },
      })
      writer.flush()

      expect(writer.failedWrites).toHaveLength(1)
      expect(writer.failedWrites[0].key).toBe('doc2')
    })

    it('should clear failed writes on clearFailedWrites()', () => {
      const onError = vi.fn()
      mockSyncParams.mocks.write.mockImplementation(() => {
        throw new Error('Write failed')
      })

      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        onError,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.flush()

      expect(writer.failedWrites).toHaveLength(1)

      writer.clearFailedWrites()

      expect(writer.failedWrites).toHaveLength(0)
    })

    it('should support retry for failed writes', () => {
      const onError = vi.fn()
      let failCount = 0
      mockSyncParams.mocks.write.mockImplementation((change: ChangeMessage<TestDocument>) => {
        if (change.key === 'doc1' && failCount < 2) {
          failCount++
          throw new Error('Write failed')
        }
      })

      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        onError,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.flush()

      expect(writer.failedWrites).toHaveLength(1)

      // Retry failed writes
      writer.retryFailedWrites()
      writer.flush()

      expect(writer.failedWrites).toHaveLength(1) // Still fails on second attempt

      // Third attempt should succeed
      writer.retryFailedWrites()
      writer.flush()

      expect(writer.failedWrites).toHaveLength(0)
    })
  })

  describe('supports rollback', () => {
    it('should support rollback before commit', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })

      expect(writer.pendingCount).toBe(1)

      writer.rollback()

      expect(writer.pendingCount).toBe(0)
      expect(mockSyncParams.mocks.write).not.toHaveBeenCalled()
      expect(mockSyncParams.mocks.commit).not.toHaveBeenCalled()
    })

    it('should mark transaction as inactive after rollback', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      expect(writer.isTransactionActive).toBe(true)

      writer.rollback()
      expect(writer.isTransactionActive).toBe(false)
    })

    it('should not allow writes after rollback until new transaction', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.rollback()

      expect(() => {
        writer.queueWrite({
          type: 'insert',
          key: 'doc1',
          value: { _id: 'doc1', name: 'Test', value: 1 },
        })
      }).toThrow(/no active transaction/i)
    })

    it('should call onRollback callback when rollback occurs', () => {
      const onRollback = vi.fn()
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        onRollback,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.queueWrite({
        type: 'insert',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Test 2', value: 2 },
      })
      writer.rollback()

      expect(onRollback).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ key: 'doc1' }),
          expect.objectContaining({ key: 'doc2' }),
        ])
      )
    })

    it('should preserve rolled back writes for potential retry', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        preserveRolledBack: true,
      })

      const change1: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      }
      const change2: ChangeMessage<TestDocument> = {
        type: 'insert',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Test 2', value: 2 },
      }

      writer.beginTransaction()
      writer.queueWrite(change1)
      writer.queueWrite(change2)
      writer.rollback()

      expect(writer.rolledBackWrites).toHaveLength(2)
      expect(writer.rolledBackWrites).toContainEqual(change1)
      expect(writer.rolledBackWrites).toContainEqual(change2)
    })

    it('should allow re-queueing rolled back writes', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        preserveRolledBack: true,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.rollback()

      expect(writer.rolledBackWrites).toHaveLength(1)

      // Start new transaction and re-queue
      writer.beginTransaction()
      writer.requeueRolledBack()

      expect(writer.pendingCount).toBe(1)
      expect(writer.rolledBackWrites).toHaveLength(0)
    })
  })

  describe('transaction state management', () => {
    it('should track active transaction state', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      expect(writer.isTransactionActive).toBe(false)

      writer.beginTransaction()
      expect(writer.isTransactionActive).toBe(true)

      writer.commitTransaction()
      expect(writer.isTransactionActive).toBe(false)
    })

    it('should not allow begin when transaction is already active', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()

      expect(() => writer.beginTransaction()).toThrow(/already active/i)
    })

    it('should not allow commit when no transaction is active', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      expect(() => writer.commitTransaction()).toThrow(/no active transaction/i)
    })

    it('should not allow rollback when no transaction is active', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      expect(() => writer.rollback()).toThrow(/no active transaction/i)
    })

    it('should track transaction count', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      expect(writer.transactionCount).toBe(0)

      writer.beginTransaction()
      writer.commitTransaction()

      expect(writer.transactionCount).toBe(1)

      writer.beginTransaction()
      writer.commitTransaction()

      expect(writer.transactionCount).toBe(2)
    })

    it('should not increment transaction count on rollback', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.rollback()

      expect(writer.transactionCount).toBe(0)
    })
  })

  describe('lifecycle and disposal', () => {
    it('should cancel pending auto-flush on dispose', async () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        autoFlushMs: 100,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })

      writer.dispose()

      await vi.advanceTimersByTimeAsync(100)

      // Should not have flushed because writer was disposed
      expect(mockSyncParams.mocks.write).not.toHaveBeenCalled()
    })

    it('should reject new writes after disposal', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.dispose()

      expect(() => {
        writer.queueWrite({
          type: 'insert',
          key: 'doc1',
          value: { _id: 'doc1', name: 'Test', value: 1 },
        })
      }).toThrow(/disposed/i)
    })

    it('should flush pending writes on dispose when configured', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        flushOnDispose: true,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })

      writer.dispose()

      expect(mockSyncParams.mocks.write).toHaveBeenCalledTimes(1)
    })

    it('should call onCommit callback when transaction commits', () => {
      const onCommit = vi.fn()
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams, {
        onCommit,
      })

      writer.beginTransaction()
      writer.queueWrite({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.queueWrite({
        type: 'update',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Updated', value: 2 },
      })
      writer.flush()
      writer.commitTransaction()

      expect(onCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          writeCount: 2,
          insertCount: 1,
          updateCount: 1,
          deleteCount: 0,
        })
      )
    })
  })

  describe('write statistics', () => {
    it('should track total writes', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.write({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.write({
        type: 'update',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Updated', value: 2 },
      })
      writer.commitTransaction()

      const stats = writer.getStats()

      expect(stats.totalWrites).toBe(2)
      expect(stats.insertCount).toBe(1)
      expect(stats.updateCount).toBe(1)
      expect(stats.deleteCount).toBe(0)
    })

    it('should track writes by type', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.write({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Inserted', value: 1 },
      })
      writer.write({
        type: 'insert',
        key: 'doc2',
        value: { _id: 'doc2', name: 'Inserted 2', value: 2 },
      })
      writer.write({
        type: 'update',
        key: 'doc3',
        value: { _id: 'doc3', name: 'Updated', value: 3 },
      })
      writer.write({
        type: 'delete',
        key: 'doc4',
        value: { _id: 'doc4', name: 'Deleted', value: 4 },
      })
      writer.commitTransaction()

      const stats = writer.getStats()

      expect(stats.insertCount).toBe(2)
      expect(stats.updateCount).toBe(1)
      expect(stats.deleteCount).toBe(1)
    })

    it('should reset stats', () => {
      const writer = new TransactionWriter<TestDocument>(mockSyncParams.syncParams)

      writer.beginTransaction()
      writer.write({
        type: 'insert',
        key: 'doc1',
        value: { _id: 'doc1', name: 'Test', value: 1 },
      })
      writer.commitTransaction()

      expect(writer.getStats().totalWrites).toBe(1)

      writer.resetStats()

      expect(writer.getStats().totalWrites).toBe(0)
    })
  })
})
