import {
  HappenNode,
  createHappenContext,
  NodeOptions
} from '../../src/core/HappenNode';
import { BrowserCrypto } from '../../src/runtime/BrowserCrypto';
import { BrowserEventEmitter } from '../../src/runtime/BrowserEventEmitter';
import { PatternEmitter } from '../../src/core/PatternEmitter';
import type { HappenEvent } from '../../src/core/event';
import type { HappenRuntimeModules } from '../../src/core/runtime-modules';
import { createConsoleObserver } from '../../src/observability/observer';
// Observers/Tracers are less useful in this split-tab example, removing for simplicity
// import { createConsoleObserver } from '../../src/observability/observer';
// import { createEventTracer } from '../../src/observability/tracer';

// --- Basic UI Logging --- //
const logDiv = document.getElementById('log');
function log(message: string) {
    if (logDiv) {
        const time = new Date().toLocaleTimeString();
        logDiv.textContent += `[${time}] ${message}\n`;
        logDiv.scrollTop = logDiv.scrollHeight; // Auto-scroll
    }
    console.log(message); // Also log to console
}

// --- Multi-Tab Application Logic --- //
log('Setting up Happen components (Multi-Tab Test)...');

let nodeA: HappenNode<{ pingsSent: number }> | null = null;
let nodeB: HappenNode<{ pongsReceived: number }> | null = null;
let disposeA: (() => void) | null = null;
let disposeB: (() => void) | null = null;
let thisTabIs: 'A' | 'B' | 'Unknown' = 'Unknown';

try {
    // 1. Shared Runtime Modules
    const crypto = new BrowserCrypto();
    const channelName = 'happen-demo-channel-multi'; // Use a distinct channel name
    const baseEmitter = new BrowserEventEmitter(channelName);
    const happenEmitter = new PatternEmitter(baseEmitter); // Shared emitter
    log(`Using BroadcastChannel: ${channelName}`);

    // --- Button Event Handlers --- //

    document.getElementById('btnInitA')?.addEventListener('click', async () => {
        if (thisTabIs !== 'Unknown') {
            log(`This tab is already initialized as Node ${thisTabIs}. Refresh to change.`);
            return;
        }
        thisTabIs = 'A';
        document.body.classList.add('isNodeA');
        log('Initializing this tab as Node A...');
        const runtimeModules: HappenRuntimeModules = { crypto, emitterInstance: happenEmitter };
        const createNode = createHappenContext(runtimeModules);
        nodeA = createNode({ id: 'NodeA', initialState: { pingsSent: 0 } });
        await nodeA.init();
        log('Node A Initialized.');
        // Node A listens for 'pong'
        disposeA = nodeA.on('pong', (event: HappenEvent<any>) => {
            log(`[NodeA] Received '${event.type}' from ${event.metadata.sender}.`);
        });
        log('Node A listening for pong.');
    });

    document.getElementById('btnInitB')?.addEventListener('click', async () => {
        if (thisTabIs !== 'Unknown') {
            log(`This tab is already initialized as Node ${thisTabIs}. Refresh to change.`);
            return;
        }
        thisTabIs = 'B';
        document.body.classList.add('isNodeB');
        log('Initializing this tab as Node B...');
        const runtimeModules: HappenRuntimeModules = { crypto, emitterInstance: happenEmitter };
        const createNode = createHappenContext(runtimeModules);
        nodeB = createNode({ id: 'NodeB', initialState: { pongsReceived: 0 } });
        await nodeB.init(); // Initialize first
        log('Node B Initialized.');
        // Node B listens for 'ping'
        disposeB = nodeB.on('ping', (event: HappenEvent<any>) => {
            log(`[NodeB] Received '${event.type}' from ${event.metadata.sender}. Updating state.`);
            const state = nodeB?.getState();
            if (state && nodeB) {
                nodeB.setState({ pongsReceived: state.pongsReceived + 1 });
                log(`[NodeB] New state: ${JSON.stringify(nodeB.getState())}`);
                log('TEST_RESULT: PASS'); // Log PASS when ping is received via channel
            }
        });
        log('Node B listening for ping.');
    });

    document.getElementById('btnEmitA')?.addEventListener('click', async () => {
        if (thisTabIs !== 'A' || !nodeA) {
            log('Initialize this tab as Node A first to emit ping.');
            return;
        }
        log('[NodeA] Emitting ping via BroadcastChannel...');
        const state = nodeA.getState();
        await nodeA.emit({ type: 'ping', payload: { count: state.pingsSent + 1 } });
        nodeA.setState({ pingsSent: state.pingsSent + 1 });
        log(`[NodeA] Ping emitted. New state: ${JSON.stringify(nodeA.getState())}`);
        log('---> Check the Node B tab console for receipt and TEST_RESULT <--- ');
    });

     document.getElementById('btnEmitB')?.addEventListener('click', async () => {
         if (thisTabIs !== 'B' || !nodeB) {
             log('Initialize this tab as Node B first to emit pong.');
            return;
        }
        log('[NodeB] Emitting pong via BroadcastChannel...');
        await nodeB.emit({ type: 'pong', payload: {} });
        log(`[NodeB] Pong emitted.`);
    });

    // Add helper back for simplicity, though ideally it's part of the class
    (HappenNode.prototype as any).isInitialized = function() {
        return !!(this as any).publicKey;
    };

    log('UI Ready. Select Node A or Node B to initialize this tab.');

} catch (error) {
    log(`Error setting up Happen: ${error}`);
    console.error(error);
}

// Optional cleanup
window.addEventListener('beforeunload', () => {
    disposeA?.();
    disposeB?.();
    log('Listeners disposed on page unload.');
});
