/**
 * Tests for event creation and management
 */

import {
  createEvent,
  createCausalEvent,
  matchesPattern,
  createErrorEvent,
  validateEvent,
  cloneEvent,
} from '../src/events';
import { HappenEvent } from '../src/types';

describe('Events', () => {
  describe('createEvent', () => {
    it('should create a valid event with required fields', () => {
      const event = createEvent('test.event', { data: 'test' });
      
      expect(event.id).toBeDefined();
      expect(event.type).toBe('test.event');
      expect(event.payload).toEqual({ data: 'test' });
      expect(event.context.timestamp).toBeGreaterThan(0);
      expect(event.context.causal.sender).toBe('unknown');
    });

    it('should accept custom context', () => {
      const event = createEvent('test.event', { data: 'test' }, {
        causal: { 
          correlationId: 'corr-123'
        }
      }, 'custom-node');
      
      expect(event.context.causal.sender).toBe('custom-node');
      expect(event.context.causal.correlationId).toBe('corr-123');
    });

    it('should generate unique IDs for different events', () => {
      const event1 = createEvent('test.event', {});
      const event2 = createEvent('test.event', {});
      
      expect(event1.id).not.toBe(event2.id);
    });

    it('should handle null and undefined payloads', () => {
      const nullEvent = createEvent('test.null', null);
      const undefinedEvent = createEvent('test.undefined', undefined);
      
      expect(nullEvent.payload).toBe(null);
      expect(undefinedEvent.payload).toBe(undefined);
    });
  });

  describe('createCausalEvent', () => {
    it('should create event with causal relationship', () => {
      const parentEvent = createEvent('parent.event', { id: 1 });
      const childEvent = createCausalEvent(parentEvent, 'child.event', { id: 2 });
      
      expect(childEvent.context.causal.causationId).toBe(parentEvent.id);
      expect(childEvent.id).not.toBe(parentEvent.id);
    });

    it('should preserve correlation ID from parent', () => {
      const parentEvent = createEvent('parent.event', {}, {
        causal: {
          correlationId: 'corr-456'
        }
      });
      const childEvent = createCausalEvent(parentEvent, 'child.event', {});
      
      expect(childEvent.context.causal.correlationId).toBe('corr-456');
    });

    it('should allow overriding correlation ID', () => {
      const parentEvent = createEvent('parent.event', {}, {
        causal: {
          correlationId: 'corr-456'
        }
      });
      const childEvent = createCausalEvent(parentEvent, 'child.event', {}, {
        causal: {
          correlationId: 'new-corr-789'
        }
      });
      
      expect(childEvent.context.causal.correlationId).toBe('new-corr-789');
    });
  });

  describe('matchesPattern', () => {
    const testEvent = createEvent('order.created', { id: 123 });

    it('should match exact string patterns', () => {
      expect(matchesPattern(testEvent, 'order.created')).toBe(true);
      expect(matchesPattern(testEvent, 'order.updated')).toBe(false);
    });

    it('should match function patterns', () => {
      const prefixPattern = (type: string) => type.startsWith('order.');
      const suffixPattern = (type: string) => type.endsWith('.created');
      const falsePattern = (type: string) => type.startsWith('payment.');
      
      expect(matchesPattern(testEvent, prefixPattern)).toBe(true);
      expect(matchesPattern(testEvent, suffixPattern)).toBe(true);
      expect(matchesPattern(testEvent, falsePattern)).toBe(false);
    });

    it('should handle complex function patterns', () => {
      const complexPattern = (type: string) => {
        return type.includes('.') && type.split('.').length === 2;
      };
      
      expect(matchesPattern(testEvent, complexPattern)).toBe(true);
      
      const singleWordEvent = createEvent('test', {});
      expect(matchesPattern(singleWordEvent, complexPattern)).toBe(false);
    });
  });

  describe('createErrorEvent', () => {
    it('should create error event from Error object', () => {
      const error = new Error('Test error message');
      error.stack = 'Error stack trace';
      
      const errorEvent = createErrorEvent(error);
      
      expect(errorEvent.type).toBe('system.error');
      expect(errorEvent.payload.error).toBe('Test error message');
      expect(errorEvent.payload.stack).toBe('Error stack trace');
    });

    it('should include causality from source event', () => {
      const sourceEvent = createEvent('source.event', {});
      const error = new Error('Test error');
      
      const errorEvent = createErrorEvent(error, sourceEvent);
      
      expect(errorEvent.context.causal.causationId).toBe(sourceEvent.id);
    });

    it('should handle errors with custom properties', () => {
      const error = new Error('Custom error') as any;
      error.code = 'E_CUSTOM';
      
      const errorEvent = createErrorEvent(error);
      
      expect(errorEvent.payload.code).toBe('E_CUSTOM');
    });
  });

  describe('validateEvent', () => {
    it('should validate correct event structure', () => {
      const validEvent = createEvent('valid.event', { data: 'test' });
      expect(validateEvent(validEvent)).toBe(true);
    });

    it('should reject invalid events', () => {
      expect(validateEvent(null)).toBe(false);
      expect(validateEvent(undefined)).toBe(false);
      expect(validateEvent({})).toBe(false);
      expect(validateEvent({ id: 'test' })).toBe(false);
      expect(validateEvent({ 
        id: 'test', 
        type: 'test.event' 
      })).toBe(false);
    });

    it('should require all mandatory fields', () => {
      const invalidEvents = [
        { type: 'test', payload: {}, context: {} }, // missing id
        { id: 'test', payload: {}, context: {} }, // missing type
        { id: 'test', type: 'test', context: {} }, // missing payload
        { id: 'test', type: 'test', payload: {} }, // missing context
        { 
          id: 'test', 
          type: 'test', 
          payload: {}, 
          context: { timestamp: Date.now() } 
        }, // missing causal
        { 
          id: 'test', 
          type: 'test', 
          payload: {}, 
          context: { 
            timestamp: Date.now(),
            causal: {} 
          } 
        }, // missing required fields in causal
      ];

      invalidEvents.forEach(event => {
        expect(validateEvent(event)).toBe(false);
      });
    });

    it('should validate context structure', () => {
      const validEvent: HappenEvent = {
        id: 'test-id',
        type: 'test.event',
        payload: {},
        context: {
          timestamp: Date.now(),
          causal: {
            id: 'test-id',
            sender: 'test-node',
            path: ['test-node']
          }
        }
      };

      expect(validateEvent(validEvent)).toBe(true);
    });
  });

  describe('cloneEvent', () => {
    it('should clone event with new ID and timestamp', () => {
      const originalEvent = createEvent('test.event', { data: 'original' });
      const clonedEvent = cloneEvent(originalEvent);
      
      expect(clonedEvent.id).not.toBe(originalEvent.id);
      expect(clonedEvent.type).toBe(originalEvent.type);
      expect(clonedEvent.payload).toEqual(originalEvent.payload);
      expect(clonedEvent.context.timestamp).toBeGreaterThanOrEqual(
        originalEvent.context.timestamp
      );
    });

    it('should allow overriding properties', () => {
      const originalEvent = createEvent('test.event', { data: 'original' });
      const clonedEvent = cloneEvent(originalEvent, {
        type: 'new.event',
        payload: { data: 'new' }
      });
      
      expect(clonedEvent.type).toBe('new.event');
      expect(clonedEvent.payload).toEqual({ data: 'new' });
      expect(clonedEvent.id).not.toBe(originalEvent.id);
    });

    it('should preserve original context when not overridden', () => {
      const originalEvent = createEvent('test.event', {}, {
        causal: {
          correlationId: 'corr-123'
        }
      }, 'test-node');
      const clonedEvent = cloneEvent(originalEvent);
      
      expect(clonedEvent.context.causal.correlationId).toBe('corr-123');
      expect(clonedEvent.context.causal.sender).toBe('test-node');
    });
  });
});