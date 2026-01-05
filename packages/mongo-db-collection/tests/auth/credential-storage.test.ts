/**
 * @file Credential Storage Tests (RED Phase - TDD)
 *
 * These tests verify the CredentialStorage class that provides secure
 * credential management for mongo.do authentication. The storage system handles:
 * - Storing and retrieving credentials
 * - Multiple storage backends (memory, localStorage, sessionStorage)
 * - Credential expiry and automatic cleanup
 * - Optional encryption support
 * - Memory-only mode for sensitive environments
 *
 * RED PHASE: These tests will fail until CredentialStorage is implemented
 * in src/auth/credential-storage.ts
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CredentialStorage } from '../../src/auth/credential-storage'

// Mock localStorage and sessionStorage
const createStorageMock = () => {
  const storage = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => storage.get(key) || null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
    clear: vi.fn(() => storage.clear()),
    get length() {
      return storage.size
    },
    key: vi.fn((index: number) => {
      const keys = Array.from(storage.keys())
      return keys[index] || null
    }),
  }
}

// Store original storage objects
const originalLocalStorage = globalThis.localStorage
const originalSessionStorage = globalThis.sessionStorage

// Mock storage instances
let mockLocalStorage: ReturnType<typeof createStorageMock>
let mockSessionStorage: ReturnType<typeof createStorageMock>

describe('CredentialStorage', () => {
  const testCredential = {
    token: 'test-auth-token-123',
    refreshToken: 'test-refresh-token-456',
    expiresAt: Date.now() + 3600000, // 1 hour from now
  }

  const testKey = 'mongo-do-credentials'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))

    // Setup mock storage
    mockLocalStorage = createStorageMock()
    mockSessionStorage = createStorageMock()
    ;(globalThis as any).localStorage = mockLocalStorage
    ;(globalThis as any).sessionStorage = mockSessionStorage
  })

  afterEach(() => {
    vi.useRealTimers()
    ;(globalThis as any).localStorage = originalLocalStorage
    ;(globalThis as any).sessionStorage = originalSessionStorage
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should construct with default memory backend', () => {
      const storage = new CredentialStorage()

      expect(storage).toBeInstanceOf(CredentialStorage)
      expect(storage.backend).toBe('memory')
    })

    it('should construct with localStorage backend', () => {
      const storage = new CredentialStorage({ backend: 'localStorage' })

      expect(storage).toBeInstanceOf(CredentialStorage)
      expect(storage.backend).toBe('localStorage')
    })

    it('should construct with sessionStorage backend', () => {
      const storage = new CredentialStorage({ backend: 'sessionStorage' })

      expect(storage).toBeInstanceOf(CredentialStorage)
      expect(storage.backend).toBe('sessionStorage')
    })

    it('should construct with memory backend explicitly', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      expect(storage).toBeInstanceOf(CredentialStorage)
      expect(storage.backend).toBe('memory')
    })

    it('should construct with encryption enabled', () => {
      const storage = new CredentialStorage({
        backend: 'memory',
        encrypt: true,
        encryptionKey: 'test-encryption-key-32-bytes-long',
      })

      expect(storage).toBeInstanceOf(CredentialStorage)
      expect(storage.isEncrypted).toBe(true)
    })

    it('should throw error when encryption is enabled without key', () => {
      expect(() => {
        new CredentialStorage({
          backend: 'memory',
          encrypt: true,
        })
      }).toThrow('Encryption key is required when encryption is enabled')
    })

    it('should construct with custom namespace', () => {
      const storage = new CredentialStorage({
        backend: 'memory',
        namespace: 'custom-app',
      })

      expect(storage).toBeInstanceOf(CredentialStorage)
      expect(storage.namespace).toBe('custom-app')
    })
  })

  describe('store()', () => {
    it('should store credential in memory backend', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      storage.store(testKey, testCredential)

      const retrieved = storage.retrieve(testKey)
      expect(retrieved).toEqual(testCredential)
    })

    it('should store credential in localStorage backend', () => {
      const storage = new CredentialStorage({ backend: 'localStorage' })

      storage.store(testKey, testCredential)

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining(testKey),
        expect.any(String)
      )
    })

    it('should store credential in sessionStorage backend', () => {
      const storage = new CredentialStorage({ backend: 'sessionStorage' })

      storage.store(testKey, testCredential)

      expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining(testKey),
        expect.any(String)
      )
    })

    it('should overwrite existing credential with same key', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      storage.store(testKey, testCredential)

      const newCredential = {
        token: 'new-token',
        refreshToken: 'new-refresh',
        expiresAt: Date.now() + 7200000,
      }

      storage.store(testKey, newCredential)

      const retrieved = storage.retrieve(testKey)
      expect(retrieved).toEqual(newCredential)
      expect(retrieved).not.toEqual(testCredential)
    })

    it('should store multiple credentials with different keys', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const credential1 = { ...testCredential, token: 'token-1' }
      const credential2 = { ...testCredential, token: 'token-2' }

      storage.store('key-1', credential1)
      storage.store('key-2', credential2)

      expect(storage.retrieve('key-1')).toEqual(credential1)
      expect(storage.retrieve('key-2')).toEqual(credential2)
    })

    it('should store encrypted credential when encryption is enabled', () => {
      const storage = new CredentialStorage({
        backend: 'memory',
        encrypt: true,
        encryptionKey: 'test-encryption-key-32-bytes-long',
      })

      storage.store(testKey, testCredential)

      // The stored data should be encrypted (not plain text)
      const rawStored = (storage as any).memoryStore?.get(testKey)
      expect(rawStored).toBeDefined()
      expect(typeof rawStored).toBe('string')
      // Should not contain plain text token
      expect(rawStored).not.toContain(testCredential.token)
    })

    it('should store credential with metadata', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const credentialWithMetadata = {
        ...testCredential,
        metadata: {
          userId: 'user-123',
          tenantId: 'tenant-456',
        },
      }

      storage.store(testKey, credentialWithMetadata)

      const retrieved = storage.retrieve(testKey)
      expect(retrieved).toEqual(credentialWithMetadata)
      expect(retrieved?.metadata).toEqual({
        userId: 'user-123',
        tenantId: 'tenant-456',
      })
    })

    it('should handle storing credential without expiry', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const credentialNoExpiry = {
        token: 'test-token',
        refreshToken: 'test-refresh',
      }

      storage.store(testKey, credentialNoExpiry)

      const retrieved = storage.retrieve(testKey)
      expect(retrieved).toEqual(credentialNoExpiry)
    })
  })

  describe('retrieve()', () => {
    it('should retrieve stored credential from memory backend', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      storage.store(testKey, testCredential)
      const retrieved = storage.retrieve(testKey)

      expect(retrieved).toEqual(testCredential)
    })

    it('should retrieve stored credential from localStorage backend', () => {
      const storage = new CredentialStorage({ backend: 'localStorage' })

      storage.store(testKey, testCredential)
      const retrieved = storage.retrieve(testKey)

      expect(mockLocalStorage.getItem).toHaveBeenCalled()
      expect(retrieved).toEqual(testCredential)
    })

    it('should retrieve stored credential from sessionStorage backend', () => {
      const storage = new CredentialStorage({ backend: 'sessionStorage' })

      storage.store(testKey, testCredential)
      const retrieved = storage.retrieve(testKey)

      expect(mockSessionStorage.getItem).toHaveBeenCalled()
      expect(retrieved).toEqual(testCredential)
    })

    it('should return null for non-existent key', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const retrieved = storage.retrieve('non-existent-key')

      expect(retrieved).toBeNull()
    })

    it('should return null for expired credential', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const expiredCredential = {
        token: 'expired-token',
        refreshToken: 'expired-refresh',
        expiresAt: Date.now() - 1000, // Expired 1 second ago
      }

      storage.store(testKey, expiredCredential)

      const retrieved = storage.retrieve(testKey)

      expect(retrieved).toBeNull()
    })

    it('should automatically remove expired credential on retrieval', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const expiredCredential = {
        token: 'expired-token',
        refreshToken: 'expired-refresh',
        expiresAt: Date.now() - 1000,
      }

      storage.store(testKey, expiredCredential)
      storage.retrieve(testKey) // Should remove expired credential

      // Try to retrieve again - should still be null
      const secondRetrieval = storage.retrieve(testKey)
      expect(secondRetrieval).toBeNull()
    })

    it('should decrypt and return credential when encryption is enabled', () => {
      const storage = new CredentialStorage({
        backend: 'memory',
        encrypt: true,
        encryptionKey: 'test-encryption-key-32-bytes-long',
      })

      storage.store(testKey, testCredential)
      const retrieved = storage.retrieve(testKey)

      expect(retrieved).toEqual(testCredential)
    })

    it('should handle corrupted storage data gracefully', () => {
      const storage = new CredentialStorage({ backend: 'localStorage' })

      // Manually set corrupted data
      mockLocalStorage.setItem(testKey, 'corrupted-json-data{{{')

      const retrieved = storage.retrieve(testKey)

      expect(retrieved).toBeNull()
    })

    it('should retrieve credential with metadata', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const credentialWithMetadata = {
        ...testCredential,
        metadata: {
          userId: 'user-123',
        },
      }

      storage.store(testKey, credentialWithMetadata)
      const retrieved = storage.retrieve(testKey)

      expect(retrieved?.metadata).toEqual({ userId: 'user-123' })
    })
  })

  describe('remove()', () => {
    it('should remove credential from memory backend', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      storage.store(testKey, testCredential)
      storage.remove(testKey)

      const retrieved = storage.retrieve(testKey)
      expect(retrieved).toBeNull()
    })

    it('should remove credential from localStorage backend', () => {
      const storage = new CredentialStorage({ backend: 'localStorage' })

      storage.store(testKey, testCredential)
      storage.remove(testKey)

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
        expect.stringContaining(testKey)
      )
    })

    it('should remove credential from sessionStorage backend', () => {
      const storage = new CredentialStorage({ backend: 'sessionStorage' })

      storage.store(testKey, testCredential)
      storage.remove(testKey)

      expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(
        expect.stringContaining(testKey)
      )
    })

    it('should handle removing non-existent key gracefully', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      expect(() => {
        storage.remove('non-existent-key')
      }).not.toThrow()
    })

    it('should only remove specified credential, not others', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const credential1 = { ...testCredential, token: 'token-1' }
      const credential2 = { ...testCredential, token: 'token-2' }

      storage.store('key-1', credential1)
      storage.store('key-2', credential2)

      storage.remove('key-1')

      expect(storage.retrieve('key-1')).toBeNull()
      expect(storage.retrieve('key-2')).toEqual(credential2)
    })

    it('should remove encrypted credential', () => {
      const storage = new CredentialStorage({
        backend: 'memory',
        encrypt: true,
        encryptionKey: 'test-encryption-key-32-bytes-long',
      })

      storage.store(testKey, testCredential)
      storage.remove(testKey)

      const retrieved = storage.retrieve(testKey)
      expect(retrieved).toBeNull()
    })
  })

  describe('clear()', () => {
    it('should clear all credentials from memory backend', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      storage.store('key-1', { ...testCredential, token: 'token-1' })
      storage.store('key-2', { ...testCredential, token: 'token-2' })
      storage.store('key-3', { ...testCredential, token: 'token-3' })

      storage.clear()

      expect(storage.retrieve('key-1')).toBeNull()
      expect(storage.retrieve('key-2')).toBeNull()
      expect(storage.retrieve('key-3')).toBeNull()
    })

    it('should clear all credentials from localStorage backend', () => {
      const storage = new CredentialStorage({ backend: 'localStorage' })

      storage.store('key-1', testCredential)
      storage.store('key-2', testCredential)

      storage.clear()

      // Should only clear items with the storage namespace, not all localStorage
      expect(mockLocalStorage.removeItem).toHaveBeenCalled()
    })

    it('should clear all credentials from sessionStorage backend', () => {
      const storage = new CredentialStorage({ backend: 'sessionStorage' })

      storage.store('key-1', testCredential)
      storage.store('key-2', testCredential)

      storage.clear()

      // Should only clear items with the storage namespace, not all sessionStorage
      expect(mockSessionStorage.removeItem).toHaveBeenCalled()
    })

    it('should handle clearing empty storage gracefully', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      expect(() => {
        storage.clear()
      }).not.toThrow()
    })

    it('should clear encrypted credentials', () => {
      const storage = new CredentialStorage({
        backend: 'memory',
        encrypt: true,
        encryptionKey: 'test-encryption-key-32-bytes-long',
      })

      storage.store('key-1', testCredential)
      storage.store('key-2', testCredential)

      storage.clear()

      expect(storage.retrieve('key-1')).toBeNull()
      expect(storage.retrieve('key-2')).toBeNull()
    })

    it('should only clear credentials within namespace', () => {
      const storage1 = new CredentialStorage({
        backend: 'memory',
        namespace: 'app1',
      })
      const storage2 = new CredentialStorage({
        backend: 'memory',
        namespace: 'app2',
      })

      // Note: This test assumes separate memory stores per namespace
      // If using shared localStorage, namespacing should prevent cross-app clearing
      storage1.store(testKey, testCredential)
      storage2.store(testKey, testCredential)

      storage1.clear()

      expect(storage1.retrieve(testKey)).toBeNull()
      // storage2 should be independent
      expect(storage2.retrieve(testKey)).toEqual(testCredential)
    })
  })

  describe('memory-only storage', () => {
    it('should not persist data to localStorage when using memory backend', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      storage.store(testKey, testCredential)

      expect(mockLocalStorage.setItem).not.toHaveBeenCalled()
    })

    it('should not persist data to sessionStorage when using memory backend', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      storage.store(testKey, testCredential)

      expect(mockSessionStorage.setItem).not.toHaveBeenCalled()
    })

    it('should lose data when storage instance is destroyed (memory only)', () => {
      let storage = new CredentialStorage({ backend: 'memory' })

      storage.store(testKey, testCredential)

      // Simulate destroying the instance and creating new one
      storage = new CredentialStorage({ backend: 'memory' })

      const retrieved = storage.retrieve(testKey)
      expect(retrieved).toBeNull()
    })

    it('should be suitable for sensitive environments (no disk persistence)', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      storage.store(testKey, testCredential)

      // Verify no persistent storage was touched
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled()
      expect(mockSessionStorage.setItem).not.toHaveBeenCalled()
    })
  })

  describe('storage backends', () => {
    it('should handle localStorage backend correctly', () => {
      const storage = new CredentialStorage({ backend: 'localStorage' })

      storage.store(testKey, testCredential)

      // Should call localStorage methods
      expect(mockLocalStorage.setItem).toHaveBeenCalled()
      expect(storage.backend).toBe('localStorage')
    })

    it('should handle sessionStorage backend correctly', () => {
      const storage = new CredentialStorage({ backend: 'sessionStorage' })

      storage.store(testKey, testCredential)

      // Should call sessionStorage methods
      expect(mockSessionStorage.setItem).toHaveBeenCalled()
      expect(storage.backend).toBe('sessionStorage')
    })

    it('should handle memory backend correctly', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      storage.store(testKey, testCredential)

      // Should not call any external storage
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled()
      expect(mockSessionStorage.setItem).not.toHaveBeenCalled()
      expect(storage.backend).toBe('memory')
    })

    it('should fallback to memory if localStorage is not available', () => {
      // Simulate missing localStorage
      ;(globalThis as any).localStorage = undefined

      const storage = new CredentialStorage({ backend: 'localStorage' })

      // Should fallback to memory
      expect(storage.backend).toBe('memory')
    })

    it('should fallback to memory if sessionStorage is not available', () => {
      // Simulate missing sessionStorage
      ;(globalThis as any).sessionStorage = undefined

      const storage = new CredentialStorage({ backend: 'sessionStorage' })

      // Should fallback to memory
      expect(storage.backend).toBe('memory')
    })

    it('should handle storage quota exceeded error gracefully', () => {
      const storage = new CredentialStorage({ backend: 'localStorage' })

      // Simulate quota exceeded error
      mockLocalStorage.setItem.mockImplementation(() => {
        const error = new Error('QuotaExceededError')
        error.name = 'QuotaExceededError'
        throw error
      })

      expect(() => {
        storage.store(testKey, testCredential)
      }).not.toThrow()

      // Should fallback or handle gracefully
      const retrieved = storage.retrieve(testKey)
      expect(retrieved).toBeNull()
    })
  })

  describe('credential expiry handling', () => {
    it('should not return expired credential', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const expiredCredential = {
        token: 'expired-token',
        refreshToken: 'expired-refresh',
        expiresAt: Date.now() - 1000,
      }

      storage.store(testKey, expiredCredential)
      const retrieved = storage.retrieve(testKey)

      expect(retrieved).toBeNull()
    })

    it('should return valid credential that has not expired', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const validCredential = {
        token: 'valid-token',
        refreshToken: 'valid-refresh',
        expiresAt: Date.now() + 3600000, // 1 hour from now
      }

      storage.store(testKey, validCredential)
      const retrieved = storage.retrieve(testKey)

      expect(retrieved).toEqual(validCredential)
    })

    it('should handle credential expiring at exact moment', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const expiringNowCredential = {
        token: 'expiring-token',
        refreshToken: 'expiring-refresh',
        expiresAt: Date.now(),
      }

      storage.store(testKey, expiringNowCredential)
      const retrieved = storage.retrieve(testKey)

      // Credential expiring exactly now should be considered expired
      expect(retrieved).toBeNull()
    })

    it('should automatically clean up expired credentials on retrieval', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const expiredCredential = {
        token: 'expired-token',
        refreshToken: 'expired-refresh',
        expiresAt: Date.now() - 1000,
      }

      storage.store(testKey, expiredCredential)

      // First retrieval should detect expiry and clean up
      storage.retrieve(testKey)

      // Second retrieval should still return null (not find the expired credential)
      const secondRetrieval = storage.retrieve(testKey)
      expect(secondRetrieval).toBeNull()
    })

    it('should support credentials without expiry (never expire)', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const noExpiryCredential = {
        token: 'no-expiry-token',
        refreshToken: 'no-expiry-refresh',
      }

      storage.store(testKey, noExpiryCredential)

      // Advance time significantly
      vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000) // 1 year

      const retrieved = storage.retrieve(testKey)
      expect(retrieved).toEqual(noExpiryCredential)
    })

    it('should handle expiry check for localStorage backend', () => {
      const storage = new CredentialStorage({ backend: 'localStorage' })

      const expiredCredential = {
        token: 'expired-token',
        refreshToken: 'expired-refresh',
        expiresAt: Date.now() - 1000,
      }

      storage.store(testKey, expiredCredential)
      const retrieved = storage.retrieve(testKey)

      expect(retrieved).toBeNull()
      expect(mockLocalStorage.removeItem).toHaveBeenCalled()
    })

    it('should handle expiry check for sessionStorage backend', () => {
      const storage = new CredentialStorage({ backend: 'sessionStorage' })

      const expiredCredential = {
        token: 'expired-token',
        refreshToken: 'expired-refresh',
        expiresAt: Date.now() - 1000,
      }

      storage.store(testKey, expiredCredential)
      const retrieved = storage.retrieve(testKey)

      expect(retrieved).toBeNull()
      expect(mockSessionStorage.removeItem).toHaveBeenCalled()
    })

    it('should provide method to check if credential is expired without removing it', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const expiredCredential = {
        token: 'expired-token',
        refreshToken: 'expired-refresh',
        expiresAt: Date.now() - 1000,
      }

      storage.store(testKey, expiredCredential)

      const isExpired = storage.isExpired(testKey)

      expect(isExpired).toBe(true)
    })

    it('should return false for non-expired credential expiry check', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const validCredential = {
        token: 'valid-token',
        refreshToken: 'valid-refresh',
        expiresAt: Date.now() + 3600000,
      }

      storage.store(testKey, validCredential)

      const isExpired = storage.isExpired(testKey)

      expect(isExpired).toBe(false)
    })

    it('should return false for non-existent credential expiry check', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const isExpired = storage.isExpired('non-existent-key')

      expect(isExpired).toBe(false)
    })
  })

  describe('encryption support', () => {
    const encryptionKey = 'test-encryption-key-32-bytes-long'

    it('should encrypt credentials when encryption is enabled', () => {
      const storage = new CredentialStorage({
        backend: 'memory',
        encrypt: true,
        encryptionKey,
      })

      storage.store(testKey, testCredential)

      // Access internal storage to verify encryption
      const rawStored = (storage as any).memoryStore?.get(testKey)
      expect(rawStored).toBeDefined()
      expect(typeof rawStored).toBe('string')
      // Should not contain plain text
      expect(rawStored).not.toContain(testCredential.token)
      expect(rawStored).not.toContain(testCredential.refreshToken)
    })

    it('should decrypt credentials when retrieving with encryption enabled', () => {
      const storage = new CredentialStorage({
        backend: 'memory',
        encrypt: true,
        encryptionKey,
      })

      storage.store(testKey, testCredential)
      const retrieved = storage.retrieve(testKey)

      expect(retrieved).toEqual(testCredential)
    })

    it('should handle decryption failure gracefully', () => {
      const storage = new CredentialStorage({
        backend: 'memory',
        encrypt: true,
        encryptionKey,
      })

      // Manually corrupt encrypted data
      ;(storage as any).memoryStore?.set(testKey, 'corrupted-encrypted-data')

      const retrieved = storage.retrieve(testKey)

      expect(retrieved).toBeNull()
    })

    it('should not decrypt with wrong encryption key', () => {
      const storage1 = new CredentialStorage({
        backend: 'localStorage',
        encrypt: true,
        encryptionKey: 'key-one-32-bytes-long-xxxxxxxx',
      })

      storage1.store(testKey, testCredential)

      // Try to retrieve with different key
      const storage2 = new CredentialStorage({
        backend: 'localStorage',
        encrypt: true,
        encryptionKey: 'key-two-32-bytes-long-xxxxxxxx',
      })

      const retrieved = storage2.retrieve(testKey)

      // Should fail to decrypt with wrong key
      expect(retrieved).toBeNull()
    })

    it('should support encryption with localStorage backend', () => {
      const storage = new CredentialStorage({
        backend: 'localStorage',
        encrypt: true,
        encryptionKey,
      })

      storage.store(testKey, testCredential)

      expect(mockLocalStorage.setItem).toHaveBeenCalled()

      const retrieved = storage.retrieve(testKey)
      expect(retrieved).toEqual(testCredential)
    })

    it('should support encryption with sessionStorage backend', () => {
      const storage = new CredentialStorage({
        backend: 'sessionStorage',
        encrypt: true,
        encryptionKey,
      })

      storage.store(testKey, testCredential)

      expect(mockSessionStorage.setItem).toHaveBeenCalled()

      const retrieved = storage.retrieve(testKey)
      expect(retrieved).toEqual(testCredential)
    })

    it('should encrypt different credentials with same key independently', () => {
      const storage = new CredentialStorage({
        backend: 'memory',
        encrypt: true,
        encryptionKey,
      })

      const credential1 = { ...testCredential, token: 'token-1' }
      const credential2 = { ...testCredential, token: 'token-2' }

      storage.store('key-1', credential1)
      storage.store('key-2', credential2)

      expect(storage.retrieve('key-1')).toEqual(credential1)
      expect(storage.retrieve('key-2')).toEqual(credential2)
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle null credential gracefully', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      expect(() => {
        storage.store(testKey, null as any)
      }).toThrow('Credential cannot be null or undefined')
    })

    it('should handle undefined credential gracefully', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      expect(() => {
        storage.store(testKey, undefined as any)
      }).toThrow('Credential cannot be null or undefined')
    })

    it('should handle empty string key gracefully', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      expect(() => {
        storage.store('', testCredential)
      }).toThrow('Key cannot be empty')
    })

    it('should handle very long keys', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const longKey = 'x'.repeat(1000)

      storage.store(longKey, testCredential)
      const retrieved = storage.retrieve(longKey)

      expect(retrieved).toEqual(testCredential)
    })

    it('should handle credentials with special characters in token', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const specialCredential = {
        token: 'token-with-special-chars-!@#$%^&*()',
        refreshToken: 'refresh-with-unicode-\u2764\ufe0f',
        expiresAt: Date.now() + 3600000,
      }

      storage.store(testKey, specialCredential)
      const retrieved = storage.retrieve(testKey)

      expect(retrieved).toEqual(specialCredential)
    })

    it('should handle very large credential objects', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const largeCredential = {
        token: 'x'.repeat(10000),
        refreshToken: 'y'.repeat(10000),
        expiresAt: Date.now() + 3600000,
        metadata: {
          data: 'z'.repeat(10000),
        },
      }

      storage.store(testKey, largeCredential)
      const retrieved = storage.retrieve(testKey)

      expect(retrieved).toEqual(largeCredential)
    })

    it('should handle concurrent access gracefully', async () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const promises = Array.from({ length: 10 }, (_, i) => {
        return Promise.resolve().then(() => {
          storage.store(`key-${i}`, { ...testCredential, token: `token-${i}` })
        })
      })

      await Promise.all(promises)

      // All should be stored correctly
      for (let i = 0; i < 10; i++) {
        const retrieved = storage.retrieve(`key-${i}`)
        expect(retrieved?.token).toBe(`token-${i}`)
      }
    })

    it('should provide list of all stored credential keys', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      storage.store('key-1', testCredential)
      storage.store('key-2', testCredential)
      storage.store('key-3', testCredential)

      const keys = storage.keys()

      expect(keys).toHaveLength(3)
      expect(keys).toContain('key-1')
      expect(keys).toContain('key-2')
      expect(keys).toContain('key-3')
    })

    it('should return empty array for keys when storage is empty', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const keys = storage.keys()

      expect(keys).toEqual([])
    })

    it('should not include expired credentials in keys list', () => {
      const storage = new CredentialStorage({ backend: 'memory' })

      const validCredential = {
        token: 'valid-token',
        refreshToken: 'valid-refresh',
        expiresAt: Date.now() + 3600000,
      }

      const expiredCredential = {
        token: 'expired-token',
        refreshToken: 'expired-refresh',
        expiresAt: Date.now() - 1000,
      }

      storage.store('valid-key', validCredential)
      storage.store('expired-key', expiredCredential)

      const keys = storage.keys()

      expect(keys).toContain('valid-key')
      expect(keys).not.toContain('expired-key')
    })
  })
})
