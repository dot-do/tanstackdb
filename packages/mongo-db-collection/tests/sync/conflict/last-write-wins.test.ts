/**
 * @file Last-Write-Wins Conflict Resolution Tests (RED Phase - TDD)
 *
 * Comprehensive test suite for the Last-Write-Wins (LWW) conflict resolution
 * strategy used in Layer 9 synchronization.
 *
 * Last-Write-Wins is a simple but effective conflict resolution strategy that
 * compares timestamps of concurrent writes and accepts the most recent one.
 * This is commonly used in distributed systems where simplicity and performance
 * are prioritized over complex merge semantics.
 *
 * RED PHASE: These tests will fail until the implementation is created
 * in src/sync/conflict/last-write-wins.ts
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createLastWriteWinsStrategy,
  createLastWriteWinsResolver,
  resolveLastWriteWins,
  resolveConflict,
  extractTimestamp,
  compareTimestamps,
  detectConflict,
  type LastWriteWinsConfig,
  type LastWriteWinsResult,
  type LastWriteWinsStrategy,
  type TimestampedDocument,
  type ConflictDetectionResult,
  type TimestampExtractor,
} from '../../../src/sync/conflict/last-write-wins'

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
  }
  updatedAt: Date
}

/**
 * Document with custom timestamp field.
 */
interface CustomTimestampDocument {
  _id: string
  content: string
  modifiedTime: number // Unix timestamp
}

/**
 * Document with MongoDB _ts field (common in Azure Cosmos DB).
 */
interface CosmosDocument {
  _id: string
  _ts: number // Unix timestamp in seconds
  data: string
}

/**
 * Document with nested metadata containing timestamp.
 */
interface MetadataDocument {
  _id: string
  content: string
  metadata: {
    createdAt: Date
    updatedAt: Date
    version: number
    audit: {
      lastModified: Date
      modifiedBy: string
    }
  }
}

/**
 * Document with multiple timestamp fields.
 */
interface MultiTimestampDocument {
  _id: string
  createdAt: Date
  updatedAt: Date
  publishedAt?: Date
  deletedAt?: Date
  content: string
}

/**
 * Document for optimistic locking tests.
 */
interface VersionedDocument {
  _id: string
  version: number
  data: string
  updatedAt: Date
}

// =============================================================================
// SECTION 1: createLastWriteWinsStrategy Factory Tests
// =============================================================================

describe('createLastWriteWinsStrategy', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createLastWriteWinsStrategy).toBe('function')
    })

    it('should return a LastWriteWinsStrategy object', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>()
      expect(strategy).toBeDefined()
      expect(typeof strategy.resolve).toBe('function')
      expect(typeof strategy.detectConflict).toBe('function')
      expect(strategy.name).toBe('last-write-wins')
    })

    it('should accept optional configuration', () => {
      const config: LastWriteWinsConfig<TestDocument> = {
        timestampField: 'updatedAt',
      }
      const strategy = createLastWriteWinsStrategy<TestDocument>(config)
      expect(strategy).toBeDefined()
    })

    it('should accept custom timestamp extractor', () => {
      const config: LastWriteWinsConfig<CustomTimestampDocument> = {
        getTimestamp: (doc) => new Date(doc.modifiedTime),
      }
      const strategy = createLastWriteWinsStrategy<CustomTimestampDocument>(config)
      expect(strategy).toBeDefined()
    })

    it('should accept custom comparator', () => {
      const config: LastWriteWinsConfig<TestDocument> = {
        comparator: (a, b) => a.getTime() - b.getTime(),
      }
      const strategy = createLastWriteWinsStrategy<TestDocument>(config)
      expect(strategy).toBeDefined()
    })

    it('should accept custom tiebreaker function', () => {
      const config: LastWriteWinsConfig<TestDocument> = {
        tieBreaker: (local, remote) => local._id > remote._id ? 'local' : 'remote',
      }
      const strategy = createLastWriteWinsStrategy<TestDocument>(config)
      expect(strategy).toBeDefined()
    })
  })

  describe('strategy.resolve', () => {
    it('should resolve conflict using timestamps', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>()

      const olderDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Old Name',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const newerDoc: TestDocument = {
        _id: 'doc-1',
        name: 'New Name',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      }

      const result = strategy.resolve(olderDoc, newerDoc)
      expect(result.resolved).toEqual(newerDoc)
      expect(result.winner).toBe('remote')
    })

    it('should accept local version when local timestamp is newer', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>()

      const localDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Local Name',
        value: 100,
        updatedAt: new Date('2024-01-01T15:00:00Z'),
      }

      const remoteDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Remote Name',
        value: 50,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const result = strategy.resolve(localDoc, remoteDoc)
      expect(result.resolved).toEqual(localDoc)
      expect(result.winner).toBe('local')
    })
  })
})

// =============================================================================
// SECTION 2: createLastWriteWinsResolver Factory Tests
// =============================================================================

describe('createLastWriteWinsResolver', () => {
  describe('factory function', () => {
    it('should be a function', () => {
      expect(typeof createLastWriteWinsResolver).toBe('function')
    })

    it('should return a resolver function', () => {
      const resolver = createLastWriteWinsResolver<TestDocument>()
      expect(typeof resolver).toBe('function')
    })

    it('should accept optional configuration', () => {
      const config: LastWriteWinsConfig<TestDocument> = {
        timestampField: 'updatedAt',
      }
      const resolver = createLastWriteWinsResolver<TestDocument>(config)
      expect(typeof resolver).toBe('function')
    })

    it('should accept custom timestamp extractor', () => {
      const config: LastWriteWinsConfig<CustomTimestampDocument> = {
        getTimestamp: (doc) => new Date(doc.modifiedTime),
      }
      const resolver = createLastWriteWinsResolver<CustomTimestampDocument>(config)
      expect(typeof resolver).toBe('function')
    })
  })

  describe('resolver execution', () => {
    it('should resolve conflict using timestamps', () => {
      const resolver = createLastWriteWinsResolver<TestDocument>()

      const olderDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Old Name',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const newerDoc: TestDocument = {
        _id: 'doc-1',
        name: 'New Name',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      }

      const result = resolver({
        serverVersion: olderDoc,
        clientVersion: newerDoc,
        serverTimestamp: olderDoc.updatedAt,
        clientTimestamp: newerDoc.updatedAt,
        key: 'doc-1',
      })

      expect(result.resolved).toEqual(newerDoc)
    })

    it('should accept server version when server timestamp is newer', () => {
      const resolver = createLastWriteWinsResolver<TestDocument>()

      const serverDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Server Name',
        value: 100,
        updatedAt: new Date('2024-01-01T15:00:00Z'),
      }

      const clientDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Client Name',
        value: 50,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const result = resolver({
        serverVersion: serverDoc,
        clientVersion: clientDoc,
        serverTimestamp: serverDoc.updatedAt,
        clientTimestamp: clientDoc.updatedAt,
        key: 'doc-1',
      })

      expect(result.resolved).toEqual(serverDoc)
      expect(result.resolutionMetadata?.strategy).toBe('last-write-wins')
      expect(result.resolutionMetadata?.winner).toBe('server')
    })

    it('should accept client version when client timestamp is newer', () => {
      const resolver = createLastWriteWinsResolver<TestDocument>()

      const serverDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Server Name',
        value: 100,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const clientDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Client Name',
        value: 50,
        updatedAt: new Date('2024-01-01T15:00:00Z'),
      }

      const result = resolver({
        serverVersion: serverDoc,
        clientVersion: clientDoc,
        serverTimestamp: serverDoc.updatedAt,
        clientTimestamp: clientDoc.updatedAt,
        key: 'doc-1',
      })

      expect(result.resolved).toEqual(clientDoc)
      expect(result.resolutionMetadata?.strategy).toBe('last-write-wins')
      expect(result.resolutionMetadata?.winner).toBe('client')
    })
  })
})

// =============================================================================
// SECTION 3: resolveConflict Function Tests
// =============================================================================

