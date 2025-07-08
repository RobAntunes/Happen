/**
 * Node.js TCP NATS transport adapter
 */

import { BaseTransportAdapter, ConnectionOptions } from './index';

/**
 * Node.js-specific transport adapter using TCP NATS
 */
export class NodeTransportAdapter extends BaseTransportAdapter {
  private natsConnection: any = null;
  private natsClient: any = null;
  private activeSubscriptions = new Map<string, any>();

  constructor(options: ConnectionOptions) {
    super(options);
  }

  /**
   * Connect to NATS server using TCP
   */
  async connect(): Promise<void> {
    if (this.state.status === 'connected') {
      return;
    }

    this.setState('connecting');
    this.clearReconnectTimer();

    try {
      // Dynamic import for Node.js NATS client
      const { connect, StringCodec, JSONCodec } = await import('nats');
      
      this.natsConnection = await connect({
        servers: this.options.servers,
        name: this.options.name,
        user: this.options.user || undefined,
        pass: this.options.pass || undefined,
        token: this.options.token || undefined,
        maxReconnectAttempts: this.options.maxReconnectAttempts,
        reconnectDelayMS: this.options.reconnectDelayMs,
        timeout: this.options.timeout,
      });

      this.natsClient = {
        stringCodec: StringCodec(),
        jsonCodec: JSONCodec(),
      };

      // Setup connection event handlers
      this.setupConnectionHandlers();

      this.setState('connected');
      this.state.connectedServer = this.natsConnection.getServer();

      // Resubscribe to existing subscriptions
      await this.resubscribeAll();

    } catch (error) {
      this.setState('error', error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from NATS server
   */
  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    
    if (this.natsConnection) {
      try {
        await this.natsConnection.drain();
        await this.natsConnection.close();
      } catch (error) {
        console.error('Error during disconnect:', error);
      }
    }

    this.natsConnection = null;
    this.natsClient = null;
    this.activeSubscriptions.clear();
    this.setState('disconnected');
  }

  /**
   * Publish a message to a subject
   */
  async publish(subject: string, data: Uint8Array): Promise<void> {
    if (!this.natsConnection || this.state.status !== 'connected') {
      throw new Error('Not connected to NATS server');
    }

    try {
      this.natsConnection.publish(subject, data);
    } catch (error) {
      this.setState('error', error as Error);
      throw error;
    }
  }

  /**
   * Send a request and wait for response
   */
  async request(subject: string, data: Uint8Array, timeout?: number): Promise<Uint8Array> {
    if (!this.natsConnection || this.state.status !== 'connected') {
      throw new Error('Not connected to NATS server');
    }

    try {
      const response = await this.natsConnection.request(
        subject, 
        data, 
        { timeout: timeout || this.options.timeout }
      );
      return response.data;
    } catch (error) {
      this.setState('error', error as Error);
      throw error;
    }
  }

  /**
   * Handle implementation-specific subscription
   */
  protected handleSubscription(subject: string, handler: (data: Uint8Array) => void): void {
    if (this.natsConnection && this.state.status === 'connected') {
      this.createNATSSubscription(subject, handler);
    }
  }

  /**
   * Handle implementation-specific unsubscription
   */
  protected handleUnsubscription(subject: string): void {
    const subscription = this.activeSubscriptions.get(subject);
    if (subscription) {
      subscription.unsubscribe();
      this.activeSubscriptions.delete(subject);
    }
  }

  /**
   * Create a NATS subscription
   */
  private async createNATSSubscription(subject: string, handler: (data: Uint8Array) => void): Promise<void> {
    if (!this.natsConnection) {
      return;
    }

    try {
      const subscription = this.natsConnection.subscribe(subject);
      this.activeSubscriptions.set(subject, subscription);

      // Process messages asynchronously
      (async () => {
        for await (const message of subscription) {
          try {
            handler(message.data);
          } catch (error) {
            console.error('Subscription handler error:', error);
          }
        }
      })();

    } catch (error) {
      console.error('Subscription error:', error);
    }
  }

  /**
   * Setup connection event handlers
   */
  private setupConnectionHandlers(): void {
    if (!this.natsConnection) {
      return;
    }

    // Handle disconnection
    (async () => {
      for await (const status of this.natsConnection.status()) {
        switch (status.type) {
          case 'disconnect':
            this.setState('reconnecting');
            break;
          case 'reconnect':
            this.setState('connected');
            this.state.connectedServer = this.natsConnection.getServer();
            break;
          case 'error':
            this.setState('error', new Error(status.data || 'Connection error'));
            break;
        }
      }
    })();
  }

  /**
   * Resubscribe to all active subscriptions
   */
  private async resubscribeAll(): Promise<void> {
    for (const [subject, handlers] of this.subscribers.entries()) {
      for (const handler of handlers) {
        this.createNATSSubscription(subject, handler);
      }
    }
  }
}