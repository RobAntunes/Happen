/**
 * Resilience patterns for error handling and recovery
 * Implements Circuit Breaker, Bulkhead, and Supervisor patterns
 */

import { EventHandler, HappenEvent, HandlerContext } from '../types';
// import { generateId } from '../utils/id';

/**
 * Circuit Breaker State
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit Breaker Configuration
 */
export interface CircuitBreakerConfig {
  name: string;
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  fallbackHandler?: EventHandler;
}

/**
 * Circuit Breaker Implementation
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private nextAttempt = 0;
  
  constructor(private config: CircuitBreakerConfig) {}
  
  async execute(handler: EventHandler, eventOrEvents: HappenEvent | HappenEvent[], context: HandlerContext): Promise<any> {
    if (this.state === 'open') {
      if (Date.now() < this.nextAttempt) {
        // Circuit is open, use fallback if available
        if (this.config.fallbackHandler) {
          return await this.config.fallbackHandler(eventOrEvents, context);
        }
        throw new Error(`Circuit breaker ${this.config.name} is open`);
      }
      // Time to try again
      this.state = 'half-open';
      this.successes = 0;
    }
    
    try {
      const result = await handler(eventOrEvents, context);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failures = 0;
    
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = 'closed';
        this.successes = 0;
      }
    }
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.config.failureThreshold) {
      this.state = 'open';
      this.nextAttempt = Date.now() + this.config.timeout;
    }
  }
  
  getState(): { state: CircuitState; failures: number; successes: number; lastFailureTime: number } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime
    };
  }
}

/**
 * Global circuit breaker registry
 */
class CircuitBreakerRegistry {
  private circuits = new Map<string, CircuitBreaker>();
  
  get(name: string): CircuitBreaker | undefined {
    return this.circuits.get(name);
  }
  
  create(config: CircuitBreakerConfig): CircuitBreaker {
    const circuit = new CircuitBreaker(config);
    this.circuits.set(config.name, circuit);
    return circuit;
  }
  
  getOrCreate(config: CircuitBreakerConfig): CircuitBreaker {
    return this.get(config.name) || this.create(config);
  }
  
  list(): Array<{ name: string; state: CircuitState; failures: number; successes: number }> {
    return Array.from(this.circuits.entries()).map(([name, circuit]) => ({
      name,
      ...circuit.getState()
    }));
  }
}

const circuitRegistry = new CircuitBreakerRegistry();

/**
 * Bulkhead Pattern - Isolate failures
 */
export class Bulkhead {
  private semaphore: number;
  private maxConcurrent: number;
  private queue: Array<{ resolve: (value: any) => void; reject: (error: any) => void; task: () => Promise<any> }> = [];
  
  constructor(maxConcurrent: number = 10) {
    this.maxConcurrent = maxConcurrent;
    this.semaphore = maxConcurrent;
  }
  
  async execute<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const queueItem = {
        resolve,
        reject,
        task: task as () => Promise<any>
      };
      
      if (this.semaphore > 0) {
        this.executeTask(queueItem);
      } else {
        this.queue.push(queueItem);
      }
    });
  }
  
  private async executeTask(queueItem: { resolve: (value: any) => void; reject: (error: any) => void; task: () => Promise<any> }): Promise<void> {
    this.semaphore--;
    
    try {
      const result = await queueItem.task();
      queueItem.resolve(result);
    } catch (error) {
      queueItem.reject(error);
    } finally {
      this.semaphore++;
      
      // Process next item in queue
      if (this.queue.length > 0) {
        const nextItem = this.queue.shift()!;
        this.executeTask(nextItem);
      }
    }
  }
  
  getStats(): { available: number; queued: number; maxConcurrent: number } {
    return {
      available: this.semaphore,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent
    };
  }
}

/**
 * Supervisor Pattern - System-wide error monitoring
 */
export interface SupervisorConfig {
  errorThreshold: number;
  timeWindow: number; // milliseconds
  restartDelay: number; // milliseconds
  maxRestarts: number;
}

export interface ServiceHealth {
  serviceName: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  errorCount: number;
  lastError?: Date;
  restartCount: number;
  lastRestart?: Date;
}

export class Supervisor {
  private services = new Map<string, ServiceHealth>();
  private errorHistory = new Map<string, Array<{ timestamp: number; error: Error }>>();
  private restartCallbacks = new Map<string, () => Promise<void>>();
  
  constructor(private config: SupervisorConfig) {}
  
  /**
   * Register a service for monitoring
   */
  monitor(serviceName: string, restartCallback?: () => Promise<void>): void {
    this.services.set(serviceName, {
      serviceName,
      status: 'healthy',
      errorCount: 0,
      restartCount: 0
    });
    
    if (restartCallback) {
      this.restartCallbacks.set(serviceName, restartCallback);
    }
  }
  
