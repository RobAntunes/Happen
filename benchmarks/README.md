# Happen Performance Benchmarks

This directory contains performance benchmarks for the Happen framework.

## Available Benchmarks

### 1. Basic Performance (`basic-performance.ts`)

Tests core framework performance with in-memory transport:
- Node creation speed
- Event emission within same node
- Node-to-node communication
- Request-response pattern
- View read/write operations
- Pattern matching
- Broadcasting

**Run:**
```bash
npx ts-node benchmarks/basic-performance.ts
```

### 2. NATS Transport Performance (`nats-performance.ts`)

Tests distributed messaging performance with NATS:
- Distributed pub/sub
- Request/reply pattern
- Fan-out to multiple subscribers
- Large payload handling (10KB)
- Concurrent operations

**Prerequisites:**
```bash
# Start NATS with JetStream
docker run -p 4222:4222 nats:latest -js
```

**Run:**
```bash
npx ts-node benchmarks/nats-performance.ts
```

## Performance Expectations

Based on typical hardware (modern laptop/desktop):

### In-Memory Transport
- Event emission: 100,000+ events/sec
- Node-to-node: 50,000+ messages/sec
- View operations: 200,000+ ops/sec
- Sub-millisecond latency for all operations

### NATS Transport
- Pub/Sub: 10,000+ messages/sec
- Request/Reply: ~2-5ms RTT
- P99 latency: <10ms
- Bandwidth: 100+ MB/s for large messages

## Running All Benchmarks

```bash
# Run basic benchmarks
npm run benchmark:basic

# Run NATS benchmarks (requires NATS server)
npm run benchmark:nats

# Run all benchmarks
npm run benchmark
```

## Customizing Benchmarks

You can modify the benchmark parameters:

```typescript
// Increase operations for more accurate results
const result = await benchmark('Test', fn, 100000);

// Add custom benchmarks
const customResult = await benchmark(
  'Custom Operation',
  async () => {
    // Your code here
  },
  10000
);
```

## Interpreting Results

- **Ops/sec**: Operations per second (higher is better)
- **Avg Latency**: Average time per operation (lower is better)
- **P95/P99**: 95th/99th percentile latency (consistency indicator)
- **Memory Usage**: Heap and RSS usage after benchmarks

## Notes

1. Results vary based on hardware, OS, and system load
2. First run may be slower due to JIT compilation
3. NATS benchmarks require network I/O and are naturally slower
4. Use these benchmarks to:
   - Identify performance regressions
   - Compare transport implementations
   - Validate performance requirements
   - Optimize critical paths