/**
 * Hello World example - Basic Happen usage
 */

import { happen, patterns } from '../src';

interface Order {
  orderId: string;
  customerId: string;
  amount: number;
  items: string[];
}

interface OrderState {
  orders: Order[];
  count: number;
}

async function helloWorldExample(): Promise<void> {
  console.log('🌊 Happen Hello World Example');
  
  // Create nodes
  const orderNode = happen.node<OrderState>('order-service', {
    state: { orders: [], count: 0 }
  });
  
  const paymentNode = happen.node('payment-service', {
    state: { transactions: [] }
  });
  
  // Set up event handlers with pattern matching
  orderNode.on('order.created', async (event) => {
    console.log('📦 Order received:', event.payload);
    
    // Update state
    orderNode.state.set(state => ({
      ...state,
      orders: [...state.orders, event.payload as Order],
      count: state.count + 1
    }));
    
    // Continue flow to payment processing
    return processPayment;
  });
  
  // Payment processing handler
  const processPayment = async (event: any) => {
    console.log('💳 Processing payment for order:', event.payload.orderId);
    
    // Simulate payment processing
    const success = Math.random() > 0.3; // 70% success rate
    
    if (success) {
      console.log('✅ Payment successful!');
      paymentNode.emit({
        type: 'payment.succeeded',
        payload: { orderId: event.payload.orderId, amount: event.payload.amount }
      });
      return undefined;
    } else {
      console.log('❌ Payment failed!');
      return handlePaymentFailure;
    }
  };
  
  // Error handler
  const handlePaymentFailure = async (event: any) => {
    console.log('🔄 Handling payment failure for order:', event.payload.orderId);
    
    // Could retry payment, refund, etc.
    orderNode.emit({
      type: 'order.payment.failed',
      payload: { orderId: event.payload.orderId, reason: 'Payment processing failed' }
    });
  };
  
  // Listen for payment events
  paymentNode.on(patterns.prefix('payment.'), (event) => {
    console.log('💰 Payment event:', event.type, event.payload);
  });
  
  // Listen for order failures
  orderNode.on('order.payment.failed', (event) => {
    console.log('⚠️  Order payment failed:', event.payload);
  });
  
  // Listen to all system events
  orderNode.on(patterns.system(), (event) => {
    console.log('🔧 System event:', event.type, event.payload);
  });
  
  // Start the nodes
  await happen.connect();
  
  // Create some test orders
  console.log('\n🚀 Creating test orders...\n');
  
  for (let i = 1; i <= 3; i++) {
    setTimeout(() => {
      orderNode.emit({
        type: 'order.created',
        payload: {
          orderId: `order-${i}`,
          customerId: `customer-${i}`,
          amount: 99.99 + i,
          items: [`Item ${i}`]
        }
      });
    }, i * 1000);
  }
  
  // Let it run for a few seconds
  setTimeout(async () => {
    console.log('\n📊 Final state:');
    console.log('Orders:', orderNode.state.get(s => s.orders));
    console.log('Order count:', orderNode.state.get(s => s.count));
    
    await happen.disconnect();
    console.log('\n👋 Example complete!');
  }, 5000);
}

// Run the example
helloWorldExample().catch(console.error);