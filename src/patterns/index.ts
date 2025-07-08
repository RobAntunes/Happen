/**
 * Pattern matching engine for event routing
 */

import { Pattern, PatternFunction, HappenEvent } from '../types';

/**
 * Pattern matcher interface
 */
export interface PatternMatcher {
  pattern: Pattern;
  handler: (event: HappenEvent) => void;
  priority: number;
}

/**
 * Convert a pattern to a matcher function
 */
export function createMatcher(pattern: Pattern): PatternFunction {
  if (typeof pattern === 'function') {
    return pattern;
  }
  
  // String pattern - exact match
  return (type: string) => type === pattern;
}

/**
 * Create a prefix matcher
 */
export function prefix(prefixStr: string): PatternFunction {
  return (type: string) => type.startsWith(prefixStr);
}

/**
 * Create a suffix matcher
 */
export function suffix(suffixStr: string): PatternFunction {
  return (type: string) => type.endsWith(suffixStr);
}

/**
 * Create a regex matcher
 */
export function regex(pattern: RegExp): PatternFunction {
  return (type: string) => pattern.test(type);
}

/**
 * Create a domain matcher (e.g., 'order' matches 'order.*')
 */
export function domain(domainName: string): PatternFunction {
  return prefix(`${domainName}.`);
}

/**
 * Match any of the provided patterns
 */
export function oneOf(...patterns: Pattern[]): PatternFunction {
  const matchers = patterns.map(createMatcher);
  return (type: string, event?: HappenEvent) => 
    matchers.some(matcher => matcher(type, event));
}

/**
 * Match all of the provided patterns
 */
export function allOf(...patterns: Pattern[]): PatternFunction {
  const matchers = patterns.map(createMatcher);
  return (type: string, event?: HappenEvent) => 
    matchers.every(matcher => matcher(type, event));
}

/**
 * Negate a pattern
 */
export function not(pattern: Pattern): PatternFunction {
  const matcher = createMatcher(pattern);
  return (type: string, event?: HappenEvent) => !matcher(type, event);
}

/**
 * Pattern matching engine
 */
export class PatternEngine {
  private matchers: PatternMatcher[] = [];
  private cache = new Map<string, PatternMatcher[]>();
  
  /**
   * Add a pattern matcher
   */
  add(pattern: Pattern, handler: (event: HappenEvent) => void, priority = 0): () => void {
    const matcher: PatternMatcher = { pattern, handler, priority };
    this.matchers.push(matcher);
    this.clearCache();
    
    // Return unsubscribe function
    return () => {
      const index = this.matchers.indexOf(matcher);
      if (index !== -1) {
        this.matchers.splice(index, 1);
        this.clearCache();
      }
    };
  }
  
  /**
   * Find all matching handlers for an event type
   */
  findMatches(event: HappenEvent): PatternMatcher[] {
    // Don't cache when patterns might depend on event context
    const hasContextPatterns = this.matchers.some(m => typeof m.pattern === 'function');
    
    if (!hasContextPatterns) {
      const cached = this.cache.get(event.type);
      if (cached) return cached;
    }
    
    const matches = this.matchers
      .filter(m => {
        const matchFn = createMatcher(m.pattern);
        return matchFn(event.type, event);
      })
      .sort((a, b) => b.priority - a.priority);
    
    if (!hasContextPatterns) {
      this.cache.set(event.type, matches);
    }
    
    return matches;
  }
  
  /**
   * Clear the pattern cache
   */
  private clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * Get the number of registered patterns
   */
  get size(): number {
    return this.matchers.length;
  }
}

/**
 * Helper functions for common patterns
 */
export const patterns = {
  prefix,
  suffix,
  regex,
  domain,
  oneOf,
  allOf,
  not,
  
  /**
   * Match system events
   */
  system: () => prefix('system.'),
  
  /**
   * Match error events
   */
  errors: () => oneOf('system.error', suffix('.error'), suffix('.failed')),
  
  /**
   * Match all events
   */
  all: () => (_type: string) => true,
};