/**
 * Confluence Example - Fan-in and Fan-out Processing
 *
 * This example demonstrates:
 * - Sending events to multiple nodes (fan-out)
 * - Sending multiple events as batches (fan-in)
 * - Array syntax: [node1, node2, node3].on(...)
 * - Collecting results from multiple nodes
 *
 * To run this example:
 * 1. Start NATS: docker run --rm -p 4222:4222 -p 8222:8222 nats:latest -js
 * 2. Build: npm run build
 * 3. Run: node examples/confluence-example.js
 */

import { initializeHappen, createNodeArray } from '../dist/index.js';

const { createNode } = await initializeHappen();

console.log('=== Confluence Example ===\n');

// Create multiple nodes
const orderNode = createNode('order-service');
const inventoryNode = createNode('inventory-service');
const shippingNode = createNode('shipping-service');

// --- Example 1: Fan-out (one event to multiple nodes) ---
console.log('1. Fan-out: Sending to multiple nodes...');

// Create a NodeArray to work with multiple nodes
const serviceNodes = createNodeArray([orderNode, inventoryNode, shippingNode]);

// Register handler on all nodes
// Each node gets context.node to identify itself
serviceNodes.on('service.health-check', (event, context) => {
  const nodeId = context.node?.id;
  console.log(`   ${nodeId} reporting healthy`);
  return { status: 'healthy', node: nodeId };
});

// Send to all nodes and collect results
setTimeout(async () => {
  const result = await serviceNodes.send({
    type: 'service.health-check',
    payload: {}
  });

  const responses = await result.return();
  console.log('   Results from all nodes:', responses);
  console.log('');
}, 500);

// --- Example 2: Fan-in (batch of events to one node) ---
console.log('\n2. Fan-in: Processing batch of events...');

const analyticsNode = createNode('analytics-service');

// Handler can detect if it received a single event or batch
analyticsNode.on('data-point', (eventOrEvents, context) => {
  if (Array.isArray(eventOrEvents)) {
    // Batch processing
    const sum = eventOrEvents.reduce((acc, e) => acc + e.payload.value, 0);
    const avg = sum / eventOrEvents.length;
    console.log(`   Processed batch of ${eventOrEvents.length} events`);
    console.log(`   Sum: ${sum}, Average: ${avg}`);
    return { batch: true, count: eventOrEvents.length, sum, average: avg };
  } else {
    // Single event
    console.log(`   Processed single event: ${eventOrEvents.payload.value}`);
    return { batch: false, value: eventOrEvents.payload.value };
  }
});

setTimeout(async () => {
  // Process batch of events
  const events = [
    { type: 'data-point', payload: { value: 10 } },
    { type: 'data-point', payload: { value: 20 } },
    { type: 'data-point', payload: { value: 30 } },
    { type: 'data-point', payload: { value: 40 } }
  ];

  // Send batch to analytics node
  for (const event of events) {
    await analyticsNode.broadcast(event);
  }

  await new Promise(resolve => setTimeout(resolve, 500));

  console.log('');
}, 1500);

// --- Example 3: Divergent flows ---
console.log('\n3. Divergent flows: Each node follows its own path...');

serviceNodes.on('order.updated', (event, context) => {
  const nodeId = context.node?.id;

  // Each node can follow a different path based on its role
  if (nodeId === 'order-service') {
    console.log('   Order service: Updating order record');
    return { action: 'updated-order-record' };
  } else if (nodeId === 'inventory-service') {
    console.log('   Inventory service: Adjusting stock levels');
    return { action: 'adjusted-inventory' };
  } else if (nodeId === 'shipping-service') {
    console.log('   Shipping service: Recalculating delivery estimate');
    return { action: 'updated-delivery-estimate' };
  }
});

setTimeout(async () => {
  const result = await serviceNodes.send({
    type: 'order.updated',
    payload: { orderId: 'ORD-123', changes: { quantity: 5 } }
  });

  const responses = await result.return();
  console.log('   Different results from each node:', responses);
  console.log('');
}, 2500);

// --- Example 4: Broadcast to all nodes ---
console.log('\n4. Broadcast: Message all nodes...');

serviceNodes.on('system.shutdown', (event, context) => {
  const nodeId = context.node?.id;
  console.log(`   ${nodeId} received shutdown signal`);
  return null;
});

setTimeout(async () => {
  await serviceNodes.broadcast({
    type: 'system.shutdown',
    payload: { reason: 'maintenance', time: Date.now() }
  });

  console.log('\n=== Confluence Example Complete ===');

  // Clean shutdown
  setTimeout(() => process.exit(0), 1000);
}, 3500);
