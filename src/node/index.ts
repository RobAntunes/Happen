/**
 * Core HappenNode implementation
 */

import {
  HappenNode,
  NodeOptions,
  NodeState,
  GlobalState,
  Pattern,
  EventHandler,
  HappenEvent,
  ID,
  SendResult,
} from '../types';
import { NodeStateContainer } from '../state';
import { PatternEngine } from '../patterns';
import { processContinuum } from '../continuum';
import { createEvent, validateEvent } from '../events';
import { generateNodeId } from '../utils/id';
import { getGlobalViewRegistry } from '../views';
import { 
  getGlobalIdentityProvider, 
  NodeIdentity,
  KeyPair 
} from '../identity';

/**
 * Default node options
 */
const DEFAULT_OPTIONS: Required<NodeOptions> = {
  state: {},
  acceptFrom: [],
  accept: () => true,
  concurrency: 10,
  timeout: 30000,
};

/**
 * Core node implementation
 */
export class HappenNodeImpl<T = any> implements HappenNode<T> {
  public readonly id: ID;
  public readonly state: NodeState<T>;
  public readonly global: GlobalState;
  
  private patterns: PatternEngine;
  private options: Required<NodeOptions<T>>;
  private running = false;
  private eventQueue: HappenEvent[] = [];
  private processing = 0;
  private identity: NodeIdentity | null = null;
  private keyPair: KeyPair | null = null;
  private activeTimeouts = new Set<NodeJS.Timeout>();
  private pendingResponses = new Map<string, {
    reject: (error: Error) => void;
    cleanup: () => void;
    timeoutId: NodeJS.Timeout;
  }>();
  
  constructor(
    name: string,
    options: NodeOptions<T> = {},
    globalState: GlobalState
  ) {
    this.id = generateNodeId(name);
    this.options = { ...DEFAULT_OPTIONS, ...options } as Required<NodeOptions<T>>;
    this.state = new NodeStateContainer(this.options.state, this.id);
    this.global = globalState;
    this.patterns = new PatternEngine();
    
    // Register with view registry for cross-node state access
    getGlobalViewRegistry().registerNode(this);
    
    // Initialize identity if enabled
    this.initializeIdentity();
  }
  
  /**
   * Register an event handler
   */
  on(pattern: Pattern, handler: EventHandler): () => void {
    return this.patterns.add(pattern, async (event) => {
      // Check acceptance - simple array lookup with pattern matching
      if (!this.shouldAcceptEvent(event.context.causal.sender)) {
        return;
      }
      
      // Process through continuum
      await processContinuum(handler, event, this.id);
    });
  }
  
  /**
   * Send an event to a specific target or array of targets
   */
  send(target: HappenNode | HappenNode[] | ID, eventOrEvents: Partial<HappenEvent> | Partial<HappenEvent>[]): SendResult {
    // Handle array of target nodes - fan out pattern
    if (Array.isArray(target)) {
      const sendResults = new Map<string, SendResult>();
      
      // Send from this node to each target node
      target.forEach(node => {
        const result = this.send(node, eventOrEvents);
        sendResults.set(node.id, result);
      });

      // Return aggregated results
      return {
        return: async () => {
          const results: Record<string, any> = {};
          
          for (const [nodeId, sendResult] of sendResults) {
            try {
              results[nodeId] = await sendResult.return();
            } catch (error) {
              results[nodeId] = { error: error instanceof Error ? error.message : String(error) };
            }
          }
          
          return results;
        }
      };
    }

    const targetNode = typeof target === 'string' ? this : target; // For now, assume same node
    const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];
    
    // For batch sends, we'll just process all events without waiting for responses
    if (events.length > 1) {
      events.forEach(event => {
        const fullEvent = this.createOutgoingEvent(event);
        targetNode.emit(fullEvent);
      });
      
      return {
        return: () => Promise.resolve(undefined)
      };
    }
    
    // For single event, support request-response
    const event = events[0];
    if (!event) {
      return {
        return: () => Promise.resolve(undefined)
      };
    }
    const fullEvent = this.createOutgoingEvent(event);
    
