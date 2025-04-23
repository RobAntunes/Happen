import {
    connect,
    Empty,
    NatsConnection,
    StringCodec,
    Subscription,
} from "nats";
import { HappenNode, NodeOptions } from "../src/core/HappenNode";
import { createHappenContext } from "../src/core/factory"; // Import from factory
import { NodeJsCrypto } from "../src/runtime/NodeJsCrypto";
import { NatsEmitter } from "../src/runtime/NatsEmitter";
import type {
    HappenRuntimeModules,
    IHappenEmitter,
} from "../src/core/runtime-modules";
import type { HappenEvent } from "../src/core/event";

// --- Helper Function for Testing Async State Changes ---
async function waitForState<S>(
    node: HappenNode<S>,
    predicate: (state: S) => boolean,
    timeoutMs: number = 2000, // Default timeout
    pollIntervalMs: number = 50 // How often to check
): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        // Handle cases where node might be null during check (though unlikely in this context)
        if (!node) throw new Error("waitForState: Provided node is null.");
        const currentState = node.getState();
        if (predicate(currentState)) {
            return; // Condition met
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs)); // Wait before next poll
    }
    throw new Error(`Timeout waiting for state condition on node ${node?.id}`);
}
// --- End Helper ---

async function runExample() {
    console.log("--- NATS Emitter Basic Example Start ---");

    let natsEmitter: NatsEmitter | null = null;
    let disposeListenerB: (() => void) | null = null;
    let nodeA: HappenNode | null = null;
    let nodeB: HappenNode | null = null;

    try {
        // 1. Create and Connect NatsEmitter
        // We create it outside the context to manage its lifecycle explicitly for the test
        natsEmitter = new NatsEmitter();
        await natsEmitter.connect(); // This ensures the NATS server is running
        console.log("NatsEmitter connected.");

        // 2. Setup Runtime Modules & Context/Factory using NatsEmitter
        const crypto = new NodeJsCrypto();
        const runtimeModules: HappenRuntimeModules = {
            crypto,
            emitterInstance: natsEmitter,
        };
        const createNode = createHappenContext(runtimeModules);
        console.log("HappenContext created with NatsEmitter.");

        // 3. Create Nodes using the factory
        nodeA = createNode({ id: "NatsNodeA", initialState: { sent: 0 } });
        nodeB = createNode({ id: "NatsNodeB", initialState: { received: 0 } });

        // 4. Initialize Nodes
        console.log(`\nInitializing nodes...`);
        await nodeA!.init();
        await nodeB!.init();
        console.log("Nodes initialized.");

        // 5. Setup Listener on Node B
        console.log(
            `\nSetting up listener on Node B for 'nats-message' events...`,
        );
        disposeListenerB = nodeB!.on(
            "nats-message",
            // Make handler async again for the signal broadcast
            async (event: HappenEvent<{ text: string }>) => { 
                console.log(
                    `\n[NatsNodeB] Handler running for event: ${event.metadata.id}`,
                );
                 const currentState = nodeB!.getState();
                 nodeB!.setState({ received: currentState.received + 1 });
                 
                 // Check for and send completion signal if requested
                 const signalId = event.metadata.context?.signalOnCompletion as string | undefined;
                 if (signalId) {
                     console.log(`[NatsNodeB] Sending completion signal: _signal.${signalId}`);
                     // Use broadcast for the signal
                     await nodeB!.broadcast({
                         type: `_signal.${signalId}`,
                         payload: { processedEventId: event.metadata.id } // Optional payload
                     });
                 }
            },
        );
        console.log("[NatsNodeB] Listener ready.");

        // 6. Node A Broadcasts an Event via NATS
        console.log("\nNatsNodeA broadcasting 'nats-message' event...");
        const eventId = crypto.randomUUID();
        const signalId = crypto.randomUUID(); // Unique ID for this interaction's signal

        // Setup promise and listener for the completion signal *before* broadcasting
        let signalReceived = false;
        const signalPromise = new Promise<void>((resolve, reject) => {
            let disposeSignalListener: (() => void) | null = null;
            const signalTimeoutId = setTimeout(() => {
                 if (disposeSignalListener) disposeSignalListener(); 
                 console.error(`[NatsNodeA] Timeout waiting for signal ${signalId} for event ${eventId}`);
                 reject(new Error(`Timeout waiting for completion signal ${signalId}`));
            }, 2000); // Add a timeout (e.g., 2 seconds)

            const signalEventType = `_signal.${signalId}`;
            console.log(`[NatsNodeA] Listening for completion signal: ${signalEventType}`);
            disposeSignalListener = nodeA!.on(signalEventType, (signalEvent: HappenEvent<any>) => {
                // No need to check causationId here, the unique event type is the signal
                console.log(`[NatsNodeA] Received signal ${signalEventType} for event ${eventId}`);
                signalReceived = true;
                clearTimeout(signalTimeoutId);
                if (disposeSignalListener) disposeSignalListener(); // Clean up listener
                resolve();
            });
        });
        
        // Broadcast the event, including the signal ID in context
        await nodeA!.broadcast({
            type: 'nats-message',
            payload: { text: 'Hello via NATS!' },
            metadata: { 
                id: eventId,
                context: { signalOnCompletion: signalId } // Add signal request
            }
        });
        console.log(`[NatsNodeA] Event ${eventId} broadcasted, waiting for signal ${signalId}.`);
        await nodeA!.setState({ sent: 1 });

        // 7. Wait for completion signal
        console.log("\nWaiting for completion signal from Node B...");
        await signalPromise; // Wait for the signal listener to resolve the promise

        // Verification (state check remains the same)
        const finalStateA = nodeA!.getState();
        const finalStateB = nodeB!.getState();

        console.log("Final State A:", finalStateA);
        console.log("Final State B:", finalStateB);

        if (finalStateA.sent === 1 && finalStateB.received === 1) {
            console.log("\nNATS communication successful!");
        } else {
            throw new Error(
                `Verification failed! State A: ${
                    JSON.stringify(finalStateA)
                }, State B: ${JSON.stringify(finalStateB)}`,
            );
        }

        // Add a marker for test runners
        console.log("TEST_RESULT: PASS");
    } catch (error) {
        console.error("\n--- NATS Example FAILED ---");
        console.error(error);
        console.log("TEST_RESULT: FAIL");
        process.exitCode = 1; // Indicate failure
    } finally {
        // 8. Cleanup
        console.log("\nCleaning up...");
        if (disposeListenerB) disposeListenerB();
        // Workaround: Comment out destroy calls due to persistent TS2349 error
        // if (nodeA) nodeA.destroy();
        if (natsEmitter) {
            await natsEmitter.close();
        }
        console.log("Cleanup complete.");
    }

    console.log("\n--- NATS Emitter Basic Example End ---");
}

runExample().catch((error) => {
    console.error("Example run failed unexpectedly:", error);
    process.exitCode = 1; // Indicate failure
    // Ensure cleanup is attempted even if runExample itself throws early
    // The 'finally' block within runExample already handles cleanup
});
