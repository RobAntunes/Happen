#!/usr/bin/env node
/**
 * Unified Event Space Demo
 * Demonstrates seamless cross-boundary communication with the same API
 */

import { initializeHappen } from '../src';
import { performance } from 'perf_hooks';

// Demo configuration
const DEMO_CONFIG = {
  nats: {
    server: {
      servers: ['nats://localhost:4222'],
      jetstream: true,
    }
  },
  enableNATS: process.env.ENABLE_NATS === 'true',
};

async function main() {
  console.log('🌊 Happen Unified Event Space Demo');
  console.log('=====================================\n');

  // Initialize Happen with optional NATS backend
  const happen = DEMO_CONFIG.enableNATS 
    ? initializeHappen(DEMO_CONFIG)
    : initializeHappen();
    
  if (DEMO_CONFIG.enableNATS) {
    console.log('🔗 Using NATS backend for distributed communication');
  } else {
    console.log('🏠 Using in-memory backend for local demonstration');
  }

  console.log('\n📡 Creating nodes...');
  
  // Create nodes that will communicate
  const orderService = happen.createNode('order-service');
  const inventoryService = happen.createNode('inventory-service');
  const paymentService = happen.createNode('payment-service');
  const customerService = happen.createNode('customer-service');

  console.log('✅ Nodes created: order-service, inventory-service, payment-service, customer-service\n');

  // Demo 1: Basic Cross-Node Communication
  console.log('🎯 Demo 1: Basic Cross-Node Communication');
  console.log('------------------------------------------');

  inventoryService.on('check-inventory', (event) => {
    console.log(`📦 Inventory: Checking stock for order ${event.payload.orderId}`);
    
    // Simulate inventory check
    const hasStock = Math.random() > 0.3;
    
    inventoryService.send(orderService, {
      type: 'inventory-result',
      payload: {
        orderId: event.payload.orderId,
        hasStock,
        items: event.payload.items.map((item: any) => ({
          ...item,
          available: hasStock
        }))
      }
    });
  });

  let inventoryResult: any = null;
  orderService.on('inventory-result', (event) => {
    inventoryResult = event.payload;
    console.log(`📋 Order: Received inventory result for order ${event.payload.orderId}`, 
                event.payload.hasStock ? '✅ In stock' : '❌ Out of stock');
  });

  // Start the demo
  console.log('🚀 Sending inventory check...');
  orderService.send(inventoryService, {
    type: 'check-inventory',
    payload: {
      orderId: 'order-123',
      items: [
        { id: 'item-1', name: 'Widget', quantity: 2 },
        { id: 'item-2', name: 'Gadget', quantity: 1 }
      ]
    }
  });

  await new Promise(resolve => setTimeout(resolve, 500));
  console.log('✅ Demo 1 completed\n');

  // Demo 2: Causality Preservation
  console.log('🔗 Demo 2: Causality Preservation');
  console.log('----------------------------------');

  let eventChain: any[] = [];

  orderService.on('process-order', (event) => {
    console.log(`📋 Order: Processing order ${event.payload.orderId}`);
    eventChain.push({ service: 'order', eventId: event.context.id });
    
    // Check inventory first
    orderService.send(inventoryService, {
      type: 'reserve-inventory',
      payload: event.payload
    });
  });

  inventoryService.on('reserve-inventory', (event) => {
    console.log(`📦 Inventory: Reserving stock for order ${event.payload.orderId}`);
    eventChain.push({ 
      service: 'inventory', 
      eventId: event.context.id,
      causedBy: event.context.causationId 
    });
    
    // Forward to payment
    inventoryService.send(paymentService, {
      type: 'process-payment',
      payload: { ...event.payload, reserved: true }
    });
  });

  paymentService.on('process-payment', (event) => {
    console.log(`💳 Payment: Processing payment for order ${event.payload.orderId}`);
    eventChain.push({ 
      service: 'payment', 
      eventId: event.context.id,
      causedBy: event.context.causationId 
    });
    
    // Notify customer
    paymentService.send(customerService, {
      type: 'notify-customer',
      payload: { ...event.payload, paymentStatus: 'completed' }
    });
  });

  customerService.on('notify-customer', (event) => {
    console.log(`👤 Customer: Notifying customer about order ${event.payload.orderId}`);
    eventChain.push({ 
      service: 'customer', 
      eventId: event.context.id,
      causedBy: event.context.causationId 
    });
  });

  // Start the causality chain
  console.log('🚀 Starting order processing chain...');
  orderService.send(orderService, {
    type: 'process-order',
    payload: {
      orderId: 'order-456',
      customerId: 'customer-789',
      items: [{ id: 'item-1', name: 'Widget', quantity: 1 }],
      total: 99.99
    }
  });

  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('📊 Causality chain:');
  eventChain.forEach((event, index) => {
    console.log(`  ${index + 1}. ${event.service} (${event.eventId.substring(0, 8)}...)` +
                (event.causedBy ? ` ← caused by ${event.causedBy.substring(0, 8)}...` : ''));
  });
  console.log('✅ Demo 2 completed\n');

  // Demo 3: Global State Synchronization
  console.log('🌍 Demo 3: Global State Synchronization');
  console.log('----------------------------------------');

  // Set up state watchers
  let stateUpdates: any[] = [];
  
  const unwatch1 = orderService.global.watch('order-stats', (value) => {
    if (value) {
      stateUpdates.push({ service: 'order', value });
      console.log(`📋 Order service sees stats:`, value);
    }
  });

  const unwatch2 = inventoryService.global.watch('order-stats', (value) => {
    if (value) {
      stateUpdates.push({ service: 'inventory', value });
      console.log(`📦 Inventory service sees stats:`, value);
    }
  });

  await new Promise(resolve => setTimeout(resolve, 200));

  // Update global state from different nodes
  console.log('🚀 Updating global state...');
  
  await orderService.global.set('order-stats', { 
    totalOrders: 1, 
    pendingOrders: 1,
    updatedBy: 'order-service' 
  });

  await new Promise(resolve => setTimeout(resolve, 200));

  await inventoryService.global.set('order-stats', { 
    totalOrders: 2, 
    pendingOrders: 1,
    completedOrders: 1,
    updatedBy: 'inventory-service' 
  });

  await new Promise(resolve => setTimeout(resolve, 200));

  console.log(`📊 Total state updates seen: ${stateUpdates.length}`);
  console.log('✅ Demo 3 completed\n');

  // Demo 4: Performance Benchmarks
  console.log('⚡ Demo 4: Performance Benchmarks');
  console.log('----------------------------------');

  // Latency test
  console.log('🏃 Testing latency...');
  const latencies: number[] = [];
  
  paymentService.on('ping', (event) => {
    const latency = performance.now() - event.payload.timestamp;
    latencies.push(latency);
    
    paymentService.send(orderService, {
      type: 'pong',
      payload: { latency }
    });
  });

  let pongCount = 0;
  orderService.on('pong', () => {
    pongCount++;
  });

  // Send 100 ping messages
  for (let i = 0; i < 100; i++) {
    orderService.send(paymentService, {
      type: 'ping',
      payload: { timestamp: performance.now() }
    });
  }

  await new Promise(resolve => setTimeout(resolve, 1000));

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`📊 Average latency: ${avgLatency.toFixed(3)}ms`);
  console.log(`📊 Received pongs: ${pongCount}/100`);

  // Throughput test
  console.log('🚀 Testing throughput...');
  let throughputCount = 0;
  
  inventoryService.on('throughput-test', () => {
    throughputCount++;
  });

  const startTime = performance.now();
  const messageCount = 1000;
  
  for (let i = 0; i < messageCount; i++) {
    orderService.send(inventoryService, {
      type: 'throughput-test',
      payload: { index: i }
    });
  }

  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const endTime = performance.now();
  const duration = endTime - startTime;
  const throughput = throughputCount / (duration / 1000);
  
  console.log(`📊 Processed ${throughputCount}/${messageCount} messages in ${duration.toFixed(2)}ms`);
  console.log(`📊 Throughput: ${throughput.toFixed(0)} messages/second`);
  console.log('✅ Demo 4 completed\n');

  // Demo 5: Large Payload Handling
  console.log('📦 Demo 5: Large Payload Handling');
  console.log('----------------------------------');

  const largeDataKey = `large-dataset-${Date.now()}`;
  const largeData = new Array(10000).fill(0).map((_, i) => ({
    id: i,
    name: `Item ${i}`,
    data: new Array(100).fill(i).join('')
  }));

  console.log(`🚀 Storing large dataset (${largeData.length} items)...`);
  await orderService.global.set(largeDataKey, largeData);

  customerService.on('process-large-data', async (event) => {
    console.log(`👤 Customer: Received reference to large data: ${event.payload.dataKey}`);
    
    const data = await customerService.global.get(event.payload.dataKey);
    console.log(`👤 Customer: Retrieved ${data.length} items from global store`);
    console.log(`👤 Customer: First item: ${data[0].name}`);
    console.log(`👤 Customer: Last item: ${data[data.length - 1].name}`);
  });

  // Send reference instead of actual data
  console.log('🚀 Sending data reference...');
  orderService.send(customerService, {
    type: 'process-large-data',
    payload: { dataKey: largeDataKey }
  });

  await new Promise(resolve => setTimeout(resolve, 500));
  console.log('✅ Demo 5 completed\n');

  // Cleanup
  console.log('🧹 Cleaning up...');
  unwatch1();
  unwatch2();
  
  await Promise.all([
    orderService.disconnect(),
    inventoryService.disconnect(),
    paymentService.disconnect(),
    customerService.disconnect()
  ]);

  console.log('✅ Demo completed successfully!');
  console.log('\n🎉 Unified Event Space demonstrates:');
  console.log('   • Same API for local and distributed communication');
  console.log('   • Automatic causality preservation');
  console.log('   • Global state synchronization');
  console.log('   • Sub-millisecond local performance');
  console.log('   • Efficient large payload handling');
  console.log('   • Transparent serialization');
  
  process.exit(0);
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
  process.exit(1);
});

// Run the demo
main().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});