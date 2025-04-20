// src/core/hook-types.ts

import type { HappenEvent } from './event';
import type { HappenNode } from './node';

/**
 * Context passed to hook functions, providing information about the event's
 * position in the system (sender, potential receiver).
 */
export interface HookContext {
  sender?: HappenNode;
  receiver?: HappenNode;
  [key: string]: any; // Allow for additional context injection
}

/**
 * Type signature for a lifecycle hook function.
 * Hooks can potentially modify the event (in preSend/preReceive) or the result (in postProcess).
 * They can be synchronous or asynchronous.
 * @template TResult The type of the result expected from the main handler (for postProcess).
 */
export type HookFunction<TResult = any> = (
  event: HappenEvent,
  context: HookContext,
  handlerResult?: TResult
) => HappenEvent | Promise<HappenEvent> | void | Promise<void> | TResult | Promise<TResult>;

/**
 * Defines the structure for a set of hooks applicable to an event type or globally.
 */
export interface EventHooks {
  preSend?: HookFunction;
  preReceive?: HookFunction;
  postProcess?: HookFunction<any>; // Result type is handler-dependent
} 