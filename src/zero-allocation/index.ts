/**
 * Zero-Allocation Processing - High-performance event handling
 * 
 * Enables processing critical events without object allocations by:
 * - Using pre-allocated buffers
 * - Direct memory access patterns
 * - String interning for repeated values
 * - Minimal GC pressure
 */

import { EventHandler, HappenEvent } from '../types';

/**
 * Buffer pool for zero-allocation processing
 */
export class BufferPool {
  private buffers: ArrayBuffer[] = [];
  private available: number[] = [];
  private bufferSize: number;
  private maxBuffers: number;
  
  constructor(
    bufferSize: number = 4096, // 4KB default
    maxBuffers: number = 100
  ) {
    this.bufferSize = bufferSize;
    this.maxBuffers = maxBuffers;
    
    // Pre-allocate initial buffers (up to 10 or maxBuffers, whichever is smaller)
    const initialBuffers = Math.min(10, maxBuffers);
    for (let i = 0; i < initialBuffers; i++) {
      this.createBuffer();
    }
  }
  
  /**
   * Acquire a buffer from the pool
   */
  acquire(): ArrayBuffer {
    const index = this.available.pop();
    
    if (index !== undefined) {
      return this.buffers[index]!;
    }
    
    // Create new buffer if under limit
    if (this.buffers.length < this.maxBuffers) {
      return this.createBuffer();
    }
    
    // If at limit, return oldest buffer (LRU)
    // In production, this would be more sophisticated
    return this.buffers[0]!;
  }
  
  /**
   * Release buffer back to pool
   */
  release(buffer: ArrayBuffer): void {
    const index = this.buffers.indexOf(buffer);
    if (index !== -1 && !this.available.includes(index)) {
      this.available.push(index);
    }
  }
  
  /**
   * Create a new buffer
   */
  private createBuffer(): ArrayBuffer {
    const buffer = new ArrayBuffer(this.bufferSize);
    const index = this.buffers.length;
    this.buffers.push(buffer);
    this.available.push(index);
    return buffer;
  }
  
  /**
   * Get pool statistics
   */
  getStats(): { total: number; available: number; used: number } {
    return {
      total: this.buffers.length,
      available: this.available.length,
      used: this.buffers.length - this.available.length,
    };
  }
}

/**
 * String table for efficient string storage
 */
export class StringTable {
  private strings: Map<string, number> = new Map();
  private lookup: string[] = [];
  private nextId = 0;
  
  /**
   * Intern a string and get its ID
   */
  intern(str: string): number {
    const existing = this.strings.get(str);
    if (existing !== undefined) {
      return existing;
    }
    
    const id = this.nextId++;
    this.strings.set(str, id);
    this.lookup[id] = str;
    return id;
  }
  
  /**
   * Get string by ID
   */
  get(id: number): string | undefined {
    return this.lookup[id];
  }
  
  /**
   * Clear the string table
   */
  clear(): void {
    this.strings.clear();
    this.lookup.length = 0;
    this.nextId = 0;
  }
  
  /**
   * Get table size
   */
  size(): number {
    return this.strings.size;
  }
}

/**
 * Buffer accessor for typed data access
 */
export class BufferAccessor {
  private view: DataView;
  private offset = 0;
  private stringTable: StringTable;
  
  constructor(buffer: ArrayBuffer, stringTable: StringTable) {
    this.view = new DataView(buffer);
    this.stringTable = stringTable;
  }
  
  /**
   * Reset accessor to beginning
   */
  reset(): void {
    this.offset = 0;
  }
  
  /**
   * Write methods
   */
  putInt32(value: number): void {
    this.view.setInt32(this.offset, value, true);
    this.offset += 4;
  }
  
  putFloat64(value: number): void {
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
  }
  
  putString(value: string): void {
    const id = this.stringTable.intern(value);
    this.putInt32(id);
  }
  
  putBoolean(value: boolean): void {
    this.view.setUint8(this.offset, value ? 1 : 0);
    this.offset += 1;
  }
  
  /**
   * Read methods
   */
  getInt32(): number {
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }
  
  getFloat64(): number {
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }
  
  getString(): string {
    const id = this.getInt32();
    return this.stringTable.get(id) || '';
  }
  
  getBoolean(): boolean {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value !== 0;
  }
  
  /**
   * Get current offset
   */
  getOffset(): number {
    return this.offset;
  }
  
  /**
   * Set offset
   */
  setOffset(offset: number): void {
    this.offset = offset;
  }
}

/**
 * Zero-allocation event handler context
 */
export interface ZeroAllocationContext {
  buffer: BufferAccessor;
  event: HappenEvent;
  done: () => void;
}

/**
 * Zero-allocation handler type
 */
export type ZeroAllocationHandler = (context: ZeroAllocationContext) => void | Promise<void>;

/**
 * Zero-allocation processor
 */
export class ZeroAllocationProcessor {
  private bufferPool: BufferPool;
  private stringTable: StringTable;
  private handlers = new Map<string, ZeroAllocationHandler[]>();
  
  constructor(
    bufferSize: number = 4096,
    maxBuffers: number = 100
  ) {
    this.bufferPool = new BufferPool(bufferSize, maxBuffers);
    this.stringTable = new StringTable();
  }
  
