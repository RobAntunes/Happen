/**
 * Tests for causality tracking system
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateEventId,
  generateCorrelationId,
  createCausalContext,
  createEventContext,
  createEvent,
  createDerivedEvent,
  buildEventFromOptions,
  validateCausalContext,
  getCausalInfo
} from '../src/causality.js';

describe('Causality Tracking', () => {
  describe('generateEventId', () => {
    it('should generate unique event IDs', () => {
      const id1 = generateEventId();
      const id2 = generateEventId();

      assert.ok(id1.startsWith('evt-'));
      assert.ok(id2.startsWith('evt-'));
      assert.notStrictEqual(id1, id2);
    });
  });

  describe('generateCorrelationId', () => {
    it('should generate unique correlation IDs', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();

      assert.ok(id1.startsWith('txn-'));
      assert.ok(id2.startsWith('txn-'));
      assert.notStrictEqual(id1, id2);
    });
  });

  describe('createCausalContext', () => {
    it('should create basic causal context', () => {
      const context = createCausalContext('test-node');

      assert.ok(context.id.startsWith('evt-'));
      assert.strictEqual(context.sender, 'test-node');
      assert.ok(context.correlationId);
      assert.ok(Array.isArray(context.path));
      assert.ok(context.path.includes('test-node'));
      assert.ok(typeof context.timestamp === 'number');
    });

    it('should include causation ID when provided', () => {
      const context = createCausalContext('test-node', 'evt-parent-123');

      assert.strictEqual(context.causationId, 'evt-parent-123');
    });

    it('should use provided correlation ID', () => {
      const correlationId = 'txn-custom-123';
      const context = createCausalContext('test-node', undefined, correlationId);

      assert.strictEqual(context.correlationId, correlationId);
    });

    it('should extend the path correctly', () => {
      const previousPath = ['node-1', 'node-2'];
      const context = createCausalContext('node-3', undefined, undefined, previousPath);

      assert.deepStrictEqual(context.path, ['node-1', 'node-2', 'node-3']);
    });
  });

  describe('createEventContext', () => {
    it('should create event context with causal info', () => {
      const context = createEventContext('test-node');

      assert.ok(context.causal);
      assert.strictEqual(context.causal.sender, 'test-node');
    });

    it('should include additional context', () => {
      const context = createEventContext('test-node', {
        additionalContext: {
          userId: '123',
          requestId: 'req-456'
        }
      });

      assert.strictEqual(context.userId, '123');
      assert.strictEqual(context.requestId, 'req-456');
      assert.ok(context.causal);
    });
  });

  describe('createEvent', () => {
    it('should create a complete event', () => {
      const event = createEvent(
        'order.created',
        { orderId: 'ORD-123', total: 99.99 },
        'order-service'
      );

      assert.strictEqual(event.type, 'order.created');
      assert.deepStrictEqual(event.payload, { orderId: 'ORD-123', total: 99.99 });
      assert.strictEqual(event.context.causal.sender, 'order-service');
      assert.ok(event.context.causal.id);
      assert.ok(event.context.causal.correlationId);
    });

    it('should use provided causation and correlation IDs', () => {
      const event = createEvent(
        'order.submitted',
        { orderId: 'ORD-123' },
        'order-service',
        {
          causationId: 'evt-parent',
          correlationId: 'txn-123'
        }
      );

      assert.strictEqual(event.context.causal.causationId, 'evt-parent');
      assert.strictEqual(event.context.causal.correlationId, 'txn-123');
    });
  });

  describe('createDerivedEvent', () => {
    it('should create event that maintains causal chain', () => {
      const parentEvent = createEvent(
        'order.created',
        { orderId: 'ORD-123' },
        'order-service'
      );

      const childEvent = createDerivedEvent(
        'payment.requested',
        { orderId: 'ORD-123', amount: 99.99 },
        'payment-service',
        parentEvent
      );

      // Child should reference parent as causation
      assert.strictEqual(childEvent.context.causal.causationId, parentEvent.context.causal.id);

      // Should maintain same correlation ID
      assert.strictEqual(
        childEvent.context.causal.correlationId,
        parentEvent.context.causal.correlationId
      );

      // Path should include both nodes
      assert.ok(childEvent.context.causal.path.includes('order-service'));
      assert.ok(childEvent.context.causal.path.includes('payment-service'));

      // Parent should come before child in path
      const orderIndex = childEvent.context.causal.path.indexOf('order-service');
      const paymentIndex = childEvent.context.causal.path.indexOf('payment-service');
      assert.ok(orderIndex < paymentIndex);
    });

    it('should handle deep causal chains', () => {
      const event1 = createEvent('step1', {}, 'node-1');
      const event2 = createDerivedEvent('step2', {}, 'node-2', event1);
      const event3 = createDerivedEvent('step3', {}, 'node-3', event2);

      // All should have same correlation ID
      assert.strictEqual(
        event3.context.causal.correlationId,
        event1.context.causal.correlationId
      );

      // Path should show the complete journey
      assert.deepStrictEqual(
        event3.context.causal.path,
        ['node-1', 'node-2', 'node-3']
      );

      // Each should reference its parent
      assert.strictEqual(event2.context.causal.causationId, event1.context.causal.id);
      assert.strictEqual(event3.context.causal.causationId, event2.context.causal.id);
    });
  });

  describe('buildEventFromOptions', () => {
    it('should build event from broadcast options', () => {
      const options = {
        type: 'order.created',
        payload: { orderId: 'ORD-123' }
      };

      const event = buildEventFromOptions(options, 'order-service');

      assert.strictEqual(event.type, 'order.created');
      assert.deepStrictEqual(event.payload, { orderId: 'ORD-123' });
      assert.strictEqual(event.context.causal.sender, 'order-service');
    });

    it('should use provided causation and correlation IDs', () => {
      const options = {
        type: 'order.submitted',
        payload: {},
        causationId: 'evt-parent',
        correlationId: 'txn-123'
      };

      const event = buildEventFromOptions(options, 'order-service');

      assert.strictEqual(event.context.causal.causationId, 'evt-parent');
      assert.strictEqual(event.context.causal.correlationId, 'txn-123');
    });
  });

  describe('validateCausalContext', () => {
    it('should validate proper causal context', () => {
      const event = createEvent('test.event', {}, 'test-node');
      assert.strictEqual(validateCausalContext(event), true);
    });

    it('should reject event without ID', () => {
      const event = createEvent('test.event', {}, 'test-node');
      event.context.causal.id = '';
      assert.strictEqual(validateCausalContext(event), false);
    });

    it('should reject event without sender', () => {
      const event = createEvent('test.event', {}, 'test-node');
      event.context.causal.sender = '';
      assert.strictEqual(validateCausalContext(event), false);
    });

    it('should reject event without correlation ID', () => {
      const event = createEvent('test.event', {}, 'test-node');
      event.context.causal.correlationId = undefined;
      assert.strictEqual(validateCausalContext(event), false);
    });

    it('should reject event with invalid path', () => {
      const event = createEvent('test.event', {}, 'test-node');
      (event.context.causal as any).path = 'not-an-array';
      assert.strictEqual(validateCausalContext(event), false);
    });

    it('should reject event where sender not in path', () => {
      const event = createEvent('test.event', {}, 'test-node');
      event.context.causal.path = ['other-node'];
      assert.strictEqual(validateCausalContext(event), false);
    });

    it('should reject event without timestamp', () => {
      const event = createEvent('test.event', {}, 'test-node');
      (event.context.causal as any).timestamp = null;
      assert.strictEqual(validateCausalContext(event), false);
    });
  });

  describe('getCausalInfo', () => {
    it('should extract causal information', () => {
      const event = createEvent('test.event', {}, 'test-node');
      const info = getCausalInfo(event);

      assert.strictEqual(info.sender, 'test-node');
      assert.ok(info.id);
      assert.ok(info.transaction);
      assert.ok(info.path);
      assert.ok(typeof info.age === 'number');
      assert.ok(info.age >= 0);
    });

    it('should include causation information', () => {
      const parentEvent = createEvent('parent.event', {}, 'parent-node');
      const childEvent = createDerivedEvent('child.event', {}, 'child-node', parentEvent);
      const info = getCausalInfo(childEvent);

      assert.strictEqual(info.causedBy, parentEvent.context.causal.id);
      assert.ok(info.path.includes('parent-node'));
      assert.ok(info.path.includes('child-node'));
      assert.ok(info.path.includes('→'));
    });
  });

  describe('Documentation Examples', () => {
    it('should track causality as shown in docs', () => {
      // Create initial event
      const orderCreated = createEvent(
        'order.created',
        { orderId: 'ORD-123', items: [], total: 59.98 },
        'checkout-node'
      );

      // All required causal metadata present
      assert.ok(orderCreated.context.causal.id);
      assert.strictEqual(orderCreated.context.causal.sender, 'checkout-node');
      assert.ok(orderCreated.context.causal.correlationId);
      assert.deepStrictEqual(orderCreated.context.causal.path, ['checkout-node']);
    });

    it('should maintain causal chain across events', () => {
      const userAction = createEvent('cart.checkout-initiated', {}, 'user-node');
      const orderCreated = createDerivedEvent('order.created', {}, 'checkout-node', userAction);
      const paymentRequested = createDerivedEvent('payment.requested', {}, 'payment-node', orderCreated);

      // All events share same correlation ID
      const txnId = userAction.context.causal.correlationId;
      assert.strictEqual(orderCreated.context.causal.correlationId, txnId);
      assert.strictEqual(paymentRequested.context.causal.correlationId, txnId);

      // Causal chain maintained
      assert.strictEqual(orderCreated.context.causal.causationId, userAction.context.causal.id);
      assert.strictEqual(paymentRequested.context.causal.causationId, orderCreated.context.causal.id);

      // Path shows complete journey
      assert.deepStrictEqual(
        paymentRequested.context.causal.path,
        ['user-node', 'checkout-node', 'payment-node']
      );
    });
  });
});
