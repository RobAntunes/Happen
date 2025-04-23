import { HappenNode, NodeOptions } from "../src/core/HappenNode";
import { createHappenContext } from "../src/core/factory"; // Import from factory
import { DenoCrypto } from "../src/runtime/DenoCrypto";
// Use Node compatible EventEmitter via deno std/node
import { EventEmitter } from 'node:events';
import type { IEventEmitter, HappenRuntimeModules } from '../src/core/runtime-modules';
import { PatternEmitter } from '../src/core/PatternEmitter';
import type { HappenEvent } from '../src/core/event';
import { createConsoleObserver } from '../src/observability/observer';
import { createEventTracer } from '../src/observability/tracer';

// --- Helper Function for Testing Async State Changes ---
async function waitForState<S>(
    node: HappenNode<S> | null, // Allow null check
    predicate: (state: S) => boolean,
    timeoutMs: number = 2000,
    pollIntervalMs: number = 50
): Promise<void> {
    if (!node) throw new Error("waitForState: Provided node is null.");
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const currentState = node.getState();
        if (predicate(currentState)) {
            return; // Condition met
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`Timeout waiting for state condition on node ${node.id}`);
}
// --- End Helper ---

// Basic Example: Two nodes communicating via Deno's node:events compatible EventEmitter

async function runDenoExample() {
    console.log("--- Basic Deno Example Start ---");

    // 1. Setup Runtime Modules & Context/Factory
    const crypto = new DenoCrypto();
    const baseEmitter = new EventEmitter() as IEventEmitter;
    baseEmitter.setMaxListeners?.(30);
    const happenEmitter = new PatternEmitter(baseEmitter);
    const runtimeModules: HappenRuntimeModules = { crypto, emitterInstance: happenEmitter };
    const createNode = createHappenContext(runtimeModules);

    // Add Observer & Tracer
    const disposeObserver = happenEmitter.addObserver(createConsoleObserver({ prefix: '[O]', logPayload: false, logMetadata: false }));
    const tracer = createEventTracer('*', happenEmitter);
    console.log("Observer and Tracer attached.");

    // 2. Create Nodes using the factory
    const nodeA = createNode({ id: 'DenoNodeA', initialState: { count: 0 } });
    const nodeB = createNode({ id: 'DenoNodeB', initialState: { count: 0 } });

    // 3. Initialize Nodes
    console.log(`\nInitializing nodes...`);
    await nodeA.init();
    await nodeB.init();
    console.log("Nodes initialized.");

    // Interaction ID
    const interactionId = `deno-txn-${crypto.randomUUID().substring(0, 8)}`;

    // 4. Setup Listeners
    console.log(`\nSetting up listeners...`);
    const disposeA = nodeA.on('event-b', (event: HappenEvent<{ value: number }>) => {
        console.log(`\n[${nodeA.id}] Received '${event.type}' from ${event.metadata.sender}`);
        nodeA.setState({ count: nodeA.getState().count + 1 });
    });

    const disposeB = nodeB.on('event-a', async (event: HappenEvent<{ value: number }>) => {
        console.log(`\n[${nodeB.id}] Received '${event.type}' from ${event.metadata.sender}`);
        nodeB.setState({ count: nodeB.getState().count + 1 });

        console.log(`  -> [${nodeB.id}] Emitting 'event-b'...`);
        await nodeB.broadcast({ 
            type: 'event-b', 
            payload: { value: 456 },
            metadata: { 
                correlationId: event.metadata.correlationId, // Propagate correlation
                causationId: event.metadata.id // Set causation
            }
        });
    });
    console.log("Listeners ready.");

    // 5. Node A Emits an Event
    console.log("\nNode A emitting 'event-a'...");
    const eventId = crypto.randomUUID();
    await nodeA.broadcast({
        type: 'event-a',
        payload: { value: 123 },
        metadata: {
            id: eventId,
            correlationId: interactionId // Start correlation
        }
    });
    console.log(`[${nodeA.id}] Event ${eventId} emitted.`);

    // Wait for events (specifically, wait for Node A to receive the response)
    console.log("\nWaiting for event processing...");
    await waitForState(nodeA, state => state.count === 1, 1000);

    // 6. Examine Trace
    console.log("\nExamining trace...");
    let pass = true;
    const trace = tracer.getTrace(interactionId);
    if (trace) {
        console.log(`  Trace found for Interaction ID: ${interactionId}`);
        const expectedPath = ['DenoNodeA', 'DenoNodeB'].join(' -> ');
        const actualPath = trace.path.join(' -> ');
        const pathPass = actualPath === expectedPath;
        console.log(`  ASSERT PATH: ${pathPass ? 'PASS' : 'FAIL!'} (Expected: ${expectedPath}, Got: ${actualPath})`);
        if (!pathPass) pass = false;

        const expectedEventCount = 2;
        const countPass = trace.events.length === expectedEventCount;
        console.log(`  ASSERT EVENT COUNT: ${countPass ? 'PASS' : 'FAIL!'} (Expected: ${expectedEventCount}, Got: ${trace.events.length})`);
        if (!countPass) pass = false;
    } else {
        console.error(`  Trace NOT FOUND for Interaction ID: ${interactionId}`);
        pass = false;
    }

    // 7. Cleanup
    console.log("\nCleaning up...");
    disposeA();
    disposeB();
    disposeObserver();
    tracer.dispose();
    console.log("Cleanup complete.");

    // Final Result
    console.log(`TEST_RESULT: ${pass ? 'PASS' : 'FAIL'}`);

    console.log("\n--- Basic Deno Example End ---");
}

// Remove isInitialized helper, use the class method directly
// HappenNode.prototype.isInitialized = function() {
//     return !!this.publicKey;
// };

runDenoExample().catch(error => {
    console.error("Deno example failed:", error);
    // Deno specific exit
    try {
        // @ts-ignore - Ignore TS error, Deno runtime provides this global
        Deno.exit(1);
    } catch (_) {}
});

// Keep Deno process alive briefly to see async logs/events if needed
// Adjust timeout as necessary or remove if coordination is handled differently.
setTimeout(() => { console.log("Example run finished.")}, 500);
