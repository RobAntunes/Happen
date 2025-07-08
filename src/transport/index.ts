/**
 * Transport layer for cross-environment NATS communication
 */

import { TransportAdapter } from '../types';

export interface ConnectionOptions {
  servers: string | string[];
  name?: string;
  user?: string;
  pass?: string;
  token?: string;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  timeout?: number;
}

export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  connectedServer?: string;
  lastError?: Error;
  reconnectAttempts: number;
}

/**
 * Base transport adapter with common functionality
 */
export abstract class BaseTransportAdapter implements TransportAdapter {
  protected options: Required<ConnectionOptions>;
  protected state: ConnectionState;
  protected subscribers = new Map<string, Set<(data: Uint8Array) => void>>();
  protected reconnectTimer?: NodeJS.Timeout;
  
  constructor(options: ConnectionOptions) {
    this.options = {
      servers: Array.isArray(options.servers) ? options.servers : [options.servers],
      name: options.name || 'happen-client',
      user: options.user || '',
      pass: options.pass || '',
      token: options.token || '',
      maxReconnectAttempts: options.maxReconnectAttempts || 10,
      reconnectDelayMs: options.reconnectDelayMs || 1000,
      timeout: options.timeout || 30000,
    };
    
    this.state = {
      status: 'disconnected',
      reconnectAttempts: 0,
    };
  }
  
  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return { ...this.state };
  }
  
  /**
   * Abstract methods to be implemented by specific adapters
   */
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract publish(subject: string, data: Uint8Array): Promise<void>;
  abstract request(subject: string, data: Uint8Array, timeout?: number): Promise<Uint8Array>;
  
  /**
   * Subscribe to a subject
   */
  subscribe(subject: string, handler: (data: Uint8Array) => void): () => void {
    if (!this.subscribers.has(subject)) {
      this.subscribers.set(subject, new Set());
    }
    
    this.subscribers.get(subject)!.add(handler);
    
    // Delegate to implementation-specific subscription
    this.handleSubscription(subject, handler);
    
    // Return unsubscribe function
    return () => {
      const handlers = this.subscribers.get(subject);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.subscribers.delete(subject);
          this.handleUnsubscription(subject);
        }
      }
    };
  }
  
  /**
   * Handle implementation-specific subscription logic
   */
  protected abstract handleSubscription(subject: string, handler: (data: Uint8Array) => void): void;
  
  /**
   * Handle implementation-specific unsubscription logic
   */
  protected abstract handleUnsubscription(subject: string): void;
  
  /**
   * Emit data to subscribers
   */
  protected emitToSubscribers(subject: string, data: Uint8Array): void {
    const handlers = this.subscribers.get(subject);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error('Subscriber error:', error);
        }
      });
    }
  }
  
  /**
   * Handle connection state changes
   */
  protected setState(status: ConnectionState['status'], error?: Error): void {
    this.state.status = status;
    if (error) {
      this.state.lastError = error;
    }
    
    // Handle reconnection logic
    if (status === 'error' && this.state.reconnectAttempts < this.options.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }
  
  /**
   * Schedule automatic reconnection
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    const delay = this.options.reconnectDelayMs * Math.pow(2, this.state.reconnectAttempts);
    
    this.reconnectTimer = setTimeout(async () => {
      this.state.status = 'reconnecting';
      this.state.reconnectAttempts++;
      
      try {
        await this.connect();
        this.state.reconnectAttempts = 0; // Reset on successful connection
      } catch (error) {
        this.setState('error', error as Error);
      }
    }, delay);
  }
  
  /**
   * Clear reconnection timer
   */
  protected clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

/**
 * Create a transport adapter for the current environment
 */
export async function createTransportAdapter(options: ConnectionOptions): Promise<TransportAdapter> {
  // Check if we're in a test environment
  if (process.env.NODE_ENV === 'test' || typeof (globalThis as any).__jest__ !== 'undefined') {
    const { MockTransportAdapter } = await import('./mock');
    return new MockTransportAdapter(options);
  }
  
  // Use environment detection instead of direct globals
  const { detectEnvironment } = await import('../environment');
  const env = detectEnvironment();
  
  if (env === 'node' || env === 'deno' || env === 'bun') {
    // Server environments - use real NATS transport
    const { NATSTransport } = await import('./nats');
    return new NATSTransport(options);
  } else if (env === 'browser' || env === 'webworker') {
    // Browser/WebWorker - use WebSocket NATS
    const { WebSocketTransportAdapter } = await import('./websocket');
    return new WebSocketTransportAdapter(options);
  } else {
    // Fallback - use mock adapter for testing
    const { MockTransportAdapter } = await import('./mock');
    return new MockTransportAdapter(options);
  }
}