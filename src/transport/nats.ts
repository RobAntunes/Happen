/**
 * NATS Transport for server environments
 * Provides full NATS connectivity with JetStream support
 */

import { ConnectionOptions, connect, NatsConnection, Subscription, Msg } from 'nats';
import { BaseTransportAdapter } from './index';
import { createFlowBalanceMonitor, FlowBalanceMonitor } from '../flow-balance';
import { encode } from 'msgpackr';

export interface NATSConfig extends ConnectionOptions {
  servers: string | string[];
  jetstream?: boolean;
  name?: string;
  user?: string;
  pass?: string;
  token?: string;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  timeout?: number;
}

export class NATSTransport extends BaseTransportAdapter {
  private connection?: NatsConnection;
  private subscriptions = new Map<string, Subscription>();
  private jetStreamEnabled: boolean;
  private flowBalanceMonitor?: FlowBalanceMonitor;
  
  constructor(config: NATSConfig) {
    super(config);
    this.jetStreamEnabled = config.jetstream ?? true;
  }
  
  async connect(): Promise<void> {
    try {
      this.setState('connecting');
      
      const natsOptions: ConnectionOptions = {
        servers: this.options.servers,
        name: this.options.name,
        user: this.options.user,
        pass: this.options.pass,
        token: this.options.token,
        maxReconnectAttempts: this.options.maxReconnectAttempts,
        reconnectTimeWait: this.options.reconnectDelayMs,
        timeout: this.options.timeout,
      };
      
      this.connection = await connect(natsOptions);
      this.setState('connected');
      
      // Set up connection event handlers
      this.connection.closed().then(() => {
        this.setState('disconnected');
      });
      
      // Log connection info
      console.log('NATS connected to:', this.connection.getServer());
      
      // Initialize JetStream if enabled
      if (this.jetStreamEnabled) {
        await this.initializeJetStream();
        await this.initializeFlowBalance();
      }
      
    } catch (error) {
      this.setState('error', error as Error);
      throw error;
    }
  }
  
  private async initializeJetStream(): Promise<void> {
    if (!this.connection) return;
    
    try {
      const js = this.connection.jetstream();
      
      // Create streams for Happen event spaces
      const streamConfig: any = {
        name: 'HAPPEN_EVENTS',
        subjects: ['happen.events.*', 'happen.state.*', 'happen.system.*', 'happen.req.*'],
        storage: 'file',
        max_age: 86400000000000, // 24 hours in nanoseconds
        max_msgs: 100000,
        retention: 'limits',
        discard: 'old',
      };
      
      try {
        await (js.streams as any).add(streamConfig);
        console.log('JetStream HAPPEN_EVENTS stream created');
      } catch (error: any) {
        // Stream might already exist
        if (!error.message?.includes('stream name already in use')) {
          console.warn('JetStream stream creation warning:', error.message);
        }
      }
      
    } catch (error) {
      console.warn('JetStream initialization failed:', error);
      // Continue without JetStream - fallback to core NATS
    }
  }
  
  private async initializeFlowBalance(): Promise<void> {
    if (!this.connection) return;
    
    try {
      // Create a JetStream manager for Flow Balance
      const jsm = await this.connection.jetstreamManager();
      
      // Create Flow Balance monitor with event emission
      this.flowBalanceMonitor = createFlowBalanceMonitor(
        {
          createStream: async (config) => {
            await jsm.streams.add(config as any);
          },
          deleteStream: async (name) => {
            await jsm.streams.delete(name);
          },
          createConsumer: async (config) => {
            await jsm.consumers.add(config.streamName, config);
          },
          deleteConsumer: async (streamName, consumerName) => {
            await jsm.consumers.delete(streamName, consumerName);
          },
          getStreamInfo: async (name) => {
            return await jsm.streams.info(name);
          },
          getConsumerInfo: async (streamName, consumerName) => {
            return await jsm.consumers.info(streamName, consumerName);
          },
          purgeStream: async (name) => {
            await jsm.streams.purge(name);
          },
        },
        {
          enabled: true,
          pollingInterval: 5000,
        },
        // Event emitter for Flow Balance events
        (event) => {
          const encoded = encode(event);
          this.publish(`happen.system.flow-balance.${event.type}`, encoded);
        }
      );
      
      // Start monitoring
      this.flowBalanceMonitor.start();
      console.log('Flow Balance monitoring initialized');
      
    } catch (error) {
      console.warn('Flow Balance initialization failed:', error);
      // Continue without Flow Balance - it's optional
    }
  }
  
  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    
    // Stop Flow Balance monitoring
    if (this.flowBalanceMonitor) {
      this.flowBalanceMonitor.stop();
      this.flowBalanceMonitor = undefined;
    }
    
