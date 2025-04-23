import { HappenNode, NodeOptions } from "../src/core/HappenNode";
import { createHappenContext } from "../src/core/factory"; // Import from factory
import { BunCrypto } from "../src/runtime/BunCrypto"; // Re-exports NodeJsCrypto
import { BunEventEmitter } from '../src/runtime/BunEventEmitter'; // Uses Node compatible EventEmitter
import { PatternEmitter } from '../src/core/PatternEmitter';
import type { HappenEvent } from '../src/core/event';
import type { HappenRuntimeModules } from '../src/core/runtime-modules';
import { createConsoleObserver } from '../src/observability/observer';
import { createEventTracer } from '../src/observability/tracer';
import { EventEmitter } from 'node:events'; // Use Node's EventEmitter for Bun
import { NodeJsCrypto } from '../src/runtime/NodeJsCrypto';
import type { IHappenEmitter } from '../src/core/runtime-modules';

// Basic Example: Two nodes communicating via Bun's EventEmitter

// Helper to get default modules for Bun (using Node.js Crypto)
function getDefaultBunRuntimeModules(): HappenRuntimeModules {
    const crypto = new NodeJsCrypto();
    const baseEmitter = new EventEmitter() as IHappenEmitter; // Cast for compatibility
    baseEmitter.setMaxListeners?.(30); // Optional chaining for safety
    const happenEmitter = new PatternEmitter(baseEmitter);
    return { crypto, emitterInstance: happenEmitter };
}

async function runBunExample() {
    console.log("--- Bun Basic Example Start ---");
    let nodeA: HappenNode | null = null;
    let nodeB: HappenNode | null = null;
    let disposeListenerB: (() => void) | null = null;
    const crypto = new NodeJsCrypto(); // Instance needed for UUID generation

    try {
        // 1. Setup Runtime Modules & Context/Factory
        const runtimeModules = getDefaultBunRuntimeModules();
        const createNode = createHappenContext(runtimeModules);
        console.log("HappenContext created with PatternEmitter for Bun.");

        // 2. Create Nodes
        nodeA = createNode({ id: 'BunNodeA', initialState: { sent: 0 } });
        nodeB = createNode({ id: 'BunNodeB', initialState: { received: 0 } });

        // 3. Initialize Nodes
        await nodeA.init();
        await nodeB.init();
        console.log("Nodes initialized.");

        // 4. Setup Listener on Node B
        disposeListenerB = nodeB.on(
            'bun-event',
            // Make handler async for signal broadcast
            async (event: HappenEvent<{ message: string }>) => {
                console.log(`\n[BunNodeB] Handler running for event: ${event.metadata.id}`);
                const currentState = nodeB!.getState();
                nodeB!.setState({ received: currentState.received + 1 });

                // Check for and send completion signal if requested
                const signalId = event.metadata.context?.signalOnCompletion as string | undefined;
                if (signalId) {
                    console.log(`[BunNodeB] Sending completion signal: _signal.${signalId}`);
                    await nodeB!.broadcast({ type: `_signal.${signalId}` }); // Signal back
                }
            }
        );
        console.log("[BunNodeB] Listener ready.");

        // 5. Node A Broadcasts an Event
        console.log("\nBunNodeA broadcasting 'bun-event'...");
        const eventId = crypto.randomUUID();
        const signalId = crypto.randomUUID(); // Unique ID for this interaction's signal

        // Setup promise and listener for the completion signal *before* broadcasting
        const signalPromise = new Promise<void>((resolve, reject) => {
            let disposeSignalListener: (() => void) | null = null;
            const signalTimeoutId = setTimeout(() => {
                 if (disposeSignalListener) disposeSignalListener();
                 reject(new Error(`Timeout waiting for completion signal ${signalId}`));
            }, 1000); // Timeout

            const signalEventType = `_signal.${signalId}`;
            disposeSignalListener = nodeA!.on(signalEventType, (signalEvent: HappenEvent<any>) => {
                console.log(`[BunNodeA] Received signal ${signalEventType} for event ${eventId}`);
                clearTimeout(signalTimeoutId);
                if (disposeSignalListener) disposeSignalListener(); // Clean up listener
                resolve();
            });
        });

        // Broadcast the event
        await nodeA.broadcast({
            type: 'bun-event',
            payload: { message: 'Hello from BunNodeA!' },
            metadata: { 
                id: eventId,
                context: { signalOnCompletion: signalId } // Add signal request
            }
        });
        console.log(`[BunNodeA] Event ${eventId} broadcasted, waiting for signal ${signalId}.`);
        await nodeA.setState({ sent: 1 });

        // 6. Wait for completion signal
        console.log("\nWaiting for completion signal from BunNodeB...");
        // await new Promise(resolve => setTimeout(resolve, 50)); // Allow time for event loop
        await signalPromise;

        // 7. Verification
        const finalStateA = nodeA.getState();
        console.log(`Final state of BunNodeA:`, finalStateA);

    } catch (error) {
        console.error("Bun example failed:", error);
        // Use process.exit for Node/Bun environment
        process.exit(1);
    }

    console.log("\n--- Bun Basic Example End ---");
}

// Remove isInitialized helper, use the class method directly
// HappenNode.prototype.isInitialized = function() {
//     return !!this.publicKey;
// };

runBunExample().catch(error => {
    console.error("Bun example failed:", error);
    // Use process.exit for Node/Bun environment
    process.exit(1);
});
