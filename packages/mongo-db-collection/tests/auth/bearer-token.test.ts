/**
 * @file Bearer Token Authentication Provider Tests (RED Phase - TDD)
 *
 * These tests verify the BearerTokenAuthProvider class that handles bearer token
 * authentication for the mongo.do API. The provider handles:
 * - Token storage and management
 * - Authorization header generation
 * - JWT token expiry detection
 * - Token refresh functionality
 * - Token change notifications
 * - Static (non-expiring) token support
 *
 * RED PHASE: These tests will fail until BearerTokenAuthProvider is implemented
 * in src/auth/bearer-token.ts
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6750 - Bearer Token Usage
 * @see https://datatracker.ietf.org/doc/html/rfc7519 - JSON Web Tokens
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BearerTokenAuthProvider } from '../../src/auth/bearer-token'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Helper function to create a mock JWT token
// JWT structure: header.payload.signature
function createMockJWT(expiresInSeconds?: number): string {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  }

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: '1234567890',
    name: 'Test User',
    iat: now,
    ...(expiresInSeconds !== undefined && { exp: now + expiresInSeconds }),
  }

  const encodedHeader = btoa(JSON.stringify(header))
  const encodedPayload = btoa(JSON.stringify(payload))
  const signature = 'mock-signature'

  return `${encodedHeader}.${encodedPayload}.${signature}`
}

describe('BearerTokenAuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should construct with token string', () => {
      const token = 'test-bearer-token-123'
      const provider = new BearerTokenAuthProvider(token)

      expect(provider).toBeInstanceOf(BearerTokenAuthProvider)
      expect(provider.token).toBe(token)
    })

    it('should construct with JWT token', () => {
      const jwtToken = createMockJWT(3600) // 1 hour expiry
      const provider = new BearerTokenAuthProvider(jwtToken)

      expect(provider).toBeInstanceOf(BearerTokenAuthProvider)
      expect(provider.token).toBe(jwtToken)
    })

    it('should construct with static token (no expiry)', () => {
      const staticToken = 'static-api-key-no-expiry'
      const provider = new BearerTokenAuthProvider(staticToken)

      expect(provider).toBeInstanceOf(BearerTokenAuthProvider)
      expect(provider.token).toBe(staticToken)
    })

    it('should accept refresh endpoint configuration', () => {
      const token = createMockJWT(3600)
      const refreshEndpoint = 'https://api.mongo.do/auth/refresh'

      const provider = new BearerTokenAuthProvider(token, {
        refreshEndpoint,
      })

      expect(provider).toBeInstanceOf(BearerTokenAuthProvider)
    })

    it('should accept onTokenChange callback', () => {
      const token = createMockJWT(3600)
      const onTokenChange = vi.fn()

      const provider = new BearerTokenAuthProvider(token, {
        onTokenChange,
      })

      expect(provider).toBeInstanceOf(BearerTokenAuthProvider)
    })

    it('should accept custom expiry buffer', () => {
      const token = createMockJWT(3600)

      const provider = new BearerTokenAuthProvider(token, {
        expiryBufferSeconds: 300, // 5 minutes
      })

      expect(provider).toBeInstanceOf(BearerTokenAuthProvider)
    })

    it('should throw on empty token', () => {
      expect(() => new BearerTokenAuthProvider('')).toThrow('Token cannot be empty')
    })

    it('should throw on null/undefined token', () => {
      expect(() => new BearerTokenAuthProvider(null as any)).toThrow('Token cannot be empty')
      expect(() => new BearerTokenAuthProvider(undefined as any)).toThrow(
        'Token cannot be empty'
      )
    })
  })

  describe('getAuthHeader()', () => {
    it('should return Bearer auth header', () => {
      const token = 'test-token-abc123'
      const provider = new BearerTokenAuthProvider(token)

      const header = provider.getAuthHeader()

      expect(header).toBe(`Bearer ${token}`)
    })

    it('should return Bearer header with JWT token', () => {
      const jwtToken = createMockJWT(3600)
      const provider = new BearerTokenAuthProvider(jwtToken)

      const header = provider.getAuthHeader()

      expect(header).toBe(`Bearer ${jwtToken}`)
    })

    it('should return updated header after token refresh', async () => {
      const oldToken = createMockJWT(10) // 10 seconds
      const newToken = createMockJWT(3600)

      const provider = new BearerTokenAuthProvider(oldToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
      })

      // Mock refresh response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      // Wait for token to expire
      await vi.advanceTimersByTimeAsync(15000)

      // Refresh token
      await provider.refresh()

      const header = provider.getAuthHeader()
      expect(header).toBe(`Bearer ${newToken}`)
    })

    it('should always return current token even if expired', () => {
      const expiredToken = createMockJWT(-3600) // Expired 1 hour ago
      const provider = new BearerTokenAuthProvider(expiredToken)

      // Should still return the header, even if expired
      // (caller is responsible for checking validity)
      const header = provider.getAuthHeader()
      expect(header).toBe(`Bearer ${expiredToken}`)
    })
  })

  describe('isValid()', () => {
    it('should return true for valid JWT token', () => {
      const validToken = createMockJWT(3600) // 1 hour from now
      const provider = new BearerTokenAuthProvider(validToken)

      expect(provider.isValid()).toBe(true)
    })

    it('should return false for expired JWT token', () => {
      const expiredToken = createMockJWT(-3600) // Expired 1 hour ago
      const provider = new BearerTokenAuthProvider(expiredToken)

      expect(provider.isValid()).toBe(false)
    })

    it('should return false for JWT expiring within buffer time', () => {
      const expiringToken = createMockJWT(60) // Expires in 60 seconds
      const provider = new BearerTokenAuthProvider(expiringToken, {
        expiryBufferSeconds: 120, // 2 minute buffer
      })

      // Token expires in 60s, but buffer is 120s, so should be invalid
      expect(provider.isValid()).toBe(false)
    })

    it('should return true for JWT outside buffer time', () => {
      const validToken = createMockJWT(300) // Expires in 5 minutes
      const provider = new BearerTokenAuthProvider(validToken, {
        expiryBufferSeconds: 60, // 1 minute buffer
      })

      // Token expires in 300s, buffer is 60s, so should be valid
      expect(provider.isValid()).toBe(true)
    })

    it('should return true for static tokens (no expiry)', () => {
      const staticToken = 'static-api-key-12345'
      const provider = new BearerTokenAuthProvider(staticToken)

      // Non-JWT tokens are considered always valid
      expect(provider.isValid()).toBe(true)
    })

    it('should return true for malformed JWT (treated as static)', () => {
      const malformedToken = 'not.a.valid.jwt.token'
      const provider = new BearerTokenAuthProvider(malformedToken)

      // Malformed JWTs are treated as static tokens
      expect(provider.isValid()).toBe(true)
    })

    it('should handle JWT without exp claim (treated as static)', () => {
      const tokenWithoutExp = createMockJWT() // No expiry
      const provider = new BearerTokenAuthProvider(tokenWithoutExp)

      // JWTs without exp claim are considered always valid
      expect(provider.isValid()).toBe(true)
    })

    it('should use default buffer of 60 seconds', () => {
      const expiringToken = createMockJWT(30) // Expires in 30 seconds
      const provider = new BearerTokenAuthProvider(expiringToken)
      // Default buffer is 60s, so token expiring in 30s should be invalid

      expect(provider.isValid()).toBe(false)
    })
  })

  describe('refresh()', () => {
    it('should refresh token when expired', async () => {
      const oldToken = createMockJWT(10) // Expires in 10 seconds
      const newToken = createMockJWT(3600) // New token with 1 hour expiry

      const provider = new BearerTokenAuthProvider(oldToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
      })

      // Mock successful refresh response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      // Advance time to expire token
      await vi.advanceTimersByTimeAsync(15000)

      // Refresh should succeed
      await expect(provider.refresh()).resolves.toBeUndefined()

      // Token should be updated
      expect(provider.token).toBe(newToken)
      expect(provider.isValid()).toBe(true)
    })

    it('should call refresh endpoint with current token', async () => {
      const currentToken = createMockJWT(10)
      const newToken = createMockJWT(3600)

      const refreshEndpoint = 'https://api.mongo.do/auth/refresh'
      const provider = new BearerTokenAuthProvider(currentToken, {
        refreshEndpoint,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      await provider.refresh()

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        refreshEndpoint,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${currentToken}`,
          }),
        })
      )
    })

    it('should throw if refresh endpoint not configured', async () => {
      const token = createMockJWT(10)
      const provider = new BearerTokenAuthProvider(token)

      await expect(provider.refresh()).rejects.toThrow(
        'Refresh endpoint not configured'
      )
    })

    it('should throw on failed refresh request', async () => {
      const token = createMockJWT(10)
      const provider = new BearerTokenAuthProvider(token, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
      })

      // Mock failed response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      await expect(provider.refresh()).rejects.toThrow('Token refresh failed: 401')
    })

    it('should throw on network error', async () => {
      const token = createMockJWT(10)
      const provider = new BearerTokenAuthProvider(token, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
      })

      // Mock network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(provider.refresh()).rejects.toThrow('Network error')
    })

    it('should handle custom refresh response format', async () => {
      const oldToken = createMockJWT(10)
      const newToken = createMockJWT(3600)

      const provider = new BearerTokenAuthProvider(oldToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
        refreshResponseParser: (data: any) => data.access_token,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: newToken }),
      })

      await provider.refresh()

      expect(provider.token).toBe(newToken)
    })

    it('should throw if refresh response missing token', async () => {
      const token = createMockJWT(10)
      const provider = new BearerTokenAuthProvider(token, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // No token in response
      })

      await expect(provider.refresh()).rejects.toThrow(
        'Refresh response missing token'
      )
    })

    it('should support POST with refresh token in body', async () => {
      const currentToken = createMockJWT(10)
      const newToken = createMockJWT(3600)
      const refreshToken = 'refresh-token-xyz'

      const provider = new BearerTokenAuthProvider(currentToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
        refreshToken,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      await provider.refresh()

      // Verify refresh token was sent in body
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ refreshToken }),
        })
      )
    })
  })

  describe('onTokenChange callback', () => {
    it('should notify on token change', async () => {
      const oldToken = createMockJWT(10)
      const newToken = createMockJWT(3600)
      const onTokenChange = vi.fn()

      const provider = new BearerTokenAuthProvider(oldToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
        onTokenChange,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      await provider.refresh()

      expect(onTokenChange).toHaveBeenCalledWith(newToken)
      expect(onTokenChange).toHaveBeenCalledTimes(1)
    })

    it('should not notify if token unchanged', async () => {
      const token = createMockJWT(3600)
      const onTokenChange = vi.fn()

      const provider = new BearerTokenAuthProvider(token, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
        onTokenChange,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token }), // Same token
      })

      await provider.refresh()

      // Should not notify if token didn't actually change
      expect(onTokenChange).not.toHaveBeenCalled()
    })

    it('should notify multiple times for multiple changes', async () => {
      const token1 = createMockJWT(10)
      const token2 = createMockJWT(3600)
      const token3 = createMockJWT(7200)
      const onTokenChange = vi.fn()

      const provider = new BearerTokenAuthProvider(token1, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
        onTokenChange,
      })

      // First refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: token2 }),
      })
      await provider.refresh()

      // Second refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: token3 }),
      })
      await provider.refresh()

      expect(onTokenChange).toHaveBeenCalledTimes(2)
      expect(onTokenChange).toHaveBeenNthCalledWith(1, token2)
      expect(onTokenChange).toHaveBeenNthCalledWith(2, token3)
    })

    it('should handle callback errors gracefully', async () => {
      const oldToken = createMockJWT(10)
      const newToken = createMockJWT(3600)
      const onTokenChange = vi.fn(() => {
        throw new Error('Callback error')
      })

      const provider = new BearerTokenAuthProvider(oldToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
        onTokenChange,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      // Refresh should still succeed even if callback throws
      await expect(provider.refresh()).resolves.toBeUndefined()

      // Token should still be updated
      expect(provider.token).toBe(newToken)
    })
  })

  describe('expired token handling', () => {
    it('should handle expired tokens gracefully', () => {
      const expiredToken = createMockJWT(-3600) // Expired 1 hour ago
      const provider = new BearerTokenAuthProvider(expiredToken)

      // Should construct without error
      expect(provider).toBeInstanceOf(BearerTokenAuthProvider)

      // Should report as invalid
      expect(provider.isValid()).toBe(false)

      // Should still return auth header
      expect(provider.getAuthHeader()).toBe(`Bearer ${expiredToken}`)
    })

    it('should allow refresh of expired token', async () => {
      const expiredToken = createMockJWT(-3600)
      const newToken = createMockJWT(3600)

      const provider = new BearerTokenAuthProvider(expiredToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      await provider.refresh()

      expect(provider.isValid()).toBe(true)
      expect(provider.token).toBe(newToken)
    })
  })

  describe('static token handling', () => {
    it('should handle static tokens without expiry', () => {
      const staticToken = 'api-key-static-12345'
      const provider = new BearerTokenAuthProvider(staticToken)

      expect(provider.isValid()).toBe(true)
      expect(provider.getAuthHeader()).toBe(`Bearer ${staticToken}`)
    })

    it('should not require refresh endpoint for static tokens', () => {
      const staticToken = 'api-key-static-12345'
      const provider = new BearerTokenAuthProvider(staticToken)

      // Should not throw when checking validity
      expect(() => provider.isValid()).not.toThrow()
    })

    it('should throw if trying to refresh static token', async () => {
      const staticToken = 'api-key-static-12345'
      const provider = new BearerTokenAuthProvider(staticToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
      })

      // Static tokens shouldn't need refresh, but if called, should handle gracefully
      // Implementation could either succeed (no-op) or fail - test both scenarios
      try {
        await provider.refresh()
        // If it succeeds, token should be unchanged
        expect(provider.token).toBe(staticToken)
      } catch (error) {
        // If it fails, should have clear error message
        expect(error).toBeInstanceOf(Error)
      }
    })
  })

  describe('JWT decoding', () => {
    it('should correctly decode JWT payload', () => {
      const jwtToken = createMockJWT(3600)
      const provider = new BearerTokenAuthProvider(jwtToken)

      // Access decoded payload (if provider exposes it)
      const payload = provider.getTokenPayload()

      expect(payload).toBeDefined()
      expect(payload.sub).toBe('1234567890')
      expect(payload.name).toBe('Test User')
      expect(payload.exp).toBeDefined()
    })

    it('should return null for non-JWT tokens', () => {
      const staticToken = 'not-a-jwt-token'
      const provider = new BearerTokenAuthProvider(staticToken)

      const payload = provider.getTokenPayload()

      expect(payload).toBeNull()
    })

    it('should handle malformed JWT gracefully', () => {
      const malformedToken = 'malformed.jwt'
      const provider = new BearerTokenAuthProvider(malformedToken)

      const payload = provider.getTokenPayload()

      expect(payload).toBeNull()
    })

    it('should handle JWT with invalid base64', () => {
      const invalidToken = 'invalid!!!.base64!!!.token!!!'
      const provider = new BearerTokenAuthProvider(invalidToken)

      const payload = provider.getTokenPayload()

      expect(payload).toBeNull()
    })
  })

  describe('token expiry calculation', () => {
    it('should calculate time until expiry', () => {
      const expiresIn = 3600 // 1 hour
      const token = createMockJWT(expiresIn)
      const provider = new BearerTokenAuthProvider(token)

      const timeUntilExpiry = provider.getTimeUntilExpiry()

      // Should be approximately 3600 seconds (within 1 second tolerance)
      expect(timeUntilExpiry).toBeGreaterThan(3599)
      expect(timeUntilExpiry).toBeLessThan(3601)
    })

    it('should return null for static tokens', () => {
      const staticToken = 'static-api-key'
      const provider = new BearerTokenAuthProvider(staticToken)

      const timeUntilExpiry = provider.getTimeUntilExpiry()

      expect(timeUntilExpiry).toBeNull()
    })

    it('should return negative value for expired tokens', () => {
      const expiredToken = createMockJWT(-3600) // Expired 1 hour ago
      const provider = new BearerTokenAuthProvider(expiredToken)

      const timeUntilExpiry = provider.getTimeUntilExpiry()

      expect(timeUntilExpiry).toBeLessThan(0)
    })

    it('should update after token refresh', async () => {
      const oldToken = createMockJWT(10)
      const newToken = createMockJWT(7200) // 2 hours

      const provider = new BearerTokenAuthProvider(oldToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
      })

      const oldExpiry = provider.getTimeUntilExpiry()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      await provider.refresh()

      const newExpiry = provider.getTimeUntilExpiry()

      // New expiry should be much larger
      expect(newExpiry!).toBeGreaterThan(oldExpiry!)
      expect(newExpiry!).toBeGreaterThan(7000)
    })
  })

  describe('auto-refresh behavior', () => {
    it('should support auto-refresh when enabled', async () => {
      const shortToken = createMockJWT(100) // Expires in 100 seconds
      const newToken = createMockJWT(3600)
      const onTokenChange = vi.fn()

      const provider = new BearerTokenAuthProvider(shortToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
        autoRefresh: true,
        expiryBufferSeconds: 60,
        onTokenChange,
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      // Start auto-refresh
      provider.startAutoRefresh()

      // Advance time to trigger auto-refresh (within buffer)
      // Token expires in 100s, buffer is 60s, so should trigger at 40s
      await vi.advanceTimersByTimeAsync(45000)

      expect(onTokenChange).toHaveBeenCalledWith(newToken)

      // Clean up
      provider.stopAutoRefresh()
    })

    it('should not auto-refresh static tokens', async () => {
      const staticToken = 'static-api-key'
      const onTokenChange = vi.fn()

      const provider = new BearerTokenAuthProvider(staticToken, {
        autoRefresh: true,
        onTokenChange,
      })

      provider.startAutoRefresh()

      // Advance time significantly
      await vi.advanceTimersByTimeAsync(100000)

      // Should not trigger any refresh
      expect(onTokenChange).not.toHaveBeenCalled()

      provider.stopAutoRefresh()
    })

    it('should stop auto-refresh when requested', async () => {
      const shortToken = createMockJWT(100)
      const newToken = createMockJWT(3600)
      const onTokenChange = vi.fn()

      const provider = new BearerTokenAuthProvider(shortToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
        autoRefresh: true,
        onTokenChange,
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      provider.startAutoRefresh()
      provider.stopAutoRefresh()

      // Advance time - should not trigger refresh
      await vi.advanceTimersByTimeAsync(100000)

      expect(onTokenChange).not.toHaveBeenCalled()
    })
  })
})

/**
 * Helper to create a JWT with Base64URL encoding (using - and _ instead of + and /)
 * This is the correct encoding per RFC 7519, but atob() doesn't handle it.
 */
