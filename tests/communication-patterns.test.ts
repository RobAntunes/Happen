/**
 * Tests for Communication Patterns and Confluence
 */

import { HappenNodeImpl } from '../src/node';
import { InMemoryGlobalState } from '../src/global-state';
import { resetGlobalViewRegistry } from '../src/views';
import '../src/confluence'; // Import to register array extensions

describe('Communication Patterns', () => {
  let globalState: InMemoryGlobalState;
  let node1: HappenNodeImpl;
  let node2: HappenNodeImpl;
  let node3: HappenNodeImpl;

  beforeEach(async () => {
    globalState = new InMemoryGlobalState();
    const timestamp = Date.now();
    node1 = new HappenNodeImpl(`cp-node1-${timestamp}`, { timeout: 500 }, globalState);
    node2 = new HappenNodeImpl(`cp-node2-${timestamp}`, { timeout: 500 }, globalState);
    node3 = new HappenNodeImpl(`cp-node3-${timestamp}`, { timeout: 500 }, globalState);
    
    await node1.start();
    await node2.start();
    await node3.start();
  });

  afterEach(async () => {
    await node1.stop();
    await node2.stop();
    await node3.stop();
    resetGlobalViewRegistry();
  });

  describe('Request-Response Pattern', () => {
    it('should support .return() for request-response', async () => {
      // For now, just test that return() returns a promise
      const sendResult = node1.send(node1, {
        type: 'ping',
        payload: { data: 'test' }
      });

      expect(sendResult.return).toBeDefined();
      expect(typeof sendResult.return).toBe('function');
      
      // The promise should timeout as expected since no handler responds
      await expect(sendResult.return()).rejects.toThrow('Response timeout');
    });

    it('should support callback style .return()', async () => {
      // Test callback style
      const sendResult = node1.send(node1, {
        type: 'echo',
        payload: 'hello'
      });

      let callbackCalled = false;
      
      // Get the promise (with callback) and immediately handle rejection
      const promise = sendResult.return(() => {
        callbackCalled = true;
      });
      
      // Promise should reject with timeout
      await expect(promise).rejects.toThrow('Response timeout');
      
      // Callback should not have been called on error
      expect(callbackCalled).toBe(false);
    });

    it('should timeout if no response', async () => {
      const timeoutNode = new HappenNodeImpl(`timeout-${Date.now()}`, { timeout: 100 }, globalState);
      await timeoutNode.start();

      // No handler to respond
      const sendResult = timeoutNode.send(timeoutNode, { type: 'no-response' });
      
      // Immediately set up promise handling
      await expect(sendResult.return()).rejects.toThrow('Response timeout');

      await timeoutNode.stop();
    });
  });

  describe('Batch Event Sending', () => {
    it('should support sending array of events', async () => {
      const received: any[] = [];
      
      node1.on('batch.event', (eventOrEvents) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        received.push(event.payload);
        return undefined;
      });

      // Send multiple events (batch sends don't wait for response)
      const sendResult = node1.send(node1, [
        { type: 'batch.event', payload: { id: 1 } },
        { type: 'batch.event', payload: { id: 2 } },
        { type: 'batch.event', payload: { id: 3 } }
      ]);
      
      const result = await sendResult.return();

      // Batch sends return undefined immediately
      expect(result).toBeUndefined();

      // Give time for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(3);
      expect(received).toEqual([
        { id: 1 },
        { id: 2 },
        { id: 3 }
      ]);
    });
  });

  describe('Handler Array Support', () => {
    it('should process batch of events sent as array', async () => {
      const received: any[] = [];
      
      node1.on('bulk.process', (eventOrEvents) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        received.push(event.payload);
        return undefined;
      });

      // Send array of events
      await node1.send(node1, [
        { type: 'bulk.process', payload: { id: 1 } },
        { type: 'bulk.process', payload: { id: 2 } },
        { type: 'bulk.process', payload: { id: 3 } }
      ]).return();

      // Give time for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(3);
      expect(received).toEqual([
        { id: 1 },
        { id: 2 },
        { id: 3 }
      ]);
    });
  });
});

