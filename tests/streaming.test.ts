/**
 * Generator-based Streaming Tests
 * Tests async generator functionality in event handlers
 */

import { initializeHappen } from '../src';

describe('Generator-based Streaming', () => {
  let happen: any;
  let cleanup: (() => Promise<void>)[] = [];
  
  beforeEach(() => {
    happen = initializeHappen();
  });
  
  afterEach(async () => {
    await Promise.all(cleanup.map(fn => fn()));
    cleanup = [];
  });

  describe('Basic Generator Support', () => {
    it('should handle async generator event handlers', async () => {
      const sourceNode = happen.createNode('source');
      const targetNode = happen.createNode('target');
      
      cleanup.push(() => Promise.resolve(), () => Promise.resolve());
      
      const results: any[] = [];
      
      // Register an async generator handler
      targetNode.on('stream-data', async function* streamHandler(event: any) {
        const { count } = event.payload;
        
        for (let i = 0; i < count; i++) {
          yield { chunk: i, data: `chunk-${i}` };
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        yield { status: 'complete', totalChunks: count };
      });
      
      // Send event and get streaming response
      const stream = await sourceNode.send(targetNode, {
        type: 'stream-data',
        payload: { count: 5 }
      }).return();
      
      // Verify it's an async generator
      expect(typeof stream[Symbol.asyncIterator]).toBe('function');
      
      // Collect all results
      for await (const chunk of stream) {
        results.push(chunk);
      }
      
      // Should have 5 chunks + 1 final result
      expect(results).toHaveLength(6);
      expect(results[0]).toEqual({ chunk: 0, data: 'chunk-0' });
      expect(results[4]).toEqual({ chunk: 4, data: 'chunk-4' });
      expect(results[5]).toEqual({ status: 'complete', totalChunks: 5 });
    });

    it('should handle generator with callback style', async () => {
      const sourceNode = happen.createNode('source');
      const targetNode = happen.createNode('target');
      
      cleanup.push(() => Promise.resolve(), () => Promise.resolve());
      
      const results: any[] = [];
      
      // Register generator handler
      targetNode.on('callback-stream', async function* callbackHandler(_event: any) {
        for (let i = 0; i < 3; i++) {
          yield { value: i * 10 };
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        yield { done: true };
      });
      
      // Test callback style
      const promise = new Promise<void>((resolve, reject) => {
        sourceNode.send(targetNode, {
          type: 'callback-stream',
          payload: {}
        }).return((stream: any) => {
          if (typeof stream[Symbol.asyncIterator] === 'function') {
            (async () => {
              for await (const chunk of stream) {
                results.push(chunk);
              }
              resolve();
            })().catch(reject);
          } else {
            reject(new Error('Expected async generator'));
          }
        });
      });
      
      await promise;
      
      expect(results).toHaveLength(4);
      expect(results[0]).toEqual({ value: 0 });
      expect(results[1]).toEqual({ value: 10 });
      expect(results[2]).toEqual({ value: 20 });
      expect(results[3]).toEqual({ done: true });
    });
  });

  describe('Mixed Handler Types', () => {
    it('should handle both regular and generator handlers', async () => {
      const sourceNode = happen.createNode('source');
      const targetNode = happen.createNode('target');
      
      cleanup.push(() => Promise.resolve(), () => Promise.resolve());
      
      let regularResult: any;
      let streamResult: any[] = [];
      
      // Regular handler
      targetNode.on('regular-event', (event: any) => {
        return { processed: true, data: event.payload.data };
      });
      
      // Generator handler
      targetNode.on('stream-event', async function* streamHandler(event: any) {
        const items = event.payload.items;
        for (const item of items) {
          yield { processed: item, timestamp: Date.now() };
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        yield { allProcessed: items.length };
      });
      
      // Test regular handler
      regularResult = await sourceNode.send(targetNode, {
        type: 'regular-event',
        payload: { data: 'test-data' }
      }).return();
      
      expect(regularResult).toEqual({ processed: true, data: 'test-data' });
      
      // Test generator handler
      const stream = await sourceNode.send(targetNode, {
        type: 'stream-event',
        payload: { items: ['a', 'b', 'c'] }
      }).return();
      
      for await (const chunk of stream) {
        streamResult.push(chunk);
      }
      
      expect(streamResult).toHaveLength(4);
      expect(streamResult[0].processed).toBe('a');
      expect(streamResult[1].processed).toBe('b');
      expect(streamResult[2].processed).toBe('c');
      expect(streamResult[3]).toEqual({ allProcessed: 3 });
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in generator streams', async () => {
      const sourceNode = happen.createNode('source');
      const targetNode = happen.createNode('target');
      
      cleanup.push(() => Promise.resolve(), () => Promise.resolve());
      
      // Generator that throws an error
      targetNode.on('error-stream', async function* errorHandler(_event: any) {
        yield { chunk: 0, data: 'first' };
        await new Promise(resolve => setTimeout(resolve, 10));
        yield { chunk: 1, data: 'second' };
        
        // Throw error on third iteration
        throw new Error('Stream processing failed');
      });
      
      const stream = await sourceNode.send(targetNode, {
        type: 'error-stream',
        payload: {}
      }).return();
      
      const results: any[] = [];
      let errorThrown = false;
      
      try {
        for await (const chunk of stream) {
          results.push(chunk);
        }
      } catch (error) {
        errorThrown = true;
        expect((error as Error).message).toBe('Stream processing failed');
      }
      
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ chunk: 0, data: 'first' });
      expect(results[1]).toEqual({ chunk: 1, data: 'second' });
      expect(errorThrown).toBe(true);
    });
  });

  describe('Performance and Memory', () => {
    it('should handle large streams efficiently', async () => {
      const sourceNode = happen.createNode('source');
      const targetNode = happen.createNode('target');
      
      cleanup.push(() => Promise.resolve(), () => Promise.resolve());
      
      const TOTAL_ITEMS = 1000;
      let processedCount = 0;
      
      // Large stream generator
      targetNode.on('large-stream', async function* largeStreamHandler(event: any) {
        const { totalItems } = event.payload;
        
        for (let i = 0; i < totalItems; i++) {
          yield { 
            index: i, 
            data: `item-${i}`,
            progress: Math.round((i / totalItems) * 100)
          };
          
          // Small delay to simulate processing
          if (i % 100 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }
        
        yield { totalProcessed: totalItems };
      });
      
      const stream = await sourceNode.send(targetNode, {
        type: 'large-stream',
        payload: { totalItems: TOTAL_ITEMS }
      }).return();
      
      const startTime = Date.now();
      
      for await (const chunk of stream) {
        processedCount++;
        
        // Verify structure
        if (chunk.index !== undefined) {
          expect(chunk).toHaveProperty('index');
          expect(chunk).toHaveProperty('data');
          expect(chunk).toHaveProperty('progress');
        } else {
          expect(chunk).toEqual({ totalProcessed: TOTAL_ITEMS });
        }
      }
      
      const endTime = Date.now();
      
      expect(processedCount).toBe(TOTAL_ITEMS + 1); // +1 for final result
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle empty streams', async () => {
      const sourceNode = happen.createNode('source');
      const targetNode = happen.createNode('target');
      
      cleanup.push(() => Promise.resolve(), () => Promise.resolve());
      
      // Empty stream generator
      targetNode.on('empty-stream', async function* emptyStreamHandler(_event: any) {
        // Don't yield anything
        yield { empty: true };
      });
      
      const stream = await sourceNode.send(targetNode, {
        type: 'empty-stream',
        payload: {}
      }).return();
      
      const results: any[] = [];
      for await (const chunk of stream) {
        results.push(chunk);
      }
      
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ empty: true });
    });

    it('should handle early return from stream consumption', async () => {
      const sourceNode = happen.createNode('source');
      const targetNode = happen.createNode('target');
      
      cleanup.push(() => Promise.resolve(), () => Promise.resolve());
      
      // Long-running stream
      targetNode.on('long-stream', async function* longStreamHandler(_event: any) {
        for (let i = 0; i < 1000; i++) {
          yield { chunk: i };
          await new Promise(resolve => setTimeout(resolve, 1));
        }
        yield { completed: true };
      });
      
      const stream = await sourceNode.send(targetNode, {
        type: 'long-stream',
        payload: {}
      }).return();
      
      const results: any[] = [];
      let iterations = 0;
      
      // Only consume first 5 items
      for await (const chunk of stream) {
        results.push(chunk);
        iterations++;
        
        if (iterations >= 5) {
          break; // Early return
        }
      }
      
      expect(results).toHaveLength(5);
      expect(results[0]).toEqual({ chunk: 0 });
      expect(results[4]).toEqual({ chunk: 4 });
    });
  });

  describe('Flow Control Integration', () => {
    it('should work with event continuum flow control', async () => {
      const sourceNode = happen.createNode('source');
      const targetNode = happen.createNode('target');
      
      cleanup.push(() => Promise.resolve(), () => Promise.resolve());
      
      // Flow control handler that can return either a function or a generator
      targetNode.on('flow-stream', async function flowStreamHandler(event: any, context: any) {
        const { shouldFail } = event.payload;
        
        if (shouldFail) {
          context.failureReason = 'Requested failure';
          return handleFailure;
        }
        
        // Return a generator for successful case
        return async function* streamingHandler() {
          for (let i = 0; i < 3; i++) {
            yield { step: i, status: 'processing' };
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          yield { status: 'success' };
        }();
      });
      
      // Error handler function
      function handleFailure(_event: any, context: any) {
        return { status: 'failed', reason: context.failureReason };
      }
      
      // Test success case
      const successStream = await sourceNode.send(targetNode, {
        type: 'flow-stream',
        payload: { shouldFail: false }
      }).return();
      
      const successResults: any[] = [];
      for await (const chunk of successStream) {
        successResults.push(chunk);
      }
      
      expect(successResults).toHaveLength(4);
      expect(successResults[3]).toEqual({ status: 'success' });
      
      // Test failure case
      const failureResult = await sourceNode.send(targetNode, {
        type: 'flow-stream',
        payload: { shouldFail: true }
      }).return();
      
      // Should not be a generator, should be direct result
      expect(typeof failureResult[Symbol.asyncIterator]).toBe('undefined');
      expect(failureResult).toEqual({ status: 'failed', reason: 'Requested failure' });
    });
  });
});