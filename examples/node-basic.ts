import { HappenNode } from '../src/core/HappenNode';
import { NodeJsCrypto } from '../src/runtime/NodeJsCrypto';
import { NodeJsEventEmitter } from '../src/runtime/NodeJsEventEmitter';
import { EventEmitter } from 'node:events';
import type { IEventEmitter } from '../src/core/runtime-modules';
import type { HappenEvent } from '../src/core/event';
import { PatternEmitter } from '../src/core/PatternEmitter';
import { createConsoleObserver } from '../src/observability/observer';
import { createEventTracer } from '../src/observability/tracer';

// Basic Example: Two nodes communicating via a shared Node.js EventEmitter

async function runExample() {
    console.log("--- Basic Node.js Example Start ---");

    // 1. Setup Runtime Modules
    const crypto = new NodeJsCrypto();
    const baseEmitter = new EventEmitter() as IEventEmitter;
    baseEmitter.setMaxListeners(30);

    // Wrap the base emitter with PatternEmitter
    const happenEmitter = new PatternEmitter(baseEmitter);

    // Add a Console Observer to the Emitter
    const disposeObserver = happenEmitter.addObserver(createConsoleObserver({
        prefix: '[OBSERVER]',
        logPayload: false,
        logMetadata: false
    }));
    console.log("Observer attached.");

    // Add an Event Tracer for 'message' events
    const tracer = createEventTracer('message', happenEmitter);
    console.log("Tracer attached for 'message' events.");

    // 2. Create Nodes (pass the PatternEmitter instance)
    const nodeA = new HappenNode('NodeA', { status: 'idle' }, crypto, happenEmitter);
    const nodeB = new HappenNode('NodeB', { messagesReceived: 0 }, crypto, happenEmitter);

    // 3. Initialize Nodes
    console.log(`\nInitializing nodes...`);
    await nodeA.init();
    await nodeB.init();
    console.log("Nodes initialized.");

    // 4. Setup Listener on Node B
    console.log(`\nSetting up listener on Node B for 'message' events...`);
    const disposeListener = nodeB.on('message', (event: HappenEvent<{ text: string }>) => {
        console.log(`\n[NodeB] Handler running for event: ${event.metadata.id}`);
        const currentState = nodeB.getState();
        nodeB.setState({ messagesReceived: currentState.messagesReceived + 1 });
    });
    console.log("[NodeB] Listener ready.");

    // 5. Node A Emits an Event
    console.log("\nNode A emitting 'message' event...");
    const eventId = crypto.randomUUID();
    await nodeA.emit({
        type: 'message',
        payload: { text: 'Hello from Node A!' },
        metadata: { id: eventId }
    });
    console.log(`[NodeA] Event ${eventId} emitted.`);

    // Add a small delay to allow async operations (like observer logging) to potentially complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // 6. Examine Trace
    console.log("\nExamining trace...");
    const trace = tracer.getTrace(eventId);
    if (trace) {
        console.log(`  Trace found for ID: ${eventId}`);
        console.log(`  Event Path: ${trace.path.join(' -> ')}`);
        console.log(`  Number of events in trace: ${trace.events.length}`);
    } else {
        console.log(`  No trace found for ID: ${eventId}`);
    }

    // 7. Cleanup
    console.log("\nCleaning up listener, observer, and tracer...");
    disposeListener();
    disposeObserver();
    tracer.dispose();
    console.log("Cleanup complete.");

    console.log("Listener and observer disposed.");

    // Add a marker for test runners
    console.log("TEST_RESULT: PASS");

    console.log("\n--- Basic Node.js Example End ---");

}

runExample().catch(error => {
    console.error("Example failed:", error);
    process.exit(1);
});
