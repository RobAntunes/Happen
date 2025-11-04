/**
 * Zero-Allocation Event Processing
 *
 * True zero-allocation using buffer pools and direct memory access.
 * No schemas needed - structure is implicit in your read/write code.
 * Type safety through TypeScript interfaces.
 */

/**
 * Zero-allocation event handler
 * Receives raw buffer with offset and length - no object allocation!
 */
export type ZeroAllocationHandler = (
  buffer: Buffer,
  offset: number,
  length: number,
  metadata: ZeroAllocationMetadata
) => void | Promise<void>;

/**
 * Metadata passed alongside buffer (minimal allocation)
 */
export interface ZeroAllocationMetadata {
  /** Event type string (only allocated once, reused) */
  type: string;
  /** Sender node ID */
  sender: string;
  /** Causation ID */
  causationId?: string;
  /** Correlation ID */
  correlationId?: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Buffer Pool - Pre-allocated buffers for reuse
 * Core of zero-allocation: buffers are reused, not created
 */
export class BufferPool {
  private pool: Buffer[] = [];
  private maxSize: number;
  private bufferSize: number;
  private inUse = new Set<Buffer>();

  constructor(options: { maxPoolSize?: number; bufferSize?: number } = {}) {
    this.maxSize = options.maxPoolSize || 50;
    this.bufferSize = options.bufferSize || 4096; // 4KB default

    // Pre-allocate some buffers
    for (let i = 0; i < Math.min(10, this.maxSize); i++) {
      this.pool.push(Buffer.allocUnsafe(this.bufferSize));
    }
  }

  /**
   * Acquire a buffer from pool (no allocation if available)
   */
  acquire(minimumSize?: number): Buffer {
    const size = minimumSize || this.bufferSize;

    // Try to get from pool
    if (this.pool.length > 0 && size <= this.bufferSize) {
      const buffer = this.pool.pop()!;
      this.inUse.add(buffer);
      return buffer;
    }

    // Create new if needed (rare)
    const buffer = Buffer.allocUnsafe(size);
    if (size === this.bufferSize && this.inUse.size + this.pool.length < this.maxSize) {
      this.inUse.add(buffer);
    }
    return buffer;
  }

  /**
   * Release buffer back to pool for reuse
   */
  release(buffer: Buffer): void {
    if (!this.inUse.has(buffer)) {
      return; // Not from this pool
    }

    this.inUse.delete(buffer);

    if (this.pool.length < this.maxSize && buffer.length === this.bufferSize) {
      this.pool.push(buffer);
    }
  }

  /**
   * Get pool statistics
   */
  stats(): { pooled: number; inUse: number; maxSize: number } {
    return {
      pooled: this.pool.length,
      inUse: this.inUse.size,
      maxSize: this.maxSize
    };
  }

  /**
   * Clear the pool
   */
  clear(): void {
    this.pool = [];
    this.inUse.clear();
  }
}

/**
 * Global buffer pool instance
 */
export const globalBufferPool = new BufferPool();

/**
 * Buffer Writer - Helper for writing events to buffers
 * No allocation - just writes directly to buffer
 */
export class BufferWriter {
  private buffer: Buffer;
  private offset: number = 0;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  /**
   * Write unsigned 8-bit integer
   */
  writeUInt8(value: number): this {
    this.buffer.writeUInt8(value, this.offset);
    this.offset += 1;
    return this;
  }

  /**
   * Write signed 32-bit integer (little endian)
   */
  writeInt32(value: number): this {
    this.buffer.writeInt32LE(value, this.offset);
    this.offset += 4;
    return this;
  }

  /**
   * Write unsigned 32-bit integer (little endian)
   */
  writeUInt32(value: number): this {
    this.buffer.writeUInt32LE(value, this.offset);
    this.offset += 4;
    return this;
  }

  /**
   * Write 64-bit float (little endian)
   */
  writeDouble(value: number): this {
    this.buffer.writeDoubleLE(value, this.offset);
    this.offset += 8;
    return this;
  }

  /**
   * Write 64-bit integer (little endian)
   */
  writeBigInt(value: bigint): this {
    this.buffer.writeBigInt64LE(value, this.offset);
    this.offset += 8;
    return this;
  }

  /**
   * Write UTF-8 string with length prefix
   */
  writeString(value: string): this {
    const length = Buffer.byteLength(value, 'utf8');
    this.buffer.writeUInt32LE(length, this.offset);
    this.offset += 4;
    this.buffer.write(value, this.offset, length, 'utf8');
    this.offset += length;
    return this;
  }

