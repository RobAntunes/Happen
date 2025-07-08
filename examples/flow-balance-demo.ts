#!/usr/bin/env node
/**
 * Flow Balance Demo
 * Shows how Flow Balance provides invisible resilience monitoring
 */

import { initializeHappen } from '../src';

async function main() {
  console.log('⚖️ Happen Flow Balance Demo');
  console.log('============================\n');

  // Initialize Happen with NATS (Flow Balance starts automatically)
  const happen = initializeHappen({
    nats: {
      server: {
        servers: ['nats://localhost:4222'],
        jetstream: true,
      }
    }
  });

  console.log('✅ Happen initialized with Flow Balance monitoring\n');

  // Create nodes for different services
  const orchestratorNode = happen.createNode('orchestrator');
  const orderNode = happen.createNode('order-service');
  const paymentNode = happen.createNode('payment-service');
  const inventoryNode = happen.createNode('inventory-service');
  const notificationNode = happen.createNode('notification-service');

  console.log('✅ Service nodes created\n');

  // Demo 1: Listen for Flow Balance events
  console.log('🔍 Demo 1: Flow Balance Event Monitoring');
  console.log('----------------------------------------');

  // Listen for node-specific imbalance events
  orchestratorNode.on('node.down', (event) => {
    const { nodeId, lagMetrics, pattern, severity } = event.payload;
    console.log(`⚠️ Node imbalance detected: ${nodeId}`);
    console.log(`   Pattern: ${pattern}, Severity: ${severity}`);
    console.log(`   Messages waiting: ${lagMetrics.messagesWaiting}`);
    console.log(`   Consumer lag: ${lagMetrics.consumerLag}`);
    console.log(`   Processing rate: ${lagMetrics.processingRate.toFixed(2)} msg/sec`);
    console.log(`   Ack rate: ${(lagMetrics.ackRate * 100).toFixed(1)}%`);
    
    // Implement recovery strategy based on severity
    if (lagMetrics.messagesWaiting > 1000) {
      console.log('   🚨 Severe imbalance - implementing node failure recovery');
      implementNodeFailureRecovery(nodeId);
    } else if (lagMetrics.messagesWaiting > 500) {
      console.log('   ⚠️ Moderate imbalance - applying backpressure');
      applyBackpressure(nodeId);
    } else {
      console.log('   ℹ️ Minor imbalance - monitoring');
      logImbalance(nodeId, lagMetrics);
    }
  });

  // Listen for system-wide imbalance events
  orchestratorNode.on('system.down', (event) => {
    const { level, affectedNodes, pattern, confidence } = event.payload;
    console.log(`🚨 System imbalance detected:`);
    console.log(`   Level: ${level}, Pattern: ${pattern}`);
    console.log(`   Affected nodes: ${affectedNodes.join(', ')}`);
    console.log(`   Confidence: ${(confidence * 100).toFixed(1)}%`);
    
    // Implement system-wide recovery
    if (level === 'critical') {
      console.log('   🚨 Critical system issue - enabling emergency mode');
      enableEmergencyMode();
    } else if (level === 'severe') {
      console.log('   ⚠️ Severe system issue - throttling non-essential operations');
      throttleNonEssentialOperations();
    }
  });

  console.log('✅ Flow Balance event listeners configured\n');

  // Demo 2: Simulate different failure patterns
  console.log('🎭 Demo 2: Simulating Flow Patterns');
  console.log('-----------------------------------');

  // Simulate normal processing
  console.log('📈 Starting normal event processing...');
  
  // Order processing workflow
  orderNode.on('process-order', async (event) => {
    console.log(`📋 Processing order: ${event.payload.orderId}`);
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Send to payment service
    await paymentNode.send(paymentNode, {
      type: 'process-payment',
      payload: {
        orderId: event.payload.orderId,
        amount: event.payload.amount
      }
    }).return();
    
    // Send to inventory service
    await inventoryNode.send(inventoryNode, {
      type: 'check-inventory',
      payload: {
        orderId: event.payload.orderId,
        items: event.payload.items
      }
    }).return();
    
    console.log(`✅ Order ${event.payload.orderId} processed successfully`);
  });

  // Payment processing
  paymentNode.on('process-payment', async (event) => {
    console.log(`💳 Processing payment for order: ${event.payload.orderId}`);
    
    // Simulate payment processing - sometimes slow
    const processingTime = Math.random() > 0.7 ? 2000 : 200;
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    if (processingTime > 1000) {
      console.log(`   ⏳ Payment processing took ${processingTime}ms (slow)`);
    }
    
    return { success: true, transactionId: `txn-${Date.now()}` };
  });

  // Inventory checking
  inventoryNode.on('check-inventory', async (event) => {
    console.log(`📦 Checking inventory for order: ${event.payload.orderId}`);
    
    // Simulate inventory check
    await new Promise(resolve => setTimeout(resolve, 150));
    
    return { success: true, available: true };
  });

  // Notification service
  notificationNode.on('send-notification', async (event) => {
    console.log(`📧 Sending notification: ${event.payload.type}`);
    
    // Simulate notification sending
    await new Promise(resolve => setTimeout(resolve, 50));
    
    return { success: true };
  });

  console.log('✅ Service handlers configured\n');

  // Demo 3: Generate load to trigger Flow Balance
  console.log('🚀 Demo 3: Generating Load');
  console.log('---------------------------');

  // Generate normal load
  console.log('📊 Generating normal load...');
  for (let i = 0; i < 20; i++) {
    orderNode.send(orderNode, {
      type: 'process-order',
      payload: {
        orderId: `order-${i}`,
        amount: Math.floor(Math.random() * 1000) + 50,
        items: [`item-${i}`]
      }
    });
    
    // Small delay between orders
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log('✅ Normal load generated\n');

  // Demo 4: Simulate bottleneck
  console.log('🐌 Demo 4: Simulating Bottleneck');
  console.log('--------------------------------');

  // Create a slow handler to simulate bottleneck
  const slowPaymentNode = happen.createNode('slow-payment-service');
  
  slowPaymentNode.on('process-payment', async (event) => {
    console.log(`💳 [SLOW] Processing payment for order: ${event.payload.orderId}`);
    
    // Simulate very slow processing
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return { success: true, transactionId: `slow-txn-${Date.now()}` };
  });

  // Send requests to slow service
  console.log('📈 Sending requests to slow service...');
  for (let i = 0; i < 5; i++) {
    slowPaymentNode.send(slowPaymentNode, {
      type: 'process-payment',
      payload: {
        orderId: `slow-order-${i}`,
        amount: 100
      }
    });
    
    // Quick succession to create backlog
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('✅ Bottleneck simulation started\n');

  // Demo 5: Recovery strategies
  console.log('🔧 Demo 5: Recovery Strategies');
  console.log('------------------------------');

  // Show how to implement different recovery strategies
  function implementNodeFailureRecovery(nodeId: string) {
    console.log(`🔄 Implementing node failure recovery for: ${nodeId}`);
    console.log('   - Redirecting traffic to backup node');
    console.log('   - Alerting operations team');
    console.log('   - Enabling circuit breaker for affected services');
  }

  function applyBackpressure(nodeId: string) {
    console.log(`🚦 Applying backpressure for: ${nodeId}`);
    console.log('   - Reducing message send rate');
    console.log('   - Increasing processing timeouts');
    console.log('   - Activating queue management');
  }

  function logImbalance(nodeId: string, metrics: any) {
    console.log(`📊 Logging imbalance for: ${nodeId}`);
    console.log('   - Recording metrics for trend analysis');
    console.log('   - Updating performance dashboards');
    console.log('   - Scheduling capacity review');
  }

  function enableEmergencyMode() {
    console.log('🚨 Emergency mode activated:');
    console.log('   - Disabling non-essential services');
    console.log('   - Activating disaster recovery protocols');
    console.log('   - Notifying incident response team');
  }

  function throttleNonEssentialOperations() {
    console.log('⚠️ Throttling non-essential operations:');
    console.log('   - Reducing batch processing');
    console.log('   - Delaying non-critical notifications');
    console.log('   - Increasing cache usage');
  }

  console.log('✅ Recovery strategies defined\n');

  // Wait for Flow Balance to detect patterns
  console.log('⏳ Waiting for Flow Balance to analyze patterns...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  console.log('\n🎉 Flow Balance Demo Complete!');
  console.log('\n⚖️ Key Flow Balance Features:');
  console.log('   • Invisible monitoring through NATS JetStream');
  console.log('   • Automatic pattern detection (partitions, failures, bottlenecks)');
  console.log('   • System events for application response');
  console.log('   • Zero API surface - works transparently');
  console.log('   • Customizable recovery strategies');
  console.log('   • Natural detection through message flow');
  
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});