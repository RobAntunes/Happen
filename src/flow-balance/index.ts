/**
 * Flow Balance - Invisible resilience monitoring through NATS JetStream
 * 
 * Flow Balance leverages NATS JetStream's built-in monitoring capabilities
 * to detect system issues through natural message flow patterns.
 */

import { JetStreamManager } from '../transport/jetstream';
import { HappenEvent } from '../types';
import { createEvent } from '../events';

export interface FlowMetrics {
  consumerLag: number;
  messagesWaiting: number;
  processingRate: number;
  ackRate: number;
  deliveryFailures: number;
  lastActivity: number;
}

export interface FlowPattern {
  type: 'partition' | 'node-failure' | 'bottleneck' | 'overload';
  severity: 'minor' | 'moderate' | 'severe' | 'critical';
  confidence: number;
  affectedNodes: string[];
  metrics: FlowMetrics;
  detectedAt: number;
}

export interface FlowBalanceConfig {
  enabled: boolean;
  pollingInterval: number; // milliseconds
  thresholds: {
    minorLag: number;
    moderateLag: number;
    severeLag: number;
    criticalLag: number;
    maxProcessingTime: number;
    minAckRate: number;
  };
  streamName: string;
  consumerPrefix: string;
  testConsumers?: string[]; // For testing - override consumer list
}

export const DEFAULT_FLOW_BALANCE_CONFIG: FlowBalanceConfig = {
  enabled: true,
  pollingInterval: 5000, // 5 seconds
  thresholds: {
    minorLag: 100,
    moderateLag: 500,
    severeLag: 1000,
    criticalLag: 5000,
    maxProcessingTime: 30000, // 30 seconds
    minAckRate: 0.9, // 90%
  },
  streamName: 'HAPPEN_EVENTS',
  consumerPrefix: 'happen-node-',
};

/**
 * Flow Balance Monitor - Invisible monitoring system
 */
export class FlowBalanceMonitor {
  private config: FlowBalanceConfig;
  private jsm: JetStreamManager;
  private pollingTimer: NodeJS.Timeout | null = null;
  private metrics = new Map<string, FlowMetrics>();
  private patterns = new Map<string, FlowPattern>();
  private eventEmitter: ((event: HappenEvent) => void) | null = null;
  private nodeStates = new Map<string, 'healthy' | 'degraded' | 'unhealthy'>();
  
  constructor(
    jetStreamManager: JetStreamManager,
    config: Partial<FlowBalanceConfig> = {},
    eventEmitter?: (event: HappenEvent) => void
  ) {
    this.jsm = jetStreamManager;
    this.config = { ...DEFAULT_FLOW_BALANCE_CONFIG, ...config };
    this.eventEmitter = eventEmitter || null;
  }

  /**
   * Start Flow Balance monitoring
   */
  start(): void {
    if (!this.config.enabled) {
      return;
    }

    this.pollingTimer = setInterval(() => {
      this.checkFlowHealth().catch(error => {
        console.error('Flow Balance monitoring error:', error);
      });
    }, this.config.pollingInterval);

    console.log('Flow Balance monitoring started');
  }

  /**
   * Stop Flow Balance monitoring
   */
  stop(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    console.log('Flow Balance monitoring stopped');
  }

  /**
   * Check flow health across all consumers
   */
  private async checkFlowHealth(): Promise<void> {
    try {
      // Get stream info first
      const streamInfo = await this.jsm.getStreamInfo(this.config.streamName);
      if (!streamInfo) {
        return;
      }

      // Get list of consumers (in real implementation, this would be dynamic)
      const consumers = await this.getActiveConsumers();
      
      // Check each consumer
      for (const consumerName of consumers) {
        await this.checkConsumerHealth(consumerName);
      }

      // Analyze patterns across all consumers
      this.analyzeFlowPatterns();
      
      // Emit events for detected issues
      this.emitImbalanceEvents();
      
    } catch (error) {
      console.error('Flow Balance health check failed:', error);
    }
  }

  /**
   * Check individual consumer health
   */
  private async checkConsumerHealth(consumerName: string): Promise<void> {
    try {
      const consumerInfo = await this.jsm.getConsumerInfo(this.config.streamName, consumerName);
      if (!consumerInfo) {
        return;
      }

      const metrics = this.extractFlowMetrics(consumerInfo);
      this.metrics.set(consumerName, metrics);
      
      // Update node state based on metrics
      this.updateNodeState(consumerName, metrics);
      
    } catch (error) {
      console.error(`Failed to check consumer ${consumerName}:`, error);
    }
  }

