import { HappenListener, IHappenEmitter } from './emitter';
// Use types from runtime-modules
import { ICrypto, JsonWebKey, BufferSource, HappenRuntimeModules } from './runtime-modules';
import { HappenEvent, HappenEventMetadata } from './event';
import { PatternEmitter } from './PatternEmitter';
import { matchesPattern } from './pattern-matcher';
import {
    HookContext,
    HookFunction,
    LifecyclePoint,
    EventHooks,
    HookRegistrationOptions,
    UnregisterFunction,
    RegisteredHook
} from './hook-types';
// Import new utils
import { canonicalStringify as canonicalStringifyUtil } from './utils'; // Import base64 utils and canonicalStringify from here

// Use canonicalStringifyUtil from utils.ts
const canonicalStringify = canonicalStringifyUtil;

/**
 * Configuration options for creating a HappenNode.
 */
export interface NodeOptions<S = any> {
    /** Optional unique identifier for the node. Defaults to a random UUID. */
    id?: string;
    /** Optional initial state for the node. */
    initialState?: S;
    // Add other node-specific options here if needed in the future
}

/**
 * Represents a node in the Happen network.
 */
export class HappenNode<S = any> {
    readonly id: string;
    private emitter: IHappenEmitter;
    private crypto: ICrypto;
    // Store keys in JWK format
    private publicKey: JsonWebKey | null = null;
    private privateKey: JsonWebKey | null = null;
    private state: S;
    private receivedEventIds: Set<string> = new Set();
    private nonce: number = 0;
    // Array to store disposer functions for cleanup
    private activeDisposers: (() => void)[] = [];
    private nonceCleanupTimer: ReturnType<typeof setInterval> | undefined;

    // --- New Hook Properties ---
    private registeredHooks: RegisteredHook<S, any>[] = [];
    private nextRegistrationId = 0;
    // --- End New Hook Properties ---

    constructor(id: string, initialState: S, crypto: ICrypto, emitter: IHappenEmitter) {
        this.id = id;
        this.state = initialState;
        this.crypto = crypto;
        // Directly use the provided IHappenEmitter instance
        this.emitter = emitter;
    }

    /**
     * Initializes the node by generating its cryptographic key pair.
     * Must be called before emitting signed events or registering listeners
     * that verify signatures.
     */
    async init(): Promise<void> {
        if (this.publicKey && this.privateKey) {
            console.warn(`Node ${this.id}: Already initialized.`);
            return;
        }
        try {
            console.log(`Node ${this.id}: Initializing - generating key pair...`);
            const { publicKey, privateKey } = await this.crypto.generateKeyPair();
            this.publicKey = publicKey;
            this.privateKey = privateKey;
            console.log(`Node ${this.id}: Initialization complete. Public key ready.`);
        } catch (error) {
            console.error(`Node ${this.id}: Failed to generate key pair during initialization:`, error);
            // Rethrow or handle appropriately - node cannot function securely without keys
            throw new Error(`Node ${this.id} initialization failed: ${error}`);
        }
    }

    /**
     * Checks if the node has been initialized with a key pair.
     * @returns True if the node is initialized, false otherwise.
     */
    isInitialized(): boolean {
        return !!this.publicKey;
    }

    /**
     * Gets the current state of the node.
     * @returns The current state object.
     */
    getState(): S {
        return this.state;
    }

