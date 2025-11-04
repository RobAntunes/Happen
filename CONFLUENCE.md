# Confluence - Unified Fan-in and Fan-out Processing

Confluence is Happen's system for handling multiple events and multiple nodes with minimal API surface. It provides powerful capabilities for both event batching (fan-in) and multi-node distribution (fan-out) through a single, intuitive container pattern.

## Core Idea

Confluence embodies a simple concept: **When something is in a container, it represents a collection**. This principle applies consistently whether you're working with nodes or events:

- An array of nodes means "multiple receivers"
- An array of events means "a batch of events"
- Handlers naturally work with both individual items and collections

This symmetry creates a powerful system with virtually no new API surface.

## API Surface

The entire Confluence system introduces **zero new methods**, instead extending Happen's existing API to work with arrays.

### Fan-out: One Event, Multiple Nodes

Send an event to multiple nodes simultaneously:

```javascript
import { createNodeArray } from 'happen';

// Create a node array
const nodes = createNodeArray([orderNode, paymentNode, inventoryNode]);

// Register handler on all nodes
nodes.on('update', (event, context) => {
  // Each node gets context.node to identify itself
  console.log(`Processing in ${context.node.id}`);
  return { updated: true };
});

// Send to all nodes
await nodes.send({
  type: 'update',
  payload: { data: 'new data' }
});
```

### Fan-in: Multiple Events, One Handler

Send a batch of events to a single node:

```javascript
// Handler can detect single event vs batch
node.on('data-point', (eventOrEvents, context) => {
  if (Array.isArray(eventOrEvents)) {
    // Batch processing
    console.log(`Processing batch of ${eventOrEvents.length} events`);
    return processBatch(eventOrEvents);
  } else {
    // Single event
    console.log(`Processing single event`);
    return processSingle(eventOrEvents);
  }
});

// Send batch of events
const events = [
  { type: 'data-point', payload: { value: 10 } },
  { type: 'data-point', payload: { value: 20 } },
  { type: 'data-point', payload: { value: 30 } }
];

// Process as batch
await node.process(events);
```

## Collecting Results from Multiple Nodes

When sending to multiple nodes, you can collect all results:

```javascript
const result = await nodes.send({
  type: 'verify-data',
  payload: { id: '123' }
});

// Get results from all nodes
const responses = await result.return();

// Access by node ID
console.log(responses['order-node']);
console.log(responses['payment-node']);
console.log(responses['inventory-node']);
```

## Divergent Flows

When an event is sent to multiple nodes using Confluence, each node processes it through its own independent flow chain, creating "divergent flows":

```javascript
const nodes = createNodeArray([orderNode, inventoryNode, notificationNode]);

nodes.on('order-updated', (event, context) => {
  const nodeId = context.node.id;

  // Each node can return a different next function
  if (nodeId === 'order-service') {
    return updateOrderRecord;
  } else if (nodeId === 'inventory-service') {
    return updateInventoryLevels;
  } else {
    return sendNotifications;
  }
});
```

This creates a causal tree structure where:
- Each node has its own isolated context
- Flow paths can diverge based on node-specific logic
- Return values are tracked per node
- The complete causal history is preserved

## Context in Multi-Node Operations

### Node Identification

When a handler receives an event in a multi-node operation, the context identifies which node is processing it:

```javascript
nodes.on('process-event', (event, context) => {
  // context.node identifies the current node
  console.log(`Processing in: ${context.node.id}`);

  // Each node maintains its own isolated context
  context.nodeState = context.nodeState || {};
  context.nodeState.lastProcessed = Date.now();
});
```

### Batch Context

For batch operations (multiple events to a single node), the context provides batch-level information:

```javascript
node.on('data-point', (events, context) => {
  if (Array.isArray(events)) {
    // Batch-level information at the root
    console.log(`Processing batch of ${events.length} events`);
    console.log(`Batch received at: ${context.receivedAt}`);

    // Each event has its own context in the events array
    events.forEach((event, index) => {
      const eventContext = context.events[index];
      console.log(`Event ${index} causation: ${eventContext.causal.causationId}`);
    });
  }
});
```

## Causality Preservation

Even with batches and multi-node processing, Confluence maintains Happen's causality guarantees:

- The causal context is preserved for each event in a batch
- Each event maintains its position in the causal chain
- Batch processing still records each event's causal history
- Divergent flows are tracked as branches in the causal tree

This means you can always trace the complete history of events, even when they've been processed in batches or across multiple nodes.

## Usage Patterns

### Health Checks Across Services

```javascript
const services = createNodeArray([api, database, cache, queue]);

services.on('health.check', (event, context) => {
  return {
    status: 'healthy',
    service: context.node.id,
    timestamp: Date.now()
  };
});

const result = await services.send({ type: 'health.check', payload: {} });
const health = await result.return();
```

### Batch Analytics Processing

```javascript
analyticsNode.on('metric', (eventOrEvents, context) => {
  if (Array.isArray(eventOrEvents)) {
    // Efficient batch processing
    const metrics = eventOrEvents.map(e => e.payload);
    return analyzeMetricsBatch(metrics);
  }
  return analyzeSingleMetric(eventOrEvents.payload);
});
```

### Coordinated Updates

```javascript
const dataNodes = createNodeArray([primaryDB, replicaDB, cache]);

dataNodes.on('data.update', async (event, context) => {
  const nodeId = context.node.id;

  if (nodeId.includes('primary')) {
    return await updatePrimary(event.payload);
  } else if (nodeId.includes('replica')) {
    return await updateReplica(event.payload);
  } else {
    return await invalidateCache(event.payload);
  }
});

// All nodes updated simultaneously
await dataNodes.send({
  type: 'data.update',
  payload: { key: 'user:123', value: { name: 'Alice' } }
});
```

## No Configuration Needed

Since batching is fully explicit with arrays, there's no magical configuration needed. Batches are simply arrays of events that you create and send directly:

```javascript
// Single event
node.send({ type: 'data-point', payload: { value: 42 } });

// Batch as explicit array
node.send([
  { type: 'data-point', payload: { value: 10 } },
  { type: 'data-point', payload: { value: 20 } },
  { type: 'data-point', payload: { value: 30 } }
]);
```

This direct approach ensures complete predictability with no behind-the-scenes magic.

## Best Practices

1. **Use NodeArray for explicit multi-node operations**
   ```javascript
   const nodes = createNodeArray([node1, node2, node3]);
   ```

2. **Check for arrays in handlers that support both**
   ```javascript
   if (Array.isArray(events)) {
     // Batch processing
   } else {
     // Single event processing
   }
   ```

3. **Use context.node for node-specific logic**
   ```javascript
   const nodeId = context.node.id;
   ```

4. **Collect results when needed**
   ```javascript
   const result = await nodes.send(event);
   const responses = await result.return();
   ```

5. **Keep batch sizes reasonable**
   - Process in chunks if dealing with large datasets
   - Consider memory and processing time constraints

## Performance Benefits

Confluence provides performance benefits through:

- **Reduced network round-trips**: Send once to multiple nodes
- **Efficient batch processing**: Process multiple events in one handler invocation
- **Parallel execution**: Multiple nodes process simultaneously
- **Explicit control**: No hidden buffering or timing logic

## Summary

Confluence provides powerful capabilities for handling multiple events and multiple nodes while maintaining Happen's commitment to radical simplicity. Through a single intuitive container pattern - using arrays for both nodes and events - it enables sophisticated batch processing and multi-node communication without introducing special methods or complex APIs.

The entire system is explicit, predictable, and maintains full causality tracking across all operations.
