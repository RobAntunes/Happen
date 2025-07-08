/**
 * Tests for Event Continuum matching the spec exactly
 */

import { processContinuum } from '../src/continuum';
import { HappenEvent, EventHandler } from '../src/types';

describe('Event Continuum - Spec Compliance', () => {
  const createTestEvent = (type: string, payload: any): HappenEvent => ({
    id: 'test-123',
    type,
    payload,
    context: {
      causal: {
        id: 'test-123',
        sender: 'test-node',
        path: ['test-node']
      },
      timestamp: Date.now()
    }
  });

  describe('Pure Functional Flow Model', () => {
    it('should support function returns to continue flow', async () => {
      const executionOrder: string[] = [];

      const validateOrder: EventHandler = (eventOrEvents, _context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        executionOrder.push('validateOrder');
        if (!(event.payload as any).valid) {
          return { success: false, reason: 'Invalid order' };
        }
        return processOrder;
      };

      const processOrder: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        executionOrder.push('processOrder');
        context.orderId = 'order-123';
        return notifyCustomer;
      };

      const notifyCustomer: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        executionOrder.push('notifyCustomer');
        return { success: true, orderId: context.orderId };
      };

      const event = createTestEvent('create-order', { valid: true });
      const result = await processContinuum(validateOrder, event, 'test-node');

      expect(executionOrder).toEqual(['validateOrder', 'processOrder', 'notifyCustomer']);
      expect(result).toEqual({ success: true, orderId: 'order-123' });
    });

    it('should complete flow when returning non-function value', async () => {
      const handler: EventHandler = (eventOrEvents, _context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        if (!(event.payload as any).valid) {
          return { success: false, reason: 'Invalid data' };
        }
        return { success: true };
      };

      const event = createTestEvent('test', { valid: false });
      const result = await processContinuum(handler, event, 'test-node');

      expect(result).toEqual({ success: false, reason: 'Invalid data' });
    });
  });

  describe('Shared Context', () => {
    it('should pass mutable context through handler chain', async () => {
      const handler1: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        context.step1 = 'completed';
        context.data = { count: 1 };
        return handler2;
      };

      const handler2: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        expect(context.step1).toBe('completed');
        context.data.count++;
        context.step2 = 'completed';
        return handler3;
      };

      const handler3: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        expect(context.step1).toBe('completed');
        expect(context.step2).toBe('completed');
        expect(context.data.count).toBe(2);
        return { allSteps: [context.step1, context.step2], count: context.data.count };
      };

      const event = createTestEvent('test', {});
      const result = await processContinuum(handler1, event, 'test-node');

      expect(result).toEqual({
        allSteps: ['completed', 'completed'],
        count: 2
      });
    });
  });

  describe('Dynamic Flow Selection', () => {
    it('should support conditional branching', async () => {
      const determinePaymentMethod: EventHandler = (eventOrEvents, _context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        const method = (event.payload as any).paymentMethod;
        
        if (method === 'credit-card') {
          return processCreditCard;
        } else if (method === 'paypal') {
          return processPaypal;
        } else {
          return processAlternativePayment;
        }
      };

      const processCreditCard: EventHandler = (eventOrEvents, _context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        return { processed: 'credit-card', amount: (event.payload as any).amount };
      };

      const processPaypal: EventHandler = (eventOrEvents, _context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        return { processed: 'paypal', amount: (event.payload as any).amount };
      };

      const processAlternativePayment: EventHandler = (eventOrEvents, _context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        return { processed: 'alternative', amount: (event.payload as any).amount };
      };

      // Test credit card
      let event = createTestEvent('payment', { paymentMethod: 'credit-card', amount: 100 });
      let result = await processContinuum(determinePaymentMethod, event, 'test-node');
      expect(result).toEqual({ processed: 'credit-card', amount: 100 });

      // Test paypal
      event = createTestEvent('payment', { paymentMethod: 'paypal', amount: 200 });
      result = await processContinuum(determinePaymentMethod, event, 'test-node');
      expect(result).toEqual({ processed: 'paypal', amount: 200 });

      // Test alternative
      event = createTestEvent('payment', { paymentMethod: 'bitcoin', amount: 300 });
      result = await processContinuum(determinePaymentMethod, event, 'test-node');
      expect(result).toEqual({ processed: 'alternative', amount: 300 });
    });
  });

  describe('Loop Patterns', () => {
    it('should support recursive loops', async () => {
      const processItems: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        // Initialize if first time
        if (!context.itemIndex) {
          context.itemIndex = 0;
          context.results = [];
        }

        // Get current item
        const items = (event.payload as any).items;
        const currentItem = items[context.itemIndex];

        // Process current item
        context.results.push(`processed-${currentItem}`);

        // Increment index
        context.itemIndex++;

        // Loop if more items
        if (context.itemIndex < items.length) {
          return processItems; // Loop back to this function
        }

        // Otherwise, return results
        return { processed: context.results };
      };

      const event = createTestEvent('batch', { items: ['A', 'B', 'C'] });
      const result = await processContinuum(processItems, event, 'test-node');

      expect(result).toEqual({
        processed: ['processed-A', 'processed-B', 'processed-C']
      });
    });
  });

  describe('Error Handling Patterns', () => {
    it('should support error branching', async () => {
      const processPayment: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        try {
          if ((event.payload as any).amount < 0) {
            throw new Error('Invalid amount');
          }
          context.payment = { success: true, amount: (event.payload as any).amount };
          return createShipment;
        } catch (error) {
          context.error = error;
          return handlePaymentError;
        }
      };

      const createShipment: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        return { shipped: true, payment: context.payment };
      };

      const handlePaymentError: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        return {
          success: false,
          reason: 'payment-failed',
          error: context.error.message
        };
      };

      // Test success case
      let event = createTestEvent('order', { amount: 100 });
      let result = await processContinuum(processPayment, event, 'test-node');
      expect(result).toEqual({ shipped: true, payment: { success: true, amount: 100 } });

      // Test error case
      event = createTestEvent('order', { amount: -10 });
      result = await processContinuum(processPayment, event, 'test-node');
      expect(result).toEqual({
        success: false,
        reason: 'payment-failed',
        error: 'Invalid amount'
      });
    });
  });

  describe('Bare Return', () => {
    it('should end flow with bare return (undefined)', async () => {
      const handler: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        context.logged = true;
        return; // Bare return - ends flow
      };

      const event = createTestEvent('log', {});
      const result = await processContinuum(handler, event, 'test-node');
      
      expect(result).toBeUndefined();
    });
  });

  describe('Building Complete Workflows', () => {
    it('should support complex order workflow from spec', async () => {
      const executionLog: string[] = [];

      const validateOrder: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        executionLog.push('validateOrder');
        const validation = { valid: (event.payload as any).items.length > 0 };
        if (!validation.valid) {
          return { success: false, errors: ['No items in order'] };
        }
        context.validation = validation;
        return checkInventory;
      };

      const checkInventory: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        executionLog.push('checkInventory');
        const available = (event.payload as any).items.every((item: any) => item.inStock);
        if (!available) {
          return handleInventoryShortage;
        }
        context.inventory = { available };
        return processPayment;
      };

      const processPayment: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        executionLog.push('processPayment');
        const success = (event.payload as any).payment.valid;
        if (!success) {
          return handlePaymentFailure;
        }
        context.payment = { success, transactionId: 'txn-123' };
        return createShipment;
      };

      const createShipment: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        executionLog.push('createShipment');
        context.shipment = { trackingId: 'ship-123' };
        return finalizeOrder;
      };

      const finalizeOrder: EventHandler = (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        executionLog.push('finalizeOrder');
        return {
          success: true,
          order: {
            orderId: 'order-456',
            payment: context.payment,
            shipment: context.shipment,
            status: 'completed'
          }
        };
      };

      const handleInventoryShortage: EventHandler = (eventOrEvents, _context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        executionLog.push('handleInventoryShortage');
        return {
          success: false,
          reason: 'inventory-shortage',
          availableOn: '2024-01-15'
        };
      };

      const handlePaymentFailure: EventHandler = (eventOrEvents, _context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        executionLog.push('handlePaymentFailure');
        return {
          success: false,
          reason: 'payment-failed'
        };
      };

      // Test successful flow
      let event = createTestEvent('process-order', {
        items: [{ id: 1, inStock: true }, { id: 2, inStock: true }],
        payment: { valid: true }
      });
      let result = await processContinuum(validateOrder, event, 'test-node');

      expect(executionLog).toEqual([
        'validateOrder',
        'checkInventory',
        'processPayment',
        'createShipment',
        'finalizeOrder'
      ]);
      expect(result.success).toBe(true);
      expect(result.order.orderId).toBe('order-456');

      // Test inventory shortage
      executionLog.length = 0;
      event = createTestEvent('process-order', {
        items: [{ id: 1, inStock: false }],
        payment: { valid: true }
      });
      result = await processContinuum(validateOrder, event, 'test-node');

      expect(executionLog).toEqual([
        'validateOrder',
        'checkInventory',
        'handleInventoryShortage'
      ]);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('inventory-shortage');
    });
  });
});