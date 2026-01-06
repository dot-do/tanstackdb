/**
 * @file Sync Client Module Exports
 *
 * Exports the sync client implementation and types.
 *
 * @packageDocumentation
 */

export {
  createSyncClient,
  type SyncClient,
  type SyncClientConfig,
  type SyncState,
  type SyncStats,
  type QueuedMutation,
  type SubscriptionHandle,
  type NetworkStatusProvider,
  type StorageProvider,
} from './sync-client.js'
