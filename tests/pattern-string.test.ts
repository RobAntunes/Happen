/**
 * Tests for string pattern matching enhancements
 */

import { createMatcher } from '../src/patterns';

describe('String Pattern Support', () => {
  describe('Wildcard patterns', () => {
    it('should match wildcard patterns', () => {
      const matcher = createMatcher('order.*');
      
      expect(matcher('order.created')).toBe(true);
      expect(matcher('order.updated')).toBe(true);
      expect(matcher('order.cancelled')).toBe(true);
      expect(matcher('order')).toBe(false);
      expect(matcher('payment.created')).toBe(false);
    });

    it('should match multi-segment wildcards', () => {
      const matcher = createMatcher('user.profile.*');
      
      expect(matcher('user.profile.updated')).toBe(true);
      expect(matcher('user.profile.deleted')).toBe(true);
      expect(matcher('user.profile')).toBe(false);
      expect(matcher('user.settings.updated')).toBe(false);
    });

    it('should match wildcards at different positions', () => {
      const matcher = createMatcher('*.error');
      
      expect(matcher('order.error')).toBe(true);
      expect(matcher('payment.error')).toBe(true);
      expect(matcher('system.error')).toBe(true);
      expect(matcher('error')).toBe(false);
    });
  });

  describe('Alternative patterns', () => {
    it('should match alternative patterns', () => {
      const matcher = createMatcher('{order,payment}.created');
      
      expect(matcher('order.created')).toBe(true);
      expect(matcher('payment.created')).toBe(true);
      expect(matcher('shipping.created')).toBe(false);
      expect(matcher('order.updated')).toBe(false);
    });

    it('should handle multiple alternatives', () => {
      const matcher = createMatcher('{user,admin,guest}.login');
      
      expect(matcher('user.login')).toBe(true);
      expect(matcher('admin.login')).toBe(true);
      expect(matcher('guest.login')).toBe(true);
      expect(matcher('bot.login')).toBe(false);
    });
  });

  describe('Exact matching', () => {
    it('should still support exact matching', () => {
      const matcher = createMatcher('order.submitted');
      
      expect(matcher('order.submitted')).toBe(true);
      expect(matcher('order.created')).toBe(false);
      expect(matcher('payment.submitted')).toBe(false);
    });
  });

  describe('Function patterns with event context', () => {
    it('should pass event to pattern function', () => {
      const mockEvent = {
        id: 'evt-123',
        type: 'order.created',
        payload: { orderId: 'ord-456' },
        context: {
          causal: {
            id: 'evt-123',
            sender: 'test-node',
            path: ['test-node']
          },
          timestamp: Date.now()
        }
      };

      const matcher = createMatcher((type, event) => {
        return type === 'order.created' && (event?.payload as any)?.orderId === 'ord-456';
      });

      expect(matcher('order.created', mockEvent)).toBe(true);
      expect(matcher('order.created')).toBe(false); // No event
      expect(matcher('order.created', { ...mockEvent, payload: { orderId: 'different' } })).toBe(false);
    });
  });
});