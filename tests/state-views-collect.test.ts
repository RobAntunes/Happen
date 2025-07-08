/**
 * Tests for state management with views.collect() pattern
 */

import { HappenNodeImpl } from '../src/node';
import { InMemoryGlobalState } from '../src/global-state';
import { resetGlobalViewRegistry } from '../src/views';
import { ViewCollection } from '../src/types';

describe('State Management - Views Collect Pattern', () => {
  let globalState: InMemoryGlobalState;
  let orderNode: HappenNodeImpl;
  let customerNode: HappenNodeImpl;
  let inventoryNode: HappenNodeImpl;

  beforeEach(async () => {
    resetGlobalViewRegistry();
    globalState = new InMemoryGlobalState();
    
    // Create domain-specific nodes
    orderNode = new HappenNodeImpl('order-service', {}, globalState);
    customerNode = new HappenNodeImpl('customer-service', {}, globalState);
    inventoryNode = new HappenNodeImpl('inventory-service', {}, globalState);
    
    // Initialize state for each node
    customerNode.state.set(() => ({
      customers: {
        'cust-123': {
          name: 'John Doe',
          address: '123 Main St',
          region: 'us-west'
        }
      }
    }));
    
    inventoryNode.state.set(() => ({
      products: {
        'prod-456': {
          name: 'Widget',
          quantity: 100,
          leadTime: 3
        }
      },
      ratesByRegion: {
        'us-west': { standard: 5.99, express: 12.99 }
      },
      availableMethods: ['standard', 'express']
    }));
    
    await orderNode.start();
    await customerNode.start();
    await inventoryNode.start();
  });

  afterEach(async () => {
    await orderNode.stop();
    await customerNode.stop();
    await inventoryNode.stop();
  });

  it('should collect data from multiple nodes using views.collect()', () => {
    // Use views.collect() in state transformation
    orderNode.state.set((state: any, views?: ViewCollection) => {
      // Collect state from multiple nodes
      const data = views!.collect({
        customer: (state: any) => ({
          name: state.customers?.['cust-123']?.name,
          address: state.customers?.['cust-123']?.address
        }),
        inventory: (state: any) => ({
          inStock: (state.products?.['prod-456']?.quantity || 0) > 0,
          leadTime: state.products?.['prod-456']?.leadTime
        })
      });
      
      // Return updated state with collected data
      return {
        ...state,
        orders: {
          'order-789': {
            customerId: 'cust-123',
            productId: 'prod-456',
            status: 'pending',
            fulfillmentData: data
          }
        }
      };
    });
    
    // Verify the collected data was properly set
    const orderState = orderNode.state.get();
    const order = orderState.orders?.['order-789'];
    
    expect(order).toBeDefined();
    expect(order.fulfillmentData).toEqual({
      customer: {
        name: 'John Doe',
        address: '123 Main St'
      },
      inventory: {
        inStock: true,
        leadTime: 3
      }
    });
  });

  it('should handle missing nodes gracefully in collect()', () => {
    orderNode.state.set((state: any, views?: ViewCollection) => {
      // Try to collect from non-existent node
      const data = views!.collect({
        shipping: (state: any) => state?.shippingRates,
        customer: (state: any) => state?.customers?.['cust-123']?.name
      });
      
      return {
        ...state,
        collectedData: data
      };
    });
    
    const state = orderNode.state.get();
    expect(state.collectedData).toEqual({
      shipping: undefined, // Non-existent node
      customer: 'John Doe' // Existing node
    });
  });

  it('should work with complex selectors in collect()', () => {
    orderNode.state.set((state: any, views?: ViewCollection) => {
      const regionData = views!.collect({
        inventory: (state: any) => {
          const region = 'us-west';
          return {
            rates: state.ratesByRegion?.[region],
            methods: state.availableMethods
          };
        }
      });
      
      return {
        ...state,
        shippingOptions: regionData.inventory
      };
    });
    
    const state = orderNode.state.get();
    expect(state.shippingOptions).toEqual({
      rates: { standard: 5.99, express: 12.99 },
      methods: ['standard', 'express']
    });
  });
});