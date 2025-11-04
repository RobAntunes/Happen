/**
 * Tests for Confluence - unified fan-in/fan-out processing
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { HappenNode } from '../src/node.js';
import { NatsConnectionManager } from '../src/nats-connection.js';
import { NodeArray, createNodeArray, enableArraySyntax } from '../src/confluence.js';
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

describe('Confluence', () => {
  let natsAvailable = false;

  before(async () => {
    natsAvailable = await isNatsAvailable();
    if (!natsAvailable) {
      console.log('\n⚠️  NATS server not available. Skipping Confluence integration tests.');
    }
  });

  describe('NodeArray', () => {
    let manager: NatsConnectionManager;
    let node1: HappenNode;
    let node2: HappenNode;
    let node3: HappenNode;

    before(async () => {
      if (!natsAvailable) return;
      manager = new NatsConnectionManager();
      await manager.connect();
      node1 = new HappenNode('confluence-node-1', manager, new Map());
      node2 = new HappenNode('confluence-node-2', manager, new Map());
      node3 = new HappenNode('confluence-node-3', manager, new Map());
      await node1.initialize();
      await node2.initialize();
      await node3.initialize();
    });

    after(async () => {
      if (!natsAvailable) return;
      if (node1) await node1.shutdown();
      if (node2) await node2.shutdown();
      if (node3) await node3.shutdown();
      if (manager) await manager.disconnect();
    });

    it('should create NodeArray from array of nodes', () => {
      if (!natsAvailable) return;

      const nodeArray = createNodeArray([node1, node2, node3]);
      assert.ok(nodeArray instanceof NodeArray);
      assert.strictEqual(nodeArray.getNodes().length, 3);
    });

    it('should register handler on multiple nodes', async () => {
      if (!natsAvailable) return;

      const handlerCallCounts = new Map<string, number>();

      const nodeArray = createNodeArray([node1, node2, node3]);

      nodeArray.on('test.multi-handler', (event, context) => {
        const nodeId = context.node?.id;
        handlerCallCounts.set(nodeId, (handlerCallCounts.get(nodeId) || 0) + 1);
        return { processed: true, by: nodeId };
      });

      // Each node should have registered the handler
      const event1 = createEvent('test.multi-handler', {}, 'sender');
      await node1.process(event1);

      const event2 = createEvent('test.multi-handler', {}, 'sender');
      await node2.process(event2);

      const event3 = createEvent('test.multi-handler', {}, 'sender');
      await node3.process(event3);

      assert.strictEqual(handlerCallCounts.get('confluence-node-1'), 1);
      assert.strictEqual(handlerCallCounts.get('confluence-node-2'), 1);
      assert.strictEqual(handlerCallCounts.get('confluence-node-3'), 1);
    });

    it('should send event to multiple nodes (fan-out)', async () => {
      if (!natsAvailable) return;

      const received = new Set<string>();

      const nodeArray = createNodeArray([node1, node2, node3]);

      nodeArray.on('test.fanout', (event, context) => {
        received.add(context.node?.id);
        return { received: true };
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      const result = await nodeArray.send({
        type: 'test.fanout',
        payload: { message: 'Hello all nodes' }
      });

      const results = await result.return();

      // All three nodes should have results
      assert.ok(results['confluence-node-1']);
      assert.ok(results['confluence-node-2']);
      assert.ok(results['confluence-node-3']);
    });

    it('should broadcast to all nodes', async () => {
      if (!natsAvailable) return;

      const received: string[] = [];

      const nodeArray = createNodeArray([node1, node2, node3]);

      return new Promise<void>(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Not all nodes received broadcast'));
        }, 5000);

        nodeArray.on('test.broadcast-multi', (event, context) => {
          received.push(context.node?.id);
          if (received.length === 3) {
            clearTimeout(timeout);
            resolve();
          }
          return null;
        });

        await new Promise(resolve => setTimeout(resolve, 200));

        await nodeArray.broadcast({
          type: 'test.broadcast-multi',
          payload: { message: 'Broadcast message' }
        });
      });
    });
  });

  describe('Batch Processing (Fan-in)', () => {
    let manager: NatsConnectionManager;
    let node: HappenNode;

    before(async () => {
      if (!natsAvailable) return;
      manager = new NatsConnectionManager();
      await manager.connect();
      node = new HappenNode('batch-test-node', manager, new Map());
      await node.initialize();
    });

    after(async () => {
      if (!natsAvailable) return;
      if (node) await node.shutdown();
      if (manager) await manager.disconnect();
    });

    it('should process single event normally', async () => {
      if (!natsAvailable) return;

      node.on('test.single', (event, context) => {
        assert.strictEqual(Array.isArray(event), false);
        return { processed: 'single', value: event.payload.value };
      });

      const event = createEvent('test.single', { value: 42 }, 'sender');
      const result = await node.process(event);

      assert.deepStrictEqual(result, { processed: 'single', value: 42 });
    });

    it('should process batch of events', async () => {
      if (!natsAvailable) return;

      node.on('test.batch', (eventOrEvents, context) => {
        if (Array.isArray(eventOrEvents)) {
          return {
            processed: 'batch',
            count: eventOrEvents.length,
            values: eventOrEvents.map(e => e.payload.value)
          };
        }
        return { processed: 'single' };
      });

      const events = [
        createEvent('test.batch', { value: 10 }, 'sender'),
        createEvent('test.batch', { value: 20 }, 'sender'),
        createEvent('test.batch', { value: 30 }, 'sender')
      ];

      const result = await node.process(events);

      assert.strictEqual(result.processed, 'batch');
      assert.strictEqual(result.count, 3);
      assert.deepStrictEqual(result.values, [10, 20, 30]);
    });

    it('should provide batch context with events array', async () => {
      if (!natsAvailable) return;

      let receivedContext: any;

      node.on('test.batch-context', (events, context) => {
        receivedContext = context;
        return { ok: true };
      });

      const events = [
        createEvent('test.batch-context', { id: 1 }, 'sender'),
        createEvent('test.batch-context', { id: 2 }, 'sender')
      ];

      await node.process(events);

      assert.ok(receivedContext);
      assert.ok(receivedContext.receivedAt);
      assert.ok(Array.isArray(receivedContext.events));
      assert.strictEqual(receivedContext.events.length, 2);
    });

    it('should handle empty batch', async () => {
      if (!natsAvailable) return;

      node.on('test.empty', (events, context) => {
        return { processed: true };
      });

      const result = await node.process([]);
      assert.strictEqual(result, null);
    });
  });

  describe('Array Syntax', () => {
    it('should enable array methods on Node arrays', () => {
      enableArraySyntax();

      // Check that methods were added
      assert.strictEqual(typeof (Array.prototype as any).on, 'function');
      assert.strictEqual(typeof (Array.prototype as any).send, 'function');
      assert.strictEqual(typeof (Array.prototype as any).broadcast, 'function');
    });
  });

  describe('Documentation Examples', () => {
    let manager: NatsConnectionManager;
    let orderNode: HappenNode;
    let paymentNode: HappenNode;
    let inventoryNode: HappenNode;

    before(async () => {
      if (!natsAvailable) return;
      manager = new NatsConnectionManager();
      await manager.connect();
      orderNode = new HappenNode('order-service', manager, new Map());
      paymentNode = new HappenNode('payment-service', manager, new Map());
      inventoryNode = new HappenNode('inventory-service', manager, new Map());
      await orderNode.initialize();
      await paymentNode.initialize();
      await inventoryNode.initialize();
      enableArraySyntax();
    });

    after(async () => {
      if (!natsAvailable) return;
      if (orderNode) await orderNode.shutdown();
      if (paymentNode) await paymentNode.shutdown();
      if (inventoryNode) await inventoryNode.shutdown();
      if (manager) await manager.disconnect();
    });

    it('should handle fan-out example from docs', async () => {
      if (!natsAvailable) return;

      const processed = new Map<string, boolean>();

      // Register handler across multiple nodes
      const nodeArray = createNodeArray([orderNode, paymentNode, inventoryNode]);
      nodeArray.on('update', (event, context) => {
        const nodeId = context.node?.id;
        processed.set(nodeId, true);
        return { updated: true, node: nodeId };
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Send to all nodes
      const result = await nodeArray.send({
        type: 'update',
        payload: { data: 'test' }
      });

      const results = await result.return();

      assert.ok(results['order-service']);
      assert.ok(results['payment-service']);
      assert.ok(results['inventory-service']);
    });

    it('should handle divergent flows example from docs', async () => {
      if (!natsAvailable) return;

      const flows = new Map<string, string>();

      const nodeArray = createNodeArray([orderNode, inventoryNode]);

      nodeArray.on('order-updated', function validateUpdate(event, context) {
        const nodeId = context.node?.id;

        // Each node returns different next function based on its role
        if (nodeId === 'order-service') {
          flows.set(nodeId, 'order-path');
          return { path: 'order' };
        } else if (nodeId === 'inventory-service') {
          flows.set(nodeId, 'inventory-path');
          return { path: 'inventory' };
        }

        return null;
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      const result = await nodeArray.send({
        type: 'order-updated',
        payload: { orderId: 'ORD-123' }
      });

      const results = await result.return();

      // Each node followed its own path
      assert.strictEqual(results['order-service'].path, 'order');
      assert.strictEqual(results['inventory-service'].path, 'inventory');
    });

    it('should handle batch processing example from docs', async () => {
      if (!natsAvailable) return;

      let batchSize = 0;

      orderNode.on('data-point', (eventOrEvents, context) => {
        if (Array.isArray(eventOrEvents)) {
          batchSize = eventOrEvents.length;
          return {
            processBatch: true,
            count: eventOrEvents.length,
            sum: eventOrEvents.reduce((acc, e) => acc + e.payload.value, 0)
          };
        } else {
          return {
            processSingle: true,
            value: eventOrEvents.payload.value
          };
        }
      });

      const events = [
        createEvent('data-point', { value: 10 }, 'sender'),
        createEvent('data-point', { value: 20 }, 'sender'),
        createEvent('data-point', { value: 30 }, 'sender')
      ];

      const result = await orderNode.process(events);

      assert.strictEqual(result.processBatch, true);
      assert.strictEqual(result.count, 3);
      assert.strictEqual(result.sum, 60);
      assert.strictEqual(batchSize, 3);
    });
  });

  describe('Context in Multi-Node Operations', () => {
    let manager: NatsConnectionManager;
    let node1: HappenNode;
    let node2: HappenNode;

    before(async () => {
      if (!natsAvailable) return;
      manager = new NatsConnectionManager();
      await manager.connect();
      node1 = new HappenNode('context-node-1', manager, new Map());
      node2 = new HappenNode('context-node-2', manager, new Map());
      await node1.initialize();
      await node2.initialize();
    });

    after(async () => {
      if (!natsAvailable) return;
      if (node1) await node1.shutdown();
      if (node2) await node2.shutdown();
      if (manager) await manager.disconnect();
    });

    it('should provide node-specific context', async () => {
      if (!natsAvailable) return;

      const contexts = new Map<string, any>();

      const nodeArray = createNodeArray([node1, node2]);

      nodeArray.on('test.context', (event, context) => {
        const nodeId = context.node?.id;
        contexts.set(nodeId, context);

        // Each node can maintain its own state in context
        context.nodeState = { lastProcessed: Date.now() };

        return { node: nodeId };
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      await nodeArray.send({
        type: 'test.context',
        payload: {}
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Each node should have its own context
      assert.ok(contexts.has('context-node-1'));
      assert.ok(contexts.has('context-node-2'));

      const ctx1 = contexts.get('context-node-1');
      const ctx2 = contexts.get('context-node-2');

      assert.strictEqual(ctx1.node.id, 'context-node-1');
      assert.strictEqual(ctx2.node.id, 'context-node-2');
    });
  });
});
