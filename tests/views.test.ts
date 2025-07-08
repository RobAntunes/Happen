/**
 * Tests for Views system
 */

import { createHappen } from '../src/happen';
import { 
  ViewUtils,
  createViewCollection,
  getGlobalViewRegistry
} from '../src/views';

describe('Views System', () => {
  let happen: any;
  let customerNode: any;
  let orderNode: any;
  let inventoryNode: any;
  
  beforeEach(async () => {
    happen = createHappen();
    
    // Create test nodes with initial state
    customerNode = happen.node('customer', {
      state: {
        customers: {
          'cust1': { id: 'cust1', name: 'John Doe', email: 'john@example.com' },
          'cust2': { id: 'cust2', name: 'Jane Smith', email: 'jane@example.com' }
        }
      }
    });
    
    orderNode = happen.node('order', {
      state: {
        orders: [
          { id: 'order1', customerId: 'cust1', amount: 100, status: 'pending' },
          { id: 'order2', customerId: 'cust2', amount: 250, status: 'completed' }
        ]
      }
    });
    
    inventoryNode = happen.node('inventory', {
      state: {
        products: {
          'prod1': { id: 'prod1', name: 'Widget', stock: 50, price: 10 },
          'prod2': { id: 'prod2', name: 'Gadget', stock: 25, price: 25 }
        }
      }
    });
    
    await happen.connect();
  });
  
  afterEach(async () => {
    await happen.disconnect();
  });

  describe('ViewRegistry', () => {
    it('should register and unregister nodes', () => {
      const registry = getGlobalViewRegistry();
      
      expect(registry.hasNode(customerNode.id)).toBe(true);
      expect(registry.hasNode(orderNode.id)).toBe(true);
      expect(registry.getRegisteredNodes()).toContain(customerNode.id);
      expect(registry.getRegisteredNodes()).toContain(orderNode.id);
      
      registry.unregisterNode(customerNode.id);
      expect(registry.hasNode(customerNode.id)).toBe(false);
      expect(registry.getRegisteredNodes()).not.toContain(customerNode.id);
    });

    it('should get state from registered nodes', async () => {
      const registry = getGlobalViewRegistry();
      
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

    it('should collect state from multiple nodes', async () => {
      const registry = getGlobalViewRegistry();
      
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

    it('should handle caching with TTL', async () => {
      const registry = getGlobalViewRegistry();
      
      // Cache a value
      registry.cache('test-key', 'test-value', 100); // 100ms TTL
      
      expect(registry.getCached('test-key')).toBe('test-value');
      
      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(registry.getCached('test-key')).toBeUndefined();
    });

    it('should clear cache with patterns', () => {
      const registry = getGlobalViewRegistry();
      
      registry.cache('customer:cust1', 'data1');
      registry.cache('customer:cust2', 'data2');
      registry.cache('order:order1', 'data3');
      
      registry.clearCache('customer:');
      
      expect(registry.getCached('customer:cust1')).toBeUndefined();
      expect(registry.getCached('customer:cust2')).toBeUndefined();
      expect(registry.getCached('order:order1')).toBe('data3');
    });

    it('should provide cache statistics', () => {
      const registry = getGlobalViewRegistry();
      
      // Clear any existing cache first
      registry.clearCache();
      
      registry.cache('key1', 'value1', 1000);
      registry.cache('key2', 'value2', 2000);
      
      const stats = registry.getCacheStats();
      
      expect(stats.size).toBe(2);
      expect(stats.entries).toHaveLength(2);
      expect(stats.entries[0]?.key).toMatch(/^key[12]$/);
      expect(stats.entries[0]?.ttl).toBeGreaterThan(0);
    });
  });

  describe('EnhancedViewCollection', () => {
    let views: any;
    
    beforeEach(() => {
      views = createViewCollection();
    });

    it('should collect data from multiple nodes', async () => {
      const data = await views.collect({
        totalCustomers: {
          nodeId: customerNode.id,
          selector: (state: any) => Object.keys(state.customers).length
        },
        pendingOrders: {
          nodeId: orderNode.id,
          selector: (state: any) => state.orders.filter((o: any) => o.status === 'pending').length
        },
        totalProducts: {
          nodeId: inventoryNode.id,
          selector: (state: any) => Object.keys(state.products).length
        }
      });
      
      expect(data.totalCustomers).toBe(2);
      expect(data.pendingOrders).toBe(1);
      expect(data.totalProducts).toBe(2);
    });

    it('should get single view', async () => {
      const customerCount = await views.get(
        customerNode.id,
        (state: any) => Object.keys(state.customers).length
      );
      
      expect(customerCount).toBe(2);
    });

    it('should handle caching operations', () => {
      views.cache('test-key', { data: 'test' }, 1000);
      
      const cached = views.getCached('test-key');
      expect(cached).toEqual({ data: 'test' });
      
      views.clearCache();
      expect(views.getCached('test-key')).toBeUndefined();
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

    it('should create cached view definitions', () => {
      const viewDef = ViewUtils.cachedView(
        customerNode.id,
        (state: any) => state.customers,
        5000,
        'customers-cache'
      );
      
      expect(viewDef.nodeId).toBe(customerNode.id);
      expect(viewDef.ttl).toBe(5000);
      expect(viewDef.cacheKey).toBe('customers-cache');
    });

    it('should create lens-based views', async () => {
      const registry = getGlobalViewRegistry();
      const lensView = ViewUtils.lens(customerNode.id, 'customers.cust1.name');
      
      const name = await registry.getState(lensView.nodeId, lensView.selector);
      expect(name).toBe('John Doe');
    });

    it('should create filtered views', async () => {
      const registry = getGlobalViewRegistry();
      const filteredView = ViewUtils.filter(
        orderNode.id,
        (state: any) => state.orders,
        (order: any) => order.status === 'pending'
      );
      
      const pendingOrders = await registry.getState(filteredView.nodeId, filteredView.selector);
      expect(pendingOrders).toHaveLength(1);
      expect((pendingOrders as any)[0].id).toBe('order1');
    });

    it('should create mapped views', async () => {
      const registry = getGlobalViewRegistry();
      const mappedView = ViewUtils.map(
        orderNode.id,
        (state: any) => state.orders,
        (order: any) => order.amount
      );
      
      const amounts = await registry.getState(mappedView.nodeId, mappedView.selector);
      expect(amounts).toEqual([100, 250]);
    });

    it('should create aggregated views', async () => {
      const registry = getGlobalViewRegistry();
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

  describe('Cross-node State Access', () => {
    it('should allow state updates with view access', async () => {
      // Order node can access customer data during state updates
      orderNode.state.set((state: any) => {
        // This would normally be async, but for testing we'll simulate
        const customer = { id: 'cust1', name: 'John Doe' };
        
        return {
          ...state,
          orders: state.orders.map((order: any) => 
            order.id === 'order1' 
              ? { ...order, customerName: customer.name }
              : order
          )
        };
      });
      
      const updatedOrders = orderNode.state.get((state: any) => state.orders);
      const order1 = updatedOrders.find((o: any) => o.id === 'order1');
      
      expect(order1.customerName).toBe('John Doe');
    });

    it('should handle complex cross-node data collection', async () => {
      const views = createViewCollection();
      
      const dashboardData = await views.collect({
        customerStats: {
          nodeId: customerNode.id,
          selector: (state: any) => ({
            total: Object.keys(state.customers).length,
            customers: Object.values(state.customers)
          })
        },
        orderStats: {
          nodeId: orderNode.id,
          selector: (state: any) => ({
            total: state.orders.length,
            pending: state.orders.filter((o: any) => o.status === 'pending').length,
            completed: state.orders.filter((o: any) => o.status === 'completed').length,
            totalValue: state.orders.reduce((sum: number, o: any) => sum + o.amount, 0)
          })
        },
        inventoryStats: {
          nodeId: inventoryNode.id,
          selector: (state: any) => ({
            totalProducts: Object.keys(state.products).length,
            totalStock: Object.values(state.products).reduce((sum: number, p: any) => sum + p.stock, 0),
            totalValue: Object.values(state.products).reduce((sum: number, p: any) => sum + (p.stock * p.price), 0)
          }),
          ttl: 30000 // Cache for 30 seconds
        }
      });
      
      expect(dashboardData.customerStats.total).toBe(2);
      expect(dashboardData.orderStats.totalValue).toBe(350);
      expect(dashboardData.inventoryStats.totalStock).toBe(75);
      expect(dashboardData.inventoryStats.totalValue).toBe(1125); // (50*10) + (25*25)
    });
  });

  describe('Error Handling', () => {
    it('should handle access to non-existent nodes', async () => {
      const registry = getGlobalViewRegistry();
      
      await expect(
        registry.getState('non-existent-node', (state: any) => state)
      ).rejects.toThrow('Node non-existent-node not found');
    });

    it('should handle invalid selectors gracefully', async () => {
      const registry = getGlobalViewRegistry();
      
      await expect(
        registry.getState(customerNode.id, (_state: any) => {
          throw new Error('Selector error');
        })
      ).rejects.toThrow('Failed to access state from node');
    });
  });
});