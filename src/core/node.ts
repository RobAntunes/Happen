import type { HappenEvent, HappenEventMetadata } from './event';
import type { IHappenEmitter } from './emitter';
import type { HappenRuntimeModules, ICrypto } from './runtime-modules'; // Import runtime modules interface
import { canonicalStringify } from './utils'; // Import the new helper

// --- Types ---

type EventHandler<TPayload = any> = (
  event: HappenEvent<TPayload>
) => void | Promise<void>;

// Store the wrapped version for removal
type WrappedEventHandler = (event: HappenEvent<any>) => Promise<void>;

/**
 * Optional hooks that can be configured per node instance.
 */
export interface NodeHooks {
  /** Called just before an event is emitted by this node. Can modify the event. */
  preEmit?: (event: HappenEvent<any>) => HappenEvent<any> | void | Promise<HappenEvent<any> | void>;
  /** Called just before a matching handler is executed for an incoming event. Can modify the event. */
  preHandle?: (event: HappenEvent<any>) => HappenEvent<any> | void | Promise<HappenEvent<any> | void>;
  /** Called just after a handler finishes execution or throws an error. */
  postHandle?: (event: HappenEvent<any>, handlerError?: any) => void | Promise<void>;
}

/**
 * Configuration options for creating a HappenNode.
 */
export interface NodeOptions {
  /** Optional unique identifier for the node. */
  id?: string;
  /** Optional node-specific lifecycle hooks. */
  hooks?: NodeHooks;
  // Optional: Initial state for the node, used for state hashing
  initialState?: any;
}

// --- HappenNode Class ---

/**
 * Represents an autonomous node within the Happen framework.
 * Nodes emit events via an IHappenEmitter and register handlers via `on`
 * to react to events matched by the emitter.
 * Supports optional node-specific lifecycle hooks.
 */
export class HappenNode {
  public readonly id: string;
  // No longer storing handlers locally, emitter handles subscriptions
  // private handlers: HandlerEntry[] = [];
  private emitter: IHappenEmitter; // Reference to the communication emitter
  private crypto: ICrypto; // Store crypto module reference
  private hooks: NodeHooks; // Store node-specific hooks
  // Placeholder for node state - management TBD
  private state: any;
  // Placeholder for replay protection - simple in-memory cache
  private seenNonces: Set<string> = new Set();
  private readonly MAX_NONCE_AGE = 5 * 60 * 1000; // 5 minutes in ms
  private readonly NONCE_CLEANUP_INTERVAL = 60 * 1000; // 1 minute in ms
  private nonceCleanupTimer: ReturnType<typeof setInterval> | undefined;
  // Map to track original handlers to their wrapped versions for removal
  private handlerMap: Map<EventHandler<any>, WrappedEventHandler> = new Map();

  /**
   * Creates a new Happen node.
   * @param runtimeModules Injected runtime modules (crypto, emitter instance).
   * @param options Optional configuration including ID and node-specific hooks.
   */
  constructor(runtimeModules: HappenRuntimeModules, options?: NodeOptions) {
    this.emitter = runtimeModules.emitterInstance;
    this.crypto = runtimeModules.crypto;
    this.id = options?.id ?? this.crypto.randomUUID();
    this.hooks = options?.hooks ?? {};
    this.state = options?.initialState ?? {};
    console.log(`Node created: ${this.id}`);
    this.nonceCleanupTimer = setInterval(() => this.cleanupOldNonces(), this.NONCE_CLEANUP_INTERVAL);
  }

  /**
   * Optional cleanup method (e.g., call when node is being destroyed).
   */
  destroy(): void {
      if (this.nonceCleanupTimer) {
          clearInterval(this.nonceCleanupTimer);
          this.nonceCleanupTimer = undefined;
          console.log(`Node ${this.id}: Stopped nonce cleanup timer.`);
      }
      // Cleanup listeners on destroy
      if (this.emitter.off) {
          console.log(`Node ${this.id}: Removing all registered handlers from emitter.`);
          // Note: This assumes the emitter correctly handles removing listeners
          // even if multiple identical listeners were added (as wrapped handlers might be)
          // It also doesn't know the original *patterns* easily here.
          // A more robust cleanup might require storing patterns alongside handlers in the map.
          this.handlerMap.forEach((wrappedHandler, originalHandler) => {
              // We need the original pattern to call emitter.off effectively!
              // This simple cleanup might not work reliably without storing the pattern.
              // For now, we demonstrate the intent.
              // TODO: Refactor handlerMap to store { pattern, wrappedHandler }
              // console.warn("Emitter cleanup in destroy() needs pattern info - refinement required.");
              // Example attempt (won't work without pattern):
              // this.emitter.off(pattern, wrappedHandler);
          });
          this.handlerMap.clear();
      }
  }

