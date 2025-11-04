/**
 * Tests for NATS connection manager
 * Note: These tests require a running NATS server
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { NatsConnectionManager } from '../src/nats-connection.js';

// Helper to check if NATS is available
async function isNatsAvailable(): Promise<boolean> {
  const manager = new NatsConnectionManager({ servers: 'localhost:4222' });
  try {
    await manager.connect();
    await manager.disconnect();
    return true;
  } catch (error) {
    return false;
  }
}

describe('NATS Connection Manager', () => {
  let natsAvailable = false;

  before(async () => {
    natsAvailable = await isNatsAvailable();
    if (!natsAvailable) {
      console.log('\n⚠️  NATS server not available. Skipping integration tests.');
      console.log('   Start NATS with: docker run --rm -p 4222:4222 -p 8222:8222 nats:latest -js\n');
    }
  });

  describe('Connection', () => {
    it('should connect to NATS server', async () => {
      if (!natsAvailable) return;

      const manager = new NatsConnectionManager();
      await manager.connect();

      assert.strictEqual(manager.isConnected(), true);

      await manager.disconnect();
      assert.strictEqual(manager.isConnected(), false);
    });

    it('should handle connection with custom servers', async () => {
      if (!natsAvailable) return;

      const manager = new NatsConnectionManager({
        servers: ['localhost:4222']
      });

      await manager.connect();
      assert.strictEqual(manager.isConnected(), true);
      await manager.disconnect();
    });

    it('should not double-connect', async () => {
      if (!natsAvailable) return;

      const manager = new NatsConnectionManager();
      await manager.connect();
      await manager.connect(); // Should not throw

      assert.strictEqual(manager.isConnected(), true);
      await manager.disconnect();
    });

    it('should throw error when not connected', () => {
      const manager = new NatsConnectionManager();

      assert.throws(() => {
        manager.getConnection();
      }, /Not connected to NATS/);
    });
  });

  describe('Publish and Subscribe', () => {
    let manager: NatsConnectionManager;

    before(async () => {
      if (!natsAvailable) return;
      manager = new NatsConnectionManager();
      await manager.connect();
    });

    after(async () => {
      if (!natsAvailable) return;
      if (manager) {
        await manager.disconnect();
      }
    });

    it('should publish and receive messages', async () => {
      if (!natsAvailable) return;

      const testData = { message: 'Hello, NATS!', timestamp: Date.now() };
      let received = false;

      return new Promise<void>(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Message not received within timeout'));
        }, 5000);

        const sub = manager.subscribe('test.message', (data, subject) => {
          try {
            assert.strictEqual(subject, 'test.message');
            assert.deepStrictEqual(data, testData);
            received = true;
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve();
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });

        // Give subscription time to be ready
        await new Promise(resolve => setTimeout(resolve, 100));

        await manager.publish('test.message', testData);
      });
    });

    it('should handle multiple subscribers', async () => {
      if (!natsAvailable) return;

      const testData = { value: 42 };
      let count = 0;

      return new Promise<void>(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Not all messages received'));
        }, 5000);

        const checkDone = () => {
          if (count === 2) {
            clearTimeout(timeout);
            sub1.unsubscribe();
            sub2.unsubscribe();
            resolve();
          }
        };

        const sub1 = manager.subscribe('test.multi', () => {
          count++;
          checkDone();
        });

        const sub2 = manager.subscribe('test.multi', () => {
          count++;
          checkDone();
        });

        await new Promise(resolve => setTimeout(resolve, 100));
        await manager.publish('test.multi', testData);
      });
    });
  });

  describe('KV Store', () => {
    let manager: NatsConnectionManager;

    before(async () => {
      if (!natsAvailable) return;
      manager = new NatsConnectionManager();
      await manager.connect();
    });

    after(async () => {
      if (!natsAvailable) return;
      if (manager) {
        await manager.disconnect();
      }
    });

    it('should create and access KV store', async () => {
      if (!natsAvailable) return;

      const storeName = `test-kv-${Date.now()}`;
      const kv = await manager.getKVStore(storeName);

      assert.ok(kv);

      // Test put and get
      await kv.put('test-key', JSON.stringify({ value: 'test-data' }));
      const entry = await kv.get('test-key');

      assert.ok(entry);
      const data = JSON.parse(entry.string());
      assert.strictEqual(data.value, 'test-data');
    });

    it('should reuse existing KV store', async () => {
      if (!natsAvailable) return;

      const storeName = `test-kv-reuse-${Date.now()}`;
      const kv1 = await manager.getKVStore(storeName);
      const kv2 = await manager.getKVStore(storeName);

      assert.strictEqual(kv1, kv2);
    });

    it('should persist data in KV store', async () => {
      if (!natsAvailable) return;

      const storeName = `test-kv-persist-${Date.now()}`;
      const kv = await manager.getKVStore(storeName);

      const testData = {
        orders: {
          'order-1': { id: 'order-1', total: 99.99 },
          'order-2': { id: 'order-2', total: 149.99 }
        }
      };

      await kv.put('state', JSON.stringify(testData));

      // Retrieve and verify
      const entry = await kv.get('state');
      assert.ok(entry);

      const retrieved = JSON.parse(entry.string());
      assert.deepStrictEqual(retrieved, testData);
    });
  });

  describe('Error Handling', () => {
    it('should handle connection failure gracefully', async () => {
      const manager = new NatsConnectionManager({
        servers: 'localhost:9999' // Invalid port
      });

      await assert.rejects(
        async () => await manager.connect(),
        /Failed to connect to NATS/
      );
    });

    it('should throw when accessing JetStream before connection', () => {
      const manager = new NatsConnectionManager();

      assert.throws(() => {
        manager.getJetStream();
      }, /JetStream not initialized/);

      assert.throws(() => {
        manager.getJetStreamManager();
      }, /JetStream manager not initialized/);
    });
  });
});
