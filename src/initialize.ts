/**
 * Happen initialization with system-level dependencies
 */

import { HappenNode, NodeOptions } from './types';
import { HappenNodeImpl } from './node';
import { InMemoryGlobalState } from './global-state';
import { NATSTransport } from './transport/nats';
import { BrowserTransport } from './transport/browser';

export interface HappenInitConfig {
  nats?: {
    server?: {
      servers: string | string[];
      jetstream?: boolean;
    };
    browser?: {
      servers: string | string[];
      jetstream?: boolean;
    };
  };
  crypto?: any; // Browser Crypto API or Node crypto
}

export interface HappenInstance {
  createNode: <T = any>(name: string, options?: NodeOptions<T>) => HappenNode<T>;
  transport?: any;
}

/**
 * Initialize Happen with system-level dependencies
 * This is the primary entry point following the spec's dependency management pattern
 */
export function initializeHappen(config: HappenInitConfig = {}): HappenInstance {
  // Detect runtime environment
  const isBrowser = typeof globalThis !== 'undefined' && typeof (globalThis as any).window !== 'undefined';
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
  
  // Create global state (will be backed by NATS KV when connected)
  const globalState = new InMemoryGlobalState();
  
  // Initialize transport based on environment
  let transport: any = null;
  
  if (config.nats) {
    if (isBrowser && config.nats.browser) {
      // Browser environment - use WebSocket transport
      transport = new BrowserTransport(config.nats.browser);
    } else if (isNode && config.nats.server) {
      // Node.js environment - use TCP transport
      transport = new NATSTransport(config.nats.server);
    }
  }
  
  // Create the node factory function
  const createNode = <T = any>(name: string, options?: NodeOptions<T>): HappenNode<T> => {
    const node = new HappenNodeImpl(name, options || {}, globalState);
    
    // If transport is available, connect the node
    if (transport) {
      // This would connect the node to the transport
      // For now, we're keeping it simple
    }
    
    return node;
  };
  
  return {
    createNode,
    transport
  };
}

/**
 * Convenience export for simple initialization
 */
export function createHappen(): HappenInstance {
  return initializeHappen();
}