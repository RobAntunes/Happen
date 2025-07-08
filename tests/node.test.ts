/**
 * Tests for HappenNode implementation
 */

import { HappenNodeImpl } from '../src/node';
import { InMemoryGlobalState } from '../src/global-state';
import { createEvent } from '../src/events';
import { patterns } from '../src/patterns';

describe('HappenNode', () => {
  let globalState: InMemoryGlobalState;
  let node: HappenNodeImpl;

  beforeEach(() => {
    globalState = new InMemoryGlobalState();
    node = new HappenNodeImpl('test-node', {}, globalState);
  });

  afterEach(async () => {
    await node.stop();
  });

  describe('initialization', () => {
    it('should create node with unique ID', () => {
      const node1 = new HappenNodeImpl('test', {}, globalState);
      const node2 = new HappenNodeImpl('test', {}, globalState);
      
      expect(node1.id).toBeDefined();
      expect(node2.id).toBeDefined();
      expect(node1.id).not.toBe(node2.id);
      expect(node1.id).toContain('node-test-');
    });

    it('should initialize with provided state', () => {
      const initialState = { count: 42, name: 'test' };
      const nodeWithState = new HappenNodeImpl('test', { state: initialState }, globalState);
      
      expect(nodeWithState.state.get()).toEqual(initialState);
    });

    it('should use default options when not provided', () => {
      const defaultNode = new HappenNodeImpl('test', {}, globalState);
      
      expect(defaultNode.state.get()).toEqual({});
    });
  });

  describe('event handling', () => {
    it('should register event handlers', () => {
      const handler = jest.fn();
      const unsubscribe = node.on('test.event', handler);
      
      expect(typeof unsubscribe).toBe('function');
    });

    it('should unregister event handlers', () => {
      const handler = jest.fn();
      const unsubscribe = node.on('test.event', handler);
      
      unsubscribe();
      
      // Handler should not be called after unsubscribe
      node.emit({ type: 'test.event', payload: {} });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should call matching handlers when events are emitted', async () => {
      const handler = jest.fn();
      node.on('test.event', handler);
      
      await node.start();
      node.emit({ type: 'test.event', payload: { data: 'test' } });
      
      // Give time for async processing
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'test.event',
          payload: { data: 'test' }
        }),
        expect.any(Object) // Handler context
      );
    });

    it('should support pattern matching', async () => {
      const prefixHandler = jest.fn();
      const exactHandler = jest.fn();
      
      node.on(patterns.prefix('order.'), prefixHandler);
      node.on('order.created', exactHandler);
      
      await node.start();
      node.emit({ type: 'order.created', payload: {} });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(prefixHandler).toHaveBeenCalled();
      expect(exactHandler).toHaveBeenCalled();
    });

    it('should queue events before node is started', async () => {
      const handler = jest.fn();
      node.on('test.event', handler);
      
      // Emit before starting
      node.emit({ type: 'test.event', payload: {} });
      expect(handler).not.toHaveBeenCalled();
      
      // Start node - should process queued events
      await node.start();
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler).toHaveBeenCalled();
    });

    it('should handle multiple events', async () => {
      const handler = jest.fn();
      node.on('test.event', handler);
      
      await node.start();
      
      node.emit({ type: 'test.event', payload: { id: 1 } });
      node.emit({ type: 'test.event', payload: { id: 2 } });
      node.emit({ type: 'test.event', payload: { id: 3 } });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler).toHaveBeenCalledTimes(3);
    });
  });

  describe('acceptance control', () => {
    it('should respect acceptance function', async () => {
      const handler = jest.fn();
      const nodeWithAcceptance = new HappenNodeImpl('test', {
        accept: (origin) => origin.nodeId !== 'blocked-node'
      }, globalState);
      
      nodeWithAcceptance.on('test.event', handler);
      await nodeWithAcceptance.start();
      
      // Create event from blocked node
      const blockedEvent = createEvent('test.event', {}, {}, 'blocked-node');
      
      // Create event from allowed node
      const allowedEvent = createEvent('test.event', {}, {}, 'allowed-node');
      
      // Directly process events to test acceptance control
      await (nodeWithAcceptance as any).processEvent(blockedEvent);
      await (nodeWithAcceptance as any).processEvent(allowedEvent);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'test.event',
          payload: {},
          context: expect.objectContaining({
            causal: expect.objectContaining({
              sender: 'allowed-node' // Original event sender should be preserved
            })
          })
        }),
        expect.any(Object) // Handler context
      );
      
      await nodeWithAcceptance.stop();
    });
  });

  describe('state management', () => {
    it('should provide access to local state', () => {
      const nodeWithState = new HappenNodeImpl('test', {
        state: { count: 0, items: [] }
      }, globalState);
      
      expect(nodeWithState.state.get()).toEqual({ count: 0, items: [] });
      
      nodeWithState.state.set(state => ({ ...state, count: 1 }));
      expect(nodeWithState.state.get(s => s.count)).toBe(1);
    });

    it('should provide access to global state', async () => {
      await node.global.set('test-key', 'test-value');
      const value = await node.global.get('test-key');
      
      expect(value).toBe('test-value');
    });
  });

  describe('event creation', () => {
    it('should add origin context to emitted events', async () => {
      const handler = jest.fn();
      node.on('test.event', handler);
      
      await node.start();
      node.emit({ type: 'test.event', payload: {} });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            causal: expect.objectContaining({
              sender: node.id
            })
          })
        }),
        expect.any(Object) // Handler context
      );
    });

    it('should preserve custom context properties but override nodeId', async () => {
      const handler = jest.fn();
      node.on('test.event', handler);
      
      await node.start();
      node.emit({
        type: 'test.event',
        payload: {},
        context: {
          causal: {
            id: 'test-id',
            sender: 'custom-node',
            correlationId: 'custom-correlation',
            path: ['custom-node']
          },
          user: { id: 'user-123' },
          timestamp: Date.now()
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            causal: expect.objectContaining({
              sender: node.id, // emit() always sets the emitting node as sender
              correlationId: 'custom-correlation'
            }),
            user: expect.objectContaining({
              id: 'user-123' // User context preserved
            })
          })
        }),
        expect.any(Object) // Handler context
      );
    });
  });

  describe('concurrency control', () => {
    it('should respect concurrency limits', async () => {
      let currentProcessing = 0;
      let maxConcurrent = 0;
      
      const slowHandler = jest.fn().mockImplementation(async () => {
        currentProcessing++;
        maxConcurrent = Math.max(maxConcurrent, currentProcessing);
        
        await new Promise(resolve => setTimeout(resolve, 50));
        
        currentProcessing--;
      });
      
      const limitedNode = new HappenNodeImpl('test', {
        concurrency: 2
      }, globalState);
      
      limitedNode.on('slow.event', slowHandler);
      await limitedNode.start();
      
      // Emit 5 events quickly
      for (let i = 0; i < 5; i++) {
        limitedNode.emit({ type: 'slow.event', payload: { id: i } });
      }
      
      // Wait for processing to complete
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(slowHandler).toHaveBeenCalledTimes(5);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
      
      await limitedNode.stop();
    });
  });

  describe('error handling', () => {
    it('should handle handler errors gracefully', async () => {
      const errorHandler = jest.fn().mockRejectedValue(new Error('Handler error'));
      const systemHandler = jest.fn();
      
      node.on('test.event', errorHandler);
      node.on('system.error', systemHandler);
      
      await node.start();
      node.emit({ type: 'test.event', payload: {} });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Should emit system.error event
      expect(systemHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system.error',
          payload: expect.objectContaining({
            error: 'Handler error'
          })
        }),
        expect.any(Object) // Handler context
      );
    });

    it('should not crash node on handler errors', async () => {
      const errorHandler = jest.fn().mockRejectedValue(new Error('Handler error'));
      const workingHandler = jest.fn();
      
      node.on('error.event', errorHandler);
      node.on('working.event', workingHandler);
      
      await node.start();
      
      // Emit error event
      node.emit({ type: 'error.event', payload: {} });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Node should still work
      node.emit({ type: 'working.event', payload: {} });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(workingHandler).toHaveBeenCalled();
    });
  });

  describe('timeout handling', () => {
    it('should timeout long-running handlers', async () => {
      const slowHandler = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });
      
      const timeoutNode = new HappenNodeImpl('test', {
        timeout: 50
      }, globalState);
      
      const systemHandler = jest.fn();
      timeoutNode.on('slow.event', slowHandler);
      timeoutNode.on('system.error', systemHandler);
      
      await timeoutNode.start();
      timeoutNode.emit({ type: 'slow.event', payload: {} });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(systemHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system.error',
          payload: expect.objectContaining({
            error: expect.stringContaining('timeout')
          })
        }),
        expect.any(Object) // Handler context
      );
      
      await timeoutNode.stop();
    });
  });

  describe('node lifecycle', () => {
    it('should stop processing events when stopped', async () => {
      const handler = jest.fn();
      node.on('test.event', handler);
      
      await node.start();
      await node.stop();
      
      node.emit({ type: 'test.event', payload: {} });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should wait for current processing to complete before stopping', async () => {
      let processingStarted = false;
      let processingCompleted = false;
      
      const slowHandler = jest.fn().mockImplementation(async () => {
        processingStarted = true;
        await new Promise(resolve => setTimeout(resolve, 50));
        processingCompleted = true;
      });
      
      node.on('slow.event', slowHandler);
      await node.start();
      
      node.emit({ type: 'slow.event', payload: {} });
      
      // Wait a bit for processing to start
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(processingStarted).toBe(true);
      expect(processingCompleted).toBe(false);
      
      // Stop node - should wait for completion
      await node.stop();
      expect(processingCompleted).toBe(true);
    });
  });
});