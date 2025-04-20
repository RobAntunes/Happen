import { IHappenEmitter, HappenListener, EventObserver, GENERIC_EVENT_SIGNAL } from './emitter';
import type { HappenEvent } from './event';
import type { IEventEmitter } from './runtime-modules'; // Import the interface
import { compilePatternToRegex } from '../utils/patternUtils'; // Import the utility

interface PatternListenerEntry {
    pattern: string;
    listener: HappenListener;
    regex: RegExp; // Store the compiled regex for efficiency
}

/**
 * An implementation of IHappenEmitter that wraps a standard IEventEmitter
 * instance (like Node.js's EventEmitter) to add pattern matching capabilities
 * and observer support.
 */
export class PatternEmitter implements IHappenEmitter {
    private internalEmitter: IEventEmitter; // Use the injected emitter instance
    // Store pattern listeners separately
    private patternListeners: PatternListenerEntry[] = [];
    private hasGenericListener: boolean = false;
    private boundGenericHandler: HappenListener | null = null; // Store the bound handler
    private observers: EventObserver[] = []; // Store active observers
    private maxListeners: number = 10; // Keep track for internal use if needed

    /**
     * Creates a new PatternEmitter.
     * @param injectedEmitter An instance conforming to IEventEmitter (e.g., from HappenRuntimeModules).
     */
    constructor(injectedEmitter: IEventEmitter) {
        this.internalEmitter = injectedEmitter;
        // Use the provided emitter's default or set our own
        this.internalEmitter.setMaxListeners(this.maxListeners); // Set initial limit on internal emitter
    }

    /**
     * Emits an event.
     * Notifies observers first, then fires exact match listeners and pattern listeners.
     */
    emit(eventType: string, event: HappenEvent<any>): void {
        // 1. Notify Observers
        if (this.observers.length > 0) {
            // Use Promise.allSettled to call all observers without stopping on error
             Promise.allSettled(this.observers.map(observer => {
                try {
                    // Wrap potential synchronous observer in Promise.resolve
                    return Promise.resolve(observer(event));
                } catch (syncError) {
                    // Catch sync errors immediately and turn them into rejected promises
                    console.error(`PatternEmitter: Synchronous error in observer for event type '${eventType}':`, syncError);
                    return Promise.reject(syncError);
                }
            })).then(results => {
                results.forEach(result => {
                     if (result.status === 'rejected') {
                         // Log async errors caught by allSettled
                         console.error(`PatternEmitter: Asynchronous error in observer for event type '${eventType}':`, result.reason);
                    }
                });
            });
        }

        // 2. Fire Exact Match Listeners
        let exactListenersFired = false;
        try {
            exactListenersFired = this.internalEmitter.emit(eventType, event);
        } catch (error) {
            console.error(`PatternEmitter: Error during exact emit for type '${eventType}':`, error);
        }

        // 3. Fire Generic Signal for Pattern Listeners
        let genericSignalFired = false;
        if (this.patternListeners.length > 0) {
           try {
                genericSignalFired = this.internalEmitter.emit(GENERIC_EVENT_SIGNAL, event);
           } catch(error) {
                console.error(`PatternEmitter: Error during generic signal emit for type '${eventType}':`, error);
           }
        }

        // Logging (can be adjusted based on observer behavior)
        if (exactListenersFired) {
            // console.log(`PatternEmitter: Fired exact listener(s) for type '${eventType}'`);
        }
        if (genericSignalFired) {
            // console.log(`PatternEmitter: Fired generic signal for type '${eventType}' (for pattern matching)`);
        }
    }

    /**
     * Registers a listener.
     * If it's an exact match, uses the internal emitter's .on directly.
     * If it uses patterns, stores it for checking against the generic signal.
     */
    on(patternOrEventType: string, listener: HappenListener): void {
        if (!/[{}*]/.test(patternOrEventType)) {
            // Exact match: Use internal emitter directly
            console.log(`PatternEmitter: Registering exact listener for '${patternOrEventType}'`);
            this.internalEmitter.on(patternOrEventType, listener);
        } else {
            // Pattern match: Store it and ensure the generic listener is active
            try {
                // Use the utility function here
                const regex = compilePatternToRegex(patternOrEventType);
                console.log(`PatternEmitter: Registering pattern listener for '${patternOrEventType}'`);
                this.patternListeners.push({ pattern: patternOrEventType, listener, regex });
                this.ensureGenericListener();
            } catch (e) {
                console.error(`PatternEmitter: Failed to register invalid pattern '${patternOrEventType}':`, e);
            }
        }
    }