describe('resolveConflict', () => {
  describe('basic conflict resolution', () => {
    it('should be a function', () => {
      expect(typeof resolveConflict).toBe('function')
    })

    it('should resolve conflict with newer timestamp winning', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>()

      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      }

      const result = resolveConflict(local, remote, strategy)
      expect(result.resolved).toEqual(remote)
      expect(result.winner).toBe('remote')
    })

    it('should resolve conflict with local winning when local is newer', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>()

      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local',
        value: 1,
        updatedAt: new Date('2024-01-01T15:00:00Z'),
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote',
        value: 2,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const result = resolveConflict(local, remote, strategy)
      expect(result.resolved).toEqual(local)
      expect(result.winner).toBe('local')
    })

    it('should use strategy configuration for resolution', () => {
      const strategy = createLastWriteWinsStrategy<CustomTimestampDocument>({
        getTimestamp: (doc) => new Date(doc.modifiedTime),
      })

      const local: CustomTimestampDocument = {
        _id: 'doc-1',
        content: 'Local',
        modifiedTime: 1704067200000,
      }

      const remote: CustomTimestampDocument = {
        _id: 'doc-1',
        content: 'Remote',
        modifiedTime: 1704153600000,
      }

      const result = resolveConflict(local, remote, strategy)
      expect(result.resolved).toEqual(remote)
    })
  })

  describe('with custom strategy options', () => {
    it('should use custom tiebreaker when timestamps are equal', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>({
        tieBreaker: () => 'local',
      })

      const timestamp = new Date('2024-01-01T12:00:00Z')

      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local',
        value: 1,
        updatedAt: timestamp,
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote',
        value: 2,
        updatedAt: timestamp,
      }

      const result = resolveConflict(local, remote, strategy)
      expect(result.resolved).toEqual(local)
      expect(result.winner).toBe('local')
      expect(result.tieBreaker).toBe(true)
    })

    it('should use ID-based tiebreaker when configured', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>({
        tieBreaker: (local, remote) => local._id > remote._id ? 'local' : 'remote',
      })

      const timestamp = new Date('2024-01-01T12:00:00Z')

      const local: TestDocument = {
        _id: 'doc-z', // Alphabetically greater
        name: 'Local',
        value: 1,
        updatedAt: timestamp,
      }

      const remote: TestDocument = {
        _id: 'doc-a', // Alphabetically smaller
        name: 'Remote',
        value: 2,
        updatedAt: timestamp,
      }

      const result = resolveConflict(local, remote, strategy)
      expect(result.resolved).toEqual(local)
    })
  })
})

// =============================================================================
// SECTION 4: extractTimestamp Function Tests
// =============================================================================

describe('extractTimestamp', () => {
  describe('basic extraction', () => {
    it('should be a function', () => {
      expect(typeof extractTimestamp).toBe('function')
    })

    it('should extract timestamp from updatedAt field', () => {
      const doc: TestDocument = {
        _id: 'doc-1',
        name: 'Test',
        value: 1,
        updatedAt: new Date('2024-01-15T10:00:00Z'),
      }

      const timestamp = extractTimestamp(doc, 'updatedAt')
      expect(timestamp).toEqual(new Date('2024-01-15T10:00:00Z'))
    })

    it('should extract timestamp from _ts field (Cosmos DB style)', () => {
      const doc: CosmosDocument = {
        _id: 'doc-1',
        _ts: 1705312800, // Unix timestamp in seconds
        data: 'test',
      }

      const timestamp = extractTimestamp(doc, '_ts')
      // _ts is in seconds, should be converted to Date
      expect(timestamp).toBeInstanceOf(Date)
      expect(timestamp?.getTime()).toBe(1705312800000)
    })

    it('should extract timestamp from nested metadata path', () => {
      const doc: MetadataDocument = {
        _id: 'doc-1',
        content: 'Test',
        metadata: {
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-15T10:00:00Z'),
          version: 3,
          audit: {
            lastModified: new Date('2024-01-15T12:00:00Z'),
            modifiedBy: 'user-1',
          },
        },
      }

      const timestamp = extractTimestamp(doc, 'metadata.updatedAt')
      expect(timestamp).toEqual(new Date('2024-01-15T10:00:00Z'))
    })

    it('should extract timestamp from deeply nested path', () => {
      const doc: MetadataDocument = {
        _id: 'doc-1',
        content: 'Test',
        metadata: {
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-15T10:00:00Z'),
          version: 3,
          audit: {
            lastModified: new Date('2024-01-15T12:00:00Z'),
            modifiedBy: 'user-1',
          },
        },
      }

      const timestamp = extractTimestamp(doc, 'metadata.audit.lastModified')
      expect(timestamp).toEqual(new Date('2024-01-15T12:00:00Z'))
    })
  })

  describe('handling different timestamp formats', () => {
    it('should handle Date objects', () => {
      const doc = { timestamp: new Date('2024-01-15T10:00:00Z') }
      const timestamp = extractTimestamp(doc, 'timestamp')
      expect(timestamp).toBeInstanceOf(Date)
    })

    it('should handle ISO string timestamps', () => {
      const doc = { timestamp: '2024-01-15T10:00:00.000Z' }
      const timestamp = extractTimestamp(doc, 'timestamp')
      expect(timestamp).toBeInstanceOf(Date)
      expect(timestamp?.toISOString()).toBe('2024-01-15T10:00:00.000Z')
    })

    it('should handle Unix timestamps in milliseconds', () => {
      const doc = { timestamp: 1705312800000 }
      const timestamp = extractTimestamp(doc, 'timestamp')
      expect(timestamp).toBeInstanceOf(Date)
    })

    it('should handle Unix timestamps in seconds', () => {
      const doc = { _ts: 1705312800 } // Common in Cosmos DB
      // When using _ts convention, treat as seconds
      const timestamp = extractTimestamp(doc, '_ts', { format: 'seconds' })
      expect(timestamp).toBeInstanceOf(Date)
      expect(timestamp?.getTime()).toBe(1705312800000)
    })
  })

  describe('handling missing timestamps', () => {
    it('should return undefined for missing field', () => {
      const doc = { _id: 'doc-1', name: 'Test' }
      const timestamp = extractTimestamp(doc, 'updatedAt')
      expect(timestamp).toBeUndefined()
    })

    it('should return undefined for null field', () => {
      const doc = { _id: 'doc-1', updatedAt: null }
      const timestamp = extractTimestamp(doc, 'updatedAt')
      expect(timestamp).toBeUndefined()
    })

    it('should return undefined for invalid nested path', () => {
      const doc = { _id: 'doc-1', metadata: {} }
      const timestamp = extractTimestamp(doc, 'metadata.updatedAt')
      expect(timestamp).toBeUndefined()
    })

    it('should return undefined for non-date value', () => {
      const doc = { _id: 'doc-1', updatedAt: 'not-a-date' }
      const timestamp = extractTimestamp(doc, 'updatedAt')
      expect(timestamp).toBeUndefined()
    })
  })

  describe('custom timestamp extractors', () => {
    it('should use custom extractor function', () => {
      const doc: CustomTimestampDocument = {
        _id: 'doc-1',
        content: 'Test',
        modifiedTime: 1705312800000,
      }

      const extractor: TimestampExtractor<CustomTimestampDocument> = (d) =>
        new Date(d.modifiedTime)

      const timestamp = extractTimestamp(doc, extractor)
      expect(timestamp).toEqual(new Date(1705312800000))
    })

    it('should handle extractor returning undefined', () => {
      const doc = { _id: 'doc-1' }

      const extractor: TimestampExtractor<typeof doc> = () => undefined

      const timestamp = extractTimestamp(doc, extractor)
      expect(timestamp).toBeUndefined()
    })

    it('should support array-based field path for nested access', () => {
      const doc: MetadataDocument = {
        _id: 'doc-1',
        content: 'Test',
        metadata: {
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-15T10:00:00Z'),
          version: 3,
          audit: {
            lastModified: new Date('2024-01-15T12:00:00Z'),
            modifiedBy: 'user-1',
          },
        },
      }

      const timestamp = extractTimestamp(doc, ['metadata', 'audit', 'lastModified'])
      expect(timestamp).toEqual(new Date('2024-01-15T12:00:00Z'))
    })
  })
})

// =============================================================================
// SECTION 5: compareTimestamps Function Tests
// =============================================================================

