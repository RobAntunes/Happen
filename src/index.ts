/**
 * Happen - A minimalist framework for building distributed and agent-based systems
 * Based on pure causality with just two primitives: Nodes and Events
 */

import { HappenNode } from './node.js';
import { NatsConnectionManager } from './nats-connection.js';
import type { HappenConfig, NodeConfig } from './types.js';

// Export all types
export * from './types.js';

// Export pattern utilities
export * from './patterns.js';

// Export causality utilities
export * from './causality.js';

// Export continuum utilities
export * from './continuum.js';

// Export Node class
export { HappenNode } from './node.js';

// Export Confluence utilities
export * from './confluence.js';

// Export Views utilities
export * from './views.js';

// Export Flow-balance utilities
export * from './flow-balance.js';

// Export Zero-allocation utilities
export * from './zero-allocation.js';

// Export Identity utilities
export * from './identity.js';

// Export Security utilities
export * from './security.js';

/**
 * Happen instance returned by initializeHappen
 */
export interface HappenInstance {
  /** Create a new node */
  createNode: (id: string, config?: NodeConfig) => HappenNode;
  /** Get the NATS connection manager */
  getNatsManager: () => NatsConnectionManager;
  /** Shutdown the Happen instance */
  shutdown: () => Promise<void>;
}

/**
 * Initialize the Happen framework
 * Connects to NATS and provides a factory for creating nodes
 * Enables Confluence array syntax
 */
export async function initializeHappen(
  config: HappenConfig = {}
): Promise<HappenInstance> {
  const natsManager = new NatsConnectionManager(config);

  // Connect to NATS
  await natsManager.connect();

  // Enable Confluence array syntax
  const { enableArraySyntax } = await import('./confluence.js');
  enableArraySyntax();

  const nodes: HappenNode[] = [];
  const nodeRegistry = new Map<string, HappenNode>();

  // Enable flow-balance monitoring if configured
  let flowBalanceMonitor: any = null;
  if (config.flowBalance?.enabled !== false) {
    const { enableFlowBalance } = await import('./flow-balance.js');
    flowBalanceMonitor = enableFlowBalance(
      natsManager,
      async (event: any) => {
        // Broadcast flow-balance events to all nodes
        await natsManager.publish('happen.broadcast', event);
      },
      config.flowBalance
    );
  }

  return {
    createNode: (id: string, nodeConfig: NodeConfig = {}): HappenNode => {
      const node = new HappenNode(id, natsManager, nodeRegistry, nodeConfig);

      // Add to registry
      nodeRegistry.set(id, node);

      // Initialize the node asynchronously
      node.initialize().catch(error => {
        console.error(`[Happen] Failed to initialize node ${id}:`, error);
      });

      nodes.push(node);
      return node;
    },

    getNatsManager: () => natsManager,

    shutdown: async () => {
      // Stop flow-balance monitoring
      if (flowBalanceMonitor) {
        flowBalanceMonitor.stop();
      }

      // Shutdown all nodes
      await Promise.all(nodes.map(node => node.shutdown()));

      // Clear registry
      nodeRegistry.clear();

      // Disconnect from NATS
      await natsManager.disconnect();
    }
  };
}

/**
 * Synchronous version for use cases where NATS is already running
 * and you want to set up nodes before async initialization
 */
export function initializeHappenSync(
  config: HappenConfig = {}
): {
  initialize: () => Promise<HappenInstance>;
  createNode: (id: string, config?: NodeConfig) => HappenNode;
} {
  const natsManager = new NatsConnectionManager(config);
  const nodes: HappenNode[] = [];
  const nodeRegistry = new Map<string, HappenNode>();

  return {
    initialize: async () => {
      await natsManager.connect();

      // Initialize all nodes
      await Promise.all(nodes.map(node => node.initialize()));

      return {
        createNode: (id: string, nodeConfig: NodeConfig = {}): HappenNode => {
          const node = new HappenNode(id, natsManager, nodeRegistry, nodeConfig);
          nodeRegistry.set(id, node);
          node.initialize().catch(error => {
            console.error(`[Happen] Failed to initialize node ${id}:`, error);
          });
          nodes.push(node);
          return node;
        },

        getNatsManager: () => natsManager,

        shutdown: async () => {
          await Promise.all(nodes.map(node => node.shutdown()));
          nodeRegistry.clear();
          await natsManager.disconnect();
        }
      };
    },

    createNode: (id: string, nodeConfig: NodeConfig = {}): HappenNode => {
      const node = new HappenNode(id, natsManager, nodeRegistry, nodeConfig);
      nodeRegistry.set(id, node);
      nodes.push(node);
      return node;
    }
  };
}
