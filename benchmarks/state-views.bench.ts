/**
 * State and Views Benchmarks
 *
 * Tests state operations and cross-node Views performance
 */

import { HappenNode } from '../src/node.js';
import { NatsConnectionManager } from '../src/nats-connection.js';
import { benchmarkSuite } from './framework.js';

let manager: NatsConnectionManager;
let nodeRegistry: Map<string, HappenNode>;
let node1: HappenNode;
let node2: HappenNode;
let node3: HappenNode;

async function setup() {
  manager = new NatsConnectionManager({ servers: 'localhost:4222' });
  await manager.connect();
  nodeRegistry = new Map();

  node1 = new HappenNode('state-node-1', manager, nodeRegistry, { persistent: true });
  node2 = new HappenNode('state-node-2', manager, nodeRegistry, { persistent: true });
  node3 = new HappenNode('state-node-3', manager, nodeRegistry, { persistent: true });

  nodeRegistry.set('state-node-1', node1);
  nodeRegistry.set('state-node-2', node2);
  nodeRegistry.set('state-node-3', node3);

  await Promise.all([
    node1.initialize(),
    node2.initialize(),
    node3.initialize()
  ]);

  // Set initial state
  await node2.state.set(() => ({ user: 'test', value: 42 }));
  await node3.state.set(() => ({ inventory: 100 }));
}

async function teardown() {
  await Promise.all([
    node1.shutdown(),
    node2.shutdown(),
    node3.shutdown()
  ]);
  await manager.disconnect();
}

export async function runStateViewsBenchmarks() {
  await setup();

  const results = await benchmarkSuite([
    {
      name: 'State Set (Simple)',
      fn: async () => {
        await node1.state.set((state: any) => ({
          ...state,
          counter: (state.counter || 0) + 1
        }));
      },
      options: {
        iterations: 1000,
        warmupIterations: 100
      }
    },
    {
      name: 'State Get (Simple)',
      fn: async () => {
        await node1.state.get();
      },
      options: {
        iterations: 2000,
        warmupIterations: 200
      }
    },
    {
      name: 'State Get with Transform',
      fn: async () => {
        await node1.state.get((state: any) => state.counter);
      },
      options: {
        iterations: 2000,
        warmupIterations: 200
      }
    },
    {
      name: 'Views - Single Node Access',
      fn: async () => {
        await node1.state.set(async (state: any, views: any) => {
          const node2Data = await views['state-node-2'].get();
          return { ...state, node2Data };
        });
      },
      options: {
        iterations: 500,
        warmupIterations: 50
      }
    },
    {
      name: 'Views - Collect from Multiple Nodes',
      fn: async () => {
        await node1.state.set(async (state: any, views: any) => {
          const collected = await views.collect({
            'state-node-2': (s: any) => s.user,
            'state-node-3': (s: any) => s.inventory
          });
          return { ...state, collected };
        });
      },
      options: {
        iterations: 300,
        warmupIterations: 30
      }
    }
  ]);

  await teardown();
  return results;
}
