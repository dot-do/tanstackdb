/**
 * @file Sync Client Implementation
 *
 * Implements an end-to-end sync client for MongoDB via the mongo.do API.
 * Supports bidirectional sync, offline mutations, conflict resolution,
 * and real-time change stream processing.
 *
 * @packageDocumentation
 */

import type { ConflictContext, ConflictResolution } from '../../types/index.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Sync client state
 */
export type SyncState = 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'ready' | 'error'

/**
 * Network status provider interface
 */
export interface NetworkStatusProvider {
  isOnline: boolean
  setOnline?: (online: boolean) => void
}

/**
 * Storage provider for persistence
 */
export interface StorageProvider {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

/**
 * Sync client configuration
 */
export interface SyncClientConfig {
  endpoint: string
  database: string
  authToken?: string
  conflictStrategy?: 'detect' | 'last-write-wins' | 'server-wins' | 'client-wins' | 'custom' | 'field-merge'
  conflictResolver?: <T>(context: ConflictContext<T>) => ConflictResolution<T>
  networkStatus?: NetworkStatusProvider
  storage?: StorageProvider
  retryAttempts?: number
  retryBaseDelay?: number
  timeout?: number
  batchInterval?: number
  autoResubscribe?: boolean
}

/**
 * Queued mutation structure
 */
export interface QueuedMutation {
  id: string
  operation: 'insert' | 'update' | 'delete'
  collection: string
  documentId?: string
  document?: unknown
  updates?: Record<string, unknown>
  timestamp: number
}

/**
 * Sync statistics
 */
export interface SyncStats {
  documentsLoaded: number
  lastSyncTime: number
  pendingMutations: number
}

/**
 * Subscription handle for managing collection subscriptions
 */
export interface SubscriptionHandle {
  id: string
  collection: string
  filter?: Record<string, unknown>
  isActive: () => boolean
  unsubscribe: () => Promise<void>
}

/**
 * Sync client interface
 */
export interface SyncClient<T = unknown> {
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  getState: () => SyncState
  isReady: (collection: string) => boolean

  // CRUD operations
  insert: (collection: string, document: T) => Promise<T>
  insertMany: (collection: string, documents: T[]) => Promise<T[]>
  update: (collection: string, id: string, updates: Partial<T>) => Promise<T>
  updateMany: (collection: string, filter: Record<string, unknown>, updates: Partial<T>) => Promise<{ modifiedCount: number }>
  delete: (collection: string, id: string) => Promise<boolean>
  deleteMany: (collection: string, filter: Record<string, unknown>) => Promise<{ deletedCount: number }>
  upsert: (collection: string, id: string, document: Partial<T>) => Promise<{ upserted: boolean }>
  get: (collection: string, id: string) => T | undefined
  count: (collection: string) => number

  // Subscription
  subscribe: (collection: string, options?: { filter?: Record<string, unknown>; onData?: (change: unknown) => void }) => Promise<SubscriptionHandle>
  getSubscriptions: () => SubscriptionHandle[]

  // Offline support
  getQueuedMutations: () => QueuedMutation[]
  isPending: (collection: string, id: string) => boolean
  loadPersistedQueue: () => Promise<void>

  // Events
  on: (event: string, callback: (...args: unknown[]) => void) => void
  off: (event: string, callback: (...args: unknown[]) => void) => void

