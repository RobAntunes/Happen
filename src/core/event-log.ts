import { HappenEvent } from './event';

export interface IHappenEventLog {
    add(event: HappenEvent<any>): void;
    get(eventId: string): HappenEvent<any> | undefined;
    getAll(): HappenEvent<any>[];
    // Add methods for querying, filtering, etc.
}

// Basic in-memory implementation
export class HappenEventLog implements IHappenEventLog {
    private events: Map<string, HappenEvent<any>> = new Map();

    add(event: HappenEvent<any>): void {
        // Basic validation: ensure metadata and id exist
        if (!event || !event.metadata || typeof event.metadata.id !== 'string') {
            console.error("HappenEventLog: Cannot add invalid event:", event);
            return;
        }
        this.events.set(event.metadata.id, event);
    }

    get(eventId: string): HappenEvent<any> | undefined {
        return this.events.get(eventId);
    }

    getAll(): HappenEvent<any>[] {
        return Array.from(this.events.values());
    }
} 