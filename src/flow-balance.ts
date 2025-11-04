/**
 * Flow Balance - System health monitoring through message flow patterns
 *
 * Leverages NATS JetStream monitoring to detect:
 * - Network partitions
 * - Node failures
 * - Processing bottlenecks
 * - System overload
 */

import type { NatsConnectionManager } from './nats-connection.js';
import type { ConsumerInfo } from 'nats';

export interface FlowMetrics {
  /** Number of messages waiting to be delivered */
  messagesWaiting: number;
  /** Number of messages delivered */
  delivered: number;
  /** Number of pending acknowledgments */
  pending: number;
  /** Number of redelivered messages */
  redelivered: number;
  /** Timestamp of last check */
  timestamp: number;
}

export interface NodeImbalanceEvent {
  type: 'node.down';
  payload: {
    nodeId: string;
    lagMetrics: FlowMetrics;
    pattern: 'node-failure' | 'bottleneck';
    affectedNodes: string[];
  };
}

export interface SystemImbalanceEvent {
  type: 'system.down';
  payload: {
    level: 'warning' | 'critical';
    affectedNodes: string[];
    pattern: 'partition' | 'overload';
    metrics: { [nodeId: string]: FlowMetrics };
  };
}

export type FlowBalanceEvent = NodeImbalanceEvent | SystemImbalanceEvent;

/**
 * Configuration for Flow Balance monitoring
 */
export interface FlowBalanceConfig {
  /** Interval between health checks in milliseconds (default: 5000) */
  checkInterval?: number;
  /** Lag threshold for warnings (default: 500 messages) */
  warningThreshold?: number;
  /** Lag threshold for critical alerts (default: 1000 messages) */
  criticalThreshold?: number;
  /** Enable flow balance monitoring (default: true) */
  enabled?: boolean;
}

/**
 * Flow Balance Monitor
 * Monitors JetStream consumer health and emits events when issues are detected
 */
export class FlowBalanceMonitor {
  private natsManager: NatsConnectionManager;
  private config: FlowBalanceConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private metricsHistory: Map<string, FlowMetrics[]> = new Map();
  private eventEmitter: (event: FlowBalanceEvent) => Promise<void>;

