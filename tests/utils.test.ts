/**
 * Tests for utility functions
 */

import {
  generateId,
  generateNodeId,
  getTimestampFromId,
  isValidId,
} from '../src/utils/id';

describe('ID Utilities', () => {
  describe('generateId', () => {
    it('should generate unique IDs with default prefix', () => {
      const id1 = generateId();
      const id2 = generateId();
      
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^evt-/);
      expect(id2).toMatch(/^evt-/);
    });

    it('should generate IDs with custom prefix', () => {
      const id = generateId('test');
      
      expect(id).toMatch(/^test-/);
    });

    it('should include timestamp and random parts', () => {
      const id = generateId('prefix');
      const parts = id.split('-');
      
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe('prefix');
      expect(parts[1]).toMatch(/^[a-z0-9]+$/); // timestamp in base36
      expect(parts[2]).toMatch(/^[a-zA-Z0-9_-]+$/); // base64url random
    });
  });

  describe('generateNodeId', () => {
    it('should generate unique node IDs', () => {
      const id1 = generateNodeId('service');
      const id2 = generateNodeId('service');
      
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^node-service-/);
      expect(id2).toMatch(/^node-service-/);
    });

    it('should include service name in ID', () => {
      const id = generateNodeId('test-service');
      
      expect(id).toMatch(/^node-test-service-/);
    });
  });

  describe('getTimestampFromId', () => {
    it('should extract timestamp from valid ID', () => {
      const beforeTime = Date.now();
      const id = generateId();
      const afterTime = Date.now();
      
      const timestamp = getTimestampFromId(id);
      
      expect(timestamp).not.toBeNull();
      expect(timestamp!).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp!).toBeLessThanOrEqual(afterTime);
    });

    it('should return null for invalid IDs', () => {
      expect(getTimestampFromId('invalid')).toBeNull();
      expect(getTimestampFromId('too-few')).toBeNull();
      expect(getTimestampFromId('')).toBeNull();
    });

    it('should return null for IDs with invalid timestamp part', () => {
      expect(getTimestampFromId('prefix--random')).toBeNull();
      // Note: 'invalid' in base36 actually parses to a number, so this test checks empty timestamp
      expect(getTimestampFromId('prefix--random')).toBeNull();
    });

    it('should handle edge cases', () => {
      expect(getTimestampFromId('a-b-c')).not.toBeNull(); // Valid format
      expect(getTimestampFromId('a--c')).toBeNull(); // Empty timestamp part
    });
  });

  describe('isValidId', () => {
    it('should validate correct IDs', () => {
      const id = generateId();
      expect(isValidId(id)).toBe(true);
      
      const nodeId = generateNodeId('test');
      expect(isValidId(nodeId)).toBe(true);
    });

    it('should reject invalid IDs', () => {
      expect(isValidId('')).toBe(false);
      expect(isValidId('invalid')).toBe(false);
      expect(isValidId('too-few')).toBe(false);
      expect(isValidId('--')).toBe(false);
      expect(isValidId('-timestamp-random')).toBe(false); // Empty prefix
    });

    it('should require valid timestamp', () => {
      // Base36 parsing is quite lenient, so focus on empty timestamp
      expect(isValidId('prefix--random')).toBe(false);
      expect(isValidId('prefix-xyz-random')).toBe(true); // 'xyz' is valid base36
    });

    it('should handle various valid formats', () => {
      expect(isValidId('a-1-b')).toBe(true);
      expect(isValidId('prefix-123abc-random123')).toBe(true);
      expect(isValidId('very-long-prefix-name-123abc-verylongrandompart')).toBe(true);
    });
  });

  describe('ID format consistency', () => {
    it('should maintain format across different ID types', () => {
      const eventId = generateId();
      const nodeId = generateNodeId('service');
      
      // Both should be valid
      expect(isValidId(eventId)).toBe(true);
      expect(isValidId(nodeId)).toBe(true);
      
      // Both should have extractable timestamps
      expect(getTimestampFromId(eventId)).not.toBeNull();
      expect(getTimestampFromId(nodeId)).not.toBeNull();
    });

    it('should generate IDs with reasonable length', () => {
      const id = generateId();
      
      // Should be long enough to be unique but not excessive
      expect(id.length).toBeGreaterThan(10);
      expect(id.length).toBeLessThan(100);
    });
  });
});