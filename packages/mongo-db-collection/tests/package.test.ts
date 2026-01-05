import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('@tanstack/mongo-db-collection Package Configuration', () => {
  describe('Package Exports', () => {
    it('should export the main mongoDoCollectionOptions function', async () => {
      // This test will FAIL because the implementation does not exist yet
      const module = await import('../src/index')

      expect(module.mongoDoCollectionOptions).toBeDefined()
      expect(typeof module.mongoDoCollectionOptions).toBe('function')
    })

    it('should export MongoDoCollectionConfig type', async () => {
      // This test will FAIL because the implementation does not exist yet
      // We verify the type exists by importing and using it
      const module = await import('../src/index')

      // Type exports should be accessible - we check runtime exports exist
      expect(module).toHaveProperty('mongoDoCollectionOptions')
    })

    it('should export MongoDoSyncConfig type', async () => {
      // This test will FAIL because the implementation does not exist yet
      const module = await import('../src/index')

      // The module should have exports that use these types
      expect(module.mongoDoCollectionOptions).toBeDefined()
    })

    it('should export createMongoDoCollection helper if available', async () => {
      // This test will FAIL because the implementation does not exist yet
      const module = await import('../src/index')

      // Optional: Check for convenience helper
      expect(module.createMongoDoCollection).toBeDefined()
      expect(typeof module.createMongoDoCollection).toBe('function')
    })
  })

  describe('Package.json Configuration', () => {
    let packageJson: Record<string, unknown>

    beforeAll(() => {
      const packagePath = resolve(__dirname, '../package.json')
      const content = readFileSync(packagePath, 'utf-8')
      packageJson = JSON.parse(content)
    })

    it('should have correct package name', () => {
      expect(packageJson.name).toBe('@tanstack/mongo-db-collection')
    })

    it('should have version 0.0.1', () => {
      expect(packageJson.version).toBe('0.0.1')
    })

    it('should be an ES module', () => {
      expect(packageJson.type).toBe('module')
    })

    it('should have main pointing to dist', () => {
      expect(packageJson.main).toMatch(/^\.\/dist\//)
    })

    it('should have module pointing to dist', () => {
      expect(packageJson.module).toMatch(/^\.\/dist\//)
    })

    it('should have types pointing to dist', () => {
      expect(packageJson.types).toMatch(/^\.\/dist\/.*\.d\.ts$/)
    })

    it('should have exports configured for both ESM and CJS', () => {
      const exports = packageJson.exports as Record<string, unknown>
      expect(exports).toBeDefined()
      expect(exports['.']).toBeDefined()

      const mainExport = exports['.'] as Record<string, unknown>
      expect(mainExport.import).toBeDefined()
      expect(mainExport.require).toBeDefined()
    })
  })

  describe('Peer Dependencies', () => {
    let packageJson: Record<string, unknown>

    beforeAll(() => {
      const packagePath = resolve(__dirname, '../package.json')
      const content = readFileSync(packagePath, 'utf-8')
      packageJson = JSON.parse(content)
    })

    it('should have @tanstack/db as a peer dependency', () => {
      const peerDeps = packageJson.peerDependencies as Record<string, string>

      expect(peerDeps).toBeDefined()
      expect(peerDeps['@tanstack/db']).toBeDefined()
    })

    it('should require a valid version range for @tanstack/db', () => {
      const peerDeps = packageJson.peerDependencies as Record<string, string>

      expect(peerDeps['@tanstack/db']).toMatch(/^(>=|~|\^)?[\d.]+/)
    })
  })

  describe('Source File Structure', () => {
    it('should have an index.ts entry point', async () => {
      // This test will FAIL because src/index.ts does not exist yet
      const indexPath = resolve(__dirname, '../src/index.ts')
      const fs = await import('node:fs')

      expect(fs.existsSync(indexPath)).toBe(true)
    })

    it('should export from the main entry point', async () => {
      // This test will FAIL because the implementation does not exist yet
      const module = await import('../src/index')

      // Should have at least one export
      const exportKeys = Object.keys(module)
      expect(exportKeys.length).toBeGreaterThan(0)
    })
  })

  describe('Type Definitions', () => {
    it('should export MongoDoCollectionConfig interface', async () => {
      // This test verifies the type is properly exported
      // It will FAIL because the implementation does not exist yet
      const module = await import('../src/index')

      // We can't directly test types at runtime, but we can ensure
      // the function that uses them exists
      const options = module.mongoDoCollectionOptions
      expect(options).toBeDefined()
    })

    it('should support generic type parameters for document schema', async () => {
      // This test will FAIL because the implementation does not exist yet
      const module = await import('../src/index')

      // The mongoDoCollectionOptions should accept generic type parameters
      // This is validated at compile time, but we ensure the function exists
      expect(typeof module.mongoDoCollectionOptions).toBe('function')
    })
  })
})

// Import statement to verify types compile (will fail until types exist)
import { beforeAll } from 'vitest'
