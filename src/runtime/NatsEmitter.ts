import { connect, NatsConnection, StringCodec, Subscription, ConnectionOptions, PublishOptions, Msg, JetStreamManager, StreamConfig, RetentionPolicy, StorageType, DiscardPolicy, JsMsg, consumerOpts, createInbox, /* ConnectOptions, */ ErrorCode, NatsError, JSONCodec, JsMsgCallback } from 'nats';
import { IHappenEmitter, HappenListener, EventObserver /*, IHappenListenerDisposable */ } from '../core/emitter';
import { HappenEvent } from '../core/event';

// Create Codec instances
const sc = StringCodec();
const jc = JSONCodec<HappenEvent<any>>();
const HAPPEN_STREAM_NAME = 'happen-events';
const HAPPEN_STREAM_SUBJECTS = ["happen.events.>"]; // Capture all events prefixed with happen.events

// Define a compatible type for the subscriptions map value
interface SubLike {
    unsubscribe(): void;
    getSubject(): string;
}

export class NatsEmitter implements IHappenEmitter {
    private nc: NatsConnection | null = null;
    private connectionOptions: ConnectionOptions;
    private subscriptions: Map<HappenListener, SubLike> = new Map();
    private observers: Set<EventObserver> = new Set();
    private observerSubscription: Subscription | null = null;
    private isConnecting: boolean = false;
    private connectionPromise: Promise<NatsConnection> | null = null;

    constructor(options?: ConnectionOptions) {
        this.connectionOptions = {
            servers: options?.servers ?? 'nats://localhost:4222',
            ...options,
        };
    }

    /**
     * Establishes connection to the NATS server, ensures JetStream stream exists.
     * Returns a promise that resolves when connected.
     */
    async connect(): Promise<void> {
        if (this.nc && !this.nc.isClosed()) {
            console.log('NatsEmitter: Already connected.');
            return;
        }
        if (this.isConnecting && this.connectionPromise) {
            console.log('NatsEmitter: Connection attempt already in progress.');
            await this.connectionPromise;
            return;
        }

        this.isConnecting = true;
        this.connectionPromise = (async () => {
            try {
                // Log server connection attempt (handle string | string[])
                const serversString = Array.isArray(this.connectionOptions.servers) 
                    ? this.connectionOptions.servers.join(', ') 
                    : this.connectionOptions.servers;
                console.log(`NatsEmitter: Connecting to NATS server at ${serversString}...`); 
                
                const connection = await connect(this.connectionOptions);
                console.log(`NatsEmitter: Connected to ${connection.getServer()}`);

                // Ensure JetStream stream exists
                await this.ensureJetStream(connection);

                // Handle status events
                (async () => {
                    if (!connection) return;
                    for await (const status of connection.status()) {
                        console.info(`NatsEmitter: NATS status changed - ${status.type}`, status.data);
                    }
                })().then(); // Don't await status handling

                return connection; // Resolve the promise with the connection

            } catch (err) {
                console.error(`NatsEmitter: Error during connection process:`, err);
                this.isConnecting = false; // Reset flag on error
                this.connectionPromise = null;
                throw err; // Re-throw error
            }
        })();

        try {
            this.nc = await this.connectionPromise;
            this.isConnecting = false;

            // Setup observer subscription if observers exist
            if (this.observers.size > 0) {
                this.ensureObserverSubscription();
            }
         } catch (err) {
            // Error is already logged inside the async function
            this.isConnecting = false;
            this.connectionPromise = null;
            throw err;
         }
    }

    /**
     * Ensures the required JetStream stream exists.
     */
    private async ensureJetStream(connection: NatsConnection): Promise<void> {
        try {
            const jsm = await connection.jetstreamManager();
            console.log("NatsEmitter: Checking for JetStream stream...");

            const streamConfig: Partial<StreamConfig> = {
                name: HAPPEN_STREAM_NAME,
                subjects: HAPPEN_STREAM_SUBJECTS,
                retention: RetentionPolicy.Limits, 
                storage: StorageType.File, 
                discard: DiscardPolicy.Old, // Use enum member
                num_replicas: 1 
            };

            try {
                await jsm.streams.info(HAPPEN_STREAM_NAME);
                console.log(`NatsEmitter: Found existing stream '${HAPPEN_STREAM_NAME}'. Updating configuration.`);
                await jsm.streams.update(HAPPEN_STREAM_NAME, streamConfig);
            } catch (err: any) {
                if (err.code === '404' || err.message?.includes('stream not found')) {
                    console.log(`NatsEmitter: Stream '${HAPPEN_STREAM_NAME}' not found. Creating...`);
                    await jsm.streams.add(streamConfig);
                    console.log(`NatsEmitter: Stream '${HAPPEN_STREAM_NAME}' created successfully.`);
                } else {
                    throw err;
                }
            }
        } catch (jsError) {
            console.error("NatsEmitter: Failed to ensure JetStream configuration:", jsError);
            throw new Error(`JetStream setup failed: ${jsError}`);
        }
    }

