import { HappenNode } from '../src/core/HappenNode';
import { NodeJsCrypto } from '../src/runtime/NodeJsCrypto';
import { NodeJsEventEmitter } from '../src/runtime/NodeJsEventEmitter';
import { EventEmitter } from 'node:events';
import type { IEventEmitter } from '../src/core/runtime-modules';
import type { HappenEvent } from '../src/core/event';
import { PatternEmitter } from '../src/core/PatternEmitter';
import { createConsoleObserver } from '../src/observability/observer';
import { createEventTracer } from '../src/observability/tracer';

async function runChainedExample() {
    console.log("--- Chained Events Example Start ---");

    // 1. Setup
    const crypto = new NodeJsCrypto();
    const baseEmitter = new EventEmitter() as IEventEmitter;
    baseEmitter.setMaxListeners(30);
    const happenEmitter = new PatternEmitter(baseEmitter);

    // Add Observer (optional, quieter config)
    const disposeObserver = happenEmitter.addObserver(createConsoleObserver({ prefix: '[O]', logPayload: false, logMetadata: false }));

    // Add Tracer to capture the whole flow (* pattern)
    const tracer = createEventTracer('*', happenEmitter);
    console.log("Tracer attached for * events.");

    // 2. Create Nodes
    const serviceA = new HappenNode('ServiceA', {}, crypto, happenEmitter);
    const serviceB = new HappenNode('ServiceB', {}, crypto, happenEmitter);
    const serviceC = new HappenNode('ServiceC', {}, crypto, happenEmitter);

    // 3. Initialize Nodes
    console.log("\nInitializing services...");
    await Promise.all([serviceA.init(), serviceB.init(), serviceC.init()]);
    console.log("Services initialized.");

    // Correlation ID for the entire interaction
    const correlationId = `txn-${crypto.randomUUID().substring(0, 8)}`;
    console.log(`\nStarting interaction with Correlation ID: ${correlationId}`);

    // 4. Setup Listeners
    let event1Id: string | undefined;
    let event2Id: string | undefined;

    const disposeB = serviceB.on('request-data', async (event: HappenEvent<{ requestInfo: string }>) => {
        console.log(`\n[ServiceB] Received 'request-data' (ID: ${event.metadata.id}). Processing...`);
        event1Id = event.metadata.id;
        const processedData = `Processed:${event.payload.requestInfo}`;

        // Emit the next event in the chain
        console.log("[ServiceB] Emitting 'process-data'...");
        event2Id = crypto.randomUUID(); // Generate ID for the new event
        await serviceB.emit({
            type: 'process-data',
            payload: { result: processedData },
            metadata: {
                id: event2Id,
                correlationId: event.metadata.correlationId, // Carry correlationId forward
                causationId: event.metadata.id // Link to the event that caused this one
            }
        });
        console.log(`[ServiceB] Emitted 'process-data' (ID: ${event2Id})`);
    });

    const disposeC = serviceC.on('process-data', (event: HappenEvent<{ result: string }>) => {
        console.log(`\n[ServiceC] Received 'process-data' (ID: ${event.metadata.id}). Final step.`);
        console.log(`  Result: ${event.payload.result}`);
        console.log(`  Correlation: ${event.metadata.correlationId}`);
    });

    console.log("\nListeners ready.");

    // 5. Initiate the Chain from Service A
    console.log("\nInitiating chain from Service A...");
    const initialEventId = crypto.randomUUID();
    await serviceA.emit({
        type: 'request-data',
        payload: { requestInfo: 'input data' },
        metadata: {
            id: initialEventId,
            correlationId: correlationId // Start the correlation
        }
    });
    console.log(`[ServiceA] Emitted 'request-data' (ID: ${initialEventId})`);

    // Add a delay for processing and tracing
    await new Promise(resolve => setTimeout(resolve, 500));

    // 6. Validate Trace
    console.log("\nValidating trace...");
    const trace = tracer.getTrace(correlationId);
    if (trace) {
        console.log(`  Trace found for Correlation ID: ${correlationId}`);
        console.log(`  Event Path: ${trace.path.join(' -> ')}`);
        console.log(`  Events captured: ${trace.events.length}`);
        trace.events.forEach((ev: HappenEvent<any>, index: number) => {
            console.log(`    [${index}] Type: ${ev.type}, ID: ${ev.metadata.id}, Sender: ${ev.metadata.sender}`);
        });

        // Basic Assertions (in a real test, use an assertion library)
        // Current tracer path only includes senders. C receives but doesn't send.
        const expectedPath = ['ServiceA', 'ServiceB'].join(' -> '); // Corrected expected path
        const actualPath = trace.path.join(' -> ');
        console.log(`  ASSERT PATH: ${actualPath === expectedPath ? 'PASS' : 'FAIL!'} (Expected: ${expectedPath}, Got: ${actualPath})`);
        const expectedEventCount = 2;
        console.log(`  ASSERT EVENT COUNT: ${trace.events.length === expectedEventCount ? 'PASS' : 'FAIL!'} (Expected: ${expectedEventCount}, Got: ${trace.events.length})`);

        // Determine overall pass/fail for the test
        const pathPass = actualPath === expectedPath;
        const countPass = trace.events.length === expectedEventCount;
        const overallPass = pathPass && countPass;
        console.log(`TEST_RESULT: ${overallPass ? 'PASS' : 'FAIL'}`); // Add explicit PASS/FAIL marker

    } else {
        console.error(`  Trace NOT FOUND for Correlation ID: ${correlationId}`);
        console.log(`TEST_RESULT: FAIL`); // Ensure FAIL marker if trace not found
    }

    // 7. Cleanup
    console.log("\nCleaning up...");
    disposeB();
    disposeC();
    disposeObserver();
    tracer.dispose();
    console.log("Cleanup complete.");

    console.log("\n--- Chained Events Example End ---");
}

runChainedExample().catch(error => {
    console.error("Chained example failed:", error);
    process.exit(1);
});
