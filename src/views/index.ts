/**
 * Views system for cross-node state access
 * Allows nodes to access and collect state from other nodes
 */

import { ID, HappenNode } from '../types';

/**
 * View definition for accessing state from another node
 */
export interface ViewDefinition<T = any, R = any> {
  nodeId: ID;
  selector: (state: T) => R;
  cacheKey?: string;
  ttl?: number; // Time to live in milliseconds
}

/**
 * View collection for cross-node state access
 */
export interface ViewCollection {
  [key: string]: {
    get<T, R>(selector: (state: T) => R): R;
  };
}

/**
 * Enhanced view collection with caching and batch operations
 */
export interface EnhancedViewCollection {
  /**
   * Collect data from multiple nodes with selectors
   */
  collect<T extends Record<string, any>>(selectors: {
    [K in keyof T]: ViewDefinition<any, T[K]>
  }): Promise<T>;

  /**
   * Get a single view by node ID
   */
  get<T, R>(nodeId: ID, selector: (state: T) => R): Promise<R>;

  /**
   * Cache a view result
   */
  cache<T>(key: string, value: T, ttl?: number): void;

  /**
   * Get cached value
   */
  getCached<T>(key: string): T | undefined;

  /**
   * Clear cache
   */
  clearCache(pattern?: string): void;

  /**
   * Subscribe to state changes from a node
   */
  subscribe<T>(nodeId: ID, callback: (state: T) => void): () => void;
}

/**
 * Cache entry for view results
 */
interface CacheEntry<T = any> {
  value: T;
  timestamp: number;
  ttl: number;
}

/**
 * View registry to track all nodes and their state accessors
 */
export class ViewRegistry {
  private nodes = new Map<ID, HappenNode>();
  private cacheStore = new Map<string, CacheEntry>();
  private subscriptions = new Map<string, Set<(state: any) => void>>();

  /**
   * Register a node for view access
   */
  registerNode(node: HappenNode): void {
    this.nodes.set(node.id, node);
  }

  /**
   * Unregister a node
   */
  unregisterNode(nodeId: ID): void {
    this.nodes.delete(nodeId);
    this.clearCacheForNode(nodeId);
    this.clearSubscriptionsForNode(nodeId);
  }

  /**
   * Get state from a node with selector
   */
  async getState<T, R>(nodeId: ID, selector: (state: T) => R): Promise<R> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found in view registry`);
    }

    try {
      const state = node.state.get();
      return selector(state as T);
    } catch (error) {
      throw new Error(`Failed to access state from node ${nodeId}: ${error}`);
    }
  }

  /**
   * Collect state from multiple nodes
   */
  async collect<T extends Record<string, any>>(
    selectors: { [K in keyof T]: ViewDefinition<any, T[K]> }
  ): Promise<T> {
    const promises = Object.entries(selectors).map(async ([key, definition]) => {
      const def = definition as ViewDefinition<any, any>;
      
      // Check cache first
      const cacheKey = def.cacheKey || `${def.nodeId}:${key}`;
      const cached = this.getCached(cacheKey);
      if (cached !== undefined) {
        return [key, cached];
      }

      // Get fresh data
      const value = await this.getState(def.nodeId, def.selector);
      
      // Cache if TTL specified
      if (def.ttl !== undefined) {
        this.cache(cacheKey, value, def.ttl);
      }

      return [key, value];
    });

    const results = await Promise.all(promises);
    return Object.fromEntries(results) as T;
  }

  /**
   * Cache a value with TTL
   */
  cache<T>(key: string, value: T, ttl: number = 60000): void {
    this.cacheStore.set(key, {
      value,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Get cached value (checks TTL)
   */
  getCached<T>(key: string): T | undefined {
    const entry = this.cacheStore.get(key);
    if (!entry) {
      return undefined;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cacheStore.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Clear cache entries matching pattern
   */
  clearCache(pattern?: string): void {
    if (!pattern) {
      this.cacheStore.clear();
      return;
    }

    const regex = new RegExp(pattern);
    for (const [key] of this.cacheStore) {
      if (regex.test(key)) {
        this.cacheStore.delete(key);
      }
    }
  }

  /**
   * Subscribe to state changes from a node
   */
  subscribe<T>(nodeId: ID, callback: (state: T) => void): () => void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found in view registry`);
    }

    // Create subscription tracking
    
    if (!this.subscriptions.has(nodeId)) {
      this.subscriptions.set(nodeId, new Set());
    }
    
    this.subscriptions.get(nodeId)!.add(callback);

    // Set up state change monitoring (this would be enhanced with actual state change events)
    // For now, this is a placeholder for the subscription mechanism
    
    return () => {
      const nodeSubscriptions = this.subscriptions.get(nodeId);
      if (nodeSubscriptions) {
        nodeSubscriptions.delete(callback);
        if (nodeSubscriptions.size === 0) {
          this.subscriptions.delete(nodeId);
        }
      }
    };
  }

  /**
   * Clear cache for a specific node
   */
  private clearCacheForNode(nodeId: ID): void {
    this.clearCache(`^${nodeId}:`);
  }

  /**
   * Clear subscriptions for a specific node
   */
  private clearSubscriptionsForNode(nodeId: ID): void {
    this.subscriptions.delete(nodeId);
  }

  /**
   * Get all registered node IDs
   */
  getRegisteredNodes(): ID[] {
    return Array.from(this.nodes.keys());
  }

  /**
   * Check if a node is registered
   */
  hasNode(nodeId: ID): boolean {
    return this.nodes.has(nodeId);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ key: string; age: number; ttl: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cacheStore.entries()).map(([key, entry]) => ({
      key,
      age: now - entry.timestamp,
      ttl: entry.ttl,
    }));

    return {
      size: this.cacheStore.size,
      entries,
    };
  }
}

