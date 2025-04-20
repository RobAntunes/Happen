import { HappenNode, createHappenContext, NodeOptions } from '../src/core/HappenNode';
import { BunCrypto } from '../src/runtime/BunCrypto'; // Re-exports NodeJsCrypto
import { BunEventEmitter } from '../src/runtime/BunEventEmitter'; // Uses Node compatible EventEmitter
import { PatternEmitter } from '../src/core/PatternEmitter';
import type { HappenEvent } from '../src/core/event';
import type { HappenRuntimeModules } from '../src/core/runtime-modules';
import { createConsoleObserver } from '../src/observability/observer';
import { createEventTracer } from '../src/observability/tracer';

// Basic Example: Two nodes communicating via Bun's EventEmitter

async function runBunExample() {
    console.log("--- Basic Bun Example Start ---");

    // 1. Setup Runtime Modules & Context/Factory
    const crypto = new BunCrypto();
    const baseEmitter = new BunEventEmitter(); // Use Bun's EE
    baseEmitter.setMaxListeners(30);
    const happenEmitter = new PatternEmitter(baseEmitter);
    const runtimeModules: HappenRuntimeModules = { crypto, emitterInstance: happenEmitter };
    const createNode = createHappenContext(runtimeModules); // Create the factory

    // Add Observer
    const disposeObserver = happenEmitter.addObserver(createConsoleObserver({ prefix: '[O]', logPayload: false, logMetadata: false }));
    // Add Tracer
    const tracer = createEventTracer('*', happenEmitter);
    console.log("Observer and Tracer attached.");

    // 2. Create Nodes using the factory
    const nodeA = createNode({ id: 'BunNodeA', initialState: { msg: 'A' } });
    const nodeB = createNode({ id: 'BunNodeB', initialState: { msg: 'B' } });

    // 3. Initialize Nodes
    console.log(`\nInitializing nodes...`);
    await Promise.all([nodeA.init(), nodeB.init()]);
    console.log("Nodes initialized.");

    // Interaction ID
    const interactionId = crypto.randomUUID();

    // 4. Setup Listeners
    console.log(`\nSetting up listeners...`);
    const disposeB = nodeB.on('ping', async (event: HappenEvent<any>) => {
        console.log(`\n[${nodeB.id}] Received 'ping' (Event: ${event.metadata.id}, Corr: ${event.metadata.correlationId})`);
        await new Promise(resolve => setTimeout(resolve, 15)); // Simulate work
        console.log(`[${nodeB.id}] Emitting 'pong'...`);
        nodeB.emit({
            type: 'pong',
            payload: { responseTo: event.metadata.id },
            metadata: {
                correlationId: event.metadata.correlationId,
                causationId: event.metadata.id
            }
        });
    });

    const disposeA = nodeA.on('pong', (event: HappenEvent<any>) => {
        console.log(`\n[${nodeA.id}] Received 'pong' (Event: ${event.metadata.id}, Corr: ${event.metadata.correlationId})`);
        console.log(`  -> Response to: ${event.payload.responseTo}`);
    });
    console.log("Listeners ready.");

    // 5. Node A Emits an Event
    console.log("\nNode A emitting 'ping'...");
    const eventId = crypto.randomUUID();
    await nodeA.emit({
        type: 'ping',
        payload: { value: Math.random() },
        metadata: {
            id: eventId,
            correlationId: interactionId
        }
    });
    console.log(`[${nodeA.id}] Event ${eventId} emitted.`);

    // Wait for events to propagate and be handled
    await new Promise(resolve => setTimeout(resolve, 50));

    // 6. Examine Trace
    console.log("\nExamining trace...");
    let isTestPassing = true; // Use a local variable
    const trace = tracer.getTrace(interactionId);
    if (trace) {
        console.log(`  Trace found for Interaction ID: ${interactionId}`);
        console.log(`  Event Path: ${trace.path.join(' -> ')}`);
        console.log(`  Events captured: ${trace.events.length}`);
        trace.events.forEach((ev: HappenEvent<any>, index: number) => {
            console.log(`    [${index}] Type: ${ev.type}, ID: ${ev.metadata.id}, Sender: ${ev.metadata.sender}`);
        });
        // Adjust expected path based on actual senders
        const expectedPath = ['BunNodeA', 'BunNodeB'].join(' -> ');
        const actualPath = trace.path.join(' -> ');
        const pathPass = actualPath === expectedPath;
        console.log(`  ASSERT PATH: ${pathPass ? 'PASS' : 'FAIL!'} (Expected: ${expectedPath}, Got: ${actualPath})`);
        if (!pathPass) isTestPassing = false;

        const expectedEventCount = 2;
        const countPass = trace.events.length === expectedEventCount;
        console.log(`  ASSERT EVENT COUNT: ${countPass ? 'PASS' : 'FAIL!'} (Expected: ${expectedEventCount}, Got: ${trace.events.length})`);
        if (!countPass) isTestPassing = false;

        // Log final result based on local variable
        console.log(`TEST_RESULT: ${isTestPassing ? 'PASS' : 'FAIL'}`);

    } else {
        console.error(`  Trace NOT FOUND for Interaction ID: ${interactionId}`);
        console.log("TEST_RESULT: FAIL"); // Log fail if trace not found
    }

    // 7. Cleanup
    console.log("\nCleaning up...");
    disposeA();
    disposeB();
    disposeObserver();
    tracer.dispose();
    // baseEmitter.removeAllListeners(); // Optional for BunEventEmitter
    console.log("Cleanup complete.");

    console.log("\n--- Basic Bun Example End ---");
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
