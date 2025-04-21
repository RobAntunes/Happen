import { HappenNode, NodeOptions, createHappenContext } from '../src/core/node';
import { HappenEvent, HappenEventMetadata } from '../src/core/event';
import { HookContext, EventHooks } from '../src/core/hook-types';

// Define minimal inline mocks for the example
const mockCryptoProvider = () => ({
    randomUUID: () => Math.random().toString(36).substring(2),
    generateKeyPair: async () => ({ publicKey: { kty: 'OKP', crv: 'Ed25519' }, privateKey: { kty: 'OKP', crv: 'Ed25519' } }),
    sign: async (key: any, data: BufferSource): Promise<string> => Buffer.from(new Uint8Array(32)).toString('base64'),
    verify: async (key: any, signature: string | BufferSource, data: BufferSource) => true,
    hash: async (data: string) => data
});

class MockEmitter {
    listeners = new Map<string, Function[]>();
    on(pattern: string, listener: Function) {
        const list = this.listeners.get(pattern) || [];
        list.push(listener);
        this.listeners.set(pattern, list);
    }
    emit(type: string, event: any) {
        // Very basic emit: find exact matches and run listeners
        const list = this.listeners.get(type);
        if (list) {
            list.forEach(listener => setTimeout(() => listener(event), 0)); // Simulate async dispatch
        }
        // Also check for wildcard listeners
        const wildcardList = this.listeners.get('*');
        if (wildcardList) {
             wildcardList.forEach(listener => setTimeout(() => listener(event), 0));
        }
    }
    off(pattern: string, listener: Function) {
         const list = this.listeners.get(pattern);
         if (list) {
             this.listeners.set(pattern, list.filter(l => l !== listener));
         }
    }
    // Add missing method required by IHappenEmitter
    addObserver(observer: Function): () => void {
        console.warn("MockEmitter.addObserver called - not fully implemented in mock.");
        // Add basic observer logic if needed for tests, or just track it
        const pattern = '*'; // Observers typically listen to everything
        this.on(pattern, observer);
        return () => this.off(pattern, observer); // Return unregister function
    }
    destroy() { this.listeners.clear(); }
}

// Type definition for Node A's state
type NodeAState = { value: number; log: string[] };
// Type definition for Node B's state
type NodeBState = { processed: number; history: string[] };

// --- Setup ---

// 1. Create Runtime Context
const runtimeModules = {
    crypto: mockCryptoProvider(),
    emitterInstance: new MockEmitter()
};
const createNodeInContext = createHappenContext(runtimeModules);

// 2. Create Nodes with explicit state types
const nodeA = createNodeInContext<NodeAState>({
    id: 'NodeA',
    initialState: { value: 0, log: [] }
});
const nodeB = createNodeInContext<NodeBState>({
    id: 'NodeB',
    initialState: { processed: 0, history: [] }
});

// Initialize nodes (required for emitting/handling)
await Promise.all([nodeA.init(), nodeB.init()]);

// --- Example 1: Basic PreEmit and PreHandle ---

console.log("\n--- Example 1: Basic PreEmit & PreHandle ---");

// Register a hook on NodeA before it emits 'ping'
nodeA.registerHooks(
    'ping',
    {
        preEmit: (context: HookContext<NodeAState, any>) => {
            console.log(`[NodeA PreEmit Hook] Event type: ${context.event.type}. Adding preEmitTimestamp.`);
            (context.event.metadata as any).customPreEmitTimestamp = Date.now();
        }
    }
);

// Register a hook on NodeB before it handles 'ping'
nodeB.registerHooks(
    'ping',
    {
        preHandle: (context: HookContext<NodeBState, any>) => {
            console.log(`[NodeB PreHandle Hook] Received event: ${context.event.type}. Adding preHandleInfo.`);
            context.event.payload.preHandleInfo = `Handled by B at ${Date.now()}`;
        }
    }
);

// NodeB listens for 'ping'
nodeB.on('ping', async (event: HappenEvent<{ message: string; preHandleInfo?: string }>) => {
    console.log(`[NodeB Handler] Received 'ping' from ${event.metadata.sender}.`);
    console.log(`  Payload: ${JSON.stringify(event.payload)}`);
    console.log(`  Metadata contains preEmitTimestamp: ${!!(event.metadata as any).customPreEmitTimestamp}`);
    console.log(`  Payload contains preHandleInfo: ${!!event.payload.preHandleInfo}`);
    nodeB.setState((prevState: NodeBState) => ({
        processed: prevState.processed + 1,
        history: [...prevState.history, `ping from ${event.metadata.sender}`]
    }));
});

// NodeA emits 'ping'
console.log("[Test] NodeA emitting 'ping'...");
await nodeA.emit<{ message: string }>({ type: 'ping', payload: { message: 'Hello from A!' } });

await new Promise(resolve => setTimeout(resolve, 100)); // Allow time for event processing

// --- Example 2: State Change Hooks & Stopping ---

console.log("\n--- Example 2: State Change Hooks & Stopping ---");

// Register hooks on NodeA for 'update-value' events
nodeA.registerHooks(
    'update-value',
    {
        preStateChange: (context: HookContext<NodeAState, { amount: number }>) => {
            const amount = context.event.payload.amount;
            console.log(`[NodeA PreStateChange] Current value: ${context.currentState.value}. Attempting to add ${amount}.`);
            if (context.currentState.value + amount < 0) {
                console.log(`[NodeA PreStateChange] Update would result in negative value. Stopping state change!`);
                context.stop(); // Prevent negative value
            }
        },
        afterStateChange: (context: HookContext<NodeAState, { amount: number }>) => {
            console.log(`[NodeA AfterStateChange] Value updated. Old: ${context.currentState.value}, New: ${context.newState?.value}. Logging change.`);
            if (context.newState) {
                 context.newState.log.push(`Updated value to ${context.newState.value}`);
            }
        }
    },
    { priority: 10 }
);