    /**
     * Ensures the NATS connection is established before proceeding.
     */
    private async ensureConnected(): Promise<NatsConnection> {
        if (!this.nc || this.nc.isClosed()) {
            await this.connect();
        }
        if (!this.nc) {
            throw new Error("NatsEmitter: Connection failed or not established.");
        }
        if (this.isConnecting && this.connectionPromise) {
            return this.connectionPromise;
        }
        return this.nc;
    }

    /**
     * Publishes an event to the JetStream stream.
     * @param eventType The event type (used to derive the NATS subject).
     * @param event The HappenEvent to publish.
     */
    async emit(eventType: string, event: HappenEvent<any>): Promise<void> {
        const nc = await this.ensureConnected();
        const js = nc.jetstream(); 
        const subject = this.mapEventTypeToSubject(eventType);

        try {
            const payload = jc.encode(event);
            const pa = await js.publish(subject, payload);
        } catch (error) {
            console.error(`NatsEmitter: Failed to publish event ${event.metadata.id} to JetStream subject ${subject}:`, error);
        }
    }

    /**
     * Subscribes to events from the JetStream stream.
     * Uses durable consumers based on the listener/pattern for reliable delivery.
     * @param eventTypeOrPattern The event type or NATS subject pattern.
     * @param listener The handler function.
     */
    async on(eventTypeOrPattern: string, listener: HappenListener): Promise<void> {
        const nc = await this.ensureConnected();
        const js = nc.jetstream();
        const subject = this.mapEventTypeToSubject(eventTypeOrPattern);

        const durableName = eventTypeOrPattern.replace(/[*>{}]/g, '').replace(/[,.]/g, '-');
        const consumerName = `happen-${durableName}-${listener.name || 'handler'}`.slice(0, 256); 

        console.log(`NatsEmitter: Creating/getting consumer '${consumerName}' and subscribing to subject '${subject}'`);

        try {
            // Use consumerOpts for clearer configuration
            const opts = consumerOpts();
            opts.durable(consumerName);
            opts.ackExplicit();
            opts.deliverTo(createInbox()); // Use JetStream pull subscription pattern
            opts.manualAck(); // Ensure manual ack is set

            const sub = await js.subscribe(subject, opts);
            
            // Process messages asynchronously
            (async () => {
                for await (const msg of sub) {
                    try {
                        const eventData = jc.decode(msg.data);
                        await Promise.resolve(listener(eventData));
                        msg.ack(); // Acknowledge successful processing
                    } catch (handlerError) {
                        console.error(`NatsEmitter: Error in listener for consumer ${consumerName}, subject ${msg.subject}, Event ID ${jc.decode(msg.data)?.metadata?.id}:`, handlerError);
                        // Optionally Nack or Term based on error
                         msg.term(); // Terminate potentially poisonous messages
                    }
                }
                 console.log(`NatsEmitter: Subscription closed for consumer ${consumerName}`);
            })().catch(subErr => {
                 console.error(`NatsEmitter: Error in JetStream subscription processing loop for ${consumerName}:`, subErr);
            });
            
            // Store the subscription-like object
            this.subscriptions.set(listener, sub); 
            console.log(`NatsEmitter: JetStream subscription successful for consumer '${consumerName}' on subject '${subject}'`);
        } catch (error) {
            console.error(`NatsEmitter: Failed to subscribe via JetStream consumer '${consumerName}' to subject ${subject}:`, error);
        }
    }

