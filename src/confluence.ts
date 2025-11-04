/**
 * Confluence - Unified fan-in and fan-out event processing
 * Handles multiple events and multiple nodes with minimal API surface
 */

import type { HappenNode } from './node.js';
import type { HappenEvent, BroadcastOptions, EventPattern, EventHandler } from './types.js';

/**
 * Result of sending to multiple nodes
 */
export interface MultiNodeResult<T = any> {
  /** Get results from all nodes */
  return: () => Promise<Record<string, T>>;
}

/**
 * Node array wrapper that adds Confluence capabilities
 */
export class NodeArray {
  private nodes: HappenNode[];

  constructor(nodes: HappenNode[]) {
    this.nodes = nodes;
  }

  /**
   * Register handler on all nodes in the array
   */
  on(pattern: EventPattern, handler: EventHandler): void {
    for (const node of this.nodes) {
      // Wrap handler to add context.node
      const wrappedHandler: EventHandler = (event, context) => {
        // Add node reference to context
        context.node = { id: node.getId() };
        return handler(event, context);
      };

      node.on(pattern, wrappedHandler);
    }
  }

  /**
   * Send event to all nodes in the array (fan-out)
   */
  async send(
    options: BroadcastOptions | BroadcastOptions[]
  ): Promise<MultiNodeResult> {
    const results: Record<string, any> = {};

    // If single event, send to all nodes
    if (!Array.isArray(options)) {
      const promises = this.nodes.map(async (node) => {
        const event = buildEventForNode(options, node);
        const result = await node.process(event);
        results[node.getId()] = result;
      });

      await Promise.all(promises);
    } else {
      // If array of events (batch), send batch to all nodes
      for (const node of this.nodes) {
        const events = options.map(opt => buildEventForNode(opt, node));
        // Process as batch
        const result = await node.process(events as any);
        results[node.getId()] = result;
      }
    }

    return {
      return: async () => results
    };
  }

  /**
   * Broadcast to all nodes
   */
  async broadcast(options: BroadcastOptions): Promise<void> {
    await Promise.all(
      this.nodes.map(node => node.broadcast(options))
    );
  }

  /**
   * Get the nodes in this array
   */
  getNodes(): HappenNode[] {
    return this.nodes;
  }
}

/**
 * Helper to build event for a specific node
 */
function buildEventForNode(options: BroadcastOptions, node: HappenNode): HappenEvent {
  return {
    type: options.type,
    payload: options.payload || {},
    context: {
      causal: {
        id: `evt-${Date.now()}-${Math.random()}`,
        sender: node.getId(),
        causationId: options.causationId,
        correlationId: options.correlationId || `txn-${Date.now()}`,
        path: [node.getId()],
        timestamp: Date.now()
      }
    }
  };
}

/**
 * Create a NodeArray from an array of nodes
 * This enables: [node1, node2, node3].on(...)
 */
export function createNodeArray(nodes: HappenNode[]): NodeArray {
  return new NodeArray(nodes);
}

/**
 * Helper function for sending to one or more nodes with Confluence
 * Use this for fan-out and batch processing
 */
export async function sendToNodes(
  sender: HappenNode,
  targetOrTargets: HappenNode | HappenNode[],
  optionsOrBatch: BroadcastOptions | BroadcastOptions[]
): Promise<void | MultiNodeResult> {
  // Multiple targets (fan-out)
  if (Array.isArray(targetOrTargets)) {
    const nodeArray = new NodeArray(targetOrTargets);
    return nodeArray.send(optionsOrBatch);
  }

  // Single target
  const target = targetOrTargets;

  // Batch events (fan-in)
  if (Array.isArray(optionsOrBatch)) {
    // Send multiple events as a batch
    for (const options of optionsOrBatch) {
      await sender.send(target.getId(), options);
    }
    return;
  }

  // Single event to single target (original behavior)
  await sender.send(target.getId(), optionsOrBatch);
}

// Declare module augmentation for Array
declare global {
  interface Array<T> {
    on?(pattern: EventPattern, handler: EventHandler): void;
    send?(options: BroadcastOptions | BroadcastOptions[]): Promise<MultiNodeResult>;
    broadcast?(options: BroadcastOptions): Promise<void>;
  }
}

/**
 * Enable array syntax for nodes
 * This makes [node1, node2].on(...) work
 */
export function enableArraySyntax() {
  // Extend Array prototype to add Happen methods
  // This is done in a non-intrusive way
  if (!(Array.prototype as any).on) {
    Object.defineProperty(Array.prototype, 'on', {
      value: function(this: any[], pattern: EventPattern, handler: EventHandler) {
        if (this.length > 0 && typeof this[0].on === 'function') {
          const nodeArray = new NodeArray(this as HappenNode[]);
          return nodeArray.on(pattern, handler);
        }
        throw new Error('Array.on() can only be used with HappenNode arrays');
      },
      writable: true,
      configurable: true
    });
  }

  if (!(Array.prototype as any).send) {
    Object.defineProperty(Array.prototype, 'send', {
      value: function(this: any[], options: BroadcastOptions | BroadcastOptions[]) {
        if (this.length > 0 && typeof this[0].broadcast === 'function') {
          const nodeArray = new NodeArray(this as HappenNode[]);
          return nodeArray.send(options);
        }
        throw new Error('Array.send() can only be used with HappenNode arrays');
      },
      writable: true,
      configurable: true
    });
  }

  if (!(Array.prototype as any).broadcast) {
    Object.defineProperty(Array.prototype, 'broadcast', {
      value: function(this: any[], options: BroadcastOptions) {
        if (this.length > 0 && typeof this[0].broadcast === 'function') {
          const nodeArray = new NodeArray(this as HappenNode[]);
          return nodeArray.broadcast(options);
        }
        throw new Error('Array.broadcast() can only be used with HappenNode arrays');
      },
      writable: true,
      configurable: true
    });
  }
}
