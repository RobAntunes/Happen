/**
 * Tests for Identity and Authentication system
 */

import {
  CryptoIdentityProvider,
  MemoryAccessControlManager,
  getGlobalIdentityProvider,
  getGlobalAccessControl,
  setGlobalIdentityProvider,
  setGlobalAccessControl,
} from '../src/identity';
import { createEvent } from '../src/events';
import { HappenNodeImpl } from '../src/node';
import { InMemoryGlobalState } from '../src/global-state';

describe('Identity and Authentication System', () => {
  let identityProvider: CryptoIdentityProvider;
  let accessControl: MemoryAccessControlManager;

  beforeEach(() => {
    identityProvider = new CryptoIdentityProvider();
    accessControl = new MemoryAccessControlManager();
    
    // Set global instances for testing
    setGlobalIdentityProvider(identityProvider);
    setGlobalAccessControl(accessControl);
  });

  describe('CryptoIdentityProvider', () => {
    it('should generate Ed25519 key pairs', async () => {
      const keyPair = await identityProvider.generateKeyPair();
      
      expect(keyPair.algorithm).toBe('Ed25519');
      expect(keyPair.publicKey).toContain('PUBLIC KEY');
      expect(keyPair.privateKey).toContain('PRIVATE KEY');
      expect(keyPair.publicKey).not.toBe(keyPair.privateKey);
    });


    it('should create node identity with certificate', async () => {
      const nodeId = 'test-node-123';
      const keyPair = await identityProvider.generateKeyPair();
      
      const identity = await identityProvider.createIdentity(nodeId, keyPair);
      
      expect(identity.nodeId).toBe(nodeId);
      expect(identity.publicKey).toBe(keyPair.publicKey);
      expect(identity.algorithm).toBe(keyPair.algorithm);
      expect(identity.certificate).toBeDefined();
      expect(identity.createdAt).toBeLessThanOrEqual(Date.now());
      expect(identity.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should sign and verify data', async () => {
      const keyPair = await identityProvider.generateKeyPair();
      const testData = new TextEncoder().encode('Hello, Happen!');
      
      const signature = await identityProvider.signData(testData, keyPair.privateKey);
      const isValid = await identityProvider.verifySignature(testData, signature, keyPair.publicKey);
      
      expect(signature).toBeDefined();
      expect(isValid).toBe(true);
      
      // Test with wrong data
      const wrongData = new TextEncoder().encode('Wrong data');
      const isWrongValid = await identityProvider.verifySignature(wrongData, signature, keyPair.publicKey);
      expect(isWrongValid).toBe(false);
    });



    it('should get stored identity', async () => {
      const nodeId = 'test-node-stored';
      const keyPair = await identityProvider.generateKeyPair();
      const identity = await identityProvider.createIdentity(nodeId, keyPair);
      
      const retrieved = identityProvider.getIdentity(nodeId);
      expect(retrieved).toEqual(identity);
      
      const nonExistent = identityProvider.getIdentity('non-existent');
      expect(nonExistent).toBeUndefined();
    });
  });

  describe('MemoryAccessControlManager', () => {
    it('should add and check permissions', () => {
      accessControl.addRule({
        principal: 'user-123',
        permissions: [
          { action: 'read', resource: 'documents' },
          { action: 'write', resource: 'documents' },
        ],
        priority: 100,
      });
      
      expect(accessControl.checkPermission('user-123', 'read', 'documents')).toBe(true);
      expect(accessControl.checkPermission('user-123', 'write', 'documents')).toBe(true);
      expect(accessControl.checkPermission('user-123', 'delete', 'documents')).toBe(false);
      expect(accessControl.checkPermission('user-456', 'read', 'documents')).toBe(false);
    });

    it('should support wildcard patterns', () => {
      accessControl.addRule({
        principal: 'admin-*',
        permissions: [{ action: '*', resource: '*' }],
        priority: 50,
      });
      
      expect(accessControl.checkPermission('admin-user', 'read', 'anything')).toBe(true);
      expect(accessControl.checkPermission('admin-system', 'delete', 'users')).toBe(true);
      expect(accessControl.checkPermission('regular-user', 'read', 'anything')).toBe(false);
    });

    it('should handle deny rules', () => {
      // Allow all for admins
      accessControl.addRule({
        principal: 'admin-*',
        permissions: [{ action: '*', resource: '*' }],
        priority: 100,
      });
      
      // But deny sensitive operations
      accessControl.addRule({
        principal: '*',
        permissions: [{ action: 'delete', resource: 'system.*' }],
        deny: true,
        priority: 50, // Higher priority (lower number)
      });
      
      expect(accessControl.checkPermission('admin-user', 'read', 'system.config')).toBe(true);
      expect(accessControl.checkPermission('admin-user', 'delete', 'system.config')).toBe(false);
    });

    it('should support conditional permissions', () => {
      accessControl.addRule({
        principal: 'user-123',
        permissions: [{
          action: 'read',
          resource: 'documents',
          conditions: { department: 'engineering' }
        }],
        priority: 100,
      });
      
      expect(accessControl.checkPermission('user-123', 'read', 'documents', { department: 'engineering' })).toBe(true);
      expect(accessControl.checkPermission('user-123', 'read', 'documents', { department: 'sales' })).toBe(false);
      expect(accessControl.checkPermission('user-123', 'read', 'documents')).toBe(false);
    });

    it('should list permissions for principal', () => {
      accessControl.addRule({
        principal: 'user-123',
        permissions: [
          { action: 'read', resource: 'documents' },
          { action: 'write', resource: 'reports' },
        ],
        priority: 100,
      });
      
      const permissions = accessControl.listPermissions('user-123');
      expect(permissions).toHaveLength(2);
      expect(permissions).toContainEqual({ action: 'read', resource: 'documents' });
      expect(permissions).toContainEqual({ action: 'write', resource: 'reports' });
    });

    it('should maintain audit log', () => {
      const origin = { nodeId: 'test-node', sourceType: 'test' };
      
      accessControl.audit('read', 'user-123', 'document-456', true, origin, { extra: 'data' });
      accessControl.audit('write', 'user-123', 'document-789', false, origin);
      
      const auditLog = accessControl.getAuditLog();
      expect(auditLog).toHaveLength(2);
      
      const readEntry = auditLog.find(e => e.action === 'read');
      expect(readEntry).toBeDefined();
      expect(readEntry!.principal).toBe('user-123');
      expect(readEntry!.resource).toBe('document-456');
      expect(readEntry!.success).toBe(true);
      expect(readEntry!.origin).toEqual(origin);
      expect(readEntry!.metadata).toEqual({ extra: 'data' });
      
      const writeEntry = auditLog.find(e => e.action === 'write');
      expect(writeEntry).toBeDefined();
      expect(writeEntry!.success).toBe(false);
    });

    it('should filter audit log', () => {
      const origin1 = { nodeId: 'node-1', sourceType: 'test' };
      const origin2 = { nodeId: 'node-2', sourceType: 'test' };
      
      accessControl.audit('read', 'user-123', 'doc-1', true, origin1);
      accessControl.audit('write', 'user-456', 'doc-2', false, origin2);
      accessControl.audit('delete', 'user-123', 'doc-3', true, origin1);
      
      const userEntries = accessControl.getAuditLog({ principal: 'user-123' });
      expect(userEntries).toHaveLength(2);
      
      const failedEntries = accessControl.getAuditLog({ success: false });
      expect(failedEntries).toHaveLength(1);
      expect(failedEntries[0]?.action).toBe('write');
      
      const nodeEntries = accessControl.getAuditLog({ origin: { nodeId: 'node-1' } });
      expect(nodeEntries).toHaveLength(2);
    });

    it('should provide statistics', () => {
      accessControl.addRule({
        principal: 'user-1',
        permissions: [{ action: 'read', resource: 'docs' }],
        priority: 100,
      });
      
      accessControl.addRule({
        principal: 'user-2',
        permissions: [{ action: 'write', resource: 'docs' }],
        deny: true,
        priority: 50,
      });
      
      accessControl.audit('test', 'user', 'resource', true, { nodeId: 'node' });
      
      const stats = accessControl.getStats();
      expect(stats.totalRules).toBe(2);
      expect(stats.allowRules).toBe(1);
      expect(stats.denyRules).toBe(1);
      expect(stats.totalAuditEntries).toBe(1);
    });
  });

  describe('Identity Context Integration', () => {
    it('should create identity for nodes', async () => {
      const nodeId = 'test-node';
      const keyPair = await identityProvider.generateKeyPair();
      const identity = await identityProvider.createIdentity(nodeId, keyPair);
      
      expect(identity.nodeId).toBe(nodeId);
      expect(identity.publicKey).toBeDefined();
      expect(identity.certificate).toBeDefined();
      expect(identity.createdAt).toBeLessThanOrEqual(Date.now());
      expect(identity.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('Node Integration', () => {
    let globalState: any;
    let node: HappenNodeImpl;

    beforeEach(async () => {
      globalState = new InMemoryGlobalState();
      node = new HappenNodeImpl('test-node', {}, globalState);
      
      // Wait a bit for async identity initialization
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    afterEach(async () => {
      await node.stop();
    });

    it('should initialize with identity', () => {
      const identity = node.getIdentity();
      const publicKey = node.getPublicKey();
      
      expect(identity).not.toBeNull();
      expect(publicKey).not.toBeNull();
      expect(identity?.nodeId).toBe(node.id);
    });

    it('should sign and verify data', async () => {
      const testData = new TextEncoder().encode('Test message');
      
      const signature = await node.signData(testData);
      expect(signature).not.toBeNull();
      
      const publicKey = node.getPublicKey();
      const isValid = await node.verifySignature(testData, signature!, publicKey!);
      expect(isValid).toBe(true);
    });

    it('should enforce acceptFrom controls', async () => {
      let eventReceived = false;
      
      // Create node with acceptFrom restrictions
      const restrictedNode = new HappenNodeImpl('restricted-node', {
        acceptFrom: ['checkout-node', 'order-*']
      }, globalState);
      
      // Setup a handler
      restrictedNode.on('test.event', () => {
        eventReceived = true;
      });
      
      await restrictedNode.start();
      
      // Test with external sender (should be blocked)
      // Emit event (should be blocked) - use processEvent directly to avoid origin override
      eventReceived = false;
      const fullEvent = {
        id: 'test-event-1',
        type: 'test.event',
        payload: { message: 'test' },
        context: {
          causal: {
            id: 'test-event-1',
            sender: 'external-sender', // Not in acceptFrom array
            path: ['external-sender']
          },
          timestamp: Date.now(),
        }
      };
      (restrictedNode as any).processEvent(fullEvent);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should be blocked
      expect(eventReceived).toBe(false);
      
      // Try with allowed sender
      eventReceived = false;
      const allowedEvent = {
        type: 'test.event',
        payload: { message: 'test' },
        context: {
          causal: {
            id: 'test-event-2',
            sender: 'checkout-node', // In acceptFrom array
            path: ['checkout-node']
          },
          timestamp: Date.now(),
        }
      };
      
      const fullAllowedEvent = {
        id: 'test-event-2',
        ...allowedEvent
      };
      (restrictedNode as any).processEvent(fullAllowedEvent);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      
      // Should work
      expect(eventReceived).toBe(true);
      
      // Test wildcard pattern
      eventReceived = false;
      const wildcardEvent = {
        id: 'test-event-3',
        type: 'test.event',
        payload: { message: 'test' },
        context: {
          causal: {
            id: 'test-event-3',
            sender: 'order-123', // Matches "order-*" pattern
            path: ['order-123']
          },
          timestamp: Date.now(),
        }
      };
      (restrictedNode as any).processEvent(wildcardEvent);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should work with wildcard
      expect(eventReceived).toBe(true);
      
      await restrictedNode.stop();
    });

    it('should use custom accept function when provided', async () => {
      let eventReceived = false;
      
      // Create node with custom accept function that only accepts from admin nodes
      const customNode = new HappenNodeImpl('custom-node', {
        accept: (origin) => origin.nodeId.startsWith('admin-')
      }, globalState);
      
      // Setup a handler
      customNode.on('test.event', () => {
        eventReceived = true;
      });
      
      await customNode.start();
      
      // Test with non-admin sender (should be blocked)
      const blockedEvent = createEvent('test.event', { message: 'test' }, {}, 'user-node');
      
      eventReceived = false;
      await (customNode as any).processEvent(blockedEvent);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should be blocked
      expect(eventReceived).toBe(false);
      
      // Try with admin sender
      eventReceived = false;
      const allowedEvent = createEvent('test.event', { message: 'test' }, {}, 'admin-node');
      await (customNode as any).processEvent(allowedEvent);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should work
      expect(eventReceived).toBe(true);
      
      await customNode.stop();
    });
  });

  describe('Global Instances', () => {
    it('should provide global identity provider', () => {
      const global1 = getGlobalIdentityProvider();
      const global2 = getGlobalIdentityProvider();
      
      expect(global1).toBe(global2); // Same instance
      expect(global1).toBeInstanceOf(CryptoIdentityProvider);
    });

    it('should provide global access control', () => {
      const global1 = getGlobalAccessControl();
      const global2 = getGlobalAccessControl();
      
      expect(global1).toBe(global2); // Same instance
      expect(global1).toBeInstanceOf(MemoryAccessControlManager);
    });
  });
});