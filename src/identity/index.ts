/**
 * Identity system for Happen
 * Provides minimal cryptographic node identity and origin context tracking
 * Applications build their own identity models on top of these primitives
 */

import { ID } from '../types';
import { generateId } from '../utils/id';

/**
 * Cryptographic key pair for node identity
 */
export interface KeyPair {
  publicKey: string;
  privateKey: string;
  algorithm: string;
}

/**
 * Node identity with cryptographic credentials
 */
export interface NodeIdentity {
  nodeId: ID;
  publicKey: string;
  algorithm: string;
  certificate?: string;
  createdAt: number;
  expiresAt?: number;
}


/**
 * Permission definition
 */
export interface Permission {
  action: string;
  resource: string;
  conditions?: Record<string, any>;
}

/**
 * Access control entry
 */
export interface AccessControlEntry {
  principal: string; // nodeId, user:id, role:name, etc.
  permissions: Permission[];
  deny?: boolean;
  priority: number;
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id: ID;
  timestamp: number;
  action: string;
  principal: string;
  resource: string;
  success: boolean;
  origin: { nodeId: string };
  metadata?: Record<string, any>;
}

/**
 * Identity provider interface - minimal cryptographic identity for nodes
 */
export interface IdentityProvider {
  generateKeyPair(): Promise<KeyPair>;
  createIdentity(nodeId: ID, keyPair: KeyPair): Promise<NodeIdentity>;
  signData(data: Uint8Array, privateKey: string): Promise<string>;
  verifySignature(data: Uint8Array, signature: string, publicKey: string): Promise<boolean>;
  getIdentity(nodeId: ID): NodeIdentity | undefined;
}

/**
 * Access control manager - basic permission checking
 * Applications can build more sophisticated authorization on top
 */
export interface AccessControlManager {
  addRule(rule: AccessControlEntry): void;
  removeRule(principal: string, action: string, resource: string): void;
  checkPermission(principal: string, action: string, resource: string, context?: any): boolean;
  listPermissions(principal: string): Permission[];
  audit(action: string, principal: string, resource: string, success: boolean, origin: { nodeId: string }, metadata?: any): void;
  getAuditLog(filter?: Partial<AuditLogEntry>): AuditLogEntry[];
}

/**
 * Node.js crypto-based identity provider
 */
export class CryptoIdentityProvider implements IdentityProvider {
  private certificates = new Map<ID, NodeIdentity>();

  /**
   * Generate a new Ed25519 key pair (most secure modern curve)
   */
  async generateKeyPair(): Promise<KeyPair> {
    try {
      // Try to use Node.js crypto for better security
      const crypto = await import('crypto');
      
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      return { publicKey, privateKey, algorithm: 'Ed25519' };
    } catch (error) {
      // Fallback to simulated keys for environments without crypto
      console.warn('Crypto not available, using simulated keys for testing');
      return this.generateSimulatedKeyPair();
    }
  }

  /**
   * Generate simulated key pair for testing/browser environments
   */
  private generateSimulatedKeyPair(): KeyPair {
    const keyId = generateId('key');
    return {
      publicKey: `-----BEGIN PUBLIC KEY-----\nSimulated-Ed25519-Public-${keyId}\n-----END PUBLIC KEY-----`,
      privateKey: `-----BEGIN PRIVATE KEY-----\nSimulated-Ed25519-Private-${keyId}\n-----END PRIVATE KEY-----`,
      algorithm: 'Ed25519',
    };
  }

  /**
   * Create a node identity with key pair
   */
  async createIdentity(nodeId: ID, keyPair: KeyPair): Promise<NodeIdentity> {
    const identity: NodeIdentity = {
      nodeId,
      publicKey: keyPair.publicKey,
      algorithm: keyPair.algorithm,
      createdAt: Date.now(),
      expiresAt: Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year
    };

    // Create self-signed certificate (simplified)
    identity.certificate = await this.createSelfSignedCertificate(identity, keyPair.privateKey);
    
    this.certificates.set(nodeId, identity);
    return identity;
  }

