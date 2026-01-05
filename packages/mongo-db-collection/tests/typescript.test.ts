import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

/**
 * TypeScript Configuration Tests (TDD RED Phase)
 *
 * These tests verify that the tsconfig.json for @tanstack/mongo-db-collection
 * is properly configured for production use.
 */

const TSCONFIG_PATH = resolve(__dirname, '../tsconfig.json')

describe('TypeScript Configuration', () => {
  describe('tsconfig.json existence', () => {
    it('should have a tsconfig.json file', () => {
      expect(existsSync(TSCONFIG_PATH)).toBe(true)
    })
  })

  describe('TypeScript compiler options', () => {
    let tsconfig: {
      compilerOptions?: {
        strict?: boolean
        target?: string
        module?: string
        moduleResolution?: string
        declaration?: boolean
        sourceMap?: boolean
        outDir?: string
      }
    }

    // Parse tsconfig.json before running tests
    const loadTsConfig = () => {
      if (!existsSync(TSCONFIG_PATH)) {
        throw new Error('tsconfig.json does not exist')
      }
      const content = readFileSync(TSCONFIG_PATH, 'utf-8')
      return JSON.parse(content)
    }

    it('should have strict mode enabled for type safety', () => {
      tsconfig = loadTsConfig()
      expect(tsconfig.compilerOptions?.strict).toBe(true)
    })

    it('should target ES2022 for modern JavaScript features', () => {
      tsconfig = loadTsConfig()
      expect(tsconfig.compilerOptions?.target).toBe('ES2022')
    })

    it('should use ESNext module system', () => {
      tsconfig = loadTsConfig()
      expect(tsconfig.compilerOptions?.module).toBe('ESNext')
    })

    it('should use bundler module resolution for modern tooling compatibility', () => {
      tsconfig = loadTsConfig()
      expect(tsconfig.compilerOptions?.moduleResolution).toBe('bundler')
    })

    it('should generate declaration files for type definitions', () => {
      tsconfig = loadTsConfig()
      expect(tsconfig.compilerOptions?.declaration).toBe(true)
    })

    it('should enable source maps for debugging', () => {
      tsconfig = loadTsConfig()
      expect(tsconfig.compilerOptions?.sourceMap).toBe(true)
    })

    it('should output compiled files to ./dist directory', () => {
      tsconfig = loadTsConfig()
      expect(tsconfig.compilerOptions?.outDir).toBe('./dist')
    })
  })
})
