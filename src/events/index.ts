/**
 * Event creation and management utilities
 */

import { HappenEvent, EventContext, EventPayload } from '../types';
import { generateId } from '../utils/id';
import { getGlobalIntegrityManager } from '../integrity';

/**
 * Create a new event with automatic ID and timestamp
 */
export function createEvent<T = EventPayload>(
  type: string,
  payload: T,
  context?: Partial<EventContext>,
  nodeId: string = 'unknown'
): HappenEvent<T> {
  const eventId = generateId();
  
  return {
    id: eventId,
    type,
    payload,
    context: {
      timestamp: Date.now(),
      causal: {
        ...context?.causal,
        id: context?.causal?.id || eventId,
        sender: context?.causal?.sender || nodeId,
        path: context?.causal?.path || [nodeId],
      },
      system: context?.system,
      user: context?.user,
      origin: context?.origin,
    },
  };
}

/**
 * Create a secure event with integrity information
 */
export async function createSecureEvent<T = EventPayload>(
  type: string,
  payload: T,
  context?: Partial<EventContext>,
  nodeId: string = 'unknown'
): Promise<HappenEvent<T>> {
  const event = createEvent(type, payload, context, nodeId);
  
  // Add integrity information
  const integrityManager = getGlobalIntegrityManager();
  const integrity = await integrityManager.createIntegrity(event, nodeId);
  
  return {
    ...event,
    context: {
      ...event.context,
      integrity
    }
  };
}

/**
 * Create an event with causal relationship to a parent event
 */
export function createCausalEvent<T = EventPayload>(
  parentEvent: HappenEvent,
  type: string,
  payload: T,
  context?: Partial<EventContext>,
  nodeId: string = 'unknown'
): HappenEvent<T> {
  const parentCausal = parentEvent.context.causal;
  const correlationId = parentCausal.correlationId || parentCausal.id;
    
  return createEvent(type, payload, {
    ...context,
    causal: {
      id: generateId(), // New event needs its own ID
      sender: nodeId,
      causationId: parentEvent.id,
      correlationId,
      path: [...parentCausal.path, nodeId],
      ...context?.causal
    }
  }, nodeId);
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
  context?: Partial<EventContext>,
  nodeId: string = 'unknown'
): HappenEvent<{ error: string; stack?: string; code?: string }> {
  if (sourceEvent) {
    return createCausalEvent(
      sourceEvent,
      'system.error',
      {
        error: error.message,
        stack: error.stack,
        code: (error as any).code,
      },
      context,
      nodeId
    );
  }
  
  return createEvent(
    'system.error',
    {
      error: error.message,
      stack: error.stack,
      code: (error as any).code,
    },
    context,
    nodeId
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
    typeof e.context.causal === 'object' &&
    typeof e.context.causal.id === 'string' &&
    typeof e.context.causal.sender === 'string' &&
    Array.isArray(e.context.causal.path)
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