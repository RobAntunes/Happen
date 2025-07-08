/**
 * Tests for Request-Response pattern with return values
 */

import { HappenNodeImpl } from '../src/node';
import { InMemoryGlobalState } from '../src/global-state';

describe('Request-Response with return values', () => {
  let globalState: InMemoryGlobalState;
  let node1: HappenNodeImpl;
  let node2: HappenNodeImpl;

  beforeEach(async () => {
    globalState = new InMemoryGlobalState();
    node1 = new HappenNodeImpl('node1', { timeout: 1000 }, globalState);
    node2 = new HappenNodeImpl('node2', { timeout: 1000 }, globalState);
    
    await node1.start();
    await node2.start();
  });

  afterEach(async () => {
    await node1.stop();
    await node2.stop();
  });

  it('should return response from handler for request-response', async () => {
    // Set up echo handler that returns a value
    node2.on('echo', (eventOrEvents) => {
      const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
      // Echo back the payload
      return { echoed: event?.payload };
    });

    // Send and wait for response
    const response = await node1.send(node2, {
      type: 'echo',
      payload: { message: 'Hello World' }
    }).return();

    expect(response).toEqual({ echoed: { message: 'Hello World' } });
  });

  it('should not wait for response on regular events', async () => {
    let handlerCalled = false;
    
    // Set up handler that doesn't return anything
    node2.on('regular', () => {
      handlerCalled = true;
      // No return value
    });

    // Send regular event (not using .return())
    node2.emit({ type: 'regular', payload: 'test' });

    // Give time for processing
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(handlerCalled).toBe(true);
  });

  it('should support async handlers with return values', async () => {
    // Set up async handler
    node2.on('async-echo', async (eventOrEvents) => {
      const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
      if (!event) return;
      
      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Return the response
      return { 
        processed: true, 
        original: event.payload,
        timestamp: Date.now()
      };
    });

    // Send and wait for response
    const response = await node1.send(node2, {
      type: 'async-echo',
      payload: 'test data'
    }).return();

    expect(response.processed).toBe(true);
    expect(response.original).toBe('test data');
    expect(response.timestamp).toBeDefined();
  });

  it('should handle multiple handlers where only one returns a value', async () => {
    // First handler doesn't return anything
    node2.on('multi', () => {
      // Do something but don't return
      console.log('Handler 1 processing');
    });

    // Second handler returns a value
    node2.on('multi', (eventOrEvents) => {
      const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
      return { handler: 2, data: event?.payload };
    });

    // Third handler also doesn't return
    node2.on('multi', () => {
      console.log('Handler 3 processing');
    });

    const response = await node1.send(node2, {
      type: 'multi',
      payload: 'test'
    }).return();

    expect(response).toEqual({ handler: 2, data: 'test' });
  });

  it('should timeout if no handler returns a value', async () => {
    // Handler that doesn't return anything
    node2.on('no-response', () => {
      // Process but don't return
    });

    // This should timeout
    await expect(
      node1.send(node2, {
        type: 'no-response',
        payload: 'test'
      }).return()
    ).rejects.toThrow('Response timeout');
  });
});