#!/usr/bin/env ts-node
/**
 * Error Handling Patterns
 * Shows various error handling strategies including:
 * - Circuit breaker pattern
 * - Retry with exponential backoff
 * - Error event propagation
 * - Graceful degradation
 */

import { initializeHappen } from '../src';

// Simple Circuit Breaker implementation
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private options: {
      failureThreshold: number;
      resetTimeout: number;
      monitoringPeriod: number;
    }
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      // Check if we should try half-open
      if (Date.now() - this.lastFailureTime > this.options.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }
    
    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      
      if (this.failures >= this.options.failureThreshold) {
        this.state = 'open';
      }
      throw error;
    }
  }
  
  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime
    };
  }
}

async function main() {
  const happen = initializeHappen();
  
  // Create service nodes
  const apiGateway = happen.createNode('api-gateway');
  const paymentService = happen.createNode('payment-service');
  const fallbackPaymentService = happen.createNode('fallback-payment');
  const errorHandler = happen.createNode('error-handler');
  
  // Circuit breaker for payment service
  const paymentCircuit = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 5000,
    monitoringPeriod: 10000
  });
  
  // Error handler logs and processes errors
  errorHandler.on('error', (event) => {
    const { service, error, attemptNumber, willRetry } = event.payload as { service: string; error: { message: string }; attemptNumber: number; willRetry: boolean };
    console.error(`❌ Error in ${service}:`, error.message);
    if (willRetry) {
      console.log(`   Will retry (attempt ${attemptNumber})...`);
    }
  });
  
  // Payment service simulates failures
  let requestCount = 0;
  paymentService.on('process-payment', async (event) => {
    requestCount++;
    const { amount, orderId } = event.payload as { amount: number; orderId: string };
    
    // Simulate failures for testing
    if (requestCount <= 4) {
      throw new Error(`Payment gateway timeout (request ${requestCount})`);
    }
    
    // Success after failures
    console.log(`✅ Payment processed: $${amount} for order ${orderId}`);
    return {
      success: true,
      transactionId: `txn-${Date.now()}`,
      amount
    };
  });
  
  // Fallback payment service (always works)
  fallbackPaymentService.on('process-payment', async (event) => {
    const { amount, orderId } = event.payload as { amount: number; orderId: string };
    console.log(`🔄 Fallback payment processed: $${amount} for order ${orderId}`);
    return {
      success: true,
      transactionId: `fallback-txn-${Date.now()}`,
      amount,
      fallback: true
    };
  });
  
  // API Gateway implements retry and circuit breaker
  apiGateway.on('submit-payment', async (event) => {
    const { amount, orderId } = event.payload as { amount: number; orderId: string };
    const maxRetries = 3;
    let lastError;
    
    // Try primary payment service with circuit breaker
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check circuit breaker
        const circuitState = paymentCircuit.getState();
        if (circuitState.state === 'open') {
          console.log('⚡ Circuit breaker is OPEN - skipping primary service');
          break;
        }
        
        console.log(`Attempting payment (attempt ${attempt}/${maxRetries})...`);
        
        // Execute with circuit breaker
        const result = await paymentCircuit.execute(async () => {
          return await apiGateway.send(paymentService, {
            type: 'process-payment',
            payload: { amount, orderId }
          }).return();
        });
        
        // Success - reset any error state
        return {
          ...result,
          attempts: attempt
        };
        
      } catch (error) {
        lastError = error;
        
        // Send error event
        await apiGateway.send(errorHandler, {
          type: 'error',
          payload: {
            service: 'payment-service',
            error: { message: error.message },
            attemptNumber: attempt,
            willRetry: attempt < maxRetries
          }
        });
        
        // Exponential backoff
        if (attempt < maxRetries) {
          const backoffMs = Math.pow(2, attempt - 1) * 1000;
          console.log(`   Waiting ${backoffMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }
    
    // All retries failed or circuit is open - try fallback
    console.log('🔄 Switching to fallback payment service...');
    try {
      const fallbackResult = await apiGateway.send(fallbackPaymentService, {
        type: 'process-payment',
        payload: { amount, orderId }
      }).return();
      
      return {
        ...fallbackResult,
        primaryFailed: true,
        originalError: (lastError as any)?.message
      };
      
    } catch (fallbackError) {
      // Both services failed - return error
      await apiGateway.send(errorHandler, {
        type: 'error',
        payload: {
          service: 'fallback-payment',
          error: { message: fallbackError.message },
          critical: true
        }
      });
      
      throw new Error('All payment services unavailable');
    }
  });
  
  // Test the error handling
  console.log('=== Error Handling Demo ===\n');
  
  // Process multiple payments to trigger circuit breaker
  for (let i = 1; i <= 6; i++) {
    console.log(`\n--- Payment Request ${i} ---`);
    try {
      const result = await apiGateway.send(apiGateway, {
        type: 'submit-payment',
        payload: {
          orderId: `order-${i}`,
          amount: 99.99 * i
        }
      }).return();
      
      console.log('Payment result:', result);
    } catch (error) {
      console.error('Payment failed completely:', error.message);
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Show circuit breaker state
  console.log('\n--- Circuit Breaker State ---');
  console.log(paymentCircuit.getState());
  
  // Wait for circuit to potentially close
  console.log('\nWaiting 6 seconds for circuit breaker to reset...');
  await new Promise(resolve => setTimeout(resolve, 6000));
  
  // Try one more payment after circuit reset
  console.log('\n--- Payment After Circuit Reset ---');
  requestCount = 10; // Ensure success
  try {
    const result = await apiGateway.send(apiGateway, {
      type: 'submit-payment',
      payload: {
        orderId: 'order-final',
        amount: 199.99
      }
    }).return();
    
    console.log('Payment result:', result);
  } catch (error) {
    console.error('Payment failed:', error.message);
  }
}

main().catch(console.error);