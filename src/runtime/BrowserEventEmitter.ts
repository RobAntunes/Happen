import type { IEventEmitter } from '../core/runtime-modules';

// Define a default channel name, could be made configurable
const DEFAULT_CHANNEL_NAME = 'happen-channel';

interface BroadcastMessage {
    type: string | symbol;
    args: any[];
}

/**
 * Browser implementation of IEventEmitter using BroadcastChannel API.
 * Allows communication between browsing contexts (windows, tabs, iframes) on the same origin.
 */
export class BrowserEventEmitter implements IEventEmitter {
    private channel: BroadcastChannel;
    private listeners: Map<string | symbol, Set<(...args: any[]) => void>>;
    private maxListeners: number = 10; // Default, mirroring Node

    /**
     * Creates a new BrowserEventEmitter.
     * @param channelName Optional name for the BroadcastChannel. Defaults to 'happen-channel'.
     */
    constructor(channelName: string = DEFAULT_CHANNEL_NAME) {
        if (typeof window === 'undefined' || !window.BroadcastChannel) {
            throw new Error('BroadcastChannel API is not available in this environment.');
        }
        this.channel = new BroadcastChannel(channelName);
        this.listeners = new Map();

        // Central message handler
        this.channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
            console.log(`[${this.channel.name}][onmessage] Received:`, event.data);
            const { type, args } = event.data;
            const eventListeners = this.listeners.get(type);
            console.log(`[${this.channel.name}][onmessage] Listeners for type '${String(type)}':`, eventListeners);
            if (eventListeners) {
                // Call listeners associated with this event type
                eventListeners.forEach(listener => {
                    try {
                        listener(...args);
                    } catch (error) {
                        console.error('Error in BroadcastChannel event listener:', error);
                    }
                });
            }
        };

        this.channel.onmessageerror = (event: MessageEvent) => {
            console.error('BroadcastChannel message error:', event);
        };
    }

    on(eventName: string | symbol, listener: (...args: any[]) => void): this {
        let eventListeners = this.listeners.get(eventName);
        if (!eventListeners) {
            eventListeners = new Set();
            this.listeners.set(eventName, eventListeners);
        }
        // Log before adding
        console.log(`[${this.channel.name}][on] Registering listener for: ${String(eventName)}`, listener);
        eventListeners.add(listener);
        // Log after adding
        console.log(`[${this.channel.name}][on] Listener map for ${String(eventName)} size: ${eventListeners.size}`);
        // Check against maxListeners (optional, mostly informational here)
        if (eventListeners.size > this.maxListeners && this.maxListeners > 0) {
             console.warn(`Possible BroadcastChannel memory leak detected. ${eventListeners.size} listeners added for event "${String(eventName)}". Use emitter.setMaxListeners() to increase limit.`);
        }
        return this;
    }

    off(eventName: string | symbol, listener: (...args: any[]) => void): this {
        const eventListeners = this.listeners.get(eventName);
        if (eventListeners) {
            eventListeners.delete(listener);
            // Clean up map entry if no listeners remain
            if (eventListeners.size === 0) {
                this.listeners.delete(eventName);
            }
        }
        return this;
    }

    emit(eventName: string | symbol, ...args: any[]): boolean {
        const message: BroadcastMessage = { type: eventName, args };
        // Revert: Only post to channel, rely on PatternEmitter/other mechanisms for local dispatch
        try {
            this.channel.postMessage(message);
            // Return true signifies the message was posted.
            return true;
        } catch (error) {
            console.error('BroadcastChannel postMessage error:', error);
            return false;
        }
        // Remove local listener call logic
    }

    setMaxListeners(n: number): this {
        if (n < 0) throw new Error('setMaxListeners: n must be a positive number');
        this.maxListeners = n;
        return this;
    }

    /**
     * Closes the BroadcastChannel.
     * Essential for cleanup to allow garbage collection.
     */
    close(): void {
        this.channel.close();
        this.listeners.clear();
        console.log(`BroadcastChannel '${this.channel.name}' closed.`);
    }
}