  /**
   * Create a self-signed certificate
   */
  private async createSelfSignedCertificate(identity: NodeIdentity, privateKey: string): Promise<string> {
    // Simplified certificate format - in production, use proper X.509
    const certData = {
      subject: { CN: identity.nodeId },
      issuer: { CN: identity.nodeId },
      publicKey: identity.publicKey,
      algorithm: identity.algorithm,
      createdAt: identity.createdAt,
      expiresAt: identity.expiresAt,
    };

    const certString = JSON.stringify(certData);
    const signature = await this.signData(new TextEncoder().encode(certString), privateKey);
    
    return JSON.stringify({
      ...certData,
      signature,
    });
  }

  /**
   * Sign data with private key
   */
  async signData(data: Uint8Array, privateKey: string): Promise<string> {
    try {
      const crypto = await import('crypto');
      
      // Check if this is a simulated key
      if (privateKey.includes('Simulated')) {
        const dataStr = new TextDecoder().decode(data);
        const hash = this.simpleHash(dataStr + privateKey);
        return `sim-${hash}`;
      }
      
      // For Ed25519, we can sign directly without SHA256
      if (privateKey.includes('Ed25519') || privateKey.includes('BEGIN PRIVATE KEY')) {
        return crypto.sign(null, data, privateKey).toString('base64');
      }
      
      // Fallback to traditional signing for RSA
      const sign = crypto.createSign('SHA256');
      sign.update(data);
      return sign.sign(privateKey, 'base64');
    } catch (error) {
      // Fallback simulation
      const dataStr = new TextDecoder().decode(data);
      const hash = this.simpleHash(dataStr + privateKey);
      return `sim-${hash}`;
    }
  }

  /**
   * Verify signature with public key
   */
  async verifySignature(data: Uint8Array, signature: string, publicKey: string): Promise<boolean> {
    try {
      const crypto = await import('crypto');
      
      // Handle simulated signatures
      if (signature.startsWith('sim-')) {
        const dataStr = new TextDecoder().decode(data);
        const expectedHash = this.simpleHash(dataStr + publicKey.replace('Public', 'Private'));
        return signature === `sim-${expectedHash}`;
      }
      
      // For Ed25519, use direct verification
      if (publicKey.includes('Ed25519') || publicKey.includes('BEGIN PUBLIC KEY')) {
        return crypto.verify(null, data, publicKey, Buffer.from(signature, 'base64'));
      }
      
      // Fallback to traditional verification for RSA
      const verify = crypto.createVerify('SHA256');
      verify.update(data);
      return verify.verify(publicKey, signature, 'base64');
    } catch (error) {
      // Fallback simulation for any crypto errors
      if (signature.startsWith('sim-')) {
        const dataStr = new TextDecoder().decode(data);
        const expectedHash = this.simpleHash(dataStr + publicKey.replace('Public', 'Private'));
        return signature === `sim-${expectedHash}`;
      }
      return false;
    }
  }


  /**
   * Get stored identity
   */
  getIdentity(nodeId: ID): NodeIdentity | undefined {
    return this.certificates.get(nodeId);
  }

  /**
   * Simple hash function for fallback
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

/**
 * Memory-based access control manager
 */
export class MemoryAccessControlManager implements AccessControlManager {
  private rules: AccessControlEntry[] = [];
  private auditLog: AuditLogEntry[] = [];

  /**
   * Add access control rule
   */
  addRule(rule: AccessControlEntry): void {
    // Remove existing rule for same principal/action/resource
    const firstPermission = rule.permissions[0];
    if (firstPermission) {
      this.removeRule(rule.principal, firstPermission.action, firstPermission.resource);
    }
    
    // Add new rule in priority order
    const insertIndex = this.rules.findIndex(r => r.priority > rule.priority);
    if (insertIndex === -1) {
      this.rules.push(rule);
    } else {
      this.rules.splice(insertIndex, 0, rule);
    }
  }

  /**
   * Remove access control rule
   */
  removeRule(principal: string, action: string, resource: string): void {
    this.rules = this.rules.filter(rule =>
      !(rule.principal === principal && 
        rule.permissions.some(p => p.action === action && p.resource === resource))
    );
  }

  /**
   * Check if principal has permission for action on resource
   */
  checkPermission(principal: string, action: string, resource: string, context?: any): boolean {
    // Check rules in priority order
    for (const rule of this.rules) {
      if (this.matchesPrincipal(rule.principal, principal)) {
        for (const permission of rule.permissions) {
          if (this.matchesPermission(permission, action, resource, context)) {
            return !rule.deny; // If deny rule, return false; if allow rule, return true
          }
        }
      }
    }
    
    // Default deny
    return false;
  }

