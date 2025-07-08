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
  ZeroAllocationHandler,
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
import { TemporalStateConfig } from '../temporal';
import { 
  getGlobalZeroAllocationProcessor,
  wrapZeroAllocationHandler,
  ZeroAllocationHandler as ZeroHandler 
} from '../zero-allocation';

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
  private expectingResponse = new Set<string>(); // Track events expecting responses
  private temporalConfig?: TemporalStateConfig;
  
  constructor(
    name: string,
    options: NodeOptions<T> = {},
    globalState: GlobalState,
    temporalConfig?: TemporalStateConfig
  ) {
    this.id = generateNodeId(name);
    this.options = { ...DEFAULT_OPTIONS, ...options } as Required<NodeOptions<T>>;
    this.state = new NodeStateContainer(this.options.state, this.id);
    this.global = globalState;
    this.patterns = new PatternEngine();
    this.temporalConfig = temporalConfig;
    
    // Enable temporal recording if configured
    if (temporalConfig?.enabled) {
      this.state.enableTemporal();
    }
    
    // Register with view registry for cross-node state access
    getGlobalViewRegistry().registerNode(this);
    
    // Initialize identity if enabled
    this.initializeIdentity();
    
    // Auto-start the node - nodes should be ready to handle events immediately
    this.running = true;
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
      
      // Check if this event is expecting a response
      const expectsResponse = (event as any).expectsResponse === true;
      const responseResolve = (event as any).responseResolve;
      
      // Process through continuum and capture the return value
      // Create a wrapper that matches EventHandler signature
      const wrapperHandler: EventHandler = (eventOrEvents, context) => {
        // Since we're dealing with single events in this context, pass the event
        return handler(eventOrEvents, context);
      };
      
      const result = await processContinuum(wrapperHandler, event, this.id);
      
      // If we got a result and this event expects a response, resolve it
      if (expectsResponse && responseResolve) {
        // Check if result is an async generator or a regular value
        if (result && typeof result === 'object' && typeof result[Symbol.asyncIterator] === 'function') {
          // For async generators, resolve with the generator
          responseResolve(result);
        } else if (result !== undefined) {
          // For regular results, resolve if not undefined
          responseResolve(result);
        }
      }
    });
  }
  
  /**
   * Register a zero-allocation handler for performance-critical paths
   */
  zero(pattern: string, handler: ZeroAllocationHandler): () => void {
    // Get the global zero-allocation processor
    const processor = getGlobalZeroAllocationProcessor();
    
    // Wrap the zero-allocation handler as a regular event handler
    const wrappedHandler = wrapZeroAllocationHandler(
      processor, 
      pattern, 
      handler as ZeroHandler
    );
    
    // Register it through the normal pattern system
    return this.on(pattern, wrappedHandler);
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
    
    const responsePromise = new Promise<any>((resolve, reject) => {
      responseResolve = resolve;
      responseReject = reject;
    });
    
    // Attach a default catch handler to prevent unhandled rejection
    responsePromise.catch(() => {
      // Silently ignore - the error will be properly thrown when .return() is called
    });
    
    // Set a timeout for the response
    const timeoutId = setTimeout(() => {
      this.activeTimeouts.delete(timeoutId);
      this.expectingResponse.delete(fullEvent.id);
      if (responseReject) {
        responseReject(new Error('Response timeout'));
      }
    }, this.options.timeout);
    
    // Track the timeout
    this.activeTimeouts.add(timeoutId);
    this.expectingResponse.add(fullEvent.id);
    
    // Mark this event as expecting a response and attach the resolve function
    (fullEvent as any).expectsResponse = true;
    (fullEvent as any).responseResolve = (payload: any) => {
      clearTimeout(timeoutId);
      this.activeTimeouts.delete(timeoutId);
      this.expectingResponse.delete(fullEvent.id);
      
      // Check if payload is an async generator for streaming
      if (payload && typeof payload === 'object' && typeof payload[Symbol.asyncIterator] === 'function') {
        // Return the async generator directly for streaming
        responseResolve!(payload);
      } else {
        responseResolve!(payload);
      }
    };
    
    // Now emit the event
    targetNode.emit(fullEvent);
    
    // Return SendResult with return() method
    return {
      return: (callback?: (result: any) => void) => {
        if (callback) {
          // Create a new promise that handles the callback
          return responsePromise.then((result) => {
            // Check if result is an async generator
            if (result && typeof result === 'object' && typeof result[Symbol.asyncIterator] === 'function') {
              // For streaming results, call callback with the async iterator
              callback(result);
              return result;
            } else {
              // For regular results, call callback normally
              callback(result);
              return result;
            }
          });
        }
        
        // Return the original promise - it will resolve to either a regular value or async generator
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
  emit(event: Partial<HappenEvent> | HappenEvent): void {
    // If it's already a full event (has id), use it as-is
    const fullEvent = (event as HappenEvent).id 
      ? event as HappenEvent 
      : this.createOutgoingEvent(event);
    
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
      // Execute all matching handlers through continuum
      const results = await Promise.all(
        matchers.map(matcher => 
          this.executeWithTimeout(
            async (event) => {
              // Use continuum processor to handle flow control and generators
              // matcher.handler expects single event, but processContinuum expects EventHandler signature
              // We need to wrap it to match EventHandler signature
              const wrapperHandler: EventHandler = (_eventOrEvents, _context) => {
                // matcher.handler is from PatternEngine and expects single event
                return matcher.handler(event);
              };
              
              const result = await processContinuum(wrapperHandler, event, this.id);
              return result;
            },
            event
          )
        )
      );
      
      // Store results for potential streaming or send() operations
      this.storeProcessingResults(event, results);
    } finally {
      this.processing--;
    }
  }
  
  /**
   * Store processing results for send() operations
   */
  private storeProcessingResults(event: HappenEvent, results: any[]): void {
    // Store results mapped by event ID for send() operations
    if (this.expectingResponse.has(event.id)) {
      // Find any generator results
      const generatorResults = results.filter(result => 
        result && typeof result === 'object' && typeof result[Symbol.asyncIterator] === 'function'
      );
      
      // If we have generators, use the first one for streaming
      if (generatorResults.length > 0) {
        (event as any)._streamingResult = generatorResults[0];
      } else {
        // Use the first non-undefined result
        const finalResult = results.find(result => result !== undefined);
        (event as any)._result = finalResult;
      }
    }
  }

  /**
   * Execute a handler with timeout
   */
  private async executeWithTimeout(
    handler: (event: HappenEvent) => Promise<any>,
    event: HappenEvent
  ): Promise<any> {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Handler timeout after ${this.options.timeout}ms`)),
        this.options.timeout
      );
    });
    
    try {
      const result = await Promise.race([handler(event), timeoutPromise]);
      return result;
    } catch (error) {
      // Log error but don't crash the node
      console.error('Handler error:', error);
      
      // Emit error event
      this.emit(createEvent('system.error', {
        error: error instanceof Error ? error.message : String(error),
        eventId: event.id,
        eventType: event.type,
      }, undefined, this.id));
      
      // Return undefined on error
      return undefined;
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
  
  /**
   * Get the temporal store for this node
   */
  getTemporal() {
    return this.state.getTemporal();
  }
  
  /**
   * Enable temporal state recording
   */
  enableTemporal(): void {
    this.state.enableTemporal();
  }
  
  /**
   * Disable temporal state recording
   */
  disableTemporal(): void {
    this.state.disableTemporal();
  }
  
  /**
   * Get the temporal configuration for this node
   */
  getTemporalConfig(): TemporalStateConfig | undefined {
    return this.temporalConfig;
  }
}