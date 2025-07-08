# 🌊 Happen - Simply Productive

> Universal event-driven communication framework that makes complex distributed systems suddenly manageable.

[![npm version](https://img.shields.io/npm/v/@happen/core.svg)](https://www.npmjs.com/package/@happen/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Coverage Status](https://img.shields.io/codecov/c/github/yourusername/happen.svg)](https://codecov.io/gh/yourusername/happen)

## 🎯 What is Happen?

Happen is a revolutionary event-driven framework that reduces distributed system complexity to just two primitives: **Nodes** and **Events**. It provides a unified communication layer that works seamlessly across servers, browsers, and edge environments.

### Why Happen?

- **Radical Simplicity**: Just nodes and events - that's it
- **Universal Communication**: Same code works everywhere - server, browser, edge
- **Zero Configuration**: Automatic discovery and routing via NATS
- **Production Ready**: Built-in resilience, monitoring, and debugging tools
- **Blazing Fast**: Sub-millisecond local communication, efficient network transport

## 🚀 Quick Start

Get up and running in under 5 minutes:

```bash
npm install @happen/core
```

```typescript
import { happen } from '@happen/core';

// Create a node
const orderNode = happen.node('order-service');

// Handle events with pattern matching
orderNode.on('order.created', async (event) => {
  console.log('New order:', event.payload);
  
  // Process the order
  const result = await processOrder(event.payload);
  
  // Continue the flow by returning a handler
  return handlePayment;
});

// Send events
orderNode.send(paymentNode, {
  type: 'payment.process',
  payload: { orderId: '123', amount: 99.99 }
});

// Start the node
await orderNode.start();
```

## 🎨 Core Concepts

### Nodes
Self-contained units of computation that process events:

```typescript
const node = happen.node('my-service', {
  // Optional configuration
  state: { count: 0 },
  accept: (origin) => origin.nodeId !== 'blocked-node'
});
```

### Events
Immutable messages that flow between nodes:

```typescript
{
  id: 'evt-123',          // Auto-generated unique ID
  type: 'user.created',   // Event type for pattern matching
  payload: { ... },       // Your data
  context: {              // Automatic context
    causality: 'evt-122', // Tracks event chains
    origin: { ... },      // Source information
    timestamp: ...        // Automatic timestamp
  }
}
```

### Pattern Matching
Flexible event routing with zero overhead:

```typescript
// String pattern
node.on('order.created', handler);

// Function pattern
node.on(type => type.startsWith('order.'), handler);

// Multiple patterns
node.on(type => ['payment.success', 'payment.failed'].includes(type), handler);
```

### Event Continuum
Functional flow control through handler chaining:

```typescript
node.on('order.created', (event) => {
  if (!validateOrder(event.payload)) {
    return handleInvalidOrder;  // Branch to error flow
  }
  
  updateInventory(event.payload);
  return processPayment;  // Continue to next step
});
```

## 🌍 Cross-Environment Magic

Write once, run anywhere:

```typescript
// Same code works in Node.js, Browser, Deno, Bun, etc.
const node = happen.node('my-service');

// Happen automatically handles:
// - NATS TCP connection in Node.js
// - WebSocket connection in browsers
// - Optimal transport for your environment
```

## 📊 State Management

Built-in functional state management:

```typescript
// Local state
const state = node.state.get();
const users = node.state.get(s => s.users);

// State updates
node.state.set(state => ({
  ...state,
  count: state.count + 1
}));

// Cross-node state access (via Views)
orderNode.state.set((state, views) => {
  const customer = views.customer.get(s => s.customers[id]);
  return { ...state, customerName: customer.name };
});
```

## 🛡️ Production Ready

### Built-in Resilience
- Automatic reconnection
- Message persistence during network issues
- At-least-once delivery guarantees
- Circuit breakers and timeouts

### Observable by Design
- Distributed tracing support
- Metrics collection
- Event flow visualization
- Performance profiling

### Developer Experience
- TypeScript-first with perfect type inference
- Comprehensive error messages
- Interactive debugging tools
- Extensive documentation

## 📚 Documentation

- [Getting Started Guide](docs/getting-started.md)
- [API Reference](docs/api-reference.md)
- [Architecture Overview](docs/architecture.md)
- [Examples](examples/)
- [Migration Guide](docs/migration.md)

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

## 📄 License

MIT © Happen Contributors

---

Built with ❤️ by the Happen community. Make distributed systems simple again!