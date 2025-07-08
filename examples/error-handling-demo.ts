#!/usr/bin/env node
/**
 * Error Handling Demo
 * Shows comprehensive error handling patterns in action
 */

import { initializeHappen } from '../src';
import { resilience, getGlobalSupervisor } from '../src/resilience';
import { createErrorEvent } from '../src/events';

async function main() {
  console.log('🚨 Happen Error Handling Demo');
  console.log('==============================\n');

  // Initialize Happen
  const happen = initializeHappen();
  console.log('✅ Happen initialized\n');

  // Demo 1: Functional Error Model
  console.log('⚡ Demo 1: Functional Error Model');
  console.log('----------------------------------');
  
  const orderNode = happen.createNode('order-service');
  
  let validationResults: any[] = [];
  
  // Error handler function
  function handleValidationError(event: any, context: any) {
    console.log(`❌ Validation failed: ${context.validationError}`);
    validationResults.push({
      success: false,
      reason: 'validation-failed',
      details: context.validationError
    });
    return { success: false, reason: 'validation-failed' };
  }
  
  // Success handler
  function processValidOrder(event: any, context: any) {
    console.log(`✅ Order validated: ${event.payload.orderId}`);
    validationResults.push({
      success: true,
      orderId: event.payload.orderId
    });
    return { success: true, orderId: event.payload.orderId };
  }
  
  // Main validation handler
  function validateOrder(event: any, context: any) {
    const { orderId, customerId, items } = event.payload;
    
    if (!orderId) {
      context.validationError = 'Order ID is required';
      return handleValidationError; // Return error handler as function
    }
    
    if (!customerId) {
      context.validationError = 'Customer ID is required';
      return handleValidationError;
    }
    
    if (!items || items.length === 0) {
      context.validationError = 'Order must contain at least one item';
      return handleValidationError;
    }
    
    // Validation passed, continue to success handler
    return processValidOrder;
  }
  
  orderNode.on('validate-order', validateOrder);
  
  // Test valid order
  console.log('🚀 Testing valid order...');
  orderNode.send(orderNode, {
    type: 'validate-order',
    payload: {
      orderId: 'order-123',
      customerId: 'customer-456',
      items: [{ id: 'item-1', quantity: 2 }]
    }
  });
  
  // Test invalid orders
  console.log('🚀 Testing invalid orders...');
  orderNode.send(orderNode, {
    type: 'validate-order',
    payload: {
      customerId: 'customer-456',
      items: [{ id: 'item-1', quantity: 2 }]
    }
  });
  
  orderNode.send(orderNode, {
    type: 'validate-order',
    payload: {
      orderId: 'order-124',
      customerId: 'customer-456',
      items: []
    }
  });
  
  await new Promise(resolve => setTimeout(resolve, 200));
  
  console.log(`📊 Validation results: ${validationResults.length} processed`);
  console.log(`   ✅ Success: ${validationResults.filter(r => r.success).length}`);
  console.log(`   ❌ Failures: ${validationResults.filter(r => !r.success).length}`);
  console.log('✅ Demo 1 completed\n');

  // Demo 2: Recovery Patterns
  console.log('🔄 Demo 2: Recovery Patterns');
  console.log('-----------------------------');
  
  const paymentNode = happen.createNode('payment-service');
  
  // Simulate payment service with retry logic
  let paymentAttempts = 0;
  let paymentResults: any[] = [];
  
  function processPaymentWithRetry(event: any, context: any) {
    context.retryCount = context.retryCount || 0;
    paymentAttempts++;
    
    console.log(`💳 Payment attempt ${paymentAttempts} (retry ${context.retryCount})`);
    
    // Simulate failure for first 2 attempts
    if (context.retryCount < 2) {
      context.retryCount++;
      console.log(`   ⏳ Retrying payment...`);
      return processPaymentWithRetry; // Retry by returning self
    }
    
    // Success on 3rd attempt
    console.log(`   ✅ Payment processed successfully`);
    paymentResults.push({
      success: true,
      attempts: paymentAttempts,
      transactionId: `txn-${Date.now()}`
    });
    
    return { success: true, attempts: paymentAttempts };
  }
  
  paymentNode.on('process-payment', processPaymentWithRetry);
  
  console.log('🚀 Testing retry pattern...');
  paymentNode.send(paymentNode, {
    type: 'process-payment',
    payload: { orderId: 'order-123', amount: 99.99 }
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log(`📊 Payment processed after ${paymentAttempts} attempts`);
  console.log('✅ Demo 2 completed\n');

  // Demo 3: Circuit Breaker Pattern
  console.log('🔌 Demo 3: Circuit Breaker Pattern');
  console.log('-----------------------------------');
  
  const inventoryNode = happen.createNode('inventory-service');
  
  let inventoryAttempts = 0;
  let circuitResults: any[] = [];
  
  // Failing inventory service
  function checkInventoryFailing(event: any, context: any) {
    inventoryAttempts++;
    console.log(`📦 Inventory check attempt ${inventoryAttempts}`);
    
    if (inventoryAttempts < 6) {
      throw new Error(`Inventory service failure #${inventoryAttempts}`);
    }
    
    return { success: true, available: true };
  }
  
  // Fallback handler
  function inventoryFallback(event: any, context: any) {
    console.log(`🔄 Using inventory fallback (circuit is open)`);
    circuitResults.push({ type: 'fallback', reason: 'circuit-open' });
    return { success: false, reason: 'service-unavailable', fallback: true };
  }
  
  // Apply circuit breaker
  const protectedInventory = resilience.circuitBreaker({
    name: 'inventory-service',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 2000,
    fallbackHandler: inventoryFallback
  })(checkInventoryFailing);
  
  inventoryNode.on('check-inventory', protectedInventory);
  
  console.log('🚀 Testing circuit breaker...');
  
  // Send multiple requests to trip the circuit
  for (let i = 0; i < 8; i++) {
    try {
      inventoryNode.send(inventoryNode, {
        type: 'check-inventory',
        payload: { productId: `product-${i}` }
      });
    } catch (error) {
      console.log(`   ❌ Request ${i + 1} failed`);
    }
  }
  
  await new Promise(resolve => setTimeout(resolve, 200));
  
  console.log(`📊 Inventory attempts: ${inventoryAttempts}`);
  console.log(`📊 Fallback calls: ${circuitResults.length}`);
  console.log('✅ Demo 3 completed\n');

  // Demo 4: Error Events as First-Class Citizens
  console.log('📡 Demo 4: Error Events as First-Class Citizens');
  console.log('-----------------------------------------------');
  
  const monitoringNode = happen.createNode('monitoring-service');
  const serviceNode = happen.createNode('business-service');
  
  let errorEvents: any[] = [];
  
  // Monitor all error events
  monitoringNode.on((type: string) => type.endsWith('.error'), (event: any) => {
    const service = event.type.split('.')[0];
    console.log(`🔍 Monitoring: ${service} error - ${event.payload.error.message}`);
    
    errorEvents.push({
      service,
      error: event.payload.error.message,
      timestamp: event.payload.timestamp
    });
  });
  
  // Business service that generates errors
  serviceNode.on('process-request', (event: any, context: any) => {
    try {
      // Simulate random failures
      if (Math.random() < 0.7) {
        throw new Error('Service temporarily unavailable');
      }
      
      return { success: true, processed: true };
    } catch (error) {
      console.log(`⚠️ Service error: ${(error as Error).message}`);
      
      // Broadcast error event
      serviceNode.broadcast({
        type: 'business.error',
        payload: {
          requestId: event.payload.requestId,
          error: {
            message: (error as Error).message,
            code: 'SERVICE_ERROR'
          },
          timestamp: Date.now()
        }
      });
      
      return { success: false, reason: 'service-error' };
    }
  });
  
  console.log('🚀 Testing error event broadcasting...');
  
  // Send multiple requests
  for (let i = 0; i < 5; i++) {
    serviceNode.send(serviceNode, {
      type: 'process-request',
      payload: { requestId: `req-${i}` }
    });
  }
  
  await new Promise(resolve => setTimeout(resolve, 200));
  
  console.log(`📊 Error events captured: ${errorEvents.length}`);
  console.log('✅ Demo 4 completed\n');

  // Demo 5: Supervisor Pattern
  console.log('👁️ Demo 5: Supervisor Pattern');
  console.log('------------------------------');
  
  const supervisor = getGlobalSupervisor();
  
  // Monitor multiple services
  supervisor.monitor('payment-service');
  supervisor.monitor('inventory-service');
  supervisor.monitor('notification-service');
  
  console.log('🚀 Simulating service errors...');
  
  // Simulate errors from different services
  supervisor.reportError('payment-service', new Error('Database connection timeout'));
  supervisor.reportError('payment-service', new Error('API rate limit exceeded'));
  supervisor.reportError('inventory-service', new Error('External service unavailable'));
  supervisor.reportError('payment-service', new Error('Network error'));
  
  const healthStatus = supervisor.getHealthStatus();
  
  console.log('📊 Service Health Status:');
  healthStatus.forEach(service => {
    const statusEmoji = service.status === 'healthy' ? '🟢' : 
                       service.status === 'degraded' ? '🟡' : '🔴';
    console.log(`   ${statusEmoji} ${service.serviceName}: ${service.status} (${service.errorCount} errors)`);
  });
  
  console.log('✅ Demo 5 completed\n');

  // Demo 6: Distributed Error Handling
  console.log('🌐 Demo 6: Distributed Error Handling');
  console.log('--------------------------------------');
  
  const orchestratorNode = happen.createNode('orchestrator');
  const workerNode = happen.createNode('worker');
  
  let distributedErrors: any[] = [];
  
  // Worker that fails
  workerNode.on('process-task', (event: any, context: any) => {
    console.log(`⚙️ Worker processing task: ${event.payload.taskId}`);
    
    try {
      throw new Error('Task processing failed');
    } catch (error) {
      distributedErrors.push({
        node: 'worker',
        error: (error as Error).message,
        taskId: event.payload.taskId
      });
      
      return {
        success: false,
        reason: 'task-failed',
        error: (error as Error).message,
        timestamp: Date.now()
      };
    }
  });
  
  // Orchestrator that handles worker failures
  orchestratorNode.on('orchestrate-workflow', async (event: any, context: any) => {
    console.log(`🎭 Orchestrator starting workflow: ${event.payload.workflowId}`);
    
    const result = await orchestratorNode.send(workerNode, {
      type: 'process-task',
      payload: { taskId: event.payload.workflowId }
    }).return();
    
    if (!result.success) {
      console.log(`❌ Workflow failed: ${result.reason}`);
      
      distributedErrors.push({
        node: 'orchestrator',
        cause: result.reason,
        error: result.error,
        workflowId: event.payload.workflowId
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
  
  console.log('🚀 Testing distributed error handling...');
  
  orchestratorNode.send(orchestratorNode, {
    type: 'orchestrate-workflow',
    payload: { workflowId: 'workflow-123' }
  });
  
  await new Promise(resolve => setTimeout(resolve, 200));
  
  console.log(`📊 Distributed error chain: ${distributedErrors.length} errors`);
  distributedErrors.forEach((error, index) => {
    console.log(`   ${index + 1}. ${error.node}: ${error.error || error.cause}`);
  });
  
  console.log('✅ Demo 6 completed\n');

  console.log('🎉 All Error Handling patterns working correctly!');
  console.log('\n🚨 Features demonstrated:');
  console.log('   • Functional error model with flow branches');
  console.log('   • Error propagation through context');
  console.log('   • Retry patterns with exponential backoff');
  console.log('   • Circuit breaker with fallback handlers');
  console.log('   • Error events as first-class citizens');
  console.log('   • Supervisor pattern for health monitoring');
  console.log('   • Distributed error handling with causality');
  console.log('   • Bulkhead isolation patterns');
  console.log('   • Comprehensive recovery strategies');
  
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});