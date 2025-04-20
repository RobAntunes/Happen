import type { HappenEvent } from './event';

/** Function signature for an event handler/listener. */
export type HappenListener<T = any> = (event: HappenEvent<T>) => void | Promise<void>;

/** Function signature for an event observer. */
export type EventObserver = (event: HappenEvent<any>) => void | Promise<void>;

/** Use a symbol for the generic listener to avoid clashes with string event types */
export const GENERIC_EVENT_SIGNAL = Symbol.for('happenInternalGenericEvent');

/**
 * Defines the interface for the underlying event communication mechanism used by Happen nodes.
 * This could be implemented using Node.js EventEmitter, browser events, message queues, etc.
 */
export interface IHappenEmitter {
  /**
   * Emits an event onto the communication fabric.
   * @param eventType The specific type of the event being emitted.
   * @param event The full event object.
   */
  emit(eventType: string, event: HappenEvent<any>): void;

  /**
   * Registers a listener for events.
   * How event types/patterns are handled depends on the specific implementation
   * and how the HappenNode uses this registration.
   *
   * @param eventName The event name or pattern to listen for (interpretation depends on implementation).
   * @param listener The function to call when the event occurs.
   */
  on(eventName: string, listener: HappenListener<any>): void;

  /**
   * Removes a listener.
   * @param eventName The event name or pattern.
   * @param listener The listener function to remove.
   */
  off?(eventName: string, listener: HappenListener<any>): void;

  /**
   * Registers a passive observer that receives all events flowing through this emitter.
   * Observers typically do not throw errors that affect the main flow and are used
   * for logging, tracing, debugging, etc.
   *
   * @param observer The observer function to register.
   * @returns A dispose function to remove the observer.
   */
  addObserver(observer: EventObserver): () => void;
} 