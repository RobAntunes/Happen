# Happen Framework - Performance Benchmarks

Comprehensive performance benchmarks for the Happen framework, measuring throughput, latency, and memory usage across different features.

## Quick Start

```bash
# Run all benchmarks
npm run bench

# Run without GC instrumentation (faster)
npm run bench:quick
```

**Requirements**:
- NATS server running: `docker run --rm -p 4222:4222 -p 8222:8222 nats:latest -js`
- Node.js 18+ (Node.js 20+ recommended for best performance)

## Benchmark Suites

### 1. Event Processing Benchmarks

Tests core event processing performance:

- **Standard Event Processing** - Regular event handler throughput
- **Zero-Allocation Event Processing** - High-performance buffer-based processing
- **Event Creation** - Causality tracking overhead
- **Pattern Matching** - Event pattern matching performance
- **Event Continuum** - Function chain execution

**Key Metrics**:
- Throughput: Events processed per second
- Latency: P50, P95, P99 percentiles
- Memory: Heap allocation per operation

### 2. State & Views Benchmarks

Tests state management and cross-node state access:

- **State Set** - Writing state to JetStream KV
- **State Get** - Reading state from JetStream KV
- **State Get with Transform** - Reading with transformation
- **Views - Single Node Access** - Accessing another node's state
- **Views - Collect Multiple** - Gathering state from multiple nodes

**Key Insights**:
- State operations involve network I/O to NATS
- Views add minimal overhead for cross-node coordination
- Transform functions execute locally with no additional I/O

### 3. Confluence Benchmarks

Tests fan-out and fan-in performance:

- **Fan-Out to N Nodes** - Broadcasting to multiple nodes simultaneously
- **Fan-Out with Result Collection** - Gathering responses from all nodes
- **Fan-In Batches** - Processing multiple events as batches (10, 50, 100 events)

**Key Insights**:
- Fan-out scales linearly with node count
- Result collection adds ~2x overhead
- Batch processing is highly efficient (10-100x faster than individual events)

## Understanding the Results

### Throughput

Operations per second (ops/sec). Higher is better.

```
909,091 ops/sec = ~909K events/second = ~1.1μs per event
```

**Typical Ranges**:
- Local processing (no I/O): 100K - 2M+ ops/sec
- State operations (NATS I/O): 1K - 10K ops/sec
- Cross-node operations: 500 - 5K ops/sec

### Latency

Time to process a single operation in milliseconds (ms).

- **P50**: Median latency (50% of operations faster)
- **P95**: 95th percentile (95% of operations faster)
- **P99**: 99th percentile (99% of operations faster)

**What's Good**:
- P50 < 1ms: Excellent
- P50 < 10ms: Good
- P50 < 100ms: Acceptable for most workloads
- P99 < 100ms: Good tail latency

### Memory

Heap allocation per operation in KB.

```
0.22 KB/op = 220 bytes per operation
```

**What's Good**:
- < 0.1 KB/op: Excellent (minimal GC pressure)
- < 1 KB/op: Good
- < 10 KB/op: Acceptable
- > 10 KB/op: Consider zero-allocation mode

## Performance Tips

### 1. Use Zero-Allocation for High-Volume Scenarios

```javascript
// Standard (good for most use cases)
node.on('event', (event) => {
  // Process event
});

// Zero-allocation (for extreme performance)
node.onZeroAllocation('high-volume.*', (buffer, offset, length, metadata) => {
  // Direct buffer processing - no JSON serialization!
  const reader = new BufferReader(buffer, offset);
  const value = reader.readDouble();
  // Process without creating objects!
});
```

**When to use**:
- Network-bound scenarios where you control serialization (2x faster than JSON!)
- > 100K events/sec sustained throughput
- Latency-sensitive paths where GC pauses matter
- High-frequency metrics, telemetry, or sensor data

