# Happen Framework

A Proof-of-Concept framework demonstrating event-driven communication between decoupled nodes with cryptographic integrity.

This framework emphasizes:

* **Minimalism:** No dependencies beyond the runtime itself.
* **Runtime Flexibility:** Uses dependency injection for core runtime components (Crypto, Event Emitter), allowing adaptation to different environments (Node.js, Deno, Bun, Browser).
* **Event Integrity:** Events are signed (using Ed25519) by the emitting node and verified by receiving nodes.
* **Pattern Matching:** Supports pattern-based event subscriptions beyond exact type matches.
* **Observability:** Includes hooks for observing and tracing event flow.

## Features

* **Decoupled Nodes:** `HappenNode` represents independent actors.
* **Event Emitter Abstraction:** Uses `IHappenEmitter` interface with `PatternEmitter` wrapper.
* **Pluggable Runtimes:** Separate implementations for Crypto (`NodeJsCrypto`, `DenoCrypto`, `BrowserCrypto`) and Event Emitters (`NodeJsEventEmitter`, `DenoEventEmitter`, `BrowserEventEmitter`, `BunEventEmitter`).
* **Cryptographic Signatures:** Ensures event authenticity and integrity using Ed25519 keys.
* **Pattern Subscriptions:** Listen for events using wildcards (`*`) and alternatives (`{type1,type2}`).
* **Observability:** Includes `createConsoleObserver` and `createEventTracer` for debugging and monitoring.
* **Cross-Environment Goal:** Aims to work consistently across Node.js, Deno, Bun, and modern web browsers.

## Prerequisites

To build and run the tests, you will need:

* **Node.js:** Includes `npm` (used for running scripts defined in `package.json`).
* **Deno:** Required for the Deno example test.
* **Bun:** Required for the Bun example test.

## Installation

As the framework currently has no external runtime dependencies, installation primarily involves cloning the repository:

```bash
git clone <repository-url>
cd happen
```

(Note: `npm install` is only needed if development dependencies are added in the future.)

## Building the Project

The project uses TypeScript and needs to be compiled to JavaScript.

```bash
npm run build
```

This command performs the following steps:

1. **`tsc`**: Compiles TypeScript files from `src/` and `examples/` into JavaScript ES Modules in the `dist/` directory.
2. **`node ./postbuild.cjs`**: Runs a script to automatically add `.js` extensions to relative import paths within the compiled files in `dist/`. This is necessary for Node.js ESM compatibility.
3. **`mkdir -p ... && cp ...`**: Copies the browser example's `index.html` file into the corresponding `dist` directory so it can be served alongside its JavaScript.

## Running Tests

The test suite validates the framework's functionality across different JavaScript runtimes.

```bash
npm run test
```

This command executes the `run-tests.sh` script, which follows this philosophy:

1. **Build First:** It ensures the project is built using `npm run build`.
2. **Test Compiled Output:** All tests are run against the compiled JavaScript files located in the `dist/` directory. This verifies that the final build artifacts work as expected.
3. **Cross-Runtime Checks:** It runs specific examples using `node`, `deno run`, and `bun run` to confirm compatibility.
4. **Browser Test (Manual):** The script includes instructions for manually testing the browser example:
    * Serve the project's root directory (e.g., `npx serve .`).
    * Open `http://localhost:3000/dist/examples/browser-basic/index.html` (adjust port if needed) in **two separate browser tabs**.
    * Follow the UI instructions in the tabs (Initialize Node A in one, Node B in the other, then Emit Ping from Node A).
    * Check the console log in the **Node B tab** for `TEST_RESULT: PASS`.

## Basic Usage

Here's a simplified example demonstrating two nodes communicating:

```typescript
import { HappenNode } from '../src/core/HappenNode';
import { NodeJsCrypto } from '../src/runtime/NodeJsCrypto'; // Or Deno/Browser specific
import { NodeJsEventEmitter } from '../src/runtime/NodeJsEventEmitter'; // Or Deno/Browser specific
import { PatternEmitter } from '../src/core/PatternEmitter';
import type { HappenEvent } from '../src/core/event';

async function main() {
    // 1. Setup Runtime Modules
    const crypto = new NodeJsCrypto();
    const baseEmitter = new NodeJsEventEmitter(); // Use a runtime-specific emitter
    const happenEmitter = new PatternEmitter(baseEmitter);

    // 2. Create Nodes
    const nodeA = new HappenNode('NodeA', { status: 'ready' }, crypto, happenEmitter);
    const nodeB = new HappenNode('NodeB', { value: 0 }, crypto, happenEmitter);

    // 3. Initialize Nodes (generates keys)
    await nodeA.init();
    await nodeB.init();

    // 4. Node B listens for 'update-value' events
    const disposeB = nodeB.on('update-value', (event: HappenEvent<{ amount: number }>) => {
        console.log(`[NodeB] Received '${event.type}' from ${event.metadata.sender}`);
        const currentState = nodeB.getState();
        nodeB.setState({ value: currentState.value + event.payload.amount });
        console.log(`[NodeB] New state: ${JSON.stringify(nodeB.getState())}`);
    });

    // 5. Node A emits an event
    console.log('[NodeA] Emitting update-value...');
    await nodeA.emit({
        type: 'update-value',
        payload: { amount: 10 }
    });

    // Allow time for event processing
    await new Promise(resolve => setTimeout(resolve, 50));

    console.log(`[NodeB] Final state: ${JSON.stringify(nodeB.getState())}`);

    // Cleanup
    disposeB();
}

main().catch(console.error);
```

## Core Concepts

* **`HappenNode<S>`:** Represents a network participant. Manages its own ID, state (`S`), cryptographic keys (Ed25519), and listener registrations. Handles event signing and verification.
* **`IHappenEmitter`:** An interface defining the core event emission methods (`on`, `off`, `emit`, `addObserver`).
* **`PatternEmitter`:** An implementation of `IHappenEmitter` that wraps a simpler, runtime-specific `IEventEmitter`. It adds support for pattern matching (`*`, `{}`) in event subscriptions and allows attaching passive `EventObserver` functions.
* **Runtime Modules (`ICrypto`, `IEventEmitter`):** Interfaces defining necessary runtime capabilities. Concrete implementations (`NodeJsCrypto`, `BrowserEventEmitter`, etc.) are injected into `HappenNode` (or often, into `PatternEmitter` first) to adapt the framework to the target environment.
* **`HappenEvent<T>`:** The structure of events passed through the system, containing `type`, `payload`, and `metadata` (including `id`, `sender`, `timestamp`, `signature`, `publicKey`, `correlationId`, `causationId`).

## Examples

The `/examples` directory contains usage demonstrations for different runtimes and scenarios:

* `node-basic.ts`: Simple two-node communication using Node.js `EventEmitter`.
* `node-chained-events.ts`: Demonstrates correlation and causation IDs for tracing multi-step processes in Node.js.
* `deno-basic.ts`: Simple two-node communication using Deno's `node:events` compatibility.
* `bun-basic.ts`: Simple two-node communication using Bun's native `EventEmitter`.
* `browser-basic/`: Demonstrates cross-tab communication using `BroadcastChannel` via `BrowserEventEmitter`.

## License

(Specify License - e.g., MIT, Apache 2.0, or TBD)
