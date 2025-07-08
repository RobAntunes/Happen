/**
 * Temporal State - Historical state access with event context
 * 
 * This module provides access to historical state snapshots linked to the events
 * that created them, backed by NATS JetStream KV store.
 */

import { ID, EventContext, HappenEvent } from '../types';
import { NatsConnection, KV, JetStreamClient, StorageType } from 'nats';

/**
 * A snapshot of state at a point in time, linked to the event that caused it
 */
export interface StateSnapshot<T = any> {
  state: T;
  context: EventContext & {
    eventType: string;
  };
}

/**
 * Pattern matcher for temporal queries
 */
export type TemporalPattern = 
  | ID // Direct event ID match
  | ((snapshot: StateSnapshot) => boolean); // Function matcher

/**
 * Temporal state store interface
 */
export interface TemporalStateStore<T = any> {
  /**
   * Record a state snapshot linked to an event
   */
  record(event: HappenEvent, state: T): Promise<void>;
  
  /**
   * Query historical state by event pattern
   */
  when(pattern: TemporalPattern, callback: (snapshots: StateSnapshot<T>[]) => any): Promise<any>;
  
  /**
   * Get a specific snapshot by event ID
   */
  getSnapshot(eventId: ID): Promise<StateSnapshot<T> | null>;
  
  /**
   * Get all snapshots in a causal chain
   */
  getCausalChain(eventId: ID): Promise<StateSnapshot<T>[]>;
  
  /**
   * Get all snapshots in a correlation (transaction)
   */
  getCorrelation(correlationId: string): Promise<StateSnapshot<T>[]>;
  
  /**
   * Clear historical data (for testing)
   */
  clear(): Promise<void>;
}

/**
 * NATS-backed implementation of temporal state store
 */
export class NatsTemporalStore<T = any> implements TemporalStateStore<T> {
  private kv?: KV;
  private js?: JetStreamClient;
  private bucketName: string;
  private ttl: number;
  
  constructor(
    private nodeId: ID,
    private nc: NatsConnection,
    private config: TemporalStateConfig = { enabled: true }
  ) {
    this.bucketName = `happen_temporal_${this.nodeId}`;
    this.ttl = this.parseTTL(config.maxAge || '30d');
  }
  
  async init(): Promise<void> {
    if (!this.nc) {
      throw new Error('NATS connection required for temporal state');
    }
    
    const jsm = await this.nc.jetstreamManager();
    this.js = this.nc.jetstream();
    
    // Create or access the KV bucket for this node
    try {
      this.kv = await this.js.views.kv(this.bucketName, {
        history: this.config.history || 100,
        ttl: this.ttl,
      });
    } catch (error) {
      // Bucket doesn't exist, create it
      await jsm.streams.add({
        name: this.bucketName,
        subjects: [`$KV.${this.bucketName}.>`],
        storage: StorageType.File,
        max_msgs_per_subject: this.config.history || 100,
        max_age: this.ttl * 1_000_000, // Convert ms to ns
      });
      
      this.kv = await this.js.views.kv(this.bucketName);
    }
  }
  
  async record(event: HappenEvent, state: T): Promise<void> {
    if (!this.kv) await this.init();
    
    const snapshot: StateSnapshot<T> = {
      state: JSON.parse(JSON.stringify(state)), // Deep clone
      context: {
        ...event.context,
        eventType: event.type
      }
    };
    
    // Store snapshot by event ID
    await this.kv!.put(`event:${event.id}`, JSON.stringify(snapshot));
    
    // Store in causal index if has causation
    if (event.context.causal.causationId) {
      const indexKey = `causal:${event.context.causal.causationId}`;
      const existing = await this.getIndex(indexKey);
      existing.add(event.id);
      await this.kv!.put(indexKey, JSON.stringify(Array.from(existing)));
    }
    
    // Store in correlation index if has correlation
    if (event.context.causal.correlationId) {
      const indexKey = `correlation:${event.context.causal.correlationId}`;
      const existing = await this.getIndex(indexKey);
      existing.add(event.id);
      await this.kv!.put(indexKey, JSON.stringify(Array.from(existing)));
    }
    
    // Store in type index
    const typeKey = `type:${event.type}`;
    const typeIndex = await this.getIndex(typeKey);
    typeIndex.add(event.id);
    await this.kv!.put(typeKey, JSON.stringify(Array.from(typeIndex)));
  }
  
  async when(pattern: TemporalPattern, callback: (snapshots: StateSnapshot<T>[]) => any): Promise<any> {
    if (!this.kv) await this.init();
    
    const matchingSnapshots: StateSnapshot<T>[] = [];
    
    if (typeof pattern === 'string') {
      // Direct event ID match
      const snapshot = await this.getSnapshot(pattern);
      if (snapshot) {
        matchingSnapshots.push(snapshot);
      }
    } else {
      // Function matcher - need to scan all events
      const keys = await this.kv!.keys();
      for await (const key of keys) {
        if (key.startsWith('event:')) {
          const entry = await this.kv!.get(key);
          if (entry?.value) {
            const snapshot = JSON.parse(new TextDecoder().decode(entry.value)) as StateSnapshot<T>;
            if (pattern(snapshot)) {
              matchingSnapshots.push(snapshot);
            }
          }
        }
      }
    }
    
    // Sort by timestamp for consistent ordering
    matchingSnapshots.sort((a, b) => a.context.timestamp - b.context.timestamp);
    
    return callback(matchingSnapshots);
  }
  