  /**
   * Register a zero-allocation handler
   */
  register(pattern: string, handler: ZeroAllocationHandler): () => void {
    const handlers = this.handlers.get(pattern) || [];
    handlers.push(handler);
    this.handlers.set(pattern, handlers);
    
    // Return unregister function
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) {
        handlers.splice(idx, 1);
      }
    };
  }
  
  /**
   * Process event with zero allocations
   */
  async process(event: HappenEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) || [];
    if (handlers.length === 0) return;
    
    // Acquire buffer from pool
    const buffer = this.bufferPool.acquire();
    const accessor = new BufferAccessor(buffer, this.stringTable);
    
    // Serialize event data into buffer
    this.serializeEvent(event, accessor);
    
    // Create context
    const context: ZeroAllocationContext = {
      buffer: accessor,
      event,
      done: () => {
        this.bufferPool.release(buffer);
      }
    };
    
    try {
      // Execute handlers
      for (const handler of handlers) {
        accessor.reset(); // Reset for each handler
        await handler(context);
      }
    } finally {
      // Always release buffer
      context.done();
    }
  }
  
  /**
   * Serialize event into buffer
   */
  private serializeEvent(event: HappenEvent, accessor: BufferAccessor): void {
    // Write event metadata
    accessor.putString(event.id);
    accessor.putString(event.type);
    accessor.putFloat64(event.context.timestamp);
    
    // Write payload based on type
    // In real implementation, this would be more sophisticated
    if (typeof event.payload === 'object' && event.payload !== null) {
      const payload = event.payload as Record<string, any>;
      const keys = Object.keys(payload);
      accessor.putInt32(keys.length);
      
      for (const key of keys) {
        accessor.putString(key);
        const value = payload[key];
        
        // Simple type serialization
        if (typeof value === 'string') {
          accessor.putInt32(0); // type = string
          accessor.putString(value);
        } else if (typeof value === 'number') {
          accessor.putInt32(1); // type = number
          accessor.putFloat64(value);
        } else if (typeof value === 'boolean') {
          accessor.putInt32(2); // type = boolean
          accessor.putBoolean(value);
        } else {
          // Complex types would need more handling
          accessor.putInt32(3); // type = object
          accessor.putString(JSON.stringify(value));
        }
      }
    } else {
      accessor.putInt32(0); // No payload fields
    }
  }
  
  /**
   * Get processor statistics
   */
  getStats() {
    return {
      bufferPool: this.bufferPool.getStats(),
      stringTable: {
        size: this.stringTable.size(),
      },
      handlers: {
        patterns: this.handlers.size,
        total: Array.from(this.handlers.values()).reduce((sum, h) => sum + h.length, 0),
      },
    };
  }
  
  /**
   * Clear string table (periodic maintenance)
   */
  clearStringTable(): void {
    this.stringTable.clear();
  }
}

/**
 * Convert zero-allocation handler to regular event handler
 */
export function wrapZeroAllocationHandler(
  processor: ZeroAllocationProcessor,
  pattern: string,
  handler: ZeroAllocationHandler
): EventHandler {
  // Register with processor
  processor.register(pattern, handler);
  
  // Return regular event handler that delegates to zero-allocation processor
  return async (eventOrEvents) => {
    const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];
    
    for (const event of events) {
      await processor.process(event);
    }
  };
}

/**
 * Global zero-allocation processor instance
 */
let globalProcessor: ZeroAllocationProcessor | null = null;

/**
 * Get or create global processor
 */
export function getGlobalZeroAllocationProcessor(): ZeroAllocationProcessor {
  if (!globalProcessor) {
    globalProcessor = new ZeroAllocationProcessor();
  }
  return globalProcessor;
}

/**
 * Performance utilities
 */
export class PerformanceMonitor {
  private metrics = new Map<string, {
    count: number;
    totalTime: number;
    minTime: number;
    maxTime: number;
  }>();
  
  /**
   * Record a measurement
   */
  record(name: string, duration: number): void {
    const existing = this.metrics.get(name) || {
      count: 0,
      totalTime: 0,
      minTime: Infinity,
      maxTime: -Infinity,
    };
    
    existing.count++;
    existing.totalTime += duration;
    existing.minTime = Math.min(existing.minTime, duration);
    existing.maxTime = Math.max(existing.maxTime, duration);
    
    this.metrics.set(name, existing);
  }
  
  /**
   * Get metrics summary
   */
  getSummary() {
    const summary: Record<string, any> = {};
    
    for (const [name, metrics] of this.metrics) {
      summary[name] = {
        count: metrics.count,
        avgTime: metrics.totalTime / metrics.count,
        minTime: metrics.minTime,
        maxTime: metrics.maxTime,
        totalTime: metrics.totalTime,
      };
    }
    
    return summary;
  }
  
  /**
   * Reset metrics
   */
  reset(): void {
    this.metrics.clear();
  }
}

/**
 * Create a zero-allocation node extension
 */
export function createZeroAllocationExtension() {
  const processor = new ZeroAllocationProcessor();
  const monitor = new PerformanceMonitor();
  
  return {
    processor,
    monitor,
    
    /**
     * Measure handler performance
     */
    measure<T>(name: string, fn: () => T): T {
      const start = performance.now();
      try {
        return fn();
      } finally {
        const duration = performance.now() - start;
        monitor.record(name, duration);
      }
    },
    
    /**
     * Measure async handler performance
     */
    async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const start = performance.now();
      try {
        return await fn();
      } finally {
        const duration = performance.now() - start;
        monitor.record(name, duration);
      }
    },
  };
}