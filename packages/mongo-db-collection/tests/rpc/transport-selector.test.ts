/**
 * @file Transport Selector Tests (RED Phase - TDD)
 *
 * These tests verify the TransportSelector class/function for @tanstack/mongo-db-collection.
 * The TransportSelector is responsible for intelligently selecting between HTTP and WebSocket
 * transports based on the operation type, configuration, and transport availability.
 *
 * Transport selection criteria:
 * - HTTP: One-off requests, queries without subscriptions
 * - WebSocket: Change streams, subscriptions, real-time updates
 *
 * RED PHASE: These tests will fail until the TransportSelector is implemented in src/rpc/
 *
 * @see https://tanstack.com/db/latest/docs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TransportSelector,
  type TransportType,
  type TransportConfig,
  type TransportHealth,
  type RequestContext,
} from '../../src/rpc/transport-selector'

describe('TransportSelector', () => {
  let selector: TransportSelector

  beforeEach(() => {
    selector = new TransportSelector()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Default Transport Selection', () => {
    it('should default to HTTP for queries', () => {
      const context: RequestContext = {
        operation: 'query',
        hasSubscription: false,
      }

      const transport = selector.selectTransport(context)

      expect(transport).toBe('http')
    })

    it('should default to HTTP for one-off find operations', () => {
      const context: RequestContext = {
        operation: 'find',
        hasSubscription: false,
      }

      const transport = selector.selectTransport(context)

      expect(transport).toBe('http')
    })

    it('should default to HTTP for insert operations', () => {
      const context: RequestContext = {
        operation: 'insert',
        hasSubscription: false,
      }

      const transport = selector.selectTransport(context)

      expect(transport).toBe('http')
    })

    it('should default to HTTP for update operations', () => {
      const context: RequestContext = {
        operation: 'update',
        hasSubscription: false,
      }

      const transport = selector.selectTransport(context)

      expect(transport).toBe('http')
    })

    it('should default to HTTP for delete operations', () => {
      const context: RequestContext = {
        operation: 'delete',
        hasSubscription: false,
      }

      const transport = selector.selectTransport(context)

      expect(transport).toBe('http')
    })
  })

  describe('WebSocket for Change Streams', () => {
    it('should use WebSocket for change streams', () => {
      const context: RequestContext = {
        operation: 'watch',
        hasSubscription: true,
        enableChangeStream: true,
      }

      const transport = selector.selectTransport(context)

      expect(transport).toBe('websocket')
    })

    it('should use WebSocket when enableChangeStream is true', () => {
      const config: TransportConfig = {
        enableChangeStream: true,
      }
      const selectorWithConfig = new TransportSelector(config)

      const context: RequestContext = {
        operation: 'query',
        hasSubscription: false,
      }

      // Even for queries, if change stream is globally enabled, WS should be preferred
      const transport = selectorWithConfig.selectTransport(context)

      expect(transport).toBe('websocket')
    })

    it('should use WebSocket for operations with subscriptions', () => {
      const context: RequestContext = {
        operation: 'find',
        hasSubscription: true,
      }

      const transport = selector.selectTransport(context)

      expect(transport).toBe('websocket')
    })

    it('should use WebSocket for aggregate with $changeStream stage', () => {
      const context: RequestContext = {
        operation: 'aggregate',
        hasSubscription: true,
        pipeline: [{ $changeStream: {} }],
      }

      const transport = selector.selectTransport(context)

      expect(transport).toBe('websocket')
    })
  })

  describe('Fallback to HTTP if WebSocket Unavailable', () => {
    it('should fall back to HTTP if WS fails', async () => {
      const config: TransportConfig = {
        enableChangeStream: true,
        websocketAvailable: false,
      }
      const selectorWithConfig = new TransportSelector(config)

      const context: RequestContext = {
        operation: 'watch',
        hasSubscription: true,
        enableChangeStream: true,
      }

      const transport = selectorWithConfig.selectTransport(context)

      expect(transport).toBe('http')
    })

    it('should fall back to HTTP when WebSocket connection is unhealthy', async () => {
      const config: TransportConfig = {
        enableChangeStream: true,
        websocketAvailable: true,
      }
      const selectorWithConfig = new TransportSelector(config)

      // Simulate unhealthy WebSocket
      selectorWithConfig.setTransportHealth('websocket', {
        healthy: false,
        lastError: new Error('Connection timeout'),
        lastCheck: Date.now(),
      })

      const context: RequestContext = {
        operation: 'watch',
        hasSubscription: true,
      }

      const transport = selectorWithConfig.selectTransport(context)

      expect(transport).toBe('http')
    })

    it('should attempt WebSocket reconnection after fallback', async () => {
      const config: TransportConfig = {
        enableChangeStream: true,
        websocketAvailable: false,
        reconnectInterval: 100,
      }
      const selectorWithConfig = new TransportSelector(config)

      const reconnectSpy = vi.spyOn(selectorWithConfig, 'attemptReconnect')

      // Request that would prefer WebSocket
      const context: RequestContext = {
        operation: 'watch',
        hasSubscription: true,
      }

      selectorWithConfig.selectTransport(context)

      // Wait for reconnect attempt
      await new Promise((resolve) => setTimeout(resolve, 150))

      expect(reconnectSpy).toHaveBeenCalledWith('websocket')
    })

    it('should emit event when falling back from WebSocket to HTTP', () => {
      const config: TransportConfig = {
        enableChangeStream: true,
        websocketAvailable: false,
      }
      const selectorWithConfig = new TransportSelector(config)

      const fallbackHandler = vi.fn()
      selectorWithConfig.on('transport:fallback', fallbackHandler)

      const context: RequestContext = {
        operation: 'watch',
        hasSubscription: true,
      }

      selectorWithConfig.selectTransport(context)

      expect(fallbackHandler).toHaveBeenCalledWith({
        from: 'websocket',
        to: 'http',
        reason: 'websocket_unavailable',
      })
    })
  })

  describe('Forced Transport Config', () => {
    it('should respect forced transport config', () => {
      const config: TransportConfig = {
        forceTransport: 'http',
      }
      const selectorWithConfig = new TransportSelector(config)

      // Even with change streams, forced HTTP should be respected
      const context: RequestContext = {
        operation: 'watch',
        hasSubscription: true,
        enableChangeStream: true,
      }

      const transport = selectorWithConfig.selectTransport(context)

      expect(transport).toBe('http')
    })

    it('should force WebSocket when configured', () => {
      const config: TransportConfig = {
        forceTransport: 'websocket',
      }
      const selectorWithConfig = new TransportSelector(config)

      // Even for one-off queries, forced WebSocket should be respected
      const context: RequestContext = {
        operation: 'find',
        hasSubscription: false,
      }

      const transport = selectorWithConfig.selectTransport(context)

      expect(transport).toBe('websocket')
    })

    it('should ignore forced transport if that transport is unavailable', () => {
      const config: TransportConfig = {
        forceTransport: 'websocket',
        websocketAvailable: false,
        allowFallbackOnForced: true,
      }
      const selectorWithConfig = new TransportSelector(config)

      const context: RequestContext = {
        operation: 'find',
        hasSubscription: false,
      }

      const transport = selectorWithConfig.selectTransport(context)

      expect(transport).toBe('http')
    })

    it('should throw error when forced transport is unavailable and fallback disabled', () => {
      const config: TransportConfig = {
        forceTransport: 'websocket',
        websocketAvailable: false,
        allowFallbackOnForced: false,
      }
      const selectorWithConfig = new TransportSelector(config)

      const context: RequestContext = {
        operation: 'find',
        hasSubscription: false,
      }

      expect(() => selectorWithConfig.selectTransport(context)).toThrow(
        'Forced transport "websocket" is not available'
      )
    })
  })

  describe('Auto-upgrade to WebSocket for Subscriptions', () => {
    it('should upgrade to WS for subscriptions', () => {
      const context: RequestContext = {
        operation: 'find',
        hasSubscription: true,
      }

      const transport = selector.selectTransport(context)

      expect(transport).toBe('websocket')
    })

    it('should auto-upgrade when subscription is added mid-session', async () => {
      // Start with HTTP
      const initialContext: RequestContext = {
        operation: 'find',
        hasSubscription: false,
      }

      const initialTransport = selector.selectTransport(initialContext)
      expect(initialTransport).toBe('http')

      // Add subscription
      const subscriptionContext: RequestContext = {
        operation: 'find',
        hasSubscription: true,
        sessionId: 'session-123',
      }

      const upgradedTransport = selector.selectTransport(subscriptionContext)
      expect(upgradedTransport).toBe('websocket')
    })

    it('should emit upgrade event when auto-upgrading', () => {
      const upgradeHandler = vi.fn()
      selector.on('transport:upgrade', upgradeHandler)

      // First query via HTTP
      selector.selectTransport({
        operation: 'find',
        hasSubscription: false,
        sessionId: 'session-456',
      })

      // Then subscription triggers upgrade
      selector.selectTransport({
        operation: 'find',
        hasSubscription: true,
        sessionId: 'session-456',
      })

      expect(upgradeHandler).toHaveBeenCalledWith({
        sessionId: 'session-456',
        from: 'http',
        to: 'websocket',
        reason: 'subscription_added',
      })
    })

    it('should batch multiple subscriptions over single WebSocket connection', () => {
      const config: TransportConfig = {
        enableConnectionPooling: true,
      }
      const selectorWithConfig = new TransportSelector(config)

      // Multiple subscription requests
      const context1: RequestContext = {
        operation: 'watch',
        hasSubscription: true,
        collectionName: 'users',
      }
      const context2: RequestContext = {
        operation: 'watch',
        hasSubscription: true,
        collectionName: 'products',
      }

      selectorWithConfig.selectTransport(context1)
      selectorWithConfig.selectTransport(context2)

      const connectionCount = selectorWithConfig.getActiveConnectionCount('websocket')
      expect(connectionCount).toBe(1)
    })

    it('should maintain subscription state across transport upgrades', () => {
      const context: RequestContext = {
        operation: 'find',
        hasSubscription: true,
        sessionId: 'session-789',
        subscriptionId: 'sub-001',
      }

      selector.selectTransport(context)

      const subscriptionState = selector.getSubscriptionState('sub-001')
      expect(subscriptionState).toMatchObject({
        id: 'sub-001',
        sessionId: 'session-789',
        transport: 'websocket',
        active: true,
      })
      // Verify extended subscription state properties exist
      expect(subscriptionState?.createdAt).toBeDefined()
      expect(subscriptionState?.lastActivity).toBeDefined()
      expect(subscriptionState?.messageCount).toBe(0)
    })
  })

  describe('Transport Health Checking', () => {
    it('should check transport health', async () => {
      const health = await selector.checkHealth('http')

      expect(health).toMatchObject({
        healthy: expect.any(Boolean),
        latency: expect.any(Number),
        lastCheck: expect.any(Number),
      })
    })

    it('should check WebSocket health with ping/pong', async () => {
      const config: TransportConfig = {
        websocketAvailable: true,
        healthCheckInterval: 1000,
      }
      const selectorWithConfig = new TransportSelector(config)

      const health = await selectorWithConfig.checkHealth('websocket')

      expect(health).toMatchObject({
        healthy: expect.any(Boolean),
        latency: expect.any(Number),
        lastCheck: expect.any(Number),
        connectionState: expect.stringMatching(/^(connected|connecting|disconnected)$/),
      })
    })

    it('should run periodic health checks', async () => {
      const config: TransportConfig = {
        healthCheckInterval: 50,
      }
      const selectorWithConfig = new TransportSelector(config)
      const healthCheckSpy = vi.spyOn(selectorWithConfig, 'checkHealth')

      selectorWithConfig.startHealthChecks()

      // Wait for multiple health check intervals
      await new Promise((resolve) => setTimeout(resolve, 150))

      selectorWithConfig.stopHealthChecks()

      // Verify health checks ran multiple times (at least 2 checks in 150ms with 50ms interval)
      expect(healthCheckSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('should mark transport as unhealthy after consecutive failures', async () => {
      const config: TransportConfig = {
        healthCheckInterval: 50,
        unhealthyThreshold: 3,
      }
      const selectorWithConfig = new TransportSelector(config)

      // Simulate 3 consecutive failures
      for (let i = 0; i < 3; i++) {
        selectorWithConfig.recordHealthCheckFailure('websocket')
      }

      const health = selectorWithConfig.getTransportHealth('websocket')
      expect(health.healthy).toBe(false)
      expect(health.consecutiveFailures).toBe(3)
    })

    it('should emit health change events', async () => {
      const healthChangeHandler = vi.fn()
      selector.on('transport:health', healthChangeHandler)

      selector.setTransportHealth('http', {
        healthy: false,
        lastError: new Error('Connection refused'),
        lastCheck: Date.now(),
      })

      expect(healthChangeHandler).toHaveBeenCalledWith({
        transport: 'http',
        healthy: false,
        previousHealth: expect.any(Object),
      })
    })

    it('should recover transport health after successful checks', async () => {
      // First mark as unhealthy
      selector.setTransportHealth('http', {
        healthy: false,
        consecutiveFailures: 3,
        lastCheck: Date.now(),
      })

      // Record successful health check
      selector.recordHealthCheckSuccess('http', 50)

      const health = selector.getTransportHealth('http')
      expect(health.healthy).toBe(true)
      expect(health.consecutiveFailures).toBe(0)
      expect(health.latency).toBe(50)
    })
  })

  describe('Graceful Transport Switching', () => {
    it('should switch transports gracefully without dropping requests', async () => {
      const config: TransportConfig = {
        websocketAvailable: true,
      }
      const selectorWithConfig = new TransportSelector(config)

      // Start a request on HTTP
      const pendingRequest = selectorWithConfig.createPendingRequest({
        operation: 'find',
        hasSubscription: false,
        requestId: 'req-001',
      })

      // Initiate switch to WebSocket
      const switchPromise = selectorWithConfig.switchTransport('http', 'websocket')

      // The pending request should complete on HTTP before switch
      await pendingRequest.complete()

      // Switch should complete without errors
      await expect(switchPromise).resolves.toBeUndefined()

      // New requests should use WebSocket
      const newContext: RequestContext = {
        operation: 'find',
        hasSubscription: false,
      }
      expect(selectorWithConfig.selectTransport(newContext)).toBe('websocket')
    })

    it('should drain connections before switching', async () => {
      const config: TransportConfig = {
        websocketAvailable: true,
        drainTimeout: 100,
      }
      const selectorWithConfig = new TransportSelector(config)

      const drainSpy = vi.spyOn(selectorWithConfig, 'drainConnections')

      await selectorWithConfig.switchTransport('http', 'websocket')

      expect(drainSpy).toHaveBeenCalledWith('http', { timeout: 100 })
    })

    it('should timeout and force switch if drain takes too long', async () => {
      const config: TransportConfig = {
        websocketAvailable: true,
        drainTimeout: 50,
      }
      const selectorWithConfig = new TransportSelector(config)

      // Create a long-running request that won't complete in time
      selectorWithConfig.createPendingRequest({
        operation: 'aggregate',
        hasSubscription: false,
        requestId: 'slow-req',
        expectedDuration: 1000,
      })

      const forceHandler = vi.fn()
      selectorWithConfig.on('transport:forcedSwitch', forceHandler)

      await selectorWithConfig.switchTransport('http', 'websocket')

      expect(forceHandler).toHaveBeenCalledWith({
        from: 'http',
        to: 'websocket',
        droppedRequests: expect.arrayContaining(['slow-req']),
      })
    })

    it('should maintain request ordering during transport switch', async () => {
      const config: TransportConfig = {
        websocketAvailable: true,
        preserveRequestOrder: true,
      }
      const selectorWithConfig = new TransportSelector(config)

      const requestOrder: string[] = []

      // Create multiple pending requests
      const req1 = selectorWithConfig.createPendingRequest({
        operation: 'find',
        hasSubscription: false,
        requestId: 'req-1',
      })
      const req2 = selectorWithConfig.createPendingRequest({
        operation: 'find',
        hasSubscription: false,
        requestId: 'req-2',
      })
      const req3 = selectorWithConfig.createPendingRequest({
        operation: 'find',
        hasSubscription: false,
        requestId: 'req-3',
      })

      req1.onComplete(() => requestOrder.push('req-1'))
      req2.onComplete(() => requestOrder.push('req-2'))
      req3.onComplete(() => requestOrder.push('req-3'))

      // Initiate switch
      await selectorWithConfig.switchTransport('http', 'websocket')

      // Complete requests
      await req1.complete()
      await req2.complete()
      await req3.complete()

      expect(requestOrder).toEqual(['req-1', 'req-2', 'req-3'])
    })

    it('should reconnect subscriptions on new transport after switch', async () => {
      const config: TransportConfig = {
        websocketAvailable: true,
      }
      const selectorWithConfig = new TransportSelector(config)

      // Register a subscription on current transport
      selectorWithConfig.selectTransport({
        operation: 'watch',
        hasSubscription: true,
        sessionId: 'session-switch',
        subscriptionId: 'sub-switch',
      })

      const reconnectSpy = vi.fn()
      selectorWithConfig.on('subscription:reconnect', reconnectSpy)

      // Switch transports
      await selectorWithConfig.switchTransport('websocket', 'http')

      expect(reconnectSpy).toHaveBeenCalledWith({
        subscriptionId: 'sub-switch',
        previousTransport: 'websocket',
        newTransport: 'http',
      })
    })

    it('should emit events during transport switch lifecycle', async () => {
      const config: TransportConfig = {
        websocketAvailable: true,
      }
      const selectorWithConfig = new TransportSelector(config)

      const events: string[] = []
      selectorWithConfig.on('transport:switchStart', () => events.push('switchStart'))
      selectorWithConfig.on('transport:draining', () => events.push('draining'))
      selectorWithConfig.on('transport:drained', () => events.push('drained'))
      selectorWithConfig.on('transport:switchComplete', () => events.push('switchComplete'))

      await selectorWithConfig.switchTransport('http', 'websocket')

      expect(events).toEqual(['switchStart', 'draining', 'drained', 'switchComplete'])
    })
  })

  describe('Transport Preferences', () => {
    it('should allow setting transport preferences', () => {
      const preferences = {
        preferredTransport: 'websocket' as TransportType,
        maxRetries: 3,
        retryDelay: 1000,
      }

      selector.setPreferences(preferences)

      expect(selector.getPreferences()).toEqual(expect.objectContaining(preferences))
    })

    it('should use preferred transport when both are available', () => {
      const config: TransportConfig = {
        websocketAvailable: true,
        httpAvailable: true,
      }
      const selectorWithConfig = new TransportSelector(config)

      selectorWithConfig.setPreferences({
        preferredTransport: 'websocket',
      })

      const context: RequestContext = {
        operation: 'find',
        hasSubscription: false,
      }

      const transport = selectorWithConfig.selectTransport(context)

      expect(transport).toBe('websocket')
    })
  })

  describe('Type Definitions', () => {
    it('should export TransportType as union of "http" and "websocket"', () => {
      const httpTransport: TransportType = 'http'
      const wsTransport: TransportType = 'websocket'

      expect(httpTransport).toBe('http')
      expect(wsTransport).toBe('websocket')
    })

    it('should have TransportConfig with all optional properties', () => {
      // All properties should be optional
      const emptyConfig: TransportConfig = {}
      const fullConfig: TransportConfig = {
        forceTransport: 'http',
        enableChangeStream: true,
        websocketAvailable: true,
        httpAvailable: true,
        reconnectInterval: 5000,
        healthCheckInterval: 10000,
        drainTimeout: 30000,
        unhealthyThreshold: 3,
        allowFallbackOnForced: false,
        enableConnectionPooling: true,
        preserveRequestOrder: true,
      }

      expect(emptyConfig).toBeDefined()
      expect(fullConfig).toBeDefined()
    })

    it('should have TransportHealth interface with required properties', () => {
      const health: TransportHealth = {
        healthy: true,
        lastCheck: Date.now(),
      }

      expect(health.healthy).toBe(true)
      expect(health.lastCheck).toBeDefined()
    })

    it('should have RequestContext with operation and subscription info', () => {
      const context: RequestContext = {
        operation: 'find',
        hasSubscription: false,
      }

      expect(context.operation).toBe('find')
      expect(context.hasSubscription).toBe(false)
    })
  })
})
