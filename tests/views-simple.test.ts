/**
 * Simple tests for Views system core functionality
 */

import { ViewRegistry, ViewUtils } from '../src/views';
import { HappenNodeImpl } from '../src/node';
import { InMemoryGlobalState } from '../src/global-state';

describe('Views System Core', () => {
  let registry: ViewRegistry;
  let globalState: any;
  let customerNode: any;
  let orderNode: any;

  beforeEach(() => {
    registry = new ViewRegistry();
    globalState = new InMemoryGlobalState();
    
    customerNode = new HappenNodeImpl('customer', {
      state: {
        customers: {
          'cust1': { id: 'cust1', name: 'John Doe', email: 'john@example.com' },
          'cust2': { id: 'cust2', name: 'Jane Smith', email: 'jane@example.com' }
        }
      }
    }, globalState);
    
    orderNode = new HappenNodeImpl('order', {
      state: {
        orders: [
          { id: 'order1', customerId: 'cust1', amount: 100, status: 'pending' },
          { id: 'order2', customerId: 'cust2', amount: 250, status: 'completed' }
        ]
      }
    }, globalState);
    
    // Manually register nodes for testing
    registry.registerNode(customerNode);
    registry.registerNode(orderNode);
  });

  afterEach(() => {
    registry.unregisterNode(customerNode.id);
    registry.unregisterNode(orderNode.id);
  });

  describe('ViewRegistry Basic Operations', () => {
    it('should register and track nodes', () => {
      expect(registry.hasNode(customerNode.id)).toBe(true);
      expect(registry.hasNode(orderNode.id)).toBe(true);
      expect(registry.getRegisteredNodes()).toContain(customerNode.id);
      expect(registry.getRegisteredNodes()).toContain(orderNode.id);
    });

    it('should get state from registered nodes', async () => {
      const customerData = await registry.getState(
        customerNode.id,
        (state: any) => state.customers['cust1']
      );
      
      expect(customerData).toEqual({
        id: 'cust1',
        name: 'John Doe',
        email: 'john@example.com'
      });
    });

    it('should handle caching', () => {
      registry.cache('test-key', 'test-value', 1000);
      expect(registry.getCached('test-key')).toBe('test-value');
      
      registry.clearCache();
      expect(registry.getCached('test-key')).toBeUndefined();
    });

    it('should collect data from multiple nodes', async () => {
      const data = await registry.collect({
        customer: {
          nodeId: customerNode.id,
          selector: (state: any) => state.customers['cust1']
        },
        orders: {
          nodeId: orderNode.id,
          selector: (state: any) => state.orders.filter((o: any) => o.customerId === 'cust1')
        }
      });
      
      expect(data.customer.name).toBe('John Doe');
      expect(data.orders).toHaveLength(1);
      expect(data.orders[0].id).toBe('order1');
    });
  });

  describe('ViewUtils', () => {
    it('should create simple view definitions', () => {
      const viewDef = ViewUtils.view(
        customerNode.id,
        (state: any) => state.customers['cust1']
      );
      
      expect(viewDef.nodeId).toBe(customerNode.id);
      expect(typeof viewDef.selector).toBe('function');
    });

    it('should create lens-based views', async () => {
      const lensView = ViewUtils.lens(customerNode.id, 'customers.cust1.name');
      
      const name = await registry.getState(lensView.nodeId, lensView.selector);
      expect(name).toBe('John Doe');
    });

    it('should create filtered views', async () => {
      const filteredView = ViewUtils.filter(
        orderNode.id,
        (state: any) => state.orders,
        (order: any) => order.status === 'pending'
      );
      
      const pendingOrders = await registry.getState(filteredView.nodeId, filteredView.selector);
      expect(pendingOrders).toHaveLength(1);
      expect((pendingOrders as any)[0].id).toBe('order1');
    });

    it('should create aggregated views', async () => {
      const aggregatedView = ViewUtils.reduce(
        orderNode.id,
        (state: any) => state.orders,
        (acc: number, order: any) => acc + order.amount,
        0
      );
      
      const totalAmount = await registry.getState(aggregatedView.nodeId, aggregatedView.selector);
      expect(totalAmount).toBe(350);
    });
  });

  describe('Error Handling', () => {
    it('should handle access to non-existent nodes', async () => {
      await expect(
        registry.getState('non-existent-node', (state: any) => state)
      ).rejects.toThrow('Node non-existent-node not found');
    });

    it('should handle invalid selectors gracefully', async () => {
      await expect(
        registry.getState(customerNode.id, (_state: any) => {
          throw new Error('Selector error');
        })
      ).rejects.toThrow('Failed to access state from node');
    });
  });
});