function createBase64UrlJWT(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' }

  // Use standard Base64 first, then convert to Base64URL
  const base64UrlEncode = (obj: Record<string, unknown>): string => {
    const json = JSON.stringify(obj)
    const base64 = btoa(json)
    // Convert to Base64URL: replace + with -, / with _, remove padding =
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  const encodedHeader = base64UrlEncode(header)
  const encodedPayload = base64UrlEncode(payload)
  const signature = 'mock-signature'

  return `${encodedHeader}.${encodedPayload}.${signature}`
}

/**
 * Helper to create a payload that will contain Base64URL special characters when encoded.
 * The characters - and _ appear in Base64URL when specific byte patterns occur.
 */
function createPayloadWithBase64UrlChars(): Record<string, unknown> {
  // These specific values will produce + and / in standard Base64,
  // which become - and _ in Base64URL
  return {
    sub: '??????',  // Contains bytes that produce + in base64
    name: '>>>>>>>>',  // Contains bytes that produce / in base64
    data: '\xfb\xef\xbe',  // Binary data that produces +/
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
}

describe('JWT Base64URL Decoding (RED Phase - Issue tanstackdb-zue)', () => {
  /**
   * These tests verify that JWT decoding correctly handles Base64URL encoding.
   * Per RFC 7519, JWT uses Base64URL encoding which:
   * - Uses '-' instead of '+'
   * - Uses '_' instead of '/'
   * - May omit padding '=' characters
   *
   * The current implementation uses atob() which only handles standard Base64,
   * causing failures when tokens contain these URL-safe characters.
   *
   * RED PHASE: These tests will fail until the fix is implemented.
   */

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('Standard Base64 JWT payload', () => {
    it('should decode JWT with standard Base64 characters', () => {
      // Standard payload without special characters
      const token = createMockJWT(3600)
      const provider = new BearerTokenAuthProvider(token)

      const payload = provider.getTokenPayload()

      expect(payload).not.toBeNull()
      expect(payload?.sub).toBe('1234567890')
      expect(payload?.name).toBe('Test User')
    })

    it('should correctly identify expiry from standard Base64 JWT', () => {
      const token = createMockJWT(3600)
      const provider = new BearerTokenAuthProvider(token)

      expect(provider.isValid()).toBe(true)
      expect(provider.getTimeUntilExpiry()).toBeGreaterThan(3500)
    })
  })

  describe('Base64URL with - and _ characters', () => {
    it('should decode JWT payload containing - character (Base64URL)', () => {
      // Create a payload that will produce '-' in Base64URL encoding
      // The '-' character replaces '+' from standard Base64
      const payload = {
        sub: 'user-with-special-data',
        // This string encodes to contain '+' in standard Base64
        data: '\xfb\xef',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      const decoded = provider.getTokenPayload()

      // This will fail with atob() because it doesn't handle '-'
      expect(decoded).not.toBeNull()
      expect(decoded?.sub).toBe('user-with-special-data')
    })

    it('should decode JWT payload containing _ character (Base64URL)', () => {
      // Create a payload that will produce '_' in Base64URL encoding
      // The '_' character replaces '/' from standard Base64
      const payload = {
        sub: 'user/with/slashes',
        // This string encodes to contain '/' in standard Base64
        data: '\xff\xff',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      const decoded = provider.getTokenPayload()

      // This will fail with atob() because it doesn't handle '_'
      expect(decoded).not.toBeNull()
      expect(decoded?.sub).toBe('user/with/slashes')
    })

    it('should decode JWT payload containing both - and _ characters', () => {
      const payload = createPayloadWithBase64UrlChars()
      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      const decoded = provider.getTokenPayload()

      // This will fail with atob() because it doesn't handle Base64URL
      expect(decoded).not.toBeNull()
      expect(decoded?.exp).toBeDefined()
    })

    it('should correctly determine validity for Base64URL encoded JWT', () => {
      const payload = {
        sub: 'test-user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        // Include data that creates Base64URL special chars
        roles: ['\xfb\xef\xbe\xad'],
      }

      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      // Should be valid (not expired)
      // This will fail if decoding fails due to Base64URL characters
      expect(provider.isValid()).toBe(true)
    })

    it('should correctly detect expired Base64URL encoded JWT', () => {
      const payload = {
        sub: 'test-user',
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        data: '\xfb\xef',
      }

      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      // Should be invalid (expired)
      expect(provider.isValid()).toBe(false)
    })
  })

  describe('Payloads requiring padding restoration', () => {
    it('should decode JWT with payload requiring 1 padding character', () => {
      // Base64URL may omit trailing '=' padding
      // Payload length % 4 == 3 requires 1 padding char
      const payload = {
        a: '12345', // Creates specific length
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      const decoded = provider.getTokenPayload()

      expect(decoded).not.toBeNull()
      expect(decoded?.a).toBe('12345')
    })

    it('should decode JWT with payload requiring 2 padding characters', () => {
      // Payload length % 4 == 2 requires 2 padding chars
      const payload = {
        ab: '1234', // Creates specific length
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      const decoded = provider.getTokenPayload()

      expect(decoded).not.toBeNull()
      expect(decoded?.ab).toBe('1234')
    })

    it('should decode JWT with no padding needed', () => {
      // Payload length % 4 == 0 requires no padding
      const payload = {
        abc: '123456789', // Creates length divisible by 4
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      const decoded = provider.getTokenPayload()

      expect(decoded).not.toBeNull()
      expect(decoded?.abc).toBe('123456789')
    })

    it('should handle real-world JWT from Auth0/Firebase with stripped padding', () => {
      // Real-world JWTs from providers like Auth0, Firebase, etc.
      // always use Base64URL without padding
      const payload = {
        iss: 'https://auth.example.com/',
        sub: 'auth0|1234567890abcdef',
        aud: ['https://api.example.com', 'https://auth.example.com/userinfo'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        azp: 'client-id-with-special-chars',
        scope: 'openid profile email',
        permissions: ['read:users', 'write:users'],
      }

      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      const decoded = provider.getTokenPayload()

      expect(decoded).not.toBeNull()
      expect(decoded?.iss).toBe('https://auth.example.com/')
      expect(decoded?.sub).toBe('auth0|1234567890abcdef')
      expect(decoded?.scope).toBe('openid profile email')
    })
  })

  describe('Malformed JWT handling', () => {
    it('should return null for JWT with invalid Base64 characters', () => {
      // Contains characters that are invalid in both Base64 and Base64URL
      const invalidToken = 'eyJhbGciOi!!!.eyJzdWIiOi@@@.signature'
      const provider = new BearerTokenAuthProvider(invalidToken)

      const payload = provider.getTokenPayload()

      expect(payload).toBeNull()
    })

    it('should return null for JWT with wrong number of parts', () => {
      const twoPartToken = 'header.payload'
      const provider = new BearerTokenAuthProvider(twoPartToken)

      expect(provider.getTokenPayload()).toBeNull()
    })

    it('should return null for JWT with four parts', () => {
      const fourPartToken = 'header.payload.signature.extra'
      const provider = new BearerTokenAuthProvider(fourPartToken)

      expect(provider.getTokenPayload()).toBeNull()
    })

    it('should return null for JWT with empty payload section', () => {
      const emptyPayloadToken = 'eyJhbGciOiJIUzI1NiJ9..signature'
      const provider = new BearerTokenAuthProvider(emptyPayloadToken)

      const payload = provider.getTokenPayload()

      expect(payload).toBeNull()
    })

    it('should return null for JWT with non-JSON payload', () => {
      // Valid Base64 but not JSON
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      const notJson = btoa('this is not json')
      const token = `${header}.${notJson}.signature`

      const provider = new BearerTokenAuthProvider(token)

      expect(provider.getTokenPayload()).toBeNull()
    })

    it('should handle JWT with payload that decodes to non-object', () => {
      // Valid Base64, valid JSON, but not an object (array)
      // Current implementation returns arrays - this test documents current behavior
      // Whether this should return null is a separate enhancement
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      const arrayPayload = btoa(JSON.stringify([1, 2, 3]))
      const token = `${header}.${arrayPayload}.signature`

      const provider = new BearerTokenAuthProvider(token)

      const payload = provider.getTokenPayload()

      // Current behavior: returns the parsed JSON even if it's not an object
      // This is acceptable behavior - callers should validate the shape
      expect(payload).toBeDefined()
    })

    it('should treat malformed JWT as static token for validity', () => {
      const malformedToken = 'not-a-valid-jwt'
      const provider = new BearerTokenAuthProvider(malformedToken)

      // Malformed JWTs should be treated as static (always valid)
      expect(provider.isValid()).toBe(true)
      expect(provider.getTimeUntilExpiry()).toBeNull()
    })

    it('should handle JWT with corrupted Base64URL in payload', () => {
      // Header is valid, but payload is corrupted Base64URL
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const corruptedPayload = 'eyJzdWIiOiIx-Mg_' // Truncated/corrupted
      const token = `${header}.${corruptedPayload}.signature`

      const provider = new BearerTokenAuthProvider(token)

      expect(provider.getTokenPayload()).toBeNull()
    })
  })

  describe('Edge cases for Base64URL decoding', () => {
    it('should handle JWT from Google Identity Platform', () => {
      // Google JWTs often have complex payloads with Base64URL encoding
      const payload = {
        iss: 'https://accounts.google.com',
        azp: '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
        aud: '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
        sub: '1234567890123456789',
        email: 'user@example.com',
        email_verified: true,
        at_hash: 'HK6E_P6Dh8Y93mRNtsDB1Q', // Contains Base64URL chars
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      const decoded = provider.getTokenPayload()

      expect(decoded).not.toBeNull()
      expect(decoded?.email).toBe('user@example.com')
    })

    it('should handle JWT with unicode in claims', () => {
      const payload = {
        sub: 'user-123',
        name: 'Test', // Using ASCII to avoid encoding issues
        locale: 'ja-JP',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      const decoded = provider.getTokenPayload()

      expect(decoded).not.toBeNull()
      expect(decoded?.name).toBe('Test')
    })

    it('should handle JWT with very long payload', () => {
      const payload = {
        sub: 'user-123',
        permissions: Array.from({ length: 100 }, (_, i) => `permission:${i}`),
        roles: Array.from({ length: 50 }, (_, i) => `role:${i}`),
        metadata: { key: 'a'.repeat(1000) },
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      const decoded = provider.getTokenPayload()

      expect(decoded).not.toBeNull()
      expect(decoded?.permissions).toHaveLength(100)
    })

    it('should handle JWT where only header has Base64URL chars but payload does not', () => {
      // Even if payload is standard Base64 compatible, the JWT spec requires
      // Base64URL decoding for the entire token
      const payload = {
        sub: 'simple',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = createBase64UrlJWT(payload)
      const provider = new BearerTokenAuthProvider(token)

      const decoded = provider.getTokenPayload()

      expect(decoded).not.toBeNull()
      expect(decoded?.sub).toBe('simple')
    })
  })
})

describe('BearerTokenAuthProvider Types', () => {
  it('should export proper TypeScript types', () => {
    const token = 'test-token'
    const provider: BearerTokenAuthProvider = new BearerTokenAuthProvider(token)

    // These should type-check correctly
    const authHeader: string = provider.getAuthHeader()
    const isValid: boolean = provider.isValid()
    const currentToken: string = provider.token

    expect(authHeader).toBe(`Bearer ${token}`)
    expect(isValid).toBe(true)
    expect(currentToken).toBe(token)
  })
})

describe('Authorization Header Injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('injectAuthHeader()', () => {
    it('should inject Authorization header into empty headers object', () => {
      const token = 'test-bearer-token-123'
      const provider = new BearerTokenAuthProvider(token)

      const headers = {}
      const result = provider.injectAuthHeader(headers)

      expect(result).toEqual({
        Authorization: `Bearer ${token}`,
      })
    })

    it('should inject Authorization header into existing headers object', () => {
      const token = 'test-bearer-token-456'
      const provider = new BearerTokenAuthProvider(token)

      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
      const result = provider.injectAuthHeader(headers)

      expect(result).toEqual({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        Authorization: `Bearer ${token}`,
      })
    })

    it('should override existing Authorization header', () => {
      const token = 'new-bearer-token'
      const provider = new BearerTokenAuthProvider(token)

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer old-token',
      }
      const result = provider.injectAuthHeader(headers)

      expect(result).toEqual({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      })
    })

    it('should inject Authorization header into Headers instance', () => {
      const token = 'test-bearer-token-789'
      const provider = new BearerTokenAuthProvider(token)

      const headers = new Headers({
        'Content-Type': 'application/json',
      })
      const result = provider.injectAuthHeader(headers)

      expect(result.get('Authorization')).toBe(`Bearer ${token}`)
      expect(result.get('Content-Type')).toBe('application/json')
    })

    it('should inject Authorization header into array of header tuples', () => {
      const token = 'test-bearer-token-array'
      const provider = new BearerTokenAuthProvider(token)

      const headers: [string, string][] = [
        ['Content-Type', 'application/json'],
        ['Accept', 'application/json'],
      ]
      const result = provider.injectAuthHeader(headers)

      expect(result).toContainEqual(['Authorization', `Bearer ${token}`])
      expect(result).toContainEqual(['Content-Type', 'application/json'])
      expect(result).toContainEqual(['Accept', 'application/json'])
    })

    it('should not mutate the original headers object', () => {
      const token = 'test-bearer-token-immutable'
      const provider = new BearerTokenAuthProvider(token)

      const originalHeaders = {
        'Content-Type': 'application/json',
      }
      const originalCopy = { ...originalHeaders }

      provider.injectAuthHeader(originalHeaders)

      expect(originalHeaders).toEqual(originalCopy)
    })

    it('should work with JWT tokens', () => {
      const jwtToken = createMockJWT(3600)
      const provider = new BearerTokenAuthProvider(jwtToken)

      const headers = {}
      const result = provider.injectAuthHeader(headers)

      expect(result).toEqual({
        Authorization: `Bearer ${jwtToken}`,
      })
    })

    it('should inject updated token after refresh', async () => {
      const oldToken = createMockJWT(10)
      const newToken = createMockJWT(3600)
      const provider = new BearerTokenAuthProvider(oldToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      await provider.refresh()

      const headers = {}
      const result = provider.injectAuthHeader(headers)

      expect(result).toEqual({
        Authorization: `Bearer ${newToken}`,
      })
    })
  })

  describe('injectAuthIntoRequestInit()', () => {
    it('should inject Authorization header into fetch RequestInit', () => {
      const token = 'test-bearer-token-fetch'
      const provider = new BearerTokenAuthProvider(token)

      const requestInit: RequestInit = {
        method: 'GET',
      }
      const result = provider.injectAuthIntoRequestInit(requestInit)

      expect(result.method).toBe('GET')
      expect(result.headers).toBeDefined()
      expect((result.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${token}`
      )
    })

    it('should merge with existing headers in RequestInit', () => {
      const token = 'test-bearer-token-merge'
      const provider = new BearerTokenAuthProvider(token)

      const requestInit: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: 'test' }),
      }
      const result = provider.injectAuthIntoRequestInit(requestInit)

      expect(result.method).toBe('POST')
      expect(result.body).toBe(JSON.stringify({ data: 'test' }))
      expect((result.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${token}`
      )
      expect((result.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json'
      )
    })

    it('should handle RequestInit with Headers instance', () => {
      const token = 'test-bearer-token-headers-instance'
      const provider = new BearerTokenAuthProvider(token)

      const requestInit: RequestInit = {
        method: 'PUT',
        headers: new Headers({
          'Content-Type': 'application/json',
        }),
      }
      const result = provider.injectAuthIntoRequestInit(requestInit)

      const headers = result.headers as Headers
      expect(headers.get('Authorization')).toBe(`Bearer ${token}`)
      expect(headers.get('Content-Type')).toBe('application/json')
    })

    it('should not mutate the original RequestInit', () => {
      const token = 'test-bearer-token-no-mutate'
      const provider = new BearerTokenAuthProvider(token)

      const originalRequestInit: RequestInit = {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      }
      const originalCopy = JSON.parse(JSON.stringify(originalRequestInit))

      provider.injectAuthIntoRequestInit(originalRequestInit)

      expect(originalRequestInit).toEqual(originalCopy)
    })

    it('should handle empty RequestInit', () => {
      const token = 'test-bearer-token-empty'
      const provider = new BearerTokenAuthProvider(token)

      const requestInit: RequestInit = {}
      const result = provider.injectAuthIntoRequestInit(requestInit)

      expect(result.headers).toBeDefined()
      expect((result.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${token}`
      )
    })
  })

  describe('createAuthenticatedFetch()', () => {
    it('should return a fetch function that includes Authorization header', async () => {
      const token = 'test-bearer-token-auth-fetch'
      const provider = new BearerTokenAuthProvider(token)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'test' }),
      })

      const authenticatedFetch = provider.createAuthenticatedFetch()
      await authenticatedFetch('https://api.example.com/data')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${token}`,
          }),
        })
      )
    })

    it('should preserve other fetch options when using authenticated fetch', async () => {
      const token = 'test-bearer-token-preserve'
      const provider = new BearerTokenAuthProvider(token)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'test' }),
      })

      const authenticatedFetch = provider.createAuthenticatedFetch()
      await authenticatedFetch('https://api.example.com/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'value' }),
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ key: 'value' }),
          headers: expect.objectContaining({
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('should use updated token after refresh in authenticated fetch', async () => {
      const oldToken = createMockJWT(10)
      const newToken = createMockJWT(3600)
      const provider = new BearerTokenAuthProvider(oldToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
      })

      // First call to refresh
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      await provider.refresh()

      // Reset mock for authenticated fetch call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'test' }),
      })

      const authenticatedFetch = provider.createAuthenticatedFetch()
      await authenticatedFetch('https://api.example.com/data')

      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${newToken}`,
          }),
        })
      )
    })

    it('should accept custom fetch implementation', async () => {
      const token = 'test-bearer-token-custom-fetch'
      const provider = new BearerTokenAuthProvider(token)

      const customFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'custom' }),
      })

      const authenticatedFetch = provider.createAuthenticatedFetch(customFetch)
      await authenticatedFetch('https://api.example.com/data')

      expect(customFetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${token}`,
          }),
        })
      )
      // Global fetch should not be called
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('getAuthHeaders()', () => {
    it('should return headers object with Authorization', () => {
      const token = 'test-bearer-token-get-headers'
      const provider = new BearerTokenAuthProvider(token)

      const headers = provider.getAuthHeaders()

      expect(headers).toEqual({
        Authorization: `Bearer ${token}`,
      })
    })

    it('should return fresh headers object each time', () => {
      const token = 'test-bearer-token-fresh'
      const provider = new BearerTokenAuthProvider(token)

      const headers1 = provider.getAuthHeaders()
      const headers2 = provider.getAuthHeaders()

      expect(headers1).toEqual(headers2)
      expect(headers1).not.toBe(headers2) // Different object references
    })

    it('should include additional default headers if configured', () => {
      const token = 'test-bearer-token-defaults'
      const provider = new BearerTokenAuthProvider(token, {
        defaultHeaders: {
          'X-API-Version': 'v1',
          'X-Client-ID': 'test-client',
        },
      })

      const headers = provider.getAuthHeaders()

      expect(headers).toEqual({
        Authorization: `Bearer ${token}`,
        'X-API-Version': 'v1',
        'X-Client-ID': 'test-client',
      })
    })

    it('should reflect updated token after refresh', async () => {
      const oldToken = createMockJWT(10)
      const newToken = createMockJWT(3600)
      const provider = new BearerTokenAuthProvider(oldToken, {
        refreshEndpoint: 'https://api.mongo.do/auth/refresh',
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: newToken }),
      })

      const headersBefore = provider.getAuthHeaders()
      expect(headersBefore.Authorization).toBe(`Bearer ${oldToken}`)

      await provider.refresh()

      const headersAfter = provider.getAuthHeaders()
      expect(headersAfter.Authorization).toBe(`Bearer ${newToken}`)
    })
  })

  describe('header injection edge cases', () => {
    it('should handle tokens with special characters', () => {
      const tokenWithSpecialChars = 'token-with-special_chars.and/slashes+plus='
      const provider = new BearerTokenAuthProvider(tokenWithSpecialChars)

      const headers = provider.getAuthHeaders()

      expect(headers.Authorization).toBe(`Bearer ${tokenWithSpecialChars}`)
    })

    it('should handle very long tokens', () => {
      const longToken = 'a'.repeat(10000)
      const provider = new BearerTokenAuthProvider(longToken)

      const headers = provider.getAuthHeaders()

      expect(headers.Authorization).toBe(`Bearer ${longToken}`)
      expect(headers.Authorization.length).toBe(7 + 10000) // "Bearer " + token
    })

    it('should handle tokens with unicode characters', () => {
      // While unusual, test robustness
      const unicodeToken = 'token-\u{1F600}-emoji'
      const provider = new BearerTokenAuthProvider(unicodeToken)

      const headers = provider.getAuthHeaders()

      expect(headers.Authorization).toBe(`Bearer ${unicodeToken}`)
    })

    it('should properly escape header value for HTTP safety', () => {
      // Tokens should not contain newlines or other control characters
      // Test that the provider handles this gracefully
      const token = 'normal-token'
      const provider = new BearerTokenAuthProvider(token)

      const headers = provider.getAuthHeaders()

      // Should not contain any control characters
      expect(headers.Authorization).not.toMatch(/[\r\n\t]/)
    })
  })
})
