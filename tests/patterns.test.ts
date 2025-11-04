/**
 * Tests for pattern matching functionality
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  compilePattern,
  normalizePattern,
  domain,
  exact,
  wildcard,
  oneOf,
  not,
  allOf
} from '../src/patterns.js';

describe('Pattern Matching', () => {
  describe('compilePattern', () => {
    it('should match exact event types', () => {
      const matcher = compilePattern('order.submitted');
      assert.strictEqual(matcher('order.submitted'), true);
      assert.strictEqual(matcher('order.created'), false);
      assert.strictEqual(matcher('payment.submitted'), false);
    });

    it('should match wildcard patterns', () => {
      const matcher = compilePattern('order.*');
      assert.strictEqual(matcher('order.submitted'), true);
      assert.strictEqual(matcher('order.created'), true);
      assert.strictEqual(matcher('order.updated'), true);
      assert.strictEqual(matcher('payment.created'), false);
      // Should not match nested segments
      assert.strictEqual(matcher('order.item.created'), false);
    });

    it('should match multi-segment wildcards', () => {
      const matcher = compilePattern('user.profile.*');
      assert.strictEqual(matcher('user.profile.updated'), true);
      assert.strictEqual(matcher('user.profile.created'), true);
      assert.strictEqual(matcher('user.created'), false);
      assert.strictEqual(matcher('user.profile.photo.updated'), false);
    });

    it('should match alternative patterns', () => {
      const matcher = compilePattern('{order,payment}.created');
      assert.strictEqual(matcher('order.created'), true);
      assert.strictEqual(matcher('payment.created'), true);
      assert.strictEqual(matcher('user.created'), false);
      assert.strictEqual(matcher('order.submitted'), false);
    });

    it('should match complex alternative patterns', () => {
      const matcher = compilePattern('user.{created,updated,deleted}');
      assert.strictEqual(matcher('user.created'), true);
      assert.strictEqual(matcher('user.updated'), true);
      assert.strictEqual(matcher('user.deleted'), true);
      assert.strictEqual(matcher('user.fetched'), false);
    });
  });

  describe('normalizePattern', () => {
    it('should convert string patterns to matchers', () => {
      const matcher = normalizePattern('order.submitted');
      assert.strictEqual(typeof matcher, 'function');
      assert.strictEqual(matcher('order.submitted'), true);
    });

    it('should pass through function matchers unchanged', () => {
      const customMatcher = (type: string) => type.startsWith('custom.');
      const normalized = normalizePattern(customMatcher);
      assert.strictEqual(normalized, customMatcher);
      assert.strictEqual(normalized('custom.event'), true);
    });
  });

  describe('domain helper', () => {
    it('should match all events in a domain', () => {
      const matcher = domain('order');
      assert.strictEqual(matcher('order.created'), true);
      assert.strictEqual(matcher('order.submitted'), true);
      assert.strictEqual(matcher('order.item.added'), true);
      assert.strictEqual(matcher('payment.created'), false);
    });
  });

  describe('exact helper', () => {
    it('should match exact event types only', () => {
      const matcher = exact('order.submitted');
      assert.strictEqual(matcher('order.submitted'), true);
      assert.strictEqual(matcher('order.created'), false);
      assert.strictEqual(matcher('payment.submitted'), false);
    });
  });

  describe('wildcard helper', () => {
    it('should match wildcard patterns', () => {
      const matcher = wildcard('user.*.completed');
      assert.strictEqual(matcher('user.registration.completed'), true);
      assert.strictEqual(matcher('user.verification.completed'), true);
      assert.strictEqual(matcher('user.registration.started'), false);
    });
  });

  describe('oneOf helper', () => {
    it('should match any of multiple string patterns', () => {
      const matcher = oneOf('order.created', 'order.submitted', 'payment.succeeded');
      assert.strictEqual(matcher('order.created'), true);
      assert.strictEqual(matcher('order.submitted'), true);
      assert.strictEqual(matcher('payment.succeeded'), true);
      assert.strictEqual(matcher('order.cancelled'), false);
    });

    it('should match any of multiple function matchers', () => {
      const matcher = oneOf(
        exact('order.submitted'),
        domain('payment'),
        wildcard('user.*.completed')
      );
      assert.strictEqual(matcher('order.submitted'), true);
      assert.strictEqual(matcher('payment.succeeded'), true);
      assert.strictEqual(matcher('payment.failed'), true);
      assert.strictEqual(matcher('user.registration.completed'), true);
      assert.strictEqual(matcher('order.created'), false);
    });

    it('should handle mixed string and function patterns', () => {
      const matcher = oneOf(
        'order.submitted',
        domain('payment'),
        'shipping.*'  // Use string pattern instead of wildcard()
      );
      assert.strictEqual(matcher('order.submitted'), true);
      assert.strictEqual(matcher('payment.processed'), true);
      assert.strictEqual(matcher('shipping.label'), true);
      assert.strictEqual(matcher('user.created'), false);
    });
  });

  describe('not helper', () => {
    it('should negate string patterns', () => {
      const matcher = not('user.password-changed');
      assert.strictEqual(matcher('user.created'), true);
      assert.strictEqual(matcher('user.updated'), true);
      assert.strictEqual(matcher('user.password-changed'), false);
    });

    it('should negate function matchers', () => {
      const matcher = not(domain('internal'));
      assert.strictEqual(matcher('user.created'), true);
      assert.strictEqual(matcher('order.submitted'), true);
      assert.strictEqual(matcher('internal.debug'), false);
      assert.strictEqual(matcher('internal.metrics.updated'), false);
    });
  });

  describe('allOf helper', () => {
    it('should match when all patterns match', () => {
      const matcher = allOf(
        domain('user'),
        (type) => type.includes('profile')
      );
      assert.strictEqual(matcher('user.profile.updated'), true);
      assert.strictEqual(matcher('user.profile.created'), true);
      assert.strictEqual(matcher('user.created'), false);
      assert.strictEqual(matcher('order.profile.updated'), false);
    });
  });

  describe('Documentation Examples', () => {
    it('should handle the order domain example', () => {
      const matcher = domain('order');
      assert.strictEqual(matcher('order.created'), true);
      assert.strictEqual(matcher('order.submitted'), true);
      assert.strictEqual(matcher('order.cancelled'), true);
    });

    it('should handle the payment result example', () => {
      const matcher = oneOf('payment.succeeded', 'payment.failed');
      assert.strictEqual(matcher('payment.succeeded'), true);
      assert.strictEqual(matcher('payment.failed'), true);
      assert.strictEqual(matcher('payment.pending'), false);
    });

    it('should handle the user lifecycle regex example', () => {
      const matcher = (type: string) => /^user\.(created|updated|deleted)$/.test(type);
      assert.strictEqual(matcher('user.created'), true);
      assert.strictEqual(matcher('user.updated'), true);
      assert.strictEqual(matcher('user.deleted'), true);
      assert.strictEqual(matcher('user.fetched'), false);
    });

    it('should handle the inventory level example', () => {
      const matcher = (type: string) => {
        const [domainPart, action] = type.split('.');
        return domainPart === 'inventory' && action?.includes('level');
      };
      assert.strictEqual(matcher('inventory.level-low'), true);
      assert.strictEqual(matcher('inventory.level-critical'), true);
      assert.strictEqual(matcher('inventory.updated'), false);
    });

    it('should handle combined domain with exclusion', () => {
      const matcher = (type: string) =>
        domain('user')(type) && not(exact('user.password-changed'))(type);

      assert.strictEqual(matcher('user.created'), true);
      assert.strictEqual(matcher('user.updated'), true);
      assert.strictEqual(matcher('user.password-changed'), false);
    });
  });
});
