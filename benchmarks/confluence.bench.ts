/**
 * Confluence Benchmarks
 *
 * Tests fan-out and fan-in performance
 */

import { HappenNode } from '../src/node.js';
import { NatsConnectionManager } from '../src/nats-connection.js';
import { createNodeArray } from '../src/confluence.js';
import { createEvent } from '../src/causality.js';
import { benchmarkSuite } from './framework.js';

let manager: NatsConnectionManager;
let nodeRegistry: Map<string, HappenNode>;
let nodes: HappenNode[];

async function setup() {
  manager = new NatsConnectionManager({ servers: 'localhost:4222' });
  await manager.connect();
  nodeRegistry = new Map();

  // Create 5 nodes for confluence testing
  nodes = [];
  for (let i = 0; i < 5; i++) {
    const node = new HappenNode(`confluence-node-${i}`, manager, nodeRegistry);
    nodeRegistry.set(`confluence-node-${i}`, node);
    nodes.push(node);
    await node.initialize();
  }
}

async function teardown() {
  await Promise.all(nodes.map(n => n.shutdown()));
  await manager.disconnect();
}

export async function runConfluenceBenchmarks() {
  await setup();

  // Setup handlers
  const nodeArray = createNodeArray(nodes);
  nodeArray.on('confluence.test', (event: any, context: any) => {
    return { processed: true, nodeId: context.node?.id };
  });

  nodes[0].on('batch.test', (events: any) => {
    if (Array.isArray(events)) {
      return { batch: true, count: events.length };
    }
    return { batch: false };
  });

  const results = await benchmarkSuite([
    {
      name: 'Fan-Out to 5 Nodes',
      fn: async () => {
        await nodeArray.send({
          type: 'confluence.test',
          payload: { data: 'test' }
        });
      },
      options: {
        iterations: 1000,
        warmupIterations: 100
      }
    },
    {
      name: 'Fan-Out with Result Collection',
      fn: async () => {
        const result = await nodeArray.send({
          type: 'confluence.test',
          payload: { data: 'test' }
        });
        await result.return();
      },
      options: {
        iterations: 500,
        warmupIterations: 50
      }
    },
    {
      name: 'Fan-In - Batch of 10 Events',
      fn: async () => {
        const events = Array.from({ length: 10 }, (_, i) =>
          createEvent('batch.test', { index: i }, 'sender')
        );
        await nodes[0].process(events);
      },
      options: {
        iterations: 1000,
        warmupIterations: 100
      }
    },
    {
      name: 'Fan-In - Batch of 50 Events',
      fn: async () => {
        const events = Array.from({ length: 50 }, (_, i) =>
          createEvent('batch.test', { index: i }, 'sender')
        );
        await nodes[0].process(events);
      },
      options: {
        iterations: 500,
        warmupIterations: 50
      }
    },
    {
      name: 'Fan-In - Batch of 100 Events',
      fn: async () => {
        const events = Array.from({ length: 100 }, (_, i) =>
          createEvent('batch.test', { index: i }, 'sender')
        );
        await nodes[0].process(events);
      },
      options: {
        iterations: 200,
        warmupIterations: 20
      }
    }
  ]);

  await teardown();
  return results;
}
