/**
 * NATS subject routing and management
 */

import { HappenEvent, ID } from '../types';

/**
 * Subject patterns for different event types
 */
export const SUBJECT_PATTERNS = {
  // Node-to-node events
  EVENTS: 'happen.events',
  NODE_EVENTS: 'happen.events.node',
  
  // State synchronization
  STATE: 'happen.state',
  STATE_UPDATES: 'happen.state.updates',
  STATE_SNAPSHOTS: 'happen.state.snapshots',
  
  // System events
  SYSTEM: 'happen.system',
  NODE_STATUS: 'happen.system.node.status',
  HEALTH: 'happen.system.health',
  
  // Request/Reply patterns
  REQUESTS: 'happen.req',
  RESPONSES: 'happen.resp',
  
  // Administrative
  ADMIN: 'happen.admin',
  METRICS: 'happen.admin.metrics',
} as const;

/**
 * Subject builder utility
 */
export class SubjectBuilder {
  /**
   * Build subject for event broadcasting
   */
  static event(eventType: string): string {
    return `${SUBJECT_PATTERNS.EVENTS}.${eventType}`;
  }

  /**
   * Build subject for node-specific events
   */
  static nodeEvent(nodeId: ID, eventType: string): string {
    return `${SUBJECT_PATTERNS.NODE_EVENTS}.${nodeId}.${eventType}`;
  }

  /**
   * Build subject for state updates
   */
  static stateUpdate(nodeId: ID): string {
    return `${SUBJECT_PATTERNS.STATE_UPDATES}.${nodeId}`;
  }

  /**
   * Build subject for state snapshots
   */
  static stateSnapshot(nodeId: ID): string {
    return `${SUBJECT_PATTERNS.STATE_SNAPSHOTS}.${nodeId}`;
  }

  /**
   * Build subject for node status
   */
  static nodeStatus(nodeId: ID): string {
    return `${SUBJECT_PATTERNS.NODE_STATUS}.${nodeId}`;
  }

  /**
   * Build subject for requests
   */
  static request(requestType: string): string {
    return `${SUBJECT_PATTERNS.REQUESTS}.${requestType}`;
  }

  /**
   * Build subject for responses
   */
  static response(requestId: string): string {
    return `${SUBJECT_PATTERNS.RESPONSES}.${requestId}`;
  }

  /**
   * Build subject for metrics
   */
  static metrics(nodeId: ID): string {
    return `${SUBJECT_PATTERNS.METRICS}.${nodeId}`;
  }

  /**
   * Build subject for health checks
   */
  static health(): string {
    return SUBJECT_PATTERNS.HEALTH;
  }

  /**
   * Build wildcard subject for all events
   */
  static allEvents(): string {
    return `${SUBJECT_PATTERNS.EVENTS}.*`;
  }

  /**
   * Build wildcard subject for all node events
   */
  static allNodeEvents(nodeId?: ID): string {
    if (nodeId) {
      return `${SUBJECT_PATTERNS.NODE_EVENTS}.${nodeId}.*`;
    }
    return `${SUBJECT_PATTERNS.NODE_EVENTS}.*`;
  }

  /**
   * Build wildcard subject for all state updates
   */
  static allStateUpdates(): string {
    return `${SUBJECT_PATTERNS.STATE_UPDATES}.*`;
  }
}

/**
 * Subject parser utility
 */
export class SubjectParser {
  /**
   * Parse event subject to extract components
   */
  static parseEventSubject(subject: string): {
    pattern: string;
    eventType?: string;
    nodeId?: ID;
  } | null {
    // happen.events.{eventType}
    const eventMatch = subject.match(/^happen\.events\.(.+)$/);
    if (eventMatch) {
      return {
        pattern: SUBJECT_PATTERNS.EVENTS,
        eventType: eventMatch[1],
      };
    }

    // happen.events.node.{nodeId}.{eventType}
    const nodeEventMatch = subject.match(/^happen\.events\.node\.([^.]+)\.(.+)$/);
    if (nodeEventMatch) {
      return {
        pattern: SUBJECT_PATTERNS.NODE_EVENTS,
        nodeId: nodeEventMatch[1] as ID,
        eventType: nodeEventMatch[2],
      };
    }

    return null;
  }