    // Create a promise that will be resolved with the response
    let responseResolve: ((value: any) => void) | null = null;
    let responseReject: ((error: any) => void) | null = null;
    const responsePromise = new Promise((resolve, reject) => {
      responseResolve = resolve;
      responseReject = reject;
    });
    
    // Set up a one-time response handler BEFORE emitting
    const responsePattern = `${fullEvent.id}.response`;
    const cleanup = targetNode.on(responsePattern, (responseEventOrEvents) => {
      const responseEvent = Array.isArray(responseEventOrEvents) ? responseEventOrEvents[0] : responseEventOrEvents;
      cleanup(); // Unsubscribe after receiving response
      this.pendingResponses.delete(fullEvent.id);
      if (responseResolve && responseEvent) {
        responseResolve(responseEvent.payload);
      }
      return undefined; // Complete the flow
    });
    
    // Set a timeout for the response
    const timeoutId = setTimeout(() => {
      cleanup();
      this.activeTimeouts.delete(timeoutId);
      this.pendingResponses.delete(fullEvent.id);
      if (responseReject) {
        responseReject(new Error('Response timeout'));
      }
    }, this.options.timeout);
    
    // Track the timeout and pending response
    this.activeTimeouts.add(timeoutId);
    this.pendingResponses.set(fullEvent.id, {
      reject: responseReject!,
      cleanup,
      timeoutId
    });
    
    // Clear timeout if response comes back
    responsePromise.finally(() => {
      clearTimeout(timeoutId);
      this.activeTimeouts.delete(timeoutId);
      this.pendingResponses.delete(fullEvent.id);
    });
    
    // Store a flag to track if return() has been called
    let returnCalled = false;
    
    // Immediately attach a catch handler to prevent unhandled rejections
    // We need to do this BEFORE the timeout can fire
    responsePromise.catch((error) => {
      // Use setImmediate to check after the current event loop
      setImmediate(() => {
        if (!returnCalled) {
          // In test environment, we expect timeouts - don't crash
          if (process.env.NODE_ENV === 'test' && error.message === 'Response timeout') {
            return;
          }
          // In production, log the error
          console.error('Unhandled response timeout:', error);
        }
      });
      // Return undefined to prevent propagation
      return undefined;
    });
    
    // Now emit the event
    targetNode.emit(fullEvent);
    
