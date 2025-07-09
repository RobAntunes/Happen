/**
 * Simple View implementation for examples
 * Provides a key-value store interface
 */

export interface View<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): void;
  keys(): string[];
  values(): T[];
  clear(): void;
}

export class SimpleView<T> implements View<T> {
  private store = new Map<string, T>();
  
  get(key: string): T | undefined {
    return this.store.get(key);
  }
  
  set(key: string, value: T): void {
    this.store.set(key, value);
  }
  
  has(key: string): boolean {
    return this.store.has(key);
  }
  
  delete(key: string): void {
    this.store.delete(key);
  }
  
  keys(): string[] {
    return Array.from(this.store.keys());
  }
  
  values(): T[] {
    return Array.from(this.store.values());
  }
  
  clear(): void {
    this.store.clear();
  }
}

/**
 * View manager for creating and managing views
 */
export class ViewManager {
  private views = new Map<string, View<any>>();
  
  create<T>(name: string): View<T> {
    if (!this.views.has(name)) {
      this.views.set(name, new SimpleView<T>());
    }
    return this.views.get(name)!;
  }
  
  get<T>(name: string): View<T> | undefined {
    return this.views.get(name);
  }
  
  /**
   * Collect results from multiple nodes
   */
  async collect<T>(
    nodes: any[],
    fn: (node: any) => Promise<T>
  ): Promise<T[]> {
    return Promise.all(nodes.map(fn));
  }
}

// Global view manager instance
let globalViewManager: ViewManager | null = null;

export function getGlobalViewManager(): ViewManager {
  if (!globalViewManager) {
    globalViewManager = new ViewManager();
  }
  return globalViewManager;
}