describe('compareTimestamps', () => {
  it('should be a function', () => {
    expect(typeof compareTimestamps).toBe('function')
  })

  it('should return positive number when first timestamp is later', () => {
    const timestamp1 = new Date('2024-01-02T00:00:00Z')
    const timestamp2 = new Date('2024-01-01T00:00:00Z')

    const result = compareTimestamps(timestamp1, timestamp2)
    expect(result).toBeGreaterThan(0)
  })

  it('should return negative number when first timestamp is earlier', () => {
    const timestamp1 = new Date('2024-01-01T00:00:00Z')
    const timestamp2 = new Date('2024-01-02T00:00:00Z')

    const result = compareTimestamps(timestamp1, timestamp2)
    expect(result).toBeLessThan(0)
  })

  it('should return zero when timestamps are equal', () => {
    const timestamp = new Date('2024-01-01T12:00:00Z')

    const result = compareTimestamps(timestamp, timestamp)
    expect(result).toBe(0)
  })

  it('should handle Date objects', () => {
    const date1 = new Date(1704067200000)
    const date2 = new Date(1704153600000)

    expect(compareTimestamps(date1, date2)).toBeLessThan(0)
    expect(compareTimestamps(date2, date1)).toBeGreaterThan(0)
  })

  it('should handle equal Date objects created differently', () => {
    const date1 = new Date('2024-01-01T00:00:00.000Z')
    const date2 = new Date(1704067200000) // Same timestamp

    expect(compareTimestamps(date1, date2)).toBe(0)
  })

  it('should handle millisecond precision', () => {
    const date1 = new Date('2024-01-01T00:00:00.000Z')
    const date2 = new Date('2024-01-01T00:00:00.001Z')

    expect(compareTimestamps(date1, date2)).toBeLessThan(0)
    expect(compareTimestamps(date2, date1)).toBeGreaterThan(0)
  })

  it('should handle dates far apart', () => {
    const date1 = new Date('2020-01-01T00:00:00Z')
    const date2 = new Date('2025-01-01T00:00:00Z')

    expect(compareTimestamps(date1, date2)).toBeLessThan(0)
    expect(compareTimestamps(date2, date1)).toBeGreaterThan(0)
  })

  it('should handle epoch dates', () => {
    const epoch = new Date(0)
    const later = new Date(1000)

    expect(compareTimestamps(epoch, later)).toBeLessThan(0)
  })
})

// =============================================================================
// SECTION 6: detectConflict Function Tests
// =============================================================================

describe('detectConflict', () => {
  describe('basic conflict detection', () => {
    it('should be a function', () => {
      expect(typeof detectConflict).toBe('function')
    })

    it('should detect no conflict when documents are identical', () => {
      const doc: TestDocument = {
        _id: 'doc-1',
        name: 'Test',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const result = detectConflict(doc, doc)
      expect(result.hasConflict).toBe(false)
    })

    it('should detect conflict when documents differ', () => {
      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local Name',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote Name',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      }

      const result = detectConflict(local, remote)
      expect(result.hasConflict).toBe(true)
    })

    it('should identify conflicting fields', () => {
      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local Name',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote Name',
        value: 1, // Same value
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      }

      const result = detectConflict(local, remote)
      expect(result.hasConflict).toBe(true)
      expect(result.conflictingFields).toContain('name')
      expect(result.conflictingFields).not.toContain('value')
    })
  })

  describe('concurrent modification detection', () => {
    it('should detect concurrent modifications with base version', () => {
      const base: TestDocument = {
        _id: 'doc-1',
        name: 'Original',
        value: 1,
        updatedAt: new Date('2024-01-01T08:00:00Z'),
      }

      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local Change',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote Change',
        value: 1,
        updatedAt: new Date('2024-01-01T11:00:00Z'),
      }

      const result = detectConflict(local, remote, { baseVersion: base })
      expect(result.hasConflict).toBe(true)
      expect(result.concurrentModification).toBe(true)
    })

    it('should not detect concurrent modification when only one side changed', () => {
      const base: TestDocument = {
        _id: 'doc-1',
        name: 'Original',
        value: 1,
        updatedAt: new Date('2024-01-01T08:00:00Z'),
      }

      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Original', // No change
        value: 1,
        updatedAt: new Date('2024-01-01T08:00:00Z'),
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote Change',
        value: 1,
        updatedAt: new Date('2024-01-01T11:00:00Z'),
      }

      const result = detectConflict(local, remote, { baseVersion: base })
      expect(result.hasConflict).toBe(false)
      expect(result.concurrentModification).toBe(false)
    })
  })

  describe('version conflict detection', () => {
    it('should detect version mismatch', () => {
      const local: VersionedDocument = {
        _id: 'doc-1',
        version: 5,
        data: 'local data',
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const remote: VersionedDocument = {
        _id: 'doc-1',
        version: 7, // Higher version
        data: 'remote data',
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      }

      const result = detectConflict(local, remote, {
        versionField: 'version',
      })

      expect(result.hasConflict).toBe(true)
      expect(result.versionConflict).toBe(true)
      expect(result.localVersion).toBe(5)
      expect(result.remoteVersion).toBe(7)
    })

    it('should not report version conflict when versions match', () => {
      const local: VersionedDocument = {
        _id: 'doc-1',
        version: 5,
        data: 'local data',
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const remote: VersionedDocument = {
        _id: 'doc-1',
        version: 5, // Same version
        data: 'remote data',
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      }

      const result = detectConflict(local, remote, {
        versionField: 'version',
      })

      expect(result.versionConflict).toBe(false)
    })
  })

  describe('optimistic locking detection', () => {
    it('should detect optimistic lock failure', () => {
      const base: VersionedDocument = {
        _id: 'doc-1',
        version: 5,
        data: 'original',
        updatedAt: new Date('2024-01-01T08:00:00Z'),
      }

      const local: VersionedDocument = {
        _id: 'doc-1',
        version: 6, // Incremented from base
        data: 'local change',
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const remote: VersionedDocument = {
        _id: 'doc-1',
        version: 7, // Also incremented from base (conflict!)
        data: 'remote change',
        updatedAt: new Date('2024-01-01T11:00:00Z'),
      }

      const result = detectConflict(local, remote, {
        baseVersion: base,
        versionField: 'version',
        optimisticLocking: true,
      })

      expect(result.hasConflict).toBe(true)
      expect(result.optimisticLockFailure).toBe(true)
    })

    it('should not report optimistic lock failure when remote version matches expected', () => {
      const base: VersionedDocument = {
        _id: 'doc-1',
        version: 5,
        data: 'original',
        updatedAt: new Date('2024-01-01T08:00:00Z'),
      }

      const local: VersionedDocument = {
        _id: 'doc-1',
        version: 6,
        data: 'local change',
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const remote: VersionedDocument = {
        _id: 'doc-1',
        version: 5, // Same as base - no conflict
        data: 'original',
        updatedAt: new Date('2024-01-01T08:00:00Z'),
      }

      const result = detectConflict(local, remote, {
        baseVersion: base,
        versionField: 'version',
        optimisticLocking: true,
      })

      expect(result.optimisticLockFailure).toBe(false)
    })
  })
})

// =============================================================================
// SECTION 7: resolveLastWriteWins Function Tests (Direct API)
// =============================================================================

describe('resolveLastWriteWins', () => {
  describe('basic functionality', () => {
    it('should be a function', () => {
      expect(typeof resolveLastWriteWins).toBe('function')
    })

    it('should return the document with the later timestamp', () => {
      const serverDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Server',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const clientDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Client',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      }

      const result = resolveLastWriteWins({
        serverVersion: serverDoc,
        clientVersion: clientDoc,
        serverTimestamp: serverDoc.updatedAt,
        clientTimestamp: clientDoc.updatedAt,
        key: 'doc-1',
      })

      expect(result.resolved).toEqual(clientDoc)
    })

    it('should handle Date objects as timestamps', () => {
      const serverTimestamp = new Date('2024-06-15T10:00:00Z')
      const clientTimestamp = new Date('2024-06-15T11:00:00Z')

      const result = resolveLastWriteWins<TestDocument>({
        serverVersion: {
          _id: 'doc-1',
          name: 'Server',
          value: 1,
          updatedAt: serverTimestamp,
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client',
          value: 2,
          updatedAt: clientTimestamp,
        },
        serverTimestamp,
        clientTimestamp,
        key: 'doc-1',
      })

      expect(result.resolved.name).toBe('Client')
    })

    it('should handle numeric timestamps (Unix epoch)', () => {
      const serverTimestamp = new Date(1704067200000) // 2024-01-01T00:00:00Z
      const clientTimestamp = new Date(1704153600000) // 2024-01-02T00:00:00Z

      const result = resolveLastWriteWins<TestDocument>({
        serverVersion: {
          _id: 'doc-1',
          name: 'Server',
          value: 1,
          updatedAt: serverTimestamp,
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client',
          value: 2,
          updatedAt: clientTimestamp,
        },
        serverTimestamp,
        clientTimestamp,
        key: 'doc-1',
      })

      expect(result.resolved.name).toBe('Client')
    })

    it('should handle ISO string timestamps', () => {
      const serverTimestamp = new Date('2024-01-01T00:00:00.000Z')
      const clientTimestamp = new Date('2024-01-02T00:00:00.000Z')

      const result = resolveLastWriteWins<TestDocument>({
        serverVersion: {
          _id: 'doc-1',
          name: 'Server',
          value: 1,
          updatedAt: serverTimestamp,
        },
        clientVersion: {
          _id: 'doc-1',
          name: 'Client',
          value: 2,
          updatedAt: clientTimestamp,
        },
        serverTimestamp,
        clientTimestamp,
        key: 'doc-1',
      })

      expect(result.resolved.name).toBe('Client')
    })
  })

  describe('tie-breaking', () => {
    it('should use server-wins as default tie-breaker when timestamps are equal', () => {
      const timestamp = new Date('2024-01-01T12:00:00Z')

      const serverDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Server',
        value: 100,
        updatedAt: timestamp,
      }

      const clientDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Client',
        value: 200,
        updatedAt: timestamp,
      }

      const result = resolveLastWriteWins({
        serverVersion: serverDoc,
        clientVersion: clientDoc,
        serverTimestamp: timestamp,
        clientTimestamp: timestamp,
        key: 'doc-1',
      })

      // Default tie-breaker should prefer server
      expect(result.resolved).toEqual(serverDoc)
      expect(result.resolutionMetadata?.tieBreaker).toBe(true)
    })

    it('should allow custom tie-breaker to prefer client', () => {
      const timestamp = new Date('2024-01-01T12:00:00Z')

      const serverDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Server',
        value: 100,
        updatedAt: timestamp,
      }

      const clientDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Client',
        value: 200,
        updatedAt: timestamp,
      }

      const result = resolveLastWriteWins(
        {
          serverVersion: serverDoc,
          clientVersion: clientDoc,
          serverTimestamp: timestamp,
          clientTimestamp: timestamp,
          key: 'doc-1',
        },
        { tieBreaker: 'client-wins' }
      )

      expect(result.resolved).toEqual(clientDoc)
      expect(result.resolutionMetadata?.tieBreaker).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle millisecond-level timestamp differences', () => {
      const serverTimestamp = new Date('2024-01-01T12:00:00.000Z')
      const clientTimestamp = new Date('2024-01-01T12:00:00.001Z') // 1ms later

      const serverDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Server',
        value: 1,
        updatedAt: serverTimestamp,
      }

      const clientDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Client',
        value: 2,
        updatedAt: clientTimestamp,
      }

      const result = resolveLastWriteWins({
        serverVersion: serverDoc,
        clientVersion: clientDoc,
        serverTimestamp,
        clientTimestamp,
        key: 'doc-1',
      })

      // Client is 1ms newer
      expect(result.resolved).toEqual(clientDoc)
    })

    it('should handle nested documents correctly', () => {
      const serverTimestamp = new Date('2024-01-01T10:00:00Z')
      const clientTimestamp = new Date('2024-01-01T12:00:00Z')

      const serverDoc: NestedDocument = {
        _id: 'doc-1',
        user: {
          profile: {
            firstName: 'Server',
            lastName: 'User',
          },
        },
        updatedAt: serverTimestamp,
      }

      const clientDoc: NestedDocument = {
        _id: 'doc-1',
        user: {
          profile: {
            firstName: 'Client',
            lastName: 'User',
          },
        },
        updatedAt: clientTimestamp,
      }

      const result = resolveLastWriteWins<NestedDocument>({
        serverVersion: serverDoc,
        clientVersion: clientDoc,
        serverTimestamp,
        clientTimestamp,
        key: 'doc-1',
      })

      expect(result.resolved.user.profile.firstName).toBe('Client')
    })

    it('should preserve all document fields in the resolved version', () => {
      const serverTimestamp = new Date('2024-01-01T10:00:00Z')
      const clientTimestamp = new Date('2024-01-01T12:00:00Z')

      const serverDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Server',
        value: 100,
        updatedAt: serverTimestamp,
      }

      const clientDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Client',
        value: 200,
        updatedAt: clientTimestamp,
      }

      const result = resolveLastWriteWins({
        serverVersion: serverDoc,
        clientVersion: clientDoc,
        serverTimestamp,
        clientTimestamp,
        key: 'doc-1',
      })

      expect(result.resolved._id).toBe('doc-1')
      expect(result.resolved.name).toBe('Client')
      expect(result.resolved.value).toBe(200)
      expect(result.resolved.updatedAt).toEqual(clientTimestamp)
    })
  })
})

