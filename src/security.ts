/**
 * Security - Building blocks for implementing security models
 *
 * Provides minimal essential tools for building custom security models
 * using causal relationships and identity as foundation.
 */

import type { EventContext, EventHandler, HappenEvent } from './types.js';
import type { Identity } from './identity.js';
import { getIdentity, matchesIdentity } from './identity.js';
import { createHash } from 'crypto';

/**
 * Security policy interface
 */
export interface SecurityPolicy {
  /**
   * Check if an action is allowed
   */
  authorize(
    action: string,
    identity: Identity,
    context: EventContext
  ): Promise<boolean> | boolean;
}

/**
 * Role-based access control policy
 */
export class RBACPolicy implements SecurityPolicy {
  private rolePermissions: Map<string, Set<string>> = new Map();
  private userRoles: Map<string, Set<string>> = new Map();

  /**
   * Grant permission to a role
   */
  grantPermission(role: string, permission: string): void {
    if (!this.rolePermissions.has(role)) {
      this.rolePermissions.set(role, new Set());
    }
    this.rolePermissions.get(role)!.add(permission);
  }

  /**
   * Assign role to user
   */
  assignRole(userId: string, role: string): void {
    if (!this.userRoles.has(userId)) {
      this.userRoles.set(userId, new Set());
    }
    this.userRoles.get(userId)!.add(role);
  }

  /**
   * Check if user has permission
   */
  authorize(action: string, identity: Identity): boolean {
    if (!identity.userId) {
      return false;
    }

    const roles = this.userRoles.get(identity.userId);
    if (!roles) {
      return false;
    }

    // Check if any of the user's roles have the required permission
    for (const role of roles) {
      const permissions = this.rolePermissions.get(role);
      if (permissions && permissions.has(action)) {
        return true;
      }
    }

    return false;
  }
}

/**
 * Attribute-based access control policy
 */
export class ABACPolicy implements SecurityPolicy {
  private rules: ABACRule[] = [];

  /**
   * Add an ABAC rule
   */
  addRule(rule: ABACRule): void {
    this.rules.push(rule);
  }

  /**
   * Authorize based on attributes
   */
  async authorize(
    action: string,
    identity: Identity,
    context: EventContext
  ): Promise<boolean> {
    // Check all rules
    for (const rule of this.rules) {
      if (await rule.matches(action, identity, context)) {
        return rule.allow;
      }
    }

    // Default deny
    return false;
  }
}

/**
 * ABAC rule interface
 */
export interface ABACRule {
  /** Whether this rule allows or denies */
  allow: boolean;

  /**
   * Check if rule matches the request
   */
  matches(
    action: string,
    identity: Identity,
    context: EventContext
  ): Promise<boolean> | boolean;
}

/**
 * Create a simple ABAC rule
 */
export function createRule(
  allow: boolean,
  matcher: (action: string, identity: Identity, context: EventContext) => boolean
): ABACRule {
  return {
    allow,
    matches: matcher
  };
}

/**
 * Causal security verifier
 * Uses causal chain to verify event legitimacy
 */
export class CausalSecurityVerifier {
  private trustedSenders: Set<string> = new Set();

  /**
   * Register a trusted sender
   */
  addTrustedSender(nodeId: string): void {
    this.trustedSenders.add(nodeId);
  }

  /**
   * Verify that event came from trusted source
   */
  verifySource(context: EventContext): boolean {
    return this.trustedSenders.has(context.causal.sender);
  }

  /**
   * Verify causal chain integrity
   * Ensures event is part of legitimate causal chain
   */
  verifyCausalChain(context: EventContext, expectedCorrelationId?: string): boolean {
    // Check correlation ID if provided
    if (expectedCorrelationId && context.causal.correlationId !== expectedCorrelationId) {
      return false;
    }

    // Check sender is in path
    if (!context.causal.path.includes(context.causal.sender)) {
      return false;
    }

    // If there's a causation ID, verify it's earlier in the path
    if (context.causal.causationId) {
      // This would need access to previous events to fully verify
      // For now, just check that causation ID exists
      return true;
    }

    return true;
  }

