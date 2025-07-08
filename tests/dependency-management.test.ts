/**
 * Tests for Dependency Management patterns from the spec
 */
// @ts-nocheck

import { initializeHappen } from '../src/initialize';

describe('Dependency Management', () => {
  describe('System-Level Dependencies', () => {
    it('should initialize Happen with NATS configuration', () => {
      const happen = initializeHappen({
        nats: {
          server: {
            servers: ['nats://localhost:4222'],
            jetstream: true
          },
          browser: {
            servers: ['wss://localhost:8443'],
            jetstream: true
          }
        }
      });

      expect(happen).toBeDefined();
      expect(happen.createNode).toBeDefined();
      expect(typeof happen.createNode).toBe('function');
    });

    it('should create nodes using the factory function', async () => {
      const happen = initializeHappen();
      const { createNode } = happen;

      const node = createNode('test-node');
      
      expect(node).toBeDefined();
      expect(node.id).toContain('test-node');
      expect(node.on).toBeDefined();
      expect(node.send).toBeDefined();
      expect(node.broadcast).toBeDefined();
      expect(node.state).toBeDefined();
      expect(node.global).toBeDefined();
      
      await node.start();
      await node.stop();
    });
  });

  describe('Closure-Based Dependency Injection', () => {
    it('should support dependency injection through closures', async () => {
      const happen = initializeHappen();
      const { createNode } = happen;

      // Mock dependencies
      const mockDatabase = {
        get: jest.fn().mockResolvedValue({ id: 1, name: 'Test' }),
        set: jest.fn().mockResolvedValue(true)
      };

      const mockEmailService = {
        send: jest.fn().mockResolvedValue({ sent: true })
      };

      // Initialize node with dependencies
      function initializeServiceNode() {
        const serviceNode = createNode('service');

        // Register handler using closure to capture dependencies
        serviceNode.on('process-data', (eventOrEvents, context) => {
          const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
          if (!event) return undefined;
          // Return a function that uses the captured dependencies
          return processWithDependencies(mockDatabase, mockEmailService, event.payload);
        });

        return serviceNode;
      }

      // Function that uses dependencies
      async function processWithDependencies(db: any, email: any, data: any) {
        return async (eventOrEvents: any, context: any) => {
          const dbResult = await db.get(data.id);
          await email.send({ to: data.email, subject: 'Processed' });
          
          return {
            success: true,
            data: dbResult
          };
        };
      }

      const node = initializeServiceNode();
      await node.start();

      // Emit event to trigger the handler
      node.emit({
        type: 'process-data',
        payload: { id: 1, email: 'test@example.com' }
      });

      // Give time for async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockDatabase.get).toHaveBeenCalledWith(1);
      expect(mockEmailService.send).toHaveBeenCalledWith({
        to: 'test@example.com',
        subject: 'Processed'
      });

      await node.stop();
    });
  });

  describe('Flow State Through Closures', () => {
    it('should manage flow state through closures as per spec', async () => {
      const happen = initializeHappen();
      const { createNode } = happen;

      const processedSteps: string[] = [];

      function initializeOrderNode() {
        const orderNode = createNode('order-service');

        orderNode.on('process-order', (eventOrEvents, context) => {
          const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
          if (!event) return undefined;
          // Create initial flow state
          const payload = event.payload as any;
          const flowState = {
            orderId: 'order-123',
            items: payload.items,
            customer: payload.customer
          };

          processedSteps.push('initial');

          // Return the first step function with state in closure
          return validateOrder(flowState);
        });

        return orderNode;
      }

      function validateOrder(state: any) {
        return (eventOrEvents: any, context: any) => {
          processedSteps.push('validate');

          // Validation logic
          if (!state.items || state.items.length === 0) {
            return {
              success: false,
              error: 'No items in order'
            };
          }

          // Update state immutably
          const updatedState = {
            ...state,
            validated: true,
            validatedAt: Date.now()
          };

          // Return next function to continue flow
          return processPayment(updatedState);
        };
      }

      function processPayment(state: any) {
        return (eventOrEvents: any, context: any) => {
          processedSteps.push('payment');

          // Update state
          const updatedState = {
            ...state,
            paymentId: 'pay-456',
            paidAt: Date.now()
          };

          // Return next function
          return finalizeOrder(updatedState);
        };
      }

      function finalizeOrder(state: any) {
        return async (eventOrEvents: any, context: any) => {
          processedSteps.push('finalize');

          // Return a value (not a function) to complete the flow
          return {
            success: true,
            orderId: state.orderId,
            paymentId: state.paymentId
          };
        };
      }

      const orderNode = initializeOrderNode();
      await orderNode.start();

      // Process order
      orderNode.emit({
        type: 'process-order',
        payload: {
          items: [{ id: 1, name: 'Product', price: 10 }],
          customer: { id: 'cust-1', email: 'customer@example.com' }
        }
      });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify all steps were executed in order
      expect(processedSteps).toEqual(['initial', 'validate', 'payment', 'finalize']);

      await orderNode.stop();
    });

    it('should handle flow termination when non-function is returned', async () => {
      const happen = initializeHappen();
      const { createNode } = happen;

      const node = createNode('test');
      let finalResult: any = null;

      node.on('test-flow', (eventOrEvents, context) => {
        // Return a function for the next step
        return (eventOrEvents: any, context: any) => {
          // Return a non-function to complete the flow
          finalResult = { completed: true, value: 42 };
          return finalResult;
        };
      });

      await node.start();
      node.emit({ type: 'test-flow', payload: {} });
      
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(finalResult).toEqual({ completed: true, value: 42 });

      await node.stop();
    });
  });

  describe('Direct Runtime Access', () => {
    it('should allow direct access to runtime features without framework abstraction', async () => {
      const happen = initializeHappen();
      const { createNode } = happen;

      // Direct use of runtime features (Map in this case)
      const clients = new Map<string, { send: jest.Mock }>();

      const notificationNode = createNode('notification-service');

      // Mock WebSocket-like client
      const mockClient: any = {
        send: jest.fn(),
        readyState: 1 // OPEN
      };
      clients.set('user-123', mockClient);

      notificationNode.on('notify-user', (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;
        const { userId, message } = event.payload as any;

        // Direct runtime access - no framework abstraction
        const clientSocket = clients.get(userId);

        if (!clientSocket || (clientSocket as any).readyState !== 1) {
          return {
            success: false,
            reason: 'user-not-connected'
          };
        }

        // Send notification
        clientSocket.send(JSON.stringify({
          type: 'notification',
          message
        }));

        return {
          success: true,
          delivered: true
        };
      });

      await notificationNode.start();

      notificationNode.emit({
        type: 'notify-user',
        payload: {
          userId: 'user-123',
          message: 'Hello from Happen!'
        }
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockClient.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'notification',
        message: 'Hello from Happen!'
      }));

      await notificationNode.stop();
    });
  });

  describe('Context Parameter in Event Continuum', () => {
    it('should pass data through the continuum using context', async () => {
      const happen = initializeHappen();
      const { createNode } = happen;

      const node = createNode('context-test');
      const processedData: any[] = [];

      node.on('multi-step-process', (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;

        // Initialize context data
        context.startTime = Date.now();
        context.steps = [];
        context.inputData = event.payload;

        // Make a deep copy of context to capture its state at this point
        processedData.push({ step: 'initial', context: JSON.parse(JSON.stringify(context)) });

        // Return first processing step
        return step1;
      });

      function step1(eventOrEvents: any, context: any) {
        // Access data from context
        const { inputData } = context;
        
        // Process and update context
        context.step1Result = inputData.value * 2;
        context.steps.push('step1');
        
        processedData.push({ step: 'step1', context: JSON.parse(JSON.stringify(context)) });

        // Continue to next step
        return step2;
      }

      function step2(eventOrEvents: any, context: any) {
        // Access previous results from context
        const { step1Result } = context;
        
        // Process further
        context.step2Result = step1Result + 10;
        context.steps.push('step2');
        
        processedData.push({ step: 'step2', context: JSON.parse(JSON.stringify(context)) });

        // Continue to final step
        return finalStep;
      }

      function finalStep(eventOrEvents: any, context: any) {
        // Access all accumulated data from context
        const { inputData, step1Result, step2Result, steps, startTime } = context;
        
        context.steps.push('final');
        context.processingTime = Date.now() - startTime;
        
        processedData.push({ step: 'final', context: JSON.parse(JSON.stringify(context)) });

        // Return final result (non-function completes the flow)
        return {
          success: true,
          input: inputData,
          results: {
            step1: step1Result,
            step2: step2Result
          },
          steps: steps,
          processingTime: context.processingTime
        };
      }

      await node.start();

      // Trigger the multi-step process
      node.emit({
        type: 'multi-step-process',
        payload: { value: 5 }
      });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify context was passed through all steps
      expect(processedData).toHaveLength(4);
      
      // Check initial step
      expect(processedData[0].step).toBe('initial');
      expect(processedData[0].context.inputData).toEqual({ value: 5 });
      expect(processedData[0].context.steps).toEqual([]);

      // Check step 1
      expect(processedData[1].step).toBe('step1');
      expect(processedData[1].context.step1Result).toBe(10); // 5 * 2
      expect(processedData[1].context.steps).toEqual(['step1']);

      // Check step 2
      expect(processedData[2].step).toBe('step2');
      expect(processedData[2].context.step2Result).toBe(20); // 10 + 10
      expect(processedData[2].context.steps).toEqual(['step1', 'step2']);

      // Check final step
      expect(processedData[3].step).toBe('final');
      expect(processedData[3].context.steps).toEqual(['step1', 'step2', 'final']);
      expect(processedData[3].context.processingTime).toBeGreaterThanOrEqual(0);

      await node.stop();
    });

    it('should maintain separate context for concurrent events', async () => {
      const happen = initializeHappen();
      const { createNode } = happen;

      const node = createNode('concurrent-test');
      const results: any[] = [];

      node.on('process-with-id', (eventOrEvents, context) => {
        const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
        if (!event) return undefined;

        // Store unique ID in context
        context.processId = event.payload.id;
        context.value = event.payload.value;

        // Simulate async processing
        return async (eventOrEvents: any, context: any) => {
          // Delay based on ID to ensure overlap
          await new Promise(resolve => setTimeout(resolve, context.processId * 10));
          
          // Process using context data
          const result = {
            processId: context.processId,
            originalValue: context.value,
            processed: context.value * context.processId
          };

          results.push(result);
          return result;
        };
      });

      await node.start();

      // Emit multiple events concurrently
      node.emit({ type: 'process-with-id', payload: { id: 1, value: 10 } });
      node.emit({ type: 'process-with-id', payload: { id: 2, value: 20 } });
      node.emit({ type: 'process-with-id', payload: { id: 3, value: 30 } });

      // Wait for all processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify each event maintained its own context
      expect(results).toHaveLength(3);
      
      const result1 = results.find(r => r.processId === 1);
      expect(result1).toEqual({
        processId: 1,
        originalValue: 10,
        processed: 10
      });

      const result2 = results.find(r => r.processId === 2);
      expect(result2).toEqual({
        processId: 2,
        originalValue: 20,
        processed: 40
      });

      const result3 = results.find(r => r.processId === 3);
      expect(result3).toEqual({
        processId: 3,
        originalValue: 30,
        processed: 90
      });

      await node.stop();
    });
  });
});