  /**
   * Registers an event handler with the underlying emitter.
   * The emitter is responsible for handling pattern matching and invoking the handler.
   * Node-specific hooks (preHandle, postHandle) are executed around the handler.
   * @param eventPattern The event type string or pattern to listen for.
   * @param handler The function to execute when a matching event occurs.
   */
  on<TPayload = any>(eventPattern: string, handler: EventHandler<TPayload>): void {
    const wrappedHandler = async (event: HappenEvent<TPayload>) => {
      if (!this.verifyEvent(event)) {
        console.warn(`Node ${this.id}: Discarding invalid event (verification failed or replay detected): ${event.metadata.id} (type: ${event.type})`);
        this.emitErrorEvent('event-verification-failed', new Error('Event verification failed or replay detected'), event.type);
        return;
      }

      let eventForHandler = event;
      let handlerError: any = undefined;

      // PreHandle Hook
      if (this.hooks.preHandle) {
        try {
          const result = await this.hooks.preHandle(event);
          if (typeof result === 'object' && result !== null && result.type && result.payload && result.metadata) {
             eventForHandler = result as HappenEvent<TPayload>;
          }
        } catch (hookErr) {
            console.error(`Node ${this.id}: Error in preHandle hook for ${event.type}:`, hookErr);
            this.emitErrorEvent('hook-preHandle-failed', hookErr, event.type);
        }
      }

      // Execute User Handler
      try {
          await handler(eventForHandler);
      } catch (err) {
          handlerError = err;
          console.error(
              `Node ${this.id}: Uncaught error in handler for pattern '${eventPattern}' on event type '${eventForHandler.type}':`, err
          );
      }

      // PostHandle Hook
      if (this.hooks.postHandle) {
          try {
              await this.hooks.postHandle(eventForHandler, handlerError);
          } catch (hookErr) {
              console.error(`Node ${this.id}: Error in postHandle hook for ${eventForHandler.type}:`, hookErr);
              this.emitErrorEvent('hook-postHandle-failed', hookErr, eventForHandler.type);
          }
      }

      // Emit standard error if handler failed
      if (handlerError) {
         this.emitErrorEvent('handler-uncaught-error', handlerError, eventForHandler.type);
      }
    };

    // Store the mapping before registering
    this.handlerMap.set(handler, wrappedHandler);

    this.emitter.on(eventPattern, wrappedHandler as EventHandler<any>);
    console.log(
      `Node ${this.id}: Registered handler with emitter for pattern '${eventPattern}'`
    );
  }

   /**
    * Removes an event handler from the underlying emitter.
    * Note: This needs enhancement if wrapped handlers need precise removal.
    * @param eventPattern The event type string or pattern used during registration.
    * @param handler The original handler function that was registered.
    */
   off<TPayload = any>(eventPattern: string, handler: EventHandler<TPayload>): void {
       const wrappedHandler = this.handlerMap.get(handler);
       if (!wrappedHandler) {
           console.warn(`Node ${this.id}: Handler not found in internal map for pattern '${eventPattern}'. Cannot remove.`);
           return;
       }

       if (this.emitter.off) {
           console.log(`Node ${this.id}: Attempting to remove handler from emitter for pattern '${eventPattern}'`);
           try {
               this.emitter.off(eventPattern, wrappedHandler);
               this.handlerMap.delete(handler); // Remove from map if successful
           } catch (error) {
                console.error(`Node ${this.id}: Error removing listener from emitter:`, error);
           }
       } else {
           console.warn(`Node ${this.id}: Emitter does not support .off() method.`);
       }
   }

