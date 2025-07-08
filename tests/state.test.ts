/**
 * Tests for state management
 */

import {
  NodeStateContainer,
  StateLens,
  lens,
  pathLens,
  stateHelpers,
} from '../src/state';

describe('State Management', () => {
  describe('NodeStateContainer', () => {
    interface TestState {
      count: number;
      user: {
        name: string;
        email: string;
      };
      items: string[];
    }

    let state: NodeStateContainer<TestState>;

    beforeEach(() => {
      state = new NodeStateContainer({
        count: 0,
        user: { name: 'Test User', email: 'test@example.com' },
        items: ['item1', 'item2']
      });
    });

    describe('get', () => {
      it('should return full state when no selector provided', () => {
        const fullState = state.get();
        
        expect(fullState.count).toBe(0);
        expect(fullState.user.name).toBe('Test User');
        expect(fullState.items).toEqual(['item1', 'item2']);
      });

      it('should return selected portion with selector', () => {
        const count = state.get(s => s.count);
        const userName = state.get(s => s.user.name);
        const itemCount = state.get(s => s.items.length);
        
        expect(count).toBe(0);
        expect(userName).toBe('Test User');
        expect(itemCount).toBe(2);
      });

      it('should handle complex selectors', () => {
        const activeItems = state.get(s => 
          s.items.filter(item => item.startsWith('item'))
        );
        
        expect(activeItems).toEqual(['item1', 'item2']);
      });
    });

    describe('set', () => {
      it('should update state with new value', () => {
        state.set(s => ({ ...s, count: s.count + 1 }));
        
        expect(state.get(s => s.count)).toBe(1);
      });

      it('should preserve immutability', () => {
        const originalState = state.get();
        
        state.set(s => ({ ...s, count: 10 }));
        
        expect(originalState.count).toBe(0); // Original unchanged
        expect(state.get(s => s.count)).toBe(10); // New state updated
      });

      it('should handle nested updates', () => {
        state.set(s => ({
          ...s,
          user: { ...s.user, name: 'Updated User' }
        }));
        
        expect(state.get(s => s.user.name)).toBe('Updated User');
        expect(state.get(s => s.user.email)).toBe('test@example.com'); // Preserved
      });

      it('should handle array updates', () => {
        state.set(s => ({
          ...s,
          items: [...s.items, 'item3']
        }));
        
        expect(state.get(s => s.items)).toEqual(['item1', 'item2', 'item3']);
      });

      it('should not trigger updates if state is unchanged', () => {
        const listener = jest.fn();
        state.subscribe(listener);
        
        // Set same state
        state.set(s => s);
        
        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe('subscribe', () => {
      it('should notify listeners on state changes', () => {
        const listener = jest.fn();
        const unsubscribe = state.subscribe(listener);
        
        state.set(s => ({ ...s, count: 5 }));
        
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ count: 5 })
        );
        
        unsubscribe();
        state.set(s => ({ ...s, count: 10 }));
        
        expect(listener).toHaveBeenCalledTimes(1); // No call after unsubscribe
      });

      it('should support multiple listeners', () => {
        const listener1 = jest.fn();
        const listener2 = jest.fn();
        
        state.subscribe(listener1);
        state.subscribe(listener2);
        
        state.set(s => ({ ...s, count: 1 }));
        
        expect(listener1).toHaveBeenCalled();
        expect(listener2).toHaveBeenCalled();
      });
    });

    describe('when (event watchers)', () => {
      it('should trigger callbacks for specific events', () => {
        const callback = jest.fn();
        
        state.when('evt-123', callback);
        state.notifyEvent('evt-123');
        
        expect(callback).toHaveBeenCalledWith(state.get());
      });

      it('should only trigger once per event', () => {
        const callback = jest.fn();
        
        state.when('evt-123', callback);
        state.notifyEvent('evt-123');
        state.notifyEvent('evt-123'); // Second call should not trigger
        
        expect(callback).toHaveBeenCalledTimes(1);
      });

      it('should support multiple watchers for same event', () => {
        const callback1 = jest.fn();
        const callback2 = jest.fn();
        
        state.when('evt-123', callback1);
        state.when('evt-123', callback2);
        state.notifyEvent('evt-123');
        
        expect(callback1).toHaveBeenCalled();
        expect(callback2).toHaveBeenCalled();
      });
    });

    describe('snapshot', () => {
      it('should create deep copy of state', () => {
        const snapshot = state.snapshot();
        
        // Modify original state
        state.set(s => ({ ...s, count: 100 }));
        
        // Snapshot should be unchanged
        expect(snapshot.count).toBe(0);
        expect(state.get(s => s.count)).toBe(100);
      });
    });
  });

  describe('StateLens', () => {
    interface TestState {
      user: {
        profile: {
          name: string;
          age: number;
        };
      };
    }

    let state: NodeStateContainer<TestState>;
    let nameLens: StateLens<TestState, string>;

    beforeEach(() => {
      state = new NodeStateContainer({
        user: {
          profile: {
            name: 'John Doe',
            age: 30
          }
        }
      });

      const nameSelector = (s: TestState) => s.user.profile.name;
      const nameUpdater = (s: TestState, name: string) => ({
        ...s,
        user: {
          ...s.user,
          profile: { ...s.user.profile, name }
        }
      });

      nameLens = new StateLens(state, nameSelector, nameUpdater);
    });

    describe('get', () => {
      it('should get focused value', () => {
        expect(nameLens.get()).toBe('John Doe');
      });
    });

    describe('set', () => {
      it('should update focused value', () => {
        nameLens.set('Jane Doe');
        
        expect(nameLens.get()).toBe('Jane Doe');
        expect(state.get(s => s.user.profile.age)).toBe(30); // Preserved
      });
    });

    describe('update', () => {
      it('should update value with function', () => {
        nameLens.update(name => name.toUpperCase());
        
        expect(nameLens.get()).toBe('JOHN DOE');
      });
    });
  });

  describe('lens helpers', () => {
    interface TestState {
      user: {
        name: string;
        age: number;
      };
      settings: {
        theme: string;
        notifications: boolean;
      };
    }

    let state: NodeStateContainer<TestState>;

    beforeEach(() => {
      state = new NodeStateContainer<TestState>({
        user: { name: 'Test', age: 25 },
        settings: { theme: 'dark', notifications: true }
      });
    });

    describe('lens', () => {
      it('should create working lens', () => {
        const userNameLens = lens(
          (s: TestState) => s.user.name,
          (s: TestState, name: string) => ({
            ...s,
            user: { ...s.user, name }
          })
        );

        const lensInstance = userNameLens(state);
        
        expect(lensInstance.get()).toBe('Test');
        
        lensInstance.set('Updated');
        expect(lensInstance.get()).toBe('Updated');
      });
    });

    describe('pathLens', () => {
      it('should create lens from path string', () => {
        const nameLens = pathLens<TestState>('user.name')(state);
        const themeLens = pathLens<TestState>('settings.theme')(state);
        
        expect(nameLens.get()).toBe('Test');
        expect(themeLens.get()).toBe('dark');
        
        nameLens.set('New Name');
        themeLens.set('light');
        
        expect(nameLens.get()).toBe('New Name');
        expect(themeLens.get()).toBe('light');
        expect(state.get(s => s.user.age)).toBe(25); // Preserved
      });

      it('should handle undefined paths gracefully', () => {
        const deepLens = pathLens<TestState>('user.missing.path')(state);
        
        expect(deepLens.get()).toBeUndefined();
      });
    });
  });

  describe('stateHelpers', () => {
    interface TestState {
      count: number;
      user: {
        name: string;
        email: string;
      };
      items: { id: number; name: string }[];
    }

    let state: NodeStateContainer<TestState>;

    beforeEach(() => {
      state = new NodeStateContainer({
        count: 0,
        user: { name: 'Test', email: 'test@example.com' },
        items: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' }
        ]
      });
    });

    describe('merge', () => {
      it('should merge partial updates', () => {
        state.set(s => ({ ...s, count: 5 }));
        
        expect(state.get(s => s.count)).toBe(5);
        expect(state.get(s => s.user.name)).toBe('Test'); // Preserved
      });
    });

    describe('setIn', () => {
      it('should update nested properties', () => {
        state.set(stateHelpers.setIn('user.name', 'Updated Name'));
        
        expect(state.get(s => s.user.name)).toBe('Updated Name');
        expect(state.get(s => s.user.email)).toBe('test@example.com');
      });

      it('should handle deep paths', () => {
        // Add nested structure first
        state.set(s => ({
          ...s,
          user: {
            ...s.user,
            profile: { settings: { theme: 'dark' } }
          } as any
        }));

        state.set(stateHelpers.setIn('user.profile.settings.theme', 'light'));
        
        expect(state.get(s => (s.user as any).profile.settings.theme)).toBe('light');
      });
    });

    describe('updateAt', () => {
      it('should update array item at index', () => {
        state.set(s => ({
          ...s,
          items: stateHelpers.updateAt(0, (item: { id: number; name: string }) => ({ ...item, name: 'Updated Item 1' }))(s.items)
        }));
        
        expect(state.get(s => s.items[0]?.name)).toBe('Updated Item 1');
        expect(state.get(s => s.items[1]?.name)).toBe('Item 2'); // Preserved
      });
    });

    describe('removeAt', () => {
      it('should remove array item at index', () => {
        state.set(s => ({
          ...s,
          items: stateHelpers.removeAt<{ id: number; name: string }>(0)(s.items)
        }));
        
        expect(state.get(s => s.items)).toHaveLength(1);
        expect(state.get(s => s.items[0]?.name)).toBe('Item 2');
      });
    });
  });
});