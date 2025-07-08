/**
 * Confluence - Unified Fan-in and Fan-out Event Processing
 * 
 * Handles array operations for both nodes and events with zero new methods
 */

import { HappenNode, EventHandler, Pattern, SendResult } from '../types';

/**
 * Extend Array prototype to support Happen operations
 * This allows [node1, node2].on(...) syntax
 */
declare global {
  interface Array<T> {
    /**
     * Register event handler on multiple nodes
     */
    on(this: HappenNode[], pattern: Pattern, handler: EventHandler): () => void;
    
    /**
     * Send event from multiple nodes
     */
    send(this: HappenNode[], event: any): any;
    send(this: HappenNode[], target: HappenNode | HappenNode[], event: any): any;
    
    /**
     * Broadcast event from multiple nodes
     */
    broadcast(this: HappenNode[], event: any): Promise<void>;
  }
}

// Only extend if not already extended
if (!Array.prototype.on) {
  /**
   * Register handler on multiple nodes
   * Returns unsubscribe function that removes from all nodes
   */
  Array.prototype.on = function(this: HappenNode[], pattern: Pattern, handler: EventHandler): () => void {
    if (!isNodeArray(this)) {
      throw new Error('on() can only be called on arrays of HappenNode instances');
    }

    // Register on each node, wrapping handler to add node context
    const unsubscribers = this.map(node => 
      node.on(pattern, (eventOrEvents, context) => {
        // Add node info to context
        context.node = { id: node.id };
        return handler(eventOrEvents, context);
      })
    );

    // Return function that unsubscribes from all
    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  };

  /**
   * Send event(s) from multiple nodes
   * Each node in the array sends the event independently
   */
  Array.prototype.send = function(this: HappenNode[], targetOrEvent: any, eventIfTarget?: any) {
    if (!isNodeArray(this)) {
      throw new Error('send() can only be called on arrays of HappenNode instances');
    }

    // Check if this is array.send(event) or array.send(target, event)
    const hasTarget = eventIfTarget !== undefined;
    const target = hasTarget ? targetOrEvent : null;
    const event = hasTarget ? eventIfTarget : targetOrEvent;

    if (!hasTarget) {
      // array.send(event) - each node sends to itself (for testing/local processing)
      const sendResults = new Map<string, SendResult>();
      
      this.forEach(node => {
        const result = node.send(node, event);
        sendResults.set(node.id, result);
      });

      return {
        return: async () => {
          const results: Record<string, any> = {};
          
          for (const [nodeId, sendResult] of sendResults) {
            try {
              results[nodeId] = await sendResult.return();
            } catch (error) {
              results[nodeId] = { error: error instanceof Error ? error.message : String(error) };
            }
          }
          
          return results;
        }
      };
    } else {
      // array.send(target, event) - each node sends to the target
      const sendResults = new Map<string, SendResult>();
      
      this.forEach(node => {
        const result = node.send(target, event);
        sendResults.set(node.id, result);
      });

      return {
        return: async () => {
          const results: Record<string, any> = {};
          
          for (const [nodeId, sendResult] of sendResults) {
            try {
              results[nodeId] = await sendResult.return();
            } catch (error) {
              results[nodeId] = { error: error instanceof Error ? error.message : String(error) };
            }
          }
          
          return results;
        }
      };
    }
  };

  /**
   * Broadcast from multiple nodes
   */
  Array.prototype.broadcast = async function(this: HappenNode[], event: any): Promise<void> {
    if (!isNodeArray(this)) {
      throw new Error('broadcast() can only be called on arrays of HappenNode instances');
    }

    await Promise.all(this.map(node => node.broadcast(event)));
  };
}

/**
 * Type guard to check if array contains HappenNodes
 */
function isNodeArray(arr: any[]): arr is HappenNode[] {
  return arr.length > 0 && arr.every(item => 
    item && typeof item.on === 'function' && typeof item.send === 'function'
  );
}

/**
 * Export empty object to make this a module
 */
export {};