  /**
   * List all permissions for a principal
   */
  listPermissions(principal: string): Permission[] {
    const permissions: Permission[] = [];
    
    for (const rule of this.rules) {
      if (this.matchesPrincipal(rule.principal, principal) && !rule.deny) {
        permissions.push(...rule.permissions);
      }
    }
    
    return permissions;
  }

  /**
   * Add audit log entry
   */
  audit(action: string, principal: string, resource: string, success: boolean, origin: { nodeId: string }, metadata?: any): void {
    const entry: AuditLogEntry = {
      id: generateId('audit'),
      timestamp: Date.now(),
      action,
      principal,
      resource,
      success,
      origin,
      metadata,
    };
    
    this.auditLog.push(entry);
    
    // Keep only last 10000 entries to prevent memory issues
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-10000);
    }
  }

  /**
   * Get audit log entries with optional filtering
   */
  getAuditLog(filter?: Partial<AuditLogEntry>): AuditLogEntry[] {
    if (!filter) return [...this.auditLog];
    
    return this.auditLog.filter(entry => {
      for (const [key, value] of Object.entries(filter)) {
        if (key === 'origin') {
          // Special handling for origin context
          const originFilter = value as Partial<{ nodeId: string }>;
          for (const [oKey, oValue] of Object.entries(originFilter)) {
            if (entry.origin[oKey as keyof { nodeId: string }] !== oValue) {
              return false;
            }
          }
        } else if (entry[key as keyof AuditLogEntry] !== value) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Check if principal pattern matches actual principal
   */
  private matchesPrincipal(pattern: string, principal: string): boolean {
    if (pattern === principal) return true;
    if (pattern === '*') return true;
    
    // Support wildcard patterns like "user:*", "node-*", etc.
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(principal);
    }
    
    return false;
  }

  /**
   * Check if permission matches action/resource
   */
  private matchesPermission(permission: Permission, action: string, resource: string, context?: any): boolean {
    // Check action
    if (!this.matchesPattern(permission.action, action)) return false;
    
    // Check resource
    if (!this.matchesPattern(permission.resource, resource)) return false;
    
    // Check conditions if provided
    if (permission.conditions) {
      if (!context) return false; // No context provided but conditions required
      for (const [key, value] of Object.entries(permission.conditions)) {
        if (context[key] !== value) return false;
      }
    }
    
    return true;
  }

  /**
   * Check if pattern matches value (supports wildcards)
   */
  private matchesPattern(pattern: string, value: string): boolean {
    if (pattern === value) return true;
    if (pattern === '*') return true;
    
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(value);
    }
    
    return false;
  }

  /**
   * Get access control statistics
   */
  getStats(): {
    totalRules: number;
    totalAuditEntries: number;
    allowRules: number;
    denyRules: number;
  } {
    return {
      totalRules: this.rules.length,
      totalAuditEntries: this.auditLog.length,
      allowRules: this.rules.filter(r => !r.deny).length,
      denyRules: this.rules.filter(r => r.deny).length,
    };
  }
}


/**
 * Global identity and access control instances
 */
let globalIdentityProvider: IdentityProvider | null = null;
let globalAccessControl: AccessControlManager | null = null;

/**
 * Get global identity provider
 */
export function getGlobalIdentityProvider(): IdentityProvider {
  if (!globalIdentityProvider) {
    globalIdentityProvider = new CryptoIdentityProvider();
  }
  return globalIdentityProvider;
}

/**
 * Get global access control manager
 */
export function getGlobalAccessControl(): AccessControlManager {
  if (!globalAccessControl) {
    globalAccessControl = new MemoryAccessControlManager();
  }
  return globalAccessControl;
}

/**
 * Set global identity provider (for testing/customization)
 */
export function setGlobalIdentityProvider(provider: IdentityProvider): void {
  globalIdentityProvider = provider;
}

/**
 * Set global access control manager (for testing/customization)
 */
export function setGlobalAccessControl(manager: AccessControlManager): void {
  globalAccessControl = manager;
}