  async getSnapshot(eventId: ID): Promise<StateSnapshot<T> | null> {
    if (!this.kv) await this.init();
    
    const entry = await this.kv!.get(`event:${eventId}`);
    if (!entry?.value) return null;
    
    return JSON.parse(new TextDecoder().decode(entry.value)) as StateSnapshot<T>;
  }
  
  async getCausalChain(eventId: ID): Promise<StateSnapshot<T>[]> {
    if (!this.kv) await this.init();
    
    const chain: StateSnapshot<T>[] = [];
    const visited = new Set<ID>();
    
    const traverse = async (id: ID) => {
      if (visited.has(id)) return;
      visited.add(id);
      
      const snapshot = await this.getSnapshot(id);
      if (snapshot) {
        chain.push(snapshot);
        
        // Find all events caused by this one
        const causedIds = await this.getIndex(`causal:${id}`);
        for (const causedId of causedIds) {
          await traverse(causedId);
        }
      }
    };
    
    await traverse(eventId);
    
    // Sort by timestamp
    return chain.sort((a, b) => a.context.timestamp - b.context.timestamp);
  }
  
  async getCorrelation(correlationId: string): Promise<StateSnapshot<T>[]> {
    if (!this.kv) await this.init();
    
    const eventIds = await this.getIndex(`correlation:${correlationId}`);
    const snapshots: StateSnapshot<T>[] = [];
    
    for (const eventId of eventIds) {
      const snapshot = await this.getSnapshot(eventId);
      if (snapshot) {
        snapshots.push(snapshot);
      }
    }
    
    // Sort by timestamp to show transaction flow
    return snapshots.sort((a, b) => a.context.timestamp - b.context.timestamp);
  }
  
  async clear(): Promise<void> {
    if (!this.kv) await this.init();
    
    // Delete all keys
    const keys = await this.kv!.keys();
    for await (const key of keys) {
      await this.kv!.delete(key);
    }
  }
  
  private async getIndex(key: string): Promise<Set<ID>> {
    const entry = await this.kv!.get(key);
    if (!entry?.value) return new Set();
    
    const ids = JSON.parse(new TextDecoder().decode(entry.value)) as ID[];
    return new Set(ids);
  }
  
  private parseTTL(maxAge: string): number {
    const match = maxAge.match(/^(\d+)([dhms])$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000; // Default 30 days
    
    const [, num, unit] = match;
    const value = parseInt(num || '30', 10);
    
    switch (unit) {
      case 'd': return value * 24 * 60 * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'm': return value * 60 * 1000;
      case 's': return value * 1000;
      default: return 30 * 24 * 60 * 60 * 1000;
    }
  }
}

/**
 * In-memory implementation for testing and development
 */
export class InMemoryTemporalStore<T = any> implements TemporalStateStore<T> {
  private snapshots = new Map<ID, StateSnapshot<T>>();
  private causalIndex = new Map<ID, Set<ID>>(); // causationId -> [eventIds]
  private correlationIndex = new Map<string, Set<ID>>(); // correlationId -> [eventIds]
  
  async record(event: HappenEvent, state: T): Promise<void> {
    const snapshot: StateSnapshot<T> = {
      state: JSON.parse(JSON.stringify(state)), // Deep clone
      context: {
        ...event.context,
        eventType: event.type
      }
    };
    
    // Store the snapshot
    this.snapshots.set(event.id, snapshot);
    
    // Update indexes
    if (event.context.causal.causationId) {
      if (!this.causalIndex.has(event.context.causal.causationId)) {
        this.causalIndex.set(event.context.causal.causationId, new Set());
      }
      this.causalIndex.get(event.context.causal.causationId)!.add(event.id);
    }
    
    if (event.context.causal.correlationId) {
      if (!this.correlationIndex.has(event.context.causal.correlationId)) {
        this.correlationIndex.set(event.context.causal.correlationId, new Set());
      }
      this.correlationIndex.get(event.context.causal.correlationId)!.add(event.id);
    }
  }
  
  async when(pattern: TemporalPattern, callback: (snapshots: StateSnapshot<T>[]) => any): Promise<any> {
    const matchingSnapshots: StateSnapshot<T>[] = [];
    
    if (typeof pattern === 'string') {
      // Direct event ID match
      const snapshot = this.snapshots.get(pattern);
      if (snapshot) {
        matchingSnapshots.push(snapshot);
      }
    } else {
      // Function matcher
      for (const snapshot of this.snapshots.values()) {
        if (pattern(snapshot)) {
          matchingSnapshots.push(snapshot);
        }
      }
    }
    
    // Sort by timestamp for consistent ordering
    matchingSnapshots.sort((a, b) => a.context.timestamp - b.context.timestamp);
    
    return callback(matchingSnapshots);
  }
  
