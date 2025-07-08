/**
 * JetStream configuration and management utilities
 */

export interface StreamConfig {
  name: string;
  subjects: string[];
  retention: 'limits' | 'interest' | 'workqueue';
  storage: 'file' | 'memory';
  maxMsgs?: number;
  maxBytes?: number;
  maxAge?: number; // nanoseconds
  maxMsgSize?: number;
  replicas?: number;
  duplicateWindow?: number; // nanoseconds
}

export interface ConsumerConfig {
  name: string;
  streamName: string;
  deliverSubject?: string;
  deliverPolicy: 'all' | 'last' | 'new' | 'by_start_sequence' | 'by_start_time';
  ackPolicy: 'none' | 'all' | 'explicit';
  ackWait?: number; // nanoseconds
  maxDeliver?: number;
  replayPolicy?: 'instant' | 'original';
  filterSubject?: string;
  startSequence?: number;
  startTime?: Date;
}

export interface JetStreamManager {
  createStream(config: StreamConfig): Promise<void>;
  deleteStream(name: string): Promise<void>;
  createConsumer(config: ConsumerConfig): Promise<void>;
  deleteConsumer(streamName: string, consumerName: string): Promise<void>;
  getStreamInfo(name: string): Promise<any>;
  getConsumerInfo(streamName: string, consumerName: string): Promise<any>;
  purgeStream(name: string): Promise<void>;
}

/**
 * Default Happen stream configuration
 */
export const DEFAULT_HAPPEN_STREAM: StreamConfig = {
  name: 'HAPPEN_EVENTS',
  subjects: ['happen.events.*', 'happen.state.*', 'happen.system.*'],
  retention: 'limits',
  storage: 'file',
  maxMsgs: 1000000,
  maxBytes: 1024 * 1024 * 1024, // 1GB
  maxAge: 7 * 24 * 60 * 60 * 1000 * 1000000, // 7 days in nanoseconds
  maxMsgSize: 1024 * 1024, // 1MB
  replicas: 1,
  duplicateWindow: 2 * 60 * 1000 * 1000000, // 2 minutes in nanoseconds
};

/**
 * Default consumer configuration for event processing
 */
export const DEFAULT_EVENT_CONSUMER: Omit<ConsumerConfig, 'name' | 'streamName'> = {
  deliverPolicy: 'new',
  ackPolicy: 'explicit',
  ackWait: 30 * 1000 * 1000000, // 30 seconds in nanoseconds
  maxDeliver: 5,
  replayPolicy: 'instant',
};

/**
 * Node.js JetStream manager implementation
 */
export class NodeJetStreamManager implements JetStreamManager {
  private jsm: any = null;
  
  constructor(private natsTransport: any) {}

  async initialize(): Promise<void> {
    if (!this.natsTransport?.connection) {
      throw new Error('NATS connection required');
    }

    try {
      this.jsm = await this.natsTransport.connection.jetstreamManager();
    } catch (error) {
      throw new Error(`Failed to initialize JetStream manager: ${error}`);
    }
  }

  async createStream(config: StreamConfig): Promise<void> {
    if (!this.jsm) {
      await this.initialize();
    }

    try {
      await this.jsm.streams.add({
        name: config.name,
        subjects: config.subjects,
        retention: config.retention,
        storage: config.storage,
        max_msgs: config.maxMsgs,
        max_bytes: config.maxBytes,
        max_age: config.maxAge,
        max_msg_size: config.maxMsgSize,
        num_replicas: config.replicas,
        duplicate_window: config.duplicateWindow,
      });
    } catch (error) {
      // Ignore stream exists error
      if (!(error as Error).message?.includes('stream name already in use')) {
        throw error;
      }
    }
  }

  async deleteStream(name: string): Promise<void> {
    if (!this.jsm) {
      await this.initialize();
    }

    try {
      await this.jsm.streams.delete(name);
    } catch (error) {
      // Ignore stream not found error
      if (!(error as Error).message?.includes('stream not found')) {
        throw error;
      }
    }
  }

  async createConsumer(config: ConsumerConfig): Promise<void> {
    if (!this.jsm) {
      await this.initialize();
    }

    try {
      await this.jsm.consumers.add(config.streamName, {
        name: config.name,
        deliver_subject: config.deliverSubject,
        deliver_policy: config.deliverPolicy,
        ack_policy: config.ackPolicy,
        ack_wait: config.ackWait,
        max_deliver: config.maxDeliver,
        replay_policy: config.replayPolicy,
        filter_subject: config.filterSubject,
        opt_start_seq: config.startSequence,
        opt_start_time: config.startTime?.toISOString(),
      });
    } catch (error) {
      // Ignore consumer exists error
      if (!(error as Error).message?.includes('consumer name already in use')) {
        throw error;
      }
    }
  }

