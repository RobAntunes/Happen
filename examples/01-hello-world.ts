#!/usr/bin/env ts-node
/**
 * Basic Hello World example
 * Shows the simplest way to create nodes and send events
 */

import { initializeHappen } from '../src';

async function main() {
  // Initialize Happen framework
  const happen = initializeHappen();
  
  // Create two nodes
  const greeterNode = happen.createNode('greeter');
  const listenerNode = happen.createNode('listener');
  
  // Register event handler
  listenerNode.on('hello', (eventOrEvents) => {
    // Handle single event (common case)
    const event = Array.isArray(eventOrEvents) ? eventOrEvents[0] : eventOrEvents;
    console.log(`Received: ${event.payload.message}`);
    console.log(`From: ${event.context.causal.sender}`);
  });
  
  // Send event
  greeterNode.send(listenerNode, {
    type: 'hello',
    payload: { message: 'Hello, Happen!' }
  });
  
  // Give time for async processing
  await new Promise(resolve => setTimeout(resolve, 100));
}

main().catch(console.error);