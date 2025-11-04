/**
 * Benchmark Framework for Happen
 *
 * Provides utilities for measuring performance metrics:
 * - Throughput (events/sec)
 * - Latency (p50, p95, p99)
 * - Memory usage
 * - GC pressure
 */

export interface BenchmarkResult {
  name: string;
  operations: number;
  duration: number;
  throughput: number;
  latency: {
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
  };
  memory?: {
    heapUsedBefore: number;
    heapUsedAfter: number;
    heapDelta: number;
    external: number;
  };
}

export interface BenchmarkOptions {
  name: string;
  warmupIterations?: number;
  iterations?: number;
  measureMemory?: boolean;
  beforeEach?: () => Promise<void> | void;
  afterEach?: () => Promise<void> | void;
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedArray: number[], p: number): number {
  const index = Math.ceil((sortedArray.length * p) / 100) - 1;
  return sortedArray[Math.max(0, index)];
}

/**
 * Run a benchmark and collect metrics
 */
export async function benchmark(
  operation: () => Promise<void> | void,
  options: BenchmarkOptions
): Promise<BenchmarkResult> {
  const {
    name,
    warmupIterations = 100,
    iterations = 1000,
    measureMemory = true,
    beforeEach,
    afterEach
  } = options;

  console.log(`\n⏱️  Running benchmark: ${name}`);
  console.log(`   Warmup: ${warmupIterations} iterations`);
  console.log(`   Test: ${iterations} iterations`);

  // Force GC if available
  if (global.gc) {
    global.gc();
  }

  // Warmup
  console.log('   Warming up...');
  for (let i = 0; i < warmupIterations; i++) {
    if (beforeEach) await beforeEach();
    await operation();
    if (afterEach) await afterEach();
  }

  // Force GC before actual benchmark
  if (global.gc) {
    global.gc();
  }

  // Memory before
  const memBefore = process.memoryUsage();

  // Actual benchmark
  console.log('   Measuring...');
  const latencies: number[] = [];
  const startTime = Date.now();

  for (let i = 0; i < iterations; i++) {
    if (beforeEach) await beforeEach();

    const opStart = process.hrtime.bigint();
    await operation();
    const opEnd = process.hrtime.bigint();

    latencies.push(Number(opEnd - opStart) / 1_000_000); // Convert to ms

    if (afterEach) await afterEach();
  }

  const endTime = Date.now();
  const duration = endTime - startTime;

  // Memory after
  const memAfter = process.memoryUsage();

  // Sort latencies for percentile calculation
  latencies.sort((a, b) => a - b);

  const result: BenchmarkResult = {
    name,
    operations: iterations,
    duration,
    throughput: (iterations / duration) * 1000, // ops/sec
    latency: {
      min: latencies[0],
      max: latencies[latencies.length - 1],
      mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99)
    }
  };

  if (measureMemory) {
    result.memory = {
      heapUsedBefore: memBefore.heapUsed,
      heapUsedAfter: memAfter.heapUsed,
      heapDelta: memAfter.heapUsed - memBefore.heapUsed,
      external: memAfter.external
    };
  }

  return result;
}

/**
 * Compare two benchmark results
 */
export function compare(baseline: BenchmarkResult, candidate: BenchmarkResult): {
  throughputImprovement: number;
  latencyImprovement: number;
  memoryImprovement: number;
} {
  const throughputImprovement =
    ((candidate.throughput - baseline.throughput) / baseline.throughput) * 100;

  const latencyImprovement =
    ((baseline.latency.mean - candidate.latency.mean) / baseline.latency.mean) * 100;

  const memoryImprovement = baseline.memory && candidate.memory
    ? ((baseline.memory.heapDelta - candidate.memory.heapDelta) / baseline.memory.heapDelta) * 100
    : 0;

  return {
    throughputImprovement,
    latencyImprovement,
    memoryImprovement
  };
}

/**
 * Format benchmark result for display
 */
export function formatResult(result: BenchmarkResult): string {
  const lines = [
    `\n✅ ${result.name}`,
    `   Operations: ${result.operations.toLocaleString()}`,
    `   Duration: ${result.duration.toLocaleString()}ms`,
    `   Throughput: ${result.throughput.toLocaleString(undefined, { maximumFractionDigits: 0 })} ops/sec`,
    `   Latency:`,
    `     Min: ${result.latency.min.toFixed(3)}ms`,
    `     Mean: ${result.latency.mean.toFixed(3)}ms`,
    `     P50: ${result.latency.p50.toFixed(3)}ms`,
    `     P95: ${result.latency.p95.toFixed(3)}ms`,
    `     P99: ${result.latency.p99.toFixed(3)}ms`,
    `     Max: ${result.latency.max.toFixed(3)}ms`
  ];

  if (result.memory) {
    const heapDeltaMB = (result.memory.heapDelta / 1024 / 1024).toFixed(2);
    lines.push(
      `   Memory:`,
      `     Heap Delta: ${heapDeltaMB} MB`,
      `     Per Operation: ${(result.memory.heapDelta / result.operations / 1024).toFixed(2)} KB`
    );
  }

  return lines.join('\n');
}

/**
 * Format comparison for display
 */
export function formatComparison(
  baseline: BenchmarkResult,
  candidate: BenchmarkResult,
  customTitle?: string
): string {
  const comp = compare(baseline, candidate);

  const throughputSign = comp.throughputImprovement > 0 ? '+' : '';
  const latencySign = comp.latencyImprovement > 0 ? '+' : '';
  const memorySign = comp.memoryImprovement > 0 ? '+' : '';

  const title = customTitle || `${candidate.name} vs ${baseline.name}`;

  return `\n📊 Comparison: ${title}
   Throughput: ${throughputSign}${comp.throughputImprovement.toFixed(1)}% ${comp.throughputImprovement > 0 ? '🚀' : '⚠️'}
   Latency: ${latencySign}${comp.latencyImprovement.toFixed(1)}% ${comp.latencyImprovement > 0 ? '🚀' : '⚠️'}
   Memory: ${memorySign}${comp.memoryImprovement.toFixed(1)}% ${comp.memoryImprovement > 0 ? '🚀' : '⚠️'}`;
}

/**
 * Run multiple benchmarks and generate report
 */
export async function benchmarkSuite(
  benchmarks: Array<{
    name: string;
    fn: () => Promise<void> | void;
    options?: Partial<BenchmarkOptions>;
  }>
): Promise<BenchmarkResult[]> {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║           HAPPEN PERFORMANCE BENCHMARKS              ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  const results: BenchmarkResult[] = [];

  for (const { name, fn, options = {} } of benchmarks) {
    const result = await benchmark(fn, { name, ...options });
    results.push(result);
    console.log(formatResult(result));
  }

  return results;
}
