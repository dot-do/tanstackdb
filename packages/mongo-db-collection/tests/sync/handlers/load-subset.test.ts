/**
 * @file Load Subset Handler Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the load subset handler that handles
 * on-demand loading of document subsets from MongoDB via RPC.
 *
 * The load subset handler is used in 'on-demand' and 'progressive' sync modes
 * to fetch specific subsets of data based on query parameters, pagination,
 * and filtering criteria.
 *
 * RED PHASE: These tests define the expected behavior of the load subset handler.
 * The implementation should make these tests pass.
 *
 * @see https://tanstack.com/db/latest/docs
 *
 * Bead ID: po0.103 (RED tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createLoadSubsetHandler,
  handleLoadSubset,
  type LoadSubsetHandlerConfig,
  type LoadSubsetContext,
  type LoadSubsetResult,
} from '../../../src/sync/handlers/load-subset'

// =============================================================================
// Test Interfaces
// =============================================================================

/**
 * Basic document type for testing load subset operations.
 */
interface TestDocument {
  _id: string
  name: string
  value: number
  category?: string
  createdAt?: Date
  tags?: string[]
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
    }
  }
}

// =============================================================================
// Mock RPC Client
// =============================================================================

interface MockRpcClient {
  rpc: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  isConnected: ReturnType<typeof vi.fn>
}

function createMockRpcClient(): MockRpcClient {
  return {
    rpc: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  }
}

// =============================================================================
// Mock Sync Params
// =============================================================================

interface MockSyncParams<T> {
  begin: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
  markReady: ReturnType<typeof vi.fn>
  collection: { id: string; state: () => Map<string, T> }
}

function createMockSyncParams<T>(): MockSyncParams<T> {
  return {
    begin: vi.fn(),
    write: vi.fn(),
    commit: vi.fn(),
    markReady: vi.fn(),
    collection: {
      id: 'test-collection',
      state: () => new Map(),
    },
  }
}

// =============================================================================
// Test Data Factories
// =============================================================================

