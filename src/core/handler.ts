import { HappenEvent } from './event';

export interface IHappenHandler {
    handle(event: HappenEvent<any>): Promise<void>;
}

// Basic placeholder implementation
export class HappenHandler implements IHappenHandler {
    constructor(/* dependencies? */) {}

    async handle(event: HappenEvent<any>): Promise<void> {
        console.log(`Placeholder: Handling event ${event.metadata.id} of type ${event.type}`);
        // Add logic to dispatch to specific handlers based on event.type
        // This might involve updating state, triggering side effects, etc.
        return Promise.resolve();
    }
} 