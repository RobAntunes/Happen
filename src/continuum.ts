/**
 * Event Continuum - Pure functional flow processor
 * Handles the chain of functions that process events
 */

import type { HappenEvent, EventContext, EventHandler } from './types.js';

/**
 * Result of processing an event through the continuum
 */
export interface ContinuumResult<R = any> {
  /** Whether the event was processed successfully */
  success: boolean;
  /** Final result value from the flow */
  result?: R;
  /** Error if processing failed */
  error?: Error;
  /** Context after processing */
  context: EventContext;
}

/**
 * Process an event through the Event Continuum
 * Executes the handler chain until a non-function value is returned
 */
export async function processEventContinuum<T = any, R = any>(
  event: HappenEvent<T>,
  handler: EventHandler<T, R>,
  initialContext?: EventContext
): Promise<ContinuumResult<R>> {
  // Use provided context or create from event
  const context: EventContext = initialContext || { ...event.context };

  try {
    let current: any = handler;
    let result: any;

    // Keep executing functions until we get a non-function value
    while (typeof current === 'function') {
      result = await current(event, context);
      current = result;
    }

    // Final result is the non-function value
    return {
      success: true,
      result: current,
      context
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      context
    };
  }
}

/**
 * Process an event synchronously (for synchronous handlers only)
 */
export function processEventContinuumSync<T = any, R = any>(
  event: HappenEvent<T>,
  handler: EventHandler<T, R>,
  initialContext?: EventContext
): ContinuumResult<R> {
  const context: EventContext = initialContext || { ...event.context };

  try {
    let current: any = handler;
    let result: any;

    // Keep executing functions until we get a non-function value
    while (typeof current === 'function') {
      result = current(event, context);

      // Check if result is a promise (handler should be sync)
      if (result instanceof Promise) {
        throw new Error('Async handlers cannot be processed synchronously');
      }

      current = result;
    }

    return {
      success: true,
      result: current,
      context
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      context
    };
  }
}

/**
 * Helper to check if a value is a handler function
 */
export function isHandler(value: any): value is EventHandler {
  return typeof value === 'function';
}

/**
 * Create a flow builder for composing handler chains
 */
export function createFlow<T = any, R = any>(
  initialHandler: EventHandler<T, R>
): EventHandler<T, R> {
  return initialHandler;
}

/**
 * Compose multiple handlers into a chain
 * Each handler in the array will be tried in order until one returns a non-function
 */
export function composeHandlers<T = any, R = any>(
  ...handlers: EventHandler<T, R>[]
): EventHandler<T, R> {
  return (event: HappenEvent<T>, context: EventContext) => {
    // Try each handler in sequence
    for (const handler of handlers) {
      const result = handler(event, context);

      // If this handler returns a function, continue with that function
      if (typeof result === 'function') {
        return result;
      }

      // If we get a non-function result, we're done
      if (result !== undefined) {
        return result;
      }
    }

    // If all handlers returned undefined, return undefined
    return undefined as any;
  };
}

/**
 * Create a conditional handler that branches based on a predicate
 */
export function conditional<T = any, R = any>(
  predicate: (event: HappenEvent<T>, context: EventContext) => boolean,
  thenHandler: EventHandler<T, R>,
  elseHandler?: EventHandler<T, R>
): EventHandler<T, R> {
  return (event: HappenEvent<T>, context: EventContext) => {
    if (predicate(event, context)) {
      return thenHandler;
    }
    return elseHandler || (undefined as any);
  };
}

/**
 * Create a handler that executes side effects but doesn't change the flow
 */
export function tap<T = any>(
  sideEffect: (event: HappenEvent<T>, context: EventContext) => void,
  nextHandler?: EventHandler<T, any>
): EventHandler<T, any> {
  return (event: HappenEvent<T>, context: EventContext) => {
    sideEffect(event, context);
    return nextHandler || null;
  };
}

/**
 * Wrap a handler with error handling
 */
export function withErrorHandler<T = any, R = any>(
  handler: EventHandler<T, R>,
  errorHandler: (error: Error, event: HappenEvent<T>, context: EventContext) => R | EventHandler<T, R>
): EventHandler<T, R> {
  return async (event: HappenEvent<T>, context: EventContext) => {
    try {
      return await handler(event, context);
    } catch (error) {
      return errorHandler(
        error instanceof Error ? error : new Error(String(error)),
        event,
        context
      );
    }
  };
}
