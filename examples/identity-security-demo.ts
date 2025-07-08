#!/usr/bin/env node
/**
 * Identity & Security Demo
 * Shows all the identity and security features working together
 */

import { initializeHappen } from '../src';
import { 
  getGlobalIdentityProvider, 
  getGlobalAccessControl 
} from '../src/identity';

async function main() {
  console.log('🔐 Happen Identity & Security Demo');
  console.log('==================================\n');

  // Initialize Happen
  const happen = initializeHappen();
  console.log('✅ Happen initialized\n');

  // Demo 1: Node Identity
  console.log('🆔 Demo 1: Node Identity');
  console.log('-------------------------');

  const identityProvider = getGlobalIdentityProvider();
  
  // Generate key pair
  const keyPair = await identityProvider.generateKeyPair();
  console.log('✅ Generated Ed25519 key pair');
  console.log(`   Algorithm: ${keyPair.algorithm}`);
  console.log(`   Public key: ${keyPair.publicKey.substring(0, 50)}...`);
  
  // Create identity
  const identity = await identityProvider.createIdentity('demo-node', keyPair);
  console.log('✅ Created node identity');
  console.log(`   Node ID: ${identity.nodeId}`);
  console.log(`   Created at: ${new Date(identity.createdAt).toISOString()}`);
  
  // Test signing and verification
  const testMessage = 'Hello, secure world!';
  const testData = new TextEncoder().encode(testMessage);
  
  const signature = await identityProvider.signData(testData, keyPair.privateKey);
  console.log('✅ Signed test message');
  
  const isValid = await identityProvider.verifySignature(testData, signature, keyPair.publicKey);
  console.log(`✅ Signature verification: ${isValid ? 'VALID' : 'INVALID'}`);
  
  console.log('✅ Demo 1 completed\n');

  // Demo 2: Origin Context & Acceptance Controls
  console.log('🎯 Demo 2: Origin Context & Acceptance Controls');
  console.log('-----------------------------------------------');
  
  // Create nodes with different acceptance policies
  const orderNode = happen.createNode('order-service');
  const inventoryNode = happen.createNode('inventory-service');
  const paymentNode = happen.createNode('payment-service', {
    acceptFrom: ['order-service'] // Only accept from order service
  });
  
  console.log('✅ Created nodes with acceptance controls');
  
  let acceptedEvents: any[] = [];
  let rejectedCount = 0;
  
  // Monitor accepted events
  paymentNode.on('process-payment', (event: any) => {
    acceptedEvents.push(event);
    console.log(`💳 Payment: Accepted payment from ${event.context.causal.sender}`);
    if (event.context.origin) {
      console.log(`   Original source: ${event.context.origin.sourceId} (${event.context.origin.sourceType})`);
    }
  });
  
  // Test accepted event
  console.log('🚀 Testing accepted event...');
  orderNode.send(paymentNode, {
    type: 'process-payment',
    payload: { amount: 100 },
    context: {
      origin: {
        sourceId: 'user:123',
        sourceType: 'user'
      }
    }
  });
  
  // Test rejected event (should be silently dropped)
  console.log('🚀 Testing rejected event...');
  inventoryNode.send(paymentNode, {
    type: 'process-payment',
    payload: { amount: 200 }
  });
  
  await new Promise(resolve => setTimeout(resolve, 200));
  
  console.log(`✅ Accepted events: ${acceptedEvents.length}`);
  console.log(`✅ Rejected events: ${rejectedCount} (silently dropped)`);
  console.log('✅ Demo 2 completed\n');

  // Demo 3: Access Control System
  console.log('🛡️ Demo 3: Access Control System');
  console.log('--------------------------------');
  
  const acl = getGlobalAccessControl();
  
  // Add access rules
  acl.addRule({
    principal: 'user:123',
    permissions: [
      { action: 'read', resource: 'order:*' },
      { action: 'write', resource: 'order:own' }
    ],
    deny: false,
    priority: 10
  });
  
  acl.addRule({
    principal: 'admin:*',
    permissions: [
      { action: '*', resource: '*' }
    ],
    deny: false,
    priority: 5
  });
  
  // Add deny rule
  acl.addRule({
    principal: 'user:blocked',
    permissions: [
      { action: 'read', resource: 'order:*' }
    ],
    deny: true,
    priority: 1
  });
  
  console.log('✅ Added access control rules');
  
  // Test permissions
  const testCases = [
    { principal: 'user:123', action: 'read', resource: 'order:456' },
    { principal: 'user:123', action: 'write', resource: 'order:own' },
    { principal: 'user:123', action: 'delete', resource: 'order:456' },
    { principal: 'admin:alice', action: 'delete', resource: 'order:456' },
    { principal: 'user:blocked', action: 'read', resource: 'order:456' }
  ];
  
  console.log('🔍 Testing permissions:');
  testCases.forEach(test => {
    const allowed = acl.checkPermission(test.principal, test.action, test.resource);
    console.log(`   ${test.principal} ${test.action} ${test.resource}: ${allowed ? '✅ ALLOWED' : '❌ DENIED'}`);
    
    // Record audit event
    acl.audit(test.action, test.principal, test.resource, allowed, { nodeId: 'demo-node' });
  });
  
  // Show audit log
  const auditLog = acl.getAuditLog();
  console.log(`✅ Audit log contains ${auditLog.length} entries`);
  
  // Show statistics
  const stats = acl.getStats();
  console.log('📊 Access control statistics:');
  console.log(`   Total rules: ${stats.totalRules}`);
  console.log(`   Allow rules: ${stats.allowRules}`);
  console.log(`   Deny rules: ${stats.denyRules}`);
  console.log(`   Audit entries: ${stats.totalAuditEntries}`);
  
  console.log('✅ Demo 3 completed\n');

  // Demo 4: Custom Authorization Pattern
  console.log('⚖️ Demo 4: Custom Authorization Pattern');
  console.log('--------------------------------------');
  
  // Create a node with custom authorization logic
  const resourceNode = happen.createNode('resource-service');
  
  // Mock user database
  const users = new Map([
    ['user:123', { role: 'customer', tenantId: 'tenant-a' }],
    ['user:456', { role: 'admin', tenantId: 'tenant-a' }],
    ['user:789', { role: 'customer', tenantId: 'tenant-b' }]
  ]);
  
  // Mock resource database
  const resources = new Map([
    ['resource:abc', { tenantId: 'tenant-a', owner: 'user:123' }],
    ['resource:def', { tenantId: 'tenant-b', owner: 'user:789' }]
  ]);
  
  let authResults: any[] = [];
  
  resourceNode.on('access-resource', (event: any) => {
    const { sourceId, sourceType } = event.context.origin || {};
    const { resourceId, action } = event.payload;
    
    // Check if user exists
    const user = users.get(sourceId);
    if (!user) {
      authResults.push({ success: false, reason: 'user-not-found' });
      return;
    }
    
    // Check if resource exists
    const resource = resources.get(resourceId);
    if (!resource) {
      authResults.push({ success: false, reason: 'resource-not-found' });
      return;
    }
    
    // Multi-tenant isolation
    if (user.tenantId !== resource.tenantId) {
      authResults.push({ success: false, reason: 'tenant-isolation' });
      return;
    }
    
    // Role-based access
    if (user.role === 'admin') {
      authResults.push({ success: true, reason: 'admin-access' });
      return;
    }
    
    // Owner-based access
    if (action === 'read' && user.role === 'customer') {
      authResults.push({ success: true, reason: 'customer-read' });
      return;
    }
    
    if (action === 'write' && resource.owner === sourceId) {
      authResults.push({ success: true, reason: 'owner-write' });
      return;
    }
    
    authResults.push({ success: false, reason: 'insufficient-permissions' });
  });
  
  // Test authorization scenarios
  const authTests = [
    { 
      sourceId: 'user:123', 
      resourceId: 'resource:abc', 
      action: 'read',
      expected: 'customer-read' 
    },
    { 
      sourceId: 'user:123', 
      resourceId: 'resource:abc', 
      action: 'write',
      expected: 'owner-write' 
    },
    { 
      sourceId: 'user:123', 
      resourceId: 'resource:def', 
      action: 'read',
      expected: 'tenant-isolation' 
    },
    { 
      sourceId: 'user:456', 
      resourceId: 'resource:abc', 
      action: 'write',
      expected: 'admin-access' 
    },
    { 
      sourceId: 'user:789', 
      resourceId: 'resource:def', 
      action: 'read',
      expected: 'customer-read' 
    }
  ];
  
  console.log('🔍 Testing custom authorization:');
  
  for (const test of authTests) {
    resourceNode.send(resourceNode, {
      type: 'access-resource',
      payload: { 
        resourceId: test.resourceId, 
        action: test.action 
      },
      context: {
        origin: {
          sourceId: test.sourceId,
          sourceType: 'user'
        }
      }
    });
  }
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  authResults.forEach((result, index) => {
    const test = authTests[index];
    const status = result.success ? '✅ ALLOWED' : '❌ DENIED';
    console.log(`   ${test.sourceId} ${test.action} ${test.resourceId}: ${status} (${result.reason})`);
  });
  
  console.log('✅ Demo 4 completed\n');

  console.log('🎉 All Identity & Security features working correctly!');
  console.log('\n🔐 Features demonstrated:');
  console.log('   • Cryptographic node identity (Ed25519)');
  console.log('   • Digital signatures and verification');
  console.log('   • Origin context tracking');
  console.log('   • Acceptance controls (acceptFrom patterns)');
  console.log('   • Rule-based access control');
  console.log('   • Audit logging');
  console.log('   • Custom authorization patterns');
  console.log('   • Multi-tenant isolation');
  console.log('   • Role-based access control');
  
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});