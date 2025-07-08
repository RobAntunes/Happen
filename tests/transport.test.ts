/**
 * Tests for transport layer
 */

import { MockTransportAdapter } from '../src/transport/mock';
import { MessagePackSerializer, JSONSerializer } from '../src/serialization';
import { createEvent } from '../src/events';

describe('Transport Layer', () => {
  describe('MockTransportAdapter', () => {
    let adapter: MockTransportAdapter;

    beforeEach(() => {
      adapter = new MockTransportAdapter({
        servers: ['mock://localhost:4222'],
      });
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    it('should connect and disconnect', async () => {
      expect(adapter.getState().status).toBe('disconnected');
      
      await adapter.connect();
      expect(adapter.getState().status).toBe('connected');
      
      await adapter.disconnect();
      expect(adapter.getState().status).toBe('disconnected');
    });

    it('should publish and subscribe to messages', async () => {
      await adapter.connect();

      const messages: Uint8Array[] = [];
      const unsubscribe = adapter.subscribe('test.subject', (data) => {
        messages.push(data);
      });

      const testData = new TextEncoder().encode('test message');
      await adapter.publish('test.subject', testData);

      // Give time for async delivery
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(messages).toHaveLength(1);
      expect(new TextDecoder().decode(messages[0])).toBe('test message');

      unsubscribe();
    });

    it('should handle request/response pattern', async () => {
      await adapter.connect();

      // Register request handler
      adapter.registerRequestHandler('test.request', async (data) => {
        const request = new TextDecoder().decode(data);
        const response = `echo: ${request}`;
        return new TextEncoder().encode(response);
      });

      const requestData = new TextEncoder().encode('hello');
      const responseData = await adapter.request('test.request', requestData);
      const response = new TextDecoder().decode(responseData);

      expect(response).toBe('echo: hello');
    });

    it('should track subscriptions', async () => {
      await adapter.connect();

      expect(adapter.getSubscribedSubjects()).toHaveLength(0);

      const unsubscribe1 = adapter.subscribe('subject1', () => {});
      const unsubscribe2 = adapter.subscribe('subject2', () => {});

      expect(adapter.getSubscribedSubjects()).toContain('subject1');
      expect(adapter.getSubscribedSubjects()).toContain('subject2');

      unsubscribe1();
      expect(adapter.getSubscribedSubjects()).not.toContain('subject1');
      expect(adapter.getSubscribedSubjects()).toContain('subject2');

      unsubscribe2();
      expect(adapter.getSubscribedSubjects()).toHaveLength(0);
    });

    it('should simulate connection failures', async () => {
      await adapter.connect();
      expect(adapter.getState().status).toBe('connected');

      adapter.simulateConnectionFailure(new Error('Network error'));
      expect(adapter.getState().status).toBe('error');
      expect(adapter.getState().lastError?.message).toBe('Network error');

      await adapter.simulateReconnection();
      expect(adapter.getState().status).toBe('connected');
    });
  });

  describe('Serialization', () => {
    describe('JSONSerializer', () => {
      let serializer: JSONSerializer;

      beforeEach(() => {
        serializer = new JSONSerializer();
      });

      it('should serialize and deserialize data', async () => {
        const data = { test: 'value', number: 42 };
        
        const serialized = await serializer.serialize(data);
        expect(serialized).toBeInstanceOf(Uint8Array);
        
        const deserialized = await serializer.deserialize(serialized);
        expect(deserialized).toEqual(data);
      });

      it('should serialize and deserialize events', async () => {
        const event = createEvent('test.event', { data: 'test' });
        
        const serialized = await serializer.serializeEvent(event);
        expect(serialized).toBeInstanceOf(Uint8Array);
        
        const deserialized = await serializer.deserializeEvent(serialized);
        expect(deserialized.id).toBe(event.id);
        expect(deserialized.type).toBe(event.type);
        expect(deserialized.payload).toEqual(event.payload);
      });

      it('should validate event structure on deserialization', async () => {
        const invalidData = new TextEncoder().encode(JSON.stringify({ invalid: true }));
        
        await expect(serializer.deserializeEvent(invalidData))
          .rejects.toThrow('Invalid event structure');
      });
    });

    describe('MessagePackSerializer', () => {
      let serializer: MessagePackSerializer;

      beforeEach(() => {
        serializer = new MessagePackSerializer();
      });

      it('should handle MessagePack if available', async () => {
        const data = { test: 'value', number: 42 };
        
        const serialized = await serializer.serialize(data);
        expect(serialized).toBeInstanceOf(Uint8Array);
        
        const deserialized = await serializer.deserialize(serialized);
        expect(deserialized).toEqual(data);
      });

      it('should fallback to JSON if MessagePack unavailable', async () => {
        // This test will use JSON fallback since msgpackr is not installed
        const event = createEvent('test.event', { data: 'test' });
        
        const serialized = await serializer.serializeEvent(event);
        const deserialized = await serializer.deserializeEvent(serialized);
        
        expect(deserialized.type).toBe(event.type);
        expect(deserialized.payload).toEqual(event.payload);
      });
    });
  });
});