    /**
     * Sets the node's state. Executes pre/post state change hooks.
     *
     * @param newStateOrFn A new state object, or a function (prevState => newState).
     */
    async setState(newStateOrFn: Partial<S> | S | ((prevState: S) => S)): Promise<void> {
        let calculatedNewState: S;
        let potentialStateChangeEvent: HappenEvent | undefined; // Assume state change is triggered by an event context if available

        // Determine the new state first (needed for preStateChange context if applicable)
        if (typeof newStateOrFn === 'function') {
            calculatedNewState = (newStateOrFn as (prevState: S) => S)(this.state);
        } else {
            if (typeof this.state === 'object' && this.state !== null && typeof newStateOrFn === 'object' && newStateOrFn !== null) {
                 calculatedNewState = { ...this.state, ...newStateOrFn };
            } else {
                 calculatedNewState = newStateOrFn as S;
            }
        }

        // *** Dispatch preStateChange Hooks ***
        const preStateChangeContext = this.createHookContext(
            'preStateChange',
            potentialStateChangeEvent ?? { type: '__setState__', payload: {}, metadata: { id: this.crypto.randomUUID(), sender: this.id, timestamp: Date.now(), nonce: '', senderStateHash: '', verification: '' } } as any, // Added required metadata fields
            this.state
        );
        const shouldStopPre = await this.dispatchHooks('preStateChange', preStateChangeContext);
        if (shouldStopPre) {
            console.warn(`Node ${this.id}: State change halted by preStateChange hook.`);
            return;
        }
        // *** End Dispatch preStateChange Hooks ***

        // Apply the state change
        const oldState = this.state;
        this.state = calculatedNewState;
        // console.log(`Node ${this.id}: State updated to`, this.state);

        // *** Dispatch afterStateChange Hooks ***
        const postStateChangeContext = this.createHookContext(
            'afterStateChange',
            preStateChangeContext.event, // Use the same event context
            oldState, // Pass the state *before* the change as currentState
            this.state // Pass the new state
        );
        // No need to check stop status for afterStateChange
        await this.dispatchHooks('afterStateChange', postStateChangeContext);
        // *** End Dispatch afterStateChange Hooks ***
    }

    /**
     * Registers a listener for a specific event type or pattern.
     * Executes pre/post handle hooks around the user's handler.
     * Requires node to be initialized via init() first.
     * @param eventTypeOrPattern The event type (exact string) or pattern (with wildcards) to listen for.
     * @param handler The listener function to register.
     * @returns A function that, when called, will unregister the listener.
     */
    on<T = any>(eventTypeOrPattern: string, handler: HappenListener<T>): () => void {
        if (!this.isInitialized()) {
            console.error(`Node ${this.id}: Cannot register listener. Node not initialized. Call init() first.`);
            return () => {};
        }

        const wrappedHandler = async (event: HappenEvent<T>) => {
            console.log(`[${this.id}][WrappedHandler] Received ${event.type} (ID: ${event.metadata.id}) from ${event.metadata.sender}`);

            // --- Verification ---
            if (!event.metadata.signature || !event.metadata.publicKey) {
                 console.warn(`${this.id}: Discarding event without signature/publicKey: ${event.metadata.id}`);
                 return;
            }
            console.log(`[${this.id}][WrappedHandler] Verifying signature for ${event.metadata.id}...`);
            try {
                const dataToVerifyString = this.getDataToSign(event);
                const dataToVerifyBuffer = new TextEncoder().encode(dataToVerifyString);
                const signatureString = event.metadata.signature;
                const isValid = await this.crypto.verify(
                    event.metadata.publicKey,
                    signatureString,
                    dataToVerifyBuffer
                );
                if (!isValid) {
                    console.warn(`${this.id}: Discarding event due to INVALID signature: ${event.metadata.id}`);
                    return;
                }
            } catch (error) {
                console.error(`${this.id}: Error during signature verification for event ${event.metadata.id}:`, error);
                return;
            }
            if (this.receivedEventIds.has(event.metadata.id)) {
                console.warn(`${this.id}: Discarding duplicate event: ${event.metadata.id}`);
                return;
            }
            // --- End Verification ---

            // *** Dispatch preHandle Hooks ***
            const preHandleContext = this.createHookContext('preHandle', event, this.state);
            const shouldStopPre = await this.dispatchHooks('preHandle', preHandleContext);
            if (shouldStopPre) {
                console.warn(`Node ${this.id}: Handler execution for ${event.type} (ID: ${event.metadata.id}) halted by preHandle hook.`);
                return;
            }
            const eventForHandler = preHandleContext.event;
            // *** End Dispatch preHandle Hooks ***

            // Add to received AFTER preHandle allows potential stop
            this.receivedEventIds.add(event.metadata.id);

            let handlerError: Error | undefined;
            try {
                await handler(eventForHandler);
            } catch (error) {
                console.error(`${this.id}: Error in handler for ${event.type}:`, error);
                handlerError = error instanceof Error ? error : new Error(String(error));
            }

            // *** Dispatch postHandle Hooks ***
            const postHandleContext = this.createHookContext(
                'postHandle',
                eventForHandler,
                this.state,
                undefined,
                handlerError
            );
            await this.dispatchHooks('postHandle', postHandleContext);
            // *** End Dispatch postHandle Hooks ***
        };

        this.emitter.on(eventTypeOrPattern, wrappedHandler);
        const dispose = () => {
            console.log(`${this.id}: Disposing listener for ${eventTypeOrPattern}`);
             if (!this.emitter.off) {
                console.warn(`${this.id}: Underlying emitter does not support 'off' method. Cannot dispose listener for ${eventTypeOrPattern}.`);
                return;
            }
            try {
                this.emitter.off(eventTypeOrPattern, wrappedHandler);
                this.activeDisposers = this.activeDisposers.filter(d => d !== dispose);
            } catch (error) {
                 console.error(`${this.id}: Error during emitter.off for ${eventTypeOrPattern}:`, error);
            }
        };
        this.activeDisposers.push(dispose);
        return dispose;
    }