  /**
   * Report an error for a service
   */
  reportError(serviceName: string, error: Error): void {
    // Initialize service if not exists
    if (!this.services.has(serviceName)) {
      this.monitor(serviceName);
    }
    
    const service = this.services.get(serviceName)!;
    service.errorCount++;
    service.lastError = new Date();
    
    // Add to error history
    if (!this.errorHistory.has(serviceName)) {
      this.errorHistory.set(serviceName, []);
    }
    
    const history = this.errorHistory.get(serviceName)!;
    history.push({ timestamp: Date.now(), error });
    
    // Clean old errors outside time window
    const cutoff = Date.now() - this.config.timeWindow;
    const recentErrors = history.filter(e => e.timestamp > cutoff);
    this.errorHistory.set(serviceName, recentErrors);
    
    // Update service status
    if (recentErrors.length >= this.config.errorThreshold) {
      service.status = 'unhealthy';
      this.attemptRestart(serviceName);
    } else if (recentErrors.length >= this.config.errorThreshold / 2) {
      service.status = 'degraded';
    }
    
    this.services.set(serviceName, service);
  }
  
  /**
   * Attempt to restart a service
   */
  private async attemptRestart(serviceName: string): Promise<void> {
    const service = this.services.get(serviceName)!;
    
    if (service.restartCount >= this.config.maxRestarts) {
      console.error(`Service ${serviceName} exceeded maximum restarts`);
      return;
    }
    
    const restartCallback = this.restartCallbacks.get(serviceName);
    if (!restartCallback) {
      return;
    }
    
    console.log(`Attempting to restart service ${serviceName}`);
    
    try {
      await new Promise(resolve => setTimeout(resolve, this.config.restartDelay));
      await restartCallback();
      
      // Reset error history on successful restart
      this.errorHistory.set(serviceName, []);
      service.status = 'healthy';
      service.errorCount = 0;
      service.restartCount++;
      service.lastRestart = new Date();
      
      console.log(`Service ${serviceName} restarted successfully`);
    } catch (error) {
      console.error(`Failed to restart service ${serviceName}:`, error);
      service.restartCount++;
    }
    
    this.services.set(serviceName, service);
  }
  
  /**
   * Get health status of all services
   */
  getHealthStatus(): ServiceHealth[] {
    return Array.from(this.services.values());
  }
  
  /**
   * Get health status of a specific service
   */
  getServiceHealth(serviceName: string): ServiceHealth | undefined {
    return this.services.get(serviceName);
  }
  
  /**
   * Reset error count for a service
   */
  resetErrors(serviceName: string): void {
    const service = this.services.get(serviceName);
    if (service) {
      service.errorCount = 0;
      service.status = 'healthy';
      this.errorHistory.set(serviceName, []);
      this.services.set(serviceName, service);
    }
  }
}

/**
 * Flow helpers for resilience patterns
 */
export const resilience = {
  /**
   * Circuit breaker pattern
   */
  circuitBreaker: (config: CircuitBreakerConfig): ((handler: EventHandler) => EventHandler) => {
    return (handler: EventHandler) => {
      const circuit = circuitRegistry.getOrCreate(config);
      
      return async (eventOrEvents: HappenEvent | HappenEvent[], context: HandlerContext) => {
        return await circuit.execute(handler, eventOrEvents, context);
      };
    };
  },
  
  /**
   * Bulkhead pattern
   */
  bulkhead: (maxConcurrent: number = 10): ((handler: EventHandler) => EventHandler) => {
    const bulkhead = new Bulkhead(maxConcurrent);
    
    return (handler: EventHandler) => {
      return async (eventOrEvents: HappenEvent | HappenEvent[], context: HandlerContext) => {
        return await bulkhead.execute(() => handler(eventOrEvents, context));
      };
    };
  },
  
  /**
   * Timeout pattern
   */
  timeout: (ms: number): ((handler: EventHandler) => EventHandler) => {
    return (handler: EventHandler) => {
      return async (eventOrEvents: HappenEvent | HappenEvent[], context: HandlerContext) => {
        return await Promise.race([
          handler(eventOrEvents, context),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Handler timed out after ${ms}ms`)), ms)
          )
        ]);
      };
    };
  },
  
  /**
   * Fallback pattern
   */
  fallback: (fallbackHandler: EventHandler): ((handler: EventHandler) => EventHandler) => {
    return (handler: EventHandler) => {
      return async (eventOrEvents: HappenEvent | HappenEvent[], context: HandlerContext) => {
        try {
          return await handler(eventOrEvents, context);
        } catch (error) {
          context.fallbackReason = error;
          return await fallbackHandler(eventOrEvents, context);
        }
      };
    };
  }
};

/**
 * Global supervisor instance
 */
let globalSupervisor: Supervisor | null = null;

/**
 * Get global supervisor
 */
export function getGlobalSupervisor(): Supervisor {
  if (!globalSupervisor) {
    globalSupervisor = new Supervisor({
      errorThreshold: 5,
      timeWindow: 60000, // 1 minute
      restartDelay: 5000, // 5 seconds
      maxRestarts: 3
    });
  }
  return globalSupervisor;
}

/**
 * Set global supervisor (for testing)
 */
export function setGlobalSupervisor(supervisor: Supervisor): void {
  globalSupervisor = supervisor;
}

/**
 * Get circuit breaker registry
 */
export function getCircuitBreakerRegistry(): CircuitBreakerRegistry {
  return circuitRegistry;
}