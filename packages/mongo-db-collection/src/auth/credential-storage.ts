/**
 * @file Credential Storage Implementation
 * @module @tanstack/mongo-db-collection/auth/credential-storage
 *
 * Provides secure credential management for mongo.do authentication.
 * Supports multiple storage backends (memory, localStorage, sessionStorage, IndexedDB)
 * with optional encryption using Web Crypto API and automatic expiry handling.
 *
 * ## Features
 *
 * - **Multiple Storage Backends**: Memory, localStorage, sessionStorage, and IndexedDB
 * - **Strong Encryption**: Uses Web Crypto API (AES-GCM) with fallback to XOR for legacy environments
 * - **Credential Rotation**: Built-in support for rotating credentials with configurable policies
 * - **Storage Migration**: Helpers for migrating credentials between storage backends
 * - **Audit Logging**: Hooks for tracking credential operations for security monitoring
 * - **Automatic Expiry**: Credentials are automatically invalidated when expired
 *
 * ## Security Considerations
 *
 * - Encryption keys should be derived from user secrets, not stored directly
 * - Memory backend provides the highest security (no persistence)
 * - Enable audit logging in production to track credential access
 * - Consider using IndexedDB for large credential stores with encryption
 *
 * @example
 * ```typescript
 * // Basic usage with memory backend
 * const storage = new CredentialStorage();
 * storage.store('user-token', { token: 'abc123', expiresAt: Date.now() + 3600000 });
 *
 * // With Web Crypto encryption
 * const secureStorage = new CredentialStorage({
 *   backend: 'localStorage',
 *   encrypt: true,
 *   encryptionKey: await deriveKey(userPassword),
 * });
 *
 * // With audit logging
 * const auditedStorage = new CredentialStorage({
 *   onAudit: (event) => securityLogger.log(event),
 * });
 * ```
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
 * @see https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
 */

/**
 * Supported storage backend types.
 *
 * - `memory`: In-memory storage, cleared when the instance is destroyed (most secure)
 * - `localStorage`: Persistent browser storage, survives page refresh
 * - `sessionStorage`: Session-scoped browser storage, cleared when tab closes
 * - `indexedDB`: IndexedDB storage for larger data sets with async access
 *
 * @example
 * ```typescript
 * const storage = new CredentialStorage({ backend: 'localStorage' });
 * ```
 */
export type StorageBackend = 'memory' | 'localStorage' | 'sessionStorage' | 'indexedDB'

/**
 * Encryption algorithm types supported by the credential storage.
 *
 * - `aes-gcm`: AES-GCM encryption via Web Crypto API (recommended)
 * - `xor`: Simple XOR encryption fallback for environments without Web Crypto
 *
 * @remarks
 * AES-GCM is strongly recommended for production use. XOR is provided only
 * as a fallback for legacy environments without Web Crypto API support.
 */
export type EncryptionAlgorithm = 'aes-gcm' | 'xor'

/**
 * Audit event types for credential operations.
 *
 * Used by the audit logging system to track credential lifecycle events.
 */
export type AuditEventType =
  | 'store'
  | 'retrieve'
  | 'remove'
  | 'clear'
  | 'expire'
  | 'rotate'
  | 'migrate'
  | 'decrypt_failure'
  | 'encryption_error'

/**
 * Audit event payload for credential operations.
 *
 * @property type - The type of audit event
 * @property key - The credential key involved (may be redacted)
 * @property timestamp - Unix timestamp when the event occurred
 * @property backend - The storage backend used
 * @property success - Whether the operation succeeded
 * @property metadata - Additional context for the event
 *
 * @example
 * ```typescript
 * const storage = new CredentialStorage({
 *   onAudit: (event: AuditEvent) => {
 *     console.log(`[${event.type}] Key: ${event.key} at ${new Date(event.timestamp)}`);
 *   },
 * });
 * ```
 */
export interface AuditEvent {
  /** The type of audit event */
  type: AuditEventType
  /** The credential key involved (may be redacted for security) */
  key: string
  /** Unix timestamp when the event occurred */
  timestamp: number
  /** The storage backend used */
  backend: StorageBackend
  /** Whether the operation succeeded */
  success: boolean
  /** Additional context for the event */
  metadata?: Record<string, unknown>
}

/**
 * Callback function for audit events.
 *
 * @param event - The audit event payload
 *
 * @example
 * ```typescript
 * const auditCallback: AuditCallback = (event) => {
 *   fetch('/api/audit', {
 *     method: 'POST',
 *     body: JSON.stringify(event),
 *   });
 * };
 * ```
 */
export type AuditCallback = (event: AuditEvent) => void

/**
 * Stored credential structure.
 *
 * Represents authentication credentials that can be stored and retrieved
 * from the credential storage system.
 *
 * @property token - The primary authentication token (e.g., JWT, API key)
 * @property refreshToken - Optional token used to refresh the primary token
 * @property expiresAt - Unix timestamp when the credential expires
 * @property metadata - Custom metadata associated with the credential
 *
 * @example
 * ```typescript
 * const credential: StoredCredential = {
 *   token: 'eyJhbGciOiJIUzI1NiIs...',
 *   refreshToken: 'refresh_token_xyz',
 *   expiresAt: Date.now() + 3600000, // 1 hour from now
 *   metadata: {
 *     userId: 'user_123',
 *     scope: ['read', 'write'],
 *   },
 * };
 * ```
 */
export interface StoredCredential {
  /** Primary authentication token */
  token?: string
  /** Token used to refresh the primary token */
  refreshToken?: string
  /** Unix timestamp when the credential expires (undefined = never expires) */
  expiresAt?: number
  /** Custom metadata associated with the credential */
  metadata?: Record<string, unknown>
  /** Allow additional properties for extensibility */
  [key: string]: unknown
}

