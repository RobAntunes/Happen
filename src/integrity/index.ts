/**
 * Event Integrity System
 * Provides cryptographic integrity for events including hashing and signing
 */

import { HappenEvent, EventContext } from '../types';
import { canonicalStringify } from '../utils/canonicalStringify';
import { getGlobalIdentityProvider } from '../identity';

/**
 * Event integrity information
 */
export interface EventIntegrity {
  hash: string;           // SHA-256 hash of canonical event
  signature?: string;     // Digital signature of the hash
  publicKey?: string;     // Public key used for signing
  timestamp: number;      // When integrity was calculated
}

/**
 * Enhanced event with integrity information
 */
export interface SecureEvent<T = any> extends HappenEvent<T> {
  context: EventContext & {
    integrity?: EventIntegrity;
  };
}

/**
 * Event integrity manager
 */
export class EventIntegrityManager {
  private identityProvider = getGlobalIdentityProvider();
  
  /**
   * Calculate cryptographic hash of event
   */
  async calculateEventHash(event: HappenEvent): Promise<string> {
    // Create copy without integrity info to avoid circular hash
    const eventForHashing = {
      ...event,
      context: {
        ...event.context,
        integrity: undefined
      }
    };
    
    // Use canonical stringification for deterministic hashing
    const canonicalString = canonicalStringify(eventForHashing);
    
    return await this.calculateHash(canonicalString);
  }
  
  /**
   * Calculate hash of string data
   */
  async calculateHash(data: string): Promise<string> {
    try {
      // Try to use Node.js crypto for better security
      const crypto = await import('crypto');
      return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
    } catch (error) {
      // Fallback to Web Crypto API (browser)
      try {
        const encoder = new TextEncoder();
        const data_bytes = encoder.encode(data);
        const hash = await crypto.subtle.digest('SHA-256', data_bytes);
        return Array.from(new Uint8Array(hash))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      } catch (cryptoError) {
        // Final fallback to simple hash
        return this.simpleHash(data);
      }
    }
  }
  
  /**
   * Sign event with node's private key
   */
  async signEvent(event: HappenEvent, nodeId: string): Promise<SecureEvent> {
    // Calculate hash first
    const hash = await this.calculateEventHash(event);
    
    // Get node identity
    const identity = this.identityProvider.getIdentity(nodeId);
    if (!identity) {
      throw new Error(`No identity found for node: ${nodeId}`);
    }
    
    // Sign the hash
    const hashBytes = new TextEncoder().encode(hash);
    const signature = await this.identityProvider.signData(hashBytes, identity.certificate || '');
    
    // Create secure event with integrity information
    const secureEvent: SecureEvent = {
      ...event,
      context: {
        ...event.context,
        integrity: {
          hash,
          signature,
          publicKey: identity.publicKey,
          timestamp: Date.now()
        }
      }
    };
    
    return secureEvent;
  }
  
  /**
   * Verify event signature
   */
  async verifyEvent(event: SecureEvent): Promise<boolean> {
    const integrity = event.context.integrity;
    if (!integrity) {
      return false; // No integrity information
    }
    
    // Recalculate hash
    const calculatedHash = await this.calculateEventHash(event);
    
    // Check if hash matches
    if (calculatedHash !== integrity.hash) {
      return false; // Event has been tampered with
    }
    
    // Verify signature if present
    if (integrity.signature && integrity.publicKey) {
      const hashBytes = new TextEncoder().encode(integrity.hash);
      return await this.identityProvider.verifySignature(
        hashBytes,
        integrity.signature,
        integrity.publicKey
      );
    }
    
    return true; // Hash is valid, no signature to verify
  }
  
  /**
   * Create integrity information for an event
   */
  async createIntegrity(event: HappenEvent, nodeId?: string): Promise<EventIntegrity> {
    const hash = await this.calculateEventHash(event);
    
    const integrity: EventIntegrity = {
      hash,
      timestamp: Date.now()
    };
    
    // Add signature if node ID is provided
    if (nodeId) {
      const identity = this.identityProvider.getIdentity(nodeId);
      if (identity) {
        const hashBytes = new TextEncoder().encode(hash);
        integrity.signature = await this.identityProvider.signData(hashBytes, identity.certificate || '');
        integrity.publicKey = identity.publicKey;
      }
    }
    
    return integrity;
  }
  
  /**
   * Verify integrity of event chain
   */
  async verifyEventChain(events: SecureEvent[]): Promise<boolean> {
    for (const event of events) {
      const isValid = await this.verifyEvent(event);
      if (!isValid) {
        return false;
      }
    }
    return true;
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
    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}

/**
 * Global event integrity manager instance
 */
let globalIntegrityManager: EventIntegrityManager | null = null;

/**
 * Get global event integrity manager
 */
export function getGlobalIntegrityManager(): EventIntegrityManager {
  if (!globalIntegrityManager) {
    globalIntegrityManager = new EventIntegrityManager();
  }
  return globalIntegrityManager;
}

/**
 * Set global event integrity manager (for testing)
 */
export function setGlobalIntegrityManager(manager: EventIntegrityManager): void {
  globalIntegrityManager = manager;
}

/**
 * Utility function to create secure event
 */
export async function createSecureEvent<T = any>(
  event: HappenEvent<T>,
  nodeId?: string
): Promise<SecureEvent<T>> {
  const manager = getGlobalIntegrityManager();
  
  if (nodeId) {
    return await manager.signEvent(event, nodeId);
  }
  
  // Create event with hash only
  const integrity = await manager.createIntegrity(event);
  return {
    ...event,
    context: {
      ...event.context,
      integrity
    }
  };
}

/**
 * Utility function to verify secure event
 */
export async function verifySecureEvent(event: SecureEvent): Promise<boolean> {
  const manager = getGlobalIntegrityManager();
  return await manager.verifyEvent(event);
}