    /**
     * Removes a listener.
     * Handles removing both exact and pattern listeners.
     */
    off(patternOrEventType: string, listener: HappenListener): void {
        if (!/[{}*]/.test(patternOrEventType)) {
            // Exact match: Use internal emitter directly
             console.log(`PatternEmitter: Removing exact listener for \'${patternOrEventType}\'`);
             // Ensure the internal emitter has an 'off' method before calling it
             if (this.internalEmitter.off) {
                 this.internalEmitter.off(patternOrEventType, listener);
             } else {
                  console.warn(`PatternEmitter: Underlying emitter does not support 'off' method.`);
             }
        } else {
            // Pattern match: Remove from our internal list
            console.log(`PatternEmitter: Removing pattern listener for \'${patternOrEventType}\'`);
            const initialLength = this.patternListeners.length;
            this.patternListeners = this.patternListeners.filter(
                entry => !(entry.pattern === patternOrEventType && entry.listener === listener)
            );

            // Cleanup generic listener if no pattern listeners remain
            if (this.patternListeners.length === 0 && initialLength > 0 && this.hasGenericListener) {
                console.log("PatternEmitter: Removing generic listener as no pattern listeners remain.");
                // Ensure the internal emitter has an 'off' method and we have a stored handler
                if (this.internalEmitter.off && this.boundGenericHandler) {
                    this.internalEmitter.off(GENERIC_EVENT_SIGNAL, this.boundGenericHandler);
                    this.hasGenericListener = false;
                    this.boundGenericHandler = null; // Clear the stored handler
                } else {
                    console.warn(`PatternEmitter: Cannot remove generic listener; underlying emitter missing 'off' or handler not bound.`);
                }
            }
        }
    }

    /**
     * Attaches the single generic listener to the internal emitter.
     */
    private ensureGenericListener(): void {
        if (!this.hasGenericListener) {
            console.log("PatternEmitter: Attaching generic listener for pattern matching.");
            this.boundGenericHandler = this.handleGenericEvent.bind(this);
            this.internalEmitter.on(GENERIC_EVENT_SIGNAL, this.boundGenericHandler);
            this.hasGenericListener = true;
        }
    }

    /**
     * Handler for the generic event signal from the internal emitter.
     * Checks all registered pattern listeners against the incoming event.
     */
    private handleGenericEvent(event: HappenEvent<any>): void {
        this.patternListeners.forEach(entry => {
            try {
                if (entry.regex.test(event.type)) {
                    Promise.resolve(entry.listener(event)).catch(err => {
                        console.error(`PatternEmitter: Error in pattern listener for pattern '${entry.pattern}' on event type '${event.type}':`, err);
                    });
                }
            } catch (matchError) {
                 console.error(`PatternEmitter: Error matching pattern '${entry.pattern}' against type '${event.type}':`, matchError);
            }
        });
    }

    /**
     * Registers a passive event observer.
     * @param observer The observer function.
     * @returns A dispose function to remove the observer.
     */
    addObserver(observer: EventObserver): () => void {
        this.observers.push(observer);
        console.log("PatternEmitter: Registered an observer.");
        // Return disposer function
        return () => {
            this.observers = this.observers.filter(obs => obs !== observer);
            console.log("PatternEmitter: Disposed an observer.");
        };
    }

    // --- Implement setMaxListeners --- //
    setMaxListeners(n: number): this {
        if (n < 0) throw new Error('setMaxListeners: n must be a positive number');
        this.maxListeners = n;
        // Delegate to the internal emitter
        this.internalEmitter.setMaxListeners(n);
        return this;
    }
} 