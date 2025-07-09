/**
 * Comprehensive test suite for Unified Event Space
 * Tests cross-boundary communication, persistence, and state synchronization
 */

import { initializeHappen } from '../src';

describe('Unified Event Space', () => {
  let happen: any;
  
  beforeEach(() => {
    happen = initializeHappen();
  });

  describe('Cross-Boundary Communication', () => {
    it('should maintain same API for local and remote communication', async () => {
      const localNode = happen.createNode('local-node');
      const remoteNode = happen.createNode('remote-node');
      
      // Nodes are autonomous - no // cleanup needed

      let receivedEvent: any = null;
      
      // Same event handler API regardless of location
      remoteNode.on('test-event', (event: any) => {
        receivedEvent = event;
      });

      // Nodes are autonomous - no need to start

      // Same send API regardless of location
      localNode.send(remoteNode, {
        type: 'test-event',
        payload: { message: 'Hello from local!' }
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(receivedEvent).toBeTruthy();
      expect(receivedEvent.payload.message).toBe('Hello from local!');
    });

    it('should preserve causality across boundaries', async () => {
      const nodeA = happen.createNode('node-a');
      const nodeB = happen.createNode('node-b');
      const nodeC = happen.createNode('node-c');
      
      // Nodes are autonomous - no // cleanup needed

      let eventChain: any[] = [];
      
      // Chain of events across nodes
      nodeA.on('start-chain', (event: any) => {
        eventChain.push({ node: 'A', event });
        nodeA.send(nodeB, {
          type: 'continue-chain',
          payload: { step: 2 }
        });
      });

      nodeB.on('continue-chain', (event: any) => {
        eventChain.push({ node: 'B', event });
        nodeB.send(nodeC, {
          type: 'end-chain',
          payload: { step: 3 }
        });
      });

      nodeC.on('end-chain', (event: any) => {
        eventChain.push({ node: 'C', event });
      });

      // Start the chain
      nodeA.send(nodeA, {
        type: 'start-chain',
        payload: { step: 1 }
      });

      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(eventChain).toHaveLength(3);
      expect(eventChain[0].node).toBe('A');
      expect(eventChain[1].node).toBe('B');
      expect(eventChain[2].node).toBe('C');
      
      // Verify causality context is preserved
      expect(eventChain[1].event.context.causationId).toBe(eventChain[0].event.context.id);
      expect(eventChain[2].event.context.causationId).toBe(eventChain[1].event.context.id);
    });
  });

  describe('Serialization', () => {
    it('should handle complex data types across boundaries', async () => {
      const senderNode = happen.createNode('sender');
      const receiverNode = happen.createNode('receiver');
      
      // Nodes are autonomous - no cleanup needed

      const complexData = {
        string: 'test',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: {
          deep: {
            value: 'nested'
          }
        },
        date: new Date('2023-01-01'),
        buffer: new Uint8Array([1, 2, 3, 4])
      };

      let receivedData: any = null;
      
      receiverNode.on('complex-data', (event: any) => {
        receivedData = event.payload;
      });

      senderNode.send(receiverNode, {
        type: 'complex-data',
        payload: complexData
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(receivedData).toBeTruthy();
      expect(receivedData.string).toBe('test');
      expect(receivedData.number).toBe(42);
      expect(receivedData.boolean).toBe(true);
      expect(receivedData.array).toEqual([1, 2, 3]);
      expect(receivedData.nested.deep.value).toBe('nested');
      expect(new Date(receivedData.date)).toEqual(new Date('2023-01-01'));
      expect(new Uint8Array(receivedData.buffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
    });
  });

  describe('Global State Synchronization', () => {
    it('should synchronize state across nodes', async () => {
      const nodeA = happen.createNode('node-a');
      const nodeB = happen.createNode('node-b');
      
      // Nodes are autonomous - no cleanup needed

      // Set state on node A
      await nodeA.global.set('shared-value', { counter: 1 });

      // Read from node B
      const value = await nodeB.global.get('shared-value');
      expect(value).toEqual({ counter: 1 });

      // Update from node B
      await nodeB.global.set('shared-value', { counter: 2 });

      // Read from node A
      const updatedValue = await nodeA.global.get('shared-value');
      expect(updatedValue).toEqual({ counter: 2 });
    });

    it('should notify watchers across nodes', async () => {
      const nodeA = happen.createNode('node-a');
      const nodeB = happen.createNode('node-b');
      
      // Nodes are autonomous - no cleanup needed

      let watchedValues: any[] = [];
      
      // Watch on node A
      nodeA.global.watch('watched-key', (value: any) => {
        watchedValues.push(value);
      });
      
      // Cleanup will happen automatically

      await new Promise(resolve => setTimeout(resolve, 100));

      // Update from node B
      await nodeB.global.set('watched-key', 'first-value');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await nodeB.global.set('watched-key', 'second-value');
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(watchedValues).toHaveLength(3); // initial undefined + 2 updates
      expect(watchedValues[0]).toBeUndefined();
      expect(watchedValues[1]).toBe('first-value');
      expect(watchedValues[2]).toBe('second-value');
    });
  });

  describe('Large Payload Handling', () => {
    it('should handle large payloads via global namespace', async () => {
      const senderNode = happen.createNode('sender');
      const receiverNode = happen.createNode('receiver');
      
      // Nodes are autonomous - no cleanup needed

      // Create large data (1MB)
      const largeData = new Array(1024 * 1024).fill(0).map((_, i) => i);
      
      // Store in global namespace
      const dataKey = `large-data-${Date.now()}`;
      await senderNode.global.set(dataKey, largeData);

      let receivedDataKey: string | null = null;
      
      receiverNode.on('large-data', (event: any) => {
        receivedDataKey = event.payload.dataKey;
      });

      // Send reference instead of data
      senderNode.send(receiverNode, {
        type: 'large-data',
        payload: { dataKey }
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(receivedDataKey).toBe(dataKey);
      
      // Retrieve large data
      const retrievedData = await receiverNode.global.get(dataKey);
      expect(retrievedData).toHaveLength(1024 * 1024);
      expect(retrievedData[0]).toBe(0);
      expect(retrievedData[1023]).toBe(1023);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      const node = happen.createNode('test-node');
      
      // Nodes are autonomous - no cleanup needed

      // Should not throw even if transport fails
      expect(() => {
        node.send(node, {
          type: 'test-event',
          payload: { test: true }
        });
      }).not.toThrow();
    });

    it('should handle serialization errors', async () => {
      const nodeA = happen.createNode('node-a');
      const nodeB = happen.createNode('node-b');
      
      // Nodes are autonomous - no cleanup needed

      // Create circular reference (should not crash)
      const circularObj: any = { name: 'test' };
      circularObj.self = circularObj;

      let errorHandled = false;
      
      nodeB.on('error', () => {
        errorHandled = true;
      });

      // This should handle the circular reference gracefully
      expect(() => {
        nodeA.send(nodeB, {
          type: 'test-event',
          payload: circularObj
        });
      }).not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should have handled the error without crashing
      expect(errorHandled).toBe(false); // Should not reach error handler
    });
  });

  describe('Performance', () => {
    it('should maintain sub-millisecond local communication', async () => {
      const nodeA = happen.createNode('node-a');
      const nodeB = happen.createNode('node-b');
      
      // Nodes are autonomous - no cleanup needed

      const startTime = performance.now();
      let endTime: number;
      
      nodeB.on('perf-test', () => {
        endTime = performance.now();
      });

      nodeA.send(nodeB, {
        type: 'perf-test',
        payload: { timestamp: startTime }
      });

      await new Promise(resolve => setTimeout(resolve, 10));
      
      const latency = endTime! - startTime;
      expect(latency).toBeLessThan(1); // Sub-millisecond local communication
    });

    it('should handle high throughput', async () => {
      const nodeA = happen.createNode('node-a');
      const nodeB = happen.createNode('node-b');
      
      // Nodes are autonomous - no cleanup needed

      let receivedCount = 0;
      
      nodeB.on('throughput-test', () => {
        receivedCount++;
      });

      const eventCount = 1000;
      const startTime = performance.now();
      
      // Send 1000 events
      for (let i = 0; i < eventCount; i++) {
        nodeA.send(nodeB, {
          type: 'throughput-test',
          payload: { index: i }
        });
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      const throughput = receivedCount / (duration / 1000); // events per second
      
      expect(receivedCount).toBe(eventCount);
      expect(throughput).toBeGreaterThan(2000); // >2k events/sec
    });
  });
});