    /**
     * Emits a signed event to the network. Executes preEmit hooks.
     * Requires node to be initialized via init() first.
     * @param eventData The core event data.
     */
    async emit<T = any>(
        eventData: Omit<HappenEvent<T>, 'metadata' | 'sender' | 'signature' | 'publicKey'> & { metadata?: Partial<HappenEvent<T>['metadata']> }
    ): Promise<void> {
        if (!this.isInitialized() || !this.privateKey || !this.publicKey) {
            console.error(`Node ${this.id}: Cannot emit event. Node not initialized or missing keys. Call init() first.`);
            return;
        }

        const now = Date.now();
        const eventId = eventData.metadata?.id ?? this.crypto.randomUUID();

        let eventToEmit: HappenEvent<T> = {
            type: eventData.type,
            payload: eventData.payload === undefined ? {} as T : eventData.payload,
            metadata: {
                id: eventId,
                sender: this.id,
                timestamp: now,
                nonce: '', 
                senderStateHash: '', 
                verification: '', 
                ...eventData.metadata,
                publicKey: this.publicKey,
                signature: undefined 
            } as HappenEventMetadata,
        };

        const preEmitContext = this.createHookContext('preEmit', eventToEmit, this.state);
        const shouldStop = await this.dispatchHooks('preEmit', preEmitContext);
        if (shouldStop) {
            console.warn(`Node ${this.id}: Emission of ${eventToEmit.type} (ID: ${eventToEmit.metadata.id}) halted by preEmit hook.`);
            return;
        }
        eventToEmit = preEmitContext.event;
        eventToEmit.metadata.publicKey = this.publicKey;

        try {
            const dataToSignString = this.getDataToSign(eventToEmit);
            const dataToSignBuffer = new TextEncoder().encode(dataToSignString);
            const signatureString = await this.crypto.sign(this.privateKey, dataToSignBuffer);

            eventToEmit.metadata.signature = signatureString;

            this.emitter.emit(eventToEmit.type, eventToEmit);

        } catch (error) {
             console.error(`Node ${this.id}: Failed to sign or emit event ${eventToEmit.metadata.id}:`, error);
        }
    }

    /**
     * Helper method to consistently generate the string representation of event data
     * that needs to be signed or verified.
     */
    private getDataToSign<T>(event: Partial<HappenEvent<T>>): string {
         const signedData = {
            type: event.type,
            payload: event.payload,
            metadata: {
                id: event.metadata?.id,
                sender: event.metadata?.sender,
                timestamp: event.metadata?.timestamp,
                 causationId: event.metadata?.causationId,
                 correlationId: event.metadata?.correlationId,
            }
         };
         return canonicalStringify(signedData);
    }