  async deleteConsumer(streamName: string, consumerName: string): Promise<void> {
    if (!this.jsm) {
      await this.initialize();
    }

    try {
      await this.jsm.consumers.delete(streamName, consumerName);
    } catch (error) {
      // Ignore consumer not found error
      if (!(error as Error).message?.includes('consumer not found')) {
        throw error;
      }
    }
  }

  async getStreamInfo(name: string): Promise<any> {
    if (!this.jsm) {
      await this.initialize();
    }

    return await this.jsm.streams.info(name);
  }

  async getConsumerInfo(streamName: string, consumerName: string): Promise<any> {
    if (!this.jsm) {
      await this.initialize();
    }

    return await this.jsm.consumers.info(streamName, consumerName);
  }

  async purgeStream(name: string): Promise<void> {
    if (!this.jsm) {
      await this.initialize();
    }

    await this.jsm.streams.purge(name);
  }
}

/**
 * WebSocket JetStream manager (limited functionality)
 */
export class WebSocketJetStreamManager implements JetStreamManager {
  constructor(_websocketAdapter: any) {}

  async createStream(_config: StreamConfig): Promise<void> {
    // WebSocket implementation would send management messages
    // This is a simplified version
    console.warn('JetStream management via WebSocket not fully implemented');
  }

  async deleteStream(_name: string): Promise<void> {
    console.warn('JetStream management via WebSocket not fully implemented');
  }

  async createConsumer(_config: ConsumerConfig): Promise<void> {
    console.warn('JetStream management via WebSocket not fully implemented');
  }

  async deleteConsumer(_streamName: string, _consumerName: string): Promise<void> {
    console.warn('JetStream management via WebSocket not fully implemented');
  }

  async getStreamInfo(_name: string): Promise<any> {
    console.warn('JetStream management via WebSocket not fully implemented');
    return null;
  }

  async getConsumerInfo(_streamName: string, _consumerName: string): Promise<any> {
    console.warn('JetStream management via WebSocket not fully implemented');
    return null;
  }

  async purgeStream(_name: string): Promise<void> {
    console.warn('JetStream management via WebSocket not fully implemented');
  }
}

/**
 * Mock JetStream manager for testing
 */
export class MockJetStreamManager implements JetStreamManager {
  private streams = new Map<string, StreamConfig>();
  private consumers = new Map<string, Map<string, ConsumerConfig>>();

  async createStream(config: StreamConfig): Promise<void> {
    this.streams.set(config.name, { ...config });
  }

  async deleteStream(name: string): Promise<void> {
    this.streams.delete(name);
    this.consumers.delete(name);
  }

  async createConsumer(config: ConsumerConfig): Promise<void> {
    if (!this.consumers.has(config.streamName)) {
      this.consumers.set(config.streamName, new Map());
    }
    this.consumers.get(config.streamName)!.set(config.name, { ...config });
  }

  async deleteConsumer(streamName: string, consumerName: string): Promise<void> {
    const streamConsumers = this.consumers.get(streamName);
    if (streamConsumers) {
      streamConsumers.delete(consumerName);
    }
  }

  async getStreamInfo(name: string): Promise<any> {
    const stream = this.streams.get(name);
    return stream ? {
      config: stream,
      state: {
        messages: 0,
        bytes: 0,
        first_seq: 1,
        last_seq: 0,
      }
    } : null;
  }

  async getConsumerInfo(streamName: string, consumerName: string): Promise<any> {
    const consumer = this.consumers.get(streamName)?.get(consumerName);
    return consumer ? {
      config: consumer,
      delivered: {
        consumer_seq: 0,
        stream_seq: 0,
      },
      ack_floor: {
        consumer_seq: 0,
        stream_seq: 0,
      },
    } : null;
  }

  async purgeStream(_name: string): Promise<void> {
    // Mock purge - just track that it was called
  }

  // Test utilities
  getStreams(): Map<string, StreamConfig> {
    return new Map(this.streams);
  }

  getConsumers(): Map<string, Map<string, ConsumerConfig>> {
    return new Map(this.consumers);
  }
}

/**
 * Create JetStream manager based on environment
 */
export function createJetStreamManager(adapter: any): JetStreamManager {
  if (adapter.constructor.name === 'NodeTransportAdapter' || adapter.constructor.name === 'NATSTransport') {
    return new NodeJetStreamManager(adapter);
  } else if (adapter.constructor.name === 'WebSocketTransportAdapter') {
    return new WebSocketJetStreamManager(adapter);
  } else {
    return new MockJetStreamManager();
  }
}