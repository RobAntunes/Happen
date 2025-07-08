#!/usr/bin/env node
/**
 * Zero-Allocation Processing Demo
 * Shows how to use zero-allocation handlers for performance-critical paths
 */

import { initializeHappen, ZeroAllocationContext } from '../src';
import { createZeroAllocationExtension } from '../src/zero-allocation';

async function main() {
  console.log('⚡ Happen Zero-Allocation Processing Demo');
  console.log('==========================================\n');

  // Initialize Happen
  const happen = initializeHappen();
  const performanceExt = createZeroAllocationExtension();

  console.log('✅ Happen initialized\n');

  // Demo 1: High-frequency sensor data processing
  console.log('🔥 Demo 1: High-Frequency Sensor Processing');
  console.log('-------------------------------------------');

  const sensorNode = happen.createNode('sensor-processor');
  const analyticsNode = happen.createNode('analytics');

  // Register zero-allocation handler for sensor data
  sensorNode.zero('sensor.reading', (context) => {
    // Access buffer directly - no object allocations
    context.buffer.reset();
    
    // Skip event metadata
    context.buffer.getString(); // id
    context.buffer.getString(); // type
    context.buffer.getFloat64(); // timestamp
    
    // Read payload fields
    const fieldCount = context.buffer.getInt32();
    
    let temperature = 0;
    let pressure = 0;
    let humidity = 0;
    
    for (let i = 0; i < fieldCount; i++) {
      const key = context.buffer.getString();
      const type = context.buffer.getInt32();
      
      if (type === 1) { // number type
        const value = context.buffer.getFloat64();
        
        // Direct field access without object property lookup
        switch (key) {
          case 'temperature':
            temperature = value;
            break;
          case 'pressure':
            pressure = value;
            break;
          case 'humidity':
            humidity = value;
            break;
        }
      }
    }
    
    // Process sensor data without allocations
    if (temperature > 30) {
      // Emit alert using pre-allocated event
      analyticsNode.emit({
        type: 'temperature.alert',
        payload: { value: temperature }
      });
    }
    
    // Release buffer back to pool
    context.done();
  });

  console.log('✅ Zero-allocation sensor handler registered\n');

  // Demo 2: Compare performance
  console.log('📊 Demo 2: Performance Comparison');
  console.log('---------------------------------');

  // Regular handler for comparison
  let regularProcessed = 0;
  sensorNode.on('sensor.regular', (event) => {
    const { temperature, pressure, humidity } = event.payload as any;
    
    if (temperature > 30) {
      analyticsNode.emit({
        type: 'temperature.alert',
        payload: { value: temperature }
      });
    }
    
    regularProcessed++;
  });

  // Generate test data
  const iterations = 10000;
  console.log(`Processing ${iterations} sensor readings...\n`);

  // Measure regular handler
  const regularTime = await performanceExt.measureAsync('regular-processing', async () => {
    for (let i = 0; i < iterations; i++) {
      sensorNode.emit({
        type: 'sensor.regular',
        payload: {
          temperature: 20 + Math.random() * 20,
          pressure: 1000 + Math.random() * 50,
          humidity: 40 + Math.random() * 40,
          timestamp: Date.now(),
          sensorId: 'sensor-01',
        }
      });
    }
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  let zeroAllocProcessed = 0;
  
  // Count zero-alloc processing
  const originalHandler = sensorNode.zero('sensor.reading', (context) => {
    zeroAllocProcessed++;
    context.done();
  });

  // Measure zero-allocation handler
  const zeroAllocTime = await performanceExt.measureAsync('zero-alloc-processing', async () => {
    for (let i = 0; i < iterations; i++) {
      sensorNode.emit({
        type: 'sensor.reading',
        payload: {
          temperature: 20 + Math.random() * 20,
          pressure: 1000 + Math.random() * 50,
          humidity: 40 + Math.random() * 40,
          timestamp: Date.now(),
          sensorId: 'sensor-01',
        }
      });
    }
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  // Show performance comparison
  const summary = performanceExt.monitor.getSummary();
  console.log('Performance Results:');
  console.log('-------------------');
  console.log(`Regular Handler:`);
  console.log(`  Processed: ${regularProcessed} events`);
  console.log(`  Total Time: ${summary['regular-processing'].totalTime.toFixed(2)}ms`);
  console.log(`  Avg Time: ${summary['regular-processing'].avgTime.toFixed(4)}ms per batch`);
  console.log(`  Events/sec: ${(iterations / (summary['regular-processing'].totalTime / 1000)).toFixed(0)}`);
  
  console.log(`\nZero-Allocation Handler:`);
  console.log(`  Processed: ${zeroAllocProcessed} events`);
  console.log(`  Total Time: ${summary['zero-alloc-processing'].totalTime.toFixed(2)}ms`);
  console.log(`  Avg Time: ${summary['zero-alloc-processing'].avgTime.toFixed(4)}ms per batch`);
  console.log(`  Events/sec: ${(iterations / (summary['zero-alloc-processing'].totalTime / 1000)).toFixed(0)}`);
  
  const improvement = ((summary['regular-processing'].totalTime - summary['zero-alloc-processing'].totalTime) 
    / summary['regular-processing'].totalTime * 100);
  console.log(`\n⚡ Performance Improvement: ${improvement.toFixed(1)}%\n`);

  // Demo 3: Buffer pool statistics
  console.log('🏊 Demo 3: Buffer Pool Management');
  console.log('---------------------------------');

  const processor = performanceExt.processor;
  const stats = processor.getStats();
  
  console.log('Buffer Pool Stats:');
  console.log(`  Total Buffers: ${stats.bufferPool.total}`);
  console.log(`  Available: ${stats.bufferPool.available}`);
  console.log(`  In Use: ${stats.bufferPool.used}`);
  
  console.log('\nString Table Stats:');
  console.log(`  Interned Strings: ${stats.stringTable.size}`);
  
  console.log('\nHandler Stats:');
  console.log(`  Registered Patterns: ${stats.handlers.patterns}`);
  console.log(`  Total Handlers: ${stats.handlers.total}\n`);

  // Demo 4: Real-world example - Order Processing
  console.log('💰 Demo 4: High-Volume Order Processing');
  console.log('---------------------------------------');

  const orderNode = happen.createNode('order-processor');
  const inventoryNode = happen.createNode('inventory');
  const billingNode = happen.createNode('billing');

  // Track processing metrics
  let ordersProcessed = 0;
  let inventoryChecks = 0;
  let billingRequests = 0;

  // Zero-allocation order handler
  orderNode.zero('order.new', (context) => {
    context.buffer.reset();
    
    // Skip metadata
    context.buffer.getString(); // id
    context.buffer.getString(); // type
    context.buffer.getFloat64(); // timestamp
    
    // Read order data
    const fieldCount = context.buffer.getInt32();
    
    let orderId = '';
    let customerId = '';
    let amount = 0;
    let quantity = 0;
    
    for (let i = 0; i < fieldCount; i++) {
      const key = context.buffer.getString();
      const type = context.buffer.getInt32();
      
      switch (type) {
        case 0: // string
          const strValue = context.buffer.getString();
          if (key === 'orderId') orderId = strValue;
          else if (key === 'customerId') customerId = strValue;
          break;
        case 1: // number
          const numValue = context.buffer.getFloat64();
          if (key === 'amount') amount = numValue;
          else if (key === 'quantity') quantity = numValue;
          break;
      }
    }
    
    ordersProcessed++;
    
    // Process order logic (simplified)
    if (quantity > 0 && amount > 0) {
      // These would normally trigger other zero-alloc handlers
      inventoryChecks++;
      billingRequests++;
    }
    
    context.done();
  });

  console.log('Processing 50,000 orders...\n');

  // Simulate high-volume order processing
  await performanceExt.measureAsync('order-processing', async () => {
    for (let i = 0; i < 50000; i++) {
      orderNode.emit({
        type: 'order.new',
        payload: {
          orderId: `ORDER-${i}`,
          customerId: `CUST-${Math.floor(i / 10)}`,
          amount: 10 + Math.random() * 990,
          quantity: 1 + Math.floor(Math.random() * 10),
          timestamp: Date.now(),
        }
      });
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  const orderStats = performanceExt.monitor.getSummary()['order-processing'];
  console.log('Order Processing Results:');
  console.log(`  Orders Processed: ${ordersProcessed}`);
  console.log(`  Inventory Checks: ${inventoryChecks}`);
  console.log(`  Billing Requests: ${billingRequests}`);
  console.log(`  Total Time: ${orderStats.totalTime.toFixed(2)}ms`);
  console.log(`  Orders/sec: ${(50000 / (orderStats.totalTime / 1000)).toFixed(0)}\n`);

  // Demo 5: Memory pressure comparison
  console.log('💾 Demo 5: Memory Pressure Test');
  console.log('-------------------------------');

  console.log('Monitoring memory usage during high-frequency events...\n');

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  const memBefore = process.memoryUsage();
  
  // High-frequency event generation
  const memTestNode = happen.createNode('memory-test');
  let memTestProcessed = 0;

  memTestNode.zero('mem.test', (context) => {
    memTestProcessed++;
    context.done();
  });

  // Generate many events rapidly
  for (let i = 0; i < 100000; i++) {
    memTestNode.emit({
      type: 'mem.test',
      payload: {
        index: i,
        data: 'x'.repeat(100), // 100 char string
        values: [1, 2, 3, 4, 5],
      }
    });
  }

  await new Promise(resolve => setTimeout(resolve, 500));

  const memAfter = process.memoryUsage();
  
  console.log('Memory Usage:');
  console.log(`  Heap Used Before: ${(memBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Heap Used After: ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Heap Increase: ${((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Events Processed: ${memTestProcessed}\n`);

  // Cleanup
  console.log('🧹 Cleaning up...');
  processor.clearStringTable();
  console.log('String table cleared\n');

  console.log('🎉 Zero-Allocation Demo Complete!');
  console.log('\n⚡ Key Benefits:');
  console.log('   • Minimal object allocations in hot paths');
  console.log('   • Pre-allocated buffer pools');
  console.log('   • String interning for repeated values');
  console.log('   • Direct memory access patterns');
  console.log('   • Reduced GC pressure');
  console.log('   • Higher throughput for critical paths');
  console.log('\n💡 Use zero-allocation handlers for:');
  console.log('   • High-frequency sensor data');
  console.log('   • Financial market data feeds');
  console.log('   • Game engine events');
  console.log('   • IoT telemetry');
  console.log('   • Real-time analytics');
  
  process.exit(0);
}

// Note: Run with --expose-gc for memory pressure test
main().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});