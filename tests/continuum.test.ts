/**
 * Tests for Event Continuum - Flow Control
 */

import {
  executeHandler,
  processContinuum,
  flow,
} from '../src/continuum';
import { createEvent } from '../src/events';
import { EventHandler } from '../src/types';

describe('Event Continuum', () => {
  describe('executeHandler', () => {
    it('should execute handler and return result', async () => {
      const nextHandler = jest.fn();
      const handler: EventHandler = jest.fn().mockResolvedValue(nextHandler);
      const event = createEvent('test.event', {});
      
      const context = {
        event,
        nodeId: 'test-node',
        startTime: Date.now(),
        path: []
      };

      const result = await executeHandler(handler, event, context);
      
      expect(handler).toHaveBeenCalledWith(event);
      expect(result).toBe(nextHandler);
    });

    it('should handle void returns', async () => {
      const handler: EventHandler = jest.fn().mockResolvedValue(undefined);
      const event = createEvent('test.event', {});
      
      const context = {
        event,
        nodeId: 'test-node',
        startTime: Date.now(),
        path: []
      };

      const result = await executeHandler(handler, event, context);
      
      expect(result).toBeUndefined();
    });

    it('should propagate errors', async () => {
      const error = new Error('Handler error');
      const handler: EventHandler = jest.fn().mockRejectedValue(error);
      const event = createEvent('test.event', {});
      
      const context = {
        event,
        nodeId: 'test-node',
        startTime: Date.now(),
        path: []
      };

      await expect(executeHandler(handler, event, context)).rejects.toThrow('Handler error');
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
      
      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
      expect(handler3).toHaveBeenCalledWith(event);
    });

    it('should stop when handler returns undefined', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      handler1.mockResolvedValue(undefined); // Stop here
      
      const event = createEvent('test.event', {});
      
      await processContinuum(handler1, event, 'test-node');
      
      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should handle synchronous handlers', async () => {
      const handler1: EventHandler = () => handler2;
      const handler2: EventHandler = () => undefined;

      const event = createEvent('test.event', {});
      
      // Should not throw
      await expect(processContinuum(handler1, event, 'test-node')).resolves.toBeUndefined();
    });

    it('should handle errors thrown as handlers', async () => {
      const errorHandler = jest.fn().mockResolvedValue(undefined);
      const handler1: EventHandler = () => {
        throw errorHandler; // Throw handler as error
      };

      const event = createEvent('test.event', {});
      
      await processContinuum(handler1, event, 'test-node');
      
      expect(errorHandler).toHaveBeenCalledWith(event);
    });
  });

  describe('flow helpers', () => {
    describe('when', () => {
      it('should continue when condition is true', async () => {
        const nextHandler = jest.fn();
        const conditionalHandler = flow.when(true, nextHandler);
        const event = createEvent('test.event', {});
        
        const result = await conditionalHandler(event);
        
        expect(result).toBe(nextHandler);
      });

      it('should stop when condition is false', async () => {
        const nextHandler = jest.fn();
        const conditionalHandler = flow.when(false, nextHandler);
        const event = createEvent('test.event', {});
        
        const result = await conditionalHandler(event);
        
        expect(result).toBeUndefined();
      });

      it('should evaluate function conditions', async () => {
        const nextHandler = jest.fn();
        const condition = (event: any) => event.payload.proceed === true;
        const conditionalHandler = flow.when(condition, nextHandler);
        
        const proceedEvent = createEvent('test.event', { proceed: true });
        const stopEvent = createEvent('test.event', { proceed: false });
        
        expect(await conditionalHandler(proceedEvent)).toBe(nextHandler);
        expect(await conditionalHandler(stopEvent)).toBeUndefined();
      });
    });

    describe('branch', () => {
      it('should execute first matching branch', async () => {
        const handler1 = jest.fn();
        const handler2 = jest.fn();
        const handler3 = jest.fn();
        
        const branchHandler = flow.branch([
          [(event: any) => event.payload.type === 'A', handler1],
          [(event: any) => event.payload.type === 'B', handler2],
          [(_event: any) => true, handler3], // Default case
        ]);
        
        const eventA = createEvent('test.event', { type: 'A' });
        const eventB = createEvent('test.event', { type: 'B' });
        const eventC = createEvent('test.event', { type: 'C' });
        
        expect(await branchHandler(eventA)).toBe(handler1);
        expect(await branchHandler(eventB)).toBe(handler2);
        expect(await branchHandler(eventC)).toBe(handler3);
      });

      it('should return undefined if no branches match', async () => {
        const branchHandler = flow.branch([
          [(event: any) => event.payload.type === 'A', jest.fn()],
        ]);
        
        const event = createEvent('test.event', { type: 'B' });
        
        expect(await branchHandler(event)).toBeUndefined();
      });
    });

    describe('parallel', () => {
      it('should execute all handlers in parallel', async () => {
        const handler1 = jest.fn().mockResolvedValue(undefined);
        const handler2 = jest.fn().mockResolvedValue(undefined);
        const handler3 = jest.fn().mockResolvedValue(undefined);
        
        const parallelHandler = flow.parallel(handler1, handler2, handler3);
        const event = createEvent('test.event', {});
        
        await parallelHandler(event);
        
        expect(handler1).toHaveBeenCalledWith(event);
        expect(handler2).toHaveBeenCalledWith(event);
        expect(handler3).toHaveBeenCalledWith(event);
      });

      it('should wait for all handlers to complete', async () => {
        let resolved = 0;
        
        const delayedHandler = (delay: number) => async () => {
          await new Promise(resolve => setTimeout(resolve, delay));
          resolved++;
        };
        
        const parallelHandler = flow.parallel(
          delayedHandler(10),
          delayedHandler(20),
          delayedHandler(5)
        );
        
        const event = createEvent('test.event', {});
        
        await parallelHandler(event);
        expect(resolved).toBe(3);
      });
    });

    describe('sequence', () => {
      it('should execute handlers in sequence until one returns a handler', async () => {
        const handler1 = jest.fn().mockResolvedValue(undefined);
        const handler2 = jest.fn().mockResolvedValue(undefined);
        const nextHandler = jest.fn();
        const handler3 = jest.fn().mockResolvedValue(nextHandler);
        const handler4 = jest.fn(); // Should not be called
        
        const sequenceHandler = flow.sequence(handler1, handler2, handler3, handler4);
        const event = createEvent('test.event', {});
        
        const result = await sequenceHandler(event);
        
        expect(handler1).toHaveBeenCalledWith(event);
        expect(handler2).toHaveBeenCalledWith(event);
        expect(handler3).toHaveBeenCalledWith(event);
        expect(handler4).not.toHaveBeenCalled();
        expect(result).toBe(nextHandler);
      });
    });

    describe('retry', () => {
      it('should retry failed handlers', async () => {
        let attempts = 0;
        const flakyHandler = jest.fn().mockImplementation(async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Flaky error');
          }
          return undefined;
        });
        
        const retryHandler = flow.retry(flakyHandler, { maxAttempts: 3, delay: 1 });
        const event = createEvent('test.event', {});
        
        await retryHandler(event);
        
        expect(flakyHandler).toHaveBeenCalledTimes(3);
        expect(attempts).toBe(3);
      });

      it('should throw after max attempts', async () => {
        const failingHandler = jest.fn().mockRejectedValue(new Error('Always fails'));
        const retryHandler = flow.retry(failingHandler, { maxAttempts: 2, delay: 1 });
        const event = createEvent('test.event', {});
        
        await expect(retryHandler(event)).rejects.toThrow('Always fails');
        expect(failingHandler).toHaveBeenCalledTimes(2);
      });
    });

    describe('timeout', () => {
      it('should timeout long-running handlers', async () => {
        const slowHandler = jest.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return undefined;
        });
        
        const timeoutHandler = flow.timeout(slowHandler, 50);
        const event = createEvent('test.event', {});
        
        await expect(timeoutHandler(event)).rejects.toThrow('Handler timeout after 50ms');
      });

      it('should not timeout fast handlers', async () => {
        const fastHandler = jest.fn().mockResolvedValue(undefined);
        const timeoutHandler = flow.timeout(fastHandler, 100);
        const event = createEvent('test.event', {});
        
        await expect(timeoutHandler(event)).resolves.toBeUndefined();
        expect(fastHandler).toHaveBeenCalled();
      });
    });

    describe('map', () => {
      it('should transform event before passing to handler', async () => {
        const handler = jest.fn().mockResolvedValue(undefined);
        const transform = (event: any) => ({
          ...event,
          payload: { ...event.payload, transformed: true }
        });
        
        const mappingHandler = flow.map(transform, handler);
        const event = createEvent('test.event', { original: true });
        
        await mappingHandler(event);
        
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: { original: true, transformed: true }
          })
        );
      });
    });

    describe('filter', () => {
      it('should execute handler when predicate is true', async () => {
        const handler = jest.fn().mockResolvedValue(undefined);
        const predicate = (event: any) => event.payload.process === true;
        const filterHandler = flow.filter(predicate, handler);
        
        const processEvent = createEvent('test.event', { process: true });
        const skipEvent = createEvent('test.event', { process: false });
        
        expect(await filterHandler(processEvent)).toBeUndefined();
        expect(await filterHandler(skipEvent)).toBeUndefined();
        
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(processEvent);
      });
    });

    describe('catch', () => {
      it('should handle errors with error handler', async () => {
        const errorHandler = jest.fn().mockResolvedValue(undefined);
        const failingHandler = jest.fn().mockRejectedValue(new Error('Test error'));
        const catchHandler = flow.catch(failingHandler, errorHandler);
        
        const event = createEvent('test.event', {});
        
        const result = await catchHandler(event);
        
        expect(failingHandler).toHaveBeenCalledWith(event);
        expect(result).toBe(errorHandler);
      });

      it('should return result if no error occurs', async () => {
        const nextHandler = jest.fn();
        const successHandler = jest.fn().mockResolvedValue(nextHandler);
        const errorHandler = jest.fn();
        const catchHandler = flow.catch(successHandler, errorHandler);
        
        const event = createEvent('test.event', {});
        
        const result = await catchHandler(event);
        
        expect(result).toBe(nextHandler);
        expect(errorHandler).not.toHaveBeenCalled();
      });
    });

    describe('finally', () => {
      it('should execute finally handler after success', async () => {
        const nextHandler = jest.fn();
        const successHandler = jest.fn().mockResolvedValue(nextHandler);
        const finallyHandler = jest.fn().mockResolvedValue(undefined);
        const finallyWrapper = flow.finally(successHandler, finallyHandler);
        
        const event = createEvent('test.event', {});
        
        const result = await finallyWrapper(event);
        
        expect(successHandler).toHaveBeenCalledWith(event);
        expect(finallyHandler).toHaveBeenCalledWith(event);
        expect(result).toBe(nextHandler);
      });

      it('should execute finally handler after error', async () => {
        const failingHandler = jest.fn().mockRejectedValue(new Error('Test error'));
        const finallyHandler = jest.fn().mockResolvedValue(undefined);
        const finallyWrapper = flow.finally(failingHandler, finallyHandler);
        
        const event = createEvent('test.event', {});
        
        await expect(finallyWrapper(event)).rejects.toThrow('Test error');
        
        expect(failingHandler).toHaveBeenCalledWith(event);
        expect(finallyHandler).toHaveBeenCalledWith(event);
      });
    });
  });
});