/**
 * Event Processing Benchmarks
 *
 * Compares standard event processing vs zero-allocation processing
 */

import { HappenNode } from '../src/node.js';
import { NatsConnectionManager } from '../src/nats-connection.js';
import { createEvent } from '../src/causality.js';
import { benchmarkSuite } from './framework.js';

// Setup
let manager: NatsConnectionManager;
let node: HappenNode;
let nodeRegistry: Map<string, HappenNode>;

async function setup() {
  manager = new NatsConnectionManager({ servers: 'localhost:4222' });
  await manager.connect();
  nodeRegistry = new Map();
  node = new HappenNode('benchmark-node', manager, nodeRegistry);
  await node.initialize();
}

async function teardown() {
  await node.shutdown();
  await manager.disconnect();
}

// Test data
const testEvent = createEvent('test.event', { data: 'benchmark', value: 42 }, 'test-sender');

export async function runEventProcessingBenchmarks() {
  await setup();

  // Standard event processing
  let standardCount = 0;
  node.on('test.standard', (event) => {
    standardCount++;
    return { processed: true };
  });

  // Zero-allocation event processing
  let zeroAllocCount = 0;
  node.onZeroAllocation('test.zeroalloc', (buffer, offset, length, metadata) => {
    zeroAllocCount++;
    // No object creation - just read from buffer if needed
  });

  // Prepare buffers for pure buffer operations benchmark
  const { BufferPool, BufferWriter, BufferReader } = await import('../src/zero-allocation.js');
  const bufferPool = new BufferPool({ maxPoolSize: 100, bufferSize: 4096 });

  // Pre-allocate some buffers to ensure pool is warm
  const preAllocated = [];
  for (let i = 0; i < 20; i++) {
    preAllocated.push(bufferPool.acquire());
  }
  for (const buf of preAllocated) {
    bufferPool.release(buf);
  }

  const results = await benchmarkSuite([
    {
      name: 'Standard Event Processing',
      fn: async () => {
        await node.process(createEvent('test.standard', { data: 'test' }, 'sender'));
      },
      options: {
        iterations: 10000,
        warmupIterations: 1000
      }
    },
    {
      name: 'Zero-Allocation Event Processing',
      fn: async () => {
        await node.process(createEvent('test.zeroalloc', { data: 'test' }, 'sender'));
      },
      options: {
        iterations: 10000,
        warmupIterations: 1000
      }
    },
    {
      name: 'Event Creation (Causality)',
      fn: () => {
        createEvent('benchmark.event', { value: Math.random() }, 'benchmark-node');
      },
      options: {
        iterations: 50000,
        warmupIterations: 5000
      }
    },
    {
      name: 'Pattern Matching - Exact',
      fn: async () => {
        await node.process(createEvent('test.standard', { data: 'test' }, 'sender'));
      },
      options: {
        iterations: 10000
      }
    },
    {
      name: 'Event Continuum - Simple Chain',
      fn: async () => {
        const handler = (event: any) => {
          return (event2: any) => {
            return (event3: any) => {
              return { done: true };
            };
          };
        };
        node.on('test.chain', handler as any);
        await node.process(createEvent('test.chain', {}, 'sender'));
      },
      options: {
        iterations: 5000
      }
    },
    {
      name: 'Pure Buffer Write (Zero-Allocation)',
      fn: () => {
        const buffer = bufferPool.acquire();
        const writer = new BufferWriter(buffer);

        // Write typical event data: timestamp, value, status code
        writer.writeBigInt(BigInt(Date.now() * 1000000));
        writer.writeDouble(42.5);
        writer.writeUInt8(200);
        writer.writeString('processed');

        bufferPool.release(buffer);
      },
      options: {
        iterations: 100000,
        warmupIterations: 10000
      }
    },
    {
      name: 'Standard Object Creation',
      fn: () => {
        // Equivalent object creation
        const obj = {
          timestamp: BigInt(Date.now() * 1000000),
          value: 42.5,
          statusCode: 200,
          message: 'processed'
        };
        // Simulate "using" the object
        const _ = obj.value;
      },
      options: {
        iterations: 100000,
        warmupIterations: 10000
      }
    },
    {
      name: 'Pure Buffer Read (Zero-Allocation)',
      fn: () => {
        // Pre-write some data
        const buffer = bufferPool.acquire();
        const writer = new BufferWriter(buffer);
        writer.writeBigInt(BigInt(1234567890000000));
        writer.writeDouble(42.5);
        writer.writeUInt8(200);
        writer.writeString('processed');

        // Now read it back (no allocation!)
        const reader = new BufferReader(buffer, 0);
        const timestamp = reader.readBigInt();
        const value = reader.readDouble();
        const statusCode = reader.readUInt8();
        const message = reader.readString();

        bufferPool.release(buffer);
      },
      options: {
        iterations: 100000,
        warmupIterations: 10000
      }
    },
    {
      name: 'Standard Object Access',
      fn: () => {
        const obj = {
          timestamp: BigInt(1234567890000000),
          value: 42.5,
          statusCode: 200,
          message: 'processed'
        };

        // Read properties
        const timestamp = obj.timestamp;
        const value = obj.value;
        const statusCode = obj.statusCode;
        const message = obj.message;
      },
      options: {
        iterations: 100000,
        warmupIterations: 10000
      }
    },
    {
      name: 'Buffer Pool - Acquire/Release',
      fn: () => {
        const buffer = bufferPool.acquire();
        bufferPool.release(buffer);
      },
      options: {
        iterations: 100000,
        warmupIterations: 10000
      }
    },
    {
      name: 'JSON Serialization (Standard Path)',
      fn: () => {
        // Simulate what happens in standard event processing
        const event = {
          type: 'metrics.cpu',
          payload: {
            timestamp: Date.now(),
            value: 42.5,
            host: 'server-01',
            tags: { env: 'prod', region: 'us-east' }
          }
        };
        const json = JSON.stringify(event);
        const parsed = JSON.parse(json);
        const _ = parsed.payload.value;
      },
      options: {
        iterations: 50000,
        warmupIterations: 5000
      }
    },
    {
      name: 'Zero-Allocation Path (Direct Buffer)',
      fn: () => {
        // Simulate direct buffer write/read without JSON
        const buffer = bufferPool.acquire();
        const writer = new BufferWriter(buffer);

        // Write metric data directly
        writer.writeBigInt(BigInt(Date.now() * 1000000));
        writer.writeDouble(42.5);
        writer.writeString('server-01');
        writer.writeUInt8(1); // env: prod
        writer.writeUInt8(2); // region: us-east

        // Read it back
        const reader = new BufferReader(buffer, 0);
        const timestamp = reader.readBigInt();
        const value = reader.readDouble();
        const host = reader.readString();
        const env = reader.readUInt8();
        const region = reader.readUInt8();

        bufferPool.release(buffer);
      },
      options: {
        iterations: 50000,
        warmupIterations: 5000
      }
    }
  ]);

  await teardown();
  return results;
}