  /**
   * Parse state subject to extract components
   */
  static parseStateSubject(subject: string): {
    pattern: string;
    operation?: 'update' | 'snapshot';
    nodeId?: ID;
  } | null {
    // happen.state.updates.{nodeId}
    const updateMatch = subject.match(/^happen\.state\.updates\.([^.]+)$/);
    if (updateMatch) {
      return {
        pattern: SUBJECT_PATTERNS.STATE_UPDATES,
        operation: 'update',
        nodeId: updateMatch[1] as ID,
      };
    }

    // happen.state.snapshots.{nodeId}
    const snapshotMatch = subject.match(/^happen\.state\.snapshots\.([^.]+)$/);
    if (snapshotMatch) {
      return {
        pattern: SUBJECT_PATTERNS.STATE_SNAPSHOTS,
        operation: 'snapshot',
        nodeId: snapshotMatch[1] as ID,
      };
    }

    return null;
  }

  /**
   * Check if subject is a system subject
   */
  static isSystemSubject(subject: string): boolean {
    return subject.startsWith(SUBJECT_PATTERNS.SYSTEM);
  }

  /**
   * Check if subject is an admin subject
   */
  static isAdminSubject(subject: string): boolean {
    return subject.startsWith(SUBJECT_PATTERNS.ADMIN);
  }
}

/**
 * Event routing utilities
 */
export class EventRouter {
  /**
   * Determine appropriate subject for an event
   */
  static getSubjectForEvent(event: HappenEvent, targetNodeId?: ID): string {
    // System events go to system subjects
    if (event.type.startsWith('system.')) {
      if (event.type === 'system.node.status') {
        return SubjectBuilder.nodeStatus(event.context.causal.sender);
      }
      return `${SUBJECT_PATTERNS.SYSTEM}.${event.type.substring(7)}`;
    }

    // Node-specific delivery
    if (targetNodeId) {
      return SubjectBuilder.nodeEvent(targetNodeId, event.type);
    }

    // Broadcast to all nodes
    return SubjectBuilder.event(event.type);
  }

  /**
   * Get subjects to subscribe to for a node
   */
  static getSubscriptionSubjects(nodeId: ID): string[] {
    return [
      // All broadcast events
      SubjectBuilder.allEvents(),
      
      // Node-specific events
      SubjectBuilder.allNodeEvents(nodeId),
      
      // System events
      `${SUBJECT_PATTERNS.SYSTEM}.*`,
      
      // Health checks
      SubjectBuilder.health(),
    ];
  }

  /**
   * Filter subjects based on node configuration
   */
  static filterSubjects(subjects: string[], nodeConfig: any): string[] {
    // Basic filtering - can be extended based on node configuration
    return subjects.filter(subject => {
      // Always allow system subjects
      if (SubjectParser.isSystemSubject(subject)) {
        return true;
      }

      // Apply custom filters if configured
      if (nodeConfig.subjectFilter) {
        return nodeConfig.subjectFilter(subject);
      }

      return true;
    });
  }
}

/**
 * Subject validation utilities
 */
export class SubjectValidator {
  /**
   * Validate subject format
   */
  static isValidSubject(subject: string): boolean {
    // NATS subject rules: alphanumeric, dots, dashes, underscores
    return /^[a-zA-Z0-9._-]+$/.test(subject) && subject.length > 0;
  }

  /**
   * Validate wildcard subject
   */
  static isValidWildcardSubject(subject: string): boolean {
    // Allow * and > wildcards in addition to regular characters
    return /^[a-zA-Z0-9._*>-]+$/.test(subject) && subject.length > 0;
  }

  /**
   * Check if subject matches pattern
   */
  static matchesPattern(subject: string, pattern: string): boolean {
    // Convert NATS wildcard pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '[^.]+')
      .replace(/>/g, '.*');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(subject);
  }
}