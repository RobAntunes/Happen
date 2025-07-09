/**
 * Flow Balance Tests
 * Tests the invisible resilience monitoring capabilities
 */

import { FlowBalanceMonitor, createFlowBalanceMonitor } from '../src/flow-balance';

describe('Flow Balance', () => {
  let mockJetStreamManager: any;
  let monitor: FlowBalanceMonitor;
  let emittedEvents: any[] = [];

  beforeEach(() => {
    // Mock JetStream manager
    mockJetStreamManager = {
      getStreamInfo: jest.fn(),
      getConsumerInfo: jest.fn(),
      createStream: jest.fn(),
      deleteStream: jest.fn(),
      createConsumer: jest.fn(),
      deleteConsumer: jest.fn(),
      purgeStream: jest.fn(),
    };

    // Reset emitted events
    emittedEvents = [];

    // Create monitor with event capture
    monitor = createFlowBalanceMonitor(
      mockJetStreamManager,
      { 
        enabled: true, 
        pollingInterval: 100, // Fast polling for tests
        thresholds: {
          minorLag: 10,
          moderateLag: 50,
          severeLag: 100,
          criticalLag: 500,
          maxProcessingTime: 5000,
          minAckRate: 0.9,
        }
      },
      (event) => {
        emittedEvents.push(event);
      }
    );
  });

  afterEach(() => {
    monitor.stop();
  });

  describe('Basic Monitoring', () => {
    it('should start and stop monitoring', () => {
      expect(() => {
        monitor.start();
        monitor.stop();
      }).not.toThrow();
    });

    it('should collect flow metrics', async () => {
      // Mock consumer info response
      mockJetStreamManager.getConsumerInfo.mockResolvedValue({
        delivered: { consumer_seq: 100, stream_seq: 100 },
        ack_floor: { consumer_seq: 95, stream_seq: 95 },
        num_redelivered: 2,
        created: Date.now() - 60000, // 1 minute ago
      });

      mockJetStreamManager.getStreamInfo.mockResolvedValue({
        state: { messages: 100 }
      });

      // Trigger manual check
      await monitor.checkFlowNow();

      // Check that metrics were collected
      const metrics = monitor.getFlowMetrics();
      expect(metrics.size).toBeGreaterThan(0);
      
      // Check metrics structure
      const firstMetric = Array.from(metrics.values())[0];
      expect(firstMetric).toHaveProperty('consumerLag');
      expect(firstMetric).toHaveProperty('processingRate');
      expect(firstMetric).toHaveProperty('ackRate');
    });
  });

  describe('Pattern Detection', () => {
    it('should detect node failure pattern', async () => {
      // Mock high lag for single consumer
      mockJetStreamManager.getConsumerInfo.mockResolvedValue({
        delivered: { consumer_seq: 1000, stream_seq: 1000 },
        ack_floor: { consumer_seq: 400, stream_seq: 400 }, // 600 lag
        num_redelivered: 10,
        created: Date.now() - 60000,
      });

      mockJetStreamManager.getStreamInfo.mockResolvedValue({
        state: { messages: 1000 }
      });

      await monitor.checkFlowNow();

      // Should detect node failure pattern
      const patterns = monitor.getDetectedPatterns();
      expect(patterns.size).toBeGreaterThan(0);
      
      const failurePattern = Array.from(patterns.values()).find(p => p.type === 'node-failure');
      expect(failurePattern).toBeDefined();
      expect(failurePattern?.severity).toBe('critical');
    });

    it('should detect bottleneck pattern', async () => {
      // Mock moderate lag with low processing rate
      mockJetStreamManager.getConsumerInfo.mockResolvedValue({
        delivered: { consumer_seq: 100, stream_seq: 100 },
        ack_floor: { consumer_seq: 40, stream_seq: 40 }, // 60 lag
        num_redelivered: 5,
        created: Date.now() - 300000, // 5 minutes ago (low processing rate)
      });

      mockJetStreamManager.getStreamInfo.mockResolvedValue({
        state: { messages: 100 }
      });

      await monitor.checkFlowNow();

      // Should detect bottleneck pattern
      const patterns = monitor.getDetectedPatterns();
      const bottleneckPattern = Array.from(patterns.values()).find(p => p.type === 'bottleneck');
      expect(bottleneckPattern).toBeDefined();
      expect(bottleneckPattern?.severity).toBe('moderate');
    });
  });

  describe('Event Emission', () => {
    it('should emit node.down events for node failures', async () => {
      // Create monitor with single test consumer
      const testMonitor = createFlowBalanceMonitor(
        mockJetStreamManager,
        { 
          enabled: true, 
          pollingInterval: 100,
          thresholds: {
            minorLag: 10,
            moderateLag: 50,
            severeLag: 100,
            criticalLag: 500,
            maxProcessingTime: 5000,
            minAckRate: 0.9,
          },
          testConsumers: ['happen-node-test-service'] // Single consumer for test
        },
        (event) => {
          emittedEvents.push(event);
        }
      );
      
      // Mock critical lag
      mockJetStreamManager.getConsumerInfo.mockResolvedValue({
        delivered: { consumer_seq: 1000, stream_seq: 1000 },
        ack_floor: { consumer_seq: 200, stream_seq: 200 }, // 800 lag
        num_redelivered: 15,
        created: Date.now() - 60000,
      });

      mockJetStreamManager.getStreamInfo.mockResolvedValue({
        state: { messages: 1000 }
      });

      await testMonitor.checkFlowNow();

      // Should emit node.down event
      const nodeDownEvents = emittedEvents.filter(e => e.type === 'node.down');
      expect(nodeDownEvents.length).toBeGreaterThan(0);
      
      const event = nodeDownEvents[0];
      expect(event.payload).toHaveProperty('nodeId');
      expect(event.payload).toHaveProperty('lagMetrics');
      expect(event.payload.pattern).toBe('node-failure');
    });

    it('should emit system.down events for system-wide issues', async () => {
      // Mock multiple consumers with moderate lag (system overload)
      mockJetStreamManager.getConsumerInfo.mockResolvedValue({
        delivered: { consumer_seq: 200, stream_seq: 200 },
        ack_floor: { consumer_seq: 150, stream_seq: 150 }, // 50 lag
        num_redelivered: 5,
        created: Date.now() - 60000,
      });

      mockJetStreamManager.getStreamInfo.mockResolvedValue({
        state: { messages: 200 }
      });

      // Simulate multiple consumers returning similar data
      await monitor.checkFlowNow();

      // Should emit system.down event for overload
      const systemDownEvents = emittedEvents.filter(e => e.type === 'system.down');
      expect(systemDownEvents.length).toBeGreaterThan(0);
      
      const event = systemDownEvents[0];
      expect(event.payload).toHaveProperty('level');
      expect(event.payload).toHaveProperty('affectedNodes');
      expect(event.payload.pattern).toBe('overload');
    });
  });

  describe('Node State Tracking', () => {
    it('should track node health states', async () => {
      // Mock healthy consumer
      mockJetStreamManager.getConsumerInfo.mockResolvedValue({
        delivered: { consumer_seq: 100, stream_seq: 100 },
        ack_floor: { consumer_seq: 98, stream_seq: 98 }, // 2 lag (healthy)
        num_redelivered: 0,
        created: Date.now() - 60000,
      });

      mockJetStreamManager.getStreamInfo.mockResolvedValue({
        state: { messages: 100 }
      });

      await monitor.checkFlowNow();

      // Check node states
      const nodeStates = monitor.getNodeStates();
      expect(nodeStates.size).toBeGreaterThan(0);
      
      const firstState = Array.from(nodeStates.values())[0];
      expect(['healthy', 'degraded', 'unhealthy']).toContain(firstState);
    });

    it('should update node states based on metrics', async () => {
      // Create monitor with single test consumer
      const testMonitor = createFlowBalanceMonitor(
        mockJetStreamManager,
        { 
          enabled: true, 
          pollingInterval: 100,
          thresholds: {
            minorLag: 10,
            moderateLag: 50,
            severeLag: 100,
            criticalLag: 500,
            maxProcessingTime: 5000,
            minAckRate: 0.9,
          },
          testConsumers: ['happen-node-test-service']
        },
        (event) => {
          emittedEvents.push(event);
        }
      );
      
      // First check - healthy
      mockJetStreamManager.getConsumerInfo.mockResolvedValue({
        delivered: { consumer_seq: 100, stream_seq: 100 },
        ack_floor: { consumer_seq: 98, stream_seq: 98 }, // 2 lag
        num_redelivered: 0,
        created: Date.now() - 60000,
      });

      mockJetStreamManager.getStreamInfo.mockResolvedValue({
        state: { messages: 100 }
      });

      await testMonitor.checkFlowNow();

      let nodeStates = testMonitor.getNodeStates();
      const nodeId = Array.from(nodeStates.keys())[0];
      expect(nodeId).toBeDefined();
      expect(nodeStates.get(nodeId!)).toBe('healthy');

      // Second check - degraded
      mockJetStreamManager.getConsumerInfo.mockResolvedValue({
        delivered: { consumer_seq: 200, stream_seq: 200 },
        ack_floor: { consumer_seq: 140, stream_seq: 140 }, // 60 lag
        num_redelivered: 3,
        created: Date.now() - 60000,
      });

      await testMonitor.checkFlowNow();
      
      nodeStates = testMonitor.getNodeStates();
      expect(nodeStates.get(nodeId!)).toBe('degraded');
    });
  });

  describe('Configuration', () => {
    it('should respect threshold configuration', async () => {
      // Create monitor with custom thresholds
      const customMonitor = createFlowBalanceMonitor(
        mockJetStreamManager,
        {
          thresholds: {
            minorLag: 5,
            moderateLag: 20,
            severeLag: 50,
            criticalLag: 100,
            maxProcessingTime: 10000,
            minAckRate: 0.8,
          },
          testConsumers: ['happen-node-test-service']
        }
      );

      // Mock lag that would be moderate with default thresholds
      mockJetStreamManager.getConsumerInfo.mockResolvedValue({
        delivered: { consumer_seq: 100, stream_seq: 100 },
        ack_floor: { consumer_seq: 70, stream_seq: 70 }, // 30 lag
        num_redelivered: 2,
        created: Date.now() - 60000,
      });

      mockJetStreamManager.getStreamInfo.mockResolvedValue({
        state: { messages: 100 }
      });

      await customMonitor.checkFlowNow();

      // Check that the custom thresholds are being used
      const nodeStates = customMonitor.getNodeStates();
      const nodeId = Array.from(nodeStates.keys())[0];
      // With lag of 30 and custom moderateLag of 20, node should be degraded
      expect(nodeStates.get(nodeId!)).toBe('degraded');

      customMonitor.stop();
    });

    it('should disable monitoring when configured', () => {
      const disabledMonitor = createFlowBalanceMonitor(
        mockJetStreamManager,
        { enabled: false }
      );

      expect(() => {
        disabledMonitor.start();
        disabledMonitor.stop();
      }).not.toThrow();
    });
  });
});