  /**
   * Extract flow metrics from consumer info
   */
  private extractFlowMetrics(consumerInfo: any): FlowMetrics {
    const delivered = consumerInfo.delivered || { consumer_seq: 0, stream_seq: 0 };
    const ackFloor = consumerInfo.ack_floor || { consumer_seq: 0, stream_seq: 0 };
    
    // Calculate lag (messages delivered but not acknowledged)
    const consumerLag = delivered.consumer_seq - ackFloor.consumer_seq;
    
    // Calculate approximate processing rate (simplified)
    const processingRate = delivered.consumer_seq / Math.max(1, (Date.now() - (consumerInfo.created || Date.now())) / 1000);
    
    // Calculate ack rate
    const ackRate = ackFloor.consumer_seq / Math.max(1, delivered.consumer_seq);
    
    return {
      consumerLag,
      messagesWaiting: consumerLag,
      processingRate,
      ackRate,
      deliveryFailures: consumerInfo.num_redelivered || 0,
      lastActivity: Date.now(),
    };
  }

  /**
   * Update node state based on metrics
   */
  private updateNodeState(consumerName: string, metrics: FlowMetrics): void {
    const nodeId = this.extractNodeId(consumerName);
    let state: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (metrics.consumerLag >= this.config.thresholds.criticalLag) {
      state = 'unhealthy';
    } else if (metrics.consumerLag >= this.config.thresholds.moderateLag) {
      state = 'degraded';
    } else if (metrics.ackRate < this.config.thresholds.minAckRate) {
      state = 'degraded';
    }
    
    const previousState = this.nodeStates.get(nodeId);
    this.nodeStates.set(nodeId, state);
    if (previousState !== state) {
      console.log(`Node ${nodeId} state changed: ${previousState} -> ${state}`);
    }
  }

  /**
   * Analyze flow patterns to detect system issues
   */
  private analyzeFlowPatterns(): void {
    const nodes = Array.from(this.metrics.keys());
    const currentTime = Date.now();
    
    // Clear old patterns
    this.patterns.clear();
    
    // Check for network partition pattern
    this.detectNetworkPartition(nodes, currentTime);
    
    // Check for node failure pattern  
    this.detectNodeFailures(nodes, currentTime);
    
    // Check for bottleneck pattern
    this.detectBottlenecks(nodes, currentTime);
    
    // Check for system overload pattern
    this.detectSystemOverload(nodes, currentTime);
  }

  /**
   * Detect network partition pattern
   */
  private detectNetworkPartition(nodes: string[], currentTime: number): void {
    const unhealthyNodes = nodes.filter(node => {
      const metrics = this.metrics.get(node);
      return metrics && metrics.consumerLag >= this.config.thresholds.severeLag;
    });
    
    // Network partition: Multiple nodes suddenly become unhealthy
    if (unhealthyNodes.length >= 2) {
      const avgLag = unhealthyNodes.reduce((sum, node) => {
        const metrics = this.metrics.get(node)!;
        return sum + metrics.consumerLag;
      }, 0) / unhealthyNodes.length;
      
      this.patterns.set('network-partition', {
        type: 'partition',
        severity: unhealthyNodes.length >= nodes.length / 2 ? 'critical' : 'severe',
        confidence: unhealthyNodes.length / nodes.length,
        affectedNodes: unhealthyNodes.map(node => this.extractNodeId(node)),
        metrics: {
          consumerLag: avgLag,
          messagesWaiting: avgLag,
          processingRate: 0,
          ackRate: 0,
          deliveryFailures: 0,
          lastActivity: currentTime,
        },
        detectedAt: currentTime,
      });
    }
  }

  /**
   * Detect node failure pattern
   */
  private detectNodeFailures(nodes: string[], currentTime: number): void {
    nodes.forEach(consumerName => {
      const metrics = this.metrics.get(consumerName);
      if (!metrics) return;
      
      const nodeId = this.extractNodeId(consumerName);
      
      // Node failure: Single node with critical lag
      if (metrics.consumerLag >= this.config.thresholds.criticalLag) {
        this.patterns.set(`node-failure-${nodeId}`, {
          type: 'node-failure',
          severity: 'critical',
          confidence: 0.9,
          affectedNodes: [nodeId],
          metrics,
          detectedAt: currentTime,
        });
      }
    });
  }

