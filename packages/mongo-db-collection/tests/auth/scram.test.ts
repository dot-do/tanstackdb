/**
 * @file SCRAM-SHA-256 Authentication Tests (RED Phase - TDD)
 *
 * These tests verify the ScramAuthProvider class that implements MongoDB's
 * SCRAM-SHA-256 authentication mechanism (Salted Challenge Response Authentication Mechanism).
 *
 * SCRAM-SHA-256 is MongoDB's default authentication mechanism that provides:
 * - Mutual authentication between client and server
 * - Password proof without sending plaintext
 * - Protection against replay attacks
 * - Support for channel binding (future)
 *
 * Authentication Flow:
 * 1. Client sends first message with username and nonce
 * 2. Server responds with salt, iteration count, and server nonce
 * 3. Client computes proof using HMAC-SHA-256 and sends to server
 * 4. Server validates proof and sends signature
 * 5. Client validates server signature
 *
 * Tests cover:
 * 1. Constructor with username/password credentials
 * 2. Client nonce generation (random, base64-encoded)
 * 3. Client first message construction (n,,n=<username>,r=<nonce>)
 * 4. Server challenge parsing (salt, iteration count, server nonce)
 * 5. SCRAM proof computation using PBKDF2 and HMAC-SHA-256
 * 6. Server signature validation
 * 7. Authentication failure handling
 * 8. SCRAM-SHA-1 fallback support (optional)
 *
 * RED PHASE: These tests will fail until ScramAuthProvider is implemented in src/auth/scram.ts
 *
 * @see https://www.mongodb.com/docs/manual/core/security-scram/
 * @see https://www.rfc-editor.org/rfc/rfc5802
 * @see https://www.rfc-editor.org/rfc/rfc7677
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ScramAuthProvider } from '../../src/auth/scram'

// Mock crypto module for Node.js environment
const mockRandomBytes = vi.fn()
const mockPbkdf2 = vi.fn()
const mockCreateHmac = vi.fn()

// Mock transport interface for testing authentication flow
interface MockTransport {
  send: ReturnType<typeof vi.fn>
  isConnected: () => boolean
}

describe('ScramAuthProvider', () => {
  const testUsername = 'testUser'
  const testPassword = 'testPassword123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should construct with username and password', () => {
      const provider = new ScramAuthProvider({
        username: testUsername,
        password: testPassword,
      })

      expect(provider).toBeInstanceOf(ScramAuthProvider)
      expect(provider.mechanism).toBe('SCRAM-SHA-256')
    })

    it('should accept username and password as separate parameters', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      expect(provider).toBeInstanceOf(ScramAuthProvider)
    })

    it('should throw if username is empty', () => {
      expect(() => {
        new ScramAuthProvider('', testPassword)
      }).toThrow('Username cannot be empty')
    })

    it('should throw if password is empty', () => {
      expect(() => {
        new ScramAuthProvider(testUsername, '')
      }).toThrow('Password cannot be empty')
    })

    it('should support SCRAM-SHA-1 mechanism option', () => {
      const provider = new ScramAuthProvider(
        {
          username: testUsername,
          password: testPassword,
        },
        { mechanism: 'SCRAM-SHA-1' }
      )

      expect(provider.mechanism).toBe('SCRAM-SHA-1')
    })

    it('should default to SCRAM-SHA-256 mechanism', () => {
      const provider = new ScramAuthProvider({
        username: testUsername,
        password: testPassword,
      })

      expect(provider.mechanism).toBe('SCRAM-SHA-256')
    })

    it('should throw on unsupported mechanism', () => {
      expect(() => {
        new ScramAuthProvider(
          {
            username: testUsername,
            password: testPassword,
          },
          { mechanism: 'PLAIN' as any }
        )
      }).toThrow('Unsupported mechanism')
    })
  })

  describe('generateClientNonce()', () => {
    it('should generate a random client nonce', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const nonce1 = provider.generateClientNonce()
      const nonce2 = provider.generateClientNonce()

      // Nonces should be different each time
      expect(nonce1).not.toBe(nonce2)

      // Nonces should be base64-encoded strings
      expect(nonce1).toMatch(/^[A-Za-z0-9+/]+=*$/)
      expect(nonce2).toMatch(/^[A-Za-z0-9+/]+=*$/)
    })

    it('should generate nonces of sufficient length', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const nonce = provider.generateClientNonce()

      // Decode base64 to check byte length (should be at least 16 bytes)
      const decoded = Buffer.from(nonce, 'base64')
      expect(decoded.length).toBeGreaterThanOrEqual(16)
    })

    it('should use crypto-secure randomness', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      // Generate multiple nonces and ensure high entropy
      const nonces = new Set()
      for (let i = 0; i < 100; i++) {
        nonces.add(provider.generateClientNonce())
      }

      // All nonces should be unique
      expect(nonces.size).toBe(100)
    })
  })

  describe('computeClientFirstMessage()', () => {
    it('should construct client first message with username and nonce', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const clientNonce = 'fyko+d2lbbFgONRv9qkxdawL'
      const message = provider.computeClientFirstMessage(clientNonce)

      // SCRAM client-first message format: n,,n=<username>,r=<nonce>
      expect(message).toContain('n,,')
      expect(message).toContain(`n=${testUsername}`)
      expect(message).toContain(`r=${clientNonce}`)
    })

    it('should encode special characters in username', () => {
      const specialUsername = 'user,name=test'
      const provider = new ScramAuthProvider(specialUsername, testPassword)

      const message = provider.computeClientFirstMessage('nonce123')

      // Username should be SASLprep normalized and special chars encoded
      // ',' becomes '=2C' and '=' becomes '=3D'
      expect(message).toContain('n=user=2Cname=3Dtest')
    })

    it('should return bare message without GS2 header when requested', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const clientNonce = 'fyko+d2lbbFgONRv9qkxdawL'
      const bareMessage = provider.computeClientFirstMessage(clientNonce, {
        bare: true,
      })

      // Bare message should not include the "n,," GS2 header
      expect(bareMessage).not.toContain('n,,')
      expect(bareMessage).toMatch(/^n=.*,r=.*$/)
    })
  })

  describe('parseServerFirstMessage()', () => {
    it('should parse server challenge correctly', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const serverMessage =
        'r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096'

      const challenge = provider.parseServerFirstMessage(serverMessage)

      expect(challenge).toEqual({
        nonce: 'fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j',
        salt: 'QSXCR+Q6sek8bf92',
        iterations: 4096,
      })
    })

    it('should throw on malformed server message', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const malformedMessage = 'invalid,format'

      expect(() => {
        provider.parseServerFirstMessage(malformedMessage)
      }).toThrow('Invalid server first message')
    })

    it('should throw if server nonce does not start with client nonce', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      // Set the client nonce
      const clientNonce = 'fyko+d2lbbFgONRv9qkxdawL'
      provider.computeClientFirstMessage(clientNonce)

      // Server nonce must extend client nonce
      const serverMessage =
        'r=wrongnonce3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096'

      expect(() => {
        provider.parseServerFirstMessage(serverMessage)
      }).toThrow('Server nonce does not extend client nonce')
    })

    it('should throw if iteration count is too low', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      // Iteration count below minimum (4096)
      const serverMessage =
        'r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=1000'

      expect(() => {
        provider.parseServerFirstMessage(serverMessage)
      }).toThrow('Iteration count too low')
    })

    it('should accept valid iteration counts', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const serverMessage =
        'r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=10000'

      const challenge = provider.parseServerFirstMessage(serverMessage)

      expect(challenge.iterations).toBe(10000)
    })
  })

  describe('computeScramProof()', () => {
    it('should compute SCRAM proof using PBKDF2 and HMAC-SHA-256', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const challenge = {
        nonce: 'fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j',
        salt: 'QSXCR+Q6sek8bf92',
        iterations: 4096,
      }

      const clientFirstMessageBare = `n=${testUsername},r=fyko+d2lbbFgONRv9qkxdawL`
      const serverFirstMessage =
        'r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096'

      const proof = provider.computeScramProof(
        challenge,
        clientFirstMessageBare,
        serverFirstMessage
      )

      // Proof should be a base64-encoded string
      expect(proof).toMatch(/^[A-Za-z0-9+/]+=*$/)
      expect(proof.length).toBeGreaterThan(0)
    })

    it('should use correct hash algorithm for SCRAM-SHA-256', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword, {
        mechanism: 'SCRAM-SHA-256',
      })

      expect(provider.hashAlgorithm).toBe('sha256')
    })

    it('should use correct hash algorithm for SCRAM-SHA-1', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword, {
        mechanism: 'SCRAM-SHA-1',
      })

      expect(provider.hashAlgorithm).toBe('sha1')
    })

    it('should compute different proofs for different passwords', () => {
      const provider1 = new ScramAuthProvider(testUsername, 'password1')
      const provider2 = new ScramAuthProvider(testUsername, 'password2')

      const challenge = {
        nonce: 'fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j',
        salt: 'QSXCR+Q6sek8bf92',
        iterations: 4096,
      }

      const clientFirstMessageBare = `n=${testUsername},r=fyko+d2lbbFgONRv9qkxdawL`
      const serverFirstMessage =
        'r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096'

      const proof1 = provider1.computeScramProof(
        challenge,
        clientFirstMessageBare,
        serverFirstMessage
      )
      const proof2 = provider2.computeScramProof(
        challenge,
        clientFirstMessageBare,
        serverFirstMessage
      )

      expect(proof1).not.toBe(proof2)
    })
  })

  describe('computeClientFinalMessage()', () => {
    it('should construct client final message with channel binding and proof', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const serverNonce = 'fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j'
      const proof = 'v0X8v3Bz2T0CJGbJQyF0X+HI4Ts='

      const message = provider.computeClientFinalMessage(serverNonce, proof)

      // Client-final message format: c=<base64(channel-binding)>,r=<nonce>,p=<proof>
      expect(message).toContain('c=biws') // base64('n,,')
      expect(message).toContain(`r=${serverNonce}`)
      expect(message).toContain(`p=${proof}`)
    })

    it('should encode channel binding data correctly', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const message = provider.computeClientFinalMessage('nonce', 'proof')

      // 'biws' is base64 encoding of 'n,,' (no channel binding)
      expect(message).toMatch(/^c=biws,/)
    })
  })

  describe('validateServerSignature()', () => {
    it('should validate correct server signature', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      // This would be computed during authentication
      const expectedSignature = 'rmF9pqV8S7suAoZWja4dJRkFsKQ='

      const serverFinalMessage = `v=${expectedSignature}`

      // Assuming the provider has computed and stored the expected signature
      expect(() => {
        provider.validateServerSignature(
          serverFinalMessage,
          expectedSignature
        )
      }).not.toThrow()
    })

    it('should throw on signature mismatch', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const expectedSignature = 'rmF9pqV8S7suAoZWja4dJRkFsKQ='
      const serverFinalMessage = 'v=wrongsignature=='

      expect(() => {
        provider.validateServerSignature(
          serverFinalMessage,
          expectedSignature
        )
      }).toThrow('Server signature verification failed')
    })

    it('should parse server final message correctly', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const signature = 'rmF9pqV8S7suAoZWja4dJRkFsKQ='
      const serverFinalMessage = `v=${signature}`

      const parsedSignature = provider.parseServerFinalMessage(serverFinalMessage)

      expect(parsedSignature).toBe(signature)
    })

    it('should throw on malformed server final message', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const malformedMessage = 'invalid-format'

      expect(() => {
        provider.parseServerFinalMessage(malformedMessage)
      }).toThrow('Invalid server final message')
    })

    it('should handle server error in final message', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const errorMessage = 'e=invalid-credentials'

      expect(() => {
        provider.parseServerFinalMessage(errorMessage)
      }).toThrow('SCRAM authentication error')
    })
  })

  describe('authenticate()', () => {
    it('should perform complete SCRAM handshake', async () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      // Mock transport
      const mockTransport: MockTransport = {
        send: vi.fn(),
        isConnected: () => true,
      }

      // Mock server responses
      mockTransport.send
        .mockResolvedValueOnce({
          // Server first message
          conversationId: 'conv-1',
          payload: Buffer.from(
            'r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096'
          ).toString('base64'),
          done: false,
        })
        .mockResolvedValueOnce({
          // Server final message
          conversationId: 'conv-1',
          payload: Buffer.from('v=rmF9pqV8S7suAoZWja4dJRkFsKQ=').toString(
            'base64'
          ),
          done: true,
        })

      await expect(
        provider.authenticate(mockTransport as any)
      ).resolves.toBeUndefined()

      // Verify two messages were sent (client first and client final)
      expect(mockTransport.send).toHaveBeenCalledTimes(2)
    })

    it('should send saslStart command with mechanism', async () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const mockTransport: MockTransport = {
        send: vi.fn(),
        isConnected: () => true,
      }

      // Provide both server-first and server-final responses
      mockTransport.send
        .mockResolvedValueOnce({
          conversationId: 'conv-1',
          payload: Buffer.from(
            'r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096'
          ).toString('base64'),
          done: false,
        })
        .mockResolvedValueOnce({
          conversationId: 'conv-1',
          payload: Buffer.from('v=rmF9pqV8S7suAoZWja4dJRkFsKQ=').toString(
            'base64'
          ),
          done: true,
        })

      // Start authentication and let it complete
      await provider.authenticate(mockTransport as any)

      const firstCall = mockTransport.send.mock.calls[0]![0]
      expect(firstCall).toMatchObject({
        command: 'saslStart',
        mechanism: 'SCRAM-SHA-256',
      })
    })

    it('should send saslContinue for subsequent messages', async () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const mockTransport: MockTransport = {
        send: vi.fn(),
        isConnected: () => true,
      }

      mockTransport.send
        .mockResolvedValueOnce({
          conversationId: 'conv-1',
          payload: Buffer.from(
            'r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096'
          ).toString('base64'),
          done: false,
        })
        .mockResolvedValueOnce({
          conversationId: 'conv-1',
          payload: Buffer.from('v=rmF9pqV8S7suAoZWja4dJRkFsKQ=').toString(
            'base64'
          ),
          done: true,
        })

      await provider.authenticate(mockTransport as any)

      const secondCall = mockTransport.send.mock.calls[1]![0]
      expect(secondCall).toMatchObject({
        command: 'saslContinue',
        conversationId: 'conv-1',
      })
    })

    it('should handle authentication failure', async () => {
      const provider = new ScramAuthProvider(testUsername, 'wrongPassword')

      const mockTransport: MockTransport = {
        send: vi.fn(),
        isConnected: () => true,
      }

      mockTransport.send.mockResolvedValueOnce({
        conversationId: 'conv-1',
        payload: Buffer.from('e=authentication-failed').toString('base64'),
        done: true,
      })

      await expect(
        provider.authenticate(mockTransport as any)
      ).rejects.toThrow('authentication-failed')
    })

    it('should reject if transport is not connected', async () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const mockTransport: MockTransport = {
        send: vi.fn(),
        isConnected: () => false,
      }

      await expect(
        provider.authenticate(mockTransport as any)
      ).rejects.toThrow('Transport not connected')
    })

    it('should handle network errors during authentication', async () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const mockTransport: MockTransport = {
        send: vi.fn().mockRejectedValue(new Error('Network error')),
        isConnected: () => true,
      }

      await expect(
        provider.authenticate(mockTransport as any)
      ).rejects.toThrow('Network error')
    })

    it('should include auth source in saslStart command', async () => {
      const provider = new ScramAuthProvider(
        { username: testUsername, password: testPassword },
        { authSource: 'admin' }
      )

      const mockTransport: MockTransport = {
        send: vi.fn(),
        isConnected: () => true,
      }

      // Provide both server-first and server-final responses
      mockTransport.send
        .mockResolvedValueOnce({
          conversationId: 'conv-1',
          payload: Buffer.from(
            'r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096'
          ).toString('base64'),
          done: false,
        })
        .mockResolvedValueOnce({
          conversationId: 'conv-1',
          payload: Buffer.from('v=rmF9pqV8S7suAoZWja4dJRkFsKQ=').toString(
            'base64'
          ),
          done: true,
        })

      await provider.authenticate(mockTransport as any)

      const firstCall = mockTransport.send.mock.calls[0]![0]
      expect(firstCall.db).toBe('admin')
    })
  })

  describe('SCRAM-SHA-1 fallback', () => {
    it('should support SCRAM-SHA-1 mechanism', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword, {
        mechanism: 'SCRAM-SHA-1',
      })

      expect(provider.mechanism).toBe('SCRAM-SHA-1')
      expect(provider.hashAlgorithm).toBe('sha1')
    })

    it('should use SHA-1 for PBKDF2 when using SCRAM-SHA-1', async () => {
      const provider = new ScramAuthProvider(testUsername, testPassword, {
        mechanism: 'SCRAM-SHA-1',
      })

      const challenge = {
        nonce: 'fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j',
        salt: 'QSXCR+Q6sek8bf92',
        iterations: 4096,
      }

      const clientFirstMessageBare = `n=${testUsername},r=fyko+d2lbbFgONRv9qkxdawL`
      const serverFirstMessage =
        'r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096'

      const proof = provider.computeScramProof(
        challenge,
        clientFirstMessageBare,
        serverFirstMessage
      )

      // Proof should be computed using SHA-1
      expect(proof).toBeDefined()
      expect(proof).toMatch(/^[A-Za-z0-9+/]+=*$/)
    })
  })

  describe('edge cases', () => {
    it('should handle usernames with special characters', () => {
      const specialUsername = 'user@domain.com'
      const provider = new ScramAuthProvider(specialUsername, testPassword)

      const message = provider.computeClientFirstMessage('nonce123')

      expect(message).toContain(`n=${specialUsername}`)
    })

    it('should handle long passwords correctly', () => {
      const longPassword = 'a'.repeat(1000)
      const provider = new ScramAuthProvider(testUsername, longPassword)

      expect(provider).toBeInstanceOf(ScramAuthProvider)
    })

    it('should handle Unicode characters in credentials', () => {
      const unicodeUsername = 'user_ñoño'
      const unicodePassword = 'pass_ñoño'
      const provider = new ScramAuthProvider(
        unicodeUsername,
        unicodePassword
      )

      expect(provider).toBeInstanceOf(ScramAuthProvider)
    })

    it('should handle high iteration counts efficiently', () => {
      const provider = new ScramAuthProvider(testUsername, testPassword)

      const challenge = {
        nonce: 'fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j',
        salt: 'QSXCR+Q6sek8bf92',
        iterations: 100000, // High iteration count
      }

      const clientFirstMessageBare = `n=${testUsername},r=fyko+d2lbbFgONRv9qkxdawL`
      const serverFirstMessage =
        'r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=100000'

      // Should complete without timing out (assuming reasonable execution time)
      const proof = provider.computeScramProof(
        challenge,
        clientFirstMessageBare,
        serverFirstMessage
      )

      expect(proof).toBeDefined()
    })
  })
})

describe('ScramAuthProvider Types', () => {
  it('should export proper TypeScript types', () => {
    const provider: ScramAuthProvider = new ScramAuthProvider(
      'user',
      'pass'
    )

    const mechanism: string = provider.mechanism
    const hashAlgorithm: string = provider.hashAlgorithm

    expect(mechanism).toBe('SCRAM-SHA-256')
    expect(hashAlgorithm).toBe('sha256')
  })

  it('should accept credentials object type', () => {
    const credentials = {
      username: 'user',
      password: 'pass',
    }

    const provider: ScramAuthProvider = new ScramAuthProvider(credentials)

    expect(provider).toBeInstanceOf(ScramAuthProvider)
  })

  it('should accept options object type', () => {
    const options = {
      mechanism: 'SCRAM-SHA-256' as const,
      authSource: 'admin',
    }

    const provider: ScramAuthProvider = new ScramAuthProvider(
      'user',
      'pass',
      options
    )

    expect(provider.mechanism).toBe('SCRAM-SHA-256')
  })
})
