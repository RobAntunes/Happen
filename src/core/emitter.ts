import { HappenEvent } from './event';

// Define a type for the listener function
export type HappenListener<P = any> = (event: HappenEvent<P>) => void | Promise<void>;

// Define a type for the event observer function
export type EventObserver = (event: HappenEvent<any>) => void | Promise<void>;

// Type for the disposable object returned by `on` methods that support it
export interface IHappenListenerDisposable {
  dispose: () => void | Promise<void>;
}

// Options for creating an emitter
export interface EmitterOptions {
  nodeId: string;
  // Add other common options here if needed
}

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
  emit(eventType: string, event: HappenEvent<any>): void | Promise<void>;

  /**
   * Registers a listener for events.
   * How event types/patterns are handled depends on the specific implementation
   * and how the HappenNode uses this registration.
   *
   * @param eventName The event name or pattern to listen for (interpretation depends on implementation).
   * @param listener The function to call when the event occurs.
   * @returns A disposable object or void, depending on the implementation.
   */
  on(eventName: string, listener: HappenListener<any>): void | IHappenListenerDisposable | Promise<void | IHappenListenerDisposable>;

  /**
   * Removes a listener. (Optional for implementations where `on` returns a disposable).
   * @param eventName The event name or pattern.
   * @param listener The listener function to remove.
   */
  off?(eventName: string, listener: HappenListener<any>): void | Promise<void>;

  /**
   * Sends a request and expects a response. (Optional)
   * @param eventType The event type for the request.
   * @param event The event object containing the request payload.
   * @param timeoutMs Timeout in milliseconds to wait for a response.
   * @returns A promise resolving with the response event or rejecting on timeout/error.
   */
  request?<Req = any, Res = any>(eventType: string, event: HappenEvent<Req>, timeoutMs?: number): Promise<HappenEvent<Res>>;


  /**
   * Registers a passive observer that receives all events flowing through this emitter.
   * Observers typically do not throw errors that affect the main flow and are used
   * for logging, tracing, debugging, etc.
   *
   * @param observer The observer function to register.
   * @returns A dispose function to remove the observer.
   */
  addObserver(observer: EventObserver): () => void | Promise<() => void>;

  /**
   * Optional method to clean up resources used by the emitter.
   */
  destroy?(): void | Promise<void>;
}