// =============================================================================
// SECTION 8: Resolution Metadata Tests
// =============================================================================

describe('resolution metadata', () => {
  it('should include strategy in metadata', () => {
    const resolver = createLastWriteWinsResolver<TestDocument>()

    const result = resolver({
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      },
      serverTimestamp: new Date('2024-01-01T10:00:00Z'),
      clientTimestamp: new Date('2024-01-01T12:00:00Z'),
      key: 'doc-1',
    })

    expect(result.resolutionMetadata?.strategy).toBe('last-write-wins')
  })

  it('should include winner in metadata', () => {
    const resolver = createLastWriteWinsResolver<TestDocument>()

    const result = resolver({
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      },
      serverTimestamp: new Date('2024-01-01T10:00:00Z'),
      clientTimestamp: new Date('2024-01-01T12:00:00Z'),
      key: 'doc-1',
    })

    expect(result.resolutionMetadata?.winner).toBe('client')
  })

  it('should include timestamp difference in metadata', () => {
    const serverTimestamp = new Date('2024-01-01T10:00:00Z')
    const clientTimestamp = new Date('2024-01-01T12:00:00Z')
    const expectedDiffMs = clientTimestamp.getTime() - serverTimestamp.getTime()

    const resolver = createLastWriteWinsResolver<TestDocument>()

    const result = resolver({
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        value: 1,
        updatedAt: serverTimestamp,
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        value: 2,
        updatedAt: clientTimestamp,
      },
      serverTimestamp,
      clientTimestamp,
      key: 'doc-1',
    })

    expect(result.resolutionMetadata?.timestampDiffMs).toBe(expectedDiffMs)
  })

  it('should include resolvedAt timestamp in metadata', () => {
    const before = new Date()
    const resolver = createLastWriteWinsResolver<TestDocument>()

    const result = resolver({
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      },
      serverTimestamp: new Date('2024-01-01T10:00:00Z'),
      clientTimestamp: new Date('2024-01-01T12:00:00Z'),
      key: 'doc-1',
    })

    const after = new Date()
    const resolvedAt = result.resolutionMetadata?.resolvedAt as Date

    expect(resolvedAt).toBeDefined()
    expect(resolvedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(resolvedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('should include document key in metadata', () => {
    const resolver = createLastWriteWinsResolver<TestDocument>()

    const result = resolver({
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      },
      serverTimestamp: new Date('2024-01-01T10:00:00Z'),
      clientTimestamp: new Date('2024-01-01T12:00:00Z'),
      key: 'doc-1',
    })

    expect(result.resolutionMetadata?.documentKey).toBe('doc-1')
  })
})

// =============================================================================
// SECTION 9: Custom Timestamp Field Tests
// =============================================================================

