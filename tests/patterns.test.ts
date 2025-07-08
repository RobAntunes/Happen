/**
 * Tests for pattern matching engine
 */

import {
  PatternEngine,
  createMatcher,
  prefix,
  suffix,
  regex,
  domain,
  oneOf,
  allOf,
  not,
  patterns,
} from '../src/patterns';
import { createEvent } from '../src/events';

describe('Pattern Matching', () => {
  describe('createMatcher', () => {
    it('should create matcher from string pattern', () => {
      const matcher = createMatcher('exact.match');
      
      expect(matcher('exact.match')).toBe(true);
      expect(matcher('exact.nomatch')).toBe(false);
    });

    it('should pass through function patterns', () => {
      const customMatcher = (type: string) => type.includes('custom');
      const matcher = createMatcher(customMatcher);
      
      expect(matcher).toBe(customMatcher);
    });
  });

  describe('Pattern helpers', () => {
    describe('prefix', () => {
      it('should match string prefixes', () => {
        const matcher = prefix('order.');
        
        expect(matcher('order.created')).toBe(true);
        expect(matcher('order.updated')).toBe(true);
        expect(matcher('payment.created')).toBe(false);
        expect(matcher('order')).toBe(false); // exact match without dot
      });
    });

    describe('suffix', () => {
      it('should match string suffixes', () => {
        const matcher = suffix('.created');
        
        expect(matcher('order.created')).toBe(true);
        expect(matcher('payment.created')).toBe(true);
        expect(matcher('order.updated')).toBe(false);
        expect(matcher('created')).toBe(false); // exact match without dot
      });
    });

    describe('regex', () => {
      it('should match regex patterns', () => {
        const matcher = regex(/^(order|payment)\.(created|updated)$/);
        
        expect(matcher('order.created')).toBe(true);
        expect(matcher('payment.updated')).toBe(true);
        expect(matcher('user.created')).toBe(false);
        expect(matcher('order.deleted')).toBe(false);
      });
    });

    describe('domain', () => {
      it('should match domain patterns', () => {
        const matcher = domain('order');
        
        expect(matcher('order.created')).toBe(true);
        expect(matcher('order.updated')).toBe(true);
        expect(matcher('order.payment.failed')).toBe(true);
        expect(matcher('payment.created')).toBe(false);
        expect(matcher('order')).toBe(false); // no dot
      });
    });

    describe('oneOf', () => {
      it('should match any of the provided patterns', () => {
        const matcher = oneOf('order.created', prefix('payment.'), suffix('.failed'));
        
        expect(matcher('order.created')).toBe(true);
        expect(matcher('payment.succeeded')).toBe(true);
        expect(matcher('process.failed')).toBe(true);
        expect(matcher('user.updated')).toBe(false);
      });

      it('should work with mixed pattern types', () => {
        const matcher = oneOf(
          'exact.match',
          (type: string) => type.includes('custom')
        );
        
        expect(matcher('exact.match')).toBe(true);
        expect(matcher('my.custom.event')).toBe(true);
        expect(matcher('other.event')).toBe(false);
      });
    });

    describe('allOf', () => {
      it('should match only when all patterns match', () => {
        const matcher = allOf(
          prefix('order.'),
          suffix('.created')
        );
        
        expect(matcher('order.created')).toBe(true);
        expect(matcher('order.updated')).toBe(false);
        expect(matcher('payment.created')).toBe(false);
      });

      it('should work with complex conditions', () => {
        const matcher = allOf(
          (type: string) => type.includes('.'),
          (type: string) => type.length > 10,
          prefix('order.')
        );
        
        expect(matcher('order.created')).toBe(true); // 13 chars, has dot, starts with order.
        expect(matcher('order.up')).toBe(false); // only 8 chars, too short
        expect(matcher('short')).toBe(false); // too short AND wrong prefix
        expect(matcher('payment.created')).toBe(false); // wrong prefix
      });
    });

    describe('not', () => {
      it('should negate pattern matches', () => {
        const matcher = not(prefix('system.'));
        
        expect(matcher('order.created')).toBe(true);
        expect(matcher('system.error')).toBe(false);
        expect(matcher('system.health')).toBe(false);
      });

      it('should work with complex patterns', () => {
        const matcher = not(oneOf('system.error', suffix('.failed')));
        
        expect(matcher('order.created')).toBe(true);
        expect(matcher('system.error')).toBe(false);
        expect(matcher('payment.failed')).toBe(false);
      });
    });
  });

  describe('Built-in patterns', () => {
    describe('patterns.system', () => {
      it('should match system events', () => {
        const matcher = patterns.system();
        
        expect(matcher('system.error')).toBe(true);
        expect(matcher('system.health')).toBe(true);
        expect(matcher('order.created')).toBe(false);
      });
    });

    describe('patterns.errors', () => {
      it('should match error events', () => {
        const matcher = patterns.errors();
        
        expect(matcher('system.error')).toBe(true);
        expect(matcher('payment.error')).toBe(true);
        expect(matcher('process.failed')).toBe(true);
        expect(matcher('order.created')).toBe(false);
      });
    });

    describe('patterns.all', () => {
      it('should match all events', () => {
        const matcher = patterns.all();
        
        expect(matcher('anything')).toBe(true);
        expect(matcher('system.error')).toBe(true);
        expect(matcher('order.created')).toBe(true);
        expect(matcher('')).toBe(true);
      });
    });
  });

  describe('PatternEngine', () => {
    let engine: PatternEngine;
    
    beforeEach(() => {
      engine = new PatternEngine();
    });

    describe('add/remove patterns', () => {
      it('should add patterns and return unsubscribe function', () => {
        const handler = jest.fn();
        const unsubscribe = engine.add('test.event', handler);
        
        expect(engine.size).toBe(1);
        expect(typeof unsubscribe).toBe('function');
        
        unsubscribe();
        expect(engine.size).toBe(0);
      });

      it('should handle multiple patterns', () => {
        const handler1 = jest.fn();
        const handler2 = jest.fn();
        
        engine.add('pattern1', handler1);
        engine.add('pattern2', handler2);
        
        expect(engine.size).toBe(2);
      });
    });

    describe('findMatches', () => {
      it('should find matching patterns for events', () => {
        const handler1 = jest.fn();
        const handler2 = jest.fn();
        const handler3 = jest.fn();
        
        engine.add('order.created', handler1);
        engine.add(prefix('order.'), handler2);
        engine.add('payment.created', handler3);
        
        const event = createEvent('order.created', {});
        const matches = engine.findMatches(event);
        
        expect(matches).toHaveLength(2);
        expect(matches.map(m => m.handler)).toContain(handler1);
        expect(matches.map(m => m.handler)).toContain(handler2);
        expect(matches.map(m => m.handler)).not.toContain(handler3);
      });

      it('should respect priority ordering', () => {
        const handler1 = jest.fn();
        const handler2 = jest.fn();
        const handler3 = jest.fn();
        
        engine.add('test.event', handler1, 1);
        engine.add('test.event', handler2, 10);
        engine.add('test.event', handler3, 5);
        
        const event = createEvent('test.event', {});
        const matches = engine.findMatches(event);
        
        expect(matches).toHaveLength(3);
        expect(matches[0]?.handler).toBe(handler2); // priority 10
        expect(matches[1]?.handler).toBe(handler3); // priority 5
        expect(matches[2]?.handler).toBe(handler1); // priority 1
      });

      it('should cache results for performance', () => {
        const handler = jest.fn();
        engine.add('test.event', handler);
        
        const event = createEvent('test.event', {});
        
        // First call
        const matches1 = engine.findMatches(event);
        // Second call should use cache
        const matches2 = engine.findMatches(event);
        
        expect(matches1).toBe(matches2); // Same reference = cached
      });

      it('should clear cache when patterns change', () => {
        const handler1 = jest.fn();
        const handler2 = jest.fn();
        
        engine.add('test.event', handler1);
        
        const event = createEvent('test.event', {});
        const matches1 = engine.findMatches(event);
        
        // Add new pattern - should clear cache
        engine.add('test.event', handler2);
        const matches2 = engine.findMatches(event);
        
        expect(matches1).not.toBe(matches2); // Different reference = cache cleared
        expect(matches2).toHaveLength(2);
      });
    });

    describe('complex pattern scenarios', () => {
      it('should handle overlapping patterns correctly', () => {
        const broadHandler = jest.fn();
        const specificHandler = jest.fn();
        const domainHandler = jest.fn();
        
        engine.add(patterns.all(), broadHandler, 1);
        engine.add('order.created', specificHandler, 10);
        engine.add(domain('order'), domainHandler, 5);
        
        const event = createEvent('order.created', {});
        const matches = engine.findMatches(event);
        
        expect(matches).toHaveLength(3);
        expect(matches[0]?.handler).toBe(specificHandler); // highest priority
        expect(matches[1]?.handler).toBe(domainHandler);
        expect(matches[2]?.handler).toBe(broadHandler); // lowest priority
      });

      it('should handle function patterns with event context', () => {
        const contextHandler = jest.fn();
        
        // Pattern that looks at event context
        const contextPattern = (type: string, event?: any) => {
          return type === 'order.created' && event?.payload?.amount > 100;
        };
        
        engine.add(contextPattern, contextHandler);
        
        const smallOrder = createEvent('order.created', { amount: 50 });
        const largeOrder = createEvent('order.created', { amount: 150 });
        
        expect(engine.findMatches(smallOrder)).toHaveLength(0);
        expect(engine.findMatches(largeOrder)).toHaveLength(1);
      });
    });
  });
});