  async getSnapshot(eventId: ID): Promise<StateSnapshot<T> | null> {
    return this.snapshots.get(eventId) || null;
  }
  
  async getCausalChain(eventId: ID): Promise<StateSnapshot<T>[]> {
    const chain: StateSnapshot<T>[] = [];
    const visited = new Set<ID>();
    
    const traverse = (id: ID) => {
      if (visited.has(id)) return;
      visited.add(id);
      
      const snapshot = this.snapshots.get(id);
      if (snapshot) {
        chain.push(snapshot);
        
        // Find all events caused by this one
        const caused = this.causalIndex.get(id);
        if (caused) {
          for (const causedId of caused) {
            traverse(causedId);
          }
        }
      }
    };
    
    traverse(eventId);
    
    // Sort by timestamp
    return chain.sort((a, b) => a.context.timestamp - b.context.timestamp);
  }
  
  async getCorrelation(correlationId: string): Promise<StateSnapshot<T>[]> {
    const eventIds = this.correlationIndex.get(correlationId);
    if (!eventIds) return [];
    
    const snapshots: StateSnapshot<T>[] = [];
    for (const eventId of eventIds) {
      const snapshot = this.snapshots.get(eventId);
      if (snapshot) {
        snapshots.push(snapshot);
      }
    }
    
    // Sort by timestamp to show transaction flow
    return snapshots.sort((a, b) => a.context.timestamp - b.context.timestamp);
  }
  
  async clear(): Promise<void> {
    this.snapshots.clear();
    this.causalIndex.clear();
    this.correlationIndex.clear();
  }
}

/**
 * Configuration for temporal state
 */
export interface TemporalStateConfig {
  enabled: boolean;
  history?: number; // Number of versions to keep
  maxAge?: string; // How long to keep history (e.g., "30d")
  subject?: string; // Event pattern to track (e.g., "order.*")
}

/**
 * Global temporal state registry
 */
class TemporalStateRegistry {
  private stores = new Map<ID, TemporalStateStore>();
  private natsConnection?: NatsConnection;
  private useNats: boolean = false;
  
  setNatsConnection(nc: NatsConnection): void {
    this.natsConnection = nc;
    this.useNats = true;
  }
  
  getStore<T>(nodeId: ID, config?: TemporalStateConfig): TemporalStateStore<T> {
    if (!this.stores.has(nodeId)) {
      if (this.useNats && this.natsConnection) {
        const store = new NatsTemporalStore<T>(nodeId, this.natsConnection, config);
        this.stores.set(nodeId, store);
      } else {
        this.stores.set(nodeId, new InMemoryTemporalStore<T>());
      }
    }
    return this.stores.get(nodeId) as TemporalStateStore<T>;
  }
  
  async clearStore(nodeId: ID): Promise<void> {
    const store = this.stores.get(nodeId);
    if (store) {
      await store.clear();
      this.stores.delete(nodeId);
    }
  }
  
  async clearAll(): Promise<void> {
    for (const store of this.stores.values()) {
      await store.clear();
    }
    this.stores.clear();
  }
}

// Global instance
const globalTemporalRegistry = new TemporalStateRegistry();

export function getTemporalStore<T>(nodeId: ID, config?: TemporalStateConfig): TemporalStateStore<T> {
  return globalTemporalRegistry.getStore<T>(nodeId, config);
}

export function clearTemporalStore(nodeId: ID): Promise<void> {
  return globalTemporalRegistry.clearStore(nodeId);
}

export function clearAllTemporalStores(): Promise<void> {
  return globalTemporalRegistry.clearAll();
}

export function setNatsConnection(nc: NatsConnection): void {
  globalTemporalRegistry.setNatsConnection(nc);
}

/**
 * Helper functions for working with temporal state
 */
export const TemporalHelpers = {
  /**
   * Find all events caused by a specific event
   */
  findCausedBy: (causationId: ID) => (snapshot: StateSnapshot) => 
    snapshot.context.causal.causationId === causationId,
  
  /**
   * Find all events in a transaction
   */
  findInTransaction: (correlationId: string) => (snapshot: StateSnapshot) =>
    snapshot.context.causal.correlationId === correlationId,
  
  /**
   * Find events by type
   */
  findByType: (eventType: string) => (snapshot: StateSnapshot) =>
    snapshot.context.eventType === eventType,
  
  /**
   * Find events from a specific sender
   */
  findBySender: (sender: string) => (snapshot: StateSnapshot) =>
    snapshot.context.causal.sender === sender,
  
  /**
   * Find events within a time range
   */
  findInTimeRange: (start: number, end: number) => (snapshot: StateSnapshot) =>
    snapshot.context.timestamp >= start && snapshot.context.timestamp <= end,
};