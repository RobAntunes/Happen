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

async function runExample() {
    console.log("--- Node Chained Events Example Start ---");
    let nodeA: HappenNode | null = null;
    let nodeB: HappenNode | null = null;
    let nodeC: HappenNode | null = null;
    let disposeB: (() => void) | null = null;
    let disposeC: (() => void) | null = null;
    const crypto = await import('node:crypto');

    try {
        // 1. Setup Runtime Modules & Context/Factory
        const runtimeModules = getDefaultNodeRuntimeModules();
        const createNode = createHappenContext(runtimeModules);
        console.log("HappenContext created with default PatternEmitter.");

        // 2. Create Nodes
        nodeA = createNode({ id: 'ChainedNodeA', initialState: { status: 'idle' } });
        nodeB = createNode({ id: 'ChainedNodeB', initialState: { eventACount: 0 } });
        nodeC = createNode({ id: 'ChainedNodeC', initialState: { eventBCount: 0 } });

        // 3. Initialize Nodes
        await Promise.all([nodeA.init(), nodeB.init(), nodeC.init()]);
        console.log("Nodes initialized.");

        // 4. Setup Listeners
        // Node B listens for event-A
        disposeB = nodeB.on(
            'event-A',
            // Make handler async, propagate signal request
            async (event: HappenEvent<{ value: number }>) => {
                console.log(`\n[NodeB] Received event-A (${event.metadata.id}), value: ${event.payload.value}`);
                const currentBState = nodeB!.getState();
                nodeB!.setState({ eventACount: currentBState.eventACount + 1 });

                // Prepare event-B, propagating context (including signal request)
                const eventBId = crypto.randomUUID();
                const eventBMetadata = { 
                    id: eventBId,
                    causationId: event.metadata.id, // Link cause to event-A
                    correlationId: event.metadata.correlationId, // Keep original correlation
                    context: event.metadata.context // <<<<< Propagate context
                };
                
                console.log('[NodeB] Broadcasting event-B...');
                await nodeB!.broadcast({
                    type: 'event-B',
                    payload: { derivedValue: event.payload.value * 2 },
                    metadata: eventBMetadata
                });
            }
        );

        // Node C listens for event-B
        disposeC = nodeC.on(
            'event-B',
            // Make handler async, send final signal
            async (event: HappenEvent<{ derivedValue: number }>) => {
                console.log(`\n[NodeC] Received event-B (${event.metadata.id}), derivedValue: ${event.payload.derivedValue}`);
                const currentCState = nodeC!.getState();
                nodeC!.setState({ eventBCount: currentCState.eventBCount + 1 });

                // Check for and send completion signal if requested (propagated from A)
                const signalId = event.metadata.context?.signalOnCompletion as string | undefined;
                if (signalId) {
                    console.log(`[NodeC] Sending completion signal: _signal.${signalId}`);
                    // Use broadcast from Node C
                    await nodeC!.broadcast({ type: `_signal.${signalId}` }); 
                }
            }
        );
        console.log("Listeners ready.");

        // 5. Node A Broadcasts event-A, requesting signal
        console.log("\nNodeA broadcasting event-A...");
        const eventAId = crypto.randomUUID();
        const signalId = crypto.randomUUID(); // Signal for the *entire chain*
        const correlationId = crypto.randomUUID(); // Correlation for the whole interaction

        // Setup promise and listener for the completion signal *before* broadcasting
        const signalPromise = new Promise<void>((resolve, reject) => {
            let disposeSignalListener: (() => void) | null = null;
            const signalTimeoutId = setTimeout(() => {
                 if (disposeSignalListener) disposeSignalListener(); 
                 reject(new Error(`Timeout waiting for chain completion signal ${signalId}`));
            }, 2000); // Timeout (e.g., 2 seconds)

            const signalEventType = `_signal.${signalId}`;
            // Node A listens for the signal sent by Node C
            disposeSignalListener = nodeA!.on(signalEventType, (signalEvent: HappenEvent<any>) => {
                console.log(`[NodeA] Received chain completion signal ${signalEventType}`);
                clearTimeout(signalTimeoutId);
                if (disposeSignalListener) disposeSignalListener(); // Clean up listener
                resolve();
            });
        });

        // Broadcast event-A, including signal request and correlation ID
        await nodeA.broadcast({
            type: 'event-A',
            payload: { value: 10 },
            metadata: {
                id: eventAId,
                correlationId: correlationId, // Correlate the chain
                context: { signalOnCompletion: signalId } // Request signal
            }
        });
        console.log(`[NodeA] Event ${eventAId} broadcasted, waiting for signal ${signalId}.`);
        await nodeA.setState({ status: 'event-A sent' });

        // 6. Wait for completion signal from Node C
        console.log("\nWaiting for chain completion signal from Node C...");
        await signalPromise; // Wait for the signal
        // await new Promise(resolve => setTimeout(resolve, 100)); // Old timeout

        // 7. Verification
        const finalStateA = nodeA.getState();

        // 8. Cleanup
        console.log("\nCleaning up...");
        disposeB();
        disposeC();
        console.log("Cleanup complete.");

        console.log("\n--- Node Chained Events Example End ---");
    } catch (error) {
        console.error("Chained example failed:", error);
        process.exit(1);
    }
}

runExample().catch(error => {
    console.error("Chained example failed:", error);
    process.exit(1);
});