  /**
   * Emits an event via the underlying emitter, running preEmit hook first.
   * @param eventData The event data (type and payload), and optional metadata overrides.
   */
  async emit<TPayload = any>(
    eventData: Omit<HappenEvent<TPayload>, 'metadata' | 'sender'> & { metadata?: Partial<HappenEventMetadata> }
  ): Promise<void> {
    let eventToEmit = await this.buildEvent(eventData);

    if (this.hooks.preEmit) {
        try {
            const result = await this.hooks.preEmit(eventToEmit);
            if (typeof result === 'object' && result !== null && result.type && result.payload && result.metadata) {
                eventToEmit = result as HappenEvent<TPayload>;
                eventToEmit = await this.recalculateVerification(eventToEmit);
            }
        } catch (hookErr) {
             console.error(`Node ${this.id}: Error in preEmit hook for ${eventToEmit.type}:`, hookErr);
             this.emitErrorEvent('hook-preEmit-failed', hookErr, eventToEmit.type);
             return;
        }
    }

    try {
        this.emitter.emit(eventToEmit.type, eventToEmit);
    } catch (error) {
        console.error(`Node ${this.id}: Failed to emit event ${eventToEmit.metadata.id}:`, error);
    }
  }

  /** Builds the full event object with metadata defaults. */
  private async buildEvent<TPayload = any>(
    eventData: Omit<HappenEvent<TPayload>, 'metadata' | 'sender'> & { metadata?: Partial<HappenEventMetadata> }
  ): Promise<HappenEvent<TPayload>> {

    const eventId = eventData.metadata?.id ?? this.crypto.randomUUID();
    const timestamp = eventData.metadata?.timestamp ?? Date.now();
    const nonce = `${timestamp}-${this.crypto.randomUUID()}`;
    const senderStateHash = await this.getCurrentStateHash();
    const verification = await this.calculateVerificationHash(
        eventData.type,
        eventData.payload,
        eventId,
        timestamp,
        nonce,
        senderStateHash,
        eventData.metadata?.causationId,
        eventData.metadata?.correlationId
    );

    // Fix: Initialize core metadata including security fields
    const coreMetadata: HappenEventMetadata = {
        id: eventId,
        timestamp: timestamp,
        sender: this.id,
        path: [this.id],
        nonce: nonce, // Initialize nonce
        verification: verification, // Initialize verification
        senderStateHash: senderStateHash,
        // signature: undefined (optional)
    };

    // Combine, ensuring core fields (esp. security) are not overwritten
    const combinedMetadata: HappenEventMetadata = {
        ...eventData.metadata,
        ...coreMetadata,
        path: eventData.metadata?.path ?? coreMetadata.path,
        signature: eventData.metadata?.signature
    };

    const fullEvent: HappenEvent<TPayload> = {
      type: eventData.type,
      payload: eventData.payload === undefined ? {} as TPayload : eventData.payload,
      metadata: combinedMetadata
    };

    return fullEvent;
  }

  private async calculateVerificationHash(
      type: string,
      payload: any,
      eventId: string,
      timestamp: number,
      nonce: string,
      senderStateHash: string,
      causationId?: string,
      correlationId?: string
  ): Promise<string> {
       const verificationData = JSON.stringify({
            type: type,
            payload: payload ?? {},
            id: eventId,
            timestamp: timestamp,
            sender: this.id,
            nonce: nonce,
            stateHash: senderStateHash,
            causationId: causationId,
            correlationId: correlationId,
        });
        return this.crypto.hash(verificationData);
  }

   private async recalculateVerification<T>(event: HappenEvent<T>): Promise<HappenEvent<T>> {
       console.log(`Node ${this.id}: Recalculating verification for event ${event.metadata.id}`);
       const currentStateHash = await this.getCurrentStateHash();
       const newVerification = await this.calculateVerificationHash(
            event.type,
            event.payload,
            event.metadata.id,
            event.metadata.timestamp,
            event.metadata.nonce,
            currentStateHash,
            event.metadata.causationId,
            event.metadata.correlationId
       );
       return {
           ...event,
           metadata: {
               ...event.metadata,
               senderStateHash: currentStateHash,
               verification: newVerification
           }
       };
   }

