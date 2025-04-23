import { IHappenEmitter, HappenListener, EventObserver, IHappenListenerDisposable, EmitterOptions } from './emitter';
import { HappenRuntimeModules, ICrypto, IEventEmitter } from './runtime-modules';
import { IHappenState, DefaultState } from './state';
import { HappenEvent, HappenEventMetadata } from './event';
import { HappenEventLog, IHappenEventLog } from './event-log';
import { HappenPublisher, IHappenPublisher } from './publisher';
import { HappenSubscriber, IHappenSubscriber, SubscribeReturnType } from './subscriber';
import { HappenValidator, IHappenValidator } from './validator';
import { HappenReplicator, IHappenReplicator } from './replicator';
import { HappenMerger, IHappenMerger } from './merger';
import { HappenSyncer, IHappenSyncer } from './syncer';
import { HappenStore, IHappenStore } from './store';
import { HappenHandler, IHappenHandler } from './handler';
import { HappenSchema, IHappenSchema } from './schema';
import { HappenPermission, IHappenPermission } from './permission';
import { PatternEmitter } from './PatternEmitter';

// --- Minimal Default Internal Emitter (if needed) ---
class MinimalEventEmitter implements IEventEmitter {
    listeners: Map<string | symbol, Function[]> = new Map();
    on(event: string | symbol, listener: (...args: any[]) => void): this {
        const list = this.listeners.get(event) || [];
        list.push(listener);
        this.listeners.set(event, list);
        return this;
    }
    off(event: string | symbol, listener: (...args: any[]) => void): this {
         const list = this.listeners.get(event);
         if (list) {
             this.listeners.set(event, list.filter(l => l !== listener));
         }
         return this;
    }
    emit(event: string | symbol, ...args: any[]): boolean {
        const list = this.listeners.get(event);
        if (list && list.length > 0) {
            list.forEach(listener => { try { listener(...args); } catch(e) { console.error("Error in listener:", e)} });
            return true;
        }
        return false;
    }
    setMaxListeners(n: number): this { /* no-op */ return this; }
    listenerCount(event: string | symbol): number { return (this.listeners.get(event) || []).length; }
    destroy(): void { this.listeners.clear(); }
}
// --- End Minimal Emitter ---

/**
 * Represents the configuration options for a HappenNode.
 */
export interface NodeOptions {
    id?: string; // Optional: A unique identifier for the node. Generated if not provided.
    initialState?: any; // Optional: The initial state of the node.
    emitterOptions?: EmitterOptions; // Optional: Options for the event emitter
    debug?: boolean;
}


/**
 * Core class representing a node in the Happen system.
 * Manages state, events, and interactions with other nodes.
 */
export class HappenNode<S = any> {
    public readonly id: string;
    private state: IHappenState<S>;
    private emitter: IHappenEmitter;
    private crypto: ICrypto;
    private eventLog: IHappenEventLog;
    private publisher: IHappenPublisher;
    private subscriber: IHappenSubscriber;
    private validator: IHappenValidator;
    private replicator: IHappenReplicator;
    private merger: IHappenMerger;
    private syncer: IHappenSyncer;
    private store: IHappenStore;
    private handler: IHappenHandler;
    private schema: IHappenSchema;
    private permission: IHappenPermission;
    private listenerDisposables: Map<HappenListener<any>, IHappenListenerDisposable | null> = new Map();
    private options: NodeOptions;

    // Use a factory function pattern to ensure runtime modules are provided
    public static create<S = any>(options: NodeOptions, runtimeModules: HappenRuntimeModules): HappenNode<S> {
        return new HappenNode<S>(options, runtimeModules);
    }

