/**
 * Error Handling Tests
 * Tests all error handling patterns as described in the spec
 */

import { initializeHappen } from '../src';
import { flow } from '../src/continuum';
import { resilience, getGlobalSupervisor, CircuitBreaker } from '../src/resilience';
import { createErrorEvent } from '../src/events';

describe('Error Handling', () => {
  let happen: any;
  let cleanup: (() => Promise<void>)[] = [];
  
  beforeEach(() => {
    happen = initializeHappen();
  });
  
  afterEach(async () => {
    await Promise.all(cleanup.map(fn => fn()));
    cleanup = [];
  });

  describe('1. Functional Error Model', () => {
    it('should handle errors as flow branches', async () => {
      const node = happen.createNode('test-node');
      cleanup.push(() => node.stop());
      
      let results: any[] = [];
      
      // Error handler function
      function handleValidationError(event: any, context: any) {
        results.push({
          type: 'error',
          reason: 'validation-failed',
          error: context.validationError
        });
        return { success: false, reason: 'validation-failed' };
      }
      
      // Main handler that returns error handler on failure
      function validateOrder(event: any, context: any) {
        if (!event.payload.orderId) {
          context.validationError = 'Order ID is required';
          return handleValidationError; // Return error handler as function
        }
        
        results.push({ type: 'success', orderId: event.payload.orderId });
        return { success: true, orderId: event.payload.orderId };
      }
      
      node.on('process-order', validateOrder);
      
      // Test valid order
      node.send(node, {
        type: 'process-order',
        payload: { orderId: 'order-123' }
      });
      
      // Test invalid order
      node.send(node, {
        type: 'process-order',
        payload: { customerId: 'customer-456' } // Missing orderId
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(results).toHaveLength(2);
      expect(results[0].type).toBe('success');
      expect(results[1].type).toBe('error');
      expect(results[1].reason).toBe('validation-failed');
    });

    it('should support nested error handling', async () => {
      const node = happen.createNode('test-node');
      cleanup.push(() => node.stop());
      
      let results: any[] = [];
      
      function handlePaymentError(event: any, context: any) {
        results.push({ step: 'payment-error', error: context.paymentError });
        return { success: false, reason: 'payment-failed' };
      }
      
      function handleValidationError(event: any, context: any) {
        results.push({ step: 'validation-error', error: context.validationError });
        return { success: false, reason: 'validation-failed' };
      }
      
      function processPayment(event: any, context: any) {
        if (!event.payload.paymentMethod) {
          context.paymentError = 'Payment method required';
          return handlePaymentError;
        }
        
        results.push({ step: 'payment-success' });
        return { success: true };
      }
      
      function validateOrder(event: any, context: any) {
        if (!event.payload.orderId) {
          context.validationError = 'Order ID required';
          return handleValidationError;
        }
        
        results.push({ step: 'validation-success' });
        return processPayment; // Continue to next step
      }
      
      node.on('process-order', validateOrder);
      
      // Test missing payment method
      node.send(node, {
        type: 'process-order',
        payload: { orderId: 'order-123' }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(results).toHaveLength(2);
      expect(results[0].step).toBe('validation-success');
      expect(results[1].step).toBe('payment-error');
    });
  });

  describe('2. Error Propagation and Context', () => {
    it('should propagate error information through context', async () => {
      const node = happen.createNode('test-node');
      cleanup.push(() => node.stop());
      
      let capturedContext: any = null;
      
      function handleError(event: any, context: any) {
        capturedContext = { ...context };
        return { success: false, details: context.error };
      }
      
      function processWithError(event: any, context: any) {
        try {
          throw new Error('Processing failed');
        } catch (error) {
          context.error = {
            message: (error as Error).message,
            timestamp: Date.now(),
            correlationId: event.context.causal.correlationId
          };
          return handleError;
        }
      }
      
      node.on('process-data', processWithError);
      
      node.send(node, {
        type: 'process-data',
        payload: { data: 'test' }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(capturedContext).toBeTruthy();
      expect(capturedContext.error).toBeDefined();
      expect(capturedContext.error.message).toBe('Processing failed');
      expect(capturedContext.error.timestamp).toBeDefined();
      expect(capturedContext.error.correlationId).toBeDefined();
    });
  });

  describe('3. Recovery Patterns', () => {
    it('should implement retry pattern', async () => {
      const node = happen.createNode('test-node');
      cleanup.push(() => node.stop());
      
      let attempts = 0;
      let results: any[] = [];
      
      function processWithRetry(event: any, context: any) {
        context.retryCount = context.retryCount || 0;
        attempts++;
        
        if (context.retryCount < 2) {
          context.retryCount++;
          results.push({ attempt: attempts, status: 'retry' });
          return processWithRetry; // Retry by returning self
        }
        
        results.push({ attempt: attempts, status: 'success' });
        return { success: true, attempts };
      }
      
      node.on('process-data', processWithRetry);
      
      node.send(node, {
        type: 'process-data',
        payload: { data: 'test' }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(attempts).toBe(3);
      expect(results).toHaveLength(3);
      expect(results[0].status).toBe('retry');
      expect(results[1].status).toBe('retry');
      expect(results[2].status).toBe('success');
    });

    it('should implement circuit breaker pattern', async () => {
      const node = happen.createNode('test-node');
      cleanup.push(() => node.stop());
      
      let attempts = 0;
      let results: any[] = [];
      
      // Handler that fails multiple times
      function failingHandler(event: any, context: any) {
        attempts++;
        if (attempts < 6) {
          throw new Error(`Attempt ${attempts} failed`);
        }
        return { success: true, attempts };
      }
      
      // Fallback handler
      function fallbackHandler(event: any, context: any) {
        results.push({ type: 'fallback', reason: 'circuit-open' });
        return { success: false, reason: 'service-unavailable' };
      }
      
      // Apply circuit breaker
      const protectedHandler = resilience.circuitBreaker({
        name: 'test-service',
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 1000,
        fallbackHandler
      })(failingHandler);
      
      node.on('process-data', protectedHandler);
      
      // Send multiple requests to trip the circuit
      for (let i = 0; i < 10; i++) {
        try {
          node.send(node, {
            type: 'process-data',
            payload: { data: `test-${i}` }
          });
        } catch (error) {
          // Expected for some requests
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(attempts).toBeLessThan(10); // Circuit should have opened
      expect(results.length).toBeGreaterThan(0); // Fallback should have been called
    });

    it('should implement bulkhead pattern', async () => {
      const node = happen.createNode('test-node');
      cleanup.push(() => node.stop());
      
      let concurrentCount = 0;
      let maxConcurrent = 0;
      let results: any[] = [];
      
      function slowHandler(event: any, context: any) {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        
        return new Promise(resolve => {
          setTimeout(() => {
            concurrentCount--;
            results.push({ processed: event.payload.id });
            resolve({ success: true });
          }, 50);
        });
      }
      
      // Apply bulkhead with max 3 concurrent
      const protectedHandler = resilience.bulkhead(3)(slowHandler);
      node.on('process-data', protectedHandler);
      
      // Send 10 requests simultaneously
      for (let i = 0; i < 10; i++) {
        node.send(node, {
          type: 'process-data',
          payload: { id: i }
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(maxConcurrent).toBeLessThanOrEqual(3); // Bulkhead should limit concurrency
      expect(results).toHaveLength(10); // All requests should eventually complete
    });

    it('should implement fallback pattern', async () => {
      const node = happen.createNode('test-node');
      cleanup.push(() => node.stop());
      
      let results: any[] = [];
      
      function primaryHandler(event: any, context: any) {
        throw new Error('Primary service failed');
      }
      
      function fallbackHandler(event: any, context: any) {
        results.push({ 
          type: 'fallback', 
          reason: context.fallbackReason?.message,
          data: event.payload 
        });
        return { success: true, source: 'fallback' };
      }
      
      const protectedHandler = resilience.fallback(fallbackHandler)(primaryHandler);
      node.on('process-data', protectedHandler);
      
      node.send(node, {
        type: 'process-data',
        payload: { data: 'test' }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('fallback');
      expect(results[0].reason).toBe('Primary service failed');
    });
  });

  describe('4. Error Events as First-Class Citizens', () => {
    it('should create and broadcast error events', async () => {
      const node = happen.createNode('test-node');
      const monitoringNode = happen.createNode('monitoring-node');
      
      cleanup.push(() => node.stop(), () => monitoringNode.stop());
      
      let errorEvents: any[] = [];
      
      // Monitor error events
      monitoringNode.on((type: string) => type.endsWith('.error'), (event: any) => {
        errorEvents.push({
          type: event.type,
          payload: event.payload,
          context: event.context
        });
      });
      
      // Handler that creates error events
      node.on('process-payment', (event: any, context: any) => {
        try {
          throw new Error('Payment processing failed');
        } catch (error) {
          // Create and broadcast error event
          const errorEvent = createErrorEvent(error as Error, event, {}, node.id);
          
          node.broadcast({
            type: 'payment.error',
            payload: {
              orderId: event.payload.orderId,
              error: {
                message: (error as Error).message,
                code: 'PAYMENT_FAILED'
              },
              timestamp: Date.now()
            }
          });
          
          return { success: false, reason: 'payment-error' };
        }
      });
      
      node.send(node, {
        type: 'process-payment',
        payload: { orderId: 'order-123', amount: 100 }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].type).toBe('payment.error');
      expect(errorEvents[0].payload.orderId).toBe('order-123');
      expect(errorEvents[0].payload.error.message).toBe('Payment processing failed');
    });
  });

  describe('5. Supervisor Pattern', () => {
    it('should monitor service health and errors', async () => {
      const supervisor = getGlobalSupervisor();
      
      // Monitor a service
      supervisor.monitor('payment-service');
      
      // Report some errors
      supervisor.reportError('payment-service', new Error('Connection timeout'));
      supervisor.reportError('payment-service', new Error('Invalid response'));
      supervisor.reportError('payment-service', new Error('Network error'));
      
      const health = supervisor.getServiceHealth('payment-service');
      expect(health).toBeDefined();
      expect(health!.serviceName).toBe('payment-service');
      expect(health!.errorCount).toBe(3);
      expect(health!.status).toBe('degraded');
      
      // Report more errors to trigger unhealthy status
      supervisor.reportError('payment-service', new Error('Database timeout'));
      supervisor.reportError('payment-service', new Error('Service unavailable'));
      
      const unhealthyHealth = supervisor.getServiceHealth('payment-service');
      expect(unhealthyHealth!.status).toBe('unhealthy');
    });

    it('should provide system-wide health overview', async () => {
      const supervisor = getGlobalSupervisor();
      
      // Monitor multiple services
      supervisor.monitor('order-service');
      supervisor.monitor('inventory-service');
      supervisor.monitor('notification-service');
      
      // Report errors for different services
      supervisor.reportError('order-service', new Error('Database error'));
      supervisor.reportError('inventory-service', new Error('API timeout'));
      
      const healthStatus = supervisor.getHealthStatus();
      expect(healthStatus).toHaveLength(4); // Including payment-service from previous test
      
      const orderService = healthStatus.find(s => s.serviceName === 'order-service');
      expect(orderService).toBeDefined();
      expect(orderService!.errorCount).toBe(1);
      
      const inventoryService = healthStatus.find(s => s.serviceName === 'inventory-service');
      expect(inventoryService).toBeDefined();
      expect(inventoryService!.errorCount).toBe(1);
      
      const notificationService = healthStatus.find(s => s.serviceName === 'notification-service');
      expect(notificationService).toBeDefined();
      expect(notificationService!.errorCount).toBe(0);
      expect(notificationService!.status).toBe('healthy');
    });
  });

  describe('6. Distributed Error Handling', () => {
    it('should maintain error causality across nodes', async () => {
      const nodeA = happen.createNode('node-a');
      const nodeB = happen.createNode('node-b');
      
      cleanup.push(() => nodeA.stop(), () => nodeB.stop());
      
      let errorChain: any[] = [];
      
      // Node A - originates error
      nodeA.on('process-task', (event: any, context: any) => {
        try {
          throw new Error('Task processing failed');
        } catch (error) {
          errorChain.push({
            node: 'A',
            error: (error as Error).message,
            eventId: event.id
          });
          
          return {
            success: false,
            reason: 'task-failed',
            error: (error as Error).message,
            timestamp: Date.now()
          };
        }
      });
      
      // Node B - handles failure from Node A
      nodeB.on('orchestrate-workflow', async (event: any, context: any) => {
        const result = await nodeB.send(nodeA, {
          type: 'process-task',
          payload: event.payload.taskData
        }).return();
        
        if (!result.success) {
          errorChain.push({
            node: 'B',
            cause: result.reason,
            error: result.error,
            originalEventId: event.id
          });
          
          return {
            success: false,
            reason: 'workflow-failed',
            cause: result.reason,
            error: result.error
          };
        }
        
        return { success: true };
      });
      
      // Start the workflow
      nodeB.send(nodeB, {
        type: 'orchestrate-workflow',
        payload: { taskData: { type: 'data-processing' } }
      });
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(errorChain).toHaveLength(2);
      expect(errorChain[0].node).toBe('A');
      expect(errorChain[0].error).toBe('Task processing failed');
      expect(errorChain[1].node).toBe('B');
      expect(errorChain[1].cause).toBe('task-failed');
    });
  });
});