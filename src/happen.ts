/**
 * Main Happen instance implementation
 */

import { Happen, HappenConfig, HappenNode, NodeOptions, TransportAdapter } from './types';
import { HappenNodeImpl } from './node';
import { InMemoryGlobalState } from './global-state';
import { createTransportAdapter } from './transport';
import { createJetStreamManager, DEFAULT_HAPPEN_STREAM } from './transport/jetstream';
import { getDefaultConfig } from './environment';
import { getDefaultSerializer } from './serialization';

/**
 * Main Happen implementation
 */
export class HappenImpl implements Happen {
  private globalState = new InMemoryGlobalState();
  private nodes = new Map<string, HappenNode>();
  private connected = false;
  private transport: TransportAdapter | null = null;
  private jetstream: any = null;
  private config: Required<HappenConfig>;
  
  constructor(config: HappenConfig = {}) {
    const defaultEnvConfig = getDefaultConfig();
    
    this.config = {
      servers: config.servers || defaultEnvConfig.defaultNATSServers,
      name: config.name || 'happen-client',
      enableJetStream: config.enableJetStream !== false && defaultEnvConfig.enableJetStream,
      user: config.user || '',
      pass: config.pass || '',
      token: config.token || '',
      maxReconnectAttempts: config.maxReconnectAttempts || defaultEnvConfig.maxReconnectAttempts,
      reconnectDelayMs: config.reconnectDelayMs || defaultEnvConfig.reconnectDelayMs,
      timeout: config.timeout || 30000,
    };
  }
  
  /**
   * Create a new node
   */
  node<T = any>(id: string, options?: NodeOptions<T>): HappenNode<T> {
    if (this.nodes.has(id)) {
      throw new Error(`Node with id "${id}" already exists`);
    }
    
    const node = new HappenNodeImpl(id, options, this.globalState);
    this.nodes.set(id, node);
    
    // Auto-start if already connected
    if (this.connected) {
      node.start().catch(console.error);
    }
    
    return node;
  }
  
  /**
   * Connect to NATS
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    
    try {
      // Initialize serializer
      await getDefaultSerializer();
      
      // Create and connect transport adapter
      this.transport = await createTransportAdapter({
        servers: this.config.servers,
        name: this.config.name,
        user: this.config.user,
        pass: this.config.pass,
        token: this.config.token,
        maxReconnectAttempts: this.config.maxReconnectAttempts,
        reconnectDelayMs: this.config.reconnectDelayMs,
        timeout: this.config.timeout,
      });
      
      await this.transport.connect();
      
      // Setup JetStream if enabled
      if (this.config.enableJetStream) {
        await this.setupJetStream();
      }
      
      this.connected = true;
      
      // Start all nodes
      await Promise.all(
        Array.from(this.nodes.values()).map(node => node.start())
      );
      
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect to Happen: ${error}`);
    }
  }
  
  /**
   * Disconnect from NATS
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    
    try {
      // Stop all nodes
      await Promise.all(
        Array.from(this.nodes.values()).map(node => node.stop())
      );
      
      // Disconnect transport
      if (this.transport) {
        await this.transport.disconnect();
        this.transport = null;
      }
      
      this.jetstream = null;
      this.connected = false;
      
    } catch (error) {
      console.error('Error during disconnect:', error);
      this.connected = false;
    }
  }
  
  /**
   * Setup JetStream for event persistence
   */
  private async setupJetStream(): Promise<void> {
    if (!this.transport) {
      throw new Error('Transport not initialized');
    }
    
    try {
      this.jetstream = createJetStreamManager(this.transport);
      
      // Create default stream for Happen events
      await this.jetstream.createStream(DEFAULT_HAPPEN_STREAM);
      
    } catch (error) {
      console.warn('JetStream setup failed:', error);
      // Continue without JetStream
    }
  }
  
  /**
   * Get transport adapter (for advanced usage)
   */
  getTransport(): TransportAdapter | null {
    return this.transport;
  }
  
  /**
   * Get JetStream manager (for advanced usage)
   */
  getJetStream(): any {
    return this.jetstream;
  }
  
  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.connected && this.transport?.getState().status === 'connected';
  }
}

/**
 * Create a new Happen instance
 */
export function createHappen(config?: HappenConfig): Happen {
  return new HappenImpl(config);
}