  /**
   * Verify event hasn't been tampered with
   */
  verifyIntegrity(context: EventContext): boolean {
    // Check required fields exist
    if (!context.causal.id || !context.causal.sender || !context.causal.correlationId) {
      return false;
    }

    // Check timestamp is reasonable (not in future, not too old)
    const now = Date.now();
    const age = now - context.causal.timestamp;

    // Reject events from the future
    if (age < -60000) { // 1 minute tolerance
      return false;
    }

    // Reject events older than 1 hour (configurable)
    if (age > 3600000) {
      return false;
    }

    return true;
  }
}

/**
 * Security middleware - wraps handler with security checks
 */
export function withSecurity(
  policy: SecurityPolicy,
  action: string,
  handler: EventHandler
): EventHandler {
  return async (event: any, context: EventContext) => {
    const identity = getIdentity(context);

    // Check authorization
    const authorized = await policy.authorize(action, identity, context);

    if (!authorized) {
      throw new Error(`Unauthorized: ${action} denied for ${identity.nodeId}`);
    }

    // If authorized, invoke handler
    return handler(event, context);
  };
}

/**
 * Require specific identity for handler
 */
export function requireIdentity(
  criteria: Partial<Identity>,
  handler: EventHandler
): EventHandler {
  return async (event: any, context: EventContext) => {
    const identity = getIdentity(context);

    if (!matchesIdentity(identity, criteria)) {
      throw new Error(`Identity mismatch: required ${JSON.stringify(criteria)}`);
    }

    return handler(event, context);
  };
}

/**
 * Require trusted source
 */
export function requireTrustedSource(
  verifier: CausalSecurityVerifier,
  handler: EventHandler
): EventHandler {
  return async (event: any, context: EventContext) => {
    if (!verifier.verifySource(context)) {
      throw new Error(`Untrusted source: ${context.causal.sender}`);
    }

    if (!verifier.verifyIntegrity(context)) {
      throw new Error('Event integrity verification failed');
    }

    return handler(event, context);
  };
}

/**
 * Combine multiple security checks
 */
export function combineSecurityChecks(
  ...checks: ((context: EventContext) => boolean | Promise<boolean>)[]
): (context: EventContext) => Promise<boolean> {
  return async (context: EventContext) => {
    for (const check of checks) {
      const result = await check(context);
      if (!result) {
        return false;
      }
    }
    return true;
  };
}

/**
 * Security audit logger
 */
export class SecurityAuditLogger {
  private logs: SecurityAuditEntry[] = [];

  /**
   * Log security event
   */
  log(entry: SecurityAuditEntry): void {
    this.logs.push({
      ...entry,
      timestamp: Date.now()
    });
  }

  /**
   * Log authorization attempt
   */
  logAuthorization(
    action: string,
    identity: Identity,
    allowed: boolean,
    context?: EventContext
  ): void {
    this.log({
      type: 'authorization',
      action,
      identity,
      allowed,
      context,
      timestamp: Date.now()
    });
  }

  /**
   * Log security violation
   */
  logViolation(
    reason: string,
    identity: Identity,
    context?: EventContext
  ): void {
    this.log({
      type: 'violation',
      reason,
      identity,
      allowed: false,
      context,
      timestamp: Date.now()
    });
  }

  /**
   * Get audit logs
   */
  getLogs(filter?: (entry: SecurityAuditEntry) => boolean): SecurityAuditEntry[] {
    return filter ? this.logs.filter(filter) : [...this.logs];
  }

  /**
   * Get violations
   */
  getViolations(): SecurityAuditEntry[] {
    return this.logs.filter(log => log.type === 'violation' || !log.allowed);
  }
}

/**
 * Security audit entry
 */
export interface SecurityAuditEntry {
  type: 'authorization' | 'violation' | 'custom';
  action?: string;
  reason?: string;
  identity: Identity;
  allowed: boolean;
  context?: EventContext;
  timestamp: number;
}

/**
 * Create security-aware event handler with auditing
 */
export function withSecurityAudit(
  policy: SecurityPolicy,
  action: string,
  handler: EventHandler,
  auditLogger: SecurityAuditLogger
): EventHandler {
  return async (event: any, context: EventContext) => {
    const identity = getIdentity(context);

    // Check authorization
    const authorized = await policy.authorize(action, identity, context);

    // Log authorization attempt
    auditLogger.logAuthorization(action, identity, authorized, context);

    if (!authorized) {
      auditLogger.logViolation(`Unauthorized ${action}`, identity, context);
      throw new Error(`Unauthorized: ${action} denied for ${identity.nodeId}`);
    }

    // If authorized, invoke handler
    return handler(event, context);
  };
}