    /**
     * Registers a group of lifecycle hooks for specific event types.
     * @param eventTypeFilter Event type(s) or pattern to filter events for these hooks.
     * @param hooks An object mapping lifecycle points to hook functions or arrays of functions.
     * @param options Optional settings like priority.
     * @returns A function to unregister all hooks from this specific registration call.
     */
    registerHooks<T = any>(
        eventTypeFilter: string | string[],
        hooks: EventHooks<S, T>,
        options?: HookRegistrationOptions
    ): UnregisterFunction {
        const registrationId = `reg-${this.nextRegistrationId++}`;
        const priority = options?.priority ?? 0;
        let hooksRegistered = false;

        for (const key in hooks) {
            const lifecyclePoint = key as LifecyclePoint;
            const hookOrArray = hooks[lifecyclePoint as keyof EventHooks]; // Type assertion
            if (!hookOrArray) continue;

            const hookFunctions = Array.isArray(hookOrArray) ? hookOrArray : [hookOrArray];

            hookFunctions.forEach((hookFunction, index) => {
                const registeredHook: RegisteredHook<S, any> = {
                    registrationId,
                    eventTypeFilter,
                    lifecyclePoint,
                    hookFunction,
                    priority,
                    arrayIndex: Array.isArray(hookOrArray) ? index : -1 // -1 if not part of an array
                };
                this.registeredHooks.push(registeredHook);
                hooksRegistered = true;
                 // console.log(`Node ${this.id}: Registered hook ${registrationId} for ${lifecyclePoint} on "${eventTypeFilter}" priority ${priority}`);
            });
        }

        if (!hooksRegistered) {
            console.warn(`Node ${this.id}: registerHooks called for "${eventTypeFilter}" but no actual hook functions were provided.`);
            return () => {}; // No-op unregister
        }

        // Return the unregister function
        const unregister = () => {
            const initialLength = this.registeredHooks.length;
            this.registeredHooks = this.registeredHooks.filter(
                hook => hook.registrationId !== registrationId
            );
            const removedCount = initialLength - this.registeredHooks.length;
             console.log(`Node ${this.id}: Unregistered ${removedCount} hook(s) for registration ${registrationId} ("${eventTypeFilter}").`);
        };
        this.activeDisposers.push(unregister); // Track for destroy()
        return unregister;
    }

    /**
     * Internal helper to create the context object for hooks.
     */
    private createHookContext<T = any>(
        lifecyclePoint: LifecyclePoint,
        event: HappenEvent<T>,
        currentState: S,
        newState?: S,
        handlerError?: Error
    ): HookContext<S, T> & { _isStopped: boolean } { // Add internal flag
        const context: HookContext<S, T> & { _isStopped: boolean } = {
            event: event,
            currentState: currentState,
            newState: newState, // Only defined for afterStateChange
            handlerError: handlerError, // Only defined for postHandle
            isStopped: false, // Read-only view for the hook function
            _isStopped: false, // Internal mutable flag
            stop: () => {
                // Use 'this' carefully if making stop an arrow function
                 context._isStopped = true;
                 Object.defineProperty(context, 'isStopped', { value: true, writable: false }); // Make external flag immutable true
                 // console.log(`Node ${this.id}: Hook called stop() for ${event.type} at ${lifecyclePoint}`);
            }
        };
        // Make isStopped read-only for the hook
        Object.defineProperty(context, 'isStopped', { value: false, writable: false });
        return context;
    }

    /**
     * Internal method to find, sort, and execute hooks for a given lifecycle point and event.
     * @param lifecyclePoint The lifecycle point being triggered.
     * @param context The initial hook context.
     * @returns True if processing was stopped by a hook, false otherwise.
     */
    private async dispatchHooks<T = any>(
        lifecyclePoint: LifecyclePoint,
        context: HookContext<S, T> & { _isStopped: boolean }
    ): Promise<boolean> { // Return true if stopped
        const relevantHooks = this.registeredHooks.filter(regHook => {
            if (regHook.lifecyclePoint !== lifecyclePoint) {
                return false;
            }
            // Check event type match using imported matchesPattern
            if (Array.isArray(regHook.eventTypeFilter)) {
                return regHook.eventTypeFilter.some(filter => matchesPattern(context.event.type, filter));
            } else {
                return matchesPattern(context.event.type, regHook.eventTypeFilter);
            }
        });

        if (relevantHooks.length === 0) {
            return false; // No hooks to run
        }

        // Sort hooks: primary by priority (asc), secondary by array index (asc)
        relevantHooks.sort((a, b) => {
            const priorityDiff = a.priority - b.priority;
            if (priorityDiff !== 0) {
                return priorityDiff;
            }
            // If priorities are equal, use array index (-1 means not in array, treat as 0 for comparison?)
            // Hooks in an array should run in order relative to each other.
            // Hooks not in an array (-1) run relative to arrays based on priority only.
            const idxA = a.arrayIndex === -1 ? Infinity : a.arrayIndex; // Treat non-array hooks as coming after array hooks of same priority? Or intersperse? Let's intersperse for now.
            const idxB = b.arrayIndex === -1 ? Infinity : b.arrayIndex;
            // If both are Infinity (not in arrays), their relative order doesn't strictly matter here
             if (idxA === Infinity && idxB === Infinity) return 0;
             // If one is in array and other isn't, array comes first? Let's keep array order first.
             // Use registrationId for stable sort as tertiary factor if priorities and indices are identical (shouldn't happen with arrayIndex).
             // Let's simplify: if priorities are same, array items run first in their order, then non-array items (order undefined between them).
             if (a.arrayIndex !== -1 && b.arrayIndex !== -1) {
                 return a.arrayIndex - b.arrayIndex; // Sort by array index
             } else if (a.arrayIndex !== -1) {
                 return -1; // a is in array, b is not -> a comes first
             } else if (b.arrayIndex !== -1) {
                 return 1; // b is in array, a is not -> b comes first
             } else {
                 return 0; // Both not in arrays, relative order undefined (stable sort might preserve registration order)
             }
        });

         // console.log(`Node ${this.id}: Dispatching ${relevantHooks.length} hooks for ${lifecyclePoint} on ${context.event.type}`);

        for (const regHook of relevantHooks) {
             // console.log(`Node ${this.id}: Running hook ${regHook.registrationId} (priority ${regHook.priority}, index ${regHook.arrayIndex})`);
            try {
                // IMPORTANT: Pass the potentially modified context.event from the *previous* hook iteration?
                // For now, we pass the context as is, allowing mutation of context.event
                // to be visible to subsequent hooks.
                await regHook.hookFunction(context);
            } catch (error) {
                console.error(`Node ${this.id}: Error in hook function (registration ${regHook.registrationId}) during ${lifecyclePoint} for event ${context.event.type}:`, error);
                // Decide: Should an error in a hook stop the chain? Let's say yes for now.
                context.stop();
            }

            // Check if the hook called context.stop()
            if (context._isStopped) {
                 console.log(`Node ${this.id}: Hook chain stopped at ${lifecyclePoint} by hook ${regHook.registrationId}.`);
                return true; // Signal that processing was stopped
            }
        }

        return false; // Processing completed normally
    }

