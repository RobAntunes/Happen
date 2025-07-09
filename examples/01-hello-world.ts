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
  
  // Register event handler that returns a response
  listenerNode.on('hello', (event) => {
    console.log(`Received: ${event.payload.message}`);
    console.log(`From: ${event.context.causal.sender}`);
    
    // Return a response
    return {
      message: 'Hello back from listener!',
      timestamp: Date.now()
    };
  });
  
  // Send event and wait for response
  const response = await greeterNode.send(listenerNode, {
    type: 'hello',
    payload: { message: 'Hello, Happen!' }
  }).return();
}

main()
