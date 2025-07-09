# ⚡️ Happen

> Universal event-driven communication framework that makes complex distributed systems suddenly manageable.

[![npm version](https://img.shields.io/npm/v/@happen/core.svg)](https://www.npmjs.com/package/@happen/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Coverage Status](https://img.shields.io/codecov/c/github/yourusername/happen.svg)](https://codecov.io/gh/RobAntunes/Happen)

## What is Happen?

Happen is an event-driven framework that reduces distributed system complexity to just two primitives: **Nodes** and **Events**. It provides a unified communication layer that works seamlessly across servers, browsers, and edge environments.

### Why Happen?

The Problem: Systems can't talk to each other. APIs are brittle, protocols are complex, and integration is painful.
The Solution: Universal event-driven communication that works across any language, any protocol, any environment.


- **Simplicity**: Just nodes and events - that's it
- **Universal Communication**: Same code works everywhere - server, browser, edge
- **Zero Configuration**: Automatic discovery and routing via NATS
- **Production Ready**: Built-in resilience, monitoring, and debugging tools
- **Blazing Fast**: Sub-millisecond local communication, efficient network transport


## Core Features

### Event Continuum - Programmable Flow Control
```typescript
orderNode.on("process-order", function validateOrder(event, context) {
  const validation = validateOrderData(event.payload);
  
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }
  
  // Return next function to execute - pure functional flow
  return processPayment;
});

function processPayment(event, context) {
  // Process payment...
  return createShipment; // Continue the flow
}
```

### Cross-Environment Magic
```typescript
// This exact code works whether nodes are:
// • Same process • Different machines • Browser ↔ Server • IoT devices

serverNode.send(browserNode, { type: 'update-ui', payload: data });
iotSensor.send(cloudService, { type: 'sensor-reading', payload: reading });
```

### Intelligent State Management
```typescript
// Local state with functional transformations
orderNode.state.set(state => ({
  ...state,
  orders: { ...state.orders, [id]: newOrder }
}));

// Cross-node state access through views
orderNode.state.set((state, views) => {
  const customer = views.customer.get(s => s.customers[customerId]);
  const inventory = views.inventory.get(s => s.products[productId]);
  
  return createOrderWithContext(state, customer, inventory);
});
```

### Temporal State - Time Travel for Data
```typescript
// Access historical state
const orderState = orderNode.state.when('evt-123', (snapshot) => {
  console.log('Order was:', snapshot.state.orders['order-456']);
  return snapshot.state;
});
```

## Real-World Examples

### AI Agent Coordination
```typescript
const reasoningAgent = createNode('reasoning');
const memoryAgent = createNode('memory');
const actionAgent = createNode('actions');

// Agents collaborate naturally
reasoningAgent.on('analyze-situation', async (event) => {
  const memory = await reasoningAgent.send(memoryAgent, {
    type: 'recall-context',
    payload: event.payload
  }).return();
  
  const plan = createPlan(event.payload, memory);
  
  actionAgent.broadcast({
    type: 'execute-plan', 
    payload: plan
  });
});
```

### Legacy System Integration
``` typescript
// Wrap existing REST API
const legacyAPI = createNode('legacy-billing');

legacyAPI.on('process-payment', async (event) => {
  // Call existing system
  const result = await fetch('/legacy/billing', {
    method: 'POST',
    body: JSON.stringify(event.payload)
  });
  
  return await result.json();
});

// Now legacy system is part of the event fabric
modernService.send(legacyAPI, {
  type: 'process-payment',
  payload: paymentData
});
```

## 📚 Documentation
- [Full Docs](https://insert-name-here.gitbook.io/happen-simply-productive/)
### TODO:
- [Getting Started Guide](docs/getting-started.md)
- [API Reference](docs/api-reference.md)
- [Architecture Overview](docs/architecture.md)
- [Examples](examples/)

# Installation

## Current Development Phase

Happen is currently in active development and not yet published to NPM. To get started, you'll need to clone the repository directly from GitHub.

## Getting Started

Clone the Happen repository and set up your development environment:

```bash
# Clone the Happen repository
git clone https://github.com/RobAntunes/Happen.git happen

# Navigate to the project directory
cd happen

# Install dependencies
npm install

# Build the project
npm run build

# Run tests to verify installation
npm test
```

## Quick Setup Example

Once you've cloned and built Happen, you can start using it immediately:

```javascript
// Import Happen after cloning and building
import { initializeHappen } from './happen/dist/index.js';

// Initialize with default configuration
const { createNode } = initializeHappen();

// Create your first node
const myNode = createNode('my-first-node');

// Set up a simple event handler
myNode.on('hello', (event) => {
  console.log('Received:', event.payload);
  return { success: true };
});

// Send an event
myNode.broadcast({
  type: 'hello',
  payload: { message: 'Hello, Happen!' }
});
```

## Coming Soon

Happen will be available via NPM once we reach our first stable release. Stay tuned for:

```bash
# Future NPM installation (coming soon)
npm install happen
```

**Note**: Make sure you have Node.js 18+ installed for optimal compatibility.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

```bash
# Clone the repo
git clone https://github.com/yourusername/happen.git

# Install dependencies
npm install

# Run tests
npm test

# Build the project
npm run build
```

## 🚀 Performance

Happen is designed for high-performance event processing:

| Operation | Performance |
|-----------|-------------|
| Event Processing | 165,000+ events/sec |
| State Updates | 1,250,000+ updates/sec |
| Pattern Matching | 164,000+ events/sec (100 patterns) |
| Request-Response | 166,000+ req/sec |
| Zero-Allocation | 183,000+ events/sec |

*Benchmarked on Node.js 22.16.0*

## 📄 License

MIT © Happen Contributors

---

Built with ❤️ for developers who believe in simplicity
