#!/usr/bin/env ts-node
/**
 * Flow Balance Monitoring
 * Shows how Flow Balance provides invisible resilience monitoring
 * by detecting issues through natural message flow patterns
 */

import { initializeHappen, createFlowBalanceMonitor } from '../src';

async function main() {
  const happen = initializeHappen({
    transport: {
      type: 'nats',
      options: {
        servers: ['nats://localhost:4222']
      }
    }
  });
  
  // Note: This example requires NATS with JetStream to be running
  // You can start it with: docker run -p 4222:4222 nats:latest -js
  
  console.log('=== Flow Balance Monitoring Demo ===\n');
  console.log('Note: This example requires NATS JetStream to be running.\n');
  
  // Create service nodes
  const orderService = happen.createNode('order-service');
  const paymentService = happen.createNode('payment-service');
  const inventoryService = happen.createNode('inventory-service');
  const monitoringDashboard = happen.createNode('monitoring-dashboard');
  
  // Set up Flow Balance monitoring
  const flowMonitor = createFlowBalanceMonitor(
    happen.transport.jetStreamManager,
    {
      enabled: true,
      pollingInterval: 2000, // Check every 2 seconds for demo
      thresholds: {
        minorLag: 10,
        moderateLag: 50,
        severeLag: 100,
        criticalLag: 200,
        maxProcessingTime: 5000,
        minAckRate: 0.9
      }
    },
    (event) => {
      // Flow Balance emits monitoring events
      monitoringDashboard.emit(event);
    }
  );
  
  // Monitoring dashboard responds to Flow Balance events
  monitoringDashboard.on('node.down', (event) => {
    const { nodeId, lagMetrics, pattern, severity } = event.payload as any;
    console.log(`\n🚨 NODE DOWN ALERT`);
    console.log(`   Node: ${nodeId}`);
    console.log(`   Pattern: ${pattern}`);
    console.log(`   Severity: ${severity}`);
    console.log(`   Messages waiting: ${lagMetrics.messagesWaiting}`);
    console.log(`   Processing rate: ${lagMetrics.processingRate.toFixed(2)} msg/s`);
  });
  
  monitoringDashboard.on('system.down', (event) => {
    const { level, pattern, affectedNodes, metrics } = event.payload as any;
    console.log(`\n🚨 SYSTEM ALERT`);
    console.log(`   Level: ${level}`);
    console.log(`   Pattern: ${pattern}`);
    console.log(`   Affected nodes: ${affectedNodes.join(', ')}`);
    console.log(`   Average lag: ${metrics.consumerLag}`);
  });
  
  // Simulate service behaviors
  let orderProcessingDelay = 100; // Start healthy
  let paymentProcessingDelay = 100;
  let inventoryProcessingDelay = 100;
  
  // Order service
  orderService.on('create-order', async (event) => {
    const { orderId, items } = event.payload as { orderId: string; items: string[] };
    
    // Simulate processing with variable delay
    await new Promise(resolve => setTimeout(resolve, orderProcessingDelay));
    
    // Check inventory
    const inventoryCheck = await orderService.send(inventoryService, {
      type: 'check-inventory',
      payload: { items }
    }).return();
    
    if (inventoryCheck.available) {
      // Process payment
      const payment = await orderService.send(paymentService, {
        type: 'process-payment',
        payload: { orderId, amount: 99.99 }
      }).return();
      
      return { orderId, status: 'completed', payment };
    }
    
    return { orderId, status: 'out-of-stock' };
  });
  
  // Payment service
  paymentService.on('process-payment', async () => {
    await new Promise(resolve => setTimeout(resolve, paymentProcessingDelay));
    return { 
      transactionId: `txn-${Date.now()}`,
      status: 'approved'
    };
  });
  
  // Inventory service
  inventoryService.on('check-inventory', async () => {
    await new Promise(resolve => setTimeout(resolve, inventoryProcessingDelay));
    return { available: Math.random() > 0.2 }; // 80% availability
  });
  
  // Start monitoring
  flowMonitor.start();
  console.log('Flow Balance monitoring started...\n');
  
  // Simulate normal traffic
  console.log('Phase 1: Normal traffic (10 seconds)');
  const normalTraffic = setInterval(() => {
    orderService.emit({
      type: 'create-order',
      payload: {
        orderId: `order-${Date.now()}`,
        items: ['item-1', 'item-2']
      }
    });
  }, 500); // 2 orders per second
  
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Simulate payment service slowdown (bottleneck)
  console.log('\nPhase 2: Payment service bottleneck (10 seconds)');
  paymentProcessingDelay = 3000; // Slow down payments
  
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Simulate inventory service failure
  console.log('\nPhase 3: Inventory service failure (10 seconds)');
  inventoryProcessingDelay = 10000; // Effectively dead
  
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Recovery
  console.log('\nPhase 4: System recovery (5 seconds)');
  paymentProcessingDelay = 100;
  inventoryProcessingDelay = 100;
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Stop traffic and monitoring
  clearInterval(normalTraffic);
  flowMonitor.stop();
  
  // Show final metrics
  console.log('\n--- Final Flow Metrics ---');
  const metrics = flowMonitor.getFlowMetrics();
  metrics.forEach((metric, consumer) => {
    console.log(`\n${consumer}:`);
    console.log(`  Lag: ${metric.consumerLag} messages`);
    console.log(`  Processing rate: ${metric.processingRate.toFixed(2)} msg/s`);
    console.log(`  Ack rate: ${(metric.ackRate * 100).toFixed(1)}%`);
    console.log(`  Delivery failures: ${metric.deliveryFailures}`);
  });
  
  // Show detected patterns
  console.log('\n--- Detected Patterns ---');
  const patterns = flowMonitor.getDetectedPatterns();
  patterns.forEach((pattern, key) => {
    console.log(`\n${key}:`);
    console.log(`  Type: ${pattern.type}`);
    console.log(`  Severity: ${pattern.severity}`);
    console.log(`  Confidence: ${(pattern.confidence * 100).toFixed(1)}%`);
    console.log(`  Affected nodes: ${pattern.affectedNodes.join(', ')}`);
  });
  
  console.log('\n✅ Flow Balance demo completed!');
  console.log('\nKey insights:');
  console.log('- Flow Balance detected service issues without any explicit health checks');
  console.log('- Patterns like bottlenecks and failures were identified through message flow');
  console.log('- The system provides early warning before complete failures occur');
  console.log('- Monitoring is completely invisible to application code');
}

// Note: This example is simplified for demonstration
// In production, NATS JetStream would be required
main().catch(error => {
  if (error.message.includes('NATS')) {
    console.error('\n⚠️  This example requires NATS JetStream to be running.');
    console.error('Start NATS with: docker run -p 4222:4222 nats:latest -js\n');
  } else {
    console.error(error);
  }
});