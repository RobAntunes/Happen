# Happen
<!-- 
<p align="center">
  <img src="assets/happen-logo.svg" alt="Happen Framework Logo" width="180" />
</p>

<p align="center">
  <strong>A framework for building agentic systems founded on a philosophy of radical simplicity.</strong>
</p>

<p align="center">
  <a href="https://happen-docs.dev">Documentation</a> •
  <a href="#examples">Examples</a> •
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="CONTRIBUTING.md">Contributing</a>
</p> -->

## Overview

Happen distills agent-based systems down to their essence, providing just two fundamental building blocks that combine to create systems ranging from simple pipelines to complex, adaptive multi-agent ecosystems:

1. **Nodes** - Independent, autonomous components that process and respond to information
2. **Events** - Structured messages that transport data and intentions between Nodes

Unlike conventional frameworks that burden developers with complex abstractions, Happen's minimalist approach creates a framework that is both accessible to newcomers and powerful enough for experts, allowing developers to focus on solving domain problems rather than battling framework complexities.

```javascript
// Create independent nodes
const orderNode = createNode('order-service');
const paymentNode = createNode('payment-service');
const inventoryNode = createNode('inventory-service');

// Define event handlers
orderNode.on('create-order', event => {
  // Process order creation
  const orderId = generateOrderId();
  // Emit a follow-up event
  orderNode.broadcast({
    type: 'inventory-check',
    payload: { orderId, items: event.payload.items }
  });
  return { orderId, status: 'processing' };
});

// Nodes communicate through events
inventoryNode.on('inventory-check', event => {
  const { orderId, items } = event.payload;
  const allAvailable = checkInventory(items);
  
  if (allAvailable) {
    inventoryNode.broadcast({
      type: 'payment-request',
      payload: { orderId, items }
    });
  } else {
    inventoryNode.broadcast({
      type: 'order-failed',
      payload: { orderId, reason: 'inventory-unavailable' }
    });
  }
});
```

## Core Philosophy

Happen embraces a philosophy of radical simplicity:

- **Radical Minimalism**: Only include what's absolutely essential
- **Pure Causality**: Everything in a Happen system happens because of something else, creating natural causal chains
- **Decentralized Intelligence**: Smart systems emerge from simple nodes making local decisions
- **Composable Simplicity**: Complex behavior emerges from composing simple, understandable parts
- **Runtime Transparency**: Direct access to the underlying runtime environments

## Features

### Core Capabilities

- **Event-Driven Architecture**: Everything happens through structured events
- **Pure Causality Model**: Events naturally form causal chains
- **Three Communication Patterns**: System-wide broadcasting, targeted broadcasting, and direct request-response
- **Implicit Contracts**: Node interfaces emerge naturally from event patterns
- **Runtime Transparency**: Direct access to native runtime capabilities

### Latest Features (v2.0)

#### Unified Agentic Runtime

```javascript
const agentNode = createNode('reasoning-agent', {
  capabilities: ['reasoning', 'planning', 'memory'],
  model: 'local-llm',
  contextWindow: 16000,
  systemPrompt: 'You are a helpful assistant...'
});

// Agent automatically processes relevant events
agentNode.on('user-query', async (event) => {
  // Agent reasoning occurs within the node
  const response = await agentNode.think({
    query: event.payload.text,
    context: event.payload.context
  });
  
  // Emit the response as an event
  agentNode.broadcast({
    type: 'agent-response',
    payload: response
  });
});
```

#### Enhanced Lifecycle Hooks

```javascript
// Register hooks for different lifecycle stages
myNode.registerHooks(
  'user-*',
  {
    preEmit: event => {
      // Add metadata before sending
      event.metadata.emitTimestamp = Date.now();
      return event;
    },
    preHandle: event => {
      // Validate payload before handling
      if (!event.payload.userId) throw new Error('Missing userId');
    },
    postHandle: (event, handlerError) => {
      // Log after handling
      if (handlerError) console.error('Handler failed', handlerError);
    }
  },
  { priority: 10 }
);
```

#### Event Logging and Replay

```javascript
// Initialize workflow module with logging and replay
const workflows = createWorkflows({
  features: {
    logging: true,
    replay: true
  },
  logging: {
    patterns: ['domain-*', 'user-*'],
    excludePatterns: ['heartbeat-*']
  }
});

// Replay events for debugging or recovery
workflows.replay({
  filter: {
    correlationId: 'order-123',
    timeRange: {
      start: '2023-05-01T00:00:00Z',
      end: '2023-05-02T00:00:00Z'
    }
  },
  options: {
    speed: 1.0,
    destination: 'original'
  }
});
```

#### Unified Event Space (Distributed Runtime)

```javascript
// Create a node with distributed capabilities
const distributedNode = createNode('remote-service', {
  transport: {
    type: 'nats',
    connectionString: 'nats://localhost:4222',
    subjects: {
      subscribe: ['orders.*', 'inventory.*'],
      publish: 'shipping.*'
    }
  }
});

// Code remains identical whether nodes are local or remote
const response = await orderNode.request(inventoryNode, {
  type: 'check-inventory',
  payload: { items }
});
```

