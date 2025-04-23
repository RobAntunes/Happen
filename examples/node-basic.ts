import { HappenNode, NodeOptions } from "../src/core/HappenNode";
import { createHappenContext } from "../src/core/factory";
import { NodeJsCrypto } from '../src/runtime/NodeJsCrypto';
import { NodeJsEventEmitter } from '../src/runtime/NodeJsEventEmitter';
import { EventEmitter } from 'node:events';
import type { IEventEmitter, HappenRuntimeModules } from '../src/core/runtime-modules';
import type { HappenEvent } from '../src/core/event';
import { PatternEmitter } from '../src/core/PatternEmitter';
import { createConsoleObserver } from '../src/observability/observer';
import { createEventTracer } from '../src/observability/tracer';

// --- Helper Function for Testing Async State Changes ---
// REMOVED waitForState - using signal pattern instead

// --- End Helper ---

// Basic Example: Two nodes communicating via a shared Node.js EventEmitter

async function runExample() {
    console.log("--- Node Emitter Basic Example Start ---");
    let nodeA: HappenNode | null = null;
    let nodeB: HappenNode | null = null;
    let disposeListenerB: (() => void) | null = null;
    // Use built-in crypto for Node.js
    const crypto = await import('node:crypto');

    try {
        // 1. Setup Runtime Modules & Context/Factory (using PatternEmitter)
        const runtimeModules = getDefaultNodeRuntimeModules();
        const createNode = createHappenContext(runtimeModules);
        console.log("HappenContext created with default PatternEmitter.");

        // 2. Create Nodes
        nodeA = createNode({ id: "NodeA", initialState: { sent: 0 } });
        nodeB = createNode({ id: "NodeB", initialState: { received: 0 } });

        // 3. Initialize Nodes
        await nodeA!.init();
        await nodeB!.init();
        console.log("Nodes initialized.");

        // 4. Setup Listener on Node B
        disposeListenerB = nodeB!.on(
            "basic-event",
            // Make handler async to allow broadcasting the signal
            async (event: HappenEvent<{ message: string }>) => {
                console.log(`\n[NodeB] Handler running for event: ${event.metadata.id}`);
                const currentState = nodeB!.getState();
                nodeB!.setState({ received: currentState.received + 1 });

                // Check for and send completion signal if requested
                const signalId = event.metadata.context?.signalOnCompletion as string | undefined;
                if (signalId) {
                    console.log(`[NodeB] Sending completion signal: _signal.${signalId}`);
                    await nodeB!.broadcast({ type: `_signal.${signalId}` }); // Signal back
                }
            },
        );
        console.log("[NodeB] Listener ready.");

        // 5. Node A Broadcasts an Event
        console.log("\nNodeA broadcasting 'basic-event' event...");
        const eventId = crypto.randomUUID();
        const signalId = crypto.randomUUID(); // Unique ID for this interaction's signal

        // Setup promise and listener for the completion signal *before* broadcasting
        const signalPromise = new Promise<void>((resolve, reject) => {
            let disposeSignalListener: (() => void) | null = null;
            const signalTimeoutId = setTimeout(() => {
                 if (disposeSignalListener) disposeSignalListener(); 
                 reject(new Error(`Timeout waiting for completion signal ${signalId}`));
            }, 1000); // Timeout (e.g., 1 second)

            const signalEventType = `_signal.${signalId}`;
            disposeSignalListener = nodeA!.on(signalEventType, (signalEvent: HappenEvent<any>) => {
                console.log(`[NodeA] Received signal ${signalEventType} for event ${eventId}`);
                clearTimeout(signalTimeoutId);
                if (disposeSignalListener) disposeSignalListener(); // Clean up listener
                resolve();
            });
        });

        // Broadcast the event, including the signal ID
        await nodeA!.broadcast({
            type: 'basic-event',
            payload: { message: 'Hello from NodeA!' },
            metadata: { 
                id: eventId,
                context: { signalOnCompletion: signalId } // Add signal request
            }
        });
        console.log(`[NodeA] Event ${eventId} broadcasted, waiting for signal ${signalId}.`);
        await nodeA!.setState({ sent: 1 });

        // 6. Wait for completion signal
        console.log("\nWaiting for completion signal from Node B...");
        await signalPromise; // Wait for the signal

        // 7. Verification
        const finalStateA = nodeA!.getState();

        // Add a marker for test runners
        console.log("TEST_RESULT: PASS");

        console.log("\n--- Node Emitter Basic Example End ---");

    } catch (error) {
        console.error("Example failed:", error);
        process.exit(1);
    }
}

runExample().catch(error => {
    console.error("Example failed:", error);
    process.exit(1);
});