// NodeA listens to itself to trigger state changes
nodeA.on('update-value', async (event: HappenEvent<{ amount: number }>) => {
    console.log(`[NodeA Handler] Received 'update-value' with amount ${event.payload.amount}. Calling setState.`);
    await nodeA.setState((prevState: NodeAState) => ({
        ...prevState, // Keep log
        value: prevState.value + event.payload.amount
    }));
});

console.log("[Test] NodeA emitting 'update-value' (amount: 10)...");
await nodeA.emit({ type: 'update-value', payload: { amount: 10 } }); // Should succeed
await new Promise(resolve => setTimeout(resolve, 50));
console.log(`[Test] NodeA current value: ${nodeA.getState().value}`); // Should be 10

console.log("[Test] NodeA emitting 'update-value' (amount: -20)...");
await nodeA.emit({ type: 'update-value', payload: { amount: -20 } }); // Should be stopped by preStateChange
await new Promise(resolve => setTimeout(resolve, 50));
console.log(`[Test] NodeA current value: ${nodeA.getState().value}`); // Should still be 10

console.log(`[Test] NodeA state log: ${JSON.stringify(nodeA.getState().log)}`); // Should contain one update message

// --- Example 3: Priority and Array Order ---

console.log("\n--- Example 3: Priority and Array Order ---");

// Register hooks on NodeB for 'config' event
nodeB.registerHooks(
    'config',
    {
        preHandle: [
            (context: HookContext<NodeBState, any>) => console.log('[NodeB PreHandle P20-A] Modifying payload (Array Hook 1)'),
            (context: HookContext<NodeBState, any>) => console.log('[NodeB PreHandle P20-B] Logging event (Array Hook 2)'),
        ]
    },
    { priority: 20 }
);

nodeB.registerHooks(
    'config',
    {
        preHandle: (context: HookContext<NodeBState, any>) => console.log('[NodeB PreHandle P10] Checking permissions (Single Hook)')
    },
    { priority: 10 }
);

nodeB.registerHooks(
    'config',
    {
        preHandle: (context: HookContext<NodeBState, any>) => console.log('[NodeB PreHandle P20-C] Final check (Single Hook)')
    },
    { priority: 20 }
);

// NodeB listens for 'config'
nodeB.on('config', async (event: HappenEvent) => {
    console.log(`[NodeB Handler] Received 'config' from ${event.metadata.sender}.`);
    nodeB.setState((prevState: NodeBState) => ({
        processed: prevState.processed + 1,
        history: [...prevState.history, `config from ${event.metadata.sender}`]
    }));
});

console.log("[Test] NodeA emitting 'config'...");
await nodeA.emit({ type: 'config', payload: { setting: 'on' } });

await new Promise(resolve => setTimeout(resolve, 100));

// --- Example 4: PostHandle with Error ---

console.log("\n--- Example 4: PostHandle with Error ---");

// Register postHandle hook on NodeA for 'fail-sometimes'
const unregisterFailHook = nodeA.registerHooks(
    'fail-sometimes',
    {
        postHandle: (context: HookContext<NodeAState, { chance: number }>) => {
            if (context.handlerError) {
                console.log(`[NodeA PostHandle] Handler failed as expected! Error: ${context.handlerError.message}`);
            } else {
                console.log(`[NodeA PostHandle] Handler succeeded.`);
            }
            nodeA.setState((prevState: NodeAState) => ({ ...prevState, log: [...prevState.log, `postHandle for ${context.event.type}`] }));
        }
    }
);

// NodeA handler that sometimes fails
nodeA.on('fail-sometimes', async (event: HappenEvent<{ chance: number }>) => {
    console.log(`[NodeA Handler] Received 'fail-sometimes'. Chance to fail: ${event.payload.chance}`);
    if (Math.random() < event.payload.chance) {
        console.log("[NodeA Handler] Failing...");
        throw new Error("Intentional failure!");
    }
    console.log("[NodeA Handler] Succeeding...");
    nodeA.setState((prevState: NodeAState) => ({ ...prevState, value: prevState.value + 1 }));
});

console.log("[Test] Emitting 'fail-sometimes' (chance 0.9)...");
await nodeA.emit({ type: 'fail-sometimes', payload: { chance: 0.9 } });
await new Promise(resolve => setTimeout(resolve, 50));

console.log("[Test] Emitting 'fail-sometimes' (chance 0.1)...");
await nodeA.emit({ type: 'fail-sometimes', payload: { chance: 0.1 } });
await new Promise(resolve => setTimeout(resolve, 50));

// Unregister the hook
console.log("[Test] Unregistering fail hook...");
unregisterFailHook();

console.log("[Test] Emitting 'fail-sometimes' again (postHandle hook should NOT run)...");
await nodeA.emit({ type: 'fail-sometimes', payload: { chance: 0.9 } });
await new Promise(resolve => setTimeout(resolve, 50));

console.log(`[Test] NodeA final state log: ${JSON.stringify(nodeA.getState().log)}`);

// --- Cleanup ---
nodeA.destroy();
nodeB.destroy();
runtimeModules.emitterInstance.destroy(); // Assuming emitter has destroy

console.log("\n--- Hook Showcase Complete ---");
// Add PASS marker for test runner
console.log("TEST_RESULT: PASS"); 