/**
 * Compute a deterministic hash of an event payload structure
 * This creates a cryptographic fingerprint of the event's schema
 */
export function computePayloadHash(payload: any): string {
  // Create a canonical JSON representation (sorted keys)
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify cryptographic signature of an event
 * This is a placeholder - in production, use a proper crypto library
 * like @noble/ed25519 or similar
 */
export function verifySignature(
  hash: string,
  signature: string,
  publicKey: string
): boolean {
  // TODO: Implement actual signature verification
  // For now, this is a placeholder that should be replaced with
  // real cryptographic verification using ed25519 or similar
  //
  // Example with @noble/ed25519:
  // import * as ed from '@noble/ed25519';
  // const message = Buffer.from(hash, 'hex');
  // const sig = Buffer.from(signature, 'hex');
  // const pub = Buffer.from(publicKey, 'hex');
  // return ed.verify(sig, message, pub);
  
  console.warn('[Happen Security] verifySignature is not yet implemented - add crypto library');
  return true; // UNSAFE: Replace with real implementation
}

/**
 * Create security gates for automatic prepending
 * These are the three gates: AuthN (Who?), Interface (How?), AuthZ (What?)
 */
export interface SecurityGates {
  /** Gate 1: Verify cryptographic signature (Authentication) */
  verifySignature: EventHandler;
  /** Gate 2: Verify schema hash (Interface Control) */
  verifySchema: EventHandler;
  /** Gate 3: Verify authorization (Authorization) */
  verifyAuthorization: EventHandler;
}

/**
 * Create the three security gates for an event type
 */
export function createSecurityGates(
  eventType: string,
  schemaHash: string,
  allowedRoles: string[],
  customAuth?: (context: EventContext) => boolean | Promise<boolean>
): SecurityGates {
  // Gate 1: Verify Signature (AuthN)
  const verifySignatureGate: EventHandler = (event: HappenEvent, context: EventContext) => {
    const { hash, sender } = context.causal;
    const { signature, publicKey } = context.integrity || {};
    
    // If no signature/key, allow (for development)
    // In production, you'd enforce this strictly
    if (!signature || !publicKey) {
      console.warn('[Happen Security] No signature found - allowing in dev mode');
      return verifySchemaGate; // Continue to next gate
    }
    
    if (!hash) {
      throw new Error('Security: Event missing hash in causal context');
    }
    
    if (!verifySignature(hash, signature, publicKey)) {
      throw new Error(`Security: Invalid signature for event ${eventType}`);
    }
    
    // Signature valid, continue to next gate
    return verifySchemaGate;
  };
  
  // Gate 2: Verify Schema (The "How")
  const verifySchemaGate: EventHandler = (event: HappenEvent, context: EventContext) => {
    const { hash } = context.causal;
    
    if (!hash) {
      throw new Error('Security: Event missing hash in causal context');
    }
    
    if (hash !== schemaHash) {
      throw new Error(
        `Security: Schema hash mismatch for ${eventType}. ` +
        `Expected ${schemaHash}, got ${hash}`
      );
    }
    
    // Schema valid, continue to authorization
    return verifyAuthorizationGate;
  };
  
  // Gate 3: Verify Authorization (The "What")
  const verifyAuthorizationGate: EventHandler = async (event: HappenEvent, context: EventContext) => {
    const { sourceId } = context.origin || {};
    
    if (!sourceId) {
      throw new Error(`Security: Event ${eventType} missing origin.sourceId`);
    }
    
    // Check if source is in allowed roles
    if (!allowedRoles.includes(sourceId)) {
      throw new Error(
        `Security: Unauthorized role for ${eventType}. ` +
        `Source "${sourceId}" not in allowed roles: ${allowedRoles.join(', ')}`
      );
    }
    
    // If custom authorization check exists, run it
    if (customAuth) {
      const customResult = await customAuth(context);
      if (!customResult) {
        throw new Error(`Security: Custom authorization failed for ${eventType}`);
      }
    }
    
    // All gates passed - return null to continue to business logic
    // The actual business handler will be appended by the framework
    return null;
  };
  
  return {
    verifySignature: verifySignatureGate,
    verifySchema: verifySchemaGate,
    verifyAuthorization: verifyAuthorizationGate
  };
}