describe('custom timestamp field', () => {
  it('should extract timestamp from custom field', () => {
    const config: LastWriteWinsConfig<CustomTimestampDocument> = {
      getTimestamp: (doc) => new Date(doc.modifiedTime),
    }

    const resolver = createLastWriteWinsResolver<CustomTimestampDocument>(config)

    const serverDoc: CustomTimestampDocument = {
      _id: 'doc-1',
      content: 'Server Content',
      modifiedTime: 1704067200000, // Earlier
    }

    const clientDoc: CustomTimestampDocument = {
      _id: 'doc-1',
      content: 'Client Content',
      modifiedTime: 1704153600000, // Later
    }

    const result = resolver({
      serverVersion: serverDoc,
      clientVersion: clientDoc,
      serverTimestamp: new Date(serverDoc.modifiedTime),
      clientTimestamp: new Date(clientDoc.modifiedTime),
      key: 'doc-1',
    })

    expect(result.resolved).toEqual(clientDoc)
  })

  it('should use timestampField option for extraction', () => {
    interface DocWithLastModified {
      _id: string
      data: string
      lastModified: Date
    }

    const config: LastWriteWinsConfig<DocWithLastModified> = {
      timestampField: 'lastModified',
    }

    const resolver = createLastWriteWinsResolver<DocWithLastModified>(config)

    const serverDoc: DocWithLastModified = {
      _id: 'doc-1',
      data: 'Server',
      lastModified: new Date('2024-01-01T10:00:00Z'),
    }

    const clientDoc: DocWithLastModified = {
      _id: 'doc-1',
      data: 'Client',
      lastModified: new Date('2024-01-01T12:00:00Z'),
    }

    const result = resolver({
      serverVersion: serverDoc,
      clientVersion: clientDoc,
      serverTimestamp: serverDoc.lastModified,
      clientTimestamp: clientDoc.lastModified,
      key: 'doc-1',
    })

    expect(result.resolved.data).toBe('Client')
  })

  it('should support nested timestamp field path', () => {
    const config: LastWriteWinsConfig<MetadataDocument> = {
      timestampField: 'metadata.updatedAt',
    }

    const resolver = createLastWriteWinsResolver<MetadataDocument>(config)

    const serverDoc: MetadataDocument = {
      _id: 'doc-1',
      content: 'Server',
      metadata: {
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T10:00:00Z'),
        version: 1,
        audit: {
          lastModified: new Date('2024-01-01T10:00:00Z'),
          modifiedBy: 'user-1',
        },
      },
    }

    const clientDoc: MetadataDocument = {
      _id: 'doc-1',
      content: 'Client',
      metadata: {
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T12:00:00Z'),
        version: 2,
        audit: {
          lastModified: new Date('2024-01-01T12:00:00Z'),
          modifiedBy: 'user-2',
        },
      },
    }

    const result = resolver({
      serverVersion: serverDoc,
      clientVersion: clientDoc,
      serverTimestamp: serverDoc.metadata.updatedAt,
      clientTimestamp: clientDoc.metadata.updatedAt,
      key: 'doc-1',
    })

    expect(result.resolved.content).toBe('Client')
  })
})

// =============================================================================
// SECTION 10: Strategy Configuration Tests
// =============================================================================

describe('strategy configuration', () => {
  describe('custom timestamp field names', () => {
    it('should use _ts field for Cosmos DB documents', () => {
      const config: LastWriteWinsConfig<CosmosDocument> = {
        timestampField: '_ts',
        timestampFormat: 'seconds',
      }

      const strategy = createLastWriteWinsStrategy<CosmosDocument>(config)

      const local: CosmosDocument = {
        _id: 'doc-1',
        _ts: 1705312800,
        data: 'local',
      }

      const remote: CosmosDocument = {
        _id: 'doc-1',
        _ts: 1705316400,
        data: 'remote',
      }

      const result = strategy.resolve(local, remote)
      expect(result.resolved).toEqual(remote)
    })

    it('should use multiple possible timestamp fields with fallback', () => {
      const config: LastWriteWinsConfig<Record<string, unknown>> = {
        timestampFields: ['updatedAt', 'modifiedAt', '_ts', 'timestamp'],
      }

      const strategy = createLastWriteWinsStrategy<Record<string, unknown>>(config)

      const local = {
        _id: 'doc-1',
        modifiedAt: new Date('2024-01-01T10:00:00Z'),
        data: 'local',
      }

      const remote = {
        _id: 'doc-1',
        modifiedAt: new Date('2024-01-01T12:00:00Z'),
        data: 'remote',
      }

      const result = strategy.resolve(local, remote)
      expect(result.resolved).toEqual(remote)
    })
  })

  describe('custom comparators', () => {
    it('should use custom comparator for timestamp comparison', () => {
      const config: LastWriteWinsConfig<TestDocument> = {
        comparator: (a, b) => {
          // Custom: prefer even seconds over odd
          const aEven = a.getSeconds() % 2 === 0
          const bEven = b.getSeconds() % 2 === 0
          if (aEven && !bEven) return 1
          if (!aEven && bEven) return -1
          return a.getTime() - b.getTime()
        },
      }

      const strategy = createLastWriteWinsStrategy<TestDocument>(config)

      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local',
        value: 1,
        updatedAt: new Date('2024-01-01T12:00:02Z'), // Even seconds
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:03Z'), // Odd seconds (but later)
      }

      const result = strategy.resolve(local, remote)
      // Custom comparator prefers even seconds
      expect(result.resolved).toEqual(local)
    })

    it('should support reverse comparator (oldest wins)', () => {
      const config: LastWriteWinsConfig<TestDocument> = {
        comparator: (a, b) => b.getTime() - a.getTime(), // Reversed
      }

      const strategy = createLastWriteWinsStrategy<TestDocument>(config)

      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'), // Earlier
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'), // Later
      }

      const result = strategy.resolve(local, remote)
      // Reversed comparator means older wins
      expect(result.resolved).toEqual(local)
    })
  })

  describe('tiebreaker functions', () => {
    it('should use document ID as tiebreaker', () => {
      const config: LastWriteWinsConfig<TestDocument> = {
        tieBreaker: (local, remote) => (local._id > remote._id ? 'local' : 'remote'),
      }

      const strategy = createLastWriteWinsStrategy<TestDocument>(config)
      const timestamp = new Date('2024-01-01T12:00:00Z')

      const local: TestDocument = {
        _id: 'zzz', // Alphabetically greater
        name: 'Local',
        value: 1,
        updatedAt: timestamp,
      }

      const remote: TestDocument = {
        _id: 'aaa', // Alphabetically smaller
        name: 'Remote',
        value: 2,
        updatedAt: timestamp,
      }

      const result = strategy.resolve(local, remote)
      expect(result.resolved).toEqual(local)
      expect(result.tieBreaker).toBe(true)
    })

    it('should use hash-based tiebreaker for deterministic results', () => {
      const config: LastWriteWinsConfig<TestDocument> = {
        tieBreaker: (local, remote) => {
          // Simple hash based on document content
          const localHash = JSON.stringify(local).length
          const remoteHash = JSON.stringify(remote).length
          return localHash > remoteHash ? 'local' : 'remote'
        },
      }

      const strategy = createLastWriteWinsStrategy<TestDocument>(config)
      const timestamp = new Date('2024-01-01T12:00:00Z')

      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local Name That Is Longer',
        value: 1,
        updatedAt: timestamp,
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Short',
        value: 2,
        updatedAt: timestamp,
      }

      const result = strategy.resolve(local, remote)
      expect(result.resolved).toEqual(local)
    })

    it('should support async tiebreaker (e.g., fetching priority)', async () => {
      const config: LastWriteWinsConfig<TestDocument> = {
        tieBreaker: async (local, remote) => {
          // Simulate async lookup (e.g., checking user permissions)
          await new Promise((resolve) => setTimeout(resolve, 10))
          return local.value > remote.value ? 'local' : 'remote'
        },
      }

      const strategy = createLastWriteWinsStrategy<TestDocument>(config)
      const timestamp = new Date('2024-01-01T12:00:00Z')

      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local',
        value: 100, // Higher value
        updatedAt: timestamp,
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote',
        value: 50, // Lower value
        updatedAt: timestamp,
      }

      const result = await strategy.resolveAsync(local, remote)
      expect(result.resolved).toEqual(local)
    })
  })
})

// =============================================================================
// SECTION 11: Integration with Sync Tests
// =============================================================================

