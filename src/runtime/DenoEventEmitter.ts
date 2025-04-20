import type { IEventEmitter } from '../core/runtime-modules';

// Define a default channel name, could be made configurable
const DEFAULT_CHANNEL_NAME = 'happen-channel';

interface BroadcastMessage {
    type: string | symbol;
    args: any[];
}

/**
 * Deno implementation of IEventEmitter using BroadcastChannel API.
 * Allows communication between different Deno workers/processes on the same machine,
 * potentially (depending on Deno's specific implementation details).
 */
export class DenoEventEmitter implements IEventEmitter {
    private channel: BroadcastChannel;
    private listeners: Map<string | symbol, Set<(...args: any[]) => void>>;
    private maxListeners: number = 10; // Default, mirroring Node

    /**
     * Creates a new DenoEventEmitter.
     * @param channelName Optional name for the BroadcastChannel. Defaults to 'happen-channel'.
     */
    constructor(channelName: string = DEFAULT_CHANNEL_NAME) {
        // Deno provides BroadcastChannel globally
        if (typeof BroadcastChannel === 'undefined') {
            throw new Error('BroadcastChannel API is not available in this Deno environment.');
        }
        this.channel = new BroadcastChannel(channelName);
        this.listeners = new Map();

        // Central message handler
        this.channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
            const { type, args } = event.data;
            const eventListeners = this.listeners.get(type);
            if (eventListeners) {
                eventListeners.forEach(listener => {
                    try {
                        listener(...args);
                    } catch (error) {
                        console.error('Error in Deno BroadcastChannel event listener:', error);
                    }
                });
            }
        };

        this.channel.onmessageerror = (event: MessageEvent) => {
            console.error('Deno BroadcastChannel message error:', event);
        };
    }

    on(eventName: string | symbol, listener: (...args: any[]) => void): this {
        let eventListeners = this.listeners.get(eventName);
        if (!eventListeners) {
            eventListeners = new Set();
            this.listeners.set(eventName, eventListeners);
        }
        eventListeners.add(listener);
        if (eventListeners.size > this.maxListeners && this.maxListeners > 0) {
             console.warn(`Possible Deno BroadcastChannel memory leak detected. ${eventListeners.size} listeners added for event "${String(eventName)}". Use emitter.setMaxListeners() to increase limit.`);
        }
        return this;
    }

    off(eventName: string | symbol, listener: (...args: any[]) => void): this {
        const eventListeners = this.listeners.get(eventName);
        if (eventListeners) {
            eventListeners.delete(listener);
            if (eventListeners.size === 0) {
                this.listeners.delete(eventName);
            }
        }
        return this;
    }

    emit(eventName: string | symbol, ...args: any[]): boolean {
        const message: BroadcastMessage = { type: eventName, args };
        try {
            this.channel.postMessage(message);
            return true;
        } catch (error) {
            console.error('Deno BroadcastChannel postMessage error:', error);
            return false;
        }
    }

    setMaxListeners(n: number): this {
        if (n < 0) throw new Error('setMaxListeners: n must be a positive number');
        this.maxListeners = n;
        return this;
    }

    /**
     * Closes the BroadcastChannel.
     */
    close(): void {
        this.channel.close();
        this.listeners.clear();
        console.log(`Deno BroadcastChannel '${this.channel.name}' closed.`);
    }
}
