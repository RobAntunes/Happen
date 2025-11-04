/**
 * Quick Start Example from Happen Documentation
 *
 * This example demonstrates:
 * - Creating nodes
 * - Broadcasting events
 * - Handling events with pattern matching
 *
 * To run this example:
 * 1. Start NATS: docker run --rm -p 4222:4222 -p 8222:8222 nats:latest -js
 * 2. Build the project: npm run build
 * 3. Run this file: node examples/quickstart.js
 */

import { initializeHappen } from '../dist/index.js';

// Initialize the framework. It will connect to NATS on localhost by default.
const { createNode } = await initializeHappen();

// --- Create Our First Node: The Logger ---
// Nodes are independent, autonomous components.
const loggerNode = createNode('logger-service');

// This node listens for any 'greeting-was-sent' event.
loggerNode.on('greeting-was-sent', (event) => {
  console.log(`[Logger Service] Received a greeting: "${event.payload.message}"`);
});

// --- Create Our Second Node: The Greeter ---
const greeterNode = createNode('greeter-service');

// After a 1-second delay, this node will broadcast an event to the entire system.
setTimeout(() => {
  console.log('[Greeter Service] Broadcasting a greeting...');

  // Events are structured messages that transport data.
  greeterNode.broadcast({
    type: 'greeting-was-sent',
    payload: { message: 'Hello from the other side!' }
  });
}, 1000);

console.log('Application started. Nodes are running and listening for events...');

// Keep the process running for a bit to see the output
setTimeout(() => {
  process.exit(0);
}, 3000);