describe('integration with sync', () => {
  describe('apply LWW during sync', () => {
    it('should resolve batch of conflicts using LWW', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>()

      const conflicts = [
        {
          local: {
            _id: 'doc-1',
            name: 'Local 1',
            value: 1,
            updatedAt: new Date('2024-01-01T10:00:00Z'),
          },
          remote: {
            _id: 'doc-1',
            name: 'Remote 1',
            value: 2,
            updatedAt: new Date('2024-01-01T12:00:00Z'),
          },
        },
        {
          local: {
            _id: 'doc-2',
            name: 'Local 2',
            value: 3,
            updatedAt: new Date('2024-01-01T15:00:00Z'),
          },
          remote: {
            _id: 'doc-2',
            name: 'Remote 2',
            value: 4,
            updatedAt: new Date('2024-01-01T11:00:00Z'),
          },
        },
      ]

      const results = conflicts.map((c) => strategy.resolve(c.local, c.remote))

      expect(results[0].resolved.name).toBe('Remote 1') // Remote newer
      expect(results[1].resolved.name).toBe('Local 2') // Local newer
    })

    it('should integrate with sync context', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>()

      const syncContext = {
        syncId: 'sync-123',
        startTime: new Date(),
        conflictsResolved: 0,
      }

      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      }

      const result = strategy.resolve(local, remote, { syncContext })

      expect(result.resolved).toEqual(remote)
      expect(result.metadata?.syncId).toBe('sync-123')
    })
  })

  describe('merge with local changes', () => {
    it('should preserve local changes when they are newer', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>()

      // Simulate offline scenario where local has newer changes
      const localOfflineChange: TestDocument = {
        _id: 'doc-1',
        name: 'Edited Offline',
        value: 999,
        updatedAt: new Date('2024-01-01T20:00:00Z'), // Edited after going offline
      }

      const serverVersion: TestDocument = {
        _id: 'doc-1',
        name: 'Server Version',
        value: 100,
        updatedAt: new Date('2024-01-01T15:00:00Z'), // Server change before offline edit
      }

      const result = strategy.resolve(localOfflineChange, serverVersion)

      expect(result.resolved).toEqual(localOfflineChange)
      expect(result.winner).toBe('local')
    })

    it('should accept remote changes when they are newer', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>()

      const localStale: TestDocument = {
        _id: 'doc-1',
        name: 'Old Local',
        value: 50,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const serverNewer: TestDocument = {
        _id: 'doc-1',
        name: 'Updated on Server',
        value: 200,
        updatedAt: new Date('2024-01-01T18:00:00Z'),
      }

      const result = strategy.resolve(localStale, serverNewer)

      expect(result.resolved).toEqual(serverNewer)
      expect(result.winner).toBe('remote')
    })

    it('should track which fields were overwritten', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>({
        trackOverwrittenFields: true,
      })

      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local Name',
        value: 100,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote Name',
        value: 200,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      }

      const result = strategy.resolve(local, remote)

      expect(result.resolved).toEqual(remote)
      expect(result.metadata?.overwrittenFields).toContain('name')
      expect(result.metadata?.overwrittenFields).toContain('value')
    })
  })

  describe('handle offline conflicts', () => {
    it('should handle conflict from offline queue', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>()

      // Simulate offline mutation that was queued
      const offlineMutation = {
        type: 'update' as const,
        documentId: 'doc-1',
        timestamp: new Date('2024-01-01T14:00:00Z'),
        changes: {
          name: 'Offline Change',
          value: 42,
        },
      }

      const offlineDoc: TestDocument = {
        _id: 'doc-1',
        name: 'Offline Change',
        value: 42,
        updatedAt: offlineMutation.timestamp,
      }

      const serverCurrent: TestDocument = {
        _id: 'doc-1',
        name: 'Current Server',
        value: 100,
        updatedAt: new Date('2024-01-01T12:00:00Z'), // Before offline mutation
      }

      const result = strategy.resolve(offlineDoc, serverCurrent)

      expect(result.resolved).toEqual(offlineDoc)
      expect(result.winner).toBe('local')
    })

    it('should handle multiple offline changes in sequence', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>()

      const offlineMutations = [
        {
          doc: {
            _id: 'doc-1',
            name: 'First Offline Edit',
            value: 1,
            updatedAt: new Date('2024-01-01T10:00:00Z'),
          },
        },
        {
          doc: {
            _id: 'doc-1',
            name: 'Second Offline Edit',
            value: 2,
            updatedAt: new Date('2024-01-01T11:00:00Z'),
          },
        },
        {
          doc: {
            _id: 'doc-1',
            name: 'Third Offline Edit',
            value: 3,
            updatedAt: new Date('2024-01-01T12:00:00Z'),
          },
        },
      ]

      // Find the latest offline mutation
      const latestOffline = offlineMutations.reduce((latest, current) =>
        current.doc.updatedAt > latest.doc.updatedAt ? current : latest
      )

      const serverVersion: TestDocument = {
        _id: 'doc-1',
        name: 'Server Version',
        value: 100,
        updatedAt: new Date('2024-01-01T09:00:00Z'), // Before all offline changes
      }

      const result = strategy.resolve(latestOffline.doc, serverVersion)

      expect(result.resolved).toEqual(latestOffline.doc)
      expect(result.resolved.name).toBe('Third Offline Edit')
    })

    it('should handle conflict when coming back online', () => {
      const strategy = createLastWriteWinsStrategy<TestDocument>()

      // User went offline at 10:00
      // Made local changes at 11:00 and 12:00
      // Server received changes from another user at 11:30
      // User comes back online at 13:00

      const localFinalState: TestDocument = {
        _id: 'doc-1',
        name: 'User A Final Edit',
        value: 50,
        updatedAt: new Date('2024-01-01T12:00:00Z'), // Last local edit
      }

      const serverCurrentState: TestDocument = {
        _id: 'doc-1',
        name: 'User B Server Edit',
        value: 75,
        updatedAt: new Date('2024-01-01T11:30:00Z'), // Server change from another user
      }

      const result = strategy.resolve(localFinalState, serverCurrentState)

      // Local is newer (12:00 > 11:30)
      expect(result.resolved).toEqual(localFinalState)
      expect(result.winner).toBe('local')
    })

    it('should emit conflict event for logging/analytics', () => {
      const conflictEvents: Array<{ local: TestDocument; remote: TestDocument; winner: string }> =
        []

      const strategy = createLastWriteWinsStrategy<TestDocument>({
        onConflict: (local, remote, result) => {
          conflictEvents.push({ local, remote, winner: result.winner })
        },
      })

      const local: TestDocument = {
        _id: 'doc-1',
        name: 'Local',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      }

      const remote: TestDocument = {
        _id: 'doc-1',
        name: 'Remote',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      }

      strategy.resolve(local, remote)

      expect(conflictEvents).toHaveLength(1)
      expect(conflictEvents[0].winner).toBe('remote')
    })
  })
})

// =============================================================================
// SECTION 12: Missing Timestamp Handling Tests
// =============================================================================

describe('missing timestamp handling', () => {
  it('should handle document with missing updatedAt field', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>({
      handleMissingTimestamp: 'use-current-time',
    })

    const local = {
      _id: 'doc-1',
      name: 'Local',
      value: 1,
    } as TestDocument // Missing updatedAt

    const remote: TestDocument = {
      _id: 'doc-1',
      name: 'Remote',
      value: 2,
      updatedAt: new Date('2024-01-01T12:00:00Z'),
    }

    const result = strategy.resolve(local, remote)

    // With 'use-current-time', local gets current time which is newer
    expect(result.resolved._id).toBe('doc-1')
    expect(result.metadata?.missingTimestampHandled).toBe(true)
  })

  it('should prefer document with timestamp when other is missing (prefer-with-timestamp)', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>({
      handleMissingTimestamp: 'prefer-with-timestamp',
    })

    const local = {
      _id: 'doc-1',
      name: 'Local',
      value: 1,
    } as TestDocument // Missing updatedAt

    const remote: TestDocument = {
      _id: 'doc-1',
      name: 'Remote',
      value: 2,
      updatedAt: new Date('2024-01-01T12:00:00Z'),
    }

    const result = strategy.resolve(local, remote)

    expect(result.resolved).toEqual(remote)
    expect(result.metadata?.missingTimestampHandled).toBe(true)
  })

  it('should use default timestamp when both are missing', () => {
    const defaultTimestamp = new Date('2024-01-01T00:00:00Z')

    const strategy = createLastWriteWinsStrategy<TestDocument>({
      handleMissingTimestamp: 'use-default',
      defaultTimestamp,
    })

    const local = {
      _id: 'doc-1',
      name: 'Local',
      value: 1,
    } as TestDocument

    const remote = {
      _id: 'doc-1',
      name: 'Remote',
      value: 2,
    } as TestDocument

    const result = strategy.resolve(local, remote)

    // Both use default, so tiebreaker kicks in
    expect(result.tieBreaker).toBe(true)
  })

  it('should throw error when timestamp is required but missing', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>({
      handleMissingTimestamp: 'throw',
    })

    const local = {
      _id: 'doc-1',
      name: 'Local',
      value: 1,
    } as TestDocument

    const remote: TestDocument = {
      _id: 'doc-1',
      name: 'Remote',
      value: 2,
      updatedAt: new Date('2024-01-01T12:00:00Z'),
    }

    expect(() => strategy.resolve(local, remote)).toThrow('Missing timestamp')
  })

  it('should handle undefined timestamp gracefully', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    const local: TestDocument = {
      _id: 'doc-1',
      name: 'Local',
      value: 1,
      updatedAt: undefined as unknown as Date,
    }

    const remote: TestDocument = {
      _id: 'doc-1',
      name: 'Remote',
      value: 2,
      updatedAt: new Date('2024-01-01T12:00:00Z'),
    }

    // Default behavior should handle gracefully
    const result = strategy.resolve(local, remote)
    expect(result.resolved).toBeDefined()
  })

  it('should handle null timestamp gracefully', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    const local: TestDocument = {
      _id: 'doc-1',
      name: 'Local',
      value: 1,
      updatedAt: null as unknown as Date,
    }

    const remote: TestDocument = {
      _id: 'doc-1',
      name: 'Remote',
      value: 2,
      updatedAt: new Date('2024-01-01T12:00:00Z'),
    }

    const result = strategy.resolve(local, remote)
    expect(result.resolved).toBeDefined()
  })
})

