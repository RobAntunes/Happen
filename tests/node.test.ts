/**
 * Tests for Node class
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { HappenNode } from '../src/node.js';
import { NatsConnectionManager } from '../src/nats-connection.js';
import { createEvent } from '../src/causality.js';
import type { EventHandler } from '../src/types.js';

// Helper to check if NATS is available
async function isNatsAvailable(): Promise<boolean> {
  const manager = new NatsConnectionManager({ servers: 'localhost:4222' });
  try {
    await manager.connect();
    await manager.disconnect();
    return true;
  } catch (error) {
    return false;
  }
}

describe('Happen Node', () => {
  let natsAvailable = false;

  before(async () => {
    natsAvailable = await isNatsAvailable();
    if (!natsAvailable) {
      console.log('\n⚠️  NATS server not available. Skipping Node integration tests.');
    }
  });

  describe('Node Creation', () => {
    let manager: NatsConnectionManager;

    before(async () => {
      if (!natsAvailable) return;
      manager = new NatsConnectionManager();
      await manager.connect();
    });

    after(async () => {
      if (!natsAvailable) return;
      if (manager) {
        await manager.disconnect();
      }
    });

    it('should create a node with an ID', () => {
      if (!natsAvailable) return;

      const node = new HappenNode('test-node', manager, new Map());
      assert.strictEqual(node.getId(), 'test-node');
    });

    it('should create node with config', () => {
      if (!natsAvailable) return;

      const node = new HappenNode('test-node', manager, new Map(), {
        persistent: true,
        customOption: 'value'
      });

      assert.strictEqual(node.getId(), 'test-node');
    });
  });

  describe('Event Handlers', () => {
    let manager: NatsConnectionManager;
    let node: HappenNode;

    before(async () => {
      if (!natsAvailable) return;
      manager = new NatsConnectionManager();
      await manager.connect();
      node = new HappenNode('test-node', manager, new Map());
      await node.initialize();
    });

    after(async () => {
      if (!natsAvailable) return;
      if (node) {
        await node.shutdown();
      }
      if (manager) {
        await manager.disconnect();
      }
    });

    it('should register event handlers', () => {
      if (!natsAvailable) return;

      const handler: EventHandler = (event, context) => {
        return { processed: true };
      };

      node.on('test.event', handler);
      // No error means registration was successful
    });

    it('should register multiple handlers for different patterns', () => {
      if (!natsAvailable) return;

      node.on('order.created', (event, context) => ({ result: 'order' }));
      node.on('payment.processed', (event, context) => ({ result: 'payment' }));
      node.on('user.*', (event, context) => ({ result: 'user' }));
    });

    it('should process events with matching handlers', async () => {
      if (!natsAvailable) return;

      const testNode = new HappenNode('process-test-node', manager, new Map());

      testNode.on('test.process', (event, context) => {
        return { success: true, value: event.payload.value * 2 };
      });

      const event = createEvent('test.process', { value: 21 }, 'sender-node');
      const result = await testNode.process(event);

      assert.deepStrictEqual(result, { success: true, value: 42 });
    });

    it('should return null for events with no matching handlers', async () => {
      if (!natsAvailable) return;

      const testNode = new HappenNode('no-handler-node', manager, new Map());

      testNode.on('test.other', (event, context) => {
        return { processed: true };
      });

      const event = createEvent('test.unhandled', {}, 'sender-node');
      const result = await testNode.process(event);

      assert.strictEqual(result, null);
    });

    it('should process events through continuum', async () => {
      if (!natsAvailable) return;

      const testNode = new HappenNode('continuum-test-node', manager, new Map());

      const step1: EventHandler = (event, context) => {
        context.step1 = true;
        return step2;
      };

      const step2: EventHandler = (event, context) => {
        context.step2 = true;
        return { completed: true, steps: [context.step1, context.step2] };
      };

      testNode.on('test.continuum', step1);

      const event = createEvent('test.continuum', {}, 'sender-node');
      const result = await testNode.process(event);

      assert.deepStrictEqual(result, {
        completed: true,
        steps: [true, true]
      });
    });

    it('should process events synchronously', () => {
      if (!natsAvailable) return;

      const testNode = new HappenNode('sync-test-node', manager, new Map());

      testNode.on('test.sync', (event, context) => {
        return { processed: true, value: event.payload.value };
      });

      const event = createEvent('test.sync', { value: 'test' }, 'sender-node');
      const result = testNode.processSync(event);

      assert.deepStrictEqual(result, { processed: true, value: 'test' });
    });
  });

  describe('Broadcasting', () => {
    let manager: NatsConnectionManager;
    let node1: HappenNode;
    let node2: HappenNode;

    before(async () => {
      if (!natsAvailable) return;
      manager = new NatsConnectionManager();
      await manager.connect();
      node1 = new HappenNode('broadcast-node-1', manager, new Map());
      node2 = new HappenNode('broadcast-node-2', manager, new Map());
      await node1.initialize();
      await node2.initialize();
    });

    after(async () => {
      if (!natsAvailable) return;
      if (node1) await node1.shutdown();
      if (node2) await node2.shutdown();
      if (manager) await manager.disconnect();
    });

    it('should broadcast events to all nodes', async () => {
      if (!natsAvailable) return;

      const received: string[] = [];

      return new Promise<void>(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Not all nodes received broadcast'));
        }, 5000);

        const checkDone = () => {
          if (received.length === 2) {
            clearTimeout(timeout);
            resolve();
          }
        };

        node1.on('test.broadcast', (event, context) => {
          received.push('node1');
          checkDone();
          return { received: true };
        });

        node2.on('test.broadcast', (event, context) => {
          received.push('node2');
          checkDone();
          return { received: true };
        });

        await new Promise(resolve => setTimeout(resolve, 200));

        await node1.broadcast({
          type: 'test.broadcast',
          payload: { message: 'Hello all!' }
        });
      });
    });

    it('should send events to specific nodes', async () => {
      if (!natsAvailable) return;

      let node2Received = false;
      let node1Received = false;

      return new Promise<void>(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!node2Received) {
            reject(new Error('Target node did not receive message'));
          } else if (node1Received) {
            reject(new Error('Non-target node received message'));
          } else {
            resolve();
          }
        }, 2000);

        node1.on('test.targeted', (event, context) => {
          node1Received = true;
          return null;
        });

        node2.on('test.targeted', (event, context) => {
          node2Received = true;
          clearTimeout(timeout);
          setTimeout(resolve, 200); // Wait a bit to ensure node1 doesn't receive it
          return null;
        });

        await new Promise(resolve => setTimeout(resolve, 200));

        await node1.send('broadcast-node-2', {
          type: 'test.targeted',
          payload: { message: 'Hello node 2!' }
        });
      });
    });
  });

  describe('State Management', () => {
    let manager: NatsConnectionManager;
    let node: HappenNode;

    before(async () => {
      if (!natsAvailable) return;
      manager = new NatsConnectionManager();
      await manager.connect();
      node = new HappenNode(`state-test-node-${Date.now()}`, manager, new Map(), {
        persistent: true
      });
      await node.initialize();
    });

    after(async () => {
      if (!natsAvailable) return;
      if (node) await node.shutdown();
      if (manager) await manager.disconnect();
    });

    it('should get and set state', async () => {
      if (!natsAvailable) return;

      // Set initial state
      await node.state.set((state) => ({
        count: 0,
        items: []
      }));

      // Get state
      const state = await node.state.get();
      assert.deepStrictEqual(state, { count: 0, items: [] });
    });

    it('should transform state', async () => {
      if (!natsAvailable) return;

      // Set initial state
      await node.state.set(() => ({
        count: 5,
        items: ['a', 'b', 'c']
      }));

      // Update state
      await node.state.set((state: any) => ({
        ...state,
        count: state.count + 1,
        items: [...state.items, 'd']
      }));

      const newState = await node.state.get();
      assert.deepStrictEqual(newState, {
        count: 6,
        items: ['a', 'b', 'c', 'd']
      });
    });

    it('should get transformed state', async () => {
      if (!natsAvailable) return;

      await node.state.set(() => ({
        orders: {
          'order-1': { id: 'order-1', total: 99.99 },
          'order-2': { id: 'order-2', total: 149.99 }
        }
      }));

      // Get specific part of state
      const orders = await node.state.get((state: any) => state.orders);
      assert.ok(orders['order-1']);
      assert.strictEqual(orders['order-1'].total, 99.99);

      // Transform state before returning
      const orderIds = await node.state.get((state: any) =>
        Object.keys(state.orders)
      );
      assert.deepStrictEqual(orderIds, ['order-1', 'order-2']);
    });

    it('should throw error for non-persistent nodes', async () => {
      if (!natsAvailable) return;

      const nonPersistentNode = new HappenNode('non-persistent', manager, new Map());

      await assert.rejects(
        async () => await nonPersistentNode.state.get(),
        /does not have persistent state enabled/
      );
    });
  });

  describe('Pattern Matching', () => {
    let manager: NatsConnectionManager;
    let node: HappenNode;

    before(async () => {
      if (!natsAvailable) return;
      manager = new NatsConnectionManager();
      await manager.connect();
      node = new HappenNode('pattern-test-node', manager, new Map());
    });

    after(async () => {
      if (!natsAvailable) return;
      if (manager) await manager.disconnect();
    });

    it('should match exact patterns', async () => {
      if (!natsAvailable) return;

      node.on('order.created', (event, context) => ({ matched: 'exact' }));

      const event1 = createEvent('order.created', {}, 'sender');
      const result1 = await node.process(event1);
      assert.deepStrictEqual(result1, { matched: 'exact' });

      const event2 = createEvent('order.updated', {}, 'sender');
      const result2 = await node.process(event2);
      assert.strictEqual(result2, null);
    });

    it('should match wildcard patterns', async () => {
      if (!natsAvailable) return;

      const testNode = new HappenNode('wildcard-test', manager, new Map());
      testNode.on('user.*', (event, context) => ({ matched: 'wildcard' }));

      const event1 = createEvent('user.created', {}, 'sender');
      const result1 = await testNode.process(event1);
      assert.deepStrictEqual(result1, { matched: 'wildcard' });

      const event2 = createEvent('user.updated', {}, 'sender');
      const result2 = await testNode.process(event2);
      assert.deepStrictEqual(result2, { matched: 'wildcard' });

      const event3 = createEvent('order.created', {}, 'sender');
      const result3 = await testNode.process(event3);
      assert.strictEqual(result3, null);
    });

    it('should match function patterns', async () => {
      if (!natsAvailable) return;

      const testNode = new HappenNode('function-pattern-test', manager, new Map());

      testNode.on(
        (type) => type.startsWith('payment.') && type.includes('success'),
        (event, context) => ({ matched: 'function' })
      );

      const event1 = createEvent('payment.success', {}, 'sender');
      const result1 = await testNode.process(event1);
      assert.deepStrictEqual(result1, { matched: 'function' });

      const event2 = createEvent('payment.successful', {}, 'sender');
      const result2 = await testNode.process(event2);
      assert.deepStrictEqual(result2, { matched: 'function' });

      const event3 = createEvent('payment.failed', {}, 'sender');
      const result3 = await testNode.process(event3);
      assert.strictEqual(result3, null);
    });
  });
});