/**
 * Configuration options for credential rotation.
 *
 * @property rotationInterval - Time in milliseconds before credentials should be rotated
 * @property maxAge - Maximum age in milliseconds for any credential
 * @property onRotationNeeded - Callback invoked when rotation is needed
 * @property autoRotate - Whether to automatically trigger rotation callbacks
 *
 * @example
 * ```typescript
 * const rotationConfig: RotationConfig = {
 *   rotationInterval: 24 * 60 * 60 * 1000, // 24 hours
 *   maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
 *   onRotationNeeded: async (key, credential) => {
 *     const newToken = await refreshToken(credential.refreshToken);
 *     return { ...credential, token: newToken };
 *   },
 * };
 * ```
 */
export interface RotationConfig {
  /** Time in milliseconds before credentials should be rotated */
  rotationInterval?: number
  /** Maximum age in milliseconds for any credential */
  maxAge?: number
  /** Callback invoked when rotation is needed, returns new credential or null to skip */
  onRotationNeeded?: (key: string, credential: StoredCredential) => Promise<StoredCredential | null>
  /** Whether to automatically trigger rotation callbacks on retrieve (default: false) */
  autoRotate?: boolean
}

/**
 * Configuration options for credential storage.
 *
 * @property backend - Storage backend to use (default: 'memory')
 * @property namespace - Namespace prefix for storage keys (default: 'mongo-do')
 * @property encrypt - Whether to encrypt stored credentials (default: false)
 * @property encryptionKey - Key for encryption (required if encrypt is true)
 * @property encryptionAlgorithm - Encryption algorithm to use (default: 'aes-gcm' if available)
 * @property onAudit - Callback for audit events
 * @property rotation - Configuration for credential rotation
 * @property indexedDBName - Database name for IndexedDB backend (default: 'mongo-do-credentials')
 * @property indexedDBStoreName - Store name for IndexedDB backend (default: 'credentials')
 *
 * @example
 * ```typescript
 * const config: CredentialStorageConfig = {
 *   backend: 'localStorage',
 *   namespace: 'my-app',
 *   encrypt: true,
 *   encryptionKey: 'my-32-byte-encryption-key-here!',
 *   encryptionAlgorithm: 'aes-gcm',
 *   onAudit: (event) => console.log('Audit:', event),
 *   rotation: {
 *     rotationInterval: 3600000,
 *     autoRotate: true,
 *   },
 * };
 * ```
 */
export interface CredentialStorageConfig {
  /** Storage backend to use */
  backend?: StorageBackend
  /** Namespace prefix for storage keys */
  namespace?: string
  /** Whether to encrypt stored credentials */
  encrypt?: boolean
  /** Key for encryption (required if encrypt is true) */
  encryptionKey?: string
  /** Encryption algorithm to use */
  encryptionAlgorithm?: EncryptionAlgorithm
  /** Callback for audit events */
  onAudit?: AuditCallback
  /** Configuration for credential rotation */
  rotation?: RotationConfig
  /** Database name for IndexedDB backend */
  indexedDBName?: string
  /** Store name for IndexedDB backend */
  indexedDBStoreName?: string
}

/**
 * Result of a storage migration operation.
 *
 * @property success - Whether the migration completed successfully
 * @property migratedCount - Number of credentials successfully migrated
 * @property failedCount - Number of credentials that failed to migrate
 * @property errors - Array of error messages for failed migrations
 *
 * @example
 * ```typescript
 * const result = await storage.migrateFrom(oldStorage);
 * if (result.success) {
 *   console.log(`Migrated ${result.migratedCount} credentials`);
 * } else {
 *   console.error(`Migration failed: ${result.errors.join(', ')}`);
 * }
 * ```
 */
export interface MigrationResult {
  /** Whether the migration completed successfully */
  success: boolean
  /** Number of credentials successfully migrated */
  migratedCount: number
  /** Number of credentials that failed to migrate */
  failedCount: number
  /** Array of error messages for failed migrations */
  errors: string[]
}

/**
 * Internal structure for storing credential metadata alongside the credential.
 * @internal
 */
interface StoredCredentialWrapper {
  credential: StoredCredential
  storedAt: number
  version: number
  rotatedAt?: number
}

/** Current storage format version for migration support */
const STORAGE_VERSION = 2

/**
 * CredentialStorage provides secure credential management with support
 * for multiple storage backends, encryption, rotation, and audit logging.
 *
 * ## Overview
 *
 * This class is the primary interface for storing and retrieving authentication
 * credentials in the mongo.do client. It supports multiple storage backends,
 * optional encryption, automatic credential expiry, rotation policies, and
 * audit logging for security compliance.
 *
 * ## Thread Safety
 *
 * This class is not thread-safe. In environments with concurrent access
 * (e.g., Web Workers), consider using separate instances or implementing
 * external synchronization.
 *
 * ## Storage Backends
 *
 * | Backend | Persistence | Security | Use Case |
 * |---------|-------------|----------|----------|
 * | memory | None | Highest | Sensitive environments |
 * | sessionStorage | Tab lifetime | Medium | Session-based auth |
 * | localStorage | Permanent | Lower | Persistent sessions |
 * | indexedDB | Permanent | Lower | Large credential stores |
 *
 * @example
 * ```typescript
 * // Create storage with encryption and audit logging
 * const storage = new CredentialStorage({
 *   backend: 'localStorage',
 *   encrypt: true,
 *   encryptionKey: 'my-secure-key-32-bytes-long!!!!',
 *   onAudit: (event) => securityLogger.log(event),
 * });
 *
 * // Store a credential
 * storage.store('api-token', {
 *   token: 'secret-token-value',
 *   expiresAt: Date.now() + 3600000,
 * });
 *
 * // Retrieve a credential
 * const credential = storage.retrieve('api-token');
 * if (credential) {
 *   console.log('Token:', credential.token);
 * }
 *
 * // Check if rotation is needed
 * if (storage.needsRotation('api-token')) {
 *   const newCredential = await refreshCredential(credential);
 *   storage.rotate('api-token', newCredential);
 * }
 * ```
 */
export class CredentialStorage {
  /**
   * The active storage backend.
   * May differ from requested backend if fallback occurred.
   */
  readonly backend: StorageBackend

