/**
 * Identity & Security Feature Tests
 * Tests all identity and security features as described in the spec
 */

import { initializeHappen } from '../src';
import { 
  getGlobalIdentityProvider, 
  getGlobalAccessControl,
  // CryptoIdentityProvider,
  // MemoryAccessControlManager 
} from '../src/identity';

describe('Identity & Security Features', () => {
  let happen: any;
  
  beforeEach(() => {
    happen = initializeHappen();
  });

  describe('1. Node Identity', () => {
    it('should create unique cryptographic identity at node creation', async () => {
      const orderNode = happen.createNode('order-service');
      const inventoryNode = happen.createNode('inventory-service');
      
      // Nodes are autonomous - no cleanup needed
      
      // Nodes should have unique IDs
      expect(orderNode.id).toBeDefined();
      expect(inventoryNode.id).toBeDefined();
      expect(orderNode.id).not.toBe(inventoryNode.id);
      
      // Node IDs should be consistent
      expect(orderNode.id).toBe(orderNode.id);
    });

    it('should provide cryptographic identity for each node', async () => {
      const identityProvider = getGlobalIdentityProvider();
      
      // Generate key pair
      const keyPair = await identityProvider.generateKeyPair();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.algorithm).toBe('Ed25519');
      
      // Create identity
      const identity = await identityProvider.createIdentity('test-node', keyPair);
      expect(identity.nodeId).toBe('test-node');
      expect(identity.publicKey).toBe(keyPair.publicKey);
      expect(identity.certificate).toBeDefined();
    });

    it('should provide signing and verification capabilities', async () => {
      const identityProvider = getGlobalIdentityProvider();
      const keyPair = await identityProvider.generateKeyPair();
      
      const testData = new TextEncoder().encode('test message');
      
      // Sign data
      const signature = await identityProvider.signData(testData, keyPair.privateKey);
      expect(signature).toBeDefined();
      
      // Verify signature
      const isValid = await identityProvider.verifySignature(testData, signature, keyPair.publicKey);
      expect(isValid).toBe(true);
      
      // Verify with wrong key should fail
      const wrongKeyPair = await identityProvider.generateKeyPair();
      const wrongVerification = await identityProvider.verifySignature(testData, signature, wrongKeyPair.publicKey);
      expect(wrongVerification).toBe(false);
    });
  });

  describe('2. Origin Context', () => {
    it('should automatically include sender in event context', async () => {
      const orderNode = happen.createNode('order-service');
      const inventoryNode = happen.createNode('inventory-service');
      
      // Nodes are autonomous - no cleanup needed
      
      let receivedEvent: any = null;
      
      inventoryNode.on('check-inventory', (event: any) => {
        receivedEvent = event;
      });
      
      orderNode.send(inventoryNode, {
        type: 'check-inventory',
        payload: { orderId: 'order-123' }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(receivedEvent).toBeTruthy();
      expect(receivedEvent.context.causal.sender).toBe(orderNode.id);
    });

    it('should support custom origin context', async () => {
      const orderNode = happen.createNode('order-service');
      const inventoryNode = happen.createNode('inventory-service');
      
      // Nodes are autonomous - no cleanup needed
      
      let receivedEvent: any = null;
      
      inventoryNode.on('check-inventory', (event: any) => {
        receivedEvent = event;
      });
      
      orderNode.send(inventoryNode, {
        type: 'check-inventory',
        payload: { orderId: 'order-123' },
        context: {
          origin: {
            sourceId: 'user-456',
            sourceType: 'user'
          }
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(receivedEvent).toBeTruthy();
      expect(receivedEvent.context.origin.sourceId).toBe('user-456');
      expect(receivedEvent.context.origin.sourceType).toBe('user');
    });

    it('should preserve causality chain with origin information', async () => {
      const nodeA = happen.createNode('node-a');
      const nodeB = happen.createNode('node-b');
      const nodeC = happen.createNode('node-c');
      
      // Nodes are autonomous - no cleanup needed
      
      let eventChain: any[] = [];
      
      nodeA.on('start', (event: any) => {
        eventChain.push({ node: 'A', event });
        nodeA.send(nodeB, {
          type: 'continue',
          payload: { step: 2 },
          context: {
            origin: event.context.origin // Preserve origin
          }
        });
      });
      
      nodeB.on('continue', (event: any) => {
        eventChain.push({ node: 'B', event });
        nodeB.send(nodeC, {
          type: 'finish',
          payload: { step: 3 },
          context: {
            origin: event.context.origin // Preserve origin
          }
        });
      });
      
      nodeC.on('finish', (event: any) => {
        eventChain.push({ node: 'C', event });
      });
      
      // Start with original source
      nodeA.send(nodeA, {
        type: 'start',
        payload: { step: 1 },
        context: {
          origin: {
            sourceId: 'user-123',
            sourceType: 'user'
          }
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(eventChain).toHaveLength(3);
      
      // All events should preserve original source
      expect(eventChain[0].event.context.origin.sourceId).toBe('user-123');
      expect(eventChain[1].event.context.origin.sourceId).toBe('user-123');
      expect(eventChain[2].event.context.origin.sourceId).toBe('user-123');
      
      // But senders should be different
      expect(eventChain[0].event.context.causal.sender).toBe(nodeA.id);
      expect(eventChain[1].event.context.causal.sender).toBe(nodeA.id);
      expect(eventChain[2].event.context.causal.sender).toBe(nodeB.id);
    });
  });

  describe('3. Acceptance Controls', () => {
    it('should accept events from specified nodes in acceptFrom array', async () => {
      const orderNode = happen.createNode('order-service');
      const inventoryNode = happen.createNode('inventory-service');
      const paymentNode = happen.createNode('payment-service', {
        acceptFrom: ['order-service']
      });
      
      // Nodes are autonomous - no cleanup needed
      
      let acceptedEvents: any[] = [];
      // let rejectedEvents: any[] = [];
      
      paymentNode.on('process-payment', (event: any) => {
        acceptedEvents.push(event);
      });
      
      // This should be accepted
      orderNode.send(paymentNode, {
        type: 'process-payment',
        payload: { amount: 100 }
      });
      
      // This should be rejected
      inventoryNode.send(paymentNode, {
        type: 'process-payment',
        payload: { amount: 200 }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(acceptedEvents).toHaveLength(1);
      expect(acceptedEvents[0].payload.amount).toBe(100);
    });

    it('should support wildcard patterns in acceptFrom', async () => {
      const orderNode = happen.createNode('order-service-v1');
      const orderNode2 = happen.createNode('order-service-v2');
      const inventoryNode = happen.createNode('inventory-service');
      const paymentNode = happen.createNode('payment-service', {
        acceptFrom: ['order-service-*', 'admin-*']
      });
      
      // Nodes are autonomous - no cleanup needed
      
      let acceptedEvents: any[] = [];
      
      paymentNode.on('process-payment', (event: any) => {
        acceptedEvents.push(event);
      });
      
      // These should be accepted (match pattern)
      orderNode.send(paymentNode, {
        type: 'process-payment',
        payload: { amount: 100 }
      });
      
      orderNode2.send(paymentNode, {
        type: 'process-payment',
        payload: { amount: 200 }
      });
      
      // This should be rejected (doesn't match pattern)
      inventoryNode.send(paymentNode, {
        type: 'process-payment',
        payload: { amount: 300 }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(acceptedEvents).toHaveLength(2);
      expect(acceptedEvents[0].payload.amount).toBe(100);
      expect(acceptedEvents[1].payload.amount).toBe(200);
    });

    it('should support custom accept function', async () => {
      const orderNode = happen.createNode('order-service');
      const paymentNode = happen.createNode('payment-service', {
        accept: (origin: any) => {
          // Only accept events from nodes containing 'service' in their name
          return origin.nodeId.includes('service');
        }
      });
      
      // Nodes are autonomous - no cleanup needed
      
      let acceptedEvents: any[] = [];
      
      paymentNode.on('process-payment', (event: any) => {
        acceptedEvents.push(event);
      });
      
      // This should be accepted
      orderNode.send(paymentNode, {
        type: 'process-payment',
        payload: { amount: 100 }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(acceptedEvents).toHaveLength(1);
      expect(acceptedEvents[0].payload.amount).toBe(100);
    });
  });

  describe('4. Access Control System', () => {
    it('should provide rule-based access control', async () => {
      const acl = getGlobalAccessControl();
      
      // Add rules
      acl.addRule({
        principal: 'user:123',
        permissions: [
          { action: 'read', resource: 'order:*' },
          { action: 'write', resource: 'order:own' }
        ],
        deny: false,
        priority: 10
      });
      
      // Check permissions
      expect(acl.checkPermission('user:123', 'read', 'order:456')).toBe(true);
      expect(acl.checkPermission('user:123', 'write', 'order:own')).toBe(true);
      expect(acl.checkPermission('user:123', 'delete', 'order:456')).toBe(false);
      expect(acl.checkPermission('user:456', 'read', 'order:456')).toBe(false);
    });

    it('should support deny rules with priority', async () => {
      const acl = getGlobalAccessControl();
      
      // Add allow rule
      acl.addRule({
        principal: 'user:*',
        permissions: [{ action: 'read', resource: 'public:*' }],
        deny: false,
        priority: 20
      });
      
      // Add deny rule with higher priority
      acl.addRule({
        principal: 'user:blocked',
        permissions: [{ action: 'read', resource: 'public:*' }],
        deny: true,
        priority: 10
      });
      
      expect(acl.checkPermission('user:normal', 'read', 'public:data')).toBe(true);
      expect(acl.checkPermission('user:blocked', 'read', 'public:data')).toBe(false);
    });

    it('should maintain audit logs', async () => {
      const acl = getGlobalAccessControl();
      
      // Record audit events
      acl.audit('read', 'user:123', 'order:456', true, { nodeId: 'order-service' });
      acl.audit('write', 'user:123', 'order:456', false, { nodeId: 'order-service' }, { reason: 'unauthorized' });
      
      // Get audit log
      const auditLog = acl.getAuditLog();
      expect(auditLog).toHaveLength(2);
      expect(auditLog[0]?.action).toBe('read');
      expect(auditLog[0]?.success).toBe(true);
      expect(auditLog[1]?.action).toBe('write');
      expect(auditLog[1]?.success).toBe(false);
      
      // Filter audit log
      const failedEvents = acl.getAuditLog({ success: false });
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]?.action).toBe('write');
    });
  });

  describe('5. Multi-tenant Identity Example', () => {
    it('should support tenant-based node creation', async () => {
      function createTenantNode(tenantId: string, nodeId: string) {
        return happen.createNode(nodeId, {
          acceptFrom: [`tenant:${tenantId}:*`]
        });
      }
      
      const tenant1OrderNode = createTenantNode('tenant1', 'order-service');
      const tenant2OrderNode = createTenantNode('tenant2', 'order-service-2');
      
      // Nodes are autonomous - no cleanup needed
      
      let tenant1Events: any[] = [];
      let tenant2Events: any[] = [];
      
      tenant1OrderNode.on('process-order', (event: any) => {
        tenant1Events.push(event);
      });
      
      tenant2OrderNode.on('process-order', (event: any) => {
        tenant2Events.push(event);
      });
      
      // Simulate events from different tenants
      const mockSender1 = happen.createNode('tenant:tenant1:api-gateway');
      const mockSender2 = happen.createNode('tenant:tenant2:api-gateway');
      
      // Nodes are autonomous - no cleanup needed
      
      mockSender1.send(tenant1OrderNode, {
        type: 'process-order',
        payload: { orderId: 'order-123' }
      });
      
      mockSender2.send(tenant2OrderNode, {
        type: 'process-order',
        payload: { orderId: 'order-456' }
      });
      
      // Cross-tenant communication should be blocked
      mockSender1.send(tenant2OrderNode, {
        type: 'process-order',
        payload: { orderId: 'order-789' }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(tenant1Events).toHaveLength(1);
      expect(tenant1Events[0].payload.orderId).toBe('order-123');
      
      expect(tenant2Events).toHaveLength(1);
      expect(tenant2Events[0].payload.orderId).toBe('order-456');
    });
  });

  describe('6. Custom Authorization Example', () => {
    it('should support domain-specific authorization in event handlers', async () => {
      const orderNode = happen.createNode('order-service');
      
      // Nodes are autonomous - no cleanup needed
      
      // Mock order database
      const orders = new Map([
        ['order-123', { customerId: 'user:123', status: 'pending' }],
        ['order-456', { customerId: 'user:456', status: 'completed' }]
      ]);
      
      let authResults: any[] = [];
      
      orderNode.on('update-order', (event: any) => {
        const { sourceId, sourceType } = event.context.origin || {};
        const { orderId } = event.payload;
        
        const order = orders.get(orderId);
        
        if (sourceType === 'user' && order?.customerId !== sourceId) {
          authResults.push({
            success: false,
            reason: 'unauthorized',
            message: 'Users can only update their own orders'
          });
          return;
        }
        
        authResults.push({
          success: true,
          orderId
        });
      });
      
      // User tries to update their own order (should succeed)
      orderNode.send(orderNode, {
        type: 'update-order',
        payload: { orderId: 'order-123', status: 'processing' },
        context: {
          origin: {
            sourceId: 'user:123',
            sourceType: 'user'
          }
        }
      });
      
      // User tries to update someone else's order (should fail)
      orderNode.send(orderNode, {
        type: 'update-order',
        payload: { orderId: 'order-456', status: 'cancelled' },
        context: {
          origin: {
            sourceId: 'user:123',
            sourceType: 'user'
          }
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(authResults).toHaveLength(2);
      expect(authResults[0].success).toBe(true);
      expect(authResults[1].success).toBe(false);
      expect(authResults[1].reason).toBe('unauthorized');
    });
  });

  describe('7. Identity Statistics', () => {
    it('should provide identity and access control statistics', async () => {
      const identityProvider = getGlobalIdentityProvider();
      const acl = getGlobalAccessControl();
      
      // Create some identities
      const keyPair1 = await identityProvider.generateKeyPair();
      const keyPair2 = await identityProvider.generateKeyPair();
      
      await identityProvider.createIdentity('node-1', keyPair1);
      await identityProvider.createIdentity('node-2', keyPair2);
      
      // Add some access rules
      acl.addRule({
        principal: 'user:*',
        permissions: [{ action: 'read', resource: 'public:*' }],
        deny: false,
        priority: 10
      });
      
      acl.addRule({
        principal: 'admin:*',
        permissions: [{ action: '*', resource: '*' }],
        deny: false,
        priority: 5
      });
      
      // Get statistics
      const stats = acl.getStats();
      expect(stats.totalRules).toBe(2);
      expect(stats.allowRules).toBe(2);
      expect(stats.denyRules).toBe(0);
      
      // Verify identities exist
      expect(identityProvider.getIdentity('node-1')).toBeDefined();
      expect(identityProvider.getIdentity('node-2')).toBeDefined();
      expect(identityProvider.getIdentity('node-3')).toBeUndefined();
    });
  });
});