    private constructor(options: NodeOptions, runtimeModules: HappenRuntimeModules) {
        this.options = options;
        this.crypto = runtimeModules.crypto;
        this.id = options.id || `node_${this.crypto.randomUUID()}`;

        // --- Determine Emitter --- 
        if (runtimeModules.emitterInstance) {
            this.emitter = runtimeModules.emitterInstance;
        } else if (runtimeModules.baseEventEmitterInstance) {
            // Wrap the provided base emitter
            this.emitter = new PatternEmitter(runtimeModules.baseEventEmitterInstance);
        } else {
            // Default: Create internal PatternEmitter
            console.warn(`[HappenNode ${this.id}] No emitterInstance or baseEventEmitterInstance provided. Defaulting to internal PatternEmitter.`);
            this.emitter = new PatternEmitter(new MinimalEventEmitter()); 
        }

        // --- Initialize Core Components using DI --- 

        // State
        if (runtimeModules.stateInstance) {
            this.state = runtimeModules.stateInstance;
        } else if (runtimeModules.stateConstructor) {
            this.state = new runtimeModules.stateConstructor(options.initialState || {} as S);
        } else {
            this.state = new DefaultState<S>(options.initialState || {} as S);
        }

        // Event Log
        this.eventLog = runtimeModules.eventLogInstance || 
                        (runtimeModules.eventLogConstructor ? new runtimeModules.eventLogConstructor() : new HappenEventLog());

        // Publisher
        this.publisher = runtimeModules.publisherInstance || 
                         (runtimeModules.publisherConstructor ? new runtimeModules.publisherConstructor(this.emitter) : new HappenPublisher(this.emitter));

        // Subscriber
        this.subscriber = runtimeModules.subscriberInstance || 
                          (runtimeModules.subscriberConstructor ? new runtimeModules.subscriberConstructor(this.emitter) : new HappenSubscriber(this.emitter));

        // Validator
        this.validator = runtimeModules.validatorInstance || 
                         (runtimeModules.validatorConstructor ? new runtimeModules.validatorConstructor() : new HappenValidator());

        // Handler
        this.handler = runtimeModules.handlerInstance || 
                       (runtimeModules.handlerConstructor ? new runtimeModules.handlerConstructor() : new HappenHandler()); // Add deps if needed

        // Schema
        this.schema = runtimeModules.schemaInstance || 
                      (runtimeModules.schemaConstructor ? new runtimeModules.schemaConstructor() : new HappenSchema()); // Add deps if needed

        // Permission
        this.permission = runtimeModules.permissionInstance || 
                          (runtimeModules.permissionConstructor ? new runtimeModules.permissionConstructor() : new HappenPermission()); // Add deps if needed

        // Replicator
        this.replicator = runtimeModules.replicatorInstance || 
                          (runtimeModules.replicatorConstructor ? new runtimeModules.replicatorConstructor() : new HappenReplicator()); // Add deps if needed

        // Merger
        this.merger = runtimeModules.mergerInstance || 
                      (runtimeModules.mergerConstructor ? new runtimeModules.mergerConstructor() : new HappenMerger()); // Add deps if needed

        // Syncer
        this.syncer = runtimeModules.syncerInstance || 
                      (runtimeModules.syncerConstructor ? new runtimeModules.syncerConstructor() : new HappenSyncer()); // Add deps if needed

        // Store
        this.store = runtimeModules.storeInstance || 
                     (runtimeModules.storeConstructor ? new runtimeModules.storeConstructor() : new HappenStore()); // Add deps if needed
        
        // --- End Component Initialization --- 

        if (this.options.debug) {
            console.log(`[HappenNode ${this.id}] Initialized with state:`, this.state.get());
            // Log which components were injected vs defaulted?
        }
    }

    async init(): Promise<void> {
        // Initialization logic, e.g., connect emitter if needed
        await (this.emitter as any)?.connect?.();
        
        if (this.options.debug) {
            console.log(`[HappenNode ${this.id}] Initialization complete.`);
        }
    }

    /**
     * Gets the current state of the node.
     */
    getState(): S {
        return this.state.get();
    }

    /**
     * Updates the state of the node using a partial state object.
     * For functional updates, get the state first, compute the new state, then call setState.
     */
    setState(newState: Partial<S>): void {
        // Simple merge for now, could be more complex (e.g., using Immer)
        const currentState = this.state.get();
        const updatedState = { ...currentState, ...newState };
        this.state.set(updatedState);
        if (this.options.debug) {
            console.log(`[HappenNode ${this.id}] State updated:`, updatedState);
        }
        // Optionally emit a local state change event
        this.emitLocal('_state_change', updatedState);
    }

    /**
     * Creates a complete HappenEvent structure.
     */
    private createEvent<P>(type: string, payload: P, metadataOverrides?: Partial<HappenEventMetadata>): HappenEvent<P> {
        const timestamp = Date.now();
        // TODO: Implement actual hashing/signing using this.crypto (ICrypto)
        // Note: this.crypto.hash expects string, metadata hash needs BufferSource? Adapt interfaces or usage.
        const metadata: HappenEventMetadata = {
            id: this.crypto.randomUUID(),
            timestamp: timestamp,
            sender: this.id, 
            nonce: this.crypto.randomUUID(), // Use crypto for nonce
            // --- Placeholder Security ---
            senderStateHash: 'placeholder_state_hash', // Needs proper calculation
            verification: 'placeholder_verification_hash', // Needs proper calculation
            // signature: undefined, // Add if signing
            // publicKey: undefined, // Add if signing
            // --- End Placeholder ---
            ...(metadataOverrides || {}),
        };
        return {
            type,
            payload,
            metadata
        };
    }