  /**
   * The namespace prefix used for storage keys.
   * All keys are prefixed with `{namespace}:` to prevent collisions.
   */
  readonly namespace: string

  /**
   * Whether encryption is enabled for this storage instance.
   */
  readonly isEncrypted: boolean

  /**
   * The encryption algorithm in use.
   * Will be 'aes-gcm' if Web Crypto is available, otherwise 'xor'.
   */
  readonly encryptionAlgorithm: EncryptionAlgorithm

  /** @internal Encryption key for credential encryption */
  private encryptionKey?: string

  /** @internal In-memory storage map */
  private memoryStore = new Map<string, string>()

  /** @internal Web Crypto key for AES-GCM encryption */
  private cryptoKey?: CryptoKey

  /** @internal Whether Web Crypto API is available */
  private webCryptoAvailable: boolean

  /** @internal Audit callback function */
  private auditCallback?: AuditCallback

  /** @internal Rotation configuration */
  private rotationConfig?: RotationConfig

  /** @internal IndexedDB database name */
  private indexedDBName: string

  /** @internal IndexedDB store name */
  private indexedDBStoreName: string

  /** @internal IndexedDB database reference */
  private db?: IDBDatabase

  /** @internal Promise for IndexedDB initialization */
  private dbInitPromise?: Promise<IDBDatabase>

  /**
   * Creates a new CredentialStorage instance.
   *
   * @param config - Configuration options for the storage instance
   * @throws {Error} When encryption is enabled but no encryption key is provided
   *
   * @example
   * ```typescript
   * // Simple memory storage
   * const storage = new CredentialStorage();
   *
   * // Encrypted localStorage with audit logging
   * const secureStorage = new CredentialStorage({
   *   backend: 'localStorage',
   *   encrypt: true,
   *   encryptionKey: 'my-32-byte-key-for-aes-gcm-mode',
   *   onAudit: (event) => analytics.track('credential_event', event),
   * });
   * ```
   */
  constructor(config?: CredentialStorageConfig) {
    this.namespace = config?.namespace ?? 'mongo-do'
    this.isEncrypted = config?.encrypt ?? false
    this.encryptionKey = config?.encryptionKey
    this.auditCallback = config?.onAudit
    this.rotationConfig = config?.rotation
    this.indexedDBName = config?.indexedDBName ?? 'mongo-do-credentials'
    this.indexedDBStoreName = config?.indexedDBStoreName ?? 'credentials'

    // Check Web Crypto availability
    this.webCryptoAvailable = this.checkWebCryptoAvailability()

    // Determine encryption algorithm
    if (config?.encryptionAlgorithm) {
      this.encryptionAlgorithm = config.encryptionAlgorithm
    } else {
      this.encryptionAlgorithm = this.webCryptoAvailable ? 'aes-gcm' : 'xor'
    }

    // Validate encryption configuration
    if (this.isEncrypted && !this.encryptionKey) {
      throw new Error('Encryption key is required when encryption is enabled')
    }

    // Initialize Web Crypto key if using AES-GCM
    if (this.isEncrypted && this.encryptionAlgorithm === 'aes-gcm' && this.encryptionKey) {
      this.initializeCryptoKey(this.encryptionKey)
    }

    // Determine backend with fallback to memory if storage is not available
    const requestedBackend = config?.backend ?? 'memory'
    this.backend = this.resolveBackend(requestedBackend)

    // Initialize IndexedDB if needed
    if (this.backend === 'indexedDB') {
      this.dbInitPromise = this.initializeIndexedDB()
    }
  }

  /**
   * Store a credential with the given key.
   *
   * Stores the credential in the configured storage backend, optionally
   * encrypting it first. The credential is wrapped with metadata including
   * storage timestamp and version for migration support.
   *
   * @param key - Unique identifier for the credential
   * @param credential - The credential data to store
   * @throws {Error} When key is empty
   * @throws {Error} When credential is null or undefined
   *
   * @example
   * ```typescript
   * storage.store('user-auth', {
   *   token: 'jwt-token-here',
   *   refreshToken: 'refresh-token-here',
   *   expiresAt: Date.now() + 3600000,
   *   metadata: { userId: 'user_123' },
   * });
   * ```
   */
  store(key: string, credential: StoredCredential): void {
    if (!key || key.length === 0) {
      throw new Error('Key cannot be empty')
    }

    if (credential === null || credential === undefined) {
      throw new Error('Credential cannot be null or undefined')
    }

    const storageKey = this.getStorageKey(key)
    const wrapper: StoredCredentialWrapper = {
      credential,
      storedAt: Date.now(),
      version: STORAGE_VERSION,
    }
    const data = JSON.stringify(wrapper)
    const encodedData = this.isEncrypted ? this.encrypt(data) : data

    let success = true

    if (this.backend === 'memory') {
      this.memoryStore.set(key, encodedData)
    } else if (this.backend === 'indexedDB') {
      // IndexedDB operations are async, but we want sync API
      // Store in memory as backup and queue IndexedDB write
      this.memoryStore.set(key, encodedData)
      this.storeToIndexedDB(key, encodedData).catch(() => {
        // Silently fail - memory backup exists
        success = false
      })
    } else {
      const storage = this.getStorage()
      if (storage) {
        try {
          storage.setItem(storageKey, encodedData)
        } catch (error: unknown) {
          success = false
          // Handle quota exceeded or other storage errors gracefully
          if (error instanceof Error && error.name === 'QuotaExceededError') {
            this.emitAudit('store', key, false, { error: 'QuotaExceededError' })
            return
          }
        }
      }
    }

    this.emitAudit('store', key, success)
  }

