#!/usr/bin/env ts-node
/**
 * Request-Response Pattern
 * Shows how to use send().return() for request-response communication
 */

import { initializeHappen } from '../src';

async function main() {
  const happen = initializeHappen();
  
  // Create service nodes
  const apiGateway = happen.createNode('api-gateway');
  const orderService = happen.createNode('order-service');
  const inventoryService = happen.createNode('inventory-service');
  
  // Order service checks inventory before confirming order
  orderService.on('create-order', async (event) => {
    const { productId, quantity } = event.payload as { productId: string; quantity: number };
    
    // Check inventory using request-response
    const inventory = await orderService.send(inventoryService, {
      type: 'check-inventory',
      payload: { productId, quantity }
    }).return();
    
    if (inventory.available >= quantity) {
      return {
        success: true,
        orderId: `order-${Date.now()}`,
        message: 'Order created successfully'
      };
    } else {
      return {
        success: false,
        message: `Only ${inventory.available} items available`
      };
    }
  });
  
  // Inventory service responds with stock information
  inventoryService.on('check-inventory', (event) => {
    const { productId } = event.payload as { productId: string };
    
    // Simulate inventory lookup
    const inventory: Record<string, number> = {
      'product-123': 10,
      'product-456': 0,
      'product-789': 5
    };
    
    return {
      productId,
      available: inventory[productId] || 0
    };
  });
  
  // API Gateway makes requests
  console.log('Creating order for available product...');
  const result1 = await apiGateway.send(orderService, {
    type: 'create-order',
    payload: { productId: 'product-123', quantity: 3 }
  }).return();
  console.log('Result:', result1);
  
  console.log('\nCreating order for out-of-stock product...');
  const result2 = await apiGateway.send(orderService, {
    type: 'create-order',
    payload: { productId: 'product-456', quantity: 1 }
  }).return();
  console.log('Result:', result2);
}

main().catch(console.error);