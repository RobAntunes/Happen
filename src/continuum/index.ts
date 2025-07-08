/**
 * Event Continuum - Functional flow control for event processing
 */

import { EventHandler, HappenEvent, HandlerContext } from '../types';

/**
 * Flow context that gets passed through the continuum
 */
export interface FlowContext {
  event: HappenEvent;
  nodeId: string;
  startTime: number;
  path: string[];
  metadata?: Record<string, any>;
}

/**
 * Execute an event handler and process its result
 * Handles both regular results and async generators
 */
export async function executeHandler(
  handler: EventHandler,
  eventOrEvents: HappenEvent | HappenEvent[],
  context: HandlerContext
): Promise<any> {
  try {
    const result = await handler(eventOrEvents, context);
    
    // Check if result is an async generator
    if (result && typeof result === 'object' && typeof result[Symbol.asyncIterator] === 'function') {
      return result; // Return the async iterator directly
    }
    
    return result;
  } catch (error) {
    // Errors are handled by returning error handlers
    throw error;
  }
}

/**
 * Process event(s) through the continuum
 */
export async function processContinuum(
  initialHandler: EventHandler,
  eventOrEvents: HappenEvent | HappenEvent[],
  nodeId: string
): Promise<any> {
  // Create the shared handler context
  const context: HandlerContext = {};
  
  // Track flow for debugging
  const flowContext: FlowContext = {
    event: Array.isArray(eventOrEvents) ? eventOrEvents[0]! : eventOrEvents,
    nodeId,
    startTime: Date.now(),
    path: [],
  };
  
  let current: any = initialHandler;
  let result: any = undefined;
  
  while (typeof current === 'function') {
    flowContext.path.push(current.name || 'anonymous');
    
    try {
      result = await executeHandler(current, eventOrEvents, context);
      
      // If result is an async generator, return it immediately
      if (result && typeof result === 'object' && typeof result[Symbol.asyncIterator] === 'function') {
        return result;
      }
      
      // If result is a function, continue the flow
      if (typeof result === 'function') {
        current = result;
      } else {
        // Any other value completes the flow
        return result;
      }
    } catch (error) {
      // Allow error handlers to be thrown and caught
      if (typeof error === 'function') {
        current = error as EventHandler;
      } else {
        throw error;
      }
    }
  }
  
  return result;
}

/**
 * Flow control helpers
 */
export const flow = {
  /**
   * Continue to next handler only if condition is met
   */
  when: (condition: boolean | ((eventOrEvents: HappenEvent | HappenEvent[], context: HandlerContext) => boolean), handler: EventHandler): EventHandler => {
    return (eventOrEvents, context) => {
      const shouldContinue = typeof condition === 'function' ? condition(eventOrEvents, context) : condition;
      return shouldContinue ? handler : undefined;
    };
  },
  
  /**
   * Branch to different handlers based on conditions
   */
  branch: (branches: Array<[condition: (eventOrEvents: HappenEvent | HappenEvent[], context: HandlerContext) => boolean, handler: EventHandler]>): EventHandler => {
    return (eventOrEvents, context) => {
      for (const [condition, handler] of branches) {
        if (condition(eventOrEvents, context)) {
          return handler;
        }
      }
      return undefined;
    };
  },
  
  /**
   * Execute multiple handlers in parallel
   */
  parallel: (...handlers: EventHandler[]): EventHandler => {
    return async (eventOrEvents, context) => {
      await Promise.all(handlers.map(handler => handler(eventOrEvents, context)));
      return undefined;
    };
  },
  
  /**
   * Execute handlers in sequence
   */
  sequence: (...handlers: EventHandler[]): EventHandler => {
    return async (eventOrEvents, context) => {
      for (const handler of handlers) {
        const next = await handler(eventOrEvents, context);
        if (next) {
          return next;
        }
      }
      return undefined;
    };
  },
  
  /**
   * Retry a handler with exponential backoff
   */
  retry: (handler: EventHandler, options?: { maxAttempts?: number; delay?: number }): EventHandler => {
    const { maxAttempts = 3, delay = 1000 } = options || {};
    
    return async (eventOrEvents, context) => {
      let lastError: any;
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          return await handler(eventOrEvents, context);
        } catch (error) {
          lastError = error;
          if (attempt < maxAttempts - 1) {
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt)));
          }
        }
      }
      
      throw lastError;
    };
  },
  
  /**
   * Add timeout to a handler
   */
  timeout: (handler: EventHandler, ms: number): EventHandler => {
    return async (eventOrEvents, context) => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Handler timeout after ${ms}ms`)), ms);
      });
      
      return Promise.race([handler(eventOrEvents, context), timeoutPromise]);
    };
  },
  
  /**
   * Transform event before passing to handler
   */
  map: (transform: (eventOrEvents: HappenEvent | HappenEvent[], context: HandlerContext) => HappenEvent | HappenEvent[], handler: EventHandler): EventHandler => {
    return (eventOrEvents, context) => handler(transform(eventOrEvents, context), context);
  },
  
  /**
   * Filter events before processing
   */
  filter: (predicate: (eventOrEvents: HappenEvent | HappenEvent[], context: HandlerContext) => boolean, handler: EventHandler): EventHandler => {
    return (eventOrEvents, context) => predicate(eventOrEvents, context) ? handler(eventOrEvents, context) : undefined;
  },
  
  /**
   * Catch errors and handle them
   */
  catch: (handler: EventHandler, errorHandler: EventHandler): EventHandler => {
    return async (eventOrEvents, context) => {
      try {
        return await handler(eventOrEvents, context);
      } catch (error) {
        // Store error in context for error handler
        context.error = error;
        return errorHandler;
      }
    };
  },
  
  /**
   * Always execute a handler regardless of previous results
   */
  finally: (handler: EventHandler, finallyHandler: EventHandler): EventHandler => {
    return async (eventOrEvents, context) => {
      try {
        const result = await handler(eventOrEvents, context);
        await finallyHandler(eventOrEvents, context);
        return result;
      } catch (error) {
        await finallyHandler(eventOrEvents, context);
        throw error;
      }
    };
  },
};