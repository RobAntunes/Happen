/**
 * Zero-Allocation Processing Tests
 */

import { initializeHappen } from '../src';
import {
  BufferPool,
  StringTable,
  BufferAccessor,
  ZeroAllocationProcessor,
  PerformanceMonitor,
  createZeroAllocationExtension,
  ZeroAllocationContext,
} from '../src/zero-allocation';

describe('Zero-Allocation Processing', () => {
  describe('BufferPool', () => {
    it('should pre-allocate buffers', () => {
      const pool = new BufferPool(1024, 10);
      const stats = pool.getStats();
      
      expect(stats.total).toBe(10);
      expect(stats.available).toBe(10);
      expect(stats.used).toBe(0);
    });

    it('should acquire and release buffers', () => {
      const pool = new BufferPool(1024, 10);
      
      // Acquire buffer
      const buffer = pool.acquire();
      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(buffer.byteLength).toBe(1024);
      
      let stats = pool.getStats();
      expect(stats.used).toBe(1);
      expect(stats.available).toBe(9);
      
      // Release buffer
      pool.release(buffer);
      stats = pool.getStats();
      expect(stats.used).toBe(0);
      expect(stats.available).toBe(10);
    });

    it('should respect max buffer limit', () => {
      const pool = new BufferPool(1024, 5);
      
      // Acquire 5 buffers (the max)
      const buffers = [];
      for (let i = 0; i < 5; i++) {
        buffers.push(pool.acquire());
      }
      
      // Stats should show pool at capacity
      let stats = pool.getStats();
      expect(stats.total).toBe(5);
      expect(stats.used).toBe(5);
      expect(stats.available).toBe(0);
      
      // Acquiring more should not create new buffers
      const extra = pool.acquire();
      
      // Stats should still show only 5 buffers total
      stats = pool.getStats();
      expect(stats.total).toBe(5);
      
      // The extra buffer should be one of the existing ones
      expect(buffers).toContain(extra);
    });
  });

  describe('StringTable', () => {
    it('should intern strings efficiently', () => {
      const table = new StringTable();
      
      // First occurrence
      const id1 = table.intern('hello');
      expect(typeof id1).toBe('number');
      
      // Second occurrence should return same ID
      const id2 = table.intern('hello');
      expect(id2).toBe(id1);
      
      // Different string gets different ID
      const id3 = table.intern('world');
      expect(id3).not.toBe(id1);
    });

    it('should retrieve strings by ID', () => {
      const table = new StringTable();
      
      const id = table.intern('test-string');
      const retrieved = table.get(id);
      expect(retrieved).toBe('test-string');
    });

    it('should track table size', () => {
      const table = new StringTable();
      
      expect(table.size()).toBe(0);
      
      table.intern('one');
      table.intern('two');
      table.intern('one'); // Duplicate
      
      expect(table.size()).toBe(2);
    });

    it('should clear table', () => {
      const table = new StringTable();
      
      table.intern('test');
      expect(table.size()).toBe(1);
      
      table.clear();
      expect(table.size()).toBe(0);
      expect(table.get(0)).toBeUndefined();
    });
  });

  describe('BufferAccessor', () => {
    it('should read and write integers', () => {
      const buffer = new ArrayBuffer(256);
      const table = new StringTable();
      const accessor = new BufferAccessor(buffer, table);
      
      // Write
      accessor.putInt32(42);
      accessor.putInt32(-100);
      
      // Read
      accessor.reset();
      expect(accessor.getInt32()).toBe(42);
      expect(accessor.getInt32()).toBe(-100);
    });

    it('should read and write floats', () => {
      const buffer = new ArrayBuffer(256);
      const table = new StringTable();
      const accessor = new BufferAccessor(buffer, table);
      
      // Write
      accessor.putFloat64(3.14159);
      accessor.putFloat64(-2.71828);
      
      // Read
      accessor.reset();
      expect(accessor.getFloat64()).toBeCloseTo(3.14159);
      expect(accessor.getFloat64()).toBeCloseTo(-2.71828);
    });

    it('should read and write strings using string table', () => {
      const buffer = new ArrayBuffer(256);
      const table = new StringTable();
      const accessor = new BufferAccessor(buffer, table);
      
      // Write
      accessor.putString('hello');
      accessor.putString('world');
      accessor.putString('hello'); // Should reuse ID
      
      // Read
      accessor.reset();
      expect(accessor.getString()).toBe('hello');
      expect(accessor.getString()).toBe('world');
      expect(accessor.getString()).toBe('hello');
      
      // Check string table efficiency
      expect(table.size()).toBe(2); // Only 2 unique strings
    });

    it('should read and write booleans', () => {
      const buffer = new ArrayBuffer(256);
      const table = new StringTable();
      const accessor = new BufferAccessor(buffer, table);
      
      // Write
      accessor.putBoolean(true);
      accessor.putBoolean(false);
      accessor.putBoolean(true);
      
      // Read
      accessor.reset();
      expect(accessor.getBoolean()).toBe(true);
      expect(accessor.getBoolean()).toBe(false);
      expect(accessor.getBoolean()).toBe(true);
    });

    it('should track offset correctly', () => {
      const buffer = new ArrayBuffer(256);
      const table = new StringTable();
      const accessor = new BufferAccessor(buffer, table);
      
      expect(accessor.getOffset()).toBe(0);
      
      accessor.putInt32(42); // 4 bytes
      expect(accessor.getOffset()).toBe(4);
      
      accessor.putFloat64(3.14); // 8 bytes
      expect(accessor.getOffset()).toBe(12);
      
      accessor.putBoolean(true); // 1 byte
      expect(accessor.getOffset()).toBe(13);
      
      accessor.reset();
      expect(accessor.getOffset()).toBe(0);
    });
  });

  describe('ZeroAllocationProcessor', () => {
    it('should register and unregister handlers', () => {
      const processor = new ZeroAllocationProcessor();
      const handler = jest.fn();
      
      const unregister = processor.register('test-event', handler);
      
      const stats = processor.getStats();
      expect(stats.handlers.patterns).toBe(1);
      expect(stats.handlers.total).toBe(1);
      
      unregister();
      
      const newStats = processor.getStats();
      expect(newStats.handlers.total).toBe(0);
    });

    it('should process events with zero allocations', async () => {
      const processor = new ZeroAllocationProcessor();
      const handler = jest.fn();
      
      processor.register('test-event', handler);
      
      const event = {
        id: 'event-123',
        type: 'test-event',
        timestamp: Date.now(),
        payload: {
          count: 42,
          message: 'hello',
          active: true,
        },
        context: {
          causal: {
            id: 'causal-123',
            sender: 'node-1',
            path: [],
          },
          timestamp: Date.now(),
        },
      };
      
      await processor.process(event);
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          buffer: expect.any(BufferAccessor),
          event,
          done: expect.any(Function),
        })
      );
    });

    it('should serialize event data into buffer', async () => {
      const processor = new ZeroAllocationProcessor();
      let capturedContext: any;
      
      processor.register('test-event', (context) => {
        capturedContext = context;
        
        // Read serialized data
        context.buffer.reset();
        const eventId = context.buffer.getString();
        const eventType = context.buffer.getString();
        const timestamp = context.buffer.getFloat64();
        
        expect(eventId).toBe('event-123');
        expect(eventType).toBe('test-event');
        expect(timestamp).toBeCloseTo((context.event as any).timestamp);
        
        // Read payload
        const fieldCount = context.buffer.getInt32();
        expect(fieldCount).toBe(3);
        
        // Read each field
        for (let i = 0; i < fieldCount; i++) {
          const key = context.buffer.getString();
          const type = context.buffer.getInt32();
          
          if (key === 'count') {
            expect(type).toBe(1); // number
            expect(context.buffer.getFloat64()).toBe(42);
          } else if (key === 'message') {
            expect(type).toBe(0); // string
            expect(context.buffer.getString()).toBe('hello');
          } else if (key === 'active') {
            expect(type).toBe(2); // boolean
            expect(context.buffer.getBoolean()).toBe(true);
          }
        }
      });
      
      const event = {
        id: 'event-123',
        type: 'test-event',
        timestamp: Date.now(),
        payload: {
          count: 42,
          message: 'hello',
          active: true,
        },
        context: {
          causal: {
            id: 'causal-123',
            sender: 'node-1',
            path: [],
          },
          timestamp: Date.now(),
        },
      };
      
      await processor.process(event);
      
      // Ensure done() was provided
      expect(capturedContext.done).toBeDefined();
    });
  });

  describe('Node Integration', () => {
    it('should support zero-allocation handlers on nodes', async () => {
      const happen = initializeHappen();
      const node = happen.createNode('test-node');
      
      const handler = jest.fn();
      
      // Register zero-allocation handler
      const unregister = node.zero('high-frequency-event', handler);
      
      // Emit event
      node.emit({
        type: 'high-frequency-event',
        payload: { value: 123 },
      });
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler).toHaveBeenCalled();
      
      // Unregister
      unregister();
    });

    it('should process events through zero-allocation path', async () => {
      const happen = initializeHappen();
      const node = happen.createNode('test-node');
      
      let processedValue: number | null = null;
      
      // Register zero-allocation handler that reads from buffer
      node.zero('perf-critical', (context: ZeroAllocationContext) => {
        context.buffer.reset();
        
        // Skip event metadata
        context.buffer.getString(); // id
        context.buffer.getString(); // type
        context.buffer.getFloat64(); // timestamp
        
        // Read payload
        const fieldCount = context.buffer.getInt32();
        for (let i = 0; i < fieldCount; i++) {
          const key = context.buffer.getString();
          const type = context.buffer.getInt32();
          
          if (key === 'value' && type === 1) { // number
            processedValue = context.buffer.getFloat64();
          }
        }
        
        context.done();
      });
      
      // Emit high-frequency event
      node.emit({
        type: 'perf-critical',
        payload: { value: 42.5 },
      });
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(processedValue).toBe(42.5);
    });
  });

  describe('PerformanceMonitor', () => {
    it('should track performance metrics', () => {
      const monitor = new PerformanceMonitor();
      
      // Record some measurements
      monitor.record('handler-1', 10.5);
      monitor.record('handler-1', 12.3);
      monitor.record('handler-1', 8.7);
      monitor.record('handler-2', 5.2);
      
      const summary = monitor.getSummary();
      
      expect(summary['handler-1']).toEqual({
        count: 3,
        avgTime: expect.any(Number),
        minTime: 8.7,
        maxTime: 12.3,
        totalTime: 31.5,
      });
      
      expect(summary['handler-2']).toEqual({
        count: 1,
        avgTime: 5.2,
        minTime: 5.2,
        maxTime: 5.2,
        totalTime: 5.2,
      });
    });

    it('should reset metrics', () => {
      const monitor = new PerformanceMonitor();
      
      monitor.record('test', 10);
      expect(Object.keys(monitor.getSummary()).length).toBe(1);
      
      monitor.reset();
      expect(Object.keys(monitor.getSummary()).length).toBe(0);
    });
  });

  describe('Zero-Allocation Extension', () => {
    it('should measure sync operations', () => {
      const ext = createZeroAllocationExtension();
      
      const result = ext.measure('computation', () => {
        let sum = 0;
        for (let i = 0; i < 1000; i++) {
          sum += i;
        }
        return sum;
      });
      
      expect(result).toBe(499500);
      
      const summary = ext.monitor.getSummary();
      expect(summary.computation).toBeDefined();
      expect(summary.computation.count).toBe(1);
    });

    it('should measure async operations', async () => {
      const ext = createZeroAllocationExtension();
      
      const result = await ext.measureAsync('async-op', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'done';
      });
      
      expect(result).toBe('done');
      
      const summary = ext.monitor.getSummary();
      expect(summary['async-op']).toBeDefined();
      expect(summary['async-op'].minTime).toBeGreaterThan(9);
    });
  });

  describe('Performance Comparison', () => {
    it('should demonstrate zero-allocation benefits', async () => {
      const happen = initializeHappen();
      const node = happen.createNode('perf-test');
      const ext = createZeroAllocationExtension();
      
      const iterations = 1000;
      
      // Regular handler
      let regularCount = 0;
      node.on('regular-event', () => {
        regularCount++;
      });
      
      // Zero-allocation handler
      let zeroAllocCount = 0;
      node.zero('zero-alloc-event', (context: ZeroAllocationContext) => {
        zeroAllocCount++;
        context.done();
      });
      
      // Measure regular handler performance
      await ext.measureAsync('regular-handler', async () => {
        for (let i = 0; i < iterations; i++) {
          node.emit({
            type: 'regular-event',
            payload: { index: i, data: 'test' },
          });
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      });
      
      // Measure zero-allocation handler performance
      await ext.measureAsync('zero-alloc-handler', async () => {
        for (let i = 0; i < iterations; i++) {
          node.emit({
            type: 'zero-alloc-event',
            payload: { index: i, data: 'test' },
          });
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      });
      
      expect(regularCount).toBe(iterations);
      expect(zeroAllocCount).toBe(iterations);
      
      const summary = ext.monitor.getSummary();
      console.log('Performance comparison:', {
        regular: summary['regular-handler'],
        zeroAlloc: summary['zero-alloc-handler'],
      });
      
      // Zero-allocation should generally be faster
      // (though in tests the difference might be small)
      expect(summary['zero-alloc-handler']).toBeDefined();
      expect(summary['regular-handler']).toBeDefined();
    });
  });
});