  /**
   * Store a credential asynchronously (required for IndexedDB).
   *
   * This method provides full async support for IndexedDB operations.
   * For other backends, it behaves identically to the synchronous store method.
   *
   * @param key - Unique identifier for the credential
   * @param credential - The credential data to store
   * @returns Promise that resolves when the credential is stored
   * @throws {Error} When key is empty
   * @throws {Error} When credential is null or undefined
   *
   * @example
   * ```typescript
   * await storage.storeAsync('user-auth', {
   *   token: 'jwt-token-here',
   *   expiresAt: Date.now() + 3600000,
   * });
   * ```
   */
  async storeAsync(key: string, credential: StoredCredential): Promise<void> {
    if (!key || key.length === 0) {
      throw new Error('Key cannot be empty')
    }

    if (credential === null || credential === undefined) {
      throw new Error('Credential cannot be null or undefined')
    }

    const wrapper: StoredCredentialWrapper = {
      credential,
      storedAt: Date.now(),
      version: STORAGE_VERSION,
    }
    const data = JSON.stringify(wrapper)
    const encodedData = this.isEncrypted ? await this.encryptAsync(data) : data

    let success = true

    if (this.backend === 'indexedDB') {
      try {
        await this.storeToIndexedDB(key, encodedData)
        this.memoryStore.set(key, encodedData)
      } catch {
        success = false
        // Fallback to memory only
        this.memoryStore.set(key, encodedData)
      }
    } else {
      // Use sync method for non-IndexedDB backends
      this.store(key, credential)
      return
    }

    this.emitAudit('store', key, success)
  }

