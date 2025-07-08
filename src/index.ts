/**
 * Happen - Simply Productive
 * Universal event-driven communication framework
 */

// Re-export all types
export * from './types';

// Re-export utilities
export * from './events';
export * from './patterns';
export * from './state';
export * from './continuum';
export { getGlobalViewRegistry, createViewCollection } from './views';
export * from './identity';
export * from './temporal';

// Re-export zero-allocation utilities (excluding conflicting types)
export {
  BufferPool,
  StringTable,
  BufferAccessor,
  ZeroAllocationContext,
  ZeroAllocationProcessor,
  PerformanceMonitor,
  wrapZeroAllocationHandler,
  getGlobalZeroAllocationProcessor,
  createZeroAllocationExtension,
} from './zero-allocation';

// Main API following the spec
export { initializeHappen, createHappen } from './initialize';
export type { HappenInitConfig, HappenInstance } from './initialize';

// Legacy API for backward compatibility
export { createHappen as createHappenLegacy } from './happen';

// Convenience exports
export { flow } from './continuum';
export { patterns } from './patterns';
export { stateHelpers } from './state';