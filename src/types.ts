/**
 * Core types for the Happen framework
 */

/**
 * Causal information embedded in every event
 */
export interface CausalContext {
  /** Unique identifier for this event */
  id: string;
  /** Node that created this event */
  sender: string;
  /** Event that directly caused this one */
  causationId?: string;
  /** Transaction/process identifier grouping related events */
  correlationId?: string;
  /** Journey the event has taken through the system */
  path: string[];
  /** Timestamp when the event was created */
  timestamp: number;
  /** Hash of the event payload schema/structure */
  hash?: string;
}

/**
 * Origin information for an event
 */
export interface OriginContext {
  /** Source identifier (e.g., "user-role:customer", "service:auth") */
  sourceId: string;
  /** Optional additional origin metadata */
  [key: string]: any;
}

/**
 * Context passed through the Event Continuum
 * Functions in the flow can store and retrieve data here
 */
export interface EventContext {
  /** Causal information about the event */
  causal: CausalContext;
  /** Origin information (Who created this event?) */
  origin?: OriginContext;
  /** Integrity information for signature verification */
  integrity?: IntegrityContext;
  /** User-defined context data shared between functions */
  [key: string]: any;
}

/**
 * Core event structure
 */
export interface HappenEvent<T = any> {
  /** Event type identifier */
  type: string;
  /** Domain-specific event data */
  payload: T;
  /** Causal and system context */
  context: EventContext;
}

/**
 * Pattern matcher function that determines if an event should be handled
 */
export type PatternMatcher = (eventType: string) => boolean;

/**
 * String pattern supporting wildcards
 */
export type StringPattern = string;

/**
 * Pattern can be a string or a function
 */
export type EventPattern = StringPattern | PatternMatcher;

/**
 * Event handler function signature
 * Returns either the next function to execute or a final result value
 */
export type EventHandler<T = any, R = any> = (
  event: HappenEvent<T>,
  context: EventContext
) => R | EventHandler<T, R> | Promise<R | EventHandler<T, R>>;

/**
 * State transformer function for getting state
 */
export type StateGetter<S = any, R = any> = (state: S) => R;

/**
 * State transformer function for setting state
 */
export type StateSetter<S = any> = (state: S, views?: any) => S | Promise<S>;

/**
 * Node state interface
 */
export interface NodeState<S = any> {
  /** Get the current state, optionally transformed */
  get<R = S>(transformer?: StateGetter<S, R>): Promise<R>;
  /** Set the state using a transformer function (with optional views parameter) */
  set(transformer: StateSetter<S>): Promise<void>;
}

/**
 * Security policy for an event type
 */
export interface EventSecurityPolicy {
  /** The cryptographic hash of the allowed payload schema */
  schemaHash: string;
  /** Allowed roles/sources for this event */
  allowedRoles: string[];
  /** Optional custom authorization check */
  customAuth?: (context: EventContext) => boolean | Promise<boolean>;
}

/**
 * Security policies map for a node
 */
export interface SecurityPolicies {
  [eventType: string]: EventSecurityPolicy;
}

/**
 * Integrity context for signature verification
 */
export interface IntegrityContext {
  /** Cryptographic signature of the event */
  signature?: string;
  /** Public key or key identifier */
  publicKey?: string;
}

/**
 * Configuration for creating a node
 */
export interface NodeConfig {
  /** Enable state persistence for this node */
  persistent?: boolean;
  /** Security policies for event types (enables automatic security gates) */
  policies?: SecurityPolicies;
  /** Custom configuration options */
  [key: string]: any;
}

/**
 * Configuration for initializing Happen
 */
export interface HappenConfig {
  /** NATS server URL(s) */
  servers?: string | string[];
  /** Enable debug logging */
  debug?: boolean;
  /** Flow-balance monitoring configuration */
  flowBalance?: {
    enabled?: boolean;
    checkInterval?: number;
    warningThreshold?: number;
    criticalThreshold?: number;
  };
  /** Custom configuration options */
  [key: string]: any;
}

/**
 * Event broadcast options
 */
export interface BroadcastOptions {
  /** Event type */
  type: string;
  /** Event payload */
  payload?: any;
  /** Optional causation ID (event that caused this) */
  causationId?: string;
  /** Optional correlation ID (transaction/process ID) */
  correlationId?: string;
}
