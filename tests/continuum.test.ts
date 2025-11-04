/**
 * Tests for Event Continuum processor
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  processEventContinuum,
  processEventContinuumSync,
  isHandler,
  createFlow,
  composeHandlers,
  conditional,
  tap,
  withErrorHandler
} from '../src/continuum.js';
import { createEvent } from '../src/causality.js';
import type { EventHandler, HappenEvent, EventContext } from '../src/types.js';

describe('Event Continuum', () => {
  describe('processEventContinuum', () => {
    it('should process single handler returning result', async () => {
      const handler: EventHandler = (event, context) => {
        return { success: true, value: 42 };
      };

      const event = createEvent('test.event', {}, 'test-node');
      const result = await processEventContinuum(event, handler);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.result, { success: true, value: 42 });
    });

    it('should process chain of handlers', async () => {
      const step1: EventHandler = (event, context) => {
        context.step1 = true;
        return step2;
      };

      const step2: EventHandler = (event, context) => {
        context.step2 = true;
        return step3;
      };

      const step3: EventHandler = (event, context) => {
        context.step3 = true;
        return { completed: true };
      };

      const event = createEvent('test.event', {}, 'test-node');
      const result = await processEventContinuum(event, step1);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.result, { completed: true });
      assert.strictEqual(result.context.step1, true);
      assert.strictEqual(result.context.step2, true);
      assert.strictEqual(result.context.step3, true);
    });

    it('should handle async handlers', async () => {
      const handler: EventHandler = async (event, context) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        context.processed = true;
        return nextHandler;
      };

      const nextHandler: EventHandler = async (event, context) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { success: true };
      };

      const event = createEvent('test.event', {}, 'test-node');
      const result = await processEventContinuum(event, handler);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.context.processed, true);
      assert.deepStrictEqual(result.result, { success: true });
    });

    it('should handle conditional branching', async () => {
      const validator: EventHandler = (event, context) => {
        if (!event.payload.valid) {
          return errorHandler;
        }
        return successHandler;
      };

      const errorHandler: EventHandler = (event, context) => {
        return { success: false, reason: 'Invalid' };
      };

      const successHandler: EventHandler = (event, context) => {
        return { success: true };
      };

      const validEvent = createEvent('test', { valid: true }, 'node');
      const validResult = await processEventContinuum(validEvent, validator);
      assert.deepStrictEqual(validResult.result, { success: true });

      const invalidEvent = createEvent('test', { valid: false }, 'node');
      const invalidResult = await processEventContinuum(invalidEvent, validator);
      assert.deepStrictEqual(invalidResult.result, { success: false, reason: 'Invalid' });
    });

    it('should handle errors in handlers', async () => {
      const handler: EventHandler = (event, context) => {
        throw new Error('Handler error');
      };

      const event = createEvent('test.event', {}, 'test-node');
      const result = await processEventContinuum(event, handler);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.strictEqual(result.error.message, 'Handler error');
    });

    it('should pass context through the chain', async () => {
      const handler1: EventHandler = (event, context) => {
        context.data = [];
        context.data.push('step1');
        return handler2;
      };

      const handler2: EventHandler = (event, context) => {
        context.data.push('step2');
        return handler3;
      };

      const handler3: EventHandler = (event, context) => {
        context.data.push('step3');
        return { steps: context.data };
      };

      const event = createEvent('test', {}, 'node');
      const result = await processEventContinuum(event, handler1);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.result, { steps: ['step1', 'step2', 'step3'] });
    });
  });

  describe('processEventContinuumSync', () => {
    it('should process synchronous handlers', () => {
      const handler: EventHandler = (event, context) => {
        context.processed = true;
        return { success: true };
      };

      const event = createEvent('test.event', {}, 'test-node');
      const result = processEventContinuumSync(event, handler);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.context.processed, true);
    });

    it('should reject async handlers', () => {
      const handler: EventHandler = async (event, context) => {
        return { success: true };
      };

      const event = createEvent('test.event', {}, 'test-node');
      const result = processEventContinuumSync(event, handler);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error.message.includes('Async handlers'));
    });

    it('should process sync handler chains', () => {
      const step1: EventHandler = (event, context) => {
        context.step = 1;
        return step2;
      };

      const step2: EventHandler = (event, context) => {
        context.step = 2;
        return { done: true };
      };

      const event = createEvent('test', {}, 'node');
      const result = processEventContinuumSync(event, step1);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.context.step, 2);
      assert.deepStrictEqual(result.result, { done: true });
    });
  });

  describe('isHandler', () => {
    it('should identify functions as handlers', () => {
      const handler = (event: HappenEvent, context: EventContext) => {};
      assert.strictEqual(isHandler(handler), true);
    });

    it('should reject non-functions', () => {
      assert.strictEqual(isHandler({}), false);
      assert.strictEqual(isHandler('string'), false);
      assert.strictEqual(isHandler(42), false);
      assert.strictEqual(isHandler(null), false);
    });
  });

  describe('composeHandlers', () => {
    it('should compose multiple handlers', async () => {
      const logger: EventHandler = (event, context) => {
        context.logged = true;
        return undefined; // Continue to next
      };

      const validator: EventHandler = (event, context) => {
        if (event.payload.invalid) {
          return { error: 'Invalid' };
        }
        return undefined; // Continue to next
      };

      const processor: EventHandler = (event, context) => {
        return { processed: true };
      };

      const composed = composeHandlers(logger, validator, processor);
      const event = createEvent('test', {}, 'node');
      const result = await processEventContinuum(event, composed);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.context.logged, true);
      assert.deepStrictEqual(result.result, { processed: true });
    });

    it('should stop at first non-undefined result', async () => {
      const handler1: EventHandler = (event, context) => {
        context.h1 = true;
        return undefined;
      };

      const handler2: EventHandler = (event, context) => {
        context.h2 = true;
        return { stopped: true };
      };

      const handler3: EventHandler = (event, context) => {
        context.h3 = true; // Should not execute
        return { continued: true };
      };

      const composed = composeHandlers(handler1, handler2, handler3);
      const event = createEvent('test', {}, 'node');
      const result = await processEventContinuum(event, composed);

      assert.strictEqual(result.context.h1, true);
      assert.strictEqual(result.context.h2, true);
      assert.strictEqual(result.context.h3, undefined);
      assert.deepStrictEqual(result.result, { stopped: true });
    });
  });

  describe('conditional', () => {
    it('should execute then branch when predicate is true', async () => {
      const handler = conditional(
        (event) => event.payload.value > 10,
        (event, context) => ({ branch: 'then' }),
        (event, context) => ({ branch: 'else' })
      );

      const event = createEvent('test', { value: 15 }, 'node');
      const result = await processEventContinuum(event, handler);

      assert.deepStrictEqual(result.result, { branch: 'then' });
    });

    it('should execute else branch when predicate is false', async () => {
      const handler = conditional(
        (event) => event.payload.value > 10,
        (event, context) => ({ branch: 'then' }),
        (event, context) => ({ branch: 'else' })
      );

      const event = createEvent('test', { value: 5 }, 'node');
      const result = await processEventContinuum(event, handler);

      assert.deepStrictEqual(result.result, { branch: 'else' });
    });

    it('should return undefined when no else branch and predicate is false', async () => {
      const handler = conditional(
        (event) => event.payload.value > 10,
        (event, context) => ({ branch: 'then' })
      );

      const event = createEvent('test', { value: 5 }, 'node');
      const result = await processEventContinuum(event, handler);

      assert.strictEqual(result.result, undefined);
    });
  });

  describe('tap', () => {
    it('should execute side effect without affecting flow', async () => {
      let sideEffectExecuted = false;
      const nextHandler: EventHandler = (event, context) => {
        return { completed: true };
      };

      const handler = tap(
        (event, context) => {
          sideEffectExecuted = true;
          context.tapped = true;
        },
        nextHandler
      );

      const event = createEvent('test', {}, 'node');
      const result = await processEventContinuum(event, handler);

      assert.strictEqual(sideEffectExecuted, true);
      assert.strictEqual(result.context.tapped, true);
      assert.deepStrictEqual(result.result, { completed: true });
    });
  });

  describe('withErrorHandler', () => {
    it('should catch errors and use error handler', async () => {
      const handler = withErrorHandler(
        (event, context) => {
          throw new Error('Processing failed');
        },
        (error, event, context) => {
          return { error: error.message, recovered: true } as any;
        }
      );

      const event = createEvent('test', {}, 'node');
      const result = await processEventContinuum(event, handler);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.result, {
        error: 'Processing failed',
        recovered: true
      });
    });

    it('should not catch errors when handler succeeds', async () => {
      const handler = withErrorHandler(
        (event, context) => {
          return { success: true };
        },
        (error, event, context) => {
          return { error: error.message } as any;
        }
      );

      const event = createEvent('test', {}, 'node');
      const result = await processEventContinuum(event, handler);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.result, { success: true });
    });
  });

  describe('Documentation Examples', () => {
    it('should process order validation flow from docs', async () => {
      const validateOrder: EventHandler = (event, context) => {
        const validation = { valid: event.payload.orderId };
        if (!validation.valid) {
          return { success: false, reason: 'Invalid order' };
        }
        context.validatedOrder = { ...event.payload, validated: true };
        return processPayment;
      };

      const processPayment: EventHandler = (event, context) => {
        const paymentResult = { success: true };
        context.payment = paymentResult;
        if (!paymentResult.success) {
          return { success: false, reason: 'Payment failed' };
        }
        return createShipment;
      };

      const createShipment: EventHandler = (event, context) => {
        const shipment = { trackingNumber: 'TRK-123' };
        return {
          success: true,
          orderId: event.payload.orderId,
          trackingNumber: shipment.trackingNumber
        };
      };

      const event = createEvent(
        'process-order',
        { orderId: 'ORD-123', payment: {} },
        'order-node'
      );

      const result = await processEventContinuum(event, validateOrder);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.result, {
        success: true,
        orderId: 'ORD-123',
        trackingNumber: 'TRK-123'
      });
      assert.ok(result.context.validatedOrder);
      assert.ok(result.context.payment);
    });

    it('should handle validation failure', async () => {
      const validateOrder: EventHandler = (event, context) => {
        if (!event.payload.orderId) {
          return { success: false, reason: 'Invalid order' };
        }
        return processPayment;
      };

      const processPayment: EventHandler = (event, context) => {
        return { success: true };
      };

      const event = createEvent('process-order', {}, 'order-node');
      const result = await processEventContinuum(event, validateOrder);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.result, {
        success: false,
        reason: 'Invalid order'
      });
    });
  });
});
