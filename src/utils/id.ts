/**
 * ID generation utilities
 */

import { randomBytes } from 'crypto';

/**
 * Generate a unique ID for nodes and events
 * Format: prefix-timestamp-random
 */
export function generateId(prefix: string = 'evt'): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(6).toString('base64url');
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Generate a node ID with cryptographic properties
 */
export function generateNodeId(name: string): string {
  const timestamp = Date.now().toString(36);
  const hash = randomBytes(8).toString('base64url');
  return `node-${name}-${timestamp}-${hash}`;
}

/**
 * Extract timestamp from ID
 */
export function getTimestampFromId(id: string): number | null {
  const parts = id.split('-');
  if (parts.length < 3) return null;
  
  const timestampPart = parts[1];
  if (!timestampPart) return null;
  
  const timestamp = parseInt(timestampPart, 36);
  return isNaN(timestamp) ? null : timestamp;
}

/**
 * Check if an ID is valid
 */
export function isValidId(id: string): boolean {
  const parts = id.split('-');
  const firstPart = parts[0];
  return parts.length >= 3 && !!firstPart && firstPart.length > 0 && getTimestampFromId(id) !== null;
}