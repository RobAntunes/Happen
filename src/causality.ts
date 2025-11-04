/**
 * Causality tracking system
 * Ensures every event has complete causal context
 */

import { randomUUID } from 'crypto';
import type { CausalContext, EventContext, HappenEvent, BroadcastOptions } from './types.js';

/**
 * Generate a unique event ID
 */
export function generateEventId(): string {
  return `evt-${randomUUID()}`;
}

/**
 * Create causal context for a new event
 */
export function createCausalContext(
  sender: string,
  causationId?: string,
  correlationId?: string,
  previousPath: string[] = []
): CausalContext {
  return {
    id: generateEventId(),
    sender,
    causationId,
    correlationId: correlationId || generateCorrelationId(),
    path: [...previousPath, sender],
    timestamp: Date.now()
  };
}

/**
 * Generate a correlation ID for a new transaction/process
 */
export function generateCorrelationId(): string {
  return `txn-${randomUUID()}`;
}

/**
 * Create a full event context
 */
export function createEventContext(
  sender: string,
  options?: {
    causationId?: string;
    correlationId?: string;
    previousPath?: string[];
    additionalContext?: Record<string, any>;
  }
): EventContext {
  const causal = createCausalContext(
    sender,
    options?.causationId,
    options?.correlationId,
    options?.previousPath
  );

  return {
    causal,
    ...options?.additionalContext
  };
}

/**
 * Create a full Happen event
 */
export function createEvent<T = any>(
  type: string,
  payload: T,
  sender: string,
  options?: {
    causationId?: string;
    correlationId?: string;
    previousPath?: string[];
  }
): HappenEvent<T> {
  return {
    type,
    payload,
    context: createEventContext(sender, options)
  };
}

/**
 * Create a derived event (caused by another event)
 * Maintains the causal chain
 */
export function createDerivedEvent<T = any>(
  type: string,
  payload: T,
  sender: string,
  parentEvent: HappenEvent
): HappenEvent<T> {
  return createEvent(type, payload, sender, {
    causationId: parentEvent.context.causal.id,
    correlationId: parentEvent.context.causal.correlationId,
    previousPath: parentEvent.context.causal.path
  });
}

/**
 * Build an event from broadcast options
 */
export function buildEventFromOptions(
  options: BroadcastOptions,
  sender: string,
  previousPath?: string[]
): HappenEvent {
  return {
    type: options.type,
    payload: options.payload || {},
    context: createEventContext(sender, {
      causationId: options.causationId,
      correlationId: options.correlationId,
      previousPath
    })
  };
}

/**
 * Validate that an event has proper causal context
 */
export function validateCausalContext(event: HappenEvent): boolean {
  const { causal } = event.context;

  // Must have an ID
  if (!causal.id) return false;

  // Must have a sender
  if (!causal.sender) return false;

  // Must have a correlation ID
  if (!causal.correlationId) return false;

  // Must have a path
  if (!Array.isArray(causal.path)) return false;

  // Path must include the sender
  if (!causal.path.includes(causal.sender)) return false;

  // Must have a timestamp
  if (!causal.timestamp || typeof causal.timestamp !== 'number') return false;

  return true;
}

/**
 * Extract causal information for debugging/logging
 */
export function getCausalInfo(event: HappenEvent): {
  id: string;
  sender: string;
  causedBy?: string;
  transaction: string;
  path: string;
  age: number;
} {
  const { causal } = event.context;
  return {
    id: causal.id,
    sender: causal.sender,
    causedBy: causal.causationId,
    transaction: causal.correlationId!,
    path: causal.path.join(' → '),
    age: Date.now() - causal.timestamp
  };
}