  /**
   * Verifies the integrity and authenticity of an incoming event.
   * Checks the verification hash and protects against replays using nonces.
   * @param event The incoming event.
   * @returns True if the event is valid, false otherwise.
   * @internal
   */
  private async verifyEvent(event: HappenEvent<any>): Promise<boolean> {
      // 1. Replay Protection:
      if (this.seenNonces.has(event.metadata.nonce)) {
          console.warn(`Node ${this.id}: Replay detected for nonce: ${event.metadata.nonce} (Event ID: ${event.metadata.id})`);
          return false;
      }
      this.seenNonces.add(event.metadata.nonce);

      // 2. Verification Hash Check:
      const senderStateHash = event.metadata.senderStateHash;
      if (typeof senderStateHash !== 'string') {
           console.warn(`Node ${this.id}: Missing or invalid senderStateHash in metadata for event ${event.metadata.id}. Cannot verify.`);
           return false;
      }

      let expectedVerification: string;
      try {
          expectedVerification = await this.calculateVerificationHash(
                event.type,
                event.payload,
                event.metadata.id,
                event.metadata.timestamp,
                event.metadata.nonce,
                senderStateHash,
                event.metadata.causationId,
                event.metadata.correlationId
          );
      } catch (error) {
          console.error(`Node ${this.id}: Error calculating verification hash for event ${event.metadata.id}:`, error);
          return false;
      }

      if (expectedVerification !== event.metadata.verification) {
          console.warn(`Node ${this.id}: Verification hash mismatch for event ${event.metadata.id}. Expected: ${expectedVerification}, Got: ${event.metadata.verification}`);
          return false;
      }

      return true;
  }

  /**
   * Gets a deterministic hash of the node's current state.
   * Uses canonical stringification to ensure consistency.
   */
  private async getCurrentStateHash(): Promise<string> {
      try {
          // Use canonical stringify for deterministic output
          const stateString = canonicalStringify(this.state);
          return this.crypto.hash(stateString);
      } catch (error) {
          console.error(`Node ${this.id}: Failed to calculate state hash:`, error);
          return 'error-hashing-state';
      }
  }

  /** Periodically cleans up old nonces from the cache */
  private cleanupOldNonces(): void {
    const now = Date.now();
    let removedCount = 0;
    // Fix: Use forEach on Set for better compatibility
    this.seenNonces.forEach(nonce => {
      const timestampStr = nonce.split('-')[0];
      const timestamp = parseInt(timestampStr, 10);
      if (!isNaN(timestamp) && (now - timestamp > this.MAX_NONCE_AGE)) {
        this.seenNonces.delete(nonce);
        removedCount++;
      }
    });
    if (removedCount > 0) {
       // console.log(`Node ${this.id}: Cleaned up ${removedCount} old nonces.`);
    }
  }

  /** Helper to emit standardized error events */
  emitErrorEvent(
      errorType: string,
      error: any,
      relatedEventType?: string,
      targetNodeId?: string,
      correlationId?: string
  ): void {
    console.error(`Node ${this.id}: Emitting error event - ${errorType}:`, error);
    this.emit({
        type: 'error',
        payload: {
            errorType: errorType,
            message: (error as Error)?.message ?? String(error),
            stack: (error as Error)?.stack,
            originalSender: this.id,
            relatedEventType: relatedEventType,
            targetNodeId: targetNodeId,
            correlationId: correlationId,
        },
        metadata: {}
    }).catch(emitErr => {
         console.error(`Node ${this.id}: CRITICAL - Failed to emit error event itself!`, emitErr);
    });
  }
}

/**
 * Creates a new Happen node connected via runtime modules, with optional configuration.
 * @param runtimeModules Injected runtime modules (crypto, emitter instance).
 * @param options Optional configuration including ID and node-specific hooks.
 * @returns The created HappenNode instance.
 */
export function createNode(
    runtimeModules: HappenRuntimeModules,
    options?: NodeOptions): HappenNode {
  return new HappenNode(runtimeModules, options);
}