    // Return SendResult with return() method
    return {
      return: (callback?: (result: any) => void) => {
        returnCalled = true;
        if (callback) {
          // Create a new promise that handles the callback
          return new Promise((resolve, reject) => {
            responsePromise.then((result) => {
              callback(result);
              resolve(result);
            }).catch((error) => {
              // Don't call callback on error, just reject
              reject(error);
            });
          });
        }
        // Return the original promise, not the silentCatchPromise
        return responsePromise;
      }
    };
  }
  
  /**
   * Broadcast an event to all nodes
   */
  async broadcast(event: Partial<HappenEvent>): Promise<void> {
    const fullEvent = this.createOutgoingEvent(event);
    
    // In the real implementation, this would use NATS broadcast
    // For now, just emit locally
    this.emit(fullEvent);
  }
  
  /**
   * Emit an event locally
   */
  emit(event: Partial<HappenEvent>): void {
    const fullEvent = this.createOutgoingEvent(event);
    
    if (!this.running) {
      this.eventQueue.push(fullEvent);
      return;
    }
    
    this.processEvent(fullEvent);
  }
  
  /**
   * Start the node
   */
  async start(): Promise<void> {
    this.running = true;
    
    // Process queued events
    const queue = [...this.eventQueue];
    this.eventQueue = [];
    
    for (const event of queue) {
      this.processEvent(event);
    }
  }
  
  /**
   * Stop the node
   */
  async stop(): Promise<void> {
    this.running = false;
    
    // Clear all pending responses without rejecting them
    // The promises already have catch handlers attached
    this.pendingResponses.forEach(({ cleanup, timeoutId }) => {
      clearTimeout(timeoutId);
      cleanup();
    });
    this.pendingResponses.clear();
    
    // Clear all active timeouts
    this.activeTimeouts.forEach(timeoutId => {
      clearTimeout(timeoutId);
    });
    this.activeTimeouts.clear();
    
    // Wait for current processing to complete
    while (this.processing > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Unregister from view registry
    getGlobalViewRegistry().unregisterNode(this.id);
  }
  
  /**
   * Create a complete event from partial data
   */
  private createOutgoingEvent(partial: Partial<HappenEvent>): HappenEvent {
    const event = createEvent(
      partial.type || 'unknown',
      partial.payload ?? {},  // Default to empty object if undefined
      partial.context,
      this.id // Always use emitting node ID as sender
    );
    
    // Ensure sender is always the emitting node
    event.context.causal.sender = this.id;
    
    return event;
  }
  
  /**
   * Process an event through all matching handlers
   */
  private async processEvent(event: HappenEvent): Promise<void> {
    if (!validateEvent(event)) {
      console.error('Invalid event received:', event);
      return;
    }
    
    const matchers = this.patterns.findMatches(event);
    
    if (matchers.length === 0) {
      return;
    }
    
    // Apply concurrency control
    while (this.processing >= this.options.concurrency) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.processing++;
    
    try {
      // Execute all matching handlers
      await Promise.all(
        matchers.map(matcher => 
          this.executeWithTimeout(
            async (event) => {
              await matcher.handler(event);
            }, 
            event
          )
        )
      );
    } finally {
      this.processing--;
    }
  }
  
  /**
   * Execute a handler with timeout
   */
  private async executeWithTimeout(
    handler: (event: HappenEvent) => Promise<void>,
    event: HappenEvent
  ): Promise<void> {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Handler timeout after ${this.options.timeout}ms`)),
        this.options.timeout
      );
    });
    
    try {
      await Promise.race([handler(event), timeoutPromise]);
    } catch (error) {
      // Log error but don't crash the node
      console.error('Handler error:', error);
      
      // Emit error event
      this.emit(createEvent('system.error', {
        error: error instanceof Error ? error.message : String(error),
        eventId: event.id,
        eventType: event.type,
      }, undefined, this.id));
    } finally {
      // Always clear the timeout
      clearTimeout(timeoutId!);
    }
  }

  /**
   * Initialize cryptographic identity for the node
   */
  private async initializeIdentity(): Promise<void> {
    try {
      const identityProvider = getGlobalIdentityProvider();
      
      // Generate key pair for the node
      this.keyPair = await identityProvider.generateKeyPair();
      
      // Create identity certificate
      this.identity = await identityProvider.createIdentity(this.id, this.keyPair);
      
    } catch (error) {
      console.warn('Failed to initialize node identity:', error);
      // Continue without identity - graceful degradation
    }
  }

  /**
   * Check if event should be accepted based on acceptFrom array or custom accept function
   */
  private shouldAcceptEvent(senderId: string): boolean {
    // If acceptFrom array is provided, check against it first
    if (this.options.acceptFrom && this.options.acceptFrom.length > 0) {
      return this.matchesAnyPattern(senderId, this.options.acceptFrom);
    }
    
    // If custom accept function is provided, use it
    if (this.options.accept) {
      // For backward compatibility, create a minimal origin context
      return this.options.accept({ nodeId: senderId });
    }
    
    // Default: accept all
    return true;
  }

  /**
   * Simple pattern matching against array of patterns
   */
  private matchesAnyPattern(nodeId: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
      // Exact match
      if (pattern === nodeId) return true;
      
      // Wildcard pattern (e.g., "order-*")
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(nodeId);
      }
      
      return false;
    });
  }

  /**
   * Get node identity (if available)
   */
  getIdentity(): NodeIdentity | null {
    return this.identity;
  }

  /**
   * Get node public key (if available)
   */
  getPublicKey(): string | null {
    return this.identity?.publicKey || null;
  }

  /**
   * Sign data with node's private key
   */
  async signData(data: Uint8Array): Promise<string | null> {
    if (!this.keyPair) return null;
    
    const identityProvider = getGlobalIdentityProvider();
    return identityProvider.signData(data, this.keyPair.privateKey);
  }

  /**
   * Verify signature using a public key
   */
  async verifySignature(data: Uint8Array, signature: string, publicKey: string): Promise<boolean> {
    const identityProvider = getGlobalIdentityProvider();
    return identityProvider.verifySignature(data, signature, publicKey);
  }
}