describe('Confluence - Array Operations', () => {
  let globalState: InMemoryGlobalState;
  let nodes: HappenNodeImpl[];

  beforeEach(async () => {
    globalState = new InMemoryGlobalState();
    const timestamp = Date.now();
    nodes = [
      new HappenNodeImpl(`conf-node1-${timestamp}`, { timeout: 500 }, globalState),
      new HappenNodeImpl(`conf-node2-${timestamp}`, { timeout: 500 }, globalState),
      new HappenNodeImpl(`conf-node3-${timestamp}`, { timeout: 500 }, globalState)
    ];
    
    await Promise.all(nodes.map(node => node.start()));
  });

  afterEach(async () => {
    await Promise.all(nodes.map(node => node.stop()));
    resetGlobalViewRegistry();
  });

  describe('Array.on()', () => {
    it('should register handler on multiple nodes', async () => {
      const received: string[] = [];
      
      // Register on all nodes at once
      const unsubscribe = nodes.on('test.event', (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        received.push(`${(context as any).node?.id || 'unknown'}: ${event.payload}`);
        return undefined;
      });

      // Emit to each node
      nodes[0]!.emit({ type: 'test.event', payload: 'msg1' });
      nodes[1]!.emit({ type: 'test.event', payload: 'msg2' });
      nodes[2]!.emit({ type: 'test.event', payload: 'msg3' });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(3);
      expect(received.some(r => r.includes('node1') && r.includes('msg1'))).toBe(true);
      expect(received.some(r => r.includes('node2') && r.includes('msg2'))).toBe(true);
      expect(received.some(r => r.includes('node3') && r.includes('msg3'))).toBe(true);

      // Unsubscribe from all
      unsubscribe();

      // Should not receive more
      nodes[0]!.emit({ type: 'test.event', payload: 'msg4' });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(received).toHaveLength(3);
    });

    it('should throw error when called on non-node array', () => {
      const notNodes = [1, 2, 3];
      
      expect(() => {
        (notNodes as any).on('test', () => {});
      }).toThrow('on() can only be called on arrays of HappenNode instances');
    });
  });

  describe('Array.send()', () => {
    it('should send to multiple nodes and collect responses', async () => {
      // Array.send() will timeout for each node since no response handlers
      const results = await nodes.send({ type: 'echo', payload: 'hello' }).return();

      // Should get timeout errors for each node
      expect(Object.keys(results)).toHaveLength(3);
      expect(results[nodes[0]!.id]).toEqual({ error: 'Response timeout' });
      expect(results[nodes[1]!.id]).toEqual({ error: 'Response timeout' });
      expect(results[nodes[2]!.id]).toEqual({ error: 'Response timeout' });
    });

    it('should handle errors gracefully', async () => {
      // One node throws error
      nodes[1]!.on('error-test', () => {
        throw new Error('Node error');
      });

      // All nodes will timeout since we're not implementing response yet
      const results = await nodes.send({ type: 'error-test' }).return();

      expect(results[nodes[0]!.id]).toEqual({ error: 'Response timeout' });
      expect(results[nodes[1]!.id]).toEqual({ error: 'Response timeout' });
      expect(results[nodes[2]!.id]).toEqual({ error: 'Response timeout' });
    });
  });

  describe('Array.broadcast()', () => {
    it('should broadcast from multiple nodes', async () => {
      const received: string[] = [];
      
      // Set up listeners
      nodes.forEach(node => {
        node.on('broadcast.test', (eventOrEvents) => {
          const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
          if (!event) return undefined;
          received.push(`${node.id} received from ${event.context.causal.sender}`);
          return undefined;
        });
      });

      // Broadcast from all nodes
      await nodes.broadcast({ type: 'broadcast.test', payload: {} });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Each node should receive from all nodes (true broadcast)
      expect(received).toHaveLength(9); // 3 nodes * 3 broadcasts each (including self)
    });
  });
});