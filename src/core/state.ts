// src/core/state.ts
export interface IHappenState<S = any> {
    get(): S;
    set(newState: S): void;
    // Potentially add methods for partial updates, listeners, etc.
}

// Basic default implementation (could be used in HappenNode if no specific state module is provided)
export class DefaultState<S = any> implements IHappenState<S> {
    private _state: S;
    constructor(initial: S) { 
        this._state = initial; 
    }
    get(): S { 
        return this._state; 
    }
    set(newState: S): void { 
        this._state = newState; 
    }
} 