/**
 * NATS connection manager
 * Provides the messaging backbone for Happen
 */

import {
  connect,
  NatsConnection,
  JetStreamClient,
  JetStreamManager,
  KV,
  StringCodec,
  JSONCodec,
  Subscription
} from 'nats';
import type { HappenConfig } from './types.js';

const sc = StringCodec();
const jc = JSONCodec();

/**
 * Manager for NATS connection and JetStream
 */
export class NatsConnectionManager {
  private connection: NatsConnection | null = null;
  private jetstream: JetStreamClient | null = null;
  private jetstreamManager: JetStreamManager | null = null;
  private config: HappenConfig;
  private kvStores: Map<string, KV> = new Map();

  constructor(config: HappenConfig = {}) {
    this.config = {
      servers: config.servers || 'localhost:4222',
      debug: config.debug || false,
      ...config
    };
  }

  /**
   * Connect to NATS server
   */
  async connect(): Promise<void> {
    if (this.connection) {
      return; // Already connected
    }

    try {
      const servers = Array.isArray(this.config.servers)
        ? this.config.servers
        : [this.config.servers!];

      this.connection = await connect({
        servers,
        name: 'happen-framework',
      });

      if (this.config.debug) {
        console.log(`[Happen] Connected to NATS at ${servers.join(', ')}`);
      }

      // Initialize JetStream
      this.jetstream = this.connection.jetstream();
      this.jetstreamManager = await this.connection.jetstreamManager();

      // Handle connection errors
      (async () => {
        if (this.connection) {
          for await (const status of this.connection.status()) {
            if (this.config.debug) {
              console.log(`[Happen] NATS status: ${status.type}`, status.data);
            }
          }
        }
      })();

    } catch (error) {
      throw new Error(`Failed to connect to NATS: ${error}`);
    }
  }

  /**
   * Disconnect from NATS
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.drain();
      await this.connection.close();
      this.connection = null;
      this.jetstream = null;
      this.jetstreamManager = null;
      this.kvStores.clear();

      if (this.config.debug) {
        console.log('[Happen] Disconnected from NATS');
      }
    }
  }

  /**
   * Get the NATS connection
   */
  getConnection(): NatsConnection {
    if (!this.connection) {
      throw new Error('Not connected to NATS. Call connect() first.');
    }
    return this.connection;
  }

  /**
   * Get JetStream client
   */
  getJetStream(): JetStreamClient {
    if (!this.jetstream) {
      throw new Error('JetStream not initialized. Call connect() first.');
    }
    return this.jetstream;
  }

  /**
   * Get JetStream manager
   */
  getJetStreamManager(): JetStreamManager {
    if (!this.jetstreamManager) {
      throw new Error('JetStream manager not initialized. Call connect() first.');
    }
    return this.jetstreamManager;
  }

  /**
   * Publish a message to a subject
   */
  async publish(subject: string, data: any): Promise<void> {
    const connection = this.getConnection();
    connection.publish(subject, jc.encode(data));
  }

  /**
   * Subscribe to a subject
   */
  subscribe(
    subject: string,
    handler: (data: any, subject: string) => void | Promise<void>
  ): Subscription {
    const connection = this.getConnection();
    const sub = connection.subscribe(subject);

    (async () => {
      for await (const msg of sub) {
        try {
          const data = jc.decode(msg.data);
          await handler(data, msg.subject);
        } catch (error) {
          if (this.config.debug) {
            console.error(`[Happen] Error handling message on ${subject}:`, error);
          }
        }
      }
    })();

    return sub;
  }

  /**
   * Get or create a KV store for node state
   */
  async getKVStore(name: string): Promise<KV> {
    // Check cache first
    if (this.kvStores.has(name)) {
      return this.kvStores.get(name)!;
    }

    const connection = this.getConnection();
    const js = connection.jetstream();

    try {
      // Try to get existing KV store
      const kv = await js.views.kv(name);
      this.kvStores.set(name, kv);
      return kv;
    } catch (error) {
      // Create new KV store if it doesn't exist
      try {
        const kv = await js.views.kv(name, {
          history: 10,
        });
        this.kvStores.set(name, kv);

        if (this.config.debug) {
          console.log(`[Happen] Created KV store: ${name}`);
        }

        return kv;
      } catch (createError) {
        throw new Error(`Failed to create KV store ${name}: ${createError}`);
      }
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection !== null && !this.connection.isClosed();
  }
}
