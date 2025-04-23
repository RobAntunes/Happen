import { IHappenEmitter, HappenListener, IHappenListenerDisposable } from './emitter';

// Define the broader return type possible from emitter.on
export type SubscribeReturnType = void | IHappenListenerDisposable | Promise<void | IHappenListenerDisposable>;

export interface IHappenSubscriber {
    subscribe<P = any>(eventType: string, listener: HappenListener<P>): SubscribeReturnType;
    // Potentially add unsubscribe method if disposable pattern isn't always used
    // unsubscribe<P = any>(eventType: string, listener: HappenListener<P>): void;
}

// Basic implementation using an IHappenEmitter
export class HappenSubscriber implements IHappenSubscriber {
    constructor(private emitter: IHappenEmitter) {}

    subscribe<P = any>(eventType: string, listener: HappenListener<P>): SubscribeReturnType {
        // Use the emitter's 'on' method and return its result directly
        return this.emitter.on(eventType, listener);
    }
} 