function createTestDocuments(count: number): TestDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `doc-${i + 1}`,
    name: `Document ${i + 1}`,
    value: (i + 1) * 10,
    category: i % 2 === 0 ? 'even' : 'odd',
    createdAt: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`),
    tags: i % 3 === 0 ? ['featured'] : [],
  }))
}

// =============================================================================
// Handler Factory Tests
// =============================================================================

describe('createLoadSubsetHandler', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createLoadSubsetHandler).toBe('function')
    })

    it('should return a loadSubset function', () => {
      const mockRpc = createMockRpcClient()
      const handler = createLoadSubsetHandler({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc: TestDocument) => doc._id,
      })

      expect(typeof handler).toBe('function')
    })

    it('should throw when rpcClient is not provided', () => {
      expect(() =>
        createLoadSubsetHandler({
          rpcClient: undefined as any,
          database: 'testdb',
          collection: 'testcol',
          getKey: (doc: TestDocument) => doc._id,
        })
      ).toThrow('rpcClient is required')
    })

    it('should throw when database is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createLoadSubsetHandler({
          rpcClient: mockRpc,
          database: '',
          collection: 'testcol',
          getKey: (doc: TestDocument) => doc._id,
        })
      ).toThrow('database is required')
    })

    it('should throw when collection is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createLoadSubsetHandler({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: '',
          getKey: (doc: TestDocument) => doc._id,
        })
      ).toThrow('collection is required')
    })

    it('should throw when getKey is not provided', () => {
      const mockRpc = createMockRpcClient()
      expect(() =>
        createLoadSubsetHandler({
          rpcClient: mockRpc,
          database: 'testdb',
          collection: 'testcol',
          getKey: undefined as any,
        })
      ).toThrow('getKey is required')
    })
  })

  describe('handler execution - basic operations', () => {
    let mockRpc: MockRpcClient
    let mockSyncParams: MockSyncParams<TestDocument>
    let handler: ReturnType<typeof createLoadSubsetHandler<TestDocument>>

    beforeEach(() => {
      mockRpc = createMockRpcClient()
      mockSyncParams = createMockSyncParams<TestDocument>()
      mockRpc.rpc.mockResolvedValue([])
      handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })
    })

    it('should call RPC find method with correct database and collection', async () => {
      await handler({})

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        database: 'testdb',
        collection: 'testcol',
      }))
    })

    it('should return true when data is already loaded (no-op)', async () => {
      // Simulate scenario where subset is already loaded
      const handlerWithCheck = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
        isSubsetLoaded: () => true,
      })

      const result = await handlerWithCheck({})
      expect(result).toBe(true)
      expect(mockRpc.rpc).not.toHaveBeenCalled()
    })

    it('should call begin before writing documents', async () => {
      const testDocs = createTestDocuments(3)
      mockRpc.rpc.mockResolvedValue(testDocs)

      const callOrder: string[] = []
      mockSyncParams.begin.mockImplementation(() => callOrder.push('begin'))
      mockSyncParams.write.mockImplementation(() => callOrder.push('write'))

      await handler({})

      expect(callOrder[0]).toBe('begin')
      expect(callOrder.filter((c) => c === 'write').length).toBe(3)
    })

    it('should call commit after all documents are written', async () => {
      const testDocs = createTestDocuments(3)
      mockRpc.rpc.mockResolvedValue(testDocs)

      const callOrder: string[] = []
      mockSyncParams.write.mockImplementation(() => callOrder.push('write'))
      mockSyncParams.commit.mockImplementation(() => callOrder.push('commit'))

      await handler({})

      const lastWriteIndex = callOrder.lastIndexOf('write')
      const commitIndex = callOrder.indexOf('commit')
      expect(commitIndex).toBeGreaterThan(lastWriteIndex)
    })

    it('should write documents as insert messages with correct keys', async () => {
      const testDocs = createTestDocuments(3)
      mockRpc.rpc.mockResolvedValue(testDocs)

      interface ChangeMessage {
        type: string
        key: string
        value: TestDocument
      }
      const writtenMessages: ChangeMessage[] = []
      mockSyncParams.write.mockImplementation((msg: ChangeMessage) => {
        writtenMessages.push(msg)
      })

      await handler({})

      expect(writtenMessages).toHaveLength(3)
      writtenMessages.forEach((msg, i) => {
        expect(msg.type).toBe('insert')
        expect(msg.key).toBe(testDocs[i]?._id)
        expect(msg.value).toEqual(testDocs[i])
      })
    })

    it('should handle empty result set gracefully', async () => {
      mockRpc.rpc.mockResolvedValue([])

      await expect(handler({})).resolves.not.toThrow()
      expect(mockSyncParams.begin).toHaveBeenCalled()
      expect(mockSyncParams.write).not.toHaveBeenCalled()
      expect(mockSyncParams.commit).toHaveBeenCalled()
    })
  })
})

// =============================================================================
// Filter Query Tests
// =============================================================================

describe('load subset with filters', () => {
  let mockRpc: MockRpcClient
  let mockSyncParams: MockSyncParams<TestDocument>
  let handler: ReturnType<typeof createLoadSubsetHandler<TestDocument>>

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockSyncParams = createMockSyncParams<TestDocument>()
    mockRpc.rpc.mockResolvedValue([])
    handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
    })
  })

  it('should pass simple equality filter to RPC', async () => {
    await handler({
      where: { category: 'even' },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      filter: { category: 'even' },
    }))
  })

  it('should pass comparison operators to RPC', async () => {
    await handler({
      where: { value: { $gte: 50 } },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      filter: { value: { $gte: 50 } },
    }))
  })

  it('should pass logical operators to RPC', async () => {
    await handler({
      where: {
        $or: [
          { category: 'even' },
          { value: { $gt: 100 } },
        ],
      },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      filter: {
        $or: [
          { category: 'even' },
          { value: { $gt: 100 } },
        ],
      },
    }))
  })

  it('should pass array operators to RPC', async () => {
    await handler({
      where: {
        tags: { $all: ['featured'] },
      },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      filter: { tags: { $all: ['featured'] } },
    }))
  })

  it('should pass $in operator to RPC', async () => {
    await handler({
      where: {
        category: { $in: ['even', 'odd'] },
      },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      filter: { category: { $in: ['even', 'odd'] } },
    }))
  })

  it('should handle combined filter conditions', async () => {
    await handler({
      where: {
        category: 'even',
        value: { $gte: 20, $lte: 80 },
        tags: { $exists: true },
      },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      filter: {
        category: 'even',
        value: { $gte: 20, $lte: 80 },
        tags: { $exists: true },
      },
    }))
  })
})

// =============================================================================
// Sorting Tests
// =============================================================================

describe('load subset with sorting', () => {
  let mockRpc: MockRpcClient
  let mockSyncParams: MockSyncParams<TestDocument>
  let handler: ReturnType<typeof createLoadSubsetHandler<TestDocument>>

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockSyncParams = createMockSyncParams<TestDocument>()
    mockRpc.rpc.mockResolvedValue([])
    handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
    })
  })

  it('should pass single field ascending sort to RPC', async () => {
    await handler({
      orderBy: { name: 'asc' },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      sort: { name: 1 },
    }))
  })

  it('should pass single field descending sort to RPC', async () => {
    await handler({
      orderBy: { createdAt: 'desc' },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      sort: { createdAt: -1 },
    }))
  })

  it('should pass numeric sort direction to RPC', async () => {
    await handler({
      orderBy: { value: -1 },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      sort: { value: -1 },
    }))
  })

  it('should pass multiple sort fields to RPC', async () => {
    await handler({
      orderBy: { category: 'asc', value: 'desc' },
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      sort: { category: 1, value: -1 },
    }))
  })
})

// =============================================================================
// Pagination Tests
// =============================================================================

describe('load subset with pagination', () => {
  let mockRpc: MockRpcClient
  let mockSyncParams: MockSyncParams<TestDocument>
  let handler: ReturnType<typeof createLoadSubsetHandler<TestDocument>>

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockSyncParams = createMockSyncParams<TestDocument>()
    mockRpc.rpc.mockResolvedValue([])
    handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
    })
  })

  it('should pass limit to RPC', async () => {
    await handler({
      limit: 20,
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      limit: 20,
    }))
  })

  it('should pass offset (skip) to RPC', async () => {
    await handler({
      offset: 40,
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      skip: 40,
    }))
  })

  it('should pass both limit and offset to RPC', async () => {
    await handler({
      limit: 20,
      offset: 40,
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      limit: 20,
      skip: 40,
    }))
  })
})

// =============================================================================
// Cursor-based Pagination Tests
// =============================================================================

describe('load subset with cursor-based pagination', () => {
  let mockRpc: MockRpcClient
  let mockSyncParams: MockSyncParams<TestDocument>
  let handler: ReturnType<typeof createLoadSubsetHandler<TestDocument>>

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockSyncParams = createMockSyncParams<TestDocument>()
    mockRpc.rpc.mockResolvedValue([])
    handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
    })
  })

  it('should convert cursor to filter condition with default _id field', async () => {
    await handler({
      cursor: 'doc-50',
      limit: 20,
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      filter: expect.objectContaining({
        _id: { $gt: 'doc-50' },
      }),
    }))
  })

  it('should use custom cursorField when specified', async () => {
    await handler({
      cursor: 100,
      cursorField: 'value',
      limit: 20,
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      filter: expect.objectContaining({
        value: { $gt: 100 },
      }),
    }))
  })

  it('should use $lt for descending sort with cursor', async () => {
    await handler({
      cursor: 'doc-50',
      orderBy: { _id: 'desc' },
      limit: 20,
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      filter: expect.objectContaining({
        _id: { $lt: 'doc-50' },
      }),
    }))
  })

  it('should merge cursor filter with existing where conditions', async () => {
    await handler({
      where: { category: 'even' },
      cursor: 'doc-50',
      limit: 20,
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      filter: expect.objectContaining({
        category: 'even',
        _id: { $gt: 'doc-50' },
      }),
    }))
  })

  it('should handle Date cursor values', async () => {
    const cursorDate = new Date('2024-01-15')
    await handler({
      cursor: cursorDate,
      cursorField: 'createdAt',
      limit: 20,
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      filter: expect.objectContaining({
        createdAt: { $gt: cursorDate },
      }),
    }))
  })
})

// =============================================================================
// Direct Handler Function Tests
// =============================================================================

describe('handleLoadSubset', () => {
  let mockRpc: MockRpcClient

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockRpc.rpc.mockResolvedValue([])
  })

  describe('basic functionality', () => {
    it('should be a function', () => {
      expect(typeof handleLoadSubset).toBe('function')
    })

    it('should load documents and return result', async () => {
      const testDocs = createTestDocuments(5)
      mockRpc.rpc.mockResolvedValue(testDocs)

      const result = await handleLoadSubset<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        options: {},
      })

      expect(result.success).toBe(true)
      expect(result.documents).toEqual(testDocs)
      expect(result.count).toBe(5)
    })

    it('should return success false on RPC error', async () => {
      mockRpc.rpc.mockRejectedValue(new Error('MongoDB connection failed'))

      const result = await handleLoadSubset<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        options: {},
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toBe('MongoDB connection failed')
    })

    it('should handle disconnected client', async () => {
      mockRpc.isConnected.mockReturnValue(false)

      const result = await handleLoadSubset<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        options: {},
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('not connected')
    })
  })

  describe('with options', () => {
    it('should pass filter options to RPC', async () => {
      mockRpc.rpc.mockResolvedValue([])

      await handleLoadSubset<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        options: {
          where: { category: 'even' },
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { category: 'even' },
      }))
    })

    it('should pass sort options to RPC', async () => {
      mockRpc.rpc.mockResolvedValue([])

      await handleLoadSubset<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        options: {
          orderBy: { value: 'desc' },
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        sort: { value: -1 },
      }))
    })

    it('should pass pagination options to RPC', async () => {
      mockRpc.rpc.mockResolvedValue([])

      await handleLoadSubset<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        options: {
          limit: 10,
          offset: 20,
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        limit: 10,
        skip: 20,
      }))
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('error handling', () => {
  let mockRpc: MockRpcClient
  let mockSyncParams: MockSyncParams<TestDocument>

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockSyncParams = createMockSyncParams<TestDocument>()
  })

  it('should call onError hook on RPC failure', async () => {
    const error = new Error('RPC failed')
    mockRpc.rpc.mockRejectedValue(error)
    const onError = vi.fn()

    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
      onError,
    })

    await expect(handler({})).rejects.toThrow('RPC failed')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      error,
    }))
  })

  it('should not call commit if RPC fails', async () => {
    mockRpc.rpc.mockRejectedValue(new Error('RPC failed'))

    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
    })

    await expect(handler({})).rejects.toThrow()
    expect(mockSyncParams.commit).not.toHaveBeenCalled()
  })

  it('should handle network timeout errors', async () => {
    const timeoutError = new Error('Request timed out')
    mockRpc.rpc.mockRejectedValue(timeoutError)

    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
    })

    await expect(handler({})).rejects.toThrow('Request timed out')
  })
})

// =============================================================================
// Hooks and Callbacks Tests
// =============================================================================

describe('hooks and callbacks', () => {
  let mockRpc: MockRpcClient
  let mockSyncParams: MockSyncParams<TestDocument>

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockSyncParams = createMockSyncParams<TestDocument>()
    mockRpc.rpc.mockResolvedValue([])
  })

  it('should call onBeforeLoad hook', async () => {
    const onBeforeLoad = vi.fn()
    const testDocs = createTestDocuments(3)
    mockRpc.rpc.mockResolvedValue(testDocs)

    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
      onBeforeLoad,
    })

    await handler({ where: { category: 'even' } })

    expect(onBeforeLoad).toHaveBeenCalledWith({
      options: { where: { category: 'even' } },
    })
  })

  it('should call onAfterLoad hook with loaded documents', async () => {
    const onAfterLoad = vi.fn()
    const testDocs = createTestDocuments(3)
    mockRpc.rpc.mockResolvedValue(testDocs)

    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
      onAfterLoad,
    })

    await handler({})

    expect(onAfterLoad).toHaveBeenCalledWith({
      documents: testDocs,
      count: 3,
    })
  })

  it('should allow onBeforeLoad to transform options', async () => {
    const onBeforeLoad = vi.fn().mockImplementation(({ options }) => {
      return {
        ...options,
        limit: 5,
      }
    })

    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
      onBeforeLoad,
    })

    await handler({})

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
      limit: 5,
    }))
  })
})

// =============================================================================
// Deduplication Tests
// =============================================================================

describe('deduplication', () => {
  let mockRpc: MockRpcClient
  let mockSyncParams: MockSyncParams<TestDocument>

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockSyncParams = createMockSyncParams<TestDocument>()
    mockRpc.rpc.mockResolvedValue([])
  })

  it('should skip documents already in collection state', async () => {
    const testDocs = createTestDocuments(5)
    mockRpc.rpc.mockResolvedValue(testDocs)

    const existingState = new Map<string, TestDocument>()
    existingState.set('doc-1', testDocs[0])
    existingState.set('doc-3', testDocs[2])

    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: {
        ...mockSyncParams,
        collection: {
          id: 'test-collection',
          state: () => existingState,
        },
      } as any,
      skipExisting: true,
    })

    await handler({})

    // Should only write 3 documents (skip doc-1 and doc-3)
    expect(mockSyncParams.write).toHaveBeenCalledTimes(3)
  })

  it('should update existing documents when skipExisting is false', async () => {
    const testDocs = createTestDocuments(3)
    mockRpc.rpc.mockResolvedValue(testDocs)

    const existingState = new Map<string, TestDocument>()
    existingState.set('doc-1', { ...testDocs[0], name: 'Old Name' })

    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: {
        ...mockSyncParams,
        collection: {
          id: 'test-collection',
          state: () => existingState,
        },
      } as any,
      skipExisting: false,
    })

    interface ChangeMessage {
      type: string
      key: string
      value: TestDocument
    }
    const writtenMessages: ChangeMessage[] = []
    mockSyncParams.write.mockImplementation((msg: ChangeMessage) => {
      writtenMessages.push(msg)
    })

    await handler({})

    // Should write all 3 documents
    expect(writtenMessages).toHaveLength(3)

    // First document should be an update since it already existed
    expect(writtenMessages[0].type).toBe('update')
    expect(writtenMessages[0].key).toBe('doc-1')
  })
})

// =============================================================================
// Retry Logic Tests
// =============================================================================

describe('retry logic', () => {
  let mockRpc: MockRpcClient
  let mockSyncParams: MockSyncParams<TestDocument>

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockSyncParams = createMockSyncParams<TestDocument>()
  })

  it('should retry on transient network errors', async () => {
    const testDocs = createTestDocuments(3)
    mockRpc.rpc
      .mockRejectedValueOnce(new Error('Network temporarily unavailable'))
      .mockResolvedValueOnce(testDocs)

    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
      retryConfig: {
        maxRetries: 3,
        initialDelayMs: 10,
      },
    })

    await expect(handler({})).resolves.not.toThrow()
    expect(mockRpc.rpc).toHaveBeenCalledTimes(2)
  })

  it('should respect maxRetries limit', async () => {
    mockRpc.rpc.mockRejectedValue(new Error('Network error'))

    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
      retryConfig: {
        maxRetries: 2,
        initialDelayMs: 10,
      },
    })

    await expect(handler({})).rejects.toThrow('Network error')
    // Initial attempt + 2 retries = 3 total
    expect(mockRpc.rpc).toHaveBeenCalledTimes(3)
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('type safety', () => {
  it('should maintain generic type through handler', async () => {
    const mockRpc = createMockRpcClient()
    const mockSyncParams = createMockSyncParams<TestDocument>()
    mockRpc.rpc.mockResolvedValue([])

    // This test verifies TypeScript compilation
    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
    })

    await expect(handler({})).resolves.not.toThrow()
  })

  it('should enforce correct getKey function signature', async () => {
    const mockRpc = createMockRpcClient()
    const mockSyncParams = createMockSyncParams<TestDocument>()

    // Type-safe getKey function
    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => `custom-${doc._id}-${doc.value}`,
      syncParams: mockSyncParams as any,
    })

    const testDocs: TestDocument[] = [
      { _id: 'doc-1', name: 'Test', value: 100 },
    ]
    mockRpc.rpc.mockResolvedValue(testDocs)

    interface ChangeMessage {
      type: string
      key: string
      value: TestDocument
    }
    const writtenMessages: ChangeMessage[] = []
    mockSyncParams.write.mockImplementation((msg: ChangeMessage) => {
      writtenMessages.push(msg)
    })

    await handler({})

    expect(writtenMessages[0].key).toBe('custom-doc-1-100')
  })
})

// =============================================================================
// Integration with TanStack DB Tests
// =============================================================================

describe('TanStack DB integration', () => {
  let mockRpc: MockRpcClient
  let mockSyncParams: MockSyncParams<TestDocument>

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockSyncParams = createMockSyncParams<TestDocument>()
    mockRpc.rpc.mockResolvedValue([])
  })

  it('should return function compatible with SyncReturn.loadSubset', async () => {
    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
    })

    // loadSubset should return true | Promise<void>
    const result = handler({})

    // It's a Promise
    expect(result).toBeInstanceOf(Promise)

    // And it resolves
    await expect(result).resolves.not.toThrow()
  })

  it('should handle LoadSubsetOptions from TanStack DB', async () => {
    const testDocs = createTestDocuments(5)
    mockRpc.rpc.mockResolvedValue(testDocs)

    const handler = createLoadSubsetHandler<TestDocument>({
      rpcClient: mockRpc,
      database: 'testdb',
      collection: 'testcol',
      getKey: (doc) => doc._id,
      syncParams: mockSyncParams as any,
    })

    // Simulate TanStack DB LoadSubsetOptions
    await handler({
      where: { category: 'even' },
      orderBy: { value: 'desc' },
      limit: 10,
      offset: 5,
    })

    expect(mockRpc.rpc).toHaveBeenCalledWith('find', {
      database: 'testdb',
      collection: 'testcol',
      filter: { category: 'even' },
      sort: { value: -1 },
      limit: 10,
      skip: 5,
    })
  })
})

// =============================================================================
// Predicate Compilation Tests (RED PHASE)
// =============================================================================

/**
 * Tests for compiling TanStack DB predicates (BasicExpression) to MongoDB filters.
 *
 * These tests verify that when the loadSubset handler receives a `predicate`
 * in TanStack DB's BasicExpression format, it correctly compiles it to a
 * MongoDB filter query before sending to the RPC.
 *
 * RED PHASE: These tests are expected to FAIL until predicate compilation
 * is integrated into the load-subset handler.
 */
describe('predicate compilation integration', () => {
  let mockRpc: MockRpcClient
  let mockSyncParams: MockSyncParams<TestDocument>

  beforeEach(() => {
    mockRpc = createMockRpcClient()
    mockSyncParams = createMockSyncParams<TestDocument>()
    mockRpc.rpc.mockResolvedValue([])
  })

  describe('equality predicates', () => {
    it('should compile eq predicate to MongoDB filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      // TanStack DB predicate format: { type: 'func', name: 'eq', args: [ref, val] }
      await handler({
        predicate: {
          type: 'func',
          name: 'eq',
          args: [
            { type: 'ref', path: ['category'] },
            { type: 'val', value: 'electronics' },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { category: 'electronics' },
      }))
    })

    it('should compile eq predicate with nested field path', async () => {
      const handler = createLoadSubsetHandler<NestedDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'eq',
          args: [
            { type: 'ref', path: ['user', 'profile', 'firstName'] },
            { type: 'val', value: 'John' },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { 'user.profile.firstName': 'John' },
      }))
    })
  })

  describe('comparison predicates', () => {
    it('should compile gt predicate to MongoDB $gt filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'gt',
          args: [
            { type: 'ref', path: ['value'] },
            { type: 'val', value: 100 },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { value: { $gt: 100 } },
      }))
    })

    it('should compile gte predicate to MongoDB $gte filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'gte',
          args: [
            { type: 'ref', path: ['value'] },
            { type: 'val', value: 50 },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { value: { $gte: 50 } },
      }))
    })

    it('should compile lt predicate to MongoDB $lt filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'lt',
          args: [
            { type: 'ref', path: ['value'] },
            { type: 'val', value: 25 },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { value: { $lt: 25 } },
      }))
    })

    it('should compile lte predicate to MongoDB $lte filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'lte',
          args: [
            { type: 'ref', path: ['value'] },
            { type: 'val', value: 200 },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { value: { $lte: 200 } },
      }))
    })

    it('should compile ne predicate to MongoDB $ne filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'ne',
          args: [
            { type: 'ref', path: ['category'] },
            { type: 'val', value: 'deprecated' },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { category: { $ne: 'deprecated' } },
      }))
    })
  })

  describe('array predicates', () => {
    it('should compile in predicate to MongoDB $in filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'in',
          args: [
            { type: 'ref', path: ['category'] },
            { type: 'val', value: ['electronics', 'clothing', 'books'] },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { category: { $in: ['electronics', 'clothing', 'books'] } },
      }))
    })

    it('should compile nin predicate to MongoDB $nin filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'nin',
          args: [
            { type: 'ref', path: ['category'] },
            { type: 'val', value: ['banned', 'archived'] },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { category: { $nin: ['banned', 'archived'] } },
      }))
    })

    it('should compile all predicate to MongoDB $all filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'all',
          args: [
            { type: 'ref', path: ['tags'] },
            { type: 'val', value: ['featured', 'sale'] },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { tags: { $all: ['featured', 'sale'] } },
      }))
    })

    it('should compile size predicate to MongoDB $size filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'size',
          args: [
            { type: 'ref', path: ['tags'] },
            { type: 'val', value: 3 },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { tags: { $size: 3 } },
      }))
    })

    it('should compile elemMatch predicate to MongoDB $elemMatch filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'elemMatch',
          args: [
            { type: 'ref', path: ['items'] },
            { type: 'val', value: { price: { $gt: 100 }, inStock: true } },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { items: { $elemMatch: { price: { $gt: 100 }, inStock: true } } },
      }))
    })
  })

  describe('logical predicates', () => {
    it('should compile and predicate to MongoDB $and filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'and',
          args: [
            {
              type: 'func',
              name: 'eq',
              args: [
                { type: 'ref', path: ['category'] },
                { type: 'val', value: 'electronics' },
              ],
            },
            {
              type: 'func',
              name: 'gt',
              args: [
                { type: 'ref', path: ['value'] },
                { type: 'val', value: 100 },
              ],
            },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: {
          $and: [
            { category: 'electronics' },
            { value: { $gt: 100 } },
          ],
        },
      }))
    })

    it('should compile or predicate to MongoDB $or filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'or',
          args: [
            {
              type: 'func',
              name: 'eq',
              args: [
                { type: 'ref', path: ['category'] },
                { type: 'val', value: 'sale' },
              ],
            },
            {
              type: 'func',
              name: 'eq',
              args: [
                { type: 'ref', path: ['category'] },
                { type: 'val', value: 'clearance' },
              ],
            },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: {
          $or: [
            { category: 'sale' },
            { category: 'clearance' },
          ],
        },
      }))
    })

    it('should compile not predicate to MongoDB $not filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'not',
          args: [
            {
              type: 'func',
              name: 'eq',
              args: [
                { type: 'ref', path: ['category'] },
                { type: 'val', value: 'archived' },
              ],
            },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { category: { $not: { $eq: 'archived' } } },
      }))
    })

    it('should compile nor predicate to MongoDB $nor filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'nor',
          args: [
            {
              type: 'func',
              name: 'eq',
              args: [
                { type: 'ref', path: ['category'] },
                { type: 'val', value: 'banned' },
              ],
            },
            {
              type: 'func',
              name: 'eq',
              args: [
                { type: 'ref', path: ['category'] },
                { type: 'val', value: 'deleted' },
              ],
            },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: {
          $nor: [
            { category: 'banned' },
            { category: 'deleted' },
          ],
        },
      }))
    })
  })

  describe('string predicates', () => {
    it('should compile startsWith predicate to MongoDB $regex filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'startsWith',
          args: [
            { type: 'ref', path: ['name'] },
            { type: 'val', value: 'Product' },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { name: { $regex: '^Product' } },
      }))
    })

    it('should compile endsWith predicate to MongoDB $regex filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'endsWith',
          args: [
            { type: 'ref', path: ['name'] },
            { type: 'val', value: 'Edition' },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { name: { $regex: 'Edition$' } },
      }))
    })

    it('should compile contains predicate to MongoDB $regex filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'contains',
          args: [
            { type: 'ref', path: ['name'] },
            { type: 'val', value: 'Special' },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { name: { $regex: 'Special' } },
      }))
    })

    it('should compile regex predicate with options to MongoDB $regex filter', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'regex',
          args: [
            { type: 'ref', path: ['name'] },
            { type: 'val', value: '^test' },
            { type: 'val', value: 'i' },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { name: { $regex: '^test', $options: 'i' } },
      }))
    })
  })

  describe('complex nested predicates', () => {
    it('should compile deeply nested and/or predicates', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      // Complex query: (category == 'electronics' AND value > 100) OR (category == 'sale')
      await handler({
        predicate: {
          type: 'func',
          name: 'or',
          args: [
            {
              type: 'func',
              name: 'and',
              args: [
                {
                  type: 'func',
                  name: 'eq',
                  args: [
                    { type: 'ref', path: ['category'] },
                    { type: 'val', value: 'electronics' },
                  ],
                },
                {
                  type: 'func',
                  name: 'gt',
                  args: [
                    { type: 'ref', path: ['value'] },
                    { type: 'val', value: 100 },
                  ],
                },
              ],
            },
            {
              type: 'func',
              name: 'eq',
              args: [
                { type: 'ref', path: ['category'] },
                { type: 'val', value: 'sale' },
              ],
            },
          ],
        },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: {
          $or: [
            {
              $and: [
                { category: 'electronics' },
                { value: { $gt: 100 } },
              ],
            },
            { category: 'sale' },
          ],
        },
      }))
    })
  })

  describe('predicate with other options', () => {
    it('should combine predicate with limit and offset', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'eq',
          args: [
            { type: 'ref', path: ['category'] },
            { type: 'val', value: 'active' },
          ],
        },
        limit: 20,
        offset: 10,
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', {
        database: 'testdb',
        collection: 'testcol',
        filter: { category: 'active' },
        limit: 20,
        skip: 10,
      })
    })

    it('should combine predicate with orderBy', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await handler({
        predicate: {
          type: 'func',
          name: 'gt',
          args: [
            { type: 'ref', path: ['value'] },
            { type: 'val', value: 0 },
          ],
        },
        orderBy: { value: 'desc', name: 'asc' },
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { value: { $gt: 0 } },
        sort: { value: -1, name: 1 },
      }))
    })

    it('should prioritize predicate over where clause when both provided', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      // When both `predicate` and `where` are provided, predicate should take precedence
      await handler({
        predicate: {
          type: 'func',
          name: 'eq',
          args: [
            { type: 'ref', path: ['category'] },
            { type: 'val', value: 'from-predicate' },
          ],
        },
        where: { category: 'from-where' }, // This should be ignored
      })

      expect(mockRpc.rpc).toHaveBeenCalledWith('find', expect.objectContaining({
        filter: { category: 'from-predicate' },
      }))
    })
  })

  describe('predicate compilation errors', () => {
    it('should throw error for unsupported predicate function', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await expect(
        handler({
          predicate: {
            type: 'func',
            name: 'unsupportedFunction',
            args: [
              { type: 'ref', path: ['field'] },
              { type: 'val', value: 'value' },
            ],
          },
        })
      ).rejects.toThrow(/unsupported.*predicate|unsupportedFunction/i)
    })

    it('should throw error for malformed predicate', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      // Missing required 'args' property
      await expect(
        handler({
          predicate: {
            type: 'func',
            name: 'eq',
            // Missing args
          } as any,
        })
      ).rejects.toThrow()
    })

    it('should throw error for invalid predicate type', async () => {
      const handler = createLoadSubsetHandler<TestDocument>({
        rpcClient: mockRpc,
        database: 'testdb',
        collection: 'testcol',
        getKey: (doc) => doc._id,
        syncParams: mockSyncParams as any,
      })

      await expect(
        handler({
          predicate: {
            type: 'val', // Should be 'func' for a predicate
            value: 'something',
          } as any,
        })
      ).rejects.toThrow()
    })
  })
})
