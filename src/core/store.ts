// src/core/store.ts

export interface IHappenStore {
    // Define methods relevant to storing/retrieving node state or other data
    saveState<S = any>(nodeId: string, state: S): Promise<void>;
    loadState<S = any>(nodeId: string): Promise<S | null>;
    deleteState(nodeId: string): Promise<void>;
}

// Basic placeholder implementation (e.g., in-memory)
export class HappenStore implements IHappenStore {
    private store: Map<string, any> = new Map();

    constructor(/* dependencies? */) {}

    async saveState<S = any>(nodeId: string, state: S): Promise<void> {
        console.log(`Placeholder: Saving state for node ${nodeId}`);
        this.store.set(nodeId, state);
        return Promise.resolve();
    }

    async loadState<S = any>(nodeId: string): Promise<S | null> {
        console.log(`Placeholder: Loading state for node ${nodeId}`);
        const state = this.store.get(nodeId);
        return Promise.resolve(state ? state as S : null);
    }

    async deleteState(nodeId: string): Promise<void> {
        console.log(`Placeholder: Deleting state for node ${nodeId}`);
        this.store.delete(nodeId);
        return Promise.resolve();
    }
} 