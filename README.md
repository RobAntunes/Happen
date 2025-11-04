# Happen

A minimalist framework for building distributed and agent-based systems founded on pure causality.

## Philosophy

Happen is built on **radical simplicity**. Instead of complex abstractions, Happen provides just two fundamental building blocks:

- **Nodes** - Independent, autonomous components that process events
- **Events** - Structured messages that flow between nodes

These primitives combine to create systems of surprising power and flexibility.

## Key Principles

- **Radical Minimalism** - Only include what's absolutely essential
- **Pure Causality** - Every event exists because of something else, creating natural causal chains
- **Decentralized Intelligence** - Smart systems emerge from simple nodes making local decisions
- **Runtime Transparency** - Direct access to runtime capabilities without framework abstractions
- **Composable Simplicity** - Complex behavior emerges from simple, understandable parts

## Quick Start

### Prerequisites

- Node.js 18+
- Docker (for running NATS)

### Installation

```bash
# Clone the repository
git clone <repository-url> happen
cd happen

# Install dependencies
npm install

# Build the project
npm run build
```

### Start NATS Server

Happen uses NATS as its messaging backbone:

```bash
docker run --rm -p 4222:4222 -p 8222:8222 nats:latest -js
```

### Your First Application

```javascript
import { initializeHappen } from './dist/index.js';

// Initialize the framework
const { createNode } = await initializeHappen();

// Create a logger node
const loggerNode = createNode('logger-service');

loggerNode.on('greeting-was-sent', (event) => {
  console.log(`Received greeting: "${event.payload.message}"`);
});

// Create a greeter node
const greeterNode = createNode('greeter-service');

setTimeout(() => {
  greeterNode.broadcast({
    type: 'greeting-was-sent',
    payload: { message: 'Hello from the other side!' }
  });
}, 1000);
```

Run it:

```bash
node examples/quickstart.js
```

## Core Concepts

### Nodes

Nodes are the primary actors in a Happen system. They can:
- Receive and process events
- Maintain internal state
- Transform state
- Emit new events

Create a node:

```javascript
const orderNode = createNode('order-processor', {
  persistent: true  // Enable state persistence
});
```

### Events

Events are structured messages with three parts:
- **Type** - A string identifier (e.g., 'order.created')
- **Payload** - Domain-specific data
- **Context** - Causal metadata (automatically managed)

Every event includes complete causal context:
- `id` - Unique event identifier
- `sender` - Node that created the event
- `causationId` - Event that caused this one
- `correlationId` - Transaction/process ID
- `path` - Journey through the system
- `timestamp` - When the event was created

### The Event Continuum

Happen uses a pure functional flow model. Event handlers return either:
- **Another function** to continue the flow
- **A value** to complete the flow

```javascript
orderNode.on('create-order', validateOrder);

function validateOrder(event, context) {
  if (!isValid(event.payload)) {
    return { success: false, reason: 'Invalid order' };
  }

  // Store data in context for next function
  context.validatedOrder = event.payload;

  // Return next function
  return processPayment;
}

function processPayment(event, context) {
  const payment = processTransaction(context.validatedOrder);

  if (!payment.success) {
    return { success: false, reason: 'Payment failed' };
  }

  return createShipment;
}

function createShipment(event, context) {
  const shipment = generateShipment(event.payload);

  // Return final result
  return {
    success: true,
    trackingNumber: shipment.trackingNumber
  };
}
```

### Pattern Matching

Match events using strings or functions:

```javascript
// Exact match
node.on('order.submitted', handler);

// Wildcard
node.on('order.*', handler);

// Alternatives
node.on('{order,payment}.created', handler);

// Custom function
node.on(type => type.startsWith('user.') && type.includes('verified'), handler);
```

Helper utilities:

```javascript
import { domain, exact, wildcard, oneOf, not } from './dist/index.js';

node.on(domain('order'), handler);
node.on(exact('payment.succeeded'), handler);
node.on(wildcard('user.*.completed'), handler);
node.on(oneOf('order.created', 'order.updated'), handler);
node.on(not(exact('internal.debug')), handler);
```

### State Management

Nodes can maintain persistent state:

```javascript
const orderNode = createNode('orders', { persistent: true });

// Set state
await orderNode.state.set((state) => ({
  ...state,
  orders: {
    ...state.orders,
    [orderId]: { id: orderId, status: 'pending' }
  }
}));

// Get state
const orders = await orderNode.state.get();

// Transform state while getting
const orderIds = await orderNode.state.get(state =>
  Object.keys(state.orders)
);
```

### Broadcasting and Messaging

```javascript
// Broadcast to all nodes
await node.broadcast({
  type: 'order.created',
  payload: { orderId: 'ORD-123', total: 99.99 }
});

// Send to specific node
await node.send('payment-processor', {
  type: 'process-payment',
  payload: { orderId: 'ORD-123', amount: 99.99 }
});
```

## Testing

Run all tests:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

**Note:** Integration tests require a running NATS server. Start NATS with:

```bash
docker run --rm -p 4222:4222 -p 8222:8222 nats:latest -js
```

## Development

```bash
# Build TypeScript
npm run build

# Watch mode
npm run dev
```

## Architecture

Happen leverages NATS as its underlying messaging fabric to provide:
- **Distributed Messaging** - High-performance communication between nodes
- **Persistence** - Durable storage through JetStream
- **Exactly-Once Processing** - Guaranteed message delivery
- **Cross-Environment Operation** - Works across server, browser, and edge

## Confluence - Multi-Node and Batch Processing

Confluence handles multiple events and nodes with minimal API surface:

```javascript
import { createNodeArray } from './dist/index.js';

// Fan-out: Send to multiple nodes
const nodes = createNodeArray([node1, node2, node3]);

// Register handler on all nodes (each gets context.node)
nodes.on('update', (event, context) => {
  console.log(`Processing in ${context.node.id}`);
  return { updated: true };
});

// Send and collect results
const result = await nodes.send({
  type: 'update',
  payload: { data: 'new' }
});
const responses = await result.return();

// Fan-in: Batch processing
node.on('data-point', (eventOrEvents, context) => {
  if (Array.isArray(eventOrEvents)) {
    // Process batch
    return { batch: true, count: eventOrEvents.length };
  }
  // Process single
  return { batch: false };
});

// Send batch
await node.process([event1, event2, event3]);
```

See [CONFLUENCE.md](./CONFLUENCE.md) for complete documentation.

## Examples

See the `examples/` directory for more examples:
- `quickstart.js` - Basic two-node system
- `confluence-example.js` - Fan-in, fan-out, and batch processing

## License

MIT

## Contributing

Contributions welcome! Please ensure:
- All tests pass
- New features include tests
- Code follows existing patterns
- Documentation is updated