    /**
     * Removes a listener based on the original handler function reference.
     * @param eventTypeOrPattern The event type or pattern (used for logging, not essential for removal).
     * @param listener The original handler function to remove.
     */
    async off(eventTypeOrPattern: string, listener: HappenListener): Promise<void> {
        const sub = this.subscriptions.get(listener);
        if (sub) {
            console.log(`NatsEmitter: Unsubscribing from subject '${sub.getSubject()}'`);
            // For JetStream subscriptions created with js.subscribe, 
            // draining might be preferred if using pull consumers to finish processing fetched messages
            if ('drain' in sub && typeof sub.drain === 'function') {
                await sub.drain();
            } else {
                 sub.unsubscribe(); // Fallback for non-drainable subs
            }
            this.subscriptions.delete(listener);
        } else {
            console.warn(`NatsEmitter: Listener not found for pattern '${eventTypeOrPattern}'. Cannot remove.`);
        }
    }

     /**
     * Registers a passive event observer. Observers receive all events.
     * Uses a standard NATS subscription, not JetStream.
     * @param observer The observer function.
     * @returns A dispose function to remove the observer.
     */
    addObserver(observer: EventObserver): () => void {
        this.observers.add(observer);
        console.log("NatsEmitter: Registered an observer.");
        this.ensureObserverSubscription(); // Ensure wildcard subscription is active

        return () => {
            this.observers.delete(observer);
            console.log("NatsEmitter: Disposed an observer.");
            if (this.observers.size === 0 && this.observerSubscription) {
                console.log("NatsEmitter: Removing observer subscription as no observers remain.");
                this.observerSubscription.unsubscribe();
                this.observerSubscription = null;
            }
        };
    }

     /**
     * Subscribes to a wildcard subject to feed observers, if not already subscribed.
     * Uses a standard core NATS subscription.
     */
    private async ensureObserverSubscription(): Promise<void> {
        if (this.observerSubscription && !this.observerSubscription.isClosed()) {
            return; 
        }
        const nc = await this.ensureConnected(); 
        const observerSubject = this.mapEventTypeToSubject('>'); // Subscribe to all happen events ('happen.events.>')

        console.log(`NatsEmitter: Setting up observer subscription for subject '${observerSubject}'`);
        try {
             // Use standard subscribe for observers, assuming they don't need JS persistence/guarantees
             this.observerSubscription = nc.subscribe(observerSubject, {
                 callback: (err: NatsError | null, msg: Msg) => { // Use Msg type
                    if (err) {
                        console.error(`NatsEmitter: Error in observer subscription callback for subject ${observerSubject}:`, err);
                        return;
                    }
                    try {
                        const eventData = jc.decode(msg.data); // Use JSON Codec
                        this.observers.forEach(obs => {
                            Promise.resolve(obs(eventData)).catch(obsError => {
                                console.error(`NatsEmitter: Error in observer function for event ID ${eventData?.metadata?.id}:`, obsError);
                            });
                        });
                    } catch (parseError) {
                         console.error(`NatsEmitter: Failed to parse message data for observer subject ${observerSubject}:`, parseError);
                    }
                 }
             });
        } catch (error) {
             console.error(`NatsEmitter: Failed to setup observer subscription to ${observerSubject}:`, error);
        }
    }

    /**
     * Placeholder for compatibility with EventEmitter interface. 
     */
    setMaxListeners(n: number): this {
        console.warn(`NatsEmitter: setMaxListeners(${n}) called, but NATS client does not have the same listener limit concept.`);
        return this;
    }

    /**
     * Maps a Happen event type or pattern to a NATS subject.
     */
    private mapEventTypeToSubject(eventTypeOrPattern: string): string {
        const prefix = 'happen.events';
        if (eventTypeOrPattern === '*' || eventTypeOrPattern === '>') {
            return `${prefix}.${eventTypeOrPattern}`;
        }
        return `${prefix}.${eventTypeOrPattern}`;
    }

    /**
     * Closes the NATS connection gracefully.
     */
    async close(): Promise<void> {
        if (this.nc) {
            console.log(`NatsEmitter: Draining and closing NATS connection...`);
            try {
                 // Drain ensures inflight messages for subscriptions are processed
                await this.nc.drain(); 
                console.log(`NatsEmitter: NATS connection closed.`);
                this.nc = null;
                this.subscriptions.clear(); // Clear listeners map
                this.observerSubscription = null; // Clear observer sub
            } catch (err) {
                console.error(`NatsEmitter: Error closing NATS connection:`, err);
            }
        }
    }

     /**
     * Destroys the emitter instance.
     */
     destroy(): void {
         this.close().catch(err => console.error("Error during destroy->close:", err));
     }
} 