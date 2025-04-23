import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HappenNode } from "../src/core/HappenNode";
import { createHappenContext } from "../src/core/factory";
import { NodeJsCrypto } from '../src/runtime/NodeJsCrypto';
import { EventEmitter } from 'node:events';
import type { IEventEmitter, HappenRuntimeModules } from '../src/core/runtime-modules';
import type { HappenEvent } from '../src/core/event';
import { PatternEmitter } from '../src/core/PatternEmitter';
import { createEventTracer, EventTracer } from '../src/observability/tracer';
import crypto from 'node:crypto'; // Use node crypto directly

describe('Node Chained Events (Trace-Based)', () => {

    let createNode: ReturnType<typeof createHappenContext>;
    let nodeA: HappenNode | null = null;
    let nodeB: HappenNode | null = null;
    let nodeC: HappenNode | null = null;
    let tracer: EventTracer | null = null;
    let runtimeModules: HappenRuntimeModules;

    beforeAll(() => {
        // Setup context once for the describe block
        runtimeModules = getDefaultNodeRuntimeModules();
        createNode = createHappenContext(runtimeModules);
        // Instantiate tracer attached to the emitter
        tracer = createEventTracer('*', runtimeModules.emitterInstance!);
    });

    afterAll(() => {
        // Dispose tracer after all tests in the block
        tracer?.dispose();
    });

    it('should successfully process a chained event A -> B -> C and capture the correct trace', async () => {
        // Test-specific setup
        let disposeB: (() => void) | null = null;
        let disposeC: (() => void) | null = null;

        try {
            // 1. Create Nodes
            nodeA = createNode({ id: 'ChainedNodeA', initialState: { status: 'idle' } });
            nodeB = createNode({ id: 'ChainedNodeB', initialState: { eventACount: 0 } });
            nodeC = createNode({ id: 'ChainedNodeC', initialState: { eventBCount: 0 } });

            // 2. Initialize Nodes
            await Promise.all([nodeA.init(), nodeB.init(), nodeC.init()]);
            // console.log("Nodes initialized."); // Keep console logs minimal in tests

            // 3. Setup Listeners (Copied and adapted from example)
            // Node B listens for event-A
            disposeB = nodeB.on(
                'event-A',
                async (event: HappenEvent<{ value: number }>) => {
                    // console.log(`\n[NodeB] Received event-A (${event.metadata.id})`);
                    const currentBState = nodeB!.getState();
                    nodeB!.setState({ eventACount: currentBState.eventACount + 1 });

                    const eventBId = crypto.randomUUID();
                    const eventBMetadata = {
                        id: eventBId,
                        causationId: event.metadata.id,
                        correlationId: event.metadata.correlationId,
                        context: event.metadata.context // Propagate context
                    };

                    // console.log('[NodeB] Broadcasting event-B...');
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
                async (event: HappenEvent<{ derivedValue: number }>) => {
                    // console.log(`\n[NodeC] Received event-B (${event.metadata.id})`);
                    const currentCState = nodeC!.getState();
                    nodeC!.setState({ eventBCount: currentCState.eventBCount + 1 });

                    const signalId = event.metadata.context?.signalOnCompletion as string | undefined;
                    if (signalId) {
                        // console.log(`[NodeC] Sending completion signal: _signal.${signalId}`);
                        await nodeC!.broadcast({ type: `_signal.${signalId}`, payload: {} });
                    }
                }
            );
            // console.log("Listeners ready.");

            // 4. Initiate the Chain (Copied and adapted)
            const eventAId = crypto.randomUUID();
            const signalId = crypto.randomUUID();
            const correlationId = `trace-${crypto.randomUUID()}`; // Use specific correlation ID for trace

            const signalPromise = new Promise<void>((resolve, reject) => {
                let disposeSignalListener: (() => void) | null = null;
                const signalTimeoutId = setTimeout(() => {
                     if (disposeSignalListener) disposeSignalListener();
                     reject(new Error(`Timeout waiting for chain completion signal ${signalId}`));
                }, 2000);

                const signalEventType = `_signal.${signalId}`;
                disposeSignalListener = nodeA!.on(signalEventType, (signalEvent: HappenEvent<any>) => {
                    // console.log(`[NodeA] Received chain completion signal ${signalEventType}`);
                    clearTimeout(signalTimeoutId);
                    if (disposeSignalListener) disposeSignalListener();
                    resolve();
                });
            });

            // console.log(`\nNodeA broadcasting event-A (CorrID: ${correlationId})...`);
            await nodeA.broadcast({
                type: 'event-A',
                payload: { value: 10 },
                metadata: {
                    id: eventAId,
                    correlationId: correlationId, // << Use test-specific correlation ID
                    context: { signalOnCompletion: signalId }
                }
            });
            await nodeA.setState({ status: 'event-A sent' });

            // 5. Wait for completion signal
            // console.log("\nWaiting for chain completion signal...");
            await signalPromise;
            // console.log("Signal received.");
            
            // Yield/wait specifically for pending microtasks (like the observer's .then())
            // await new Promise(resolve => setImmediate(resolve)); // Didn't work reliably
            // await new Promise(resolve => setTimeout(resolve, 0)); // Didn't work reliably
            await Promise.resolve(); // Flush current microtasks
            await Promise.resolve(); // Flush potentially newly queued microtasks (belt-and-suspenders)

            // 6. Verification (Trace-Based)
            const trace = tracer!.getTrace(correlationId);

            // --- Assertions about the Trace ---
            expect(trace).toBeDefined();
            if (!trace) return; // Type guard for TypeScript

            // Check event sequence types (including signal)
            const eventTypes = trace.events.map(e => e.type);
            expect(eventTypes).toEqual(['event-A', 'event-B', `_signal.${signalId}`]);

            // Check sender path
            expect(trace.path).toEqual(['ChainedNodeA', 'ChainedNodeB', 'ChainedNodeC']);

            // Check number of events
            expect(trace.events.length).toBe(3);

            // Check correlation ID consistency
            trace.events.forEach(event => {
                expect(event.metadata.correlationId).toBe(correlationId);
            });

            // Check causation links (Event B caused by A, Signal caused by B?)
            // Note: The signal is broadcast by C, but its *direct* cause isn't event-B in the metadata.
            // Its trigger is the *handler* for event-B. Let's check B caused by A.
            expect(trace.events[1].metadata.causationId).toBe(trace.events[0].metadata.id); // Event B caused by Event A

            // Check final state of Node C (Optional state check alongside trace)
            // expect(nodeC?.getState().eventBCount).toBe(1);


        } finally {
            // 7. Cleanup
            // console.log("\nCleaning up test...");
            disposeB?.();
            disposeC?.();
            // Node cleanup might be needed if state persists across tests, but often not required if context is fresh
            // nodeA?.destroy(); nodeB?.destroy(); nodeC?.destroy();
        }
    });

    // Add more 'it' blocks for other scenarios if needed
});

// Helper to get default Node.js runtime modules (adjust path if necessary)
// Assuming PatternEmitter over NodeJsEventEmitter based on previous examples
function getDefaultNodeRuntimeModules(): HappenRuntimeModules {
    const crypto = new NodeJsCrypto();
    const baseEmitter = new EventEmitter() as IEventEmitter;
    baseEmitter.setMaxListeners?.(30);
    const happenEmitter = new PatternEmitter(baseEmitter);
    return { crypto, emitterInstance: happenEmitter };
} 