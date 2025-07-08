/**
 * Global state implementation (will be backed by NATS KV)
 */

import { GlobalState } from '../types';

/**
 * In-memory global state for development
 * Will be replaced with NATS KV in production
 */
export class InMemoryGlobalState implements GlobalState {
  private store = new Map<string, any>();
  private watchers = new Map<string, Set<(value: any) => void>>();
  
  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key);
  }
  
  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
    this.notifyWatchers(key, value);
  }
  
  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.notifyWatchers(key, undefined);
  }
  
  watch<T>(key: string, callback: (value: T | undefined) => void): () => void {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, new Set());
    }
    
    this.watchers.get(key)!.add(callback);
    
    // Call with current value
    callback(this.store.get(key));
    
    // Return unsubscribe function
    return () => {
      const watchers = this.watchers.get(key);
      if (watchers) {
        watchers.delete(callback);
        if (watchers.size === 0) {
          this.watchers.delete(key);
        }
      }
    };
  }
  
  private notifyWatchers(key: string, value: any): void {
    const watchers = this.watchers.get(key);
    if (watchers) {
      watchers.forEach(callback => callback(value));
    }
  }
}