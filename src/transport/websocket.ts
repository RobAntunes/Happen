/**
 * WebSocket NATS transport adapter for browsers
 */

/// <reference path="../types/browser.d.ts" />

import { TransportAdapter } from '../types';
import { BaseTransportAdapter, ConnectionOptions } from './index';

/**
 * Browser WebSocket transport adapter
 */
export class WebSocketTransportAdapter extends BaseTransportAdapter {
  private websocket: WebSocket | null = null;
  private messageId = 0;
  private pendingRequests = new Map<string, {
    resolve: (data: Uint8Array) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(options: ConnectionOptions) {
    super(options);
  }

  /**
   * Connect to NATS server using WebSocket
   */
  async connect(): Promise<void> {
    if (this.state.status === 'connected') {
      return;
    }

    this.setState('connecting');
    this.clearReconnectTimer();

    return new Promise((resolve, reject) => {
      try {
        // Convert NATS servers to WebSocket URLs
        const wsUrl = this.getWebSocketUrl();
        this.websocket = new WebSocket(wsUrl);
        this.websocket.binaryType = 'arraybuffer';

        this.websocket.onopen = () => {
          this.setState('connected');
          this.state.connectedServer = wsUrl;
          resolve();
        };

        this.websocket.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.websocket.onclose = (event) => {
          this.handleClose(event);
        };

        this.websocket.onerror = (error) => {
          const err = new Error('WebSocket connection error');
          this.setState('error', err);
          reject(err);
        };

        // Set connection timeout
        setTimeout(() => {
          if (this.state.status === 'connecting') {
            this.websocket?.close();
            const err = new Error('Connection timeout');
            this.setState('error', err);
            reject(err);
          }
        }, this.options.timeout);

      } catch (error) {
        this.setState('error', error as Error);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    
    // Cancel pending requests
    for (const [id, request] of this.pendingRequests.entries()) {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    this.setState('disconnected');
  }

  /**
   * Publish a message to a subject
   */
  async publish(subject: string, data: Uint8Array): Promise<void> {
    if (!this.websocket || this.state.status !== 'connected') {
      throw new Error('Not connected to NATS server');
    }

    try {
      const message = this.createPublishMessage(subject, data);
      this.websocket.send(message);
    } catch (error) {
      this.setState('error', error as Error);
      throw error;
    }
  }

  /**
   * Send a request and wait for response
   */
  async request(subject: string, data: Uint8Array, timeout?: number): Promise<Uint8Array> {
    if (!this.websocket || this.state.status !== 'connected') {
      throw new Error('Not connected to NATS server');
    }

    const requestId = (++this.messageId).toString();
    const requestTimeout = timeout || this.options.timeout;

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout after ${requestTimeout}ms`));
      }, requestTimeout);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      try {
        const message = this.createRequestMessage(subject, data, requestId);
        this.websocket!.send(message);
      } catch (error) {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(requestId);
        this.setState('error', error as Error);
        reject(error);
      }
    });
  }

  /**
   * Handle implementation-specific subscription
   */
  protected handleSubscription(subject: string, handler: (data: Uint8Array) => void): void {
    if (this.websocket && this.state.status === 'connected') {
      this.sendSubscribeMessage(subject);
    }
  }

  /**
   * Handle implementation-specific unsubscription
   */
  protected handleUnsubscription(subject: string): void {
    if (this.websocket && this.state.status === 'connected') {
      this.sendUnsubscribeMessage(subject);
    }
  }

  /**
   * Get WebSocket URL from NATS server list
   */
  private getWebSocketUrl(): string {
    const server = Array.isArray(this.options.servers) 
      ? this.options.servers[0] 
      : this.options.servers;

    if (!server) {
      throw new Error('No NATS server URL provided');
    }

    // Convert NATS URL to WebSocket URL if needed
    if (server.startsWith('nats://')) {
      return server.replace('nats://', 'ws://');
    }
    if (server.startsWith('tls://')) {
      return server.replace('tls://', 'wss://');
    }
    
    return server;
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const data = new Uint8Array(event.data);
      const message = this.parseMessage(data);

      switch (message.type) {
        case 'msg':
          this.emitToSubscribers(message.subject, message.data);
          break;
        case 'response':
          this.handleResponse(message.requestId, message.data);
          break;
        case 'error':
          console.error('Server error:', message.error);
          break;
      }
    } catch (error) {
      console.error('Message parsing error:', error);
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(event: CloseEvent): void {
    this.websocket = null;
    
    if (event.wasClean) {
      this.setState('disconnected');
    } else {
      this.setState('error', new Error(`Connection lost: ${event.reason}`));
    }
  }

  /**
   * Handle request response
   */
  private handleResponse(requestId: string, data: Uint8Array): void {
    const request = this.pendingRequests.get(requestId);
    if (request) {
      clearTimeout(request.timeout);
      this.pendingRequests.delete(requestId);
      request.resolve(data);
    }
  }

  /**
   * Create publish message
   */
  private createPublishMessage(subject: string, data: Uint8Array): ArrayBuffer {
    const message = {
      type: 'pub',
      subject,
      data: Array.from(data), // Convert to array for JSON serialization
    };
    
    return new TextEncoder().encode(JSON.stringify(message));
  }

  /**
   * Create request message
   */
  private createRequestMessage(subject: string, data: Uint8Array, requestId: string): ArrayBuffer {
    const message = {
      type: 'req',
      subject,
      requestId,
      data: Array.from(data), // Convert to array for JSON serialization
    };
    
    return new TextEncoder().encode(JSON.stringify(message));
  }

  /**
   * Send subscribe message
   */
  private sendSubscribeMessage(subject: string): void {
    if (!this.websocket) return;

    const message = {
      type: 'sub',
      subject,
    };
    
    this.websocket.send(new TextEncoder().encode(JSON.stringify(message)));
  }

  /**
   * Send unsubscribe message
   */
  private sendUnsubscribeMessage(subject: string): void {
    if (!this.websocket) return;

    const message = {
      type: 'unsub',
      subject,
    };
    
    this.websocket.send(new TextEncoder().encode(JSON.stringify(message)));
  }

  /**
   * Parse incoming message
   */
  private parseMessage(data: Uint8Array): any {
    const text = new TextDecoder().decode(data);
    const parsed = JSON.parse(text);
    
    // Convert data array back to Uint8Array if present
    if (parsed.data && Array.isArray(parsed.data)) {
      parsed.data = new Uint8Array(parsed.data);
    }
    
    return parsed;
  }
}