  constructor(
    natsManager: NatsConnectionManager,
    config: FlowBalanceConfig = {},
    eventEmitter: (event: FlowBalanceEvent) => Promise<void>
  ) {
    this.natsManager = natsManager;
    this.config = {
      checkInterval: config.checkInterval || 5000,
      warningThreshold: config.warningThreshold || 500,
      criticalThreshold: config.criticalThreshold || 1000,
      enabled: config.enabled !== false
    };
    this.eventEmitter = eventEmitter;
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (!this.config.enabled || this.intervalId) {
      return;
    }

    this.intervalId = setInterval(async () => {
      try {
        await this.checkFlowBalance();
      } catch (error) {
        console.error('[FlowBalance] Error checking flow balance:', error);
      }
    }, this.config.checkInterval);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Check flow balance across all consumers
   */
  private async checkFlowBalance(): Promise<void> {
    try {
      const jsm = this.natsManager.getJetStreamManager();
      const streams = await jsm.streams.list().next();

      const allMetrics: Map<string, FlowMetrics> = new Map();

      // Collect metrics from all consumers
      for await (const streamInfo of streams) {
        const streamName = streamInfo.config.name;
        const consumers = await jsm.consumers.list(streamName).next();

        for await (const consumer of consumers) {
          const nodeId = this.extractNodeIdFromConsumer(consumer);
          if (nodeId) {
            const metrics = this.extractMetrics(consumer);
            allMetrics.set(nodeId, metrics);
            this.recordMetrics(nodeId, metrics);
          }
        }
      }

      // Analyze metrics and detect issues
      await this.analyzeMetrics(allMetrics);
    } catch (error: any) {
      // Silently fail if JetStream not available
      if (error.code !== 'ERR_NOT_FOUND') {
        throw error;
      }
    }
  }

  /**
   * Extract node ID from consumer name
   */
  private extractNodeIdFromConsumer(consumer: ConsumerInfo): string | null {
    // Consumer names typically follow pattern: node-{nodeId} or similar
    const name = consumer.name;
    if (name.startsWith('node-')) {
      return name.substring(5);
    }
    return name;
  }

  /**
   * Extract metrics from consumer info
   */
  private extractMetrics(consumer: ConsumerInfo): FlowMetrics {
    return {
      messagesWaiting: consumer.num_pending || 0,
      delivered: consumer.delivered?.stream_seq || 0,
      pending: consumer.num_ack_pending || 0,
      redelivered: consumer.num_redelivered || 0,
      timestamp: Date.now()
    };
  }

  /**
   * Record metrics in history for trend analysis
   */
  private recordMetrics(nodeId: string, metrics: FlowMetrics): void {
    if (!this.metricsHistory.has(nodeId)) {
      this.metricsHistory.set(nodeId, []);
    }

    const history = this.metricsHistory.get(nodeId)!;
    history.push(metrics);

    // Keep only last 10 metrics
    if (history.length > 10) {
      history.shift();
    }
  }

  /**
   * Analyze metrics and emit events for detected issues
   */
  private async analyzeMetrics(allMetrics: Map<string, FlowMetrics>): Promise<void> {
    const nodesWithIssues: string[] = [];
    const criticalNodes: string[] = [];

    // Check each node
    for (const [nodeId, metrics] of allMetrics.entries()) {
      if (metrics.messagesWaiting >= this.config.criticalThreshold!) {
        criticalNodes.push(nodeId);
        await this.emitNodeImbalance(nodeId, metrics, 'node-failure');
      } else if (metrics.messagesWaiting >= this.config.warningThreshold!) {
        nodesWithIssues.push(nodeId);
        await this.emitNodeImbalance(nodeId, metrics, 'bottleneck');
      }
    }

    // Check for system-wide issues
    if (criticalNodes.length > allMetrics.size * 0.5) {
      // More than 50% of nodes critical = system overload
      await this.emitSystemImbalance('critical', Array.from(allMetrics.keys()), 'overload', allMetrics);
    } else if (nodesWithIssues.length > allMetrics.size * 0.3) {
      // More than 30% of nodes with issues = potential partition
      await this.emitSystemImbalance('warning', nodesWithIssues, 'partition', allMetrics);
    }
  }

  /**
   * Emit node-specific imbalance event
   */
  private async emitNodeImbalance(
    nodeId: string,
    metrics: FlowMetrics,
    pattern: 'node-failure' | 'bottleneck'
  ): Promise<void> {
    const event: NodeImbalanceEvent = {
      type: 'node.down',
      payload: {
        nodeId,
        lagMetrics: metrics,
        pattern,
        affectedNodes: [nodeId]
      }
    };

    await this.eventEmitter(event);
  }

  /**
   * Emit system-wide imbalance event
   */
  private async emitSystemImbalance(
    level: 'warning' | 'critical',
    affectedNodes: string[],
    pattern: 'partition' | 'overload',
    allMetrics: Map<string, FlowMetrics>
  ): Promise<void> {
    const metricsObject: { [nodeId: string]: FlowMetrics } = {};
    for (const [nodeId, metrics] of allMetrics.entries()) {
      metricsObject[nodeId] = metrics;
    }

    const event: SystemImbalanceEvent = {
      type: 'system.down',
      payload: {
        level,
        affectedNodes,
        pattern,
        metrics: metricsObject
      }
    };

    await this.eventEmitter(event);
  }

  /**
   * Get current metrics for a node
   */
  getMetrics(nodeId: string): FlowMetrics | null {
    const history = this.metricsHistory.get(nodeId);
    return history && history.length > 0 ? history[history.length - 1] : null;
  }

  /**
   * Get metrics history for a node
   */
  getMetricsHistory(nodeId: string): FlowMetrics[] {
    return this.metricsHistory.get(nodeId) || [];
  }
}

/**
 * Helper to enable flow balance monitoring for a Happen instance
 */
export function enableFlowBalance(
  natsManager: NatsConnectionManager,
  broadcastEvent: (event: any) => Promise<void>,
  config?: FlowBalanceConfig
): FlowBalanceMonitor {
  const monitor = new FlowBalanceMonitor(
    natsManager,
    config,
    async (event) => {
      // Broadcast flow balance events to all nodes
      try {
        await broadcastEvent(event);
      } catch (error: any) {
        console.error('[FlowBalance] Error broadcasting event:', error);
      }
    }
  );

  monitor.start();
  return monitor;
}
