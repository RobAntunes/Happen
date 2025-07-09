#!/usr/bin/env ts-node
/**
 * Event Continuum Pattern
 * Shows how handlers can return functions to continue the event flow
 * with shared context across the continuum
 */

import { initializeHappen } from '../src';

async function main() {
  const happen = initializeHappen();
  
  // Create workflow nodes
  const orchestrator = happen.createNode('orchestrator');
  const validator = happen.createNode('validator');
  const processor = happen.createNode('processor');
  const notifier = happen.createNode('notifier');
  
  // Validator starts a continuum by returning a function
  validator.on('validate-order', (event) => {
    const { orderId, amount, customerEmail } = event.payload as { orderId: string; amount: number; customerEmail: string };
    
    // Perform validation
    const isValid = amount > 0 && amount < 10000;
    
    // Store validation result (will be available in the continuum)
    const validationResult = {
      isValid,
      validatedAt: Date.now(),
      validator: event.context.causal.sender
    };
    
    // Return a function to continue the flow
    return async (_event: any, context: any) => {
      console.log('Continuing from validation...');
      console.log('Validation result:', validationResult);
      
      if (validationResult.isValid) {
        // Send to processor
        await validator.send(processor, {
          type: 'process-order',
          payload: { orderId, amount, customerEmail }
        });
      } else {
        // Send rejection notification
        await validator.send(notifier, {
          type: 'notify-rejection',
          payload: { orderId, reason: 'Invalid amount' }
        });
      }
    };
  });
  
  // Processor also continues the continuum
  processor.on('process-order', (event) => {
    const { orderId, amount } = event.payload as { orderId: string; amount: number };
    
    // Process the order
    const transactionId = `txn-${Date.now()}`;
    const processedAt = Date.now();
    
    // Store processing result (will be available in the continuum)
    const processingResult = {
      transactionId,
      processedAt,
      status: 'completed'
    };
    
    console.log(`Processing order ${orderId} for $${amount}`);
    
    // Return function to continue flow after processing
    return async (_event: any, context: any) => {
      console.log('Post-processing phase...');
      console.log('Transaction:', processingResult.transactionId);
      
      // Notify success
      await processor.send(notifier, {
        type: 'notify-success',
        payload: {
          orderId,
          transactionId: context.processingResult.transactionId,
          amount
        }
      });
      
      // Could add more post-processing steps here
      // Each step has access to the accumulated context
    };
  });
  
  // Notifier handles different notification types
  notifier.on('notify-success', (event) => {
    const { orderId, transactionId, amount } = event.payload as { orderId: string; transactionId: string; amount: number };
    console.log(`✅ Order ${orderId} processed successfully!`);
    console.log(`   Transaction: ${transactionId}`);
    console.log(`   Amount: $${amount}`);
  });
  
  notifier.on('notify-rejection', (event) => {
    const { orderId, reason } = event.payload as { orderId: string; reason: string };
    console.log(`❌ Order ${orderId} rejected: ${reason}`);
  });
  
  // Orchestrator initiates the flow
  console.log('Starting order processing flow...\n');
  
  // Test valid order
  await orchestrator.send(validator, {
    type: 'validate-order',
    payload: {
      orderId: 'order-123',
      amount: 99.99,
      customerEmail: 'customer@example.com'
    }
  });
  
  console.log('\n---\n');
  
  // Test invalid order
  await orchestrator.send(validator, {
    type: 'validate-order',
    payload: {
      orderId: 'order-456',
      amount: 15000, // Too high
      customerEmail: 'bigspender@example.com'
    }
  });
}

main().catch(console.error);