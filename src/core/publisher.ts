// src/core/publisher.ts
import { IHappenEmitter } from './emitter';
import { HappenEvent } from './event';

export interface IHappenPublisher {
    publish(eventType: string, event: HappenEvent<any>): Promise<void>;
}

// Basic implementation using an IHappenEmitter
export class HappenPublisher implements IHappenPublisher {
    constructor(private emitter: IHappenEmitter) {}

    async publish(eventType: string, event: HappenEvent<any>): Promise<void> {
        // Add logic here if needed (e.g., mapping eventType to a specific subject)
        // For now, just use the emitter's emit method
        await this.emitter.emit(eventType, event);
    }
} 