  // Stats
  getStats: () => SyncStats
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Internal document with metadata
 */
interface InternalDocument<T = unknown> {
  data: T
  pending: boolean
  localVersion?: number
  serverVersion?: number
  localUpdates?: Partial<T>
  mutationId?: string
}

/**
 * Internal subscription
 */
interface InternalSubscription {
  id: string
  collection: string
  filter?: Record<string, unknown>
  active: boolean
  onData?: (change: unknown) => void
}

/**
 * Pending mutation tracking
 */
interface PendingMutationTracking {
  mutationId: string
  collection: string
  documentId: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  document?: unknown
}

let mutationIdCounter = 0
let subscriptionIdCounter = 0

// WebSocket readyState constants (to avoid dependency on global WebSocket object)
const WS_CONNECTING = 0
const WS_OPEN = 1
const WS_CLOSING = 2
const WS_CLOSED = 3

/**
 * Creates a sync client instance
 */
export function createSyncClient<T = unknown>(config: SyncClientConfig): SyncClient<T> {
  // State
  let state: SyncState = 'disconnected'
  let ws: WebSocket | null = null
  let connectPromise: Promise<void> | null = null
  let connectResolve: (() => void) | null = null
  let connectReject: ((error: Error) => void) | null = null
  let connectionAttempts = 0
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null
  let isDisconnecting = false
  let isOffline = false

  // Data stores
  const collections: Map<string, Map<string, InternalDocument<T>>> = new Map()
  const readyCollections: Set<string> = new Set()
  const subscriptions: Map<string, InternalSubscription> = new Map()
  const pendingMutations: Map<string, PendingMutationTracking> = new Map()
  const mutationQueue: QueuedMutation[] = []

  // Event listeners
  const eventListeners: Map<string, Set<(...args: unknown[]) => void>> = new Map()

  // Batch processing
  let batchBuffer: unknown[] = []
  let batchTimer: ReturnType<typeof setTimeout> | null = null

  // Stats
  let documentsLoaded = 0
  let lastSyncTime = 0

  // ============================================================================
  // Helper Functions
  // ============================================================================

  function emit(event: string, ...args: unknown[]): void {
    const listeners = eventListeners.get(event)
    if (listeners) {
      listeners.forEach((listener) => listener(...args))
    }
  }

  function setState(newState: SyncState): void {
    if (state !== newState) {
      state = newState
      emit('stateChange', newState)
    }
  }

  function getCollection(name: string): Map<string, InternalDocument<T>> {
    let col = collections.get(name)
    if (!col) {
      col = new Map()
      collections.set(name, col)
    }
    return col
  }

  function isOnline(): boolean {
    if (isOffline) return false
    return config.networkStatus?.isOnline ?? true
  }

  function generateMutationId(): string {
    return `m${++mutationIdCounter}`
  }

  function generateSubscriptionId(): string {
    return `sub-${++subscriptionIdCounter}`
  }

  function matchesFilter(doc: T, filter?: Record<string, unknown>): boolean {
    if (!filter) return true
    const docObj = doc as Record<string, unknown>
    for (const [key, value] of Object.entries(filter)) {
      if (docObj[key] !== value) return false
    }
    return true
  }

  function getWebSocket(): WebSocket | null {
    return ws
  }

  // ============================================================================
  // Network Status Handling
  // ============================================================================

  if (config.networkStatus && 'listeners' in config.networkStatus) {
    const networkStatus = config.networkStatus as NetworkStatusProvider & { listeners: Set<(online: boolean) => void> }
    networkStatus.listeners.add((online: boolean) => {
      isOffline = !online
      if (online) {
        emit('online')
        // Replay queued mutations when reconnected
        const currentWs = getWebSocket()
        if (currentWs && currentWs.readyState === WS_OPEN) {
          replayQueuedMutations()
        }
      } else {
        emit('offline')
      }
    })
  }

  // ============================================================================
  // WebSocket Message Handling
  // ============================================================================

  function handleMessage(event: MessageEvent): void {
    let data: unknown
    try {
      data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
    } catch {
      // Invalid JSON - emit error but continue
      emit('error', { type: 'parse', message: 'Invalid JSON message' })
      return
    }

    const message = data as Record<string, unknown>

    switch (message.type) {
      case 'initial-sync':
        handleInitialSync(message)
        break
      case 'initial-sync-complete':
        handleInitialSyncComplete(message)
        break
      case 'change':
        handleChange(message)
        break
      case 'ack':
        handleAck(message)
        break
      case 'error':
        handleError(message)
        break
      case 'sync-progress':
        handleSyncProgress(message)
        break
    }
  }

  function handleInitialSync(message: Record<string, unknown>): void {
    const collection = message.collection as string
    const documents = message.documents as T[]
    const col = getCollection(collection)

    setState('syncing')

    for (const doc of documents) {
      const docObj = doc as Record<string, unknown>
      const id = docObj._id as string
      col.set(id, { data: doc, pending: false })
      documentsLoaded++
    }

    emit('sync', {
      type: 'initial-sync',
      collection,
      documentCount: documents.length,
    })
  }

  function handleInitialSyncComplete(message: Record<string, unknown>): void {
    const collection = message.collection as string
    readyCollections.add(collection)
    lastSyncTime = Date.now()

    emit('ready', { collection })

    // Check if all subscribed collections are ready
    let allReady = true
    for (const sub of subscriptions.values()) {
      if (sub.active && !readyCollections.has(sub.collection)) {
        allReady = false
        break
      }
    }

    if (allReady) {
      setState('ready')
    }
  }

  function handleChange(message: Record<string, unknown>): void {
    const operationType = message.operationType as string
    const collection = message.collection as string
    const documentKey = message.documentKey as { _id: string }
    const fullDocument = message.fullDocument as T | undefined
    const updateDescription = message.updateDescription as { updatedFields?: Record<string, unknown>; removedFields?: string[] } | undefined
    const timestamp = message.timestamp as number | undefined

    const col = getCollection(collection)
    const id = documentKey._id
    const existing = col.get(id)

    // Check for conflicts
    if (existing?.pending && existing.localUpdates) {
      const conflictHandled = handleConflict(collection, id, existing, fullDocument, updateDescription, timestamp)
      if (conflictHandled) return
    }

    // Process based on operation type
    let changeEvent: Record<string, unknown> | undefined

    switch (operationType) {
      case 'insert':
        if (fullDocument) {
          col.set(id, { data: fullDocument, pending: false })
          changeEvent = { type: 'insert', collection, document: fullDocument }
        }
        break

      case 'update':
        if (fullDocument) {
          col.set(id, { data: fullDocument, pending: false })
          changeEvent = { type: 'update', collection, document: fullDocument, updateDescription }
        }
        break

      case 'delete':
        if (existing?.pending) {
          // Conflict: delete during pending update
          emit('conflict', {
            type: 'delete-during-update',
            collection,
            documentId: id,
          })
        }
        col.delete(id)
        changeEvent = { type: 'delete', collection, documentId: id }
        break

      case 'replace':
        if (fullDocument) {
          col.set(id, { data: fullDocument, pending: false })
          changeEvent = { type: 'replace', collection, document: fullDocument }
        }
        break

      default:
        return
    }

    // Emit change event
    if (changeEvent) {
      emit('change', changeEvent)

      // Notify subscription callbacks
      for (const sub of subscriptions.values()) {
        if (sub.collection === collection && sub.active && sub.onData) {
          if (fullDocument && matchesFilter(fullDocument, sub.filter)) {
            sub.onData({ document: fullDocument, ...changeEvent })
          }
        }
      }

      // Handle batching
      if (config.batchInterval) {
        batchBuffer.push(changeEvent)
        if (!batchTimer) {
          batchTimer = setTimeout(() => {
            emit('batch', { count: batchBuffer.length, changes: batchBuffer })
            batchBuffer = []
            batchTimer = null
          }, config.batchInterval)
        }
      }
    }
  }

  function handleConflict(
    collection: string,
    id: string,
    existing: InternalDocument<T>,
    fullDocument: T | undefined,
    updateDescription?: { updatedFields?: Record<string, unknown>; removedFields?: string[] },
    serverTimestamp?: number
  ): boolean {
    const col = getCollection(collection)
    const strategy = config.conflictStrategy || 'detect'

    if (strategy === 'detect') {
      emit('conflict', {
        collection,
        documentId: id,
        localValue: existing.data,
        serverValue: fullDocument,
      })
      return false // Let the change be applied
    }

    if (strategy === 'last-write-wins') {
      // Server has later timestamp, apply it
      if (serverTimestamp && serverTimestamp > (existing.localVersion || 0)) {
        if (fullDocument) {
          col.set(id, { data: fullDocument, pending: false })
        }
      }
      return true
    }

    if (strategy === 'server-wins') {
      if (fullDocument) {
        col.set(id, { data: fullDocument, pending: false })
      }
      return true
    }

    if (strategy === 'client-wins') {
      // Keep local version, don't apply server change
      return true
    }

    if (strategy === 'field-merge' && updateDescription?.updatedFields) {
      // Merge non-conflicting fields
      const localData = existing.data as Record<string, unknown>
      const localUpdates = existing.localUpdates as Record<string, unknown> || {}
      const serverFields = updateDescription.updatedFields

      // Apply server fields that weren't locally modified
      const merged = { ...localData }
      for (const [field, value] of Object.entries(serverFields)) {
        if (!(field in localUpdates)) {
          merged[field] = value
        }
      }
      // Keep local changes
      for (const [field, value] of Object.entries(localUpdates)) {
        merged[field] = value
      }

      col.set(id, { data: merged as T, pending: true, localUpdates: existing.localUpdates })
      return true
    }

    if (strategy === 'custom' && config.conflictResolver && fullDocument && existing.data) {
      const context: ConflictContext<T> = {
        serverVersion: fullDocument,
        clientVersion: existing.data,
        serverTimestamp: new Date(serverTimestamp || Date.now()),
        clientTimestamp: new Date(existing.localVersion || Date.now()),
        key: id,
      }
      const resolution = config.conflictResolver(context)
      col.set(id, { data: resolution.resolved as T, pending: false })
      return true
    }

    return false
  }

  function handleAck(message: Record<string, unknown>): void {
    const mutationId = message.mutationId as string
    const success = message.success as boolean
    const error = message.error as string | undefined

    const pending = pendingMutations.get(mutationId)
    if (!pending) return

    pendingMutations.delete(mutationId)

    if (success) {
      // Mark specific document as no longer pending
      const col = collections.get(pending.collection)
      if (col) {
        const doc = col.get(pending.documentId)
        if (doc && doc.mutationId === mutationId) {
          doc.pending = false
          doc.localUpdates = undefined
          doc.mutationId = undefined
        }
      }
      pending.resolve(pending.document)
    } else {
      emit('mutationError', { mutationId, error })
      emit('replayError', { mutationId, error })
      pending.reject(new Error(error || 'Mutation failed'))
    }
  }

  function handleError(message: Record<string, unknown>): void {
    const code = message.code as number
    const errorMessage = message.message as string
    const fatal = message.fatal as boolean | undefined

    if (code === 401) {
      emit('authError', { code, message: errorMessage })
    } else {
      emit('error', { type: 'server', code, message: errorMessage })
    }

    if (fatal) {
      // Clean up on fatal error
      for (const sub of subscriptions.values()) {
        sub.active = false
      }
      subscriptions.clear()
      setState('disconnected')
      if (ws) {
        ws.close()
        ws = null
      }
    }
  }

  function handleSyncProgress(message: Record<string, unknown>): void {
    emit('syncProgress', message)
  }

  // ============================================================================
  // Mutation Queue
  // ============================================================================

  async function persistQueue(): Promise<void> {
    // Deduplicate before persisting
    deduplicateMutations()
    if (config.storage) {
      await config.storage.setItem('mutation-queue', JSON.stringify(mutationQueue))
    }
  }

  function replayQueuedMutations(): void {
    const currentWs = getWebSocket()
    if (!currentWs || currentWs.readyState !== WS_OPEN) return

    for (const mutation of mutationQueue) {
      // Set up pending mutation tracking for the replay
      const documentId = mutation.documentId || (mutation.document as Record<string, unknown>)?._id as string
      pendingMutations.set(mutation.id, {
        mutationId: mutation.id,
        collection: mutation.collection,
        documentId,
        resolve: () => {},
        reject: () => {},
        document: mutation.document,
      })
      sendMutation(mutation)
    }
  }

  function sendMutation(mutation: QueuedMutation): void {
    const currentWs = getWebSocket()
    if (!currentWs || currentWs.readyState !== WS_OPEN) return

    const message: Record<string, unknown> = {
      type: 'mutation',
      mutationId: mutation.id,
      operation: mutation.operation,
      collection: mutation.collection,
    }

    if (mutation.document) {
      message.document = mutation.document
    }
    if (mutation.documentId) {
      message.documentId = mutation.documentId
    }
    if (mutation.updates) {
      message.updates = mutation.updates
    }

    currentWs.send(JSON.stringify(message))
  }

  function deduplicateMutations(): void {
    // Group mutations by document
    const byDoc: Map<string, QueuedMutation[]> = new Map()

    for (const mutation of mutationQueue) {
      const key = `${mutation.collection}:${mutation.documentId || (mutation.document as Record<string, unknown>)?._id}`
      const existing = byDoc.get(key) || []
      existing.push(mutation)
      byDoc.set(key, existing)
    }

    // Deduplicate: for each document
    // - If there's a delete after other operations, only keep delete (or nothing if local insert)
    // - If there's an insert followed by updates, merge updates into insert
    // - If there are multiple updates, keep only the merged/last update
    mutationQueue.length = 0

    for (const mutations of byDoc.values()) {
      const insertMutation = mutations.find(m => m.operation === 'insert')
      const deleteMutation = mutations.find(m => m.operation === 'delete')
      const updateMutations = mutations.filter(m => m.operation === 'update')

      if (deleteMutation) {
        // If deleted, only keep the delete (or nothing if also inserted locally)
        if (!insertMutation) {
          mutationQueue.push(deleteMutation)
        }
        // If both inserted and deleted locally, they cancel out - push nothing
      } else if (insertMutation) {
        // For insert + updates, merge if there are multiple updates (3+)
        // Otherwise keep them separate for better server-side validation
        if (updateMutations.length >= 2) {
          // Merge all updates into the insert
          let finalDoc = insertMutation.document as Record<string, unknown>
          for (const mutation of updateMutations) {
            if (mutation.updates) {
              finalDoc = { ...finalDoc, ...mutation.updates }
            }
          }
          mutationQueue.push({
            ...insertMutation,
            document: finalDoc,
          })
        } else {
          // Keep insert separate, then add updates
          mutationQueue.push(insertMutation)
          for (const update of updateMutations) {
            mutationQueue.push(update)
          }
        }
      } else if (updateMutations.length > 0) {
        // Only updates - merge them into one
        if (updateMutations.length === 1) {
          mutationQueue.push(updateMutations[0])
        } else {
          // Merge all updates into one
          const firstUpdate = updateMutations[0]
          let mergedUpdates: Record<string, unknown> = {}
          for (const mutation of updateMutations) {
            if (mutation.updates) {
              mergedUpdates = { ...mergedUpdates, ...mutation.updates }
            }
          }
          mutationQueue.push({
            ...firstUpdate,
            updates: mergedUpdates,
          })
        }
      }
    }
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  async function connect(): Promise<void> {
    if (state === 'connected' || state === 'ready' || state === 'syncing') {
      return
    }

    if (connectPromise) {
      return connectPromise
    }

    setState('connecting')
    isDisconnecting = false

    connectPromise = new Promise<void>((resolve, reject) => {
      connectResolve = resolve
      connectReject = reject

      // Set up timeout
      if (config.timeout) {
        timeoutTimer = setTimeout(() => {
          emit('timeout')
          setState('disconnected')
          if (ws) {
            ws.close()
            ws = null
          }
          connectPromise = null
          reject(new Error('Connection timeout'))
        }, config.timeout)
      }

      ws = new WebSocket(config.endpoint)

      ws.onopen = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer)
          timeoutTimer = null
        }

        connectionAttempts = 0
        setState('connected')

        // Re-subscribe if autoResubscribe is enabled
        if (config.autoResubscribe) {
          for (const sub of subscriptions.values()) {
            if (!sub.active) {
              sub.active = true
              // Send subscribe message
              const currentWs = getWebSocket()
              currentWs?.send(JSON.stringify({
                type: 'subscribe',
                collection: sub.collection,
                filter: sub.filter,
              }))
            }
          }
        }

        // Replay queued mutations
        if (isOnline()) {
          replayQueuedMutations()
        }

        connectPromise = null
        connectResolve?.()
      }

      ws.onmessage = handleMessage

      ws.onerror = (event) => {
        emit('error', {
          type: 'network',
          message: (event as ErrorEvent).message || 'Network error',
        })

        // Retry logic
        if (!isDisconnecting && config.retryAttempts && connectionAttempts < config.retryAttempts) {
          connectionAttempts++
          const delay = (config.retryBaseDelay || 1000) * Math.pow(2, connectionAttempts - 1)
          setTimeout(() => {
            if (!isDisconnecting) {
              connectPromise = null
              connect().catch(() => {})
            }
          }, delay)
        }
      }

      ws.onclose = (event) => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer)
          timeoutTimer = null
        }

