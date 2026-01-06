/**
 * @file Auto-Provisioning Tests - TDD (RED Phase)
 *
 * This test file verifies the Auto-Provisioning functionality for MongoDB collections.
 * Auto-Provisioning automatically creates user databases and collections on first use,
 * enabling seamless onboarding without requiring manual database setup.
 *
 * Layer 12: User Provisioning
 *
 * Key behaviors tested:
 * 1. Automatic database creation on first connection
 * 2. Automatic collection creation on first use
 * 3. Provisioning status tracking
 * 4. Provisioning configuration options
 * 5. Error handling for provisioning failures
 * 6. Provisioning hooks and callbacks
 * 7. Idempotent provisioning operations
 *
 * RED PHASE: These tests define expected behavior before implementation
 * Bead ID: po0.164
 *
 * @module @tanstack/mongo-db-collection/tests/provisioning/auto-provisioning
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AutoProvisioner,
  createAutoProvisioner,
  ProvisioningConfig,
  ProvisioningStatus,
  ProvisioningResult,
  ProvisioningEvent,
  ProvisioningHooks,
  checkProvisioningStatus,
  provisionDatabase,
  provisionCollection,
  ProvisioningError,
} from '../../src/provisioning/auto-provisioning'

// =============================================================================
// Test Setup
// =============================================================================

interface MockRpcClient {
  call: ReturnType<typeof vi.fn>
  isConnected: () => boolean
}

function createMockRpcClient(): MockRpcClient {
  return {
    call: vi.fn(),
    isConnected: () => true,
  }
}

interface MockProvisioningContext {
  endpoint: string
  database: string
  collection: string
  userId?: string
  authToken?: string
}

function createMockContext(overrides?: Partial<MockProvisioningContext>): MockProvisioningContext {
  return {
    endpoint: 'https://api.mongo.do',
    database: 'test-db',
    collection: 'test-collection',
    userId: 'user-123',
    authToken: 'test-token',
    ...overrides,
  }
}

// =============================================================================
// Auto-Provisioning Core Tests
// =============================================================================

describe('Auto-Provisioning - Core Functionality', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createAutoProvisioner', () => {
    it('should create a provisioner instance with default configuration', () => {
      const provisioner = createAutoProvisioner()

      expect(provisioner).toBeDefined()
      expect(provisioner.provision).toBeInstanceOf(Function)
      expect(provisioner.checkStatus).toBeInstanceOf(Function)
      expect(provisioner.getConfig).toBeInstanceOf(Function)
    })

    it('should create provisioner with custom configuration', () => {
      const config: ProvisioningConfig = {
        autoCreateDatabase: true,
        autoCreateCollection: true,
        defaultIndexes: [{ key: { _id: 1 } }],
        retryAttempts: 3,
        retryDelayMs: 1000,
      }

      const provisioner = createAutoProvisioner(config)
      const retrievedConfig = provisioner.getConfig()

      expect(retrievedConfig.autoCreateDatabase).toBe(true)
      expect(retrievedConfig.autoCreateCollection).toBe(true)
      expect(retrievedConfig.retryAttempts).toBe(3)
    })

    it('should create provisioner with RPC client', () => {
      const provisioner = createAutoProvisioner({ rpcClient })

      expect(provisioner).toBeDefined()
    })

    it('should apply default values for missing config options', () => {
      const provisioner = createAutoProvisioner({})
      const config = provisioner.getConfig()

      expect(config.autoCreateDatabase).toBe(true) // Default enabled
      expect(config.autoCreateCollection).toBe(true) // Default enabled
      expect(config.retryAttempts).toBeGreaterThanOrEqual(1)
    })
  })

  describe('provision method', () => {
    it('should provision database and collection on first use', async () => {
      rpcClient.call.mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      const context = createMockContext()

      const result = await provisioner.provision(context)

      expect(result.success).toBe(true)
      expect(result.databaseProvisioned).toBe(true)
      expect(result.collectionProvisioned).toBe(true)
    })

    it('should return existing status when already provisioned', async () => {
      rpcClient.call.mockResolvedValueOnce({ success: true, exists: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      const context = createMockContext()

      const result = await provisioner.provision(context)

      expect(result.success).toBe(true)
      expect(result.alreadyExists).toBe(true)
    })

    it('should handle provisioning failure gracefully', async () => {
      rpcClient.call.mockRejectedValueOnce(new Error('Connection failed'))

      const provisioner = createAutoProvisioner({ rpcClient })
      const context = createMockContext()

      const result = await provisioner.provision(context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Connection failed')
    })

    it('should respect autoCreateDatabase configuration', async () => {
      const provisioner = createAutoProvisioner({
        rpcClient,
        autoCreateDatabase: false,
      })
      const context = createMockContext()

      const result = await provisioner.provision(context)

      expect(result.databaseProvisioned).toBe(false)
    })

    it('should respect autoCreateCollection configuration', async () => {
      const provisioner = createAutoProvisioner({
        rpcClient,
        autoCreateCollection: false,
      })
      const context = createMockContext()

      rpcClient.call.mockResolvedValueOnce({ success: true })

      const result = await provisioner.provision(context)

      expect(result.collectionProvisioned).toBe(false)
    })

    it('should retry provisioning on transient failures', async () => {
      rpcClient.call
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        retryAttempts: 3,
        retryDelayMs: 10, // Fast for tests
      })

      const context = createMockContext()
      const result = await provisioner.provision(context)

      expect(result.success).toBe(true)
      expect(rpcClient.call).toHaveBeenCalledTimes(3)
    })

    it('should fail after exhausting retry attempts', async () => {
      rpcClient.call.mockRejectedValue(new Error('Persistent error'))

      const provisioner = createAutoProvisioner({
        rpcClient,
        retryAttempts: 2,
        retryDelayMs: 10,
      })

      const context = createMockContext()
      const result = await provisioner.provision(context)

      expect(result.success).toBe(false)
      expect(rpcClient.call).toHaveBeenCalledTimes(2)
    })
  })

  describe('checkStatus method', () => {
    it('should return provisioned status for existing database', async () => {
      rpcClient.call.mockResolvedValueOnce({
        databaseExists: true,
        collectionExists: true,
      })

      const provisioner = createAutoProvisioner({ rpcClient })
      const context = createMockContext()

      const status = await provisioner.checkStatus(context)

      expect(status.databaseExists).toBe(true)
      expect(status.collectionExists).toBe(true)
      expect(status.isProvisioned).toBe(true)
    })

    it('should return not provisioned status for missing database', async () => {
      rpcClient.call.mockResolvedValueOnce({
        databaseExists: false,
        collectionExists: false,
      })

      const provisioner = createAutoProvisioner({ rpcClient })
      const context = createMockContext()

      const status = await provisioner.checkStatus(context)

      expect(status.databaseExists).toBe(false)
      expect(status.isProvisioned).toBe(false)
    })

    it('should cache status checks when caching is enabled', async () => {
      rpcClient.call.mockResolvedValue({
        databaseExists: true,
        collectionExists: true,
      })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableStatusCache: true,
        statusCacheTtlMs: 60000,
      })
      const context = createMockContext()

      await provisioner.checkStatus(context)
      await provisioner.checkStatus(context)

      // Should only call once due to caching
      expect(rpcClient.call).toHaveBeenCalledTimes(1)
    })

    it('should bypass cache when force refresh is requested', async () => {
      rpcClient.call.mockResolvedValue({
        databaseExists: true,
        collectionExists: true,
      })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableStatusCache: true,
      })
      const context = createMockContext()

      await provisioner.checkStatus(context)
      await provisioner.checkStatus(context, { forceRefresh: true })

      expect(rpcClient.call).toHaveBeenCalledTimes(2)
    })
  })
})

// =============================================================================
// Database Provisioning Tests
// =============================================================================

describe('Auto-Provisioning - Database Provisioning', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('provisionDatabase function', () => {
    it('should create database with specified name', async () => {
      rpcClient.call.mockResolvedValueOnce({ success: true, created: true })

      const result = await provisionDatabase(rpcClient, {
        endpoint: 'https://api.mongo.do',
        database: 'new-database',
        authToken: 'token',
      })

      expect(result.success).toBe(true)
      expect(result.databaseName).toBe('new-database')
      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'createDatabase',
          params: expect.objectContaining({ database: 'new-database' }),
        })
      )
    })

    it('should handle database already exists', async () => {
      rpcClient.call.mockResolvedValueOnce({ success: true, exists: true })

      const result = await provisionDatabase(rpcClient, {
        endpoint: 'https://api.mongo.do',
        database: 'existing-database',
        authToken: 'token',
      })

      expect(result.success).toBe(true)
      expect(result.alreadyExists).toBe(true)
    })

    it('should apply user-specific database naming when userId is provided', async () => {
      rpcClient.call.mockResolvedValueOnce({ success: true, created: true })

      const result = await provisionDatabase(rpcClient, {
        endpoint: 'https://api.mongo.do',
        database: 'app',
        userId: 'user-123',
        authToken: 'token',
        namingStrategy: 'user-prefixed',
      })

      expect(result.databaseName).toBe('user-123_app')
    })

    it('should validate database name format', async () => {
      await expect(
        provisionDatabase(rpcClient, {
          endpoint: 'https://api.mongo.do',
          database: 'invalid/name',
          authToken: 'token',
        })
      ).rejects.toThrow(ProvisioningError)
    })

    it('should handle authentication errors', async () => {
      rpcClient.call.mockRejectedValueOnce(new Error('Unauthorized'))

      await expect(
        provisionDatabase(rpcClient, {
          endpoint: 'https://api.mongo.do',
          database: 'test-db',
          authToken: 'invalid-token',
        })
      ).rejects.toThrow()
    })

    it('should support database options like sharding', async () => {
      rpcClient.call.mockResolvedValueOnce({ success: true, created: true })

      const result = await provisionDatabase(rpcClient, {
        endpoint: 'https://api.mongo.do',
        database: 'sharded-db',
        authToken: 'token',
        options: {
          enableSharding: true,
        },
      })

      expect(result.success).toBe(true)
      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            options: expect.objectContaining({ enableSharding: true }),
          }),
        })
      )
    })
  })
})

// =============================================================================
// Collection Provisioning Tests
// =============================================================================

describe('Auto-Provisioning - Collection Provisioning', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('provisionCollection function', () => {
    it('should create collection with specified name', async () => {
      rpcClient.call.mockResolvedValueOnce({ success: true, created: true })

      const result = await provisionCollection(rpcClient, {
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collection: 'new-collection',
        authToken: 'token',
      })

      expect(result.success).toBe(true)
      expect(result.collectionName).toBe('new-collection')
    })

    it('should create collection with default indexes', async () => {
      rpcClient.call.mockResolvedValueOnce({ success: true, created: true })

      const result = await provisionCollection(rpcClient, {
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collection: 'indexed-collection',
        authToken: 'token',
        indexes: [
          { key: { email: 1 }, unique: true },
          { key: { createdAt: -1 } },
        ],
      })

      expect(result.success).toBe(true)
      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            indexes: expect.arrayContaining([
              expect.objectContaining({ key: { email: 1 }, unique: true }),
            ]),
          }),
        })
      )
    })

    it('should handle collection already exists', async () => {
      rpcClient.call.mockResolvedValueOnce({ success: true, exists: true })

      const result = await provisionCollection(rpcClient, {
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collection: 'existing-collection',
        authToken: 'token',
      })

      expect(result.success).toBe(true)
      expect(result.alreadyExists).toBe(true)
    })

    it('should validate collection name format', async () => {
      await expect(
        provisionCollection(rpcClient, {
          endpoint: 'https://api.mongo.do',
          database: 'test-db',
          collection: '$invalid-name',
          authToken: 'token',
        })
      ).rejects.toThrow(ProvisioningError)
    })

    it('should support capped collections', async () => {
      rpcClient.call.mockResolvedValueOnce({ success: true, created: true })

      const result = await provisionCollection(rpcClient, {
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collection: 'capped-collection',
        authToken: 'token',
        options: {
          capped: true,
          size: 10000000, // 10MB
          max: 10000, // 10000 documents
        },
      })

      expect(result.success).toBe(true)
      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            options: expect.objectContaining({ capped: true }),
          }),
        })
      )
    })

    it('should support time series collections', async () => {
      rpcClient.call.mockResolvedValueOnce({ success: true, created: true })

      const result = await provisionCollection(rpcClient, {
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collection: 'metrics',
        authToken: 'token',
        options: {
          timeSeries: {
            timeField: 'timestamp',
            metaField: 'metadata',
            granularity: 'minutes',
          },
        },
      })

      expect(result.success).toBe(true)
    })

    it('should support validation rules', async () => {
      rpcClient.call.mockResolvedValueOnce({ success: true, created: true })

      const result = await provisionCollection(rpcClient, {
        endpoint: 'https://api.mongo.do',
        database: 'test-db',
        collection: 'validated-collection',
        authToken: 'token',
        options: {
          validator: {
            $jsonSchema: {
              bsonType: 'object',
              required: ['name', 'email'],
              properties: {
                name: { bsonType: 'string' },
                email: { bsonType: 'string' },
              },
            },
          },
          validationLevel: 'strict',
          validationAction: 'error',
        },
      })

      expect(result.success).toBe(true)
    })
  })
})

// =============================================================================
// Provisioning Status Tests
// =============================================================================

describe('Auto-Provisioning - Status Tracking', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('checkProvisioningStatus function', () => {
    it('should check if database and collection exist', async () => {
      rpcClient.call.mockResolvedValueOnce({
        databaseExists: true,
        collectionExists: true,
      })

      const status = await checkProvisioningStatus(rpcClient, createMockContext())

      expect(status.databaseExists).toBe(true)
      expect(status.collectionExists).toBe(true)
      expect(status.isProvisioned).toBe(true)
    })

    it('should return partial status when only database exists', async () => {
      rpcClient.call.mockResolvedValueOnce({
        databaseExists: true,
        collectionExists: false,
      })

      const status = await checkProvisioningStatus(rpcClient, createMockContext())

      expect(status.databaseExists).toBe(true)
      expect(status.collectionExists).toBe(false)
      expect(status.isProvisioned).toBe(false)
    })

    it('should include index information in status', async () => {
      rpcClient.call.mockResolvedValueOnce({
        databaseExists: true,
        collectionExists: true,
        indexes: [{ key: { _id: 1 } }, { key: { email: 1 }, unique: true }],
      })

      const status = await checkProvisioningStatus(rpcClient, createMockContext())

      expect(status.indexes).toHaveLength(2)
      expect(status.indexes).toContainEqual(expect.objectContaining({ key: { email: 1 } }))
    })

    it('should include storage statistics in status', async () => {
      rpcClient.call.mockResolvedValueOnce({
        databaseExists: true,
        collectionExists: true,
        stats: {
          documentCount: 1000,
          storageSize: 1024000,
          avgDocumentSize: 1024,
        },
      })

      const status = await checkProvisioningStatus(rpcClient, createMockContext())

      expect(status.stats?.documentCount).toBe(1000)
      expect(status.stats?.storageSize).toBe(1024000)
    })

    it('should handle check errors gracefully', async () => {
      rpcClient.call.mockRejectedValueOnce(new Error('Network error'))

      const status = await checkProvisioningStatus(rpcClient, createMockContext())

      expect(status.isProvisioned).toBe(false)
      expect(status.error).toBeDefined()
    })
  })

  describe('ProvisioningStatus type', () => {
    it('should represent fully provisioned state', () => {
      const status: ProvisioningStatus = {
        databaseExists: true,
        collectionExists: true,
        isProvisioned: true,
        checkedAt: new Date(),
      }

      expect(status.isProvisioned).toBe(true)
    })

    it('should represent pending provisioning state', () => {
      const status: ProvisioningStatus = {
        databaseExists: false,
        collectionExists: false,
        isProvisioned: false,
        checkedAt: new Date(),
        needsProvisioning: true,
      }

      expect(status.needsProvisioning).toBe(true)
    })

    it('should represent error state', () => {
      const status: ProvisioningStatus = {
        databaseExists: false,
        collectionExists: false,
        isProvisioned: false,
        checkedAt: new Date(),
        error: new Error('Check failed'),
      }

      expect(status.error).toBeDefined()
    })
  })
})

// =============================================================================
// Provisioning Hooks Tests
// =============================================================================

describe('Auto-Provisioning - Hooks and Callbacks', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('Provisioning hooks', () => {
    it('should call beforeProvision hook before provisioning', async () => {
      const beforeProvision = vi.fn().mockResolvedValue(undefined)
      rpcClient.call.mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        hooks: { beforeProvision },
      })

      await provisioner.provision(createMockContext())

      // Verify beforeProvision was called
      expect(beforeProvision).toHaveBeenCalled()
      // Verify rpcClient.call was also called (which happens after beforeProvision)
      expect(rpcClient.call).toHaveBeenCalled()
    })

    it('should call afterProvision hook after successful provisioning', async () => {
      const afterProvision = vi.fn()
      rpcClient.call.mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        hooks: { afterProvision },
      })

      await provisioner.provision(createMockContext())

      expect(afterProvision).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      )
    })

    it('should call onError hook on provisioning failure', async () => {
      const onError = vi.fn()
      rpcClient.call.mockRejectedValueOnce(new Error('Provisioning failed'))

      const provisioner = createAutoProvisioner({
        rpcClient,
        hooks: { onError },
        retryAttempts: 1,
      })

      await provisioner.provision(createMockContext())

      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })

    it('should allow beforeProvision to modify context', async () => {
      const beforeProvision = vi.fn().mockImplementation((ctx) => ({
        ...ctx,
        database: 'modified-database',
      }))
      rpcClient.call.mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        hooks: { beforeProvision },
      })

      await provisioner.provision(createMockContext())

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ database: 'modified-database' }),
        })
      )
    })

    it('should allow beforeProvision to cancel provisioning', async () => {
      const beforeProvision = vi.fn().mockRejectedValue(new Error('Cancelled'))

      const provisioner = createAutoProvisioner({
        rpcClient,
        hooks: { beforeProvision },
      })

      const result = await provisioner.provision(createMockContext())

      expect(result.success).toBe(false)
      expect(rpcClient.call).not.toHaveBeenCalled()
    })

    it('should call onProgress hook during multi-step provisioning', async () => {
      const onProgress = vi.fn()
      // RPC responds with a step indicator that triggers onProgress
      rpcClient.call.mockResolvedValueOnce({ success: true, step: 'database' })

      const provisioner = createAutoProvisioner({
        rpcClient,
        hooks: { onProgress },
      })

      await provisioner.provision(createMockContext())

      // onProgress should be called with the step from the RPC response
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'database' })
      )
    })
  })

  describe('Event emission', () => {
    it('should emit provisioning-started event', async () => {
      const listener = vi.fn()
      rpcClient.call.mockResolvedValueOnce({ success: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      provisioner.on('provisioning-started', listener)

      await provisioner.provision(createMockContext())

      expect(listener).toHaveBeenCalled()
    })

    it('should emit provisioning-completed event on success', async () => {
      const listener = vi.fn()
      rpcClient.call.mockResolvedValueOnce({ success: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      provisioner.on('provisioning-completed', listener)

      await provisioner.provision(createMockContext())

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      )
    })

    it('should emit provisioning-failed event on failure', async () => {
      const listener = vi.fn()
      rpcClient.call.mockRejectedValueOnce(new Error('Failed'))

      const provisioner = createAutoProvisioner({ rpcClient, retryAttempts: 1 })
      provisioner.on('provisioning-failed', listener)

      await provisioner.provision(createMockContext())

      expect(listener).toHaveBeenCalledWith(expect.any(Error))
    })

    it('should emit database-created event when new database is created', async () => {
      const listener = vi.fn()
      rpcClient.call.mockResolvedValueOnce({ success: true, databaseCreated: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      provisioner.on('database-created', listener)

      await provisioner.provision(createMockContext())

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ database: 'test-db' })
      )
    })

    it('should emit collection-created event when new collection is created', async () => {
      const listener = vi.fn()
      rpcClient.call.mockResolvedValueOnce({ success: true, collectionCreated: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      provisioner.on('collection-created', listener)

      await provisioner.provision(createMockContext())

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ collection: 'test-collection' })
      )
    })

    it('should allow unsubscribing from events', async () => {
      const listener = vi.fn()
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      const unsubscribe = provisioner.on('provisioning-completed', listener)

      await provisioner.provision(createMockContext())
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()

      await provisioner.provision(createMockContext())
      expect(listener).toHaveBeenCalledTimes(1) // Still 1
    })
  })
})

// =============================================================================
// Idempotency Tests
// =============================================================================

describe('Auto-Provisioning - Idempotency', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('Idempotent operations', () => {
    it('should be safe to call provision multiple times', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ success: true, created: true })
        .mockResolvedValueOnce({ success: true, exists: true })
        .mockResolvedValueOnce({ success: true, exists: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      const context = createMockContext()

      const result1 = await provisioner.provision(context)
      const result2 = await provisioner.provision(context)
      const result3 = await provisioner.provision(context)

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      expect(result3.success).toBe(true)
    })

    it('should not recreate existing indexes', async () => {
      rpcClient.call.mockResolvedValue({
        success: true,
        exists: true,
        indexesExist: true,
      })

      const provisioner = createAutoProvisioner({
        rpcClient,
        defaultIndexes: [{ key: { email: 1 }, unique: true }],
      })

      await provisioner.provision(createMockContext())
      await provisioner.provision(createMockContext())

      // Should only attempt index creation once (or skip entirely)
      const indexCalls = rpcClient.call.mock.calls.filter(
        (call) => call[0]?.method === 'createIndexes'
      )
      expect(indexCalls.length).toBeLessThanOrEqual(1)
    })

    it('should handle concurrent provisioning requests', async () => {
      let callCount = 0
      rpcClient.call.mockImplementation(async () => {
        callCount++
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { success: true, created: callCount === 1 }
      })

      const provisioner = createAutoProvisioner({ rpcClient })
      const context = createMockContext()

      // Start multiple provisions concurrently
      const results = await Promise.all([
        provisioner.provision(context),
        provisioner.provision(context),
        provisioner.provision(context),
      ])

      // All should succeed
      results.forEach((result) => expect(result.success).toBe(true))
    })

    it('should deduplicate concurrent requests for same context', async () => {
      let callCount = 0
      rpcClient.call.mockImplementation(async () => {
        callCount++
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { success: true }
      })

      const provisioner = createAutoProvisioner({
        rpcClient,
        deduplicateConcurrent: true,
      })
      const context = createMockContext()

      await Promise.all([
        provisioner.provision(context),
        provisioner.provision(context),
        provisioner.provision(context),
      ])

      // Should deduplicate to single call
      expect(callCount).toBe(1)
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Auto-Provisioning - Error Handling', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('ProvisioningError class', () => {
    it('should create error with code and message', () => {
      const error = new ProvisioningError('Database creation failed', 'DB_CREATE_FAILED')

      expect(error.message).toBe('Database creation failed')
      expect(error.code).toBe('DB_CREATE_FAILED')
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(ProvisioningError)
    })

    it('should include context in error', () => {
      const error = new ProvisioningError('Failed', 'FAILED', {
        database: 'test-db',
        collection: 'test-collection',
      })

      expect(error.context).toEqual({
        database: 'test-db',
        collection: 'test-collection',
      })
    })

    it('should include cause when wrapping another error', () => {
      const cause = new Error('Network error')
      const error = new ProvisioningError('Provisioning failed', 'PROVISION_FAILED', undefined, cause)

      expect(error.cause).toBe(cause)
    })
  })

  describe('Error scenarios', () => {
    it('should handle permission denied errors', async () => {
      rpcClient.call.mockRejectedValueOnce(new Error('Permission denied'))

      const provisioner = createAutoProvisioner({ rpcClient, retryAttempts: 1 })
      const result = await provisioner.provision(createMockContext())

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Permission denied')
    })

    it('should handle quota exceeded errors', async () => {
      rpcClient.call.mockRejectedValueOnce(new Error('Quota exceeded'))

      const provisioner = createAutoProvisioner({ rpcClient, retryAttempts: 1 })
      const result = await provisioner.provision(createMockContext())

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Quota exceeded')
    })

    it('should handle invalid configuration errors', async () => {
      const provisioner = createAutoProvisioner({ rpcClient })

      const result = await provisioner.provision({
        endpoint: '',
        database: '',
        collection: '',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle timeout errors', async () => {
      rpcClient.call.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
      )

      const provisioner = createAutoProvisioner({
        rpcClient,
        timeoutMs: 50,
        retryAttempts: 1,
      })

      const result = await provisioner.provision(createMockContext())

      expect(result.success).toBe(false)
    })

    it('should differentiate retryable vs non-retryable errors', async () => {
      const retryableError = new Error('Connection reset')
      const nonRetryableError = new Error('Permission denied')

      rpcClient.call
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce({ success: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        retryAttempts: 2,
        isRetryable: (err) => err.message.includes('Connection'),
      })

      const result = await provisioner.provision(createMockContext())
      expect(result.success).toBe(true)

      // Non-retryable should fail immediately
      rpcClient.call.mockRejectedValueOnce(nonRetryableError)
      const result2 = await provisioner.provision(createMockContext())
      expect(result2.success).toBe(false)
    })
  })
})

// =============================================================================
// Configuration Validation Tests
// =============================================================================

describe('Auto-Provisioning - Configuration Validation', () => {
  describe('ProvisioningConfig validation', () => {
    it('should accept valid configuration', () => {
      const config: ProvisioningConfig = {
        autoCreateDatabase: true,
        autoCreateCollection: true,
        retryAttempts: 3,
        retryDelayMs: 1000,
        timeoutMs: 30000,
      }

      expect(() => createAutoProvisioner(config)).not.toThrow()
    })

    it('should reject negative retry attempts', () => {
      const config: ProvisioningConfig = {
        retryAttempts: -1,
      }

      expect(() => createAutoProvisioner(config)).toThrow()
    })

    it('should reject negative timeout', () => {
      const config: ProvisioningConfig = {
        timeoutMs: -1,
      }

      expect(() => createAutoProvisioner(config)).toThrow()
    })

    it('should accept zero retry attempts (no retries)', () => {
      const config: ProvisioningConfig = {
        retryAttempts: 0,
      }

      expect(() => createAutoProvisioner(config)).not.toThrow()
    })

    it('should use defaults for unspecified options', () => {
      const provisioner = createAutoProvisioner()
      const config = provisioner.getConfig()

      expect(config.autoCreateDatabase).toBeDefined()
      expect(config.autoCreateCollection).toBeDefined()
      expect(config.retryAttempts).toBeDefined()
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Auto-Provisioning - Integration', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('Full provisioning workflow', () => {
    it('should complete full provisioning workflow', async () => {
      const events: string[] = []

      rpcClient.call
        .mockResolvedValueOnce({ databaseExists: false, collectionExists: false })
        .mockResolvedValueOnce({ success: true, created: true })
        .mockResolvedValueOnce({ success: true, created: true })
        .mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        defaultIndexes: [{ key: { createdAt: -1 } }],
        hooks: {
          beforeProvision: () => events.push('beforeProvision'),
          afterProvision: () => events.push('afterProvision'),
        },
      })

      provisioner.on('provisioning-started', () => events.push('started'))
      provisioner.on('provisioning-completed', () => events.push('completed'))
      provisioner.on('database-created', () => events.push('db-created'))
      provisioner.on('collection-created', () => events.push('coll-created'))

      const result = await provisioner.provision(createMockContext())

      expect(result.success).toBe(true)
      expect(events).toContain('beforeProvision')
      expect(events).toContain('afterProvision')
      expect(events).toContain('started')
      expect(events).toContain('completed')
    })

    it('should support provisioning with custom naming conventions', async () => {
      rpcClient.call.mockResolvedValue({ success: true, created: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        namingStrategy: {
          database: (ctx) => `${ctx.userId}_${ctx.database}`,
          collection: (ctx) => `${ctx.collection}_v1`,
        },
      })

      const result = await provisioner.provision(createMockContext())

      expect(result.success).toBe(true)
      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            database: 'user-123_test-db',
          }),
        })
      )
    })

    it('should support dry-run mode for validation', async () => {
      const provisioner = createAutoProvisioner({
        rpcClient,
        dryRun: true,
      })

      const result = await provisioner.provision(createMockContext())

      expect(result.dryRun).toBe(true)
      expect(rpcClient.call).not.toHaveBeenCalled()
    })
  })
})

// =============================================================================
// Performance Tests
// =============================================================================

describe('Auto-Provisioning - Performance', () => {
  it('should complete provisioning check quickly', async () => {
    const rpcClient = createMockRpcClient()
    rpcClient.call.mockResolvedValue({ databaseExists: true, collectionExists: true })

    const provisioner = createAutoProvisioner({ rpcClient })

    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      await provisioner.checkStatus(createMockContext())
    }
    const duration = performance.now() - start

    // 100 status checks should complete in under 500ms (mock)
    expect(duration).toBeLessThan(500)
  })

  it('should handle many event listeners efficiently', async () => {
    const rpcClient = createMockRpcClient()
    rpcClient.call.mockResolvedValue({ success: true })

    const provisioner = createAutoProvisioner({ rpcClient })
    const listeners = Array.from({ length: 100 }, () => vi.fn())

    listeners.forEach((listener) => provisioner.on('provisioning-completed', listener))

    const start = performance.now()
    await provisioner.provision(createMockContext())
    const duration = performance.now() - start

    expect(duration).toBeLessThan(100)
    listeners.forEach((listener) => expect(listener).toHaveBeenCalled())
  })
})

// =============================================================================
// Database Auto-Creation Tests (Additional)
// =============================================================================

describe('Auto-Provisioning - Database Auto-Creation', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('ensureDatabase function', () => {
    it('should create database if it does not exist', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      const result = await provisioner.ensureDatabase('new-db')

      expect(result.created).toBe(true)
      expect(result.databaseName).toBe('new-db')
    })

    it('should skip creation if database already exists', async () => {
      rpcClient.call.mockResolvedValueOnce({ exists: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      const result = await provisioner.ensureDatabase('existing-db')

      expect(result.created).toBe(false)
      expect(result.alreadyExists).toBe(true)
    })

    it('should handle creation errors gracefully', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ exists: false })
        .mockRejectedValueOnce(new Error('Database creation failed'))

      const provisioner = createAutoProvisioner({ rpcClient, retryAttempts: 1 })
      const result = await provisioner.ensureDatabase('failed-db')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Database creation failed')
    })

    it('should apply database options during creation', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      await provisioner.ensureDatabase('sharded-db', {
        enableSharding: true,
        replicationFactor: 3,
      })

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'createDatabase',
          params: expect.objectContaining({
            options: expect.objectContaining({
              enableSharding: true,
              replicationFactor: 3,
            }),
          }),
        })
      )
    })

    it('should validate database name before creation', async () => {
      const provisioner = createAutoProvisioner({ rpcClient })

      await expect(
        provisioner.ensureDatabase('')
      ).rejects.toThrow('Database name cannot be empty')
    })

    it('should reject reserved database names', async () => {
      const provisioner = createAutoProvisioner({ rpcClient })

      await expect(
        provisioner.ensureDatabase('admin')
      ).rejects.toThrow('Cannot provision reserved database')
    })

    it('should sanitize database names with special characters', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        sanitizeNames: true,
      })

      const result = await provisioner.ensureDatabase('my-db.name')

      expect(result.databaseName).toBe('my_db_name')
    })
  })
})

// =============================================================================
// Collection Auto-Creation Tests (Additional)
// =============================================================================

describe('Auto-Provisioning - Collection Auto-Creation', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('ensureCollection function', () => {
    it('should create collection if it does not exist', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      const result = await provisioner.ensureCollection('test-db', 'new-collection')

      expect(result.created).toBe(true)
      expect(result.collectionName).toBe('new-collection')
    })

    it('should skip creation if collection already exists', async () => {
      rpcClient.call.mockResolvedValueOnce({ exists: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      const result = await provisioner.ensureCollection('test-db', 'existing-collection')

      expect(result.created).toBe(false)
      expect(result.alreadyExists).toBe(true)
    })

    it('should apply indexes on collection creation', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ success: true, created: true })
        .mockResolvedValueOnce({ success: true, indexesCreated: 2 })

      const provisioner = createAutoProvisioner({ rpcClient })
      const result = await provisioner.ensureCollection('test-db', 'indexed-collection', {
        indexes: [
          { key: { email: 1 }, unique: true },
          { key: { createdAt: -1 } },
        ],
      })

      expect(result.success).toBe(true)
      expect(result.indexesCreated).toBe(2)
    })

    it('should set up schema validation on creation', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      await provisioner.ensureCollection('test-db', 'validated-collection', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['name', 'email'],
            properties: {
              name: { bsonType: 'string' },
              email: { bsonType: 'string' },
            },
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      })

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'createCollection',
          params: expect.objectContaining({
            validator: expect.objectContaining({
              $jsonSchema: expect.any(Object),
            }),
          }),
        })
      )
    })

    it('should handle collection creation errors', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ exists: false })
        .mockRejectedValueOnce(new Error('Collection creation failed'))

      const provisioner = createAutoProvisioner({ rpcClient, retryAttempts: 1 })
      const result = await provisioner.ensureCollection('test-db', 'failed-collection')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should create collection with capped options', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      await provisioner.ensureCollection('test-db', 'logs', {
        capped: true,
        size: 10485760, // 10MB
        max: 10000,
      })

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            capped: true,
            size: 10485760,
            max: 10000,
          }),
        })
      )
    })

    it('should create time series collection', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ success: true, created: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      await provisioner.ensureCollection('test-db', 'metrics', {
        timeSeries: {
          timeField: 'timestamp',
          metaField: 'metadata',
          granularity: 'seconds',
        },
        expireAfterSeconds: 86400 * 7, // 7 days
      })

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            timeSeries: expect.objectContaining({
              timeField: 'timestamp',
            }),
          }),
        })
      )
    })
  })
})

// =============================================================================
// Index Management Tests
// =============================================================================

describe('Auto-Provisioning - Index Management', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('ensureIndexes function', () => {
    it('should create indexes from schema definition', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      const result = await provisioner.ensureIndexes('test-db', 'users', [
        { key: { email: 1 }, unique: true },
        { key: { username: 1 }, unique: true },
        { key: { createdAt: -1 } },
      ])

      expect(result.success).toBe(true)
      expect(result.indexesCreated).toBe(3)
    })

    it('should detect and update indexes on schema change', async () => {
      rpcClient.call
        .mockResolvedValueOnce({
          indexes: [
            { name: '_id_', key: { _id: 1 } },
            { name: 'email_1', key: { email: 1 }, unique: true },
          ],
        })
        .mockResolvedValueOnce({ success: true }) // create new index
        .mockResolvedValueOnce({ success: true }) // drop old index

      const provisioner = createAutoProvisioner({
        rpcClient,
        updateIndexes: true,
      })

      const result = await provisioner.ensureIndexes('test-db', 'users', [
        { key: { username: 1 }, unique: true }, // new index
        // email_1 is no longer needed
      ])

      expect(result.indexesCreated).toBe(1)
      expect(result.indexesDropped).toBe(1)
    })

    it('should optionally drop unused indexes', async () => {
      rpcClient.call
        .mockResolvedValueOnce({
          indexes: [
            { name: '_id_', key: { _id: 1 } },
            { name: 'old_index', key: { oldField: 1 } },
          ],
        })
        .mockResolvedValueOnce({ success: true }) // drop old_index

      const provisioner = createAutoProvisioner({
        rpcClient,
        dropUnusedIndexes: true,
      })

      const result = await provisioner.ensureIndexes('test-db', 'users', [])

      expect(result.indexesDropped).toBe(1)
    })

    it('should preserve system indexes (_id)', async () => {
      rpcClient.call.mockResolvedValueOnce({
        indexes: [{ name: '_id_', key: { _id: 1 } }],
      })

      const provisioner = createAutoProvisioner({
        rpcClient,
        dropUnusedIndexes: true,
      })

      await provisioner.ensureIndexes('test-db', 'users', [])

      // Should not attempt to drop _id index
      expect(rpcClient.call).not.toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'dropIndex',
          params: expect.objectContaining({ indexName: '_id_' }),
        })
      )
    })

    it('should create compound indexes', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      await provisioner.ensureIndexes('test-db', 'orders', [
        { key: { userId: 1, createdAt: -1 } },
        { key: { status: 1, productId: 1 } },
      ])

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            keys: { userId: 1, createdAt: -1 },
          }),
        })
      )
    })

    it('should create text indexes', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      await provisioner.ensureIndexes('test-db', 'articles', [
        { key: { title: 'text', content: 'text' }, weights: { title: 10, content: 1 } },
      ])

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            keys: { title: 'text', content: 'text' },
          }),
        })
      )
    })

    it('should create TTL indexes', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      await provisioner.ensureIndexes('test-db', 'sessions', [
        { key: { expiresAt: 1 }, expireAfterSeconds: 3600 },
      ])

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            options: expect.objectContaining({
              expireAfterSeconds: 3600,
            }),
          }),
        })
      )
    })

    it('should create partial indexes with filter expression', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      await provisioner.ensureIndexes('test-db', 'users', [
        {
          key: { email: 1 },
          unique: true,
          partialFilterExpression: { status: 'active' },
        },
      ])

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            options: expect.objectContaining({
              partialFilterExpression: { status: 'active' },
            }),
          }),
        })
      )
    })

    it('should handle index creation errors', async () => {
      rpcClient.call.mockRejectedValueOnce(new Error('Index creation failed'))

      const provisioner = createAutoProvisioner({ rpcClient })
      const result = await provisioner.ensureIndexes('test-db', 'users', [
        { key: { email: 1 } },
      ])

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should skip existing indexes with same definition', async () => {
      rpcClient.call.mockResolvedValueOnce({
        indexes: [
          { name: '_id_', key: { _id: 1 } },
          { name: 'email_1', key: { email: 1 }, unique: true },
        ],
      })

      const provisioner = createAutoProvisioner({ rpcClient })
      const result = await provisioner.ensureIndexes('test-db', 'users', [
        { key: { email: 1 }, unique: true },
      ])

      expect(result.indexesSkipped).toBe(1)
      expect(result.indexesCreated).toBe(0)
    })
  })
})

// =============================================================================
// Schema Validation Tests (Auto-Provisioning)
// =============================================================================

describe('Auto-Provisioning - Schema Validation', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('applySchemaValidation function', () => {
    it('should apply JSON schema validation to collection', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      const result = await provisioner.applySchemaValidation('test-db', 'users', {
        $jsonSchema: {
          bsonType: 'object',
          required: ['name', 'email'],
          properties: {
            name: { bsonType: 'string', description: 'User name' },
            email: { bsonType: 'string', pattern: '^.+@.+$' },
            age: { bsonType: 'int', minimum: 0 },
          },
        },
      })

      expect(result.success).toBe(true)
    })

    it('should update validation rules on existing collection', async () => {
      rpcClient.call.mockResolvedValue({ success: true, modified: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      const result = await provisioner.applySchemaValidation('test-db', 'users', {
        $jsonSchema: {
          bsonType: 'object',
          required: ['name', 'email', 'phone'], // added phone
        },
      })

      expect(result.success).toBe(true)
      expect(result.modified).toBe(true)
    })

    it('should handle validation errors gracefully', async () => {
      rpcClient.call.mockRejectedValueOnce(new Error('Invalid JSON schema'))

      const provisioner = createAutoProvisioner({ rpcClient })
      const result = await provisioner.applySchemaValidation('test-db', 'users', {
        $jsonSchema: { invalid: 'schema' } as any,
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Invalid JSON schema')
    })

    it('should support different validation levels', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      await provisioner.applySchemaValidation(
        'test-db',
        'users',
        { $jsonSchema: { bsonType: 'object' } },
        { validationLevel: 'moderate' }
      )

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            validationLevel: 'moderate',
          }),
        })
      )
    })

    it('should support different validation actions', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      await provisioner.applySchemaValidation(
        'test-db',
        'users',
        { $jsonSchema: { bsonType: 'object' } },
        { validationAction: 'warn' }
      )

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            validationAction: 'warn',
          }),
        })
      )
    })

    it('should remove schema validation when null is passed', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({ rpcClient })
      await provisioner.applySchemaValidation('test-db', 'users', null)

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'collMod',
          params: expect.objectContaining({
            validator: {},
          }),
        })
      )
    })

    it('should bypass validation for specific operations', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        bypassValidation: true,
      })

      await provisioner.applySchemaValidation('test-db', 'users', {
        $jsonSchema: { bsonType: 'object' },
      })

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            bypassDocumentValidation: true,
          }),
        })
      )
    })
  })
})

// =============================================================================
// Multi-Tenant Provisioning Tests
// =============================================================================

describe('Auto-Provisioning - Multi-Tenant Provisioning', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('Per-tenant database provisioning', () => {
    it('should create per-tenant databases', async () => {
      rpcClient.call.mockResolvedValue({ success: true, created: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        multiTenant: true,
        tenantNaming: 'database', // Each tenant gets its own database
      })

      const result = await provisioner.provisionTenant('tenant-123')

      expect(result.success).toBe(true)
      expect(result.databaseName).toBe('tenant_123')
    })

    it('should isolate tenant data with proper naming', async () => {
      rpcClient.call.mockResolvedValue({ success: true, created: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        multiTenant: true,
        tenantPrefix: 'client_',
      })

      const result = await provisioner.provisionTenant('acme-corp')

      expect(result.databaseName).toBe('client_acme_corp')
    })

    it('should create standard collections for new tenant', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ success: true, created: true }) // create db
        .mockResolvedValueOnce({ success: true, created: true }) // create users collection
        .mockResolvedValueOnce({ success: true, created: true }) // create settings collection

      const provisioner = createAutoProvisioner({
        rpcClient,
        multiTenant: true,
        tenantCollections: ['users', 'settings', 'data'],
      })

      const result = await provisioner.provisionTenant('tenant-456')

      expect(result.collectionsCreated).toContain('users')
      expect(result.collectionsCreated).toContain('settings')
    })

    it('should clean up on tenant removal', async () => {
      rpcClient.call.mockResolvedValue({ success: true, dropped: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        multiTenant: true,
      })

      const result = await provisioner.deprovisionTenant('tenant-123')

      expect(result.success).toBe(true)
      expect(result.databaseDropped).toBe(true)
    })

    it('should handle tenant removal errors', async () => {
      rpcClient.call.mockRejectedValueOnce(new Error('Database in use'))

      const provisioner = createAutoProvisioner({
        rpcClient,
        multiTenant: true,
      })

      const result = await provisioner.deprovisionTenant('tenant-123')

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Database in use')
    })

    it('should support shared database with tenant collection prefix', async () => {
      rpcClient.call.mockResolvedValue({ success: true, created: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        multiTenant: true,
        tenantNaming: 'collection-prefix', // Shared db, prefixed collections
        sharedDatabase: 'shared-app',
      })

      const result = await provisioner.provisionTenant('tenant-789', {
        collections: ['orders', 'products'],
      })

      expect(result.collectionsCreated).toContain('tenant_789_orders')
      expect(result.collectionsCreated).toContain('tenant_789_products')
    })

    it('should apply tenant-specific indexes', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        multiTenant: true,
        tenantIndexes: [
          { key: { tenantId: 1 } },
          { key: { tenantId: 1, createdAt: -1 } },
        ],
      })

      await provisioner.provisionTenant('tenant-abc')

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'createIndex',
          params: expect.objectContaining({
            keys: { tenantId: 1 },
          }),
        })
      )
    })

    it('should validate tenant ID format', async () => {
      const provisioner = createAutoProvisioner({
        rpcClient,
        multiTenant: true,
        tenantIdPattern: /^[a-z0-9-]+$/,
      })

      await expect(
        provisioner.provisionTenant('Invalid Tenant ID!')
      ).rejects.toThrow('Invalid tenant ID format')
    })

    it('should list all tenant databases', async () => {
      rpcClient.call.mockResolvedValueOnce({
        databases: [
          { name: 'tenant_123' },
          { name: 'tenant_456' },
          { name: 'tenant_789' },
          { name: 'admin' }, // should be filtered out
        ],
      })

      const provisioner = createAutoProvisioner({
        rpcClient,
        multiTenant: true,
        tenantPrefix: 'tenant_',
      })

      const tenants = await provisioner.listTenants()

      expect(tenants).toHaveLength(3)
      expect(tenants).toContain('123')
      expect(tenants).toContain('456')
      expect(tenants).toContain('789')
    })

    it('should check if tenant is provisioned', async () => {
      rpcClient.call.mockResolvedValueOnce({
        databases: [{ name: 'tenant_existing' }],
      })

      const provisioner = createAutoProvisioner({
        rpcClient,
        multiTenant: true,
        tenantPrefix: 'tenant_',
      })

      const exists = await provisioner.isTenantProvisioned('existing')
      const notExists = await provisioner.isTenantProvisioned('not-existing')

      expect(exists).toBe(true)
      expect(notExists).toBe(false)
    })
  })
})

// =============================================================================
// Migration Support Tests
// =============================================================================

describe('Auto-Provisioning - Migration Support', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  describe('Schema version tracking', () => {
    it('should track current schema version', async () => {
      rpcClient.call.mockResolvedValueOnce({
        documents: [{ _id: 'schema_version', version: 3, appliedAt: new Date() }],
      })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
      })

      const version = await provisioner.getSchemaVersion('test-db')

      expect(version).toBe(3)
    })

    it('should return version 0 for unversioned database', async () => {
      rpcClient.call.mockResolvedValueOnce({ documents: [] })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
      })

      const version = await provisioner.getSchemaVersion('new-db')

      expect(version).toBe(0)
    })

    it('should update schema version after migration', async () => {
      rpcClient.call
        .mockResolvedValueOnce({ documents: [{ version: 1 }] }) // get current version
        .mockResolvedValueOnce({ success: true }) // apply migration
        .mockResolvedValueOnce({ success: true }) // update version

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
      })

      await provisioner.applyMigration('test-db', {
        version: 2,
        up: async () => {},
        down: async () => {},
      })

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'updateOne',
          params: expect.objectContaining({
            update: expect.objectContaining({
              $set: expect.objectContaining({ version: 2 }),
            }),
          }),
        })
      )
    })
  })

  describe('Migration application', () => {
    it('should apply migrations in order', async () => {
      const migrationOrder: number[] = []
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
      })

      await provisioner.applyMigrations('test-db', [
        {
          version: 1,
          up: async () => { migrationOrder.push(1) },
          down: async () => {},
        },
        {
          version: 2,
          up: async () => { migrationOrder.push(2) },
          down: async () => {},
        },
        {
          version: 3,
          up: async () => { migrationOrder.push(3) },
          down: async () => {},
        },
      ])

      expect(migrationOrder).toEqual([1, 2, 3])
    })

    it('should skip already applied migrations', async () => {
      const migrationCalls: number[] = []
      rpcClient.call
        .mockResolvedValueOnce({ documents: [{ version: 2 }] }) // current version is 2
        .mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
      })

      await provisioner.applyMigrations('test-db', [
        {
          version: 1,
          up: async () => { migrationCalls.push(1) },
          down: async () => {},
        },
        {
          version: 2,
          up: async () => { migrationCalls.push(2) },
          down: async () => {},
        },
        {
          version: 3,
          up: async () => { migrationCalls.push(3) },
          down: async () => {},
        },
      ])

      expect(migrationCalls).toEqual([3]) // Only migration 3 should run
    })

    it('should rollback on migration failure', async () => {
      const rollbackCalled = vi.fn()
      rpcClient.call
        .mockResolvedValueOnce({ documents: [{ version: 0 }] })
        .mockResolvedValueOnce({ success: true }) // migration 1 succeeds
        .mockRejectedValueOnce(new Error('Migration 2 failed')) // migration 2 fails

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
        rollbackOnFailure: true,
      })

      const result = await provisioner.applyMigrations('test-db', [
        {
          version: 1,
          up: async () => {},
          down: rollbackCalled,
        },
        {
          version: 2,
          up: async () => { throw new Error('Migration 2 failed') },
          down: async () => {},
        },
      ])

      expect(result.success).toBe(false)
      expect(rollbackCalled).toHaveBeenCalled()
    })

    it('should support dry-run mode for migrations', async () => {
      const migrationCalled = vi.fn()
      rpcClient.call.mockResolvedValue({ documents: [{ version: 0 }] })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
      })

      const result = await provisioner.applyMigrations(
        'test-db',
        [
          {
            version: 1,
            up: migrationCalled,
            down: async () => {},
          },
        ],
        { dryRun: true }
      )

      expect(result.dryRun).toBe(true)
      expect(result.pendingMigrations).toHaveLength(1)
      expect(migrationCalled).not.toHaveBeenCalled()
    })

    it('should provide migration context to up/down functions', async () => {
      let receivedContext: any
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
      })

      await provisioner.applyMigration('test-db', {
        version: 1,
        up: async (ctx) => {
          receivedContext = ctx
        },
        down: async () => {},
      })

      expect(receivedContext).toBeDefined()
      expect(receivedContext.database).toBe('test-db')
      expect(receivedContext.rpcClient).toBeDefined()
    })

    it('should record migration history', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
      })

      await provisioner.applyMigration('test-db', {
        version: 1,
        name: 'add_user_email_index',
        up: async () => {},
        down: async () => {},
      })

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'insertOne',
          params: expect.objectContaining({
            collection: '_migrations',
            document: expect.objectContaining({
              version: 1,
              name: 'add_user_email_index',
              appliedAt: expect.any(Date),
            }),
          }),
        })
      )
    })

    it('should get migration history', async () => {
      rpcClient.call.mockResolvedValueOnce({
        documents: [
          { version: 1, name: 'initial', appliedAt: new Date('2024-01-01') },
          { version: 2, name: 'add_indexes', appliedAt: new Date('2024-02-01') },
        ],
      })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
      })

      const history = await provisioner.getMigrationHistory('test-db')

      expect(history).toHaveLength(2)
      expect(history[0].version).toBe(1)
      expect(history[1].version).toBe(2)
    })

    it('should rollback to specific version', async () => {
      const downCalls: number[] = []
      rpcClient.call
        .mockResolvedValueOnce({ documents: [{ version: 3 }] })
        .mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
      })

      await provisioner.rollbackTo('test-db', 1, {
        migrations: [
          { version: 1, up: async () => {}, down: async () => { downCalls.push(1) } },
          { version: 2, up: async () => {}, down: async () => { downCalls.push(2) } },
          { version: 3, up: async () => {}, down: async () => { downCalls.push(3) } },
        ],
      })

      expect(downCalls).toEqual([3, 2]) // Should rollback 3 and 2, not 1
    })

    it('should handle migration timeout', async () => {
      rpcClient.call.mockResolvedValueOnce({ documents: [{ version: 0 }] })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
        migrationTimeoutMs: 100,
      })

      const result = await provisioner.applyMigration('test-db', {
        version: 1,
        up: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
        },
        down: async () => {},
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('timeout')
    })

    it('should lock database during migration', async () => {
      rpcClient.call.mockResolvedValue({ success: true })

      const provisioner = createAutoProvisioner({
        rpcClient,
        enableMigrations: true,
        useMigrationLock: true,
      })

      await provisioner.applyMigration('test-db', {
        version: 1,
        up: async () => {},
        down: async () => {},
      })

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'acquireLock',
          params: expect.objectContaining({
            lockName: 'migration_test-db',
          }),
        })
      )

      expect(rpcClient.call).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'releaseLock',
          params: expect.objectContaining({
            lockName: 'migration_test-db',
          }),
        })
      )
    })
  })
})

// =============================================================================
// Provisioning State Machine Tests
// =============================================================================

describe('Auto-Provisioning - State Machine', () => {
  let rpcClient: MockRpcClient

  beforeEach(() => {
    vi.clearAllMocks()
    rpcClient = createMockRpcClient()
  })

  it('should transition through provisioning states', async () => {
    const states: string[] = []
    rpcClient.call.mockResolvedValue({ success: true, created: true })

    const provisioner = createAutoProvisioner({
      rpcClient,
      hooks: {
        onStateChange: (state) => states.push(state),
      },
    })

    await provisioner.provision(createMockContext())

    expect(states).toContain('idle')
    expect(states).toContain('checking')
    expect(states).toContain('provisioning')
    expect(states).toContain('completed')
  })

  it('should handle provisioning cancellation', async () => {
    rpcClient.call.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 1000))
    )

    const provisioner = createAutoProvisioner({ rpcClient })
    const provisionPromise = provisioner.provision(createMockContext())

    // Cancel after short delay
    setTimeout(() => provisioner.cancel(), 50)

    const result = await provisionPromise

    expect(result.cancelled).toBe(true)
  })

  it('should prevent concurrent provisioning for same context', async () => {
    let callCount = 0
    rpcClient.call.mockImplementation(async () => {
      callCount++
      await new Promise((resolve) => setTimeout(resolve, 100))
      return { success: true }
    })

    const provisioner = createAutoProvisioner({ rpcClient })
    const context = createMockContext()

    const [result1, result2] = await Promise.all([
      provisioner.provision(context),
      provisioner.provision(context), // Should wait for first
    ])

    expect(result1.success).toBe(true)
    expect(result2.success).toBe(true)
    // Should deduplicate to avoid double provisioning
    expect(callCount).toBe(1)
  })
})
