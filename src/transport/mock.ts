/**
 * Mock transport adapter for testing and environments without NATS
 */

// Mock transport adapter implementation
import { BaseTransportAdapter, ConnectionOptions } from './index';

/**
 * Mock transport adapter for testing
 */
export class MockTransportAdapter extends BaseTransportAdapter {
  private isConnected = false;
  private messageStore = new Map<string, Uint8Array[]>();
  private requestHandlers = new Map<string, (data: Uint8Array) => Promise<Uint8Array>>();

  constructor(options: ConnectionOptions) {
    super(options);
  }

  /**
   * Mock connection - always succeeds immediately
   */
  async connect(): Promise<void> {
    if (this.state.status === 'connected') {
      return;
    }

    this.setState('connecting');
    
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    this.isConnected = true;
    this.setState('connected');
    this.state.connectedServer = 'mock://localhost:4222';
  }

  /**
   * Mock disconnection
   */
  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.messageStore.clear();
    this.requestHandlers.clear();
    this.setState('disconnected');
  }

  /**
   * Mock publish - stores message for potential delivery
   */
  async publish(subject: string, data: Uint8Array): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Not connected to mock server');
    }

    // Store message
    if (!this.messageStore.has(subject)) {
      this.messageStore.set(subject, []);
    }
    this.messageStore.get(subject)!.push(data);

    // Simulate async delivery to subscribers
    setTimeout(() => {
      this.emitToSubscribers(subject, data);
    }, 0);
  }

  /**
   * Mock request - uses registered request handlers
   */
  async request(subject: string, data: Uint8Array, timeout?: number): Promise<Uint8Array> {
    if (!this.isConnected) {
      throw new Error('Not connected to mock server');
    }

    const handler = this.requestHandlers.get(subject);
    if (!handler) {
      throw new Error(`No handler registered for subject: ${subject}`);
    }

    try {
      const result = await Promise.race([
        handler(data),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), timeout || this.options.timeout)
        )
      ]);
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle mock subscription
   */
  protected handleSubscription(_subject: string, _handler: (data: Uint8Array) => void): void {
    // Mock subscriptions are handled by the base class
    // Messages are delivered via emitToSubscribers in publish()
  }

  /**
   * Handle mock unsubscription
   */
  protected handleUnsubscription(_subject: string): void {
    // Mock unsubscriptions are handled by the base class
  }

  /**
   * Register a request handler for testing
   */
  registerRequestHandler(subject: string, handler: (data: Uint8Array) => Promise<Uint8Array>): void {
    this.requestHandlers.set(subject, handler);
  }

  /**
   * Get stored messages for a subject (for testing)
   */
  getStoredMessages(subject: string): Uint8Array[] {
    return this.messageStore.get(subject) || [];
  }

  /**
   * Clear stored messages (for testing)
   */
  clearStoredMessages(): void {
    this.messageStore.clear();
  }

  /**
   * Get all subscribed subjects (for testing)
   */
  getSubscribedSubjects(): string[] {
    return Array.from(this.subscribers.keys());
  }

  /**
   * Simulate connection failure (for testing)
   */
  simulateConnectionFailure(error?: Error): void {
    this.isConnected = false;
    this.setState('error', error || new Error('Simulated connection failure'));
  }

  /**
   * Simulate reconnection (for testing)
   */
  async simulateReconnection(): Promise<void> {
    if (this.state.status === 'error') {
      await this.connect();
    }
  }

  /**
   * Manually emit a message to subscribers (for testing)
   */
  emitMessage(subject: string, data: Uint8Array): void {
    this.emitToSubscribers(subject, data);
  }
}