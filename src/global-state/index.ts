/**
 * Global state implementation with NATS KV backing
 */

import { GlobalState } from '../types';
import { NATSTransport } from '../transport/nats';

/**
 * NATS Key-Value backed global state for distributed systems
 */
export class NATSGlobalState implements GlobalState {
  private kvStore: any = null;
  private watchers = new Map<string, Set<(value: any) => void>>();
  private watchSubs = new Map<string, any>();
  
  constructor(private natsTransport: NATSTransport, private bucketName: string = 'happen-global-state') {}
  
  private async ensureKVStore(): Promise<any> {
    if (!this.kvStore) {
      try {
        this.kvStore = await this.natsTransport.getKeyValue(this.bucketName);
      } catch (error) {
        // Bucket doesn't exist, create it
        this.kvStore = await this.natsTransport.createKeyValueBucket(this.bucketName);
      }
    }
    return this.kvStore;
  }
  
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const kv = await this.ensureKVStore();
      const entry = await kv.get(key);
      return entry?.value ? JSON.parse(new TextDecoder().decode(entry.value)) : undefined;
    } catch (error) {
      if ((error as any).code === 'not_found') {
        return undefined;
      }
      throw error;
    }
  }
  
  async set<T>(key: string, value: T): Promise<void> {
    const kv = await this.ensureKVStore();
    const data = new TextEncoder().encode(JSON.stringify(value));
    await kv.put(key, data);
    
    // Notify local watchers immediately
    this.notifyWatchers(key, value);
  }
  
  async delete(key: string): Promise<void> {
    const kv = await this.ensureKVStore();
    await kv.delete(key);
    
    // Notify local watchers immediately
    this.notifyWatchers(key, undefined);
  }
  
  watch<T>(key: string, callback: (value: T | undefined) => void): () => void {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, new Set());
      this.setupKVWatch(key);
    }
    
    this.watchers.get(key)!.add(callback);
    
    // Call with current value
    this.get(key).then(value => callback(value as T));
    
    // Return unsubscribe function
    return () => {
      const watchers = this.watchers.get(key);
      if (watchers) {
        watchers.delete(callback);
        if (watchers.size === 0) {
          this.watchers.delete(key);
          this.cleanupKVWatch(key);
        }
      }
    };
  }
  
  private async setupKVWatch(key: string): Promise<void> {
    try {
      const kv = await this.ensureKVStore();
      const watchSub = await kv.watch({
        key,
        include_history: false,
      });
      
      this.watchSubs.set(key, watchSub);
      
      // Process watch events
      (async () => {
        for await (const entry of watchSub) {
          if (entry.operation === 'PUT' || entry.operation === 'DEL') {
            const value = entry.value ? JSON.parse(new TextDecoder().decode(entry.value)) : undefined;
            this.notifyWatchers(key, value);
          }
        }
      })().catch(error => {
        console.error('KV watch error:', error);
      });
      
    } catch (error) {
      console.error('Failed to setup KV watch:', error);
    }
  }
  
  private cleanupKVWatch(key: string): void {
    const watchSub = this.watchSubs.get(key);
    if (watchSub) {
      watchSub.stop();
      this.watchSubs.delete(key);
    }
  }
  
  private notifyWatchers(key: string, value: any): void {
    const watchers = this.watchers.get(key);
    if (watchers) {
      watchers.forEach(callback => {
        try {
          callback(value);
        } catch (error) {
          console.error('Global state watcher error:', error);
        }
      });
    }
  }
  
  async close(): Promise<void> {
    // Clean up all watchers
    for (const [key] of this.watchSubs) {
      this.cleanupKVWatch(key);
    }
    this.watchers.clear();
    this.watchSubs.clear();
  }
}

/**
 * In-memory global state for development and testing
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