/**
 * Enhanced view collection implementation
 */
export class EnhancedViewCollectionImpl implements EnhancedViewCollection {
  constructor(private registry: ViewRegistry) {}

  /**
   * Collect data from multiple nodes with selectors
   */
  async collect<T extends Record<string, any>>(selectors: {
    [K in keyof T]: ViewDefinition<any, T[K]>
  }): Promise<T> {
    return this.registry.collect(selectors);
  }

  /**
   * Get a single view by node ID
   */
  async get<T, R>(nodeId: ID, selector: (state: T) => R): Promise<R> {
    return this.registry.getState(nodeId, selector);
  }

  /**
   * Cache a view result
   */
  cache<T>(key: string, value: T, ttl?: number): void {
    this.registry.cache(key, value, ttl);
  }

  /**
   * Get cached value
   */
  getCached<T>(key: string): T | undefined {
    return this.registry.getCached(key);
  }

  /**
   * Clear cache
   */
  clearCache(pattern?: string): void {
    this.registry.clearCache(pattern);
  }

  /**
   * Subscribe to state changes from a node
   */
  subscribe<T>(nodeId: ID, callback: (state: T) => void): () => void {
    return this.registry.subscribe(nodeId, callback);
  }
}

/**
 * Utility functions for creating view definitions
 */
export const ViewUtils = {
  /**
   * Create a simple view definition
   */
  view<T, R>(nodeId: ID, selector: (state: T) => R): ViewDefinition<T, R> {
    return { nodeId, selector };
  },

  /**
   * Create a cached view definition
   */
  cachedView<T, R>(
    nodeId: ID, 
    selector: (state: T) => R, 
    ttl: number = 60000,
    cacheKey?: string
  ): ViewDefinition<T, R> {
    return { nodeId, selector, ttl, cacheKey };
  },

  /**
   * Create a lens-based view (for deep property access)
   */
  lens<T, R>(nodeId: ID, path: string): ViewDefinition<T, R> {
    return {
      nodeId,
      selector: (state: T) => {
        const keys = path.split('.');
        let current: any = state;
        
        for (const key of keys) {
          if (current == null) {
            return undefined as R;
          }
          current = current[key];
        }
        
        return current as R;
      },
      cacheKey: `${nodeId}:lens:${path}`,
    };
  },

  /**
   * Create a filtered view
   */
  filter<T extends any[], R>(
    nodeId: ID,
    selector: (state: any) => T,
    predicate: (item: T[0]) => boolean
  ): ViewDefinition<any, R[]> {
    return {
      nodeId,
      selector: (state) => {
        const array = selector(state);
        return Array.isArray(array) ? array.filter(predicate) as R[] : [] as R[];
      },
    };
  },

  /**
   * Create a mapped view
   */
  map<T extends any[], K>(
    nodeId: ID,
    selector: (state: any) => T,
    mapper: (item: T[0]) => K
  ): ViewDefinition<any, K[]> {
    return {
      nodeId,
      selector: (state) => {
        const array = selector(state);
        return Array.isArray(array) ? array.map(mapper) : [];
      },
    };
  },

  /**
   * Create an aggregated view
   */
  reduce<T extends any[], R>(
    nodeId: ID,
    selector: (state: any) => T,
    reducer: (acc: R, item: T[0]) => R,
    initialValue: R
  ): ViewDefinition<any, R> {
    return {
      nodeId,
      selector: (state) => {
        const array = selector(state);
        return Array.isArray(array) ? array.reduce(reducer, initialValue) : initialValue;
      },
    };
  },
};

/**
 * Create a global view registry singleton
 */
let globalViewRegistry: ViewRegistry | null = null;

/**
 * Get the global view registry
 */
export function getGlobalViewRegistry(): ViewRegistry {
  if (!globalViewRegistry) {
    globalViewRegistry = new ViewRegistry();
  }
  return globalViewRegistry;
}

/**
 * Create an enhanced view collection
 */
export function createViewCollection(registry?: ViewRegistry): EnhancedViewCollection {
  const reg = registry || getGlobalViewRegistry();
  return new EnhancedViewCollectionImpl(reg);
}