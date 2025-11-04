/**
 * Tests for Views system
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { HappenNode } from '../src/node.js';
import { NatsConnectionManager } from '../src/nats-connection.js';
import { createViews } from '../src/views.js';

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

describe('Views', () => {
  let natsAvailable = false;

  before(async () => {
    natsAvailable = await isNatsAvailable();
    if (!natsAvailable) {
      console.log('\n⚠️  NATS server not available. Skipping Views integration tests.');
      console.log('Start NATS with: docker run --rm -p 4222:4222 -p 8222:8222 nats:latest -js\n');
    }
  });

  describe('Cross-Node State Access', () => {
    let manager: NatsConnectionManager;
    let nodeRegistry: Map<string, HappenNode>;
    let customerNode: HappenNode;
    let orderNode: HappenNode;
    let inventoryNode: HappenNode;

    before(async () => {
      if (!natsAvailable) return;

      manager = new NatsConnectionManager({ servers: 'localhost:4222' });
      await manager.connect();

      nodeRegistry = new Map();

      // Create nodes with persistence
      customerNode = new HappenNode('customer-service', manager, nodeRegistry, { persistent: true });
      orderNode = new HappenNode('order-service', manager, nodeRegistry, { persistent: true });
      inventoryNode = new HappenNode('inventory-service', manager, nodeRegistry, { persistent: true });

      nodeRegistry.set('customer-service', customerNode);
      nodeRegistry.set('order-service', orderNode);
      nodeRegistry.set('inventory-service', inventoryNode);

      await customerNode.initialize();
      await orderNode.initialize();
      await inventoryNode.initialize();

      // Set some initial state
      await customerNode.state.set(() => ({
        customerId: 'CUST-123',
        name: 'Alice',
        email: 'alice@example.com'
      }));

      await inventoryNode.state.set(() => ({
        productId: 'PROD-456',
        stock: 100,
        reserved: 0
      }));
    });

    after(async () => {
      if (manager) {
        await customerNode?.shutdown();
        await orderNode?.shutdown();
        await inventoryNode?.shutdown();
        await manager.disconnect();
      }
    });

    it('should access another node\'s state through views', async () => {
      if (!natsAvailable) return;

      // Order node accesses customer state
      await orderNode.state.set(async (state, views) => {
        const customerData = await views['customer-service'].get();

        return {
          ...state,
          orderId: 'ORD-789',
          customer: customerData
        };
      });

      const orderState = await orderNode.state.get();
      assert.strictEqual(orderState.customer.customerId, 'CUST-123');
      assert.strictEqual(orderState.customer.name, 'Alice');
    });

    it('should transform viewed state', async () => {
      if (!natsAvailable) return;

      await orderNode.state.set(async (state, views) => {
        const customerName = await views['customer-service'].get(
          (customerState: any) => customerState.name
        );

        return {
          ...state,
          customerName
        };
      });

      const orderState = await orderNode.state.get();
      assert.strictEqual(orderState.customerName, 'Alice');
    });

    it('should collect data from multiple nodes', async () => {
      if (!natsAvailable) return;

      await orderNode.state.set(async (state, views) => {
        const collected = await views.collect({
          'customer-service': (s: any) => ({ name: s.name, email: s.email }),
          'inventory-service': (s: any) => ({ stock: s.stock, available: s.stock - s.reserved })
        });

        return {
          ...state,
          orderSummary: collected
        };
      });

      const orderState = await orderNode.state.get();
      assert.deepStrictEqual(orderState.orderSummary['customer-service'], {
        name: 'Alice',
        email: 'alice@example.com'
      });
      assert.deepStrictEqual(orderState.orderSummary['inventory-service'], {
        stock: 100,
        available: 100
      });
    });

    it('should handle accessing non-existent nodes', async () => {
      if (!natsAvailable) return;

      await orderNode.state.set(async (state, views) => {
        const nonExistent = await views['non-existent-node'].get();

        return {
          ...state,
          nonExistentData: nonExistent
        };
      });

      const orderState = await orderNode.state.get();
      assert.strictEqual(orderState.nonExistentData, null);
    });

    it('should not allow accessing own state through views', async () => {
      if (!natsAvailable) return;

      await orderNode.state.set(async (state, views) => {
        const ownState = await views['order-service'].get();

        return {
          ...state,
          selfAccess: ownState
        };
      });

      const orderState = await orderNode.state.get();
      assert.strictEqual(orderState.selfAccess, null);
    });

    it('should work with state transformers that do not use views', async () => {
      if (!natsAvailable) return;

      // Transformer with only one parameter should still work
      await orderNode.state.set((state) => ({
        ...state,
        simpleUpdate: true
      }));

      const orderState = await orderNode.state.get();
      assert.strictEqual(orderState.simpleUpdate, true);
    });
  });

  describe('Views Creation', () => {
    it('should create views proxy', () => {
      const nodeRegistry = new Map();
      const manager = new NatsConnectionManager();
      const node = new HappenNode('test-node', manager, nodeRegistry);

      const views = createViews(node, nodeRegistry);
      assert.ok(views);
      assert.strictEqual(typeof views.collect, 'function');
    });
  });
});
