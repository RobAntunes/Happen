import { HappenListener, IHappenEmitter } from './emitter';
// Use types from runtime-modules
import { ICrypto, JsonWebKey, BufferSource, HappenRuntimeModules } from './runtime-modules';
import { HappenEvent } from './event';
import { canonicalStringify } from '../utils/canonicalStringify';
import { PatternEmitter } from './PatternEmitter';

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
     * Sets the node's state. Provide a new state object or a function
     * that receives the previous state and returns the new state.
     *
     * @param newStateOrFn A new state object, or a function (prevState => newState).
     */
    setState(newStateOrFn: Partial<S> | S | ((prevState: S) => S)): void {
        if (typeof newStateOrFn === 'function') {
            this.state = (newStateOrFn as (prevState: S) => S)(this.state);
        } else {
            if (typeof this.state === 'object' && this.state !== null && typeof newStateOrFn === 'object' && newStateOrFn !== null) {
                 this.state = { ...this.state, ...newStateOrFn };
            } else {
                 this.state = newStateOrFn as S;
            }
        }
        // console.log(`Node ${this.id}: State updated to`, this.state);
    }

    /**
     * Registers a listener for a specific event type or pattern.
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

            if (!event.metadata.signature || !event.metadata.publicKey) {
                 console.warn(`${this.id}: Discarding event without signature/publicKey: ${event.metadata.id}`);
                 return;
            }

            console.log(`[${this.id}][WrappedHandler] Verifying signature for ${event.metadata.id}...`);
            try {
                const dataToVerifyString = this.getDataToSign(event);
                const dataToVerifyBuffer = new TextEncoder().encode(dataToVerifyString);
                const isValid = await this.crypto.verify(
                    event.metadata.publicKey,
                    event.metadata.signature,
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
            this.receivedEventIds.add(event.metadata.id);
            // TODO: Add mechanism to prune receivedEventIds

            try {
                await handler(event);
            } catch (error) {
                console.error(`${this.id}: Error in handler for ${event.type}:`, error);
            }
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
     * Emits a signed event to the network.
     * Requires node to be initialized via init() first.
     * @param eventData The core event data (type, payload, optional metadata overrides).
     */
    async emit<T = any>(
        eventData: Omit<HappenEvent<T>, 'metadata' | 'sender' | 'signature' | 'publicKey'> & { metadata?: Partial<HappenEvent<T>['metadata']> }
    ): Promise<void> {
        if (!this.isInitialized() || !this.privateKey) { // Check privateKey too for signing
            console.error(`Node ${this.id}: Cannot emit event. Node not initialized or missing keys. Call init() first.`);
            return;
        }

        const now = Date.now();
        const eventId = eventData.metadata?.id ?? this.crypto.randomUUID();
        const baseMetadata: Partial<HappenEvent<T>['metadata']> = {
             ...eventData.metadata,
            id: eventId,
            sender: this.id,
            timestamp: now,
        };

        const eventToSign: Partial<HappenEvent<T>> = {
            type: eventData.type,
            payload: eventData.payload,
            metadata: baseMetadata as HappenEvent<T>['metadata'],
        };

        try {
            const dataToSignString = this.getDataToSign(eventToSign as HappenEvent<T>);
            const dataToSignBuffer = new TextEncoder().encode(dataToSignString);
            const signature = await this.crypto.sign(this.privateKey, dataToSignBuffer);

            const finalEvent: HappenEvent<T> = {
                type: eventData.type,
                payload: eventData.payload === undefined ? {} as T : eventData.payload,
                metadata: {
                    ...baseMetadata,
                    publicKey: this.publicKey, // Add public key
                    signature: signature,    // Add signature
                } as HappenEvent<T>['metadata'],
            };

            this.emitter.emit(finalEvent.type, finalEvent);

        } catch (error) {
             console.error(`Node ${this.id}: Failed to sign or emit event:`, error);
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
     * Cleans up resources used by the node, including removing listeners
     * and stopping timers.
     */
    destroy(): void {
        console.log(`Node ${this.id}: Destroying...`);

        if (this.nonceCleanupTimer) {
            clearInterval(this.nonceCleanupTimer);
            this.nonceCleanupTimer = undefined;
            console.log(`Node ${this.id}: Stopped nonce cleanup timer.`);
        }

        [...this.activeDisposers].forEach(dispose => {
            try {
                dispose();
            } catch (error) {
                console.error(`Node ${this.id}: Error during listener disposal on destroy:`, error);
            }
        });
        this.activeDisposers = [];
        this.receivedEventIds.clear();
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
