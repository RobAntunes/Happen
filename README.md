# Happen Framework ⚡︎

**Explore the full documentation:** [**insert-name-here.gitbook.io/happen**](https://insert-name-here.gitbook.io/happen)

---

**Welcome to Happen, where we believe in the power of radical simplicity!**

Instead of drowning you in abstractions and boilerplate, Happen gives you just two fundamental building blocks—**Nodes** and **Events**—that combine to create systems of surprising power and flexibility. Whether you're building a straightforward automation pipeline, a secure multi-agent system, or exploring complex distributed state management, you'll find that Happen's minimalist approach makes intricate problems suddenly manageable.

This framework proves that the most elegant solutions emerge not from adding complexity, but from discovering the right minimal abstractions that let the magic happen naturally.

## Core Principles

*   **Radical Simplicity:** Built on just Nodes and Events. Tiny footprint, zero runtime dependencies.
*   **Secure by Default:** Events are cryptographically signed (Ed25519) and verified, ensuring integrity and authenticity from the start.
*   **Runtime Agnostic:** Pluggable modules (`ICrypto`, `IEventEmitter`) allow seamless adaptation to any JavaScript environment (Node.js, Deno, Bun, Browsers).

## Key Features (Explore the Docs for More!)

*   **Autonomous Nodes (`HappenNode`):** Independent actors managing their own state, identity (via key pairs), and event interactions.
*   **Flexible Event Bus (`PatternEmitter`):** Wraps any standard event emitter to provide powerful pattern matching (`*`, `{alt1,alt2}`) for event subscriptions, going beyond simple type matching.
*   **Built-in Cryptography:** Automatic Ed25519 signing and verification of events using injected crypto modules.
*   **Observability Hooks:** Built-in support for `EventObserver` and `EventTracer` allows deep insights into event flow and system behavior, crucial for debugging and testing complex interactions.
*   **Cross-Environment Ready:** Designed and tested to work consistently across Node.js, Deno, Bun, and even cross-tab in modern web browsers.
*   **Lifecycle Hooks:** (See Docs) Tap into events at critical points for custom logic.
*   **Advanced Patterns:** (See Docs) Discover patterns for networking, state management, error handling, and more.

## Prerequisites

To build and run the included examples and tests, you will need one of the following:

*   **Node.js:** Includes `npm` (used for running scripts defined in `package.json`).
*   **Deno:** Required for the Deno example test.
*   **Bun:** Required for the Bun example test.

## Getting Started (Local Dev)

Installation involves cloning the repository:

```bash
git clone <repository-url>
cd happen
```

## Building the Project

The project uses TypeScript and needs to be compiled to JavaScript.

```bash
npm run build
```

This command performs the following steps:

1.  **`tsc`**: Compiles TypeScript files from `src/` and `examples/` into JavaScript ES Modules in the `dist/` directory.
2.  **`node ./postbuild.cjs`**: Adds `.js` extensions to relative import paths within `dist/` for Node.js ESM compatibility.
3.  **`mkdir -p ... && cp ...`**: Copies the browser example's `index.html` into `dist/`.

## Running Tests

The test suite validates the framework's functionality across different JavaScript runtimes by **testing the compiled output** in the `dist/` directory.

```bash
npm run test
```

This command executes the `run-tests.sh` script:

1.  Builds the project using `npm run build`.
2.  Runs examples against the compiled `dist/` output using `node`, `deno run`, and `bun run`.
3.  Provides instructions for the **manual browser test**, which verifies cross-tab communication via `BroadcastChannel`:
    *   Serve the project root (e.g., `npx serve .`).
    *   Open `http://localhost:3000/dist/examples/browser-basic/index.html` (adjust port) in **two separate tabs**.
    *   Follow UI instructions (Init A in Tab 1, Init B in Tab 2, Emit Ping from Tab 1).
    *   Check the **Tab 2 console** for `TEST_RESULT: PASS`.

## Runtime Module Injection & Node Creation

Happen uses dependency injection for its core runtime components:

1.  **`ICrypto`**: Handles cryptographic operations (key generation, signing, verification). Implementations exist for Node.js/Bun (`NodeJsCrypto`), Deno (`DenoCrypto`), and Browsers (`BrowserCrypto`).
2.  **`IHappenEmitter`**: Provides the underlying event emission and subscription mechanism. Implementations often wrap standard emitters like Node.js `EventEmitter` (`NodeJsEventEmitter`), browser `BroadcastChannel` (`BrowserEventEmitter`), or Deno's `EventEmitter`. The `PatternEmitter` wraps a base `IHappenEmitter` to add wildcard/pattern matching capabilities.

To simplify node creation and ensure consistent module usage, use the `createHappenContext` factory:

```typescript
import { createHappenContext } from './src/core/HappenNode';
import { NodeJsCrypto } from './src/runtime/NodeJsCrypto';
import { NodeJsEventEmitter } from './src/runtime/NodeJsEventEmitter';
import { PatternEmitter } from './src/core/PatternEmitter';
import type { HappenRuntimeModules } from './src/core/runtime-modules';

// 1. Define the runtime modules
const crypto = new NodeJsCrypto();
const baseEmitter = new NodeJsEventEmitter();
const happenEmitter = new PatternEmitter(baseEmitter);
const runtimeModules: HappenRuntimeModules = { crypto, emitterInstance: happenEmitter };

// 2. Create the context factory
const createNode = createHappenContext(runtimeModules);

// 3. Use the factory to create nodes
const nodeA = createNode({ id: 'NodeA', initialState: { status: 'idle' } });
const nodeB = createNode({ id: 'NodeB', initialState: { counter: 0 } });
```

This pattern ensures all nodes created via `createNode` share the same crypto implementation and emitter instance, simplifying setup and promoting consistency.

## Basic Usage Example

```typescript
// Simplified example - see /examples for more details
import { createHappenContext, HappenNode } from './src/core/HappenNode';
import { NodeJsCrypto } from './src/runtime/NodeJsCrypto';
import { NodeJsEventEmitter } from './src/runtime/NodeJsEventEmitter';
import { PatternEmitter } from './src/core/PatternEmitter';
import type { HappenEvent } from './src/core/event';
import type { HappenRuntimeModules } from './src/core/runtime-modules';

async function main() {
    // 1. Setup Runtime Modules & Context
    const crypto = new NodeJsCrypto();
    const baseEmitter = new NodeJsEventEmitter();
    const happenEmitter = new PatternEmitter(baseEmitter);
    const runtimeModules: HappenRuntimeModules = { crypto, emitterInstance: happenEmitter };
    const createNode = createHappenContext(runtimeModules);

    // 2. Create & Initialize Nodes using the factory
    const nodeA = createNode({ id: 'NodeA', initialState: {} });
    const nodeB = createNode({ id: 'NodeB', initialState: { counter: 0 } });
    // Nodes need initialization for cryptographic keys
    await Promise.all([nodeA.init(), nodeB.init()]);

    // 3. Subscribe to Events
    nodeB.on('increment', (event: HappenEvent) => {
        console.log(`[NodeB] Received '${event.type}' from ${event.metadata.sender}`);
        // Ensure state update is safe
        const currentState = nodeB.getState();
        if (typeof currentState.counter === 'number') {
             nodeB.setState({ counter: currentState.counter + 1 });
        }
    });

    // 4. Emit an Event
    console.log('[NodeA] Emitting increment...');
    await nodeA.emit({ type: 'increment', payload: {} }); // Payload is optional

    // Wait briefly for event processing
    await new Promise(resolve => setTimeout(resolve, 50));
    console.log(`[NodeB] Final counter: ${nodeB.getState().counter}`); // Output: 1

    // Clean up listeners if needed (e.g., in long-running apps)
    // nodeB.destroy(); // Destroys the node and its listeners
}

main().catch(console.error);
```

## Dive Deeper

Explore the [**Full Documentation**](https://insert-name-here.gitbook.io/happen) to learn about:

*   Event Lifecycle Hooks
*   Advanced Communication Patterns
*   Identity Management
*   Networking Strategies
*   Distributed State Management Approaches
*   Error Handling Techniques
*   Integrating Third-Party Modules
*   And much more!

## License

MIT License
