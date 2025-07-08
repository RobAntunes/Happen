/**
 * Tests for Request-Response pattern with respond() function
 */

import { HappenNodeImpl } from '../src/node';
import { InMemoryGlobalState } from '../src/global-state';

describe('Request-Response with respond()', () => {
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

  it('should provide respond() function in context for request-response', async () => {
    // Set up echo handler that uses respond()
    node2.on('echo', (eventOrEvents, context) => {
      const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
      if (context.respond && event) {
        // Echo back the payload
        context.respond({ echoed: event.payload });
      }
    });

    // Send and wait for response
    const response = await node1.send(node2, {
      type: 'echo',
      payload: { message: 'Hello World' }
    }).return();

    expect(response).toEqual({ echoed: { message: 'Hello World' } });
  });

  it('should not provide respond() for regular events', async () => {
    let contextInHandler: any = null;
    
    // Set up handler that captures context
    node2.on('regular', (_event, context) => {
      contextInHandler = context;
    });

    // Send regular event (not using .return())
    node2.emit({ type: 'regular', payload: 'test' });

    // Give time for processing
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(contextInHandler).toBeDefined();
    expect(contextInHandler.respond).toBeUndefined();
  });

  it('should support async handlers with respond()', async () => {
    // Set up async handler
    node2.on('async-echo', async (eventOrEvents, context) => {
      const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
      if (!event) return;
      
      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (context.respond) {
        context.respond({ 
          processed: true, 
          original: event.payload,
          timestamp: Date.now()
        });
      }
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

  it('should handle multiple handlers where only one responds', async () => {
    // First handler doesn't respond
    node2.on('multi', (_event, _context) => {
      // Do something but don't respond
      console.log('Handler 1 processing');
    });

    // Second handler responds
    node2.on('multi', (eventOrEvents, context) => {
      const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
      if (context.respond && event) {
        context.respond({ handler: 2, data: event.payload });
      }
    });

    // Third handler also doesn't respond
    node2.on('multi', (_event, _context) => {
      console.log('Handler 3 processing');
    });

    const response = await node1.send(node2, {
      type: 'multi',
      payload: 'test'
    }).return();

    expect(response).toEqual({ handler: 2, data: 'test' });
  });

  it('should timeout if no handler responds', async () => {
    // Handler that doesn't respond
    node2.on('no-response', (_event, _context) => {
      // Process but don't respond
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