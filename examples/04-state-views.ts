#!/usr/bin/env ts-node
/**
 * State Management and Views
 * Shows how to use views for cross-node state sharing
 * and the collect() pattern for aggregating responses
 */

import { initializeHappen } from '../src';

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
}

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

interface Cart {
  userId: string;
  items: CartItem[];
  totalAmount: number;
}

interface ProductStats {
  addedToCart: number;
}

async function main() {
  const happen = initializeHappen();
  
  // Create a distributed shopping cart system
  const cartService = happen.createNode('cart-service');
  const inventoryService = happen.createNode('inventory-service');
  const analyticsService = happen.createNode('analytics-service');
  
  // Create views for shared state
  const cartView = happen.views.create<Cart>('shopping-carts');
  const productView = happen.views.create<Product>('products');
  const analyticsView = happen.views.create<ProductStats>('analytics');
  
  // Initialize product catalog
  productView.set('product-001', {
    id: 'product-001',
    name: 'Laptop',
    price: 999.99,
    category: 'Electronics'
  });
  
  productView.set('product-002', {
    id: 'product-002',
    name: 'Mouse',
    price: 29.99,
    category: 'Accessories'
  });
  
  productView.set('product-003', {
    id: 'product-003',
    name: 'Keyboard',
    price: 79.99,
    category: 'Accessories'
  });
  
  // Cart service manages shopping carts
  cartService.on('add-to-cart', (event) => {
    const { userId, productId, quantity } = event.payload as { userId: string; productId: string; quantity: number };
    
    // Get or create cart
    const cartKey = `cart-${userId}`;
    const cart = cartView.get(cartKey) || {
      userId,
      items: [],
      totalAmount: 0
    };
    
    // Get product info from shared view
    const product = productView.get(productId);
    if (!product) {
      return { success: false, error: 'Product not found' };
    }
    
    // Add item to cart
    const existingItem = cart.items.find((item: CartItem) => item.productId === productId);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.items.push({
        productId,
        name: product.name,
        price: product.price,
        quantity
      });
    }
    
    // Update total
    cart.totalAmount = cart.items.reduce((sum: number, item: CartItem) => sum + (item.price * item.quantity), 0);
    
    // Save cart to view
    cartView.set(cartKey, cart);
    
    // Update analytics
    const analyticsKey = `product-${productId}-stats`;
    const stats = analyticsView.get(analyticsKey) || { addedToCart: 0 };
    stats.addedToCart += quantity;
    analyticsView.set(analyticsKey, stats);
    
    console.log(`Added ${quantity}x ${product.name} to cart for user ${userId}`);
    console.log(`Cart total: $${cart.totalAmount.toFixed(2)}`);
    
    return { success: true, cart };
  });
  
  // Analytics service can access views from any node
  analyticsService.on('get-popular-products', () => {
    const allStats: { productId: string; name: string; addedToCart: number }[] = [];
    
    // Iterate through all products and their analytics
    productView.keys().forEach(productId => {
      const product = productView.get(productId);
      const statsKey = `product-${productId}-stats`;
      const stats = analyticsView.get(statsKey) || { addedToCart: 0 };
      
      allStats.push({
        productId,
        name: product.name,
        addedToCart: stats.addedToCart
      });
    });
    
    // Sort by popularity
    allStats.sort((a, b) => b.addedToCart - a.addedToCart);
    
    return { popularProducts: allStats };
  });
  
  // Use collect() pattern to get inventory from multiple sources
  inventoryService.on('check-availability', async (event) => {
    const { productIds } = event.payload as { productIds: string[] };
    
    // Simulate checking multiple warehouses using views.collect()
    const warehouseNodes = [
      happen.createNode('warehouse-east'),
      happen.createNode('warehouse-west'),
      happen.createNode('warehouse-central')
    ];
    
    // Set up warehouse responses
    warehouseNodes.forEach((warehouse, index) => {
      warehouse.on('get-stock', (event) => {
        const { productId } = event.payload;
        // Simulate different stock levels
        const stock = (index + 1) * 10;
        return { 
          warehouse: warehouse.id, 
          productId, 
          stock 
        };
      });
    });
    
    // Collect responses from all warehouses
    const availabilityResults = await happen.views.collect(
      warehouseNodes,
      async (warehouse) => {
        const results: Record<string, any> = {};
        for (const productId of productIds) {
          const response = await inventoryService.send(warehouse, {
            type: 'get-stock',
            payload: { productId }
          }).return();
          results[productId] = response;
        }
        return results;
      }
    );
    
    // Aggregate results
    const totalAvailability: Record<string, number> = {};
    productIds.forEach(productId => {
      totalAvailability[productId] = availabilityResults.reduce((sum: number, warehouseData: any) => {
        return sum + (warehouseData[productId]?.stock || 0);
      }, 0);
    });
    
    return { availability: totalAvailability };
  });
  
  // Test the system
  console.log('=== Shopping Cart System Demo ===\n');
  
  // Add items to cart
  await cartService.emit({
    type: 'add-to-cart',
    payload: { userId: 'user-123', productId: 'product-001', quantity: 1 }
  });
  
  await cartService.emit({
    type: 'add-to-cart',
    payload: { userId: 'user-123', productId: 'product-002', quantity: 2 }
  });
  
  await cartService.emit({
    type: 'add-to-cart',
    payload: { userId: 'user-456', productId: 'product-001', quantity: 1 }
  });
  
  await cartService.emit({
    type: 'add-to-cart',
    payload: { userId: 'user-456', productId: 'product-003', quantity: 1 }
  });
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\n--- Cart Contents ---');
  console.log('User 123:', JSON.stringify(cartView.get('cart-user-123'), null, 2));
  console.log('User 456:', JSON.stringify(cartView.get('cart-user-456'), null, 2));
  
  // Get popular products
  console.log('\n--- Popular Products ---');
  const popularResponse = await analyticsService.send(analyticsService, {
    type: 'get-popular-products',
    payload: {}
  }).return();
  console.log(popularResponse.popularProducts);
  
  // Check inventory
  console.log('\n--- Inventory Check ---');
  const inventoryResponse = await inventoryService.send(inventoryService, {
    type: 'check-availability',
    payload: { productIds: ['product-001', 'product-002', 'product-003'] }
  }).return();
  console.log('Total availability:', inventoryResponse.availability);
}

main().catch(console.error);