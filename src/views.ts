/**
 * Views - Cross-node state access system
 *
 * Views provide windows into other nodes' state, enabling coordinated
 * operations across node boundaries using recursive traversal and
 * JavaScript reference passing.
 */

import type { HappenNode } from './node.js';

/**
 * View accessor for a specific node's state
 */
export interface NodeView {
  /**
   * Access state from the viewed node with optional transformation
   */
  get<T = any, R = any>(
    transform?: (state: T) => R
  ): Promise<R>;
}

/**
 * Views collection providing access to other nodes' state
 */
export interface Views {
  /**
   * Collect data from multiple nodes
   */
  collect<T = any>(collection: {
    [nodeId: string]: (state: any) => T;
  }): Promise<{ [nodeId: string]: T }>;

  /**
   * Access another node's state by node ID
   */
  [nodeId: string]: NodeView | any;
}

/**
 * State transformation function with views access
 */
export type StateTransformWithViews<T = any> = (
  state: T,
  views: Views
) => T | Promise<T>;

/**
 * Create a Views proxy for accessing other nodes' state
 */
export function createViews(
  currentNode: HappenNode,
  nodeRegistry: Map<string, HappenNode>
): Views {
  const viewsProxy = new Proxy({} as Views, {
    get(target, prop: string) {
      if (prop === 'collect') {
        return async (collection: { [nodeId: string]: (state: any) => any }) => {
          const results: { [nodeId: string]: any } = {};

          for (const [nodeId, transform] of Object.entries(collection)) {
            const node = nodeRegistry.get(nodeId);
            if (node && node.getId() !== currentNode.getId()) {
              try {
                const state = await node.state.get();
                results[nodeId] = transform(state);
              } catch (error) {
                // Node may not be persistent or accessible
                results[nodeId] = null;
              }
            }
          }

          return results;
        };
      }

      // Access specific node view
      const nodeId = prop;
      const node = nodeRegistry.get(nodeId);

      if (!node || node.getId() === currentNode.getId()) {
        // Return a view that always returns null for non-existent or self nodes
        return {
          get: async () => null
        };
      }

      // Return a NodeView for the target node
      const nodeView: NodeView = {
        get: async (transform?: (state: any) => any) => {
          try {
            const state = await node.state.get();
            return transform ? transform(state) : state;
          } catch (error) {
            // Node may not be persistent
            return null;
          }
        }
      };

      return nodeView;
    }
  });

  return viewsProxy;
}

/**
 * Check if a state transform function expects views parameter
 */
export function expectsViews(fn: Function): boolean {
  return fn.length >= 2;
}
