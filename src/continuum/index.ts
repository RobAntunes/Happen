/**
 * Event Continuum - Functional flow control for event processing
 */

import { EventHandler, HappenEvent } from '../types';

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
 */
export async function executeHandler(
  handler: EventHandler,
  event: HappenEvent,
  _context: FlowContext
): Promise<EventHandler | void> {
  try {
    const result = await handler(event);
    return result as EventHandler | void;
  } catch (error) {
    // Errors are handled by returning error handlers
    throw error;
  }
}

/**
 * Process an event through the continuum
 */
export async function processContinuum(
  initialHandler: EventHandler,
  event: HappenEvent,
  nodeId: string
): Promise<void> {
  const context: FlowContext = {
    event,
    nodeId,
    startTime: Date.now(),
    path: [],
  };
  
  let currentHandler: EventHandler | void = initialHandler;
  
  while (currentHandler) {
    context.path.push(currentHandler.name || 'anonymous');
    
    try {
      currentHandler = await executeHandler(currentHandler, event, context);
    } catch (error) {
      // Allow error handlers to be thrown and caught
      if (typeof error === 'function') {
        currentHandler = error as EventHandler;
      } else {
        throw error;
      }
    }
  }
}

/**
 * Flow control helpers
 */
export const flow = {
  /**
   * Continue to next handler only if condition is met
   */
  when: (condition: boolean | ((event: HappenEvent) => boolean), handler: EventHandler): EventHandler => {
    return (event) => {
      const shouldContinue = typeof condition === 'function' ? condition(event) : condition;
      return shouldContinue ? handler : undefined;
    };
  },
  
  /**
   * Branch to different handlers based on conditions
   */
  branch: (branches: Array<[condition: (event: HappenEvent) => boolean, handler: EventHandler]>): EventHandler => {
    return (event) => {
      for (const [condition, handler] of branches) {
        if (condition(event)) {
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
    return async (event) => {
      await Promise.all(handlers.map(handler => handler(event)));
      return undefined;
    };
  },
  
  /**
   * Execute handlers in sequence
   */
  sequence: (...handlers: EventHandler[]): EventHandler => {
    return async (event) => {
      for (const handler of handlers) {
        const next = await handler(event);
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
    
    return async (event) => {
      let lastError: any;
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          return await handler(event);
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
    return async (event) => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Handler timeout after ${ms}ms`)), ms);
      });
      
      return Promise.race([handler(event), timeoutPromise]);
    };
  },
  
  /**
   * Transform event before passing to handler
   */
  map: (transform: (event: HappenEvent) => HappenEvent, handler: EventHandler): EventHandler => {
    return (event) => handler(transform(event));
  },
  
  /**
   * Filter events before processing
   */
  filter: (predicate: (event: HappenEvent) => boolean, handler: EventHandler): EventHandler => {
    return (event) => predicate(event) ? handler(event) : undefined;
  },
  
  /**
   * Catch errors and handle them
   */
  catch: (handler: EventHandler, errorHandler: EventHandler): EventHandler => {
    return async (event) => {
      try {
        return await handler(event);
      } catch (error) {
        return errorHandler;
      }
    };
  },
  
  /**
   * Always execute a handler regardless of previous results
   */
  finally: (handler: EventHandler, finallyHandler: EventHandler): EventHandler => {
    return async (event) => {
      try {
        const result = await handler(event);
        await finallyHandler(event);
        return result;
      } catch (error) {
        await finallyHandler(event);
        throw error;
      }
    };
  },
};