#### Agentic Memory System

```javascript
// Create a memory node
const memoryNode = createNode('memory-service');

// Initialize memory system with vector capabilities
const memory = initializeMemorySystem({
  vectorStore: 'chroma',
  graphEnabled: true,
  kvStore: 'embedded',
  episodicEnabled: true
});

// Store and retrieve memories through events
memoryNode.on('store-memory', async (event) => {
  const { content, type, metadata } = event.payload;
  const memoryId = await memory.store(content, type, metadata);
  return { memoryId };
});

memoryNode.on('retrieve-memory', async (event) => {
  const { query, filters, type } = event.payload;
  const memories = await memory.retrieve(query, filters, type);
  return { memories };
});
```

#### Composable Error Handling

```javascript
// Compose multiple error handlers
paymentNode.registerHooks('payment-process', {
  error: [
    createCircuitBreakerHook({ threshold: 5, resetTimeout: 30000 }),
    createRetryHook({ maxRetries: 3, backoff: 'exponential' }),
    createFallbackServiceHook({ service: backupPaymentService }),
    createDeadLetterHook({ queue: 'failed-payments' })
  ]
});
```

#### Built-in Security

```javascript
// Security is an inherent property of nodes
const paymentNode = createNode('payment-service', {
  security: {
    level: 'high',
    accessControl: {
      canReceive: {
        'order-submitted': ['order-service', 'admin-service'],
        'refund-requested': ['customer-service']
      },
      roles: ['finance']
    }
  }
});
```

## Installation

```bash
npm install happen-framework
```

## Quick Start

```javascript
import { createNode } from 'happen-framework';

// Create nodes
const userNode = createNode('user-service');
const notificationNode = createNode('notification-service');

// Handle events
userNode.on('user-registered', event => {
  const { email, name } = event.payload;
  
  // Store user (implementation omitted)
  storeUser({ email, name });
  
  // Emit welcome event
  userNode.broadcast({
    type: 'welcome-new-user',
    payload: { email, name }
  });
});

// Handle notifications
notificationNode.on('welcome-new-user', async event => {
  const { email, name } = event.payload;
  
  // Send welcome email
  await sendEmail({
    to: email,
    subject: `Welcome to our platform, ${name}!`,
    body: createWelcomeEmailBody(name)
  });
  
  // Emit notification sent event
  notificationNode.broadcast({
    type: 'notification-sent',
    payload: { type: 'welcome', recipient: email }
  });
});

// Start the system
function startSystem() {
  console.log('System initialized and ready');
  
  // Simulate a registration
  userNode.receive({
    type: 'user-registered',
    payload: {
      email: 'jane@example.com',
      name: 'Jane Doe'
    }
  });
}

startSystem();
```

## Design Decisions

### Radical Simplicity as Design Philosophy

Happen embraces the philosophy that true power emerges from simplicity rather than complexity. The framework provides just two fundamental primitives—Nodes and Events—that combine to create systems of surprising power and flexibility.

### Causal Event Web

Happen's most distinctive aspect is its embrace of pure causality as its organizing principle:

- Events contain references to their causal predecessors
- Every event has a unique identifier referenced by its dependents
- These references form a complete causal web that defines system behavior

```javascript
// An event naturally references its causal predecessors
{
  type: 'order-shipped',
  payload: {
    orderId: 'ORD-123',
    trackingNumber: 'TRK-456'
  },
  metadata: {
    id: 'evt-789',                 // Unique identifier
    sender: 'shipping-node',       // Origin node
    causationId: 'evt-456',        // Direct cause (payment confirmation)
    correlationId: 'order-123'     // Overall transaction
  }
}
```

### Event-Driven State Management

Rather than providing complex state management primitives, Happen treats state as an emergent property of event flow:

- Nodes maintain state and change it in response to events
- State can be rebuilt by replaying events
- No special state management primitives needed

### Security as a First-Class Primitive

Security is not a separate layer but an inherent property of nodes and events:

- Every node has built-in cryptographic identity
- Events carry proof of their origin and integrity
- Access control is applied through a hybrid system-node model

### Runtime Transparency

Happen is a coordination layer for events—the runtime belongs to your code:

- No framework-specific abstractions between your code and the runtime
- Direct access to runtime capabilities
- No "Happen way" to use the runtime—just use it directly

## Use Cases

Happen is ideal for:

- **Agentic Applications**: Building systems of autonomous agents with specialized capabilities
- **Event-Driven Architectures**: Creating flexible systems with decoupled components
- **Distributed Applications**: Building systems that span multiple processes or machines
- **Complex Workflows**: Managing complex business processes across multiple domains
- **Reactive Systems**: Building systems that respond naturally to changes and events

## Roadmap

Our current focus areas:

- Enhanced agentic capabilities for LLM integration
- Additional transport options for specialized deployment scenarios
- Extended tooling for debugging and monitoring
- Performance optimizations for high-throughput scenarios

## Examples

Check out the [examples directory](examples/) for more detailed examples:

- Basic Agent System
- Multi-Agent Collaboration
- Event Sourcing Pattern
- Distributed Processing
- Agentic Memory Usage

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

## License

MIT
