/**
 * @file RPC Module Exports
 *
 * This module exports all RPC-related classes and types for communicating
 * with the mongo.do API endpoint.
 *
 * @example
 * ```typescript
 * import { MongoDoClient, DatabaseReference, CollectionReference } from '@tanstack/mongo-db-collection/rpc'
 *
 * const client = new MongoDoClient('https://api.mongo.do', { token: 'my-token' })
 * await client.connect()
 *
 * const db = client.db('myDatabase')
 * const collection = db.collection('users')
 * ```
 */

// =============================================================================
// Client Exports
// =============================================================================

export {
  MongoDoClient,
  MongoDoError,
  DatabaseReference,
  CollectionReference,
} from './client.js'

export type {
  MongoDoAuthOptions,
  MongoDoClientConfig,
  MongoDoClientEventType,
  MongoDoClientEventHandler,
} from './client.js'

// Client-related types from types.ts
export type {
  ClientPendingRequest,
  ConnectionPoolConfig,
  ConnectionPoolStats,
  MongoDoLogger,
  LogLevel,
  LogEntry,
  MongoDoErrorCode,
  MongoDoErrorOptions,
} from './types.js'

// =============================================================================
// Transport Selector Exports
// =============================================================================

export {
  TransportSelector,
  RoundRobinLoadBalancer,
  LeastConnectionsLoadBalancer,
  LatencyBasedLoadBalancer,
} from './transport-selector.js'

export type {
  TransportType,
  TransportConfig,
  TransportHealth,
  RequestContext,
  TransportPreferences,
  SubscriptionState,
  PendingRequest,
  // Circuit breaker types
  CircuitBreakerState,
  CircuitBreakerConfig,
  CircuitBreakerTransportState,
  // Health check types
  HealthCheckStrategyType,
  HealthCheckConfig,
  HealthCheckStrategy,
  HealthCheckResult,
  // Load balancing types
  LoadBalancingStrategyType,
  LoadBalancingConfig,
  LoadBalancingStrategy,
  // Strategy pattern types
  TransportSelectionStrategy,
  // Event history types
  TransportSwitchEvent,
} from './transport-selector.js'

// =============================================================================
// Batch Executor Exports
// =============================================================================

export { BatchExecutor } from './batch.js'

export type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  BatchExecutorConfig,
  // Batch statistics types
  BatchStatistics,
  // Priority queue types
  RequestPriority,
  CallOptions,
  // Backpressure types
  BackpressureState,
  BackpressureCallback,
  // Compression types
  CompressionAlgorithm,
  CompressionConfig,
  // Batch key function type
  BatchKeyFunction,
} from './types.js'

export { PRIORITY_VALUES } from './types.js'

// =============================================================================
// HTTP Transport Exports
// =============================================================================

export { HttpTransport } from './http-transport.js'

export type {
  HttpTransportOptions,
  SendOptions,
  RequestInterceptor,
  ResponseInterceptor,
  ErrorInterceptor,
  RequestMetrics,
  RequestCompleteCallback,
} from './http-transport.js'

// =============================================================================
// Error Classes
// =============================================================================

export {
  HttpTransportError,
  JsonRpcResponseError,
  HttpStatusError,
  RequestTimeoutError,
  RequestAbortedError,
  NetworkError,
} from './errors.js'

// =============================================================================
// WebSocket Transport Exports
// =============================================================================

export { WebSocketTransport } from './ws-transport.js'

export type {
  TransportState,
  WebSocketTransportOptions,
  RPCMessage,
  RPCResponse,
  RPCError,
  PushMessage,
  TransportStats,
  TransportEventMap,
  BackpressureInfo,
  QueuedMessage,
  Subscription,
} from './ws-transport-types.js'
