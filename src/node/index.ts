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
  OriginContext,
} from '../types';
import { NodeStateContainer } from '../state';
import { PatternEngine } from '../patterns';
import { processContinuum } from '../continuum';
import { createEvent, validateEvent } from '../events';
import { generateNodeId } from '../utils/id';

/**
 * Default node options
 */
const DEFAULT_OPTIONS: Required<NodeOptions> = {
  state: {},
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
  
  constructor(
    name: string,
    options: NodeOptions<T> = {},
    globalState: GlobalState
  ) {
    this.id = generateNodeId(name);
    this.options = { ...DEFAULT_OPTIONS, ...options } as Required<NodeOptions<T>>;
    this.state = new NodeStateContainer(this.options.state);
    this.global = globalState;
    this.patterns = new PatternEngine();
  }
  
  /**
   * Register an event handler
   */
  on(pattern: Pattern, handler: EventHandler): () => void {
    return this.patterns.add(pattern, async (event) => {
      // Check acceptance
      if (!this.options.accept(event.context.origin)) {
        return;
      }
      
      // Process through continuum
      await processContinuum(handler, event, this.id);
    });
  }
  
  /**
   * Send an event to a specific target
   */
  async send(target: HappenNode | ID, event: Partial<HappenEvent>): Promise<void> {
    const targetId = typeof target === 'string' ? target : target.id;
    const fullEvent = this.createOutgoingEvent(event);
    
    // In the real implementation, this would use NATS
    // For now, direct delivery if same node
    if (targetId === this.id) {
      this.emit(fullEvent);
    } else {
      // This will be implemented with NATS transport
      throw new Error('Cross-node communication not yet implemented');
    }
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
    
    // Wait for current processing to complete
    while (this.processing > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  
  /**
   * Create a complete event from partial data
   */
  private createOutgoingEvent(partial: Partial<HappenEvent>): HappenEvent {
    const origin: OriginContext = {
      ...partial.context?.origin,
      nodeId: this.id, // Always override with emitting node ID
    };
    
    return createEvent(
      partial.type || 'unknown',
      partial.payload,
      {
        ...partial.context,
        origin,
      }
    );
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
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
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
      }));
    }
  }
}