    /**
     * Cleans up resources used by the node, including removing listeners
     * and hook unregister functions.
     */
    destroy(): void {
        console.log(`Node ${this.id}: Destroying...`);

        if (this.nonceCleanupTimer) {
            clearInterval(this.nonceCleanupTimer);
            this.nonceCleanupTimer = undefined;
            console.log(`Node ${this.id}: Stopped nonce cleanup timer.`);
        }

        // Call all disposer functions (listeners AND hook unregisters)
        [...this.activeDisposers].forEach(dispose => {
            try {
                dispose();
            } catch (error) {
                console.error(`Node ${this.id}: Error during disposer execution on destroy:`, error);
            }
        });
        this.activeDisposers = [];
        this.receivedEventIds.clear();
        this.registeredHooks = []; // Clear registered hooks
        console.log(`Node ${this.id}: Destroyed.`);
    }
}

// ==========================================
//        Node Factory / Context
// ==========================================

/**
 * Type definition for the function returned by createHappenContext,
 * which is used to create nodes within that context.
 */
export type NodeCreationFunction = <S = any>(options?: NodeOptions<S>) => HappenNode<S>;

/**
 * Creates a Happen context with pre-configured runtime modules.
 * This returns a factory function for creating nodes within that context.
 *
 * @param runtimeModules The shared runtime modules (crypto implementation, emitter instance).
 * @returns A function (`createNodeInContext`) that creates HappenNode instances with the provided modules.
 */
export function createHappenContext(runtimeModules: HappenRuntimeModules): NodeCreationFunction {
    // Validate runtime modules
    if (!runtimeModules || typeof runtimeModules !== 'object') {
        throw new Error('createHappenContext: Invalid runtimeModules object provided.');
    }
    if (!runtimeModules.crypto || typeof runtimeModules.crypto.randomUUID !== 'function') {
        throw new Error('createHappenContext: Missing or invalid ICrypto implementation in runtimeModules.');
    }
    if (!runtimeModules.emitterInstance || typeof runtimeModules.emitterInstance.emit !== 'function') {
        throw new Error('createHappenContext: Missing or invalid IHappenEmitter instance in runtimeModules.');
    }

    // Return the factory function
    const createNodeInContext = <S = any>(options?: NodeOptions<S>): HappenNode<S> => {
        return new HappenNode<S>(
            options?.id ?? runtimeModules.crypto.randomUUID(),
            options?.initialState ?? {} as S,
            runtimeModules.crypto,
            runtimeModules.emitterInstance
        );
    };

    return createNodeInContext;
}
