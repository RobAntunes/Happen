#!/usr/bin/env ts-node
/**
 * NATS Transport Performance Benchmarks
 * Measures distributed messaging performance
 * 
 * Requires NATS server: docker run -p 4222:4222 nats:latest -js
 */

import { initializeHappen } from '../src';

interface DistributedBenchmarkResult {
  name: string;
  operations: number;
  duration: number;
  opsPerSecond: number;
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
}

class LatencyTracker {
  private latencies: number[] = [];
  
  record(latency: number) {
    this.latencies.push(latency);
  }
  
  getPercentile(percentile: number): number {
    if (this.latencies.length === 0) return 0;
    
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
  
  getAverage(): number {
    if (this.latencies.length === 0) return 0;
    const sum = this.latencies.reduce((a, b) => a + b, 0);
    return sum / this.latencies.length;
  }
  
  reset() {
    this.latencies = [];
  }
}

async function distributedBenchmark(
  name: string,
  setup: () => Promise<{ fn: () => Promise<void>, cleanup?: () => Promise<void> }>,
  operations: number
): Promise<DistributedBenchmarkResult> {
  const { fn, cleanup } = await setup();
  const tracker = new LatencyTracker();
  
  // Warmup
  for (let i = 0; i < 100; i++) {
    await fn();
  }
  
  // Actual benchmark with individual latency tracking
  const start = process.hrtime.bigint();
  for (let i = 0; i < operations; i++) {
    const opStart = process.hrtime.bigint();
    await fn();
    const opEnd = process.hrtime.bigint();
    const opLatency = Number(opEnd - opStart) / 1_000_000; // ms
    tracker.record(opLatency);
  }
  const end = process.hrtime.bigint();
  
  const duration = Number(end - start) / 1_000_000; // ms
  const opsPerSecond = (operations / duration) * 1000;
  
  if (cleanup) {
    await cleanup();
  }
  
  return {
    name,
    operations,
    duration,
    opsPerSecond,
    avgLatency: tracker.getAverage(),
    p95Latency: tracker.getPercentile(95),
    p99Latency: tracker.getPercentile(99)
  };
}

async function runNatsBenchmarks() {
  console.log('=== Happen NATS Transport Benchmarks ===\n');
  
  try {
    // Initialize with NATS transport
    const happen = initializeHappen({
      transport: {
        type: 'nats',
        options: {
          servers: ['nats://localhost:4222'],
          reconnectTimeWait: 100,
          maxReconnectAttempts: 3
        }
      }
    });
    
    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('✅ Connected to NATS server\n');
    
    const results: DistributedBenchmarkResult[] = [];
    
    // Benchmark 1: Distributed Pub/Sub
    const pubSubResult = await distributedBenchmark(
      'Distributed Pub/Sub',
      async () => {
        const publisher = happen.createNode('publisher');
        const subscriber = happen.createNode('subscriber');
        
        let received = 0;
        subscriber.on('benchmark.pubsub', () => {
          received++;
        });
        
        // Wait for subscription to be ready
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return {
          fn: async () => {
            await publisher.send(subscriber, {
              type: 'benchmark.pubsub',
              payload: { timestamp: Date.now() }
            });
          }
        };
      },
      5000
    );
    results.push(pubSubResult);
    
    // Benchmark 2: Request/Reply Pattern
    const reqReplyResult = await distributedBenchmark(
      'Request/Reply Pattern',
      async () => {
        const client = happen.createNode('client');
        const server = happen.createNode('server');
        
        server.on('benchmark.request', (event) => {
          return {
            echo: event.payload,
            processedAt: Date.now()
          };
        });
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return {
          fn: async () => {
            await client.send(server, {
              type: 'benchmark.request',
              payload: { id: Date.now() }
            }).return();
          }
        };
      },
      2000
    );
    results.push(reqReplyResult);
    
    // Benchmark 3: Fan-out Pattern
    const fanOutResult = await distributedBenchmark(
      'Fan-out (5 subscribers)',
      async () => {
        const publisher = happen.createNode('fanout-publisher');
        const subscribers = [];
        
        for (let i = 0; i < 5; i++) {
          const sub = happen.createNode(`fanout-sub-${i}`);
          sub.on('benchmark.fanout', () => {});
          subscribers.push(sub);
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
        return {
          fn: async () => {
            await publisher.broadcast({
              type: 'benchmark.fanout',
              payload: { timestamp: Date.now() }
            });
          }
        };
      },
      2000
    );
    results.push(fanOutResult);
    
    // Benchmark 4: Large Payload
    const largePayloadResult = await distributedBenchmark(
      'Large Payload (10KB)',
      async () => {
        const sender = happen.createNode('large-sender');
        const receiver = happen.createNode('large-receiver');
        
        receiver.on('benchmark.large', (event) => {
          return { received: event.payload.data.length };
        });
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const largeData = 'x'.repeat(10 * 1024); // 10KB
        
        return {
          fn: async () => {
            await sender.send(receiver, {
              type: 'benchmark.large',
              payload: { data: largeData }
            }).return();
          }
        };
      },
      1000
    );
    results.push(largePayloadResult);
    
    // Benchmark 5: Concurrent Operations
    const concurrentResult = await distributedBenchmark(
      'Concurrent Requests (10x)',
      async () => {
        const client = happen.createNode('concurrent-client');
        const server = happen.createNode('concurrent-server');
        
        server.on('benchmark.concurrent', async (event) => {
          // Simulate some work
          await new Promise(resolve => setTimeout(resolve, 1));
          return { processed: event.payload.id };
        });
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return {
          fn: async () => {
            const promises = [];
            for (let i = 0; i < 10; i++) {
              promises.push(
                client.send(server, {
                  type: 'benchmark.concurrent',
                  payload: { id: i }
                }).return()
              );
            }
            await Promise.all(promises);
          }
        };
      },
      500
    );
    results.push(concurrentResult);
    
    // Print results
    console.log('\n=== Benchmark Results ===\n');
    console.log('Operation                | Ops/sec | Avg (ms) | P95 (ms) | P99 (ms) | Total');
    console.log('-------------------------|---------|----------|----------|----------|--------');
    
    results.forEach(result => {
      const name = result.name.padEnd(24);
      const opsPerSec = result.opsPerSecond.toFixed(0).padStart(7);
      const avgLatency = result.avgLatency.toFixed(2).padStart(8);
      const p95Latency = result.p95Latency.toFixed(2).padStart(8);
      const p99Latency = result.p99Latency.toFixed(2).padStart(8);
      const totalTime = `${(result.duration / 1000).toFixed(1)}s`.padStart(6);
      
      console.log(`${name} | ${opsPerSec} | ${avgLatency} | ${p95Latency} | ${p99Latency} | ${totalTime}`);
    });
    
    // Network statistics
    console.log('\n=== Network Performance ===');
    const pubSubOps = results.find(r => r.name === 'Distributed Pub/Sub')!;
    const reqReplyOps = results.find(r => r.name === 'Request/Reply Pattern')!;
    
    console.log(`Message Throughput: ${pubSubOps.opsPerSecond.toFixed(0)} msg/sec`);
    console.log(`Request/Reply RTT: ${reqReplyOps.avgLatency.toFixed(2)}ms average`);
    console.log(`P99 Latency: ${reqReplyOps.p99Latency.toFixed(2)}ms`);
    
    // Calculate approximate bandwidth
    const largePayloadOps = results.find(r => r.name === 'Large Payload (10KB)')!;
    const bandwidth = (largePayloadOps.opsPerSecond * 10 * 1024) / (1024 * 1024); // MB/s
    console.log(`Bandwidth (10KB msgs): ${bandwidth.toFixed(2)} MB/s`);
    
    console.log('\n✅ All NATS benchmarks completed successfully');
    
  } catch (error) {
    console.error('\n❌ Benchmark failed:', error.message);
    console.error('\n⚠️  Make sure NATS server is running:');
    console.error('   docker run -p 4222:4222 nats:latest -js\n');
  }
}

// Run benchmarks
runNatsBenchmarks().catch(console.error);