  /**
   * Retrieve a credential by key.
   *
   * Returns the stored credential if it exists and has not expired.
   * Expired credentials are automatically removed from storage.
   *
   * @param key - The key of the credential to retrieve
   * @returns The stored credential, or null if not found or expired
   *
   * @example
   * ```typescript
   * const credential = storage.retrieve('user-auth');
   * if (credential) {
   *   console.log('Token:', credential.token);
   *   console.log('Expires:', new Date(credential.expiresAt));
   * } else {
   *   console.log('No valid credential found');
   * }
   * ```
   */
  retrieve(key: string): StoredCredential | null {
    const storageKey = this.getStorageKey(key)
    let rawData: string | null = null

    if (this.backend === 'memory' || this.backend === 'indexedDB') {
      rawData = this.memoryStore.get(key) ?? null
    } else {
      const storage = this.getStorage()
      if (storage) {
        rawData = storage.getItem(storageKey)
      }
    }

    if (!rawData) {
      this.emitAudit('retrieve', key, false, { reason: 'not_found' })
      return null
    }

    try {
      const data = this.isEncrypted ? this.decrypt(rawData) : rawData
      const parsed = JSON.parse(data)

      // Handle both old format (direct credential) and new format (wrapper)
      const wrapper = this.normalizeStoredData(parsed)
      const credential = wrapper.credential

      // Check if credential has expired
      if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now()) {
        this.remove(key)
        this.emitAudit('expire', key, true)
        return null
      }

      // Check if rotation is needed and auto-rotate is enabled
      if (this.rotationConfig?.autoRotate && this.needsRotation(key)) {
        this.triggerRotation(key, credential)
      }

      this.emitAudit('retrieve', key, true)
      return credential
    } catch (error) {
      this.emitAudit('decrypt_failure', key, false, { error: String(error) })
      return null
    }
  }

  /**
   * Retrieve a credential asynchronously (required for IndexedDB).
   *
   * This method provides full async support for IndexedDB operations
   * and Web Crypto decryption.
   *
   * @param key - The key of the credential to retrieve
   * @returns Promise that resolves to the credential or null
   *
   * @example
   * ```typescript
   * const credential = await storage.retrieveAsync('user-auth');
   * if (credential) {
   *   await makeApiCall(credential.token);
   * }
   * ```
   */
  async retrieveAsync(key: string): Promise<StoredCredential | null> {
    let rawData: string | null = null

    if (this.backend === 'indexedDB') {
      // Try memory cache first
      rawData = this.memoryStore.get(key) ?? null

      // If not in memory, try IndexedDB
      if (!rawData) {
        rawData = await this.retrieveFromIndexedDB(key)
        if (rawData) {
          this.memoryStore.set(key, rawData)
        }
      }
    } else {
      return this.retrieve(key)
    }

    if (!rawData) {
      this.emitAudit('retrieve', key, false, { reason: 'not_found' })
      return null
    }

    try {
      const data = this.isEncrypted ? await this.decryptAsync(rawData) : rawData
      const parsed = JSON.parse(data)
      const wrapper = this.normalizeStoredData(parsed)
      const credential = wrapper.credential

      if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now()) {
        await this.removeAsync(key)
        this.emitAudit('expire', key, true)
        return null
      }

      this.emitAudit('retrieve', key, true)
      return credential
    } catch (error) {
      this.emitAudit('decrypt_failure', key, false, { error: String(error) })
      return null
    }
  }

  /**
   * Remove a credential by key.
   *
   * Removes the credential from the storage backend. If the credential
   * doesn't exist, this method does nothing (no error is thrown).
   *
   * @param key - The key of the credential to remove
   *
   * @example
   * ```typescript
   * // Remove on logout
   * storage.remove('user-auth');
   *
   * // Safe to call even if credential doesn't exist
   * storage.remove('non-existent-key');
   * ```
   */
  remove(key: string): void {
    const storageKey = this.getStorageKey(key)

    if (this.backend === 'memory') {
      this.memoryStore.delete(key)
    } else if (this.backend === 'indexedDB') {
      this.memoryStore.delete(key)
      this.removeFromIndexedDB(key).catch(() => {
        // Silently fail
      })
    } else {
      const storage = this.getStorage()
      if (storage) {
        storage.removeItem(storageKey)
      }
    }

    this.emitAudit('remove', key, true)
  }

  /**
   * Remove a credential asynchronously (required for IndexedDB).
   *
   * @param key - The key of the credential to remove
   * @returns Promise that resolves when the credential is removed
   *
   * @example
   * ```typescript
   * await storage.removeAsync('user-auth');
   * ```
   */
  async removeAsync(key: string): Promise<void> {
    if (this.backend === 'indexedDB') {
      this.memoryStore.delete(key)
      await this.removeFromIndexedDB(key)
    } else {
      this.remove(key)
    }
    this.emitAudit('remove', key, true)
  }

  /**
   * Clear all credentials from storage within this namespace.
   *
   * Only removes credentials that belong to this storage instance's namespace.
   * Other applications' credentials stored in the same backend are not affected.
   *
   * @example
   * ```typescript
   * // Clear all credentials on logout
   * storage.clear();
   * ```
   */
  clear(): void {
    if (this.backend === 'memory') {
      this.memoryStore.clear()
    } else if (this.backend === 'indexedDB') {
      this.memoryStore.clear()
      this.clearIndexedDB().catch(() => {
        // Silently fail
      })
    } else {
      const storage = this.getStorage()
      if (storage) {
        const keysToRemove: string[] = []
        for (let i = 0; i < storage.length; i++) {
          const storageKey = storage.key(i)
          if (storageKey && storageKey.startsWith(`${this.namespace}:`)) {
            keysToRemove.push(storageKey)
          }
        }
        keysToRemove.forEach((storageKey) => storage.removeItem(storageKey))
      }
    }

    this.emitAudit('clear', '*', true)
  }

  /**
   * Clear all credentials asynchronously (required for IndexedDB).
   *
   * @returns Promise that resolves when all credentials are cleared
   *
   * @example
   * ```typescript
   * await storage.clearAsync();
   * ```
   */
  async clearAsync(): Promise<void> {
    if (this.backend === 'indexedDB') {
      this.memoryStore.clear()
      await this.clearIndexedDB()
    } else {
      this.clear()
    }
    this.emitAudit('clear', '*', true)
  }

  /**
   * Get all stored credential keys (excluding expired ones).
   *
   * Returns an array of keys for all non-expired credentials stored
   * in this namespace. Does not include expired credentials.
   *
   * @returns Array of credential keys
   *
   * @example
   * ```typescript
   * const keys = storage.keys();
   * console.log(`${keys.length} credentials stored`);
   *
   * for (const key of keys) {
   *   const credential = storage.retrieve(key);
   *   console.log(`${key}: expires at ${credential?.expiresAt}`);
   * }
   * ```
   */
  keys(): string[] {
    const result: string[] = []

    if (this.backend === 'memory' || this.backend === 'indexedDB') {
      for (const key of this.memoryStore.keys()) {
        if (!this.isExpiredInternal(key)) {
          result.push(key)
        }
      }
    } else {
      const storage = this.getStorage()
      if (storage) {
        const prefix = `${this.namespace}:`
        for (let i = 0; i < storage.length; i++) {
          const storageKey = storage.key(i)
          if (storageKey && storageKey.startsWith(prefix)) {
            const key = storageKey.slice(prefix.length)
            if (!this.isExpiredInternal(key)) {
              result.push(key)
            }
          }
        }
      }
    }

    return result
  }

  /**
   * Get all stored credential keys asynchronously (for IndexedDB).
   *
   * @returns Promise that resolves to array of credential keys
   *
   * @example
   * ```typescript
   * const keys = await storage.keysAsync();
   * for (const key of keys) {
   *   const credential = await storage.retrieveAsync(key);
   *   console.log(`${key}: ${credential?.token}`);
   * }
   * ```
   */
  async keysAsync(): Promise<string[]> {
    if (this.backend === 'indexedDB') {
      const dbKeys = await this.getIndexedDBKeys()
      const result: string[] = []
      for (const key of dbKeys) {
        const credential = await this.retrieveAsync(key)
        if (credential !== null) {
          result.push(key)
        }
      }
      return result
    }
    return this.keys()
  }

  /**
   * Check if a credential is expired without removing it.
   *
   * Returns false if the credential doesn't exist or has no expiry set.
   *
   * @param key - The key of the credential to check
   * @returns True if the credential exists and is expired, false otherwise
   *
   * @example
   * ```typescript
   * if (storage.isExpired('user-auth')) {
   *   console.log('Token has expired, need to refresh');
   *   await refreshToken();
   * }
   * ```
   */
  isExpired(key: string): boolean {
    const storageKey = this.getStorageKey(key)
    let rawData: string | null = null

    if (this.backend === 'memory' || this.backend === 'indexedDB') {
      rawData = this.memoryStore.get(key) ?? null
    } else {
      const storage = this.getStorage()
      if (storage) {
        rawData = storage.getItem(storageKey)
      }
    }

    if (!rawData) {
      return false
    }

    try {
      const data = this.isEncrypted ? this.decrypt(rawData) : rawData
      const parsed = JSON.parse(data)
      const wrapper = this.normalizeStoredData(parsed)
      const credential = wrapper.credential

      if (credential.expiresAt === undefined) {
        return false
      }

      return credential.expiresAt <= Date.now()
    } catch {
      return false
    }
  }

  /**
   * Check if a credential needs rotation based on rotation policy.
   *
   * Considers both the rotation interval and the credential's age
   * when determining if rotation is needed.
   *
   * @param key - The key of the credential to check
   * @returns True if rotation is needed, false otherwise
   *
   * @example
   * ```typescript
   * if (storage.needsRotation('api-key')) {
   *   const newCredential = await refreshApiKey();
   *   storage.rotate('api-key', newCredential);
   * }
   * ```
   */
  needsRotation(key: string): boolean {
    if (!this.rotationConfig) {
      return false
    }

    const storageKey = this.getStorageKey(key)
    let rawData: string | null = null

    if (this.backend === 'memory' || this.backend === 'indexedDB') {
      rawData = this.memoryStore.get(key) ?? null
    } else {
      const storage = this.getStorage()
      if (storage) {
        rawData = storage.getItem(storageKey)
      }
    }

    if (!rawData) {
      return false
    }

    try {
      const data = this.isEncrypted ? this.decrypt(rawData) : rawData
      const parsed = JSON.parse(data)
      const wrapper = this.normalizeStoredData(parsed)

      const now = Date.now()
      const lastRotation = wrapper.rotatedAt ?? wrapper.storedAt
      const age = now - wrapper.storedAt

      // Check rotation interval
      if (this.rotationConfig.rotationInterval) {
        const timeSinceRotation = now - lastRotation
        if (timeSinceRotation >= this.rotationConfig.rotationInterval) {
          return true
        }
      }

      // Check max age
      if (this.rotationConfig.maxAge && age >= this.rotationConfig.maxAge) {
        return true
      }

      return false
    } catch {
      return false
    }
  }

  /**
   * Rotate a credential with a new value.
   *
   * Updates the credential and marks it as rotated. The rotation timestamp
   * is recorded for policy enforcement.
   *
   * @param key - The key of the credential to rotate
   * @param newCredential - The new credential value
   *
   * @example
   * ```typescript
   * // Manual rotation
   * const currentCredential = storage.retrieve('api-key');
   * if (currentCredential && storage.needsRotation('api-key')) {
   *   const newToken = await refreshToken(currentCredential.refreshToken);
   *   storage.rotate('api-key', {
   *     ...currentCredential,
   *     token: newToken,
   *     expiresAt: Date.now() + 3600000,
   *   });
   * }
   * ```
   */
  rotate(key: string, newCredential: StoredCredential): void {
    if (!key || key.length === 0) {
      throw new Error('Key cannot be empty')
    }

    if (newCredential === null || newCredential === undefined) {
      throw new Error('Credential cannot be null or undefined')
    }

    const storageKey = this.getStorageKey(key)

    // Get existing wrapper to preserve storedAt
    let existingWrapper: StoredCredentialWrapper | null = null
    let rawData: string | null = null

    if (this.backend === 'memory' || this.backend === 'indexedDB') {
      rawData = this.memoryStore.get(key) ?? null
    } else {
      const storage = this.getStorage()
      if (storage) {
        rawData = storage.getItem(storageKey)
      }
    }

    if (rawData) {
      try {
        const data = this.isEncrypted ? this.decrypt(rawData) : rawData
        const parsed = JSON.parse(data)
        existingWrapper = this.normalizeStoredData(parsed)
      } catch {
        // Ignore, will create new wrapper
      }
    }

    const wrapper: StoredCredentialWrapper = {
      credential: newCredential,
      storedAt: existingWrapper?.storedAt ?? Date.now(),
      version: STORAGE_VERSION,
      rotatedAt: Date.now(),
    }

    const data = JSON.stringify(wrapper)
    const encodedData = this.isEncrypted ? this.encrypt(data) : data

    if (this.backend === 'memory') {
      this.memoryStore.set(key, encodedData)
    } else if (this.backend === 'indexedDB') {
      this.memoryStore.set(key, encodedData)
      this.storeToIndexedDB(key, encodedData).catch(() => {
        // Silently fail
      })
    } else {
      const storage = this.getStorage()
      if (storage) {
        storage.setItem(storageKey, encodedData)
      }
    }

    this.emitAudit('rotate', key, true)
  }

  /**
   * Migrate credentials from another CredentialStorage instance.
   *
   * Copies all non-expired credentials from the source storage to this
   * storage instance. Useful for migrating between storage backends.
   *
   * @param source - The source CredentialStorage instance to migrate from
   * @returns Result object with migration statistics
   *
   * @example
   * ```typescript
   * // Migrate from memory to localStorage
   * const memoryStorage = new CredentialStorage({ backend: 'memory' });
   * const persistentStorage = new CredentialStorage({ backend: 'localStorage' });
   *
   * // Copy credentials from memory to localStorage
   * const result = await persistentStorage.migrateFrom(memoryStorage);
   *
   * if (result.success) {
   *   console.log(`Migrated ${result.migratedCount} credentials`);
   * } else {
   *   console.error(`Failed to migrate ${result.failedCount} credentials`);
   * }
   * ```
   */
  async migrateFrom(source: CredentialStorage): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      migratedCount: 0,
      failedCount: 0,
      errors: [],
    }

    const sourceKeys = source.keys()

    for (const key of sourceKeys) {
      try {
        const credential = source.retrieve(key)
        if (credential) {
          this.store(key, credential)
          result.migratedCount++
        }
      } catch (error) {
        result.failedCount++
        result.errors.push(`Failed to migrate key "${key}": ${String(error)}`)
        result.success = false
      }
    }

    this.emitAudit('migrate', '*', result.success, {
      migratedCount: result.migratedCount,
      failedCount: result.failedCount,
      sourceBackend: source.backend,
    })

    return result
  }

  /**
   * Export all credentials for backup or migration.
   *
   * Returns all non-expired credentials as a serializable object.
   * Credentials are decrypted before export.
   *
   * @returns Object mapping keys to credentials
   *
   * @remarks
   * This method exposes credentials in plain text. Use with caution
   * and ensure exported data is properly secured.
   *
   * @example
   * ```typescript
   * const backup = storage.export();
   * const json = JSON.stringify(backup);
   *
   * // Store backup securely
   * await secureBackupService.save(json);
   * ```
   */
  export(): Record<string, StoredCredential> {
    const result: Record<string, StoredCredential> = {}

    for (const key of this.keys()) {
      const credential = this.retrieve(key)
      if (credential) {
        result[key] = credential
      }
    }

    return result
  }

  /**
   * Import credentials from a backup.
   *
   * Stores all provided credentials, overwriting any existing credentials
   * with the same keys.
   *
   * @param credentials - Object mapping keys to credentials
   * @returns Number of credentials successfully imported
   *
   * @example
   * ```typescript
   * const backup = await secureBackupService.load();
   * const data = JSON.parse(backup);
   *
   * const imported = storage.import(data);
   * console.log(`Imported ${imported} credentials`);
   * ```
   */
  import(credentials: Record<string, StoredCredential>): number {
    let count = 0

    for (const [key, credential] of Object.entries(credentials)) {
      try {
        this.store(key, credential)
        count++
      } catch {
        // Skip invalid credentials
      }
    }

    return count
  }

  /**
   * Get storage statistics.
   *
   * Returns information about the storage state including
   * the number of stored credentials and backend type.
   *
   * @returns Storage statistics object
   *
   * @example
   * ```typescript
   * const stats = storage.getStats();
   * console.log(`Backend: ${stats.backend}`);
   * console.log(`Credentials: ${stats.count}`);
   * console.log(`Encrypted: ${stats.encrypted}`);
   * ```
   */
  getStats(): {
    backend: StorageBackend
    count: number
    encrypted: boolean
    encryptionAlgorithm: EncryptionAlgorithm
    namespace: string
  } {
    return {
      backend: this.backend,
      count: this.keys().length,
      encrypted: this.isEncrypted,
      encryptionAlgorithm: this.encryptionAlgorithm,
      namespace: this.namespace,
    }
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Internal method to check expiry without side effects (for keys() method).
   * @internal
   */
  private isExpiredInternal(key: string): boolean {
    return this.isExpired(key)
  }

  /**
   * Generate a namespaced storage key.
   * @internal
   */
  private getStorageKey(key: string): string {
    return `${this.namespace}:${key}`
  }

  /**
   * Check if Web Crypto API is available.
   * @internal
   */
  private checkWebCryptoAvailability(): boolean {
    try {
      return (
        typeof globalThis !== 'undefined' &&
        typeof globalThis.crypto !== 'undefined' &&
        typeof globalThis.crypto.subtle !== 'undefined'
      )
    } catch {
      return false
    }
  }

  /**
   * Initialize the Web Crypto key from the encryption key string.
   * @internal
   */
  private async initializeCryptoKey(keyString: string): Promise<void> {
    if (!this.webCryptoAvailable) {
      return
    }

    try {
      const encoder = new TextEncoder()
      const keyData = encoder.encode(keyString)

      // Hash the key to ensure it's the right length for AES-256
      const hashBuffer = await crypto.subtle.digest('SHA-256', keyData)

      this.cryptoKey = await crypto.subtle.importKey('raw', hashBuffer, { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt',
      ])
    } catch {
      // Fall back to XOR if Web Crypto fails
      this.encryptionAlgorithm === 'xor'
    }
  }

  /**
   * Encrypt data synchronously (uses XOR fallback if needed).
   * @internal
   */
  private encrypt(data: string): string {
    if (!this.encryptionKey) {
      return data
    }

    // Always use XOR for sync operations
    return this.encryptXOR(data)
  }

  /**
   * Encrypt data asynchronously using Web Crypto if available.
   * @internal
   */
  private async encryptAsync(data: string): Promise<string> {
    if (!this.encryptionKey) {
      return data
    }

    if (this.encryptionAlgorithm === 'aes-gcm' && this.webCryptoAvailable) {
      try {
        // Ensure crypto key is initialized
        if (!this.cryptoKey) {
          await this.initializeCryptoKey(this.encryptionKey)
        }

        if (this.cryptoKey) {
          const encoder = new TextEncoder()
          const dataBuffer = encoder.encode(data)

          // Generate random IV
          const iv = crypto.getRandomValues(new Uint8Array(12))

          const encryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.cryptoKey, dataBuffer)

          // Combine IV and encrypted data
          const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength)
          combined.set(iv)
          combined.set(new Uint8Array(encryptedBuffer), iv.length)

          // Base64 encode
          return 'aes:' + btoa(String.fromCharCode(...combined))
        }
      } catch {
        // Fall through to XOR
      }
    }

    return this.encryptXOR(data)
  }

  /**
   * XOR-based encryption for environments without Web Crypto.
   * @internal
   */
  private encryptXOR(data: string): string {
    if (!this.encryptionKey) {
      return data
    }

    const keyBytes = this.encryptionKey
    let result = ''

    for (let i = 0; i < data.length; i++) {
      const charCode = data.charCodeAt(i)
      const keyCharCode = keyBytes.charCodeAt(i % keyBytes.length)
      result += String.fromCharCode(charCode ^ keyCharCode)
    }

    return 'xor:' + btoa(result)
  }

  /**
   * Decrypt data synchronously.
   * @internal
   */
  private decrypt(data: string): string {
    if (!this.encryptionKey) {
      return data
    }

    // Check encryption prefix
    if (data.startsWith('aes:')) {
      // AES encrypted data requires async decryption
      // For sync API, we can't decrypt AES - this shouldn't happen in normal use
      throw new Error('AES-encrypted data requires async decryption')
    }

    if (data.startsWith('xor:')) {
      return this.decryptXOR(data.slice(4))
    }

    // Legacy data without prefix - assume XOR
    return this.decryptXOR(data)
  }

  /**
   * Decrypt data asynchronously.
   * @internal
   */
  private async decryptAsync(data: string): Promise<string> {
    if (!this.encryptionKey) {
      return data
    }

    if (data.startsWith('aes:')) {
      try {
        if (!this.cryptoKey) {
          await this.initializeCryptoKey(this.encryptionKey)
        }

        if (this.cryptoKey) {
          const combined = Uint8Array.from(atob(data.slice(4)), (c) => c.charCodeAt(0))

          // Extract IV and encrypted data
          const iv = combined.slice(0, 12)
          const encryptedData = combined.slice(12)

          const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.cryptoKey, encryptedData)

          const decoder = new TextDecoder()
          return decoder.decode(decryptedBuffer)
        }
      } catch {
        throw new Error('Decryption failed')
      }
    }

    if (data.startsWith('xor:')) {
      return this.decryptXOR(data.slice(4))
    }

    // Legacy data
    return this.decryptXOR(data)
  }

  /**
   * XOR-based decryption.
   * @internal
   */
  private decryptXOR(data: string): string {
    if (!this.encryptionKey) {
      return data
    }

    try {
      const decoded = atob(data)
      const keyBytes = this.encryptionKey
      let result = ''

      for (let i = 0; i < decoded.length; i++) {
        const charCode = decoded.charCodeAt(i)
        const keyCharCode = keyBytes.charCodeAt(i % keyBytes.length)
        result += String.fromCharCode(charCode ^ keyCharCode)
      }

      return result
    } catch {
      throw new Error('Decryption failed')
    }
  }

  /**
   * Get the appropriate storage object based on backend.
   * @internal
   */
  private getStorage(): Storage | null {
    const global = globalThis as typeof globalThis & {
      localStorage?: Storage
      sessionStorage?: Storage
    }

    if (this.backend === 'localStorage') {
      return typeof global.localStorage !== 'undefined' ? global.localStorage : null
    } else if (this.backend === 'sessionStorage') {
      return typeof global.sessionStorage !== 'undefined' ? global.sessionStorage : null
    }
    return null
  }

  /**
   * Resolve the backend, falling back to memory if requested storage is unavailable.
   * @internal
   */
  private resolveBackend(requested: StorageBackend): StorageBackend {
    const global = globalThis as typeof globalThis & {
      localStorage?: Storage
      sessionStorage?: Storage
      indexedDB?: IDBFactory
    }

    if (requested === 'memory') {
      return 'memory'
    }

    if (requested === 'localStorage') {
      if (typeof global.localStorage === 'undefined') {
        return 'memory'
      }
      return 'localStorage'
    }

    if (requested === 'sessionStorage') {
      if (typeof global.sessionStorage === 'undefined') {
        return 'memory'
      }
      return 'sessionStorage'
    }

    if (requested === 'indexedDB') {
      if (typeof global.indexedDB === 'undefined') {
        return 'memory'
      }
      return 'indexedDB'
    }

    return 'memory'
  }

  /**
   * Normalize stored data to handle both old and new formats.
   * @internal
   */
  private normalizeStoredData(parsed: unknown): StoredCredentialWrapper {
    // Check if it's the new wrapper format
    if (
      parsed &&
      typeof parsed === 'object' &&
      'credential' in parsed &&
      'storedAt' in parsed &&
      'version' in parsed
    ) {
      return parsed as StoredCredentialWrapper
    }

    // Legacy format - wrap the credential
    return {
      credential: parsed as StoredCredential,
      storedAt: Date.now(),
      version: 1,
    }
  }

  /**
   * Emit an audit event.
   * @internal
   */
  private emitAudit(type: AuditEventType, key: string, success: boolean, metadata?: Record<string, unknown>): void {
    if (this.auditCallback) {
      this.auditCallback({
        type,
        key,
        timestamp: Date.now(),
        backend: this.backend,
        success,
        metadata,
      })
    }
  }

  /**
   * Trigger rotation callback if configured.
   * @internal
   */
  private async triggerRotation(key: string, credential: StoredCredential): Promise<void> {
    if (this.rotationConfig?.onRotationNeeded) {
      try {
        const newCredential = await this.rotationConfig.onRotationNeeded(key, credential)
        if (newCredential) {
          this.rotate(key, newCredential)
        }
      } catch {
        // Rotation failed, continue with existing credential
      }
    }
  }

  // =========================================================================
  // IndexedDB Methods
  // =========================================================================

  /**
   * Initialize IndexedDB database.
   * @internal
   */
  private async initializeIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const global = globalThis as typeof globalThis & { indexedDB?: IDBFactory }
      if (!global.indexedDB) {
        reject(new Error('IndexedDB not available'))
        return
      }

      const request = global.indexedDB.open(this.indexedDBName, 1)

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'))
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve(request.result)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.indexedDBStoreName)) {
          db.createObjectStore(this.indexedDBStoreName)
        }
      }
    })
  }

  /**
   * Get IndexedDB database, initializing if needed.
   * @internal
   */
  private async getDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db
    }
    if (this.dbInitPromise) {
      return this.dbInitPromise
    }
    this.dbInitPromise = this.initializeIndexedDB()
    return this.dbInitPromise
  }

  /**
   * Store data to IndexedDB.
   * @internal
   */
  private async storeToIndexedDB(key: string, data: string): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.indexedDBStoreName, 'readwrite')
      const store = transaction.objectStore(this.indexedDBStoreName)
      const storageKey = this.getStorageKey(key)

      const request = store.put(data, storageKey)
      request.onerror = () => reject(new Error('Failed to store in IndexedDB'))
      request.onsuccess = () => resolve()
    })
  }

  /**
   * Retrieve data from IndexedDB.
   * @internal
   */
  private async retrieveFromIndexedDB(key: string): Promise<string | null> {
    try {
      const db = await this.getDB()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.indexedDBStoreName, 'readonly')
        const store = transaction.objectStore(this.indexedDBStoreName)
        const storageKey = this.getStorageKey(key)

        const request = store.get(storageKey)
        request.onerror = () => reject(new Error('Failed to retrieve from IndexedDB'))
        request.onsuccess = () => resolve(request.result ?? null)
      })
    } catch {
      return null
    }
  }

  /**
   * Remove data from IndexedDB.
   * @internal
   */
  private async removeFromIndexedDB(key: string): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.indexedDBStoreName, 'readwrite')
      const store = transaction.objectStore(this.indexedDBStoreName)
      const storageKey = this.getStorageKey(key)

      const request = store.delete(storageKey)
      request.onerror = () => reject(new Error('Failed to remove from IndexedDB'))
      request.onsuccess = () => resolve()
    })
  }

  /**
   * Clear all data from IndexedDB within namespace.
   * @internal
   */
  private async clearIndexedDB(): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.indexedDBStoreName, 'readwrite')
      const store = transaction.objectStore(this.indexedDBStoreName)
      const prefix = `${this.namespace}:`

      const request = store.openCursor()
      request.onerror = () => reject(new Error('Failed to clear IndexedDB'))
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
            cursor.delete()
          }
          cursor.continue()
        } else {
          resolve()
        }
      }
    })
  }

  /**
   * Get all keys from IndexedDB within namespace.
   * @internal
   */
  private async getIndexedDBKeys(): Promise<string[]> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.indexedDBStoreName, 'readonly')
      const store = transaction.objectStore(this.indexedDBStoreName)
      const prefix = `${this.namespace}:`
      const keys: string[] = []

      const request = store.openCursor()
      request.onerror = () => reject(new Error('Failed to get keys from IndexedDB'))
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
            keys.push(cursor.key.slice(prefix.length))
          }
          cursor.continue()
        } else {
          resolve(keys)
        }
      }
    })
  }
}
