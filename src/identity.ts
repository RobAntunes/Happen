/**
 * Identity - Foundation for authentication and authorization
 *
 * Every node has identity that's automatically included in causal context.
 * Provides building blocks for custom identity models without imposing
 * specific authentication mechanisms.
 */

import type { CausalContext, EventContext } from './types.js';

/**
 * Identity information for a node or event
 */
export interface Identity {
  /** Node identifier */
  nodeId: string;
  /** Optional user/service identifier that originated this action */
  userId?: string;
  /** Optional service identifier */
  serviceId?: string;
  /** Optional tenant/organization identifier for multi-tenancy */
  tenantId?: string;
  /** Custom identity attributes */
  attributes?: { [key: string]: any };
}

/**
 * Identity provider interface for custom identity models
 */
export interface IdentityProvider {
  /**
   * Verify identity from event context
   */
  verify(context: EventContext): Promise<Identity | null>;

  /**
   * Enrich event context with identity information
   */
  enrich(context: EventContext, identity: Identity): EventContext;

  /**
   * Extract identity from causal context
   */
  extract(causal: CausalContext): Identity;
}

/**
 * Default identity provider using node sender
 */
export class DefaultIdentityProvider implements IdentityProvider {
  async verify(context: EventContext): Promise<Identity | null> {
    return {
      nodeId: context.causal.sender
    };
  }

  enrich(context: EventContext, identity: Identity): EventContext {
    return {
      ...context,
      identity
    };
  }

  extract(causal: CausalContext): Identity {
    return {
      nodeId: causal.sender
    };
  }
}

/**
 * Service-based identity provider
 * Tracks which service and user initiated the action
 */
export class ServiceIdentityProvider implements IdentityProvider {
  private serviceId: string;
  private serviceMap: Map<string, string>; // nodeId -> serviceId

  constructor(serviceId: string) {
    this.serviceId = serviceId;
    this.serviceMap = new Map();
  }

  /**
   * Register a node as belonging to this service
   */
  registerNode(nodeId: string): void {
    this.serviceMap.set(nodeId, this.serviceId);
  }

  async verify(context: EventContext): Promise<Identity | null> {
    const nodeId = context.causal.sender;
    const serviceId = this.serviceMap.get(nodeId);

    if (!serviceId) {
      return null; // Unknown service
    }

    return {
      nodeId,
      serviceId,
      userId: (context as any).userId,
      attributes: (context as any).identityAttributes
    };
  }

  enrich(context: EventContext, identity: Identity): EventContext {
    return {
      ...context,
      identity,
      userId: identity.userId,
      serviceId: identity.serviceId,
      identityAttributes: identity.attributes
    };
  }

  extract(causal: CausalContext): Identity {
    const nodeId = causal.sender;
    const serviceId = this.serviceMap.get(nodeId) || 'unknown';

    return {
      nodeId,
      serviceId
    };
  }
}

/**
 * Multi-tenant identity provider
 */
export class MultiTenantIdentityProvider implements IdentityProvider {
  private tenantMap: Map<string, string>; // nodeId -> tenantId

  constructor() {
    this.tenantMap = new Map();
  }

  /**
   * Register a node as belonging to a tenant
   */
  registerNode(nodeId: string, tenantId: string): void {
    this.tenantMap.set(nodeId, tenantId);
  }

  async verify(context: EventContext): Promise<Identity | null> {
    const nodeId = context.causal.sender;
    const tenantId = this.tenantMap.get(nodeId) || (context as any).tenantId;

    if (!tenantId) {
      return null; // No tenant information
    }

    return {
      nodeId,
      tenantId,
      userId: (context as any).userId,
      serviceId: (context as any).serviceId,
      attributes: (context as any).identityAttributes
    };
  }

  enrich(context: EventContext, identity: Identity): EventContext {
    return {
      ...context,
      identity,
      tenantId: identity.tenantId,
      userId: identity.userId,
      serviceId: identity.serviceId,
      identityAttributes: identity.attributes
    };
  }

  extract(causal: CausalContext): Identity {
    const nodeId = causal.sender;
    const tenantId = this.tenantMap.get(nodeId);

    return {
      nodeId,
      tenantId
    };
  }
}

/**
 * Helper to extract identity from event context
 */
export function getIdentity(context: EventContext): Identity {
  // Check if identity is already embedded
  if ((context as any).identity) {
    return (context as any).identity;
  }

  // Fallback to node ID from causal context
  return {
    nodeId: context.causal.sender
  };
}

/**
 * Helper to check if identity matches criteria
 */
export function matchesIdentity(
  identity: Identity,
  criteria: Partial<Identity>
): boolean {
  if (criteria.nodeId && identity.nodeId !== criteria.nodeId) {
    return false;
  }

  if (criteria.userId && identity.userId !== criteria.userId) {
    return false;
  }

  if (criteria.serviceId && identity.serviceId !== criteria.serviceId) {
    return false;
  }

  if (criteria.tenantId && identity.tenantId !== criteria.tenantId) {
    return false;
  }

  // Check custom attributes
  if (criteria.attributes) {
    for (const [key, value] of Object.entries(criteria.attributes)) {
      if (identity.attributes?.[key] !== value) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Create an identity-aware event handler wrapper
 * Automatically extracts and verifies identity before invoking handler
 */
export function withIdentity<T = any, R = any>(
  handler: (event: any, context: EventContext, identity: Identity) => R | Promise<R>,
  provider?: IdentityProvider
): (event: any, context: EventContext) => Promise<R> {
  const identityProvider = provider || new DefaultIdentityProvider();

  return async (event: any, context: EventContext) => {
    const identity = await identityProvider.verify(context);

    if (!identity) {
      throw new Error('Identity verification failed');
    }

    return await handler(event, context, identity);
  };
}

/**
 * Create an identity filter handler wrapper
 * Only invokes handler if identity matches criteria
 */
export function filterByIdentity<T = any, R = any>(
  criteria: Partial<Identity>,
  handler: (event: any, context: EventContext) => R | Promise<R>
): (event: any, context: EventContext) => Promise<R | null> {
  return async (event: any, context: EventContext) => {
    const identity = getIdentity(context);

    if (!matchesIdentity(identity, criteria)) {
      return null; // Identity doesn't match, skip handler
    }

    return await handler(event, context);
  };
}