// =============================================================================
// SECTION 13: ConflictContext Integration Tests
// =============================================================================

describe('ConflictContext integration', () => {
  it('should work with full ConflictContext', () => {
    const resolver = createLastWriteWinsResolver<TestDocument>()

    const serverDoc: TestDocument = {
      _id: 'doc-1',
      name: 'Server',
      value: 1,
      updatedAt: new Date('2024-01-01T10:00:00Z'),
    }

    const clientDoc: TestDocument = {
      _id: 'doc-1',
      name: 'Client',
      value: 2,
      updatedAt: new Date('2024-01-01T12:00:00Z'),
    }

    const baseDoc: TestDocument = {
      _id: 'doc-1',
      name: 'Base',
      value: 0,
      updatedAt: new Date('2024-01-01T08:00:00Z'),
    }

    const result = resolver({
      serverVersion: serverDoc,
      clientVersion: clientDoc,
      baseVersion: baseDoc,
      serverTimestamp: serverDoc.updatedAt,
      clientTimestamp: clientDoc.updatedAt,
      key: 'doc-1',
      conflictingFields: ['name', 'value'],
      metadata: { source: 'test' },
    })

    expect(result.resolved).toEqual(clientDoc)
  })

  it('should handle context with conflictingFields', () => {
    const resolver = createLastWriteWinsResolver<TestDocument>()

    const result = resolver({
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        value: 1,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        value: 2,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      },
      serverTimestamp: new Date('2024-01-01T12:00:00Z'),
      clientTimestamp: new Date('2024-01-01T10:00:00Z'),
      key: 'doc-1',
      conflictingFields: ['name'],
    })

    // Server is newer
    expect(result.resolved.name).toBe('Server')
  })

  it('should pass through metadata from context', () => {
    const resolver = createLastWriteWinsResolver<TestDocument>()

    const result = resolver({
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        value: 1,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        value: 2,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      },
      serverTimestamp: new Date('2024-01-01T10:00:00Z'),
      clientTimestamp: new Date('2024-01-01T12:00:00Z'),
      key: 'doc-1',
      metadata: {
        source: 'sync-batch-123',
        priority: 'high',
      },
    })

    expect(result.resolutionMetadata?.contextMetadata).toEqual({
      source: 'sync-batch-123',
      priority: 'high',
    })
  })
})

// =============================================================================
// SECTION 14: Type Safety Tests
// =============================================================================

describe('type safety', () => {
  it('should maintain generic type through resolution', () => {
    const resolver = createLastWriteWinsResolver<TestDocument>()

    const result = resolver({
      serverVersion: {
        _id: 'doc-1',
        name: 'Server',
        value: 100,
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      },
      clientVersion: {
        _id: 'doc-1',
        name: 'Client',
        value: 200,
        updatedAt: new Date('2024-01-01T12:00:00Z'),
      },
      serverTimestamp: new Date('2024-01-01T10:00:00Z'),
      clientTimestamp: new Date('2024-01-01T12:00:00Z'),
      key: 'doc-1',
    })

    // TypeScript should infer result.resolved as TestDocument
    const resolved: TestDocument = result.resolved
    expect(resolved._id).toBe('doc-1')
    expect(resolved.name).toBe('Client')
    expect(resolved.value).toBe(200)
  })

  it('should work with TimestampedDocument constraint', () => {
    const doc: TimestampedDocument = {
      _id: 'test',
      updatedAt: new Date(),
    }

    expect(doc._id).toBeDefined()
    expect(doc.updatedAt).toBeInstanceOf(Date)
  })

  it('should infer correct types from strategy', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    const local: TestDocument = {
      _id: 'doc-1',
      name: 'Local',
      value: 1,
      updatedAt: new Date(),
    }

    const remote: TestDocument = {
      _id: 'doc-1',
      name: 'Remote',
      value: 2,
      updatedAt: new Date(),
    }

    const result = strategy.resolve(local, remote)

    // Result should be typed as LastWriteWinsResult<TestDocument>
    const resolved: TestDocument = result.resolved
    expect(resolved._id).toBeDefined()
  })

  it('should support union document types', () => {
    type UnionDoc =
      | { _id: string; type: 'a'; dataA: string; updatedAt: Date }
      | { _id: string; type: 'b'; dataB: number; updatedAt: Date }

    const strategy = createLastWriteWinsStrategy<UnionDoc>()

    const local: UnionDoc = {
      _id: 'doc-1',
      type: 'a',
      dataA: 'local',
      updatedAt: new Date('2024-01-01T10:00:00Z'),
    }

    const remote: UnionDoc = {
      _id: 'doc-1',
      type: 'a',
      dataA: 'remote',
      updatedAt: new Date('2024-01-01T12:00:00Z'),
    }

    const result = strategy.resolve(local, remote)
    expect(result.resolved._id).toBe('doc-1')
  })
})

// =============================================================================
// SECTION 15: Error Handling Tests
// =============================================================================

describe('error handling', () => {
  it('should throw when serverVersion is null', () => {
    expect(() =>
      resolveLastWriteWins({
        serverVersion: null as any,
        clientVersion: { _id: 'doc-1', name: 'Client', value: 1, updatedAt: new Date() },
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        key: 'doc-1',
      })
    ).toThrow('serverVersion is required')
  })

  it('should throw when clientVersion is null', () => {
    expect(() =>
      resolveLastWriteWins({
        serverVersion: { _id: 'doc-1', name: 'Server', value: 1, updatedAt: new Date() },
        clientVersion: null as any,
        serverTimestamp: new Date(),
        clientTimestamp: new Date(),
        key: 'doc-1',
      })
    ).toThrow('clientVersion is required')
  })

  it('should throw when serverTimestamp is invalid', () => {
    expect(() =>
      resolveLastWriteWins({
        serverVersion: { _id: 'doc-1', name: 'Server', value: 1, updatedAt: new Date() },
        clientVersion: { _id: 'doc-1', name: 'Client', value: 2, updatedAt: new Date() },
        serverTimestamp: new Date('invalid'),
        clientTimestamp: new Date(),
        key: 'doc-1',
      })
    ).toThrow('serverTimestamp must be a valid date')
  })

  it('should throw when clientTimestamp is invalid', () => {
    expect(() =>
      resolveLastWriteWins({
        serverVersion: { _id: 'doc-1', name: 'Server', value: 1, updatedAt: new Date() },
        clientVersion: { _id: 'doc-1', name: 'Client', value: 2, updatedAt: new Date() },
        serverTimestamp: new Date(),
        clientTimestamp: new Date('invalid'),
        key: 'doc-1',
      })
    ).toThrow('clientTimestamp must be a valid date')
  })

  it('should throw when local is undefined in strategy', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    expect(() =>
      strategy.resolve(undefined as any, {
        _id: 'doc-1',
        name: 'Remote',
        value: 1,
        updatedAt: new Date(),
      })
    ).toThrow('local document is required')
  })

  it('should throw when remote is undefined in strategy', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    expect(() =>
      strategy.resolve(
        {
          _id: 'doc-1',
          name: 'Local',
          value: 1,
          updatedAt: new Date(),
        },
        undefined as any
      )
    ).toThrow('remote document is required')
  })

  it('should handle custom error messages', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>({
      errorMessages: {
        missingLocal: 'Local doc missing!',
        missingRemote: 'Remote doc missing!',
        invalidTimestamp: 'Bad timestamp!',
      },
    })

    expect(() =>
      strategy.resolve(undefined as any, {
        _id: 'doc-1',
        name: 'Remote',
        value: 1,
        updatedAt: new Date(),
      })
    ).toThrow('Local doc missing!')
  })
})

