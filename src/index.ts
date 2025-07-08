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

// Main API
export { createHappen } from './happen';
import { createHappen } from './happen';

// Default instance
export const happen = createHappen();

// Convenience exports
export { flow } from './continuum';
export { patterns } from './patterns';
export { stateHelpers } from './state';