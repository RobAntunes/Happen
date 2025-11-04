/**
 * Node - The primary actor in a Happen system
 * Independent, autonomous component that processes events
 */

import type {
  HappenEvent,
  EventPattern,
  EventHandler,
  NodeConfig,
  BroadcastOptions,
  NodeState,
  StateSetter,
  StateGetter,
  EventSecurityPolicy
} from './types.js';
import { normalizePattern } from './patterns.js';
import { processEventContinuum, processEventContinuumSync } from './continuum.js';
import { buildEventFromOptions, createDerivedEvent } from './causality.js';
import type { NatsConnectionManager } from './nats-connection.js';
import type { KV } from 'nats';
import { createViews, expectsViews } from './views.js';
import { wrapZeroAllocationHandler, type ZeroAllocationHandler } from './zero-allocation.js';
import { createSecurityGates } from './security.js';

interface EventHandlerRegistration {
  pattern: (eventType: string) => boolean;
  handler: EventHandler;
}

/**
 * Node class - represents an autonomous component in the Happen system
 */
export class HappenNode {
  private id: string;
  private config: NodeConfig;
  private natsManager: NatsConnectionManager;
  private handlers: EventHandlerRegistration[] = [];
  private kvStore: KV | null = null;
  private subscription: any = null;
  private nodeRegistry: Map<string, HappenNode>;

  constructor(
    id: string,
    natsManager: NatsConnectionManager,
    nodeRegistry: Map<string, HappenNode>,
    config: NodeConfig = {}
  ) {
    this.id = id;
    this.config = config;
    this.natsManager = natsManager;
    this.nodeRegistry = nodeRegistry;
  }

  /**
   * Get the node's unique identifier
   */
  getId(): string {
    return this.id;
  }

  /**
   * Initialize the node (subscribe to events)
   */
  async initialize(): Promise<void> {
    // Subscribe to broadcast channel (all nodes receive these)
    this.subscription = this.natsManager.subscribe(
      'happen.broadcast',
      async (data: any) => {
        await this.handleIncomingEvent(data);
      }
    );

    // Subscribe to node-specific channel
    this.natsManager.subscribe(
      `happen.node.${this.id}`,
      async (data: any) => {
        await this.handleIncomingEvent(data);
      }
    );

    // Initialize state if persistent
    if (this.config.persistent) {
      this.kvStore = await this.natsManager.getKVStore(`node-${this.id}`);
    }
  }

  /**
   * Register an event handler
   * If security policies are configured for this event type,
   * automatically prepends the three security gates:
   * 1. Signature verification (AuthN - Who?)
   * 2. Schema hash verification (Interface Control - How?)
   * 3. Role authorization (AuthZ - What?)
   */
  on(pattern: EventPattern, handler: EventHandler): void {
    const matcher = normalizePattern(pattern);
    
    // Check if this is a string pattern and has a security policy
    let finalHandler = handler;
    
    if (typeof pattern === 'string' && this.config.policies?.[pattern]) {
      // Security policies exist for this event type
      const policy = this.config.policies[pattern];
      
      // Create the three security gates
      const gates = createSecurityGates(
        pattern,
        policy.schemaHash,
        policy.allowedRoles,
        policy.customAuth
      );
      
      // Create a chain: Gate1 -> Gate2 -> Gate3 -> Business Logic
      // The gates return each other in sequence, finally returning null
      // which tells the continuum to proceed to the business handler
      const secureHandler: EventHandler = (event, context) => {
        // Start with Gate 1 (signature verification)
        // Each gate returns the next gate, forming a chain
        // The final gate returns null, which means "continue"
        // Then we invoke the actual business logic handler
        return gates.verifySignature(event, context);
      };
      
      // Wrap to ensure business logic runs after all gates pass
      finalHandler = async (event, context) => {
        // Run security gates
        let current: any = secureHandler;
        while (typeof current === 'function') {
          const result = await current(event, context);
          // If gate returns null, all security checks passed
          if (result === null) {
            break;
          }
          current = result;
        }
        
        // All gates passed, run business logic
        return handler(event, context);
      };
    }
    
    this.handlers.push({
      pattern: matcher,
      handler: finalHandler
    });
  }

  /**
   * Register a zero-allocation event handler for high-performance processing
   * Handler receives raw buffer with offset/length - no object allocation!
   *
   * Example:
   *   node.onZeroAllocation('metrics', (buf, offset, length, meta) => {
   *     const reader = new BufferReader(buf, offset);
   *     const value = reader.readDouble();
   *     // Process without creating objects!
   *   });
   */
  onZeroAllocation(pattern: EventPattern, handler: ZeroAllocationHandler): void {
    const matcher = normalizePattern(pattern);
    // Wrap zero-allocation handler to work with regular event flow
    const wrappedHandler = wrapZeroAllocationHandler(handler);
    this.handlers.push({
      pattern: matcher,
      handler: wrappedHandler as EventHandler
    });
  }

