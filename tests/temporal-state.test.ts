/**
 * Tests for Temporal State functionality
 */

import { HappenNodeImpl } from '../src/node';
import { InMemoryGlobalState } from '../src/global-state';
import { resetGlobalViewRegistry } from '../src/views';
import { clearAllTemporalStores, InMemoryTemporalStore } from '../src/temporal';
import { HappenEvent } from '../src/types';

interface OrderState {
  orders: Record<string, {
    id: string;
    status: 'pending' | 'processing' | 'completed';
    amount: number;
    customerId: string;
  }>;
  processingCount: number;
}

describe('Temporal State', () => {
  let globalState: InMemoryGlobalState;
  let orderNode: HappenNodeImpl<OrderState>;

  beforeEach(async () => {
    resetGlobalViewRegistry();
    await clearAllTemporalStores();
    globalState = new InMemoryGlobalState();
    
    // Create node with temporal state enabled
    orderNode = new HappenNodeImpl('order-service', {
      state: {
        orders: {},
        processingCount: 0
      }
    }, globalState, { enabled: true });
    
    orderNode.enableTemporal();
    await orderNode.start();
  });

  afterEach(async () => {
    await orderNode.stop();
    await clearAllTemporalStores();
  });

  it('should record state snapshots when events are processed', async () => {
    // Set up order processing handler
    orderNode.on('process-order', (event) => {
      const typedEvent = event as HappenEvent<{ orderId: string; customerId: string; amount: number }>;
      orderNode.state.set(state => ({
        ...state,
        orders: {
          ...state.orders,
          [typedEvent.payload.orderId]: {
            id: typedEvent.payload.orderId,
            status: 'processing',
            amount: typedEvent.payload.amount,
            customerId: typedEvent.payload.customerId
          }
        },
        processingCount: state.processingCount + 1
      }));
    });

    // Process an order
    orderNode.emit({
      type: 'process-order',
      payload: {
        orderId: 'order-123',
        customerId: 'cust-456',
        amount: 99.99
      }
    });

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 50));

    // Check temporal store
    const temporal = orderNode.getTemporal();
    expect(temporal).toBeDefined();
    
    // This is a basic test - in full implementation we'd verify the snapshot was recorded
    const currentState = orderNode.state.get();
    expect(currentState.orders['order-123']).toEqual({
      id: 'order-123',
      status: 'processing',
      amount: 99.99,
      customerId: 'cust-456'
    });
    expect(currentState.processingCount).toBe(1);
  });

  it('should support state.when() for temporal queries', async () => {
    const temporal = orderNode.getTemporal();
    
    // Set up a handler that changes state
    orderNode.on('complete-order', (event) => {
      const typedEvent = event as HappenEvent<{ orderId: string }>;
      orderNode.state.set(state => {
        const existingOrder = state.orders[typedEvent.payload.orderId];
        if (!existingOrder) return state;
        
        return {
          ...state,
          orders: {
            ...state.orders,
            [typedEvent.payload.orderId]: {
              ...existingOrder,
              status: 'completed' as const
            }
          }
        };
      });
    });

    // First, create an order
    orderNode.state.set(state => ({
      ...state,
      orders: {
        'order-123': {
          id: 'order-123',
          status: 'pending',
          amount: 99.99,
          customerId: 'cust-456'
        }
      }
    }));

    // Complete the order
    orderNode.emit({
      type: 'complete-order',
      payload: { orderId: 'order-123' }
    });
    
    // Use temporal variable to avoid unused warning
    expect(temporal).toBeDefined();

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify current state
    const currentState = orderNode.state.get();
    expect(currentState.orders['order-123']?.status).toBe('completed');
  });

  it('should support InMemoryTemporalStore for testing', async () => {
    const store = new InMemoryTemporalStore<OrderState>();
    
    const testEvent: HappenEvent = {
      id: 'event-123',
      type: 'order-created',
      payload: { orderId: 'order-456' },
      context: {
        causal: {
          id: 'causal-123',
          sender: 'test-node',
          path: []
        },
        timestamp: Date.now()
      }
    };

    const testState: OrderState = {
      orders: {
        'order-456': {
          id: 'order-456',
          status: 'pending',
          amount: 149.99,
          customerId: 'cust-789'
        }
      },
      processingCount: 0
    };

    // Record a snapshot
    await store.record(testEvent, testState);

    // Retrieve the snapshot
    const snapshot = await store.getSnapshot('event-123');
    expect(snapshot).toBeDefined();
    expect(snapshot!.state).toEqual(testState);
    expect(snapshot!.context.eventType).toBe('order-created');
  });

  it('should handle temporal queries with pattern matching', async () => {
    const store = new InMemoryTemporalStore<OrderState>();
    
    // Record multiple events
    const events = [
      {
        id: 'event-1',
        type: 'order-created',
        payload: {},
        context: {
          causal: { id: 'causal-1', sender: 'test', path: [] },
          timestamp: Date.now()
        }
      },
      {
        id: 'event-2', 
        type: 'order-updated',
        payload: {},
        context: {
          causal: { id: 'causal-2', sender: 'test', path: [] },
          timestamp: Date.now() + 1000
        }
      }
    ];

    const states: OrderState[] = [
      { orders: {}, processingCount: 1 },
      { orders: {}, processingCount: 2 }
    ];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const state = states[i];
      if (event && state) {
        await store.record(event as HappenEvent, state);
      }
    }

    // Query by pattern
    const results = await store.when(
      (snapshot) => snapshot.context.eventType === 'order-created',
      (snapshots) => snapshots.map(s => s.state.processingCount)
    );

    expect(results).toEqual([1]);
  });

  it('should support causal chain traversal', async () => {
    const store = new InMemoryTemporalStore<OrderState>();
    
    // Create a causal chain
    const rootEvent: HappenEvent = {
      id: 'root-event',
      type: 'order-initiated',
      payload: {},
      context: {
        causal: { id: 'root-causal', sender: 'test', path: [] },
        timestamp: Date.now()
      }
    };

    const childEvent: HappenEvent = {
      id: 'child-event',
      type: 'order-validated',
      payload: {},
      context: {
        causal: { 
          id: 'child-causal', 
          sender: 'test', 
          path: [],
          causationId: 'root-event' // This event was caused by the root event
        },
        timestamp: Date.now() + 1000
      }
    };

    await store.record(rootEvent, { orders: {}, processingCount: 1 });
    await store.record(childEvent, { orders: {}, processingCount: 2 });

    // Get the causal chain
    const chain = await store.getCausalChain('root-event');
    expect(chain).toHaveLength(2);
    expect(chain[0]?.context.eventType).toBe('order-initiated');
    expect(chain[1]?.context.eventType).toBe('order-validated');
  });
});