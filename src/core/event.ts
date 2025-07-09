/// <reference path="../types/browser.d.ts" />

/**
 * Represents the detailed contextual information associated with a user interaction.
 */
export interface UserContext {
  userId?: string;
  roles?: string[];
  permissions?: string[];
  attributes?: { [key: string]: any };
  sessionId?: string;
  authMethod?: string; // e.g., 'password', 'oauth', 'federated'
  authTime?: number; // Unix timestamp
  claims?: { [key: string]: any }; // For JWT or other claim-based identity
  location?: string; // Geographic location
  ipAddress?: string;
  userAgent?: string;
  [key: string]: any; // Allow arbitrary extension
}

/**
 * Represents the contextual information associated with the system/runtime environment.
 */
export interface SystemContext {
  environment?: 'development' | 'staging' | 'production' | string;
  version?: string; // Application/service version
  tenant?: string; // For multi-tenant systems
  region?: string;
  traceId?: string; // For distributed tracing
  host?: string; // Server hostname/identifier
  [key: string]: any; // Allow arbitrary extension
}

/**
 * Optional context for delegated actions or impersonation.
 */
export interface DelegationContext {
    originalUser?: UserContext; // Who initiated the original request
    delegatedUser?: UserContext; // User being acted upon/as (if different)
    delegationReason?: string;
    delegationTime?: number;
    delegationExpiry?: number;
    delegatedPermissions?: string[]; // Scoped permissions for this action
    [key: string]: any;
}

/**
 * Represents the overall context associated with an event.
 */
export interface EventContext {
  userContext?: UserContext;
  systemContext?: SystemContext;
  delegationContext?: DelegationContext;
  [key: string]: any; // Allow for other types of context
}

/**
 * Represents the metadata associated with a Happen event.
 */
export interface HappenEventMetadata {
  /** Unique identifier for this specific event instance. */
  id: string;
  /** Unix timestamp (milliseconds) of when the event was created. */
  timestamp: number;
  /** Identifier of the node that originally created this event. */
  sender: string;
  /** Sequence of node identifiers the event has passed through (optional, depends on routing). */
  path?: string[];
  /** ID of the event that directly caused this event (if any). */
  causationId?: string;
  /** ID to correlate related events across different nodes/processes. */
  correlationId?: string;
  /** Additional contextual information (user, system, etc.). */
  context?: EventContext;

  // --- Security Fields ---
  /** A unique value (e.g., timestamp + random bytes) to prevent replay attacks. */
  nonce: string;
  /** Hash of the sender node's state when the event was created. Used for verification. */
  senderStateHash: string;
  /** Cryptographic hash binding event data, nonce, timestamp, sender, and sender's state. */
  verification: string;
  /** Optional cryptographic signature of the verification hash (or event data) using sender's key. */
  signature?: string;
  /** Optional public key of the sender (JWK format), included if signed. */
  publicKey?: JsonWebKey;
}

/**
 * Represents a generic Happen event.
 * @template TPayload The type of the payload data.
 */
export interface HappenEvent<TPayload = any> {
  /** The type identifier for the event (e.g., 'user-created', 'order-submitted'). */
  type: string;
  /** The domain-specific data associated with the event. */
  payload: TPayload;
  /** Metadata about the event (timestamp, sender, causality, security, context, etc.). */
  metadata: HappenEventMetadata;
} 