    /**
     * Emits an event locally within the node.
     * Useful for internal state changes or events not meant for broadcast.
     */
    emitLocal<P = any>(eventType: string, payload: P): void {
        const event = this.createEvent(eventType, payload);
        if (this.options.debug) {
            console.log(`[HappenNode ${this.id}] Emitting local event: ${eventType}`, event);
        }
        this.emitter.emit(eventType, event);
        this.eventLog.add(event);
    }

    /**
     * Broadcasts an event to other nodes via the emitter.
     */
    async broadcast<P = any>(eventData: { type: string; payload: P; metadata?: Partial<HappenEventMetadata> }): Promise<void> {
        // TODO: Add validation, permission checks, signing before publishing
        const event = this.createEvent(eventData.type, eventData.payload, { ...eventData.metadata });
        if (this.options.debug) {
            console.log(`[HappenNode ${this.id}] Broadcasting event: ${event.type}`, event);
        }
        await this.publisher.publish(event.type, event);
        this.eventLog.add(event);
    }

    /**
      * Sends an event directly to a specific target node.
      * Requires the configured IHappenEmitter to support the `request` method.
      */
    async send<P = any, R = any>(targetNodeId: string, eventData: { type: string; payload: P; metadata?: Partial<HappenEventMetadata> }, timeout: number = 5000): Promise<R | null> {
        // TODO: Add validation, permission checks, signing before sending
        const event = this.createEvent(eventData.type, eventData.payload, {
            ...eventData.metadata,
            // Context might be a place for targetNodeId if needed by app logic,
            // but emitter.request should handle the actual routing.
            // context: { ...(eventData.metadata?.context || {}), targetNodeId } 
        });

        if (this.options.debug) {
            console.log(`[HappenNode ${this.id}] Sending direct event to ${targetNodeId}: ${event.type}`, event);
        }

        // Check if the emitter supports the optional request method
        if (!this.emitter || typeof this.emitter.request !== 'function') {
            console.warn(`[HappenNode ${this.id}] Configured emitter does not support request/reply (direct sends). Broadcast might be necessary.`);
            // Fallback? Or just fail? Returning null for now.
            return null; 
        }

        try {
            // Pass timeout directly if emitter.request supports it as the third arg
            // (IHappenEmitter definition needs update if timeout isn't part of it)
            const responseEvent = await this.emitter.request<P, R>(event.type, event, timeout);

            if (responseEvent) {
                 if (this.options.debug) {
                    console.log(`[HappenNode ${this.id}] Received response from ${targetNodeId}:`, responseEvent);
                 }
                 // TODO: Validate response event
                 this.eventLog.add(responseEvent);
                 return responseEvent.payload;
            } else {
                 console.warn(`[HappenNode ${this.id}] No response received from ${targetNodeId} (or request method returned null/undefined) for event ${event.metadata.id}`);
                 return null;
            }
        } catch (error) {
            console.error(`[HappenNode ${this.id}] Error sending/receiving direct event ${event.metadata.id} to ${targetNodeId}:`, error);
            // Consider re-throwing or specific error handling
            return null; 
        }
    }

