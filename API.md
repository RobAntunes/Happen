# Happen API Reference

## Table of Contents
- [Initialization](#initialization)
- [Nodes](#nodes)
- [Events](#events)
- [Views](#views)
- [Transport](#transport)
- [Resilience](#resilience)
- [Flow Balance](#flow-balance)

## Initialization

### `initializeHappen(config?: HappenConfig): HappenRuntime`

Creates and initializes a new Happen runtime instance.

```typescript
const happen = initializeHappen({
  transport: {
    type: 'nats',
    options: {
      servers: ['nats://localhost:4222']
    }
  }
});
```

**Config Options:**
- `transport`: Transport configuration
  - `type`: 'memory' | 'nats' (default: 'memory')
  - `options`: Transport-specific options
- `security`: Security configuration
  - `identityProvider`: Custom identity provider
  - `nonce`: Enable nonce-based replay protection

## Nodes

### `happen.createNode(type: string, options?: NodeOptions): HappenNode`

Creates a new node instance.

```typescript
const orderService = happen.createNode('order-service', {
  id: 'order-service-main',
  acceptFrom: ['api-gateway', 'admin-*']
});
```

**Options:**
- `id`: Custom node ID (auto-generated if not provided)
- `acceptFrom`: Array of node patterns to accept events from
- `metadata`: Custom metadata object

### Node Instance Methods

#### `node.on(eventType: string, handler: EventHandler): void`

Register an event handler.

```typescript
node.on('order.create', async (event, context) => {
  // Handle event
  return { success: true };
});
```

#### `node.send(target: HappenNode, event: Partial<HappenEvent>): SendChain`

Send an event to a specific node.

```typescript
const response = await node.send(targetNode, {
  type: 'query.user',
  payload: { userId: '123' }
}).return();
```

#### `node.emit(event: Partial<HappenEvent>): Promise<void>`

Emit an event locally within the same node.

```typescript
await node.emit({
  type: 'internal.process',
  payload: { data: 'value' }
});
```

#### `node.broadcast(event: Partial<HappenEvent>): Promise<void>`

Broadcast an event to all nodes.

```typescript
await node.broadcast({
  type: 'config.update',
  payload: { setting: 'value' }
});
```

## Events

### Event Structure

```typescript
interface HappenEvent {
  id: string;
  type: string;
  payload: any;
  context: {
    causal: {
      causationId: string;
      correlationId: string;
      sender: string;
    };
    temporal: {
      timestamp: number;
      expiresAt?: number;
    };
    security: {
      nonce?: string;
      hash?: string;
    };
  };
  metadata?: Record<string, any>;
}
```

### Event Handlers

#### Basic Handler
```typescript
node.on('event.type', (event, context) => {
  // Synchronous handler
  console.log(event.payload);
});
```

#### Async Handler with Response
```typescript
node.on('query.data', async (event, context) => {
  const result = await fetchData(event.payload.id);
  return result; // Sent back to caller
});
```

#### Event Continuum
```typescript
node.on('process.start', (event, context) => {
  // Initial processing
  context.processId = generateId();
  
  // Return function to continue flow
  return async (event, context) => {
    // Continuation has access to context.processId
    await completeProcess(context.processId);
  };
});
```

## Views

### `happen.views.create(name: string): View<T>`

Create a shared state view.

```typescript
const cartView = happen.views.create<Cart>('shopping-carts');
```

### View Methods

#### `view.set(key: string, value: T): void`
Store a value in the view.

#### `view.get(key: string): T | undefined`
Retrieve a value from the view.

#### `view.has(key: string): boolean`
Check if a key exists.

#### `view.delete(key: string): void`
Remove a value from the view.

#### `view.keys(): string[]`
Get all keys in the view.

#### `view.values(): T[]`
Get all values in the view.

### `happen.views.collect(nodes: HappenNode[], fn: Function): Promise<T[]>`

Collect responses from multiple nodes.

```typescript
const results = await happen.views.collect(workerNodes, async (node) => {
  const response = await coordinator.send(node, {
    type: 'status.check'
  }).return();
  return response;
});
```

## Transport

### Memory Transport (Development)

Default transport for local development and testing.

```typescript
const happen = initializeHappen({
  transport: { type: 'memory' }
});
```

### NATS Transport (Production)

For distributed deployments.

```typescript
const happen = initializeHappen({
  transport: {
    type: 'nats',
    options: {
      servers: ['nats://localhost:4222'],
      user: 'username',
      pass: 'password',
      tls: {
        ca: '/path/to/ca.pem'
      }
    }
  }
});
```

## Resilience

### Circuit Breaker

```typescript
import { CircuitBreaker } from '@happen/core';

const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 10000,
  monitoringPeriod: 60000
});

const result = await breaker.execute(async () => {
  return await riskyOperation();
});
```

**Options:**
- `failureThreshold`: Number of failures before opening
- `resetTimeout`: Time before attempting to close (ms)
- `monitoringPeriod`: Time window for failure tracking (ms)

### Pattern Matching

Nodes support pattern matching for routing and acceptance control:

- Exact match: `'order-service'`
- Wildcard suffix: `'monitor-*'`
- Wildcard prefix: `'*-service'`
- Any match: `'*'`
- Alternatives: `'order|payment|inventory'`

## Flow Balance

### `createFlowBalanceMonitor(jsm: JetStreamManager, config?: FlowBalanceConfig): FlowBalanceMonitor`

Create an invisible resilience monitor.

```typescript
const monitor = createFlowBalanceMonitor(
  happen.transport.jetStreamManager,
  {
    enabled: true,
    pollingInterval: 5000,
    thresholds: {
      minorLag: 100,
      moderateLag: 500,
      severeLag: 1000,
      criticalLag: 5000
    }
  },
  (event) => {
    // Handle monitoring events
    monitoringNode.emit(event);
  }
);

monitor.start();
```

### Monitoring Events

Flow Balance emits these event types:
- `node.down`: Individual node failure detected
- `system.down`: System-wide issue detected

### Monitor Methods

#### `monitor.start(): void`
Start monitoring.

#### `monitor.stop(): void`
Stop monitoring.

#### `monitor.getFlowMetrics(): Map<string, FlowMetrics>`
Get current flow metrics for all nodes.

#### `monitor.getDetectedPatterns(): Map<string, FlowPattern>`
Get detected issue patterns.

#### `monitor.getNodeStates(): Map<string, 'healthy' | 'degraded' | 'unhealthy'>`
Get current node health states.

## Error Handling

### Error Events

Errors in handlers automatically generate error events:

```typescript
node.on('error', (event, context) => {
  const { originalEvent, error, nodeId } = event.payload;
  console.error(`Error in ${nodeId}:`, error.message);
});
```

### Custom Error Handling

```typescript
node.on('risky.operation', async (event, context) => {
  try {
    return await riskyOperation(event.payload);
  } catch (error) {
    // Emit custom error event
    await node.emit({
      type: 'operation.failed',
      payload: {
        operation: 'risky.operation',
        error: error.message,
        context: event.payload
      }
    });
    throw error; // Re-throw to trigger system error handling
  }
});
```

## TypeScript Types

```typescript
// Core types
type EventHandler = (event: HappenEvent, context: EventContext) => any;
type EventType = string | '*';
type NodeId = string;

// Context passed to handlers
interface EventContext {
  node: HappenNode;
  runtime: HappenRuntime;
  [key: string]: any; // User-defined context
}

// Send chain for request-response
interface SendChain {
  return(): Promise<any>;
  broadcast(): Promise<void>;
}

// View interface
interface View<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): void;
  keys(): string[];
  values(): T[];
  clear(): void;
}
```