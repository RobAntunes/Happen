import { EventEmitter } from 'node:events';
import type { IEventEmitter } from '../core/runtime-modules';

/**
 * Node.js implementation of the IEventEmitter interface.
 * This is essentially a direct wrapper around Node's built-in EventEmitter.
 * It does NOT handle pattern matching itself; that's the job of PatternEmitter.
 */
export class NodeJsEventEmitter extends EventEmitter implements IEventEmitter {
    // The methods (on, off, emit, setMaxListeners) are inherited directly
    // from the Node.js EventEmitter, fulfilling the IEventEmitter interface.
    constructor() {
        super();
        // Optional: Set default max listeners if desired
        // this.setMaxListeners(15);
    }
} 