  /**
   * Detect bottleneck pattern
   */
  private detectBottlenecks(nodes: string[], currentTime: number): void {
    nodes.forEach(consumerName => {
      const metrics = this.metrics.get(consumerName);
      if (!metrics) return;
      
      const nodeId = this.extractNodeId(consumerName);
      
      // Bottleneck: Gradually increasing lag with low processing rate
      if (metrics.consumerLag >= this.config.thresholds.moderateLag && 
          metrics.processingRate < 1.0) {
        this.patterns.set(`bottleneck-${nodeId}`, {
          type: 'bottleneck',
          severity: metrics.consumerLag >= this.config.thresholds.severeLag ? 'severe' : 'moderate',
          confidence: 0.8,
          affectedNodes: [nodeId],
          metrics,
          detectedAt: currentTime,
        });
      }
    });
  }

  /**
   * Detect system overload pattern
   */
  private detectSystemOverload(nodes: string[], currentTime: number): void {
    const degradedNodes = nodes.filter(node => {
      const metrics = this.metrics.get(node);
      return metrics && metrics.consumerLag >= this.config.thresholds.minorLag;
    });
    
    // System overload: Most nodes have some lag
    if (degradedNodes.length >= nodes.length * 0.7) {
      const avgLag = degradedNodes.reduce((sum, node) => {
        const metrics = this.metrics.get(node)!;
        return sum + metrics.consumerLag;
      }, 0) / degradedNodes.length;
      
      this.patterns.set('system-overload', {
        type: 'overload',
        severity: avgLag >= this.config.thresholds.severeLag ? 'severe' : 'moderate',
        confidence: degradedNodes.length / nodes.length,
        affectedNodes: degradedNodes.map(node => this.extractNodeId(node)),
        metrics: {
          consumerLag: avgLag,
          messagesWaiting: avgLag,
          processingRate: 0,
          ackRate: 0,
          deliveryFailures: 0,
          lastActivity: currentTime,
        },
        detectedAt: currentTime,
      });
    }
  }

  /**
   * Emit imbalance events for detected patterns
   */
  private emitImbalanceEvents(): void {
    if (!this.eventEmitter) {
      return;
    }

    this.patterns.forEach((pattern) => {
      if (pattern.type === 'node-failure' || pattern.type === 'bottleneck') {
        // Emit node-specific events
        const nodeDownEvent = createEvent('node.down', {
          nodeId: pattern.affectedNodes[0],
          lagMetrics: {
            messagesWaiting: pattern.metrics.messagesWaiting,
            consumerLag: pattern.metrics.consumerLag,
            processingRate: pattern.metrics.processingRate,
            ackRate: pattern.metrics.ackRate,
          },
          pattern: pattern.type,
          severity: pattern.severity,
          confidence: pattern.confidence,
          detectedAt: pattern.detectedAt,
        });
        
        this.eventEmitter!(nodeDownEvent);
        
      } else if (pattern.type === 'partition' || pattern.type === 'overload') {
        // Emit system-wide events
        const systemDownEvent = createEvent('system.down', {
          level: pattern.severity,
          affectedNodes: pattern.affectedNodes,
          pattern: pattern.type,
          metrics: pattern.metrics,
          confidence: pattern.confidence,
          detectedAt: pattern.detectedAt,
        });
        
        this.eventEmitter!(systemDownEvent);
      }
    });
  }

  /**
   * Get active consumers (simplified - in real implementation this would be dynamic)
   */
  private async getActiveConsumers(): Promise<string[]> {
    // In a real implementation, this would query JetStream for active consumers
    
    // For testing - use override if provided
    if (this.config.testConsumers) {
      return this.config.testConsumers;
    }
    
    // Default list for production
    return [
      'happen-node-order-service',
      'happen-node-payment-service',
      'happen-node-inventory-service',
      'happen-node-notification-service',
    ];
  }

  /**
   * Extract node ID from consumer name
   */
  private extractNodeId(consumerName: string): string {
    return consumerName.replace(this.config.consumerPrefix, '');
  }

  /**
   * Get current flow metrics for all nodes
   */
  getFlowMetrics(): Map<string, FlowMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Get detected patterns
   */
  getDetectedPatterns(): Map<string, FlowPattern> {
    return new Map(this.patterns);
  }

  /**
   * Get node health states
   */
  getNodeStates(): Map<string, 'healthy' | 'degraded' | 'unhealthy'> {
    return new Map(this.nodeStates);
  }

  /**
   * Manual flow balance check (for testing)
   */
  async checkFlowNow(): Promise<void> {
    await this.checkFlowHealth();
  }
}

/**
 * Create Flow Balance monitor
 */
export function createFlowBalanceMonitor(
  jetStreamManager: JetStreamManager,
  config?: Partial<FlowBalanceConfig>,
  eventEmitter?: (event: HappenEvent) => void
): FlowBalanceMonitor {
  return new FlowBalanceMonitor(jetStreamManager, config, eventEmitter);
}