**When NOT to use**:
- Simple in-memory event processing (V8's object handling is extremely fast)
- Cases where you can't control serialization format
- Events that are already JSON (no benefit from re-encoding)

**Key Insight**: Zero-allocation provides **2x throughput improvement** over JSON serialization (1.79M vs 862K ops/sec in benchmarks). The benefit comes from avoiding `JSON.stringify()`/`JSON.parse()`, not from avoiding object creation.

### 2. Batch Events When Possible

```javascript
// Instead of processing 100 individual events:
for (const event of events) {
  await node.process(event); // Slow
}

// Batch them:
await node.process(events); // Much faster!
```

**Performance gain**: 10-100x for batch sizes of 10-100

### 3. Use Views for Cross-Node Coordination

```javascript
// Efficient: Single state operation with views
await node.state.set(async (state, views) => {
  const data = await views.collect({
    'node1': s => s.value,
    'node2': s => s.data
  });
  return { ...state, data };
});

// Less efficient: Multiple separate calls
const node1Data = await getNode1State();
const node2Data = await getNode2State();
await node.state.set(state => ({ ...state, node1Data, node2Data }));
```

### 4. Enable Flow-Balance Monitoring

Automatically detects performance issues:

```javascript
const { createNode } = await initializeHappen({
  flowBalance: {
    enabled: true,
    warningThreshold: 500,
    criticalThreshold: 1000
  }
});
```

## Benchmark Framework

The benchmark framework (`benchmarks/framework.ts`) provides utilities for creating custom benchmarks:

```typescript
import { benchmark } from './framework.js';

const result = await benchmark(
  async () => {
    // Your operation to benchmark
    await myOperation();
  },
  {
    name: 'My Operation',
    iterations: 10000,
    warmupIterations: 1000,
    measureMemory: true
  }
);

console.log(`Throughput: ${result.throughput} ops/sec`);
console.log(`Latency P50: ${result.latency.p50}ms`);
```

### Features

- **Warmup iterations**: Eliminates JIT compilation effects
- **Statistical analysis**: Min, max, mean, P50, P95, P99 latency
- **Memory tracking**: Heap usage before/after (requires `--expose-gc`)
- **Comparison utilities**: Compare baseline vs candidate implementations

## Sample Output

```
╔══════════════════════════════════════════════════════════════╗
║         HAPPEN FRAMEWORK - PERFORMANCE BENCHMARKS            ║
╚══════════════════════════════════════════════════════════════╝

✅ NATS server connected

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 EVENT PROCESSING BENCHMARKS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Standard Event Processing
   Operations: 10,000
   Throughput: 909,091 ops/sec
   Latency P50: 0.001ms
   Memory: 0.22 KB/op

✅ Zero-Allocation Event Processing
   Operations: 10,000
   Throughput: 1,200,000 ops/sec
   Latency P50: 0.001ms
   Memory: 0.05 KB/op

📊 Comparison: Zero-Allocation vs Standard
   Throughput: +32.0% 🚀
   Latency: +0.0% 🚀
   Memory: +77.3% 🚀

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📈 SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 Fastest Operations:
   1. Event Creation: 2,083,333 ops/sec
   2. Zero-Allocation Processing: 1,200,000 ops/sec
   3. Standard Processing: 909,091 ops/sec

⚡ Lowest Latency:
   1. Event Creation: 0.000ms (P50)
   2. Standard Processing: 0.001ms (P50)
   3. Zero-Allocation: 0.001ms (P50)

📊 Total Operations: 150,000
⏱️  Total Duration: 5.23s

✅ All benchmarks completed successfully!
💾 Results saved to benchmarks/results.json
```

## CI/CD Integration

Run benchmarks in CI to detect performance regressions:

```yaml
# .github/workflows/benchmarks.yml
- name: Run Benchmarks
  run: |
    docker run -d -p 4222:4222 -p 8222:8222 nats:latest -js
    npm run bench > benchmarks/results.txt

- name: Compare with Baseline
  run: |
    node scripts/compare-benchmarks.js \
      benchmarks/baseline.json \
      benchmarks/results.json
```

## Contributing

To add new benchmarks:

1. Create a new file: `benchmarks/my-feature.bench.ts`
2. Use the framework utilities from `benchmarks/framework.ts`
3. Import and run in `benchmarks/run-all.ts`
4. Update this README with results and insights

## Notes

- Benchmarks require a running NATS server
- Results vary by hardware, OS, and Node.js version
- Use `--expose-gc` flag for accurate memory measurements
- Run multiple times and average for consistent results
- Benchmarks reflect realistic workloads, not synthetic maximums

## License

MIT
