/**
 * State management for Happen nodes
 */

import { NodeState, ViewCollection, ID } from '../types';
import { EnhancedViewCollection, getGlobalViewRegistry } from '../views';

/**
 * Create a node state container
 */
export class NodeStateContainer<T> implements NodeState<T> {
  private state: T;
  private listeners: Set<(state: T) => void> = new Set();
  private eventWatchers = new Map<ID, Set<(state: T) => void>>();
  private views: EnhancedViewCollection;
  
  constructor(initialState: T, _nodeId?: ID) {
    this.state = initialState;
    this.views = this.createViewCollection();
  }
  
  /**
   * Get the current state or a selected portion
   */
  get(): T;
  get<R>(selector: (state: T) => R): R;
  get<R>(selector?: (state: T) => R): T | R {
    if (!selector) {
      return this.state;
    }
    return selector(this.state);
  }
  
  /**
   * Update the state
   */
  set(updater: (state: T, views?: ViewCollection) => T): void {
    const newState = updater(this.state, this.createLegacyViewCollection());
    if (newState !== this.state) {
      this.state = newState;
      this.notifyListeners();
    }
  }
  
  /**
   * Watch for state changes when a specific event occurs
   */
  when(eventId: ID, callback: (state: T) => void): void {
    if (!this.eventWatchers.has(eventId)) {
      this.eventWatchers.set(eventId, new Set());
    }
    this.eventWatchers.get(eventId)!.add(callback);
  }
  
  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  /**
   * Notify event-specific watchers
   */
  notifyEvent(eventId: ID): void {
    const watchers = this.eventWatchers.get(eventId);
    if (watchers) {
      watchers.forEach(watcher => watcher(this.state));
      this.eventWatchers.delete(eventId);
    }
  }
  
  /**
   * Create a snapshot of the current state
   */
  snapshot(): T {
    // Deep clone for complex objects
    return JSON.parse(JSON.stringify(this.state));
  }
  
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.state));
  }

  /**
   * Get the enhanced view collection for cross-node state access
   */
  getViews(): EnhancedViewCollection {
    return this.views;
  }

  /**
   * Create the enhanced view collection
   */
  private createViewCollection(): EnhancedViewCollection {
    const registry = getGlobalViewRegistry();
    return {
      collect: registry.collect.bind(registry),
      get: registry.getState.bind(registry),
      cache: registry.cache.bind(registry),
      getCached: registry.getCached.bind(registry),
      clearCache: registry.clearCache.bind(registry),
      subscribe: registry.subscribe.bind(registry),
    };
  }

  /**
   * Create legacy view collection for backward compatibility
   */
  private createLegacyViewCollection(): ViewCollection {
    const registry = getGlobalViewRegistry();
    const legacyViews: any = {
      collect: <T extends Record<string, any>>(selectors: {
        [K in keyof T]: (state: any) => T[K]
      }): T => {
        const result = {} as T;
        
        // Iterate through selectors and collect data from nodes
        for (const [key, selector] of Object.entries(selectors)) {
          // Find a node that matches the key
          const nodeId = registry.getRegisteredNodes().find(id => 
            id.toLowerCase().includes(key.toString().toLowerCase())
          );
          
          if (nodeId) {
            try {
              // Use the registry's synchronous getStateSync method
              const value = registry.getStateSync(nodeId, selector);
              result[key as keyof T] = value as T[keyof T];
            } catch {
              // Silently handle errors, return undefined for that key
              result[key as keyof T] = undefined as T[keyof T];
            }
          }
        }
        
        return result;
      }
    };
    
    // Create proxy objects for each registered node
    for (const nodeId of registry.getRegisteredNodes()) {
      legacyViews[nodeId] = {
        get: <T, R>(selector: (state: T) => R): R => {
          try {
            // Use synchronous version for backward compatibility
            return registry.getStateSync(nodeId, selector);
          } catch {
            return undefined as R;
          }
        }
      };
    }
    
    return legacyViews as ViewCollection;
  }
}

/**
 * State lens for focused access
 */
export class StateLens<T, R> {
  constructor(
    private state: NodeState<T>,
    private selector: (state: T) => R,
    private updater: (state: T, value: R) => T
  ) {}
  
  get(): R {
    return this.state.get(this.selector);
  }
  
  set(value: R): void {
    this.state.set(state => this.updater(state, value));
  }
  
  update(fn: (value: R) => R): void {
    this.state.set(state => {
      const current = this.selector(state);
      const updated = fn(current);
      return this.updater(state, updated);
    });
  }
}

/**
 * Create a lens for nested state access
 */
export function lens<T, R>(
  selector: (state: T) => R,
  updater: (state: T, value: R) => T
): (state: NodeState<T>) => StateLens<T, R> {
  return (state) => new StateLens(state, selector, updater);
}

/**
 * Helper to create a lens from a path
 */
export function pathLens<T>(path: string): (state: NodeState<T>) => StateLens<T, any> {
  const keys = path.split('.');
  
  const selector = (state: T): any => {
    let current: any = state;
    for (const key of keys) {
      if (current == null) return undefined;
      current = current[key];
    }
    return current;
  };
  
  const updater = (state: T, value: any): T => {
    const stateCopy: any = { ...state };
    let current = stateCopy;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!key) continue;
      current[key] = { ...current[key] };
      current = current[key];
    }
    
    const lastKey = keys[keys.length - 1];
    if (lastKey) {
      current[lastKey] = value;
    }
    return stateCopy;
  };
  
  return lens(selector, updater);
}

/**
 * State helpers for common operations
 */
export const stateHelpers = {
  /**
   * Merge partial state updates
   */
  merge<T extends object>(updates: Partial<T>): (state: T) => T {
    return (state) => ({ ...state, ...updates });
  },
  
  /**
   * Update a nested property
   */
  setIn<T>(path: string, value: any): (state: T) => T {
    return (state) => {
      const keys = path.split('.');
      const stateCopy: any = { ...state };
      let current = stateCopy;
      
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!key) continue;
        current[key] = { ...current[key] };
        current = current[key];
      }
      
      const lastKey = keys[keys.length - 1];
      if (lastKey) {
        current[lastKey] = value;
      }
      return stateCopy;
    };
  },
  
  /**
   * Update an array item
   */
  updateAt<T>(index: number, updater: (item: T) => T): (array: T[]) => T[] {
    return (array) => array.map((item, i) => (i === index ? updater(item) : item));
  },
  
  /**
   * Remove an array item
   */
  removeAt<T>(index: number): (array: T[]) => T[] {
    return (array) => array.filter((_, i) => i !== index);
  },
};