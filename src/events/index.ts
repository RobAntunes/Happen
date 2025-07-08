/**
 * Event creation and management utilities
 */

import { HappenEvent, EventContext, EventPayload } from '../types';
import { generateId } from '../utils/id';

/**
 * Create a new event with automatic ID and timestamp
 */
export function createEvent<T = EventPayload>(
  type: string,
  payload: T,
  context?: Partial<EventContext>
): HappenEvent<T> {
  return {
    id: generateId(),
    type,
    payload,
    context: {
      timestamp: Date.now(),
      origin: context?.origin || { nodeId: 'unknown' },
      ...context,
    },
  };
}

/**
 * Create an event with causal relationship to a parent event
 */
export function createCausalEvent<T = EventPayload>(
  parentEvent: HappenEvent,
  type: string,
  payload: T,
  context?: Partial<EventContext>
): HappenEvent<T> {
  return createEvent(type, payload, {
    ...context,
    causality: parentEvent.id,
    correlationId: context?.correlationId || parentEvent.context.correlationId,
  });
}

/**
 * Check if an event matches a pattern
 */
export function matchesPattern(event: HappenEvent, pattern: string | ((type: string) => boolean)): boolean {
  if (typeof pattern === 'string') {
    return event.type === pattern;
  }
  return pattern(event.type);
}

/**
 * Create an error event
 */
export function createErrorEvent(
  error: Error,
  sourceEvent?: HappenEvent,
  context?: Partial<EventContext>
): HappenEvent<{ error: string; stack?: string; code?: string }> {
  return createEvent(
    'system.error',
    {
      error: error.message,
      stack: error.stack,
      code: (error as any).code,
    },
    {
      ...context,
      causality: sourceEvent?.id,
    }
  );
}

/**
 * Event validation
 */
export function validateEvent(event: unknown): event is HappenEvent {
  if (!event || typeof event !== 'object') {
    return false;
  }
  
  const e = event as any;
  return (
    typeof e.id === 'string' &&
    typeof e.type === 'string' &&
    e.payload !== undefined &&
    typeof e.context === 'object' &&
    typeof e.context.timestamp === 'number' &&
    typeof e.context.origin === 'object' &&
    typeof e.context.origin.nodeId === 'string'
  );
}

/**
 * Clone an event with a new ID (useful for reprocessing)
 */
export function cloneEvent<T = EventPayload>(
  event: HappenEvent<T>,
  overrides?: Partial<HappenEvent<T>>
): HappenEvent<T> {
  return {
    ...event,
    ...overrides,
    id: overrides?.id || generateId(),
    context: {
      ...event.context,
      ...overrides?.context,
      timestamp: Date.now(),
    },
  };
}