  /**
   * Write bytes from another buffer
   */
  writeBuffer(source: Buffer, sourceOffset?: number, sourceLength?: number): this {
    const start = sourceOffset || 0;
    const length = sourceLength || source.length - start;
    source.copy(this.buffer, this.offset, start, start + length);
    this.offset += length;
    return this;
  }

  /**
   * Get current offset
   */
  getOffset(): number {
    return this.offset;
  }

  /**
   * Reset offset to beginning
   */
  reset(): this {
    this.offset = 0;
    return this;
  }

  /**
   * Get the buffer slice with written data
   */
  toBuffer(): Buffer {
    return this.buffer.slice(0, this.offset);
  }
}

/**
 * Buffer Reader - Helper for reading events from buffers
 * No allocation - just reads directly from buffer
 */
export class BufferReader {
  private buffer: Buffer;
  private offset: number;

  constructor(buffer: Buffer, startOffset: number = 0) {
    this.buffer = buffer;
    this.offset = startOffset;
  }

  /**
   * Read unsigned 8-bit integer
   */
  readUInt8(): number {
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  /**
   * Read signed 32-bit integer (little endian)
   */
  readInt32(): number {
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  /**
   * Read unsigned 32-bit integer (little endian)
   */
  readUInt32(): number {
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  /**
   * Read 64-bit float (little endian)
   */
  readDouble(): number {
    const value = this.buffer.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }

  /**
   * Read 64-bit integer (little endian)
   */
  readBigInt(): bigint {
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  /**
   * Read UTF-8 string with length prefix
   */
  readString(): string {
    const length = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    const value = this.buffer.toString('utf8', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  /**
   * Read bytes into new buffer
   */
  readBuffer(length: number): Buffer {
    const value = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  /**
   * Get current offset
   */
  getOffset(): number {
    return this.offset;
  }

  /**
   * Get remaining bytes
   */
  remaining(): number {
    return this.buffer.length - this.offset;
  }
}

/**
 * Convert regular event to zero-allocation format
 * This is a bridge function - ideally events arrive already in buffer format
 */
export function eventToBuffer(event: any, pool?: BufferPool): { buffer: Buffer; length: number } {
  const bufPool = pool || globalBufferPool;
  const buffer = bufPool.acquire();
  const writer = new BufferWriter(buffer);

  // Write payload as JSON (for now - you can optimize specific event types)
  const payloadStr = JSON.stringify(event.payload);
  writer.writeString(payloadStr);

  return {
    buffer,
    length: writer.getOffset()
  };
}

/**
 * Convert buffer back to regular event (allocation - use sparingly!)
 */
export function bufferToEvent(buffer: Buffer, offset: number, length: number): any {
  const reader = new BufferReader(buffer, offset);
  const payloadStr = reader.readString();
  return JSON.parse(payloadStr);
}

/**
 * Wrap zero-allocation handler to work with regular event flow
 */
export function wrapZeroAllocationHandler(
  handler: ZeroAllocationHandler
): (event: any, context: any) => Promise<void> {
  return async (event: any, context: any) => {
    const { buffer, length } = eventToBuffer(event);

    const metadata: ZeroAllocationMetadata = {
      type: event.type,
      sender: context.causal.sender,
      causationId: context.causal.causationId,
      correlationId: context.causal.correlationId,
      timestamp: context.causal.timestamp
    };

    try {
      await handler(buffer, 0, length, metadata);
    } finally {
      // Release buffer back to pool
      globalBufferPool.release(buffer);
    }
  };
}

/**
 * Example: High-performance metric event
 *
 * Shows how to use zero-allocation for hot paths
 */
export function writeMetricEvent(
  buffer: Buffer,
  metricName: number, // enum/constant
  value: number,
  timestamp: bigint
): number {
  const writer = new BufferWriter(buffer);
  writer.writeUInt8(metricName);
  writer.writeDouble(value);
  writer.writeBigInt(timestamp);
  return writer.getOffset();
}

/**
 * Read metric event (no allocation!)
 */
export function readMetricEvent(buffer: Buffer, offset: number): {
  metricName: number;
  value: number;
  timestamp: bigint;
} {
  const reader = new BufferReader(buffer, offset);
  return {
    metricName: reader.readUInt8(),
    value: reader.readDouble(),
    timestamp: reader.readBigInt()
  };
}
