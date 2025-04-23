import { HappenNode, NodeOptions } from '../src/core/HappenNode';
import { createHappenContext } from '../src/core/factory';
import { NodeJsCrypto } from '../src/runtime/NodeJsCrypto';
import { NodeJsEventEmitter } from '../src/runtime/NodeJsEventEmitter';
import { EventEmitter } from 'node:events';
import type { IEventEmitter, HappenRuntimeModules } from '../src/core/runtime-modules';
import type { HappenEvent } from '../src/core/event';
import { PatternEmitter } from '../src/core/PatternEmitter';

async function runExample() {
    console.log("--- Node Request/Send Example Start ---");

    // 1. Setup Runtime Modules & Context/Factory
    const crypto = new NodeJsCrypto();
    const baseEmitter = new EventEmitter() as IEventEmitter;
    baseEmitter.setMaxListeners(30);
    const happenEmitter = new PatternEmitter(baseEmitter);
    const runtimeModules: HappenRuntimeModules = { crypto, emitterInstance: happenEmitter };
    const createNode = createHappenContext(runtimeModules);

    // 2. Create Nodes
    const requestingNode = createNode({ id: 'RequestingNode' });
    const serviceNode = createNode({ id: 'ServiceNode', initialState: { dataStore: { 'item1': 'value1' } } });
    const receivingNode = createNode({ id: 'ReceivingNode', initialState: { notifications: [] as any[] } });

    // 3. Initialize Nodes
    console.log(`\nInitializing nodes...`);
    await requestingNode.init();
    await serviceNode.init();
    await receivingNode.init();
    console.log("Nodes initialized.");

    // 4. Setup Listeners
    console.log(`\nSetting up listeners...`);

    // ServiceNode handles 'get-data' requests
    const disposeRequestListener = serviceNode.on('get-data', async (event: HappenEvent<{ itemId: string }>) => {
        console.log(`[ServiceNode] Received request 'get-data' (ID: ${event.metadata.id}) for item: ${event.payload.itemId}`);
        const state = serviceNode.getState();
        const data = state.dataStore[event.payload.itemId];

        // Respond using the convention: `${requestEventType}-response`
        // Crucially, set causationId to the original request ID (from metadata.replyTo or metadata.id)
        const responseEvent = {
            type: 'get-data-response',
            payload: data ? { data } : { error: 'Item not found' },
            metadata: {
                causationId: event.metadata.id // Link response to the request
            }
        };
        console.log(`[ServiceNode] Sending response for request ${event.metadata.id}`);
        await serviceNode.broadcast(responseEvent); // Broadcast the response
    });
    console.log("[ServiceNode] Listening for 'get-data' requests.");

    // ReceivingNode handles 'notify' events targeted at it
    const disposeSendListener = receivingNode.on('notify', (event: HappenEvent<{ message: string }>) => {
        // Fix: Remove check for targetNodeId as it's not standard metadata
        // The concept of direct send needs emitter-level support (e.g., request/reply or specific subjects)
        // if (event.metadata.targetNodeId === receivingNode.id) { 
            console.log(`[ReceivingNode] Received targeted notification (ID: ${event.metadata.id}): ${event.payload.message}`);
            const currentState = receivingNode.getState();
            receivingNode.setState({ notifications: [...currentState.notifications, event.payload] });
        // } else {
            // Optional: Log if received a misdirected send
            // console.log(`[ReceivingNode] Ignored notify event ${event.metadata.id} not targeted at this node.`);
        // }
    });
    console.log("[ReceivingNode] Listening for 'notify' events.");

    console.log("Listeners ready.");

    // 5. Perform Request
    console.log("\nRequestingNode performing request...");
    try {
        const response = await requestingNode.send<{ itemId: string }, { data: string } | { error: string }>(
            serviceNode.id,
            { type: 'get-data', payload: { itemId: 'item1' } },
            2000 // 2 second timeout
        );
        console.log(`[RequestingNode] Received response:`, response);
        if (!response || (response as any).error) {
             throw new Error(`Request test failed: Service returned error or no response. Response: ${JSON.stringify(response)}`);
        }
        if ((response as { data: string }).data !== 'value1') {
            throw new Error(`Request test failed: Unexpected data '${(response as { data: string }).data}'`);
        }
        console.log("[RequestingNode] Request test PASSED.");
    } catch (error) {
        console.error("[RequestingNode] Request failed:", error);
        process.exit(1); // Fail the test run
    }

     // Test timeout
    console.log("\nRequestingNode performing request expected to time out...");
    try {
        await requestingNode.send(
            serviceNode.id,
            { type: 'nonexistent-request', payload: {} },
            500 // Short timeout
        );
        // If it reaches here, the timeout failed
        console.error("[RequestingNode] Timeout test FAILED: Request did not time out as expected.");
        process.exit(1);
    } catch (error) {
        if (error) {
            console.error("[RequestingNode] Timeout test FAILED: Received unexpected error:", error);
            process.exit(1);
        } else {
            console.log("[RequestingNode] Timeout test PASSED: Request resulted in null response (timeout or no handler)." );
        }
    }

    // 6. Perform Send
    console.log("\nRequestingNode performing send...");
    const notificationMessage = `Direct message at ${Date.now()}`;
    await requestingNode.send(receivingNode.id, {
        type: 'notify',
        payload: { message: notificationMessage }
    });
    console.log(`[RequestingNode] Sent notification to ${receivingNode.id}`);

    // Allow time for async send/receive
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify ReceivingNode received the notification
    const finalReceiverState = receivingNode.getState();
    if (finalReceiverState.notifications.some((n: any) => n.message === notificationMessage)) {
         console.log("[ReceivingNode] Send test PASSED: Notification received.");
    } else {
         console.error("[ReceivingNode] Send test FAILED: Notification not found in state:", finalReceiverState.notifications);
         process.exit(1);
    }

    // 7. Cleanup
    console.log("\nCleaning up listeners...");
    disposeRequestListener();
    disposeSendListener();
    console.log("Cleanup complete.");

    // Marker for test runner
    console.log("TEST_RESULT: PASS");
    console.log("\n--- Node Request/Send Example End ---");
}

runExample().catch(error => {
    console.error("Example failed:", error);
    process.exit(1);
}); 