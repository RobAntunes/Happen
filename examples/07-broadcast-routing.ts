#!/usr/bin/env ts-node
/**
 * Broadcast and Routing Patterns
 * Shows various event distribution patterns:
 * - Broadcasting to all nodes
 * - Pattern-based routing
 * - Topic-based subscriptions
 * - Acceptance control with wildcards
 */

import { initializeHappen } from '../src';

async function main() {
  const happen = initializeHappen();
  
  console.log('=== Broadcast and Routing Demo ===\n');
  
  // Create different types of service nodes
  const coordinator = happen.createNode('coordinator');
  const workerA = happen.createNode('worker-a', { 
    acceptFrom: ['coordinator', 'monitor-*'] // Accept from coordinator and any monitor
  });
  const workerB = happen.createNode('worker-b', {
    acceptFrom: ['coordinator', 'monitor-*']
  });
  const workerC = happen.createNode('worker-c', {
    acceptFrom: ['coordinator', 'monitor-*']
  });
  
  // Monitoring nodes with pattern matching
  const monitorHealth = happen.createNode('monitor-health');
  const monitorPerf = happen.createNode('monitor-performance');
  
  // Logger accepts events from anyone
  const logger = happen.createNode('logger', { acceptFrom: ['*'] });
  
  // Set up handlers
  const workers = [workerA, workerB, workerC];
  workers.forEach(worker => {
    // Workers handle tasks
    worker.on('task', (event) => {
      const { taskId, type } = event.payload as { taskId: string; type: string };
      console.log(`[${worker.id}] Processing task ${taskId} of type ${type}`);
      return { 
        workerId: worker.id, 
        taskId, 
        completedAt: Date.now() 
      };
    });
    
    // Workers respond to health checks
    worker.on('health-check', (event) => {
      console.log(`[${worker.id}] Health check from ${event.context.causal.sender}`);
      return { 
        workerId: worker.id,
        status: 'healthy',
        uptime: process.uptime()
      };
    });
    
    // Workers handle configuration updates
    worker.on('config-update', (event) => {
      const { setting, value } = event.payload as { setting: string; value: any };
      console.log(`[${worker.id}] Config update: ${setting} = ${value}`);
    });
  });
  
  // Logger logs everything
  logger.on('*', (event) => {
    console.log(`[LOGGER] ${event.type} from ${event.context.causal.sender}`);
  });
  
  // Monitoring services
  monitorHealth.on('collect-health', async () => {
    console.log('\n[Health Monitor] Collecting health status...');
    
    // Broadcast health check to all workers
    const responses = [];
    for (const worker of workers) {
      try {
        const response = await monitorHealth.send(worker, {
          type: 'health-check',
          payload: {}
        }).return();
        responses.push(response);
      } catch (error) {
        responses.push({ 
          workerId: worker.id, 
          status: 'unreachable',
          error: error.message
        });
      }
    }
    
    return { healthStatus: responses };
  });
  
  // Test 1: Direct task distribution
  console.log('--- Test 1: Direct Task Distribution ---');
  const taskResults = await Promise.all(
    workers.map((worker, index) => 
      coordinator.send(worker, {
        type: 'task',
        payload: { 
          taskId: `task-${index + 1}`,
          type: 'compute'
        }
      }).return()
    )
  );
  console.log('Task results:', taskResults);
  
  // Test 2: Broadcast configuration update
  console.log('\n--- Test 2: Broadcast Configuration ---');
  await coordinator.broadcast({
    type: 'config-update',
    payload: {
      setting: 'processing-timeout',
      value: 30000
    }
  });
  
  
  // Test 3: Health monitoring with acceptance control
  console.log('\n--- Test 3: Health Monitoring ---');
  const healthReport = await monitorHealth.send(monitorHealth, {
    type: 'collect-health',
    payload: {}
  }).return();
  console.log('Health report:', JSON.stringify(healthReport, null, 2));
  
  // Test 4: Pattern-based routing with wildcards
  console.log('\n--- Test 4: Pattern-Based Routing ---');
  
  // Create topic-based nodes
  const alertNodes = [
    happen.createNode('alert-critical'),
    happen.createNode('alert-warning'),
    happen.createNode('alert-info')
  ];
  
  alertNodes.forEach(node => {
    node.on('alert', (event) => {
      const level = node.id.split('-')[2]; // node-alert-critical-timestamp-hash
      console.log(`[${node.id}] ${level?.toUpperCase()}: ${(event.payload as any).message}`);
    });
  });
  
  // Route alerts based on severity
  const alertRouter = happen.createNode('alert-router');
  alertRouter.on('route-alert', async (event) => {
    const { severity, message } = event.payload as { severity: string; message: string };
    
    // Find matching alert node
    const targetNode = alertNodes.find(node => 
      node.id.includes(severity.toLowerCase())
    );
    
    if (targetNode) {
      await alertRouter.send(targetNode, {
        type: 'alert',
        payload: { message, timestamp: Date.now() }
      });
    } else {
      console.log(`No handler for severity: ${severity}`);
    }
  });
  
  // Send different severity alerts
  await alertRouter.emit({
    type: 'route-alert',
    payload: { severity: 'critical', message: 'Database connection lost!' }
  });
  
  await alertRouter.emit({
    type: 'route-alert',
    payload: { severity: 'warning', message: 'High memory usage detected' }
  });
  
  await alertRouter.emit({
    type: 'route-alert',
    payload: { severity: 'info', message: 'Backup completed successfully' }
  });
  
  
  console.log('\n✅ Broadcast and routing demo completed!');
}

main().catch(console.error);