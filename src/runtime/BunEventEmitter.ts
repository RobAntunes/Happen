import type { IEventEmitter } from '../core/runtime-modules';
import { EventEmitter } from 'node:events'; // Bun supports node: prefix

/**
 * Bun implementation of IEventEmitter using its Node.js compatible EventEmitter.
 */
export class BunEventEmitter extends EventEmitter implements IEventEmitter {
    // Inherits on, off, emit, setMaxListeners from Node's EventEmitter
    // No additional methods needed as the base class already implements IEventEmitter
    constructor() {
        super();
    }

    // Optional: Add a close/destroy method if needed for specific cleanup,
    // though standard EventEmitter doesn't have one.
    // close(): void {
    //     this.removeAllListeners();
    // }
}
