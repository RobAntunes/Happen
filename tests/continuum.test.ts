/**
 * Tests for Event Continuum - Backward compatibility
 */

import {
  executeHandler,
  processContinuum,
  flow,
} from '../src/continuum';
import { createEvent } from '../src/events';
import { EventHandler } from '../src/types';

describe('Event Continuum - Old Tests', () => {
  describe('executeHandler', () => {
    it('should execute handler and return result', async () => {
      const nextHandler = jest.fn();
      const handler: EventHandler = jest.fn().mockResolvedValue(nextHandler);
      const event = createEvent('test.event', {});
      
      const handlerContext = {};
      const result = await executeHandler(handler, event, handlerContext);
      
      expect(handler).toHaveBeenCalledWith(event, handlerContext);
      expect(result).toBe(nextHandler);
    });

    it('should handle void returns', async () => {
      const handler: EventHandler = jest.fn().mockResolvedValue(undefined);
      const event = createEvent('test.event', {});
      
      const handlerContext = {};
      const result = await executeHandler(handler, event, handlerContext);
      
      expect(result).toBeUndefined();
    });

    it('should propagate errors', async () => {
      const error = new Error('Handler error');
      const handler: EventHandler = jest.fn().mockRejectedValue(error);
      const event = createEvent('test.event', {});
      
      const handlerContext = {};
      await expect(executeHandler(handler, event, handlerContext)).rejects.toThrow('Handler error');
    });
  });

  describe('processContinuum', () => {
    it('should process chain of handlers', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      // Chain: handler1 -> handler2 -> handler3 -> end
      handler1.mockResolvedValue(handler2);
      handler2.mockResolvedValue(handler3);
      handler3.mockResolvedValue(undefined);

      const event = createEvent('test.event', {});
      
      await processContinuum(handler1, event, 'test-node');
      
      expect(handler1).toHaveBeenCalledWith(event, expect.any(Object));
      expect(handler2).toHaveBeenCalledWith(event, expect.any(Object));
      expect(handler3).toHaveBeenCalledWith(event, expect.any(Object));
    });

    it('should return non-function values', async () => {
      const handler: EventHandler = jest.fn().mockResolvedValue({ result: 'data' });
      const event = createEvent('test.event', {});
      
      const result = await processContinuum(handler, event, 'test-node');
      
      expect(result).toEqual({ result: 'data' });
    });
  });

  describe('flow helpers', () => {
    describe('when', () => {
      it('should conditionally execute handler', async () => {
        const nextHandler = jest.fn();
        const conditionalHandler = flow.when(true, nextHandler);
        
        const event = createEvent('test.event', {});
        const context = {};
        const result = await conditionalHandler(event, context);
        
        expect(result).toBe(nextHandler);
      });

      it('should skip handler when condition is false', async () => {
        const nextHandler = jest.fn();
        const conditionalHandler = flow.when(false, nextHandler);
        
        const event = createEvent('test.event', {});
        const context = {};
        const result = await conditionalHandler(event, context);
        
        expect(result).toBeUndefined();
      });
    });

    describe('branch', () => {
      it('should branch based on conditions', async () => {
        const handler1 = jest.fn();
        const handler2 = jest.fn();
        
        const branchHandler = flow.branch([
          [(eventOrEvents, context) => {
            const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
            return event && (event.payload as any).type === 'A';
          }, handler1],
          [(eventOrEvents, context) => {
            const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
            return event && (event.payload as any).type === 'B';
          }, handler2],
        ]);

        const eventA = createEvent('test', { type: 'A' });
        const context = {};
        
        const result = await branchHandler(eventA, context);
        expect(result).toBe(handler1);
      });
    });

    describe('parallel', () => {
      it('should execute handlers in parallel', async () => {
        const handler1 = jest.fn().mockResolvedValue(undefined);
        const handler2 = jest.fn().mockResolvedValue(undefined);
        
        const parallelHandler = flow.parallel(handler1, handler2);
        const event = createEvent('test.event', {});
        const context = {};
        
        await parallelHandler(event, context);
        
        expect(handler1).toHaveBeenCalledWith(event, context);
        expect(handler2).toHaveBeenCalledWith(event, context);
      });
    });

    describe('catch', () => {
      it('should catch errors and route to error handler', async () => {
        const errorHandler = jest.fn();
        const failingHandler: EventHandler = jest.fn().mockRejectedValue(new Error('Boom!'));
        
        const safeHandler = flow.catch(failingHandler, errorHandler);
        const event = createEvent('test.event', {});
        const context = {};
        
        const result = await safeHandler(event, context);
        
        expect(result).toBe(errorHandler);
        expect((context as any).error).toBeDefined();
      });
    });
  });
});