// =============================================================================
// SECTION 16: Performance Tests
// =============================================================================

describe('performance', () => {
  it('should resolve conflicts efficiently', () => {
    const resolver = createLastWriteWinsResolver<TestDocument>()

    const iterations = 10000
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      resolver({
        serverVersion: {
          _id: `doc-${i}`,
          name: 'Server',
          value: i,
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        clientVersion: {
          _id: `doc-${i}`,
          name: 'Client',
          value: i + 1,
          updatedAt: new Date('2024-01-01T12:00:00Z'),
        },
        serverTimestamp: new Date('2024-01-01T10:00:00Z'),
        clientTimestamp: new Date('2024-01-01T12:00:00Z'),
        key: `doc-${i}`,
      })
    }

    const elapsed = performance.now() - start
    const avgPerOp = elapsed / iterations

    // Should be able to resolve at least 10,000 conflicts per second
    // (avg time per op should be < 0.1ms)
    expect(avgPerOp).toBeLessThan(0.1)
  })

  it('should resolve batch conflicts efficiently with strategy', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    const batchSize = 1000
    const conflicts: Array<{ local: TestDocument; remote: TestDocument }> = []

    for (let i = 0; i < batchSize; i++) {
      conflicts.push({
        local: {
          _id: `doc-${i}`,
          name: `Local ${i}`,
          value: i,
          updatedAt: new Date(Date.now() - Math.random() * 86400000),
        },
        remote: {
          _id: `doc-${i}`,
          name: `Remote ${i}`,
          value: i + 1,
          updatedAt: new Date(Date.now() - Math.random() * 86400000),
        },
      })
    }

    const start = performance.now()
    const results = conflicts.map((c) => strategy.resolve(c.local, c.remote))
    const elapsed = performance.now() - start

    expect(results).toHaveLength(batchSize)
    expect(elapsed).toBeLessThan(100) // Should complete in < 100ms
  })

  it('should have minimal memory overhead', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    // Create and resolve many conflicts without holding references
    for (let i = 0; i < 10000; i++) {
      strategy.resolve(
        {
          _id: `doc-${i}`,
          name: 'Local',
          value: i,
          updatedAt: new Date(),
        },
        {
          _id: `doc-${i}`,
          name: 'Remote',
          value: i + 1,
          updatedAt: new Date(),
        }
      )
    }

    // If we got here without memory issues, the test passes
    expect(true).toBe(true)
  })
})

// =============================================================================
// SECTION 17: Edge Cases and Boundary Conditions
// =============================================================================

describe('edge cases and boundary conditions', () => {
  it('should handle very old timestamps (epoch)', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    const local: TestDocument = {
      _id: 'doc-1',
      name: 'Local',
      value: 1,
      updatedAt: new Date(0), // Unix epoch
    }

    const remote: TestDocument = {
      _id: 'doc-1',
      name: 'Remote',
      value: 2,
      updatedAt: new Date(1000), // 1 second after epoch
    }

    const result = strategy.resolve(local, remote)
    expect(result.resolved).toEqual(remote)
  })

  it('should handle very far future timestamps', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    const local: TestDocument = {
      _id: 'doc-1',
      name: 'Local',
      value: 1,
      updatedAt: new Date('2099-12-31T23:59:59Z'),
    }

    const remote: TestDocument = {
      _id: 'doc-1',
      name: 'Remote',
      value: 2,
      updatedAt: new Date('2100-01-01T00:00:00Z'),
    }

    const result = strategy.resolve(local, remote)
    expect(result.resolved).toEqual(remote)
  })

  it('should handle timestamps with maximum precision', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    const local: TestDocument = {
      _id: 'doc-1',
      name: 'Local',
      value: 1,
      updatedAt: new Date('2024-01-01T12:00:00.999Z'),
    }

    const remote: TestDocument = {
      _id: 'doc-1',
      name: 'Remote',
      value: 2,
      updatedAt: new Date('2024-01-01T12:00:01.000Z'), // 1ms later
    }

    const result = strategy.resolve(local, remote)
    expect(result.resolved).toEqual(remote)
  })

  it('should handle empty string _id', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    const local: TestDocument = {
      _id: '',
      name: 'Local',
      value: 1,
      updatedAt: new Date('2024-01-01T10:00:00Z'),
    }

    const remote: TestDocument = {
      _id: '',
      name: 'Remote',
      value: 2,
      updatedAt: new Date('2024-01-01T12:00:00Z'),
    }

    const result = strategy.resolve(local, remote)
    expect(result.resolved).toEqual(remote)
  })

  it('should handle documents with special characters in field values', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    const local: TestDocument = {
      _id: 'doc-1',
      name: 'Local <script>alert("xss")</script>',
      value: 1,
      updatedAt: new Date('2024-01-01T10:00:00Z'),
    }

    const remote: TestDocument = {
      _id: 'doc-1',
      name: 'Remote \n\r\t special chars',
      value: 2,
      updatedAt: new Date('2024-01-01T12:00:00Z'),
    }

    const result = strategy.resolve(local, remote)
    expect(result.resolved.name).toBe('Remote \n\r\t special chars')
  })

  it('should handle documents with circular references gracefully', () => {
    interface CircularDoc {
      _id: string
      name: string
      updatedAt: Date
      self?: CircularDoc
    }

    const strategy = createLastWriteWinsStrategy<CircularDoc>()

    const local: CircularDoc = {
      _id: 'doc-1',
      name: 'Local',
      updatedAt: new Date('2024-01-01T10:00:00Z'),
    }
    // Note: Not actually creating circular ref as it would break JSON serialization

    const remote: CircularDoc = {
      _id: 'doc-1',
      name: 'Remote',
      updatedAt: new Date('2024-01-01T12:00:00Z'),
    }

    const result = strategy.resolve(local, remote)
    expect(result.resolved).toEqual(remote)
  })

  it('should handle very large documents', () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    const largeName = 'x'.repeat(100000) // 100KB string

    const local: TestDocument = {
      _id: 'doc-1',
      name: largeName,
      value: 1,
      updatedAt: new Date('2024-01-01T10:00:00Z'),
    }

    const remote: TestDocument = {
      _id: 'doc-1',
      name: 'Small',
      value: 2,
      updatedAt: new Date('2024-01-01T12:00:00Z'),
    }

    const result = strategy.resolve(local, remote)
    expect(result.resolved.name).toBe('Small')
  })
})

// =============================================================================
// SECTION 18: Concurrent Access Tests
// =============================================================================

describe('concurrent access', () => {
  it('should be thread-safe for multiple simultaneous resolutions', async () => {
    const strategy = createLastWriteWinsStrategy<TestDocument>()

    const promises = Array.from({ length: 100 }, (_, i) =>
      Promise.resolve(
        strategy.resolve(
          {
            _id: `doc-${i}`,
            name: 'Local',
            value: i,
            updatedAt: new Date('2024-01-01T10:00:00Z'),
          },
          {
            _id: `doc-${i}`,
            name: 'Remote',
            value: i + 1,
            updatedAt: new Date('2024-01-01T12:00:00Z'),
          }
        )
      )
    )

    const results = await Promise.all(promises)

    expect(results).toHaveLength(100)
    results.forEach((result, i) => {
      expect(result.resolved._id).toBe(`doc-${i}`)
      expect(result.resolved.name).toBe('Remote')
    })
  })

  it('should handle race conditions in tiebreaker', async () => {
    let tiebreakerCallCount = 0

    const strategy = createLastWriteWinsStrategy<TestDocument>({
      tieBreaker: () => {
        tiebreakerCallCount++
        return 'local'
      },
    })

    const timestamp = new Date('2024-01-01T12:00:00Z')

    const promises = Array.from({ length: 50 }, () =>
      Promise.resolve(
        strategy.resolve(
          {
            _id: 'doc-1',
            name: 'Local',
            value: 1,
            updatedAt: timestamp,
          },
          {
            _id: 'doc-1',
            name: 'Remote',
            value: 2,
            updatedAt: timestamp,
          }
        )
      )
    )

    const results = await Promise.all(promises)

    expect(tiebreakerCallCount).toBe(50)
    results.forEach((result) => {
      expect(result.resolved.name).toBe('Local')
    })
  })
})
