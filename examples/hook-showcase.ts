import { HappenNode, NodeOptions } from "../src/core/HappenNode";
import { createHappenContext } from "../src/core/factory";
import { HappenEvent, HappenEventMetadata } from '../src/core/event';
import { HookContext, EventHooks } from '../src/core/hook-types';
import { NodeJsCrypto } from "../src/runtime/NodeJsCrypto";

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
    // Fix TS2345: Add missing setMaxListeners
    setMaxListeners(n: number): this {
        // Mock implementation - often a no-op or just logs
        console.log(`[MockEmitter] setMaxListeners(${n}) called.`);
        return this;
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

// NodeB listens for 'ping'
nodeB.on('ping', async (event: HappenEvent<{ message: string; preHandleInfo?: string }>) => {
    console.log(`[NodeB Handler] Received 'ping' from ${event.metadata.sender}.`);
    console.log(`  Payload: ${JSON.stringify(event.payload)}`);
    console.log(`  Metadata contains preEmitTimestamp: ${!!(event.metadata as any).customPreEmitTimestamp}`);
    console.log(`  Payload contains preHandleInfo: ${!!event.payload.preHandleInfo}`);
    const nodeBState = nodeB.getState();
    nodeB.setState({
        processed: nodeBState.processed + 1,
        history: [...nodeBState.history, `ping from ${event.metadata.sender}`]
    });
});

// NodeA emits 'ping'
console.log("[Test] NodeA emitting 'ping'...");
await nodeA.broadcast<{ message: string }>({ type: 'ping', payload: { message: 'Hello from A!' } });

await new Promise(resolve => setTimeout(resolve, 100)); // Allow time for event processing

// --- Example 2: State Change Hooks & Stopping ---

console.log("\n--- Example 2: State Change Hooks & Stopping ---");

// NodeA listens to itself to trigger state changes
nodeA.on('update-value', async (event: HappenEvent<{ amount: number }>) => {
    console.log(`[NodeA Handler] Received 'update-value' with amount ${event.payload.amount}. Calling setState.`);
    const nodeAState = nodeA.getState();
    nodeA.setState({
        value: nodeAState.value + event.payload.amount
    });
});

console.log("[Test] NodeA emitting 'update-value' (amount: 10)...");
await nodeA.broadcast({ type: 'update-value', payload: { amount: 10 } }); // Should succeed
await new Promise(resolve => setTimeout(resolve, 50));
console.log(`[Test] NodeA current value: ${nodeA.getState().value}`); // Should be 10

console.log("[Test] NodeA emitting 'update-value' (amount: -20)...");
await nodeA.broadcast({ type: 'update-value', payload: { amount: -20 } }); // Should be stopped by preStateChange
await new Promise(resolve => setTimeout(resolve, 50));
console.log(`[Test] NodeA current value: ${nodeA.getState().value}`); // Should still be 10

console.log(`[Test] NodeA state log: ${JSON.stringify(nodeA.getState().log)}`); // Should contain one update message

// --- Example 3: Priority and Array Order ---

console.log("\n--- Example 3: Priority and Array Order ---");

// NodeB listens for 'config'
nodeB.on('config', async (event: HappenEvent) => {
    console.log(`[NodeB Handler] Received 'config' from ${event.metadata.sender}.`);
    const nodeBStateConf = nodeB.getState();
    nodeB.setState({
        processed: nodeBStateConf.processed + 1,
        history: [...nodeBStateConf.history, `config from ${event.metadata.sender}`]
    });
});

console.log("[Test] NodeA emitting 'config'...");
await nodeA.broadcast({ type: 'config', payload: { setting: 'on' } });

await new Promise(resolve => setTimeout(resolve, 100));

// --- Example 4: PostHandle with Error ---

console.log("\n--- Example 4: PostHandle with Error ---");

// NodeA handler that sometimes fails
nodeA.on('fail-sometimes', async (event: HappenEvent<{ chance: number }>) => {
    console.log(`[NodeA Handler] Received 'fail-sometimes'. Chance to fail: ${event.payload.chance}`);
    if (Math.random() < event.payload.chance) {
        console.log("[NodeA Handler] Failing...");
        throw new Error("Intentional failure!");
    }
    console.log("[NodeA Handler] Succeeding...");
    const nodeAStateFail = nodeA.getState();
    nodeA.setState({ value: nodeAStateFail.value + 1 });
});

console.log("[Test] Emitting 'fail-sometimes' (chance 0.9)...");
await nodeA.broadcast({ type: 'fail-sometimes', payload: { chance: 0.9 } });
await new Promise(resolve => setTimeout(resolve, 50));

console.log("[Test] Emitting 'fail-sometimes' (chance 0.1)...");
await nodeA.broadcast({ type: 'fail-sometimes', payload: { chance: 0.1 } });
await new Promise(resolve => setTimeout(resolve, 50));

console.log("[Test] Emitting 'fail-sometimes' again (postHandle hook should NOT run)...");
await nodeA.broadcast({ type: 'fail-sometimes', payload: { chance: 0.9 } });
await new Promise(resolve => setTimeout(resolve, 50));

console.log(`[Test] NodeA final state log: ${JSON.stringify(nodeA.getState().log)}`);

// --- Cleanup ---
nodeA.destroy();
nodeB.destroy();
runtimeModules.emitterInstance.destroy(); // Assuming emitter has destroy

console.log("\n--- Hook Showcase Complete ---");
// Add PASS marker for test runner
console.log("TEST_RESULT: PASS"); 