import { HappenEvent } from './event';

export interface IHappenMerger {
    // Define methods relevant to merging states or event histories
    mergeStates<S = any>(stateA: S, stateB: S): Promise<S>;
    mergeEventLogs(logA: HappenEvent<any>[], logB: HappenEvent<any>[]): Promise<HappenEvent<any>[]>;
}

// Basic placeholder implementation
export class HappenMerger implements IHappenMerger {
    constructor(/* dependencies? */) {}

    async mergeStates<S = any>(stateA: S, stateB: S): Promise<S> {
        console.log(`Placeholder: Merging states`);
        // Add actual merge logic (e.g., last-write-wins, CRDT logic)
        // This is a naive merge, likely incorrect for many scenarios
        return Promise.resolve({ ...stateA, ...stateB }); 
    }

    async mergeEventLogs(logA: HappenEvent<any>[], logB: HappenEvent<any>[]): Promise<HappenEvent<any>[]> {
        console.log(`Placeholder: Merging event logs`);
        // Add actual log merge logic (e.g., based on timestamps, vector clocks)
        // Naive concat and sort by timestamp (assumes timestamp is reliable)
        const combined = [...logA, ...logB];
        combined.sort((a, b) => (a.metadata.timestamp || 0) - (b.metadata.timestamp || 0));
        // Deduplicate based on ID (simple approach)
        const uniqueMap = new Map(combined.map(e => [e.metadata.id, e]));
        return Promise.resolve(Array.from(uniqueMap.values()));
    }
} 