  /**
   * Broadcast an event to all nodes
   */
  async broadcast(options: BroadcastOptions): Promise<void> {
    const event = buildEventFromOptions(options, this.id);
    await this.natsManager.publish('happen.broadcast', event);
  }

  /**
   * Send an event to a specific node
   */
  async send(nodeId: string, options: BroadcastOptions): Promise<void> {
    const event = buildEventFromOptions(options, this.id);
    await this.natsManager.publish(`happen.node.${nodeId}`, event);
  }

  /**
   * Process an event or batch of events and return the result
   * Useful for request-response patterns
   * Supports Confluence batch processing
   */
  async process<T = any, R = any>(
    eventOrEvents: HappenEvent<T> | HappenEvent<T>[]
  ): Promise<R | null> {
    // Handle batch processing (Confluence fan-in)
    if (Array.isArray(eventOrEvents)) {
      const events = eventOrEvents;

      if (events.length === 0) {
        return null;
      }

      // Find handlers that match any event in the batch
      const firstEvent = events[0];
      const matchingHandlers = this.handlers.filter(h =>
        h.pattern(firstEvent.type)
      );

      if (matchingHandlers.length === 0) {
        return null;
      }

      // Create batch context
      const batchContext = {
        causal: firstEvent.context.causal,
        events: events.map(e => e.context),
        receivedAt: Date.now()
      };

      // Call handler with array of events
      const result = await matchingHandlers[0].handler(
        events as any,
        batchContext as any
      );

      return result;
    }

    // Single event processing
    const event = eventOrEvents;
    const matchingHandlers = this.handlers.filter(h =>
      h.pattern(event.type)
    );

    if (matchingHandlers.length === 0) {
      return null;
    }

    // Process with the first matching handler
    const result = await processEventContinuum(
      event,
      matchingHandlers[0].handler
    );

    return result.success ? result.result : null;
  }

  /**
   * Process an event synchronously
   */
  processSync<T = any, R = any>(event: HappenEvent<T>): R | null {
    const matchingHandlers = this.handlers.filter(h =>
      h.pattern(event.type)
    );

    if (matchingHandlers.length === 0) {
      return null;
    }

    const result = processEventContinuumSync(
      event,
      matchingHandlers[0].handler
    );

    return result.success ? result.result : null;
  }

  /**
   * Handle incoming event from NATS
   */
  private async handleIncomingEvent(eventData: any): Promise<void> {
    try {
      const event = eventData as HappenEvent;

      // Find all matching handlers
      const matchingHandlers = this.handlers.filter(h =>
        h.pattern(event.type)
      );

      // Execute each matching handler
      for (const registration of matchingHandlers) {
        try {
          await processEventContinuum(event, registration.handler);
        } catch (error) {
          console.error(
            `[Happen] Error in handler for ${event.type} on node ${this.id}:`,
            error
          );
        }
      }
    } catch (error) {
      console.error(
        `[Happen] Error handling incoming event on node ${this.id}:`,
        error
      );
    }
  }

  /**
   * Access node state
   */
  get state(): NodeState {
    return {
      get: async <R = any>(transformer?: StateGetter<any, R>): Promise<R> => {
        if (!this.kvStore) {
          throw new Error(
            `Node ${this.id} does not have persistent state enabled`
          );
        }

        try {
          const entry = await this.kvStore.get('state');
          if (!entry) {
            // Return empty state if none exists
            const emptyState = {};
            return transformer ? transformer(emptyState) : (emptyState as R);
          }

          const state = JSON.parse(entry.string());
          return transformer ? transformer(state) : state;
        } catch (error: any) {
          // If key doesn't exist, return empty state
          if (error.code === '404') {
            const emptyState = {};
            return transformer ? transformer(emptyState) : (emptyState as R);
          }
          throw error;
        }
      },

      set: async (transformer: StateSetter): Promise<void> => {
        if (!this.kvStore) {
          throw new Error(
            `Node ${this.id} does not have persistent state enabled`
          );
        }

        // Get current state
        let currentState = {};
        try {
          const entry = await this.kvStore.get('state');
          if (entry) {
            currentState = JSON.parse(entry.string());
          }
        } catch (error: any) {
          // If key doesn't exist, start with empty state
          if (error.code !== '404') {
            throw error;
          }
        }

        // Create views if transformer expects them
        let newState;
        if (expectsViews(transformer)) {
          const views = createViews(this, this.nodeRegistry);
          newState = await transformer(currentState, views);
        } else {
          newState = await transformer(currentState);
        }

        // Save new state
        await this.kvStore.put('state', JSON.stringify(newState));
      }
    };
  }

  /**
   * Shutdown the node
   */
  async shutdown(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }
}
