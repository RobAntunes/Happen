#!/usr/bin/env node
/**
 * Simple Unified Event Space Demo
 * Shows basic cross-node communication
 */

import { initializeHappen } from '../src';

async function main() {
  console.log('🌊 Happen Unified Event Space Demo');
  console.log('=====================================\n');

  // Initialize Happen 
  const happen = initializeHappen();
  console.log('✅ Happen initialized\n');

  // Create nodes
  const orderService = happen.createNode('order-service');
  const inventoryService = happen.createNode('inventory-service');
  console.log('✅ Nodes created: order-service, inventory-service\n');

  // Set up communication
  console.log('📡 Setting up communication...');
  
  inventoryService.on('check-stock', (event) => {
    console.log(`📦 Inventory: Checking stock for ${JSON.stringify(event)}`);
    
    // Simulate inventory check
    const hasStock = Math.random() > 0.3;
    console.log(`📦 Inventory: Stock check result: ${hasStock ? 'Available' : 'Out of stock'}`);
    
    // Send response back
    inventoryService.send(orderService, {
      type: 'stock-result',
      payload: { hasStock, orderId: 'order-123' }
    });
  });

  orderService.on('stock-result', (event) => {
    console.log(`📋 Order: Received stock result: ${JSON.stringify(event)}`);
  });

  // Demo the communication
  console.log('🚀 Starting communication demo...');
  
  orderService.send(inventoryService, {
    type: 'check-stock',
    payload: { orderId: 'order-123', items: ['widget', 'gadget'] }
  });

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\n✅ Basic communication demo completed!');
  
  // Test global state
  console.log('\n🌍 Testing global state...');
  
  await orderService.global.set('test-key', { value: 'hello from order service' });
  const value = await inventoryService.global.get('test-key');
  console.log(`📦 Inventory read from global state: ${JSON.stringify(value)}`);
  
  console.log('\n✅ Global state demo completed!');
  console.log('\n🎉 Unified Event Space working correctly!');
  
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});