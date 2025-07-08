#!/usr/bin/env node
/**
 * Simple Error Handling Demo
 * Shows basic error handling patterns
 */

import { initializeHappen } from '../src';

async function main() {
  console.log('🚨 Happen Error Handling Demo');
  console.log('==============================\n');

  // Initialize Happen
  const happen = initializeHappen();
  console.log('✅ Happen initialized\n');

  // Create nodes
  const orderNode = happen.createNode('order-service');
  console.log('✅ Order service created\n');

  // Demo 1: Functional Error Model
  console.log('⚡ Demo 1: Functional Error Model');
  console.log('----------------------------------');
  
  let results: any[] = [];
  
  // Error handler function
  function handleValidationError(_event: any, context: any) {
    console.log(`❌ Validation failed: ${context.validationError}`);
    results.push({
      success: false,
      reason: 'validation-failed',
      details: context.validationError
    });
    return { success: false, reason: 'validation-failed' };
  }
  
  // Success handler
  function processValidOrder(event: any, _context: any) {
    console.log(`✅ Order validated: ${event.payload.orderId}`);
    results.push({
      success: true,
      orderId: event.payload.orderId
    });
    return { success: true, orderId: event.payload.orderId };
  }
  
  // Main validation handler
  function validateOrder(event: any, context: any) {
    const { orderId, customerId } = event.payload;
    
    if (!orderId) {
      context.validationError = 'Order ID is required';
      return handleValidationError; // Return error handler as function
    }
    
    if (!customerId) {
      context.validationError = 'Customer ID is required';
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
      customerId: 'customer-456'
    }
  });
  
  // Test invalid order
  console.log('🚀 Testing invalid order...');
  orderNode.send(orderNode, {
    type: 'validate-order',
    payload: {
      customerId: 'customer-456'
      // Missing orderId
    }
  });
  
  await new Promise(resolve => setTimeout(resolve, 200));
  
  console.log(`📊 Validation results: ${results.length} processed`);
  console.log(`   ✅ Success: ${results.filter(r => r.success).length}`);
  console.log(`   ❌ Failures: ${results.filter(r => !r.success).length}`);
  console.log('✅ Demo 1 completed\n');

  // Demo 2: Retry Pattern
  console.log('🔄 Demo 2: Retry Pattern');
  console.log('-------------------------');
  
  const paymentNode = happen.createNode('payment-service');
  
  let paymentAttempts = 0;
  let paymentResults: any[] = [];
  
  function processPaymentWithRetry(_event: any, context: any) {
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

  console.log('🎉 Error Handling patterns working correctly!');
  console.log('\n🚨 Features demonstrated:');
  console.log('   • Functional error model with flow branches');
  console.log('   • Error propagation through context');
  console.log('   • Retry patterns with self-recursion');
  console.log('   • Error handlers as return values');
  
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});