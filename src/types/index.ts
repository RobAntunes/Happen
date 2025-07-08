/**
 * Core type definitions for the Happen framework
 */

/**
 * Unique identifier for nodes and events
 */
export type ID = string;

/**
 * Event payload can be any JSON-serializable data
 */
export type EventPayload = unknown;

/**
 * Origin context tracks where an event came from
 */
export interface OriginContext {
  nodeId: ID;
  sourceId?: string;
  sourceType?: string;
}

/**
 * Event context provides metadata about an event
 */
export interface EventContext {
  causality?: ID;
  origin: OriginContext;
  timestamp: number;
  correlationId?: string;
  version?: number;
}

/**
 * Core event structure
 */
export interface HappenEvent<T = EventPayload> {
  id: ID;
  type: string;
  payload: T;
  context: EventContext;
}

/**
 * Pattern matching function
 */
export type PatternFunction = (type: string, event?: HappenEvent) => boolean;

/**
 * Pattern can be a string or a function
 */
export type Pattern = string | PatternFunction;

/**
 * Event handler return types for flow control
 */
export type EventHandlerResult<T = EventPayload> = 
  | void 
  | EventHandler<T>
  | Promise<void | EventHandler<T>>;

/**
 * Event handler function
 */
export type EventHandler<T = EventPayload> = (
  event: HappenEvent<T>
) => EventHandlerResult<T>;

/**
 * Node state container
 */
export interface NodeState<T = any> {
  get(): T;
  get<R>(selector: (state: T) => R): R;
  set(updater: (state: T) => T): void;
  set(updater: (state: T, views?: ViewCollection) => T): void;
  when(eventId: ID, callback: (state: T) => void): void;
}

/**
 * View collection for cross-node state access
 */
export interface ViewCollection {
  [key: string]: {
    get<T, R>(selector: (state: T) => R): R;
  };
}

/**
 * Global state interface (backed by NATS KV)
 */
export interface GlobalState {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  watch<T>(key: string, callback: (value: T | undefined) => void): () => void;
}

/**
 * Node configuration options
 */
export interface NodeOptions<T = any> {
  state?: T;
  accept?: (origin: OriginContext) => boolean;
  concurrency?: number;
  timeout?: number;
}

/**
 * Core node interface
 */
export interface HappenNode<T = any> {
  readonly id: ID;
  readonly state: NodeState<T>;
  readonly global: GlobalState;
  
  on(pattern: Pattern, handler: EventHandler): () => void;
  send(target: HappenNode | ID, event: Partial<HappenEvent>): Promise<void>;
  broadcast(event: Partial<HappenEvent>): Promise<void>;
  emit(event: Partial<HappenEvent>): void;
  
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Transport adapter interface for different environments
 */
export interface TransportAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publish(subject: string, data: Uint8Array): Promise<void>;
  subscribe(subject: string, handler: (data: Uint8Array) => void): () => void;
  request(subject: string, data: Uint8Array, timeout?: number): Promise<Uint8Array>;
  getState(): any;
}

/**
 * Happen instance configuration
 */
export interface HappenConfig {
  servers?: string | string[];
  name?: string;
  user?: string;
  pass?: string;
  token?: string;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  timeout?: number;
  enableJetStream?: boolean;
}

/**
 * Main Happen instance interface
 */
export interface Happen {
  node<T = any>(id: string, options?: NodeOptions<T>): HappenNode<T>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getTransport(): TransportAdapter | null;
  getJetStream(): any;
  isConnected(): boolean;
}