    /**
     * Registers a listener for a specific event type or pattern.
     * Returns a dispose function to remove the listener.
     */
    on<P = any>(eventType: string, listener: HappenListener<P>): () => void {
        if (this.options.debug) {
            console.log(`[HappenNode ${this.id}] Registering listener for event type/pattern: ${eventType}`);
        }
        
        // Wrapper to pass to subscriber.subscribe
        const internalListener = (event: HappenEvent<P>) => {
            if (this.shouldHandleEvent(event)) {
                try {
                     if (this.options.debug) {
                         // Avoid excessive logging of handled events unless verbose debug needed
                         // console.log(`[HappenNode ${this.id}] Handling event: ${event.type}`, event);
                     }
                     // Execute the user-provided listener
                     Promise.resolve(listener(event)).catch(listenerError => {
                        console.error(`[HappenNode ${this.id}] Error in async listener for ${eventType}:`, listenerError);
                        this.emitLocal('_listener_error', { eventType, error: listenerError });
                     });
                     this.eventLog.add(event); // Log handled event
                } catch (syncError) {
                     console.error(`[HappenNode ${this.id}] Error in sync listener for ${eventType}:`, syncError);
                     this.emitLocal('_listener_error', { eventType, error: syncError });
                }
            }
        };

        // Call subscribe and handle its potentially varied return type
        const disposableResult = this.subscriber.subscribe(eventType, internalListener);

        // Store the actual disposable if returned, otherwise store null
        let actualDisposable: IHappenListenerDisposable | null = null;
        if (disposableResult && typeof (disposableResult as any).dispose === 'function') {
            actualDisposable = disposableResult as IHappenListenerDisposable;
        } else if (disposableResult instanceof Promise) {
             console.warn(`[HappenNode ${this.id}] Emitter returned a Promise for listener registration on '${eventType}'. Asynchronous disposal not directly supported by standard dispose function. Ensure emitter handles cleanup.`);
             // We can't easily wait for the promise here, so we store null.
        } else if (disposableResult === undefined || disposableResult === null) {
            // Emitter returned void/null, check if emitter has 'off'
             if (typeof this.emitter.off !== 'function') {
                 console.warn(`[HappenNode ${this.id}] Emitter did not return a disposable for '${eventType}' and does not support 'off'. Listener cannot be removed.`);
             } else {
                 // Can likely be removed via emitter.off later
             }
        }
        
        this.listenerDisposables.set(listener, actualDisposable);

        // Return a standard dispose function
        return () => {
            if (this.options.debug) {
                console.log(`[HappenNode ${this.id}] Disposing listener for event type: ${eventType}`);
            }
            const storedDisposable = this.listenerDisposables.get(listener);
            if (storedDisposable) {
                // If we stored a disposable, use it
                Promise.resolve(storedDisposable.dispose()).catch(disposeError => {
                     console.error(`[HappenNode ${this.id}] Error disposing listener for ${eventType} via stored disposable:`, disposeError);
                });
                this.listenerDisposables.delete(listener);
            } else if (typeof this.emitter.off === 'function') {
                 // If no disposable was stored, but emitter supports 'off', try using that
                 try {
                     Promise.resolve(this.emitter.off(eventType, internalListener)).catch(offError => {
                         console.error(`[HappenNode ${this.id}] Error calling emitter.off for ${eventType}:`, offError);
                     });
                 } catch (syncOffError) {
                     console.error(`[HappenNode ${this.id}] Sync error calling emitter.off for ${eventType}:`, syncOffError);
                 }
                 this.listenerDisposables.delete(listener); // Remove from map even if 'off' fails
            } else {
                 // No disposable and no 'off' method
                 console.warn(`[HappenNode ${this.id}] Cannot dispose listener for ${eventType}: No disposable returned and emitter lacks 'off' method.`);
                 this.listenerDisposables.delete(listener); // Still remove from map
            }
        };
    }

    /**
     * Determines if the current node should handle an incoming event.
     * Filters out events originated by the node itself.
     */
    private shouldHandleEvent<P>(event: HappenEvent<P>): boolean {
        // Ignore events sent by this node itself
        if (event.metadata.sender === this.id) {
             // Allow handling specific internal events if needed
             if (!event.type.startsWith('_')) { 
                 return false;
             }
        }
        return true;
    }

    /**
     * Cleans up resources used by the node, like listeners and emitter connections.
     */
    async dispose(): Promise<void> {
        if (this.options.debug) {
            console.log(`[HappenNode ${this.id}] Disposing...`);
        }
        // Dispose all registered listeners using their stored disposables/off
        // Create a copy of listeners to iterate over, as dispose calls might modify the map
        const listenersToDispose = Array.from(this.listenerDisposables.keys());
        listenersToDispose.forEach(listener => {
            const storedDisposable = this.listenerDisposables.get(listener);
             if (storedDisposable && typeof storedDisposable.dispose === 'function') {
                 Promise.resolve(storedDisposable.dispose()).catch(e => console.error(`Error during node dispose (listener disposable):`, e));
             } else {
                 // Attempt to find the corresponding eventType maybe? Difficult.
                 // Relying on the emitter.off logic within the returned disposer is better.
                 // Forcing a generic cleanup might be complex.
                 // Consider iterating the map and calling the *returned* disposer function from 'on' if stored?
             }
        });
        this.listenerDisposables.clear();

        // Close the emitter connection if it has a close/destroy method
        if (this.emitter) {
             await (this.emitter as any)?.destroy?.();
        }

        if (this.options.debug) {
            console.log(`[HappenNode ${this.id}] Disposed.`);
        }
    }

    /**
     * Alias for dispose, potentially useful in certain testing frameworks or contexts.
     */
    async destroy(): Promise<void> {
        await this.dispose();
    }
}
