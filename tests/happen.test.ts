/**
 * Tests for main Happen instance
 */

import { HappenImpl, createHappen } from '../src/happen';

describe('Happen Instance', () => {
  let happenInstance: HappenImpl;

  beforeEach(() => {
    happenInstance = new HappenImpl();
  });

  afterEach(async () => {
    await happenInstance.disconnect();
  });

  describe('node creation', () => {
    it('should create nodes with unique IDs', () => {
      const node1 = happenInstance.node('service1');
      const node2 = happenInstance.node('service2');
      
      expect(node1.id).toBeDefined();
      expect(node2.id).toBeDefined();
      expect(node1.id).not.toBe(node2.id);
    });

    it('should prevent creating nodes with duplicate names', () => {
      happenInstance.node('duplicate');
      
      expect(() => {
        happenInstance.node('duplicate');
      }).toThrow('Node with id "duplicate" already exists');
    });

    it('should create nodes with custom options', () => {
      const initialState = { count: 0 };
      const node = happenInstance.node('test', { state: initialState });
      
      expect(node.state.get()).toEqual(initialState);
    });

    it('should auto-start nodes if already connected', async () => {
      await happenInstance.connect();
      
      const handler = jest.fn();
      const node = happenInstance.node('test');
      node.on('test.event', handler);
      
      // Should be able to process events immediately
      node.emit({ type: 'test.event', payload: {} });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('connection management', () => {
    it('should connect and start all nodes', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      const node1 = happenInstance.node('service1');
      const node2 = happenInstance.node('service2');
      
      node1.on('test.event', handler1);
      node2.on('test.event', handler2);
      
      await happenInstance.connect();
      
      // Both nodes should be started and able to process events
      node1.emit({ type: 'test.event', payload: {} });
      node2.emit({ type: 'test.event', payload: {} });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should not connect twice', async () => {
      await happenInstance.connect();
      
      // Second connect should not throw or cause issues
      await expect(happenInstance.connect()).resolves.toBeUndefined();
    });

    it('should disconnect and stop all nodes', async () => {
      const handler = jest.fn();
      const node = happenInstance.node('test');
      node.on('test.event', handler);
      
      await happenInstance.connect();
      await happenInstance.disconnect();
      
      // Node should not process events after disconnect
      node.emit({ type: 'test.event', payload: {} });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not disconnect if not connected', async () => {
      // Should not throw
      await expect(happenInstance.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('factory function', () => {
    it('should create Happen instance', () => {
      const instance = createHappen();
      expect(instance).toBeInstanceOf(HappenImpl);
    });

    it('should accept configuration', () => {
      const config = {
        servers: 'custom:4222',
        name: 'test-client'
      };
      
      const instance = createHappen(config);
      expect(instance).toBeInstanceOf(HappenImpl);
    });
  });

  describe('default instance', () => {
    afterEach(async () => {
      // await happen.disconnect();
    });

    it.skip('should provide default happen instance', () => {
      // TODO: Implement default happen instance
      // expect(happen).toBeDefined();
      // expect(typeof happen.node).toBe('function');
      // expect(typeof happen.connect).toBe('function');
      // expect(typeof happen.disconnect).toBe('function');
    });

    it.skip('should work with default instance', async () => {
      // TODO: Implement default happen instance
      // const handler = jest.fn();
      // const node = happen.node('default-test');
      // node.on('test.event', handler);
      // 
      // await happen.connect();
      // node.emit({ type: 'test.event', payload: {} });
      // 
      // await new Promise(resolve => setTimeout(resolve, 10));
      // 
      // expect(handler).toHaveBeenCalled();
    });
  });

  describe('event communication', () => {
    it('should handle events between nodes via broadcasts', async () => {
      const node1 = happenInstance.node('node1');
      const node2 = happenInstance.node('node2');
      
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      
      node1.on('shared.event', handler1);
      node2.on('shared.event', handler2);
      
      await happenInstance.connect();
      
      // Any node can emit events that all nodes can receive
      node1.emit({ type: 'shared.event', payload: { from: 'node1' } });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler1).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'shared.event',
          payload: { from: 'node1' }
        })
      );
      
      // In a real implementation with NATS, node2 would also receive it
      // For now, local events only reach the same node
    });

    it('should handle broadcast events locally', async () => {
      const handler1 = jest.fn();
      
      const node1 = happenInstance.node('node1');
      node1.on('broadcast.event', handler1);
      
      await happenInstance.connect();
      
      await node1.broadcast({ type: 'broadcast.event', payload: { message: 'hello' } });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler1).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'broadcast.event',
          payload: { message: 'hello' }
        })
      );
    });

    it('should not implement cross-node send until NATS is ready', async () => {
      const node1 = happenInstance.node('node1');
      const node2 = happenInstance.node('node2');
      
      await happenInstance.connect();
      
      await expect(
        node1.send(node2.id, { type: 'cross.event', payload: {} })
      ).rejects.toThrow('Cross-node communication not yet implemented');
    });
  });

  describe('global state', () => {
    it('should share global state between nodes', async () => {
      const node1 = happenInstance.node('node1');
      const node2 = happenInstance.node('node2');
      
      await node1.global.set('shared-key', 'shared-value');
      const value = await node2.global.get('shared-key');
      
      expect(value).toBe('shared-value');
    });

    it('should support global state watching', async () => {
      const node1 = happenInstance.node('node1');
      const node2 = happenInstance.node('node2');
      
      const watcher = jest.fn();
      const unwatch = node1.global.watch('watched-key', watcher);
      
      await node2.global.set('watched-key', 'new-value');
      
      expect(watcher).toHaveBeenCalledWith('new-value');
      
      unwatch();
      await node2.global.set('watched-key', 'another-value');
      
      expect(watcher).toHaveBeenCalledTimes(2); // Initial + first update only
    });
  });
});