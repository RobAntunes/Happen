/**
 * Run All Benchmarks
 *
 * Comprehensive benchmark suite for the Happen framework
 */

import { runEventProcessingBenchmarks } from './event-processing.bench.js';
import { runStateViewsBenchmarks } from './state-views.bench.js';
import { runConfluenceBenchmarks } from './confluence.bench.js';
import { formatResult, formatComparison, type BenchmarkResult } from './framework.js';

// Check if NATS is available
async function isNatsAvailable(): Promise<boolean> {
  try {
    const { NatsConnectionManager } = await import('../src/nats-connection.js');
    const manager = new NatsConnectionManager({ servers: 'localhost:4222' });
    await manager.connect();
    await manager.disconnect();
    return true;
  } catch (error) {
    return false;
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         HAPPEN FRAMEWORK - PERFORMANCE BENCHMARKS            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Check NATS availability
  const natsAvailable = await isNatsAvailable();
  if (!natsAvailable) {
    console.log('⚠️  NATS server not available!');
    console.log('   Start NATS with: docker run --rm -p 4222:4222 -p 8222:8222 nats:latest -js\n');
    process.exit(1);
  }

  console.log('✅ NATS server connected\n');
  console.log('🔧 Node.js version:', process.version);
  console.log('🔧 Platform:', process.platform);
  console.log('🔧 Architecture:', process.arch);

  const allResults: BenchmarkResult[] = [];

  try {
    // Event Processing Benchmarks
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📊 EVENT PROCESSING BENCHMARKS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const eventResults = await runEventProcessingBenchmarks();
    allResults.push(...eventResults);

    // Compare standard vs zero-allocation event processing
    if (eventResults.length >= 2) {
      const standard = eventResults.find(r => r.name === 'Standard Event Processing');
      const zeroAlloc = eventResults.find(r => r.name === 'Zero-Allocation Event Processing');
      if (standard && zeroAlloc) {
        console.log(formatComparison(standard, zeroAlloc));
      }
    }

    // Compare pure buffer write vs standard object creation
    const bufferWrite = eventResults.find(r => r.name === 'Pure Buffer Write (Zero-Allocation)');
    const objCreation = eventResults.find(r => r.name === 'Standard Object Creation');
    if (bufferWrite && objCreation) {
      console.log(formatComparison(objCreation, bufferWrite, 'Pure Buffer Write vs Standard Object Creation'));
    }

    // Compare pure buffer read vs standard object access
    const bufferRead = eventResults.find(r => r.name === 'Pure Buffer Read (Zero-Allocation)');
    const objAccess = eventResults.find(r => r.name === 'Standard Object Access');
    if (bufferRead && objAccess) {
      console.log(formatComparison(objAccess, bufferRead, 'Pure Buffer Read vs Standard Object Access'));
    }

    // Compare JSON serialization vs direct buffer (THE KEY COMPARISON)
    const jsonPath = eventResults.find(r => r.name === 'JSON Serialization (Standard Path)');
    const directBuffer = eventResults.find(r => r.name === 'Zero-Allocation Path (Direct Buffer)');
    if (jsonPath && directBuffer) {
      console.log(formatComparison(jsonPath, directBuffer, 'Zero-Allocation (Direct Buffer) vs JSON Serialization'));
    }

    // State and Views Benchmarks
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📊 STATE & VIEWS BENCHMARKS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const stateResults = await runStateViewsBenchmarks();
    allResults.push(...stateResults);

    // Confluence Benchmarks
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📊 CONFLUENCE BENCHMARKS (Fan-Out/Fan-In)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const confluenceResults = await runConfluenceBenchmarks();
    allResults.push(...confluenceResults);

    // Summary
    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📈 SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Find fastest operations
    const sorted = [...allResults].sort((a, b) => b.throughput - a.throughput);
    console.log('\n🚀 Fastest Operations (by throughput):');
    sorted.slice(0, 5).forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.name}: ${result.throughput.toLocaleString(undefined, { maximumFractionDigits: 0 })} ops/sec`);
    });

    // Find lowest latency operations
    const sortedByLatency = [...allResults].sort((a, b) => a.latency.p50 - b.latency.p50);
    console.log('\n⚡ Lowest Latency Operations (by P50):');
    sortedByLatency.slice(0, 5).forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.name}: ${result.latency.p50.toFixed(3)}ms`);
    });

    // Calculate totals
    const totalOps = allResults.reduce((sum, r) => sum + r.operations, 0);
    const totalDuration = allResults.reduce((sum, r) => sum + r.duration, 0);
    console.log(`\n📊 Total Operations: ${totalOps.toLocaleString()}`);
    console.log(`⏱️  Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);

    console.log('\n✅ All benchmarks completed successfully!\n');

    // Save results to JSON
    const fs = await import('fs/promises');
    const resultsJson = JSON.stringify(allResults, null, 2);
    await fs.writeFile('benchmarks/results.json', resultsJson);
    console.log('💾 Results saved to benchmarks/results.json\n');

  } catch (error) {
    console.error('\n❌ Benchmark error:', error);
    process.exit(1);
  }
}

// Run with --expose-gc for better memory measurements
if (!global.gc) {
  console.log('\n⚠️  Note: Run with --expose-gc flag for accurate memory measurements');
  console.log('   node --expose-gc dist/benchmarks/run-all.js\n');
}

main().catch(console.error);
