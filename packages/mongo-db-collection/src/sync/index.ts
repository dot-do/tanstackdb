/**
 * @file Sync Module Exports
 *
 * This module exports all synchronization-related functionality for
 * the @tanstack/mongo-db-collection package.
 *
 * @packageDocumentation
 * @module @tanstack/mongo-db-collection/sync
 */

// Main sync function
export { createMongoDoSync } from './sync-function.js'

// Re-export transforms
export * from './transforms/index.js'
