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

To build and run the included examples and tests, you will need:

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

## Basic Usage Example

```typescript
// Simplified example - see /examples for more details
import { HappenNode } from '../src/core/HappenNode';
import { NodeJsCrypto } from '../src/runtime/NodeJsCrypto';
import { NodeJsEventEmitter } from '../src/runtime/NodeJsEventEmitter';
import { PatternEmitter } from '../src/core/PatternEmitter';
import type { HappenEvent } from '../src/core/event';

async function main() {
    // 1. Inject Runtime Modules
    const crypto = new NodeJsCrypto();
    const happenEmitter = new PatternEmitter(new NodeJsEventEmitter());

    // 2. Create & Initialize Nodes
    const nodeA = new HappenNode('NodeA', {}, crypto, happenEmitter);
    const nodeB = new HappenNode('NodeB', { counter: 0 }, crypto, happenEmitter);
    await Promise.all([nodeA.init(), nodeB.init()]);

    // 3. Subscribe to Events
    nodeB.on('increment', (event: HappenEvent) => {
        console.log(`[NodeB] Received '${event.type}'`);
        nodeB.setState({ counter: nodeB.getState().counter + 1 });
    });

    // 4. Emit an Event
    console.log('[NodeA] Emitting increment...');
    await nodeA.emit({ type: 'increment' });

    await new Promise(resolve => setTimeout(resolve, 50)); // Allow processing
    console.log(`[NodeB] Final counter: ${nodeB.getState().counter}`); // Output: 1
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

(Specify License - e.g., MIT, Apache 2.0, or TBD)
