#!/usr/bin/env node
/**
 * Generator-Based Streaming Demo
 * Shows how to use async generators for incremental data processing
 */

import { initializeHappen } from '../src';

async function main() {
  console.log('🌊 Happen Streaming Demo');
  console.log('=========================\n');

  // Initialize Happen
  const happen = initializeHappen();
  console.log('✅ Happen initialized\n');

  // Create nodes
  const dataProcessorNode = happen.createNode('data-processor');
  const importNode = happen.createNode('import-service');
  const monitorNode = happen.createNode('monitor-service');
  const clientNode = happen.createNode('client');

  console.log('✅ Nodes created\n');

  // Demo 1: Large Dataset Processing
  console.log('📊 Demo 1: Large Dataset Processing');
  console.log('------------------------------------');

  // Register streaming handler for batch processing
  dataProcessorNode.on('process-batch', async function* processBatch(event, _context) {
    const { items } = event.payload;
    console.log(`🔄 Processing ${items.length} items in batches...`);
    
    // Process in chunks to avoid memory issues
    for (let i = 0; i < items.length; i += 100) {
      const chunk = items.slice(i, i + 100);
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const processedResults = chunk.map(item => ({
        id: item.id,
        processed: true,
        timestamp: Date.now()
      }));
      
      yield {
        progress: Math.round((i + chunk.length) / items.length * 100),
        processedItems: chunk.length,
        totalProcessed: i + chunk.length,
        results: processedResults
      };
    }
    
    yield { status: 'complete', totalItems: items.length };
  });

  // Test batch processing
  console.log('🚀 Testing batch processing...');
  const batchData = Array.from({ length: 500 }, (_, i) => ({ id: `item-${i}`, value: Math.random() }));
  
  const processingStream = await clientNode.send(dataProcessorNode, {
    type: 'process-batch',
    payload: { items: batchData }
  }).return();

  // Check if result is a generator
  if (processingStream && typeof processingStream[Symbol.asyncIterator] === 'function') {
    console.log('✅ Received streaming response');
    
    for await (const update of processingStream) {
      if (update.progress !== undefined) {
        console.log(`   📈 Progress: ${update.progress}% (${update.totalProcessed}/${batchData.length} items)`);
      } else {
        console.log(`   🎯 Final result: ${update.status} - ${update.totalItems} items processed`);
      }
    }
  } else {
    console.log('❌ Expected streaming response, got:', typeof processingStream);
  }

  console.log('✅ Demo 1 completed\n');

  // Demo 2: Real-time Progress Updates
  console.log('📁 Demo 2: File Import with Progress');
  console.log('------------------------------------');

  // Register streaming handler for file import
  importNode.on('import-file', async function* importFile(event, _context) {
    const { fileName, recordCount } = event.payload;
    console.log(`📂 Importing ${fileName} with ${recordCount} records...`);
    
    let recordsProcessed = 0;
    const batchSize = 50;
    
    // Process file in chunks
    while (recordsProcessed < recordCount) {
      const currentBatch = Math.min(batchSize, recordCount - recordsProcessed);
      
      // Simulate file processing time
      await new Promise(resolve => setTimeout(resolve, 100));
      
      recordsProcessed += currentBatch;
      
      // Yield progress update
      yield {
        progress: Math.round(recordsProcessed / recordCount * 100),
        recordsProcessed,
        totalRecords: recordCount,
        currentBatch: currentBatch,
        status: recordsProcessed < recordCount ? 'processing' : 'finalizing'
      };
    }
    
    // Final processing
    await new Promise(resolve => setTimeout(resolve, 50));
    
    yield { 
      status: 'complete', 
      totalRecords: recordsProcessed,
      importTime: Date.now(),
      fileName 
    };
  });

  // Test file import
  console.log('🚀 Testing file import...');
  const importStream = await clientNode.send(importNode, {
    type: 'import-file',
    payload: { fileName: 'customer-data.csv', recordCount: 1000 }
  }).return();

  if (importStream && typeof importStream[Symbol.asyncIterator] === 'function') {
    console.log('✅ Received streaming import response');
    
    for await (const update of importStream) {
      if (update.progress !== undefined) {
        console.log(`   📊 Import Progress: ${update.progress}% (${update.recordsProcessed}/${update.totalRecords}) - ${update.status}`);
      } else {
        console.log(`   🎯 Import Complete: ${update.fileName} - ${update.totalRecords} records in ${update.importTime}ms`);
      }
    }
  }

  console.log('✅ Demo 2 completed\n');

  // Demo 3: Continuous Data Streams
  console.log('📡 Demo 3: Continuous System Monitoring');
  console.log('---------------------------------------');

  // Register streaming handler for system monitoring
  monitorNode.on('monitor-system', async function* monitorSystem(event, _context) {
    const { duration, interval } = event.payload;
    console.log(`📊 Monitoring system for ${duration}ms every ${interval}ms...`);
    
    const startTime = Date.now();
    const endTime = startTime + duration;
    let sampleCount = 0;
    
    // Monitor until duration expires
    while (Date.now() < endTime) {
      // Simulate collecting system metrics
      await new Promise(resolve => setTimeout(resolve, interval));
      
      sampleCount++;
      const metrics = {
        timestamp: Date.now(),
        cpu: Math.random() * 100,
        memory: Math.random() * 100,
        disk: Math.random() * 100,
        network: Math.random() * 1000
      };
      
      // Emit real-time metrics
      yield {
        sample: sampleCount,
        metrics,
        elapsed: Date.now() - startTime,
        remaining: Math.max(0, endTime - Date.now())
      };
    }
    
    yield { 
      status: 'monitoring-complete', 
      totalSamples: sampleCount,
      duration: Date.now() - startTime 
    };
  });

  // Test system monitoring
  console.log('🚀 Testing system monitoring...');
  const monitoringStream = await clientNode.send(monitorNode, {
    type: 'monitor-system',
    payload: { duration: 2000, interval: 200 }
  }).return();

  if (monitoringStream && typeof monitoringStream[Symbol.asyncIterator] === 'function') {
    console.log('✅ Received streaming monitoring response');
    
    for await (const update of monitoringStream) {
      if (update.metrics) {
        console.log(`   📊 Sample ${update.sample}: CPU=${update.metrics.cpu.toFixed(1)}% MEM=${update.metrics.memory.toFixed(1)}% (${update.remaining}ms remaining)`);
      } else {
        console.log(`   🎯 Monitoring Complete: ${update.totalSamples} samples over ${update.duration}ms`);
      }
    }
  }

  console.log('✅ Demo 3 completed\n');

  // Demo 4: Paginated API Results
  console.log('🌐 Demo 4: Paginated API Fetching');
  console.log('----------------------------------');

  const apiNode = happen.createNode('api-service');

  // Register streaming handler for paginated API
  apiNode.on('fetch-all-records', async function* fetchAllRecords(event, _context) {
    const { endpoint, pageSize = 100 } = event.payload;
    console.log(`🌐 Fetching all records from ${endpoint} (${pageSize} per page)...`);
    
    let page = 1;
    let hasMore = true;
    let totalRecords = 0;
    
    // Fetch pages until complete
    while (hasMore) {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Simulate API response
      const recordsInPage = Math.min(pageSize, Math.max(0, 847 - totalRecords)); // Total of 847 records
      const records = Array.from({ length: recordsInPage }, (_, i) => ({
        id: totalRecords + i + 1,
        name: `Record ${totalRecords + i + 1}`,
        value: Math.random()
      }));
      
      totalRecords += recordsInPage;
      hasMore = totalRecords < 847;
      
      // Yield progress
      yield {
        page,
        records,
        totalRecords,
        hasMore,
        recordsInPage
      };
      
      page++;
      
      // Respect rate limits
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    yield { 
      status: 'fetch-complete', 
      totalRecords, 
      totalPages: page - 1,
      endpoint 
    };
  });

  // Test paginated API
  console.log('🚀 Testing paginated API...');
  const apiStream = await clientNode.send(apiNode, {
    type: 'fetch-all-records',
    payload: { endpoint: '/api/customers', pageSize: 50 }
  }).return();

  if (apiStream && typeof apiStream[Symbol.asyncIterator] === 'function') {
    console.log('✅ Received streaming API response');
    
    for await (const update of apiStream) {
      if (update.records) {
        console.log(`   📄 Page ${update.page}: ${update.recordsInPage} records (Total: ${update.totalRecords}) - More: ${update.hasMore}`);
      } else {
        console.log(`   🎯 Fetch Complete: ${update.totalRecords} records from ${update.totalPages} pages`);
      }
    }
  }

  console.log('✅ Demo 4 completed\n');

  console.log('🎉 All streaming patterns working correctly!');
  console.log('\n🌊 Features demonstrated:');
  console.log('   • Large dataset processing with progress updates');
  console.log('   • Real-time file import with incremental feedback');
  console.log('   • Continuous data streams for monitoring');
  console.log('   • Paginated API results with streaming consumption');
  console.log('   • Memory-efficient processing with async generators');
  console.log('   • Natural backpressure through iterator protocol');
  
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});