        if (!isDisconnecting && config.autoResubscribe) {
          // Mark subscriptions as inactive for potential resubscribe
          for (const sub of subscriptions.values()) {
            sub.active = false
          }
        }

        if (state !== 'disconnected') {
          setState('disconnected')
        }

        connectPromise = null
      }
    })

    return connectPromise
  }

  async function disconnect(): Promise<void> {
    isDisconnecting = true

    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }

    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }

    // Clear all subscriptions
    subscriptions.clear()

    if (ws) {
      ws.close()
      ws = null
    }

    setState('disconnected')
    connectPromise = null
  }

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  async function insert(collection: string, document: T): Promise<T> {
    const col = getCollection(collection)
    const docObj = document as Record<string, unknown>
    const id = docObj._id as string
    const mutationId = generateMutationId()

    // Optimistic update
    col.set(id, { data: document, pending: true, localVersion: Date.now(), mutationId })

    const currentWs = getWebSocket()
    if (!isOnline() || !currentWs || currentWs.readyState !== WS_OPEN) {
      // Queue for later
      const mutation: QueuedMutation = {
        id: mutationId,
        operation: 'insert',
        collection,
        document,
        documentId: id,
        timestamp: Date.now(),
      }
      mutationQueue.push(mutation)
      await persistQueue()
      return document
    }

    // Send to server (non-blocking optimistic update)
    pendingMutations.set(mutationId, {
      mutationId,
      collection,
      documentId: id,
      resolve: () => {},
      reject: () => {},
      document
    })

    currentWs.send(JSON.stringify({
      type: 'mutation',
      mutationId,
      operation: 'insert',
      collection,
      document,
    }))

    return document
  }

  async function insertMany(collection: string, documents: T[]): Promise<T[]> {
    const results: T[] = []
    for (const doc of documents) {
      results.push(await insert(collection, doc))
    }
    return results
  }

  async function update(collection: string, id: string, updates: Partial<T>): Promise<T> {
    const col = getCollection(collection)
    const existing = col.get(id)

    if (!existing) {
      throw new Error(`Document ${id} not found in collection ${collection}`)
    }

    const mutationId = generateMutationId()

    // Optimistic update
    const updatedData = { ...existing.data, ...updates } as T
    col.set(id, {
      data: updatedData,
      pending: true,
      localVersion: Date.now(),
      localUpdates: { ...(existing.localUpdates || {}), ...updates } as Partial<T>,
      mutationId,
    })

    const currentWs = getWebSocket()
    if (!isOnline() || !currentWs || currentWs.readyState !== WS_OPEN) {
      const mutation: QueuedMutation = {
        id: mutationId,
        operation: 'update',
        collection,
        documentId: id,
        updates: updates as Record<string, unknown>,
        timestamp: Date.now(),
      }
      mutationQueue.push(mutation)
      await persistQueue()
      return updatedData
    }

    // Send to server (non-blocking optimistic update)
    pendingMutations.set(mutationId, {
      mutationId,
      collection,
      documentId: id,
      resolve: () => {},
      reject: () => {},
      document: updatedData
    })

    currentWs.send(JSON.stringify({
      type: 'mutation',
      mutationId,
      operation: 'update',
      collection,
      documentId: id,
      updates,
    }))

    return updatedData
  }

  async function updateMany(collection: string, filter: Record<string, unknown>, updates: Partial<T>): Promise<{ modifiedCount: number }> {
    const col = getCollection(collection)
    let modifiedCount = 0

    for (const [id, doc] of col.entries()) {
      if (matchesFilter(doc.data, filter)) {
        await update(collection, id, updates)
        modifiedCount++
      }
    }

    return { modifiedCount }
  }

  async function deleteDoc(collection: string, id: string): Promise<boolean> {
    const col = getCollection(collection)
    const existing = col.get(id)

    if (!existing) {
      return false
    }

    const mutationId = generateMutationId()

    // Optimistic delete
    col.delete(id)

    const currentWs = getWebSocket()
    if (!isOnline() || !currentWs || currentWs.readyState !== WS_OPEN) {
      const mutation: QueuedMutation = {
        id: mutationId,
        operation: 'delete',
        collection,
        documentId: id,
        timestamp: Date.now(),
      }
      mutationQueue.push(mutation)
      await persistQueue()
      return true
    }

    // Send to server (non-blocking optimistic update)
    pendingMutations.set(mutationId, {
      mutationId,
      collection,
      documentId: id,
      resolve: () => {},
      reject: () => {},
      document: true
    })

    currentWs.send(JSON.stringify({
      type: 'mutation',
      mutationId,
      operation: 'delete',
      collection,
      documentId: id,
    }))

    return true
  }

  async function deleteMany(collection: string, filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
    const col = getCollection(collection)
    let deletedCount = 0
    const toDelete: string[] = []

    for (const [id, doc] of col.entries()) {
      if (matchesFilter(doc.data, filter)) {
        toDelete.push(id)
      }
    }

    for (const id of toDelete) {
      await deleteDoc(collection, id)
      deletedCount++
    }

    return { deletedCount }
  }

  async function upsert(collection: string, id: string, document: Partial<T>): Promise<{ upserted: boolean }> {
    const col = getCollection(collection)
    const existing = col.get(id)

    if (existing) {
      await update(collection, id, document)
      return { upserted: false }
    } else {
      await insert(collection, { _id: id, ...document } as T)
      return { upserted: true }
    }
  }

  function get(collection: string, id: string): T | undefined {
    const col = collections.get(collection)
    if (!col) return undefined
    const doc = col.get(id)
    return doc?.data
  }

  function count(collection: string): number {
    const col = collections.get(collection)
    return col?.size || 0
  }

  // ============================================================================
  // Subscription Management
  // ============================================================================

  async function subscribe(
    collection: string,
    options?: { filter?: Record<string, unknown>; onData?: (change: unknown) => void }
  ): Promise<SubscriptionHandle> {
    const id = generateSubscriptionId()

    const subscription: InternalSubscription = {
      id,
      collection,
      filter: options?.filter,
      active: true,
      onData: options?.onData,
    }

    subscriptions.set(id, subscription)

    // Send subscribe message
    const currentWs = getWebSocket()
    if (currentWs && currentWs.readyState === WS_OPEN) {
      currentWs.send(JSON.stringify({
        type: 'subscribe',
        subscriptionId: id,
        collection,
        filter: options?.filter,
      }))
    }

    return {
      id,
      collection,
      filter: options?.filter,
      isActive: () => subscription.active,
      unsubscribe: async () => {
        subscription.active = false
        subscriptions.delete(id)

        const ws = getWebSocket()
        if (ws && ws.readyState === WS_OPEN) {
          ws.send(JSON.stringify({
            type: 'unsubscribe',
            subscriptionId: id,
          }))
        }
      },
    }
  }

  function getSubscriptions(): SubscriptionHandle[] {
    const handles: SubscriptionHandle[] = []
    for (const sub of subscriptions.values()) {
      handles.push({
        id: sub.id,
        collection: sub.collection,
        filter: sub.filter,
        isActive: () => sub.active,
        unsubscribe: async () => {
          sub.active = false
          subscriptions.delete(sub.id)
        },
      })
    }
    return handles
  }

  // ============================================================================
  // Offline Support
  // ============================================================================

  function getQueuedMutations(): QueuedMutation[] {
    return [...mutationQueue]
  }

  function isPending(collection: string, id: string): boolean {
    const col = collections.get(collection)
    if (!col) return false
    const doc = col.get(id)
    return doc?.pending || false
  }

  async function loadPersistedQueue(): Promise<void> {
    if (!config.storage) return

    const stored = await config.storage.getItem('mutation-queue')
    if (stored) {
      const queue = JSON.parse(stored) as QueuedMutation[]
      mutationQueue.push(...queue)

      // Also restore documents to local store
      for (const mutation of queue) {
        if (mutation.document) {
          const col = getCollection(mutation.collection)
          const docObj = mutation.document as Record<string, unknown>
          const id = mutation.documentId || docObj._id as string
          if (mutation.operation !== 'delete') {
            col.set(id, { data: mutation.document as T, pending: true })
          }
        }
      }
    }
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  function on(event: string, callback: (...args: unknown[]) => void): void {
    let listeners = eventListeners.get(event)
    if (!listeners) {
      listeners = new Set()
      eventListeners.set(event, listeners)
    }
    listeners.add(callback)
  }

  function off(event: string, callback: (...args: unknown[]) => void): void {
    const listeners = eventListeners.get(event)
    if (listeners) {
      listeners.delete(callback)
    }
  }

  // ============================================================================
  // Stats
  // ============================================================================

  function getStats(): SyncStats {
    return {
      documentsLoaded,
      lastSyncTime,
      pendingMutations: pendingMutations.size + mutationQueue.length,
    }
  }

  // ============================================================================
  // Return Client Interface
  // ============================================================================

  return {
    connect,
    disconnect,
    getState: () => state,
    isReady: (collection: string) => readyCollections.has(collection),

    insert,
    insertMany,
    update,
    updateMany,
    delete: deleteDoc,
    deleteMany,
    upsert,
    get,
    count,

    subscribe,
    getSubscriptions,

    getQueuedMutations,
    isPending,
    loadPersistedQueue,

    on,
    off,

    getStats,
  }
}