    // Close all subscriptions
    for (const [subject, subscription] of this.subscriptions) {
      try {
        subscription.unsubscribe();
      } catch (error) {
        console.warn(`Error unsubscribing from ${subject}:`, error);
      }
    }
    this.subscriptions.clear();
    
    // Close connection
    if (this.connection) {
      try {
        await this.connection.close();
      } catch (error) {
        console.warn('Error closing NATS connection:', error);
      }
      this.connection = undefined;
    }
    
    this.setState('disconnected');
  }
  
  async publish(subject: string, data: Uint8Array): Promise<void> {
    if (!this.connection) {
      throw new Error('NATS connection not established');
    }
    
    try {
      if (this.jetStreamEnabled && this.shouldUseJetStream(subject)) {
        // Use JetStream for persistent messages
        const js = this.connection.jetstream();
        await js.publish(subject, data);
      } else {
        // Use core NATS for fire-and-forget messages
        this.connection.publish(subject, data);
      }
    } catch (error) {
      console.error('NATS publish error:', error);
      throw error;
    }
  }
  
  async request(subject: string, data: Uint8Array, timeout?: number): Promise<Uint8Array> {
    if (!this.connection) {
      throw new Error('NATS connection not established');
    }
    
    try {
      const response = await this.connection.request(subject, data, { timeout: timeout || this.options.timeout });
      return response.data;
    } catch (error) {
      console.error('NATS request error:', error);
      throw error;
    }
  }
  
  protected handleSubscription(subject: string, _handler: (data: Uint8Array) => void): void {
    if (!this.connection) {
      console.warn('Cannot subscribe: NATS connection not established');
      return;
    }
    
    try {
      const subscription = this.connection.subscribe(subject, {
        callback: (err: any, msg: Msg) => {
          if (err) {
            console.error('NATS subscription error:', err);
            return;
          }
          this.emitToSubscribers(subject, msg.data);
        },
      });
      
      this.subscriptions.set(subject, subscription);
      
    } catch (error) {
      console.error('NATS subscription error:', error);
    }
  }
  
  protected handleUnsubscription(subject: string): void {
    const subscription = this.subscriptions.get(subject);
    if (subscription) {
      try {
        subscription.unsubscribe();
        this.subscriptions.delete(subject);
      } catch (error) {
        console.warn(`Error unsubscribing from ${subject}:`, error);
      }
    }
  }
  
  /**
   * Determine if a subject should use JetStream based on patterns
   */
  private shouldUseJetStream(subject: string): boolean {
    // Use JetStream for state synchronization and important events
    return subject.startsWith('happen.state.') || 
           subject.startsWith('happen.events.') || 
           subject.includes('.persistent.');
  }
  
  /**
   * Get NATS connection info
   */
  getConnectionInfo(): { server?: string; status: string } {
    return {
      server: this.connection?.getServer(),
      status: this.state.status,
    };
  }
  
  /**
   * Get JetStream manager for advanced operations
   */
  getJetStream() {
    if (!this.connection) {
      throw new Error('NATS connection not established');
    }
    return this.connection.jetstream();
  }
  
  /**
   * Get Key-Value store for global state
   */
  async getKeyValue(bucket: string) {
    if (!this.connection) {
      throw new Error('NATS connection not established');
    }
    
    const js = this.connection.jetstream();
    return await js.views.kv(bucket);
  }
  
  /**
   * Create Key-Value bucket if it doesn't exist
   */
  async createKeyValueBucket(bucket: string) {
    if (!this.connection) {
      throw new Error('NATS connection not established');
    }
    
    const js = this.connection.jetstream();
    try {
      return await js.views.kv(bucket, {
        history: 10,
        ttl: 86400000, // 24 hours
      });
    } catch (error) {
      console.warn(`Error creating KV bucket ${bucket}:`, error);
      throw error;
    }
  }
}