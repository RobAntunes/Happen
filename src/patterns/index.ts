/**
 * Pattern matching engine for event routing
 */

import { Pattern, PatternFunction, HappenEvent } from '../types';

/**
 * Pattern matcher interface
 */
export interface PatternMatcher {
  pattern: Pattern;
  handler: (event: HappenEvent) => void | Promise<void>;
  priority: number;
}

/**
 * Convert a pattern to a matcher function
 */
export function createMatcher(pattern: Pattern): PatternFunction {
  if (typeof pattern === 'function') {
    return pattern;
  }
  
  // String pattern
  if (pattern.includes('*')) {
    // Wildcard pattern (e.g., 'order.*')
    const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    return (type: string) => regex.test(type);
  }
  
  if (pattern.includes('{') && pattern.includes('}')) {
    // Alternative pattern (e.g., '{order,payment}.created')
    const match = pattern.match(/^\{([^}]+)\}(.*)$/);
    if (match && match[1]) {
      const alternatives = match[1].split(',');
      const suffix = match[2] || '';
      return (type: string) => alternatives.some(alt => type === alt + suffix);
    }
  }
  
  // Exact match
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
 * Compiled pattern matcher
 */
interface CompiledMatcher extends PatternMatcher {
  matchFn: PatternFunction;
}

/**
 * Pattern matching engine
 */
export class PatternEngine {
  private matchers: CompiledMatcher[] = [];
  private cache = new Map<string, CompiledMatcher[]>();
  private hasContextPatterns = false;
  // Fast lookup for exact string matches
  private exactMatchers = new Map<string, CompiledMatcher[]>();
  
  /**
   * Add a pattern matcher
   */
  add(pattern: Pattern, handler: (event: HappenEvent) => void | Promise<void>, priority = 0): () => void {
    // Pre-compile the pattern matcher
    const matchFn = createMatcher(pattern);
    const matcher: CompiledMatcher = { pattern, handler, priority, matchFn };
    
    this.matchers.push(matcher);
    this.clearCache();
    
    // Track if we have context-dependent patterns
    if (typeof pattern === 'function') {
      this.hasContextPatterns = true;
    } else if (typeof pattern === 'string' && !pattern.includes('*') && !pattern.includes('{')) {
      // It's an exact match pattern - add to fast lookup
      const exact = this.exactMatchers.get(pattern) || [];
      exact.push(matcher);
      this.exactMatchers.set(pattern, exact);
    }
    
    // Return unsubscribe function
    return () => {
      const index = this.matchers.indexOf(matcher);
      if (index !== -1) {
        this.matchers.splice(index, 1);
        this.clearCache();
        
        // Remove from exact matchers if applicable
        if (typeof pattern === 'string' && !pattern.includes('*') && !pattern.includes('{')) {
          const exact = this.exactMatchers.get(pattern);
          if (exact) {
            const idx = exact.indexOf(matcher);
            if (idx !== -1) exact.splice(idx, 1);
            if (exact.length === 0) this.exactMatchers.delete(pattern);
          }
        }
        
        // Re-check if we still have context patterns
        this.hasContextPatterns = this.matchers.some(m => typeof m.pattern === 'function');
      }
    };
  }
  
  /**
   * Find all matching handlers for an event type
   */
  findMatches(event: HappenEvent): CompiledMatcher[] {
    // Fast path: check exact matchers first
    const exactMatches = this.exactMatchers.get(event.type);
    
    // If we only have exact patterns and found matches, return them sorted
    if (exactMatches && !this.hasContextPatterns && this.matchers.length === this.exactMatchers.size) {
      return exactMatches.sort((a, b) => b.priority - a.priority);
    }
    
    // Use cache for simple string patterns
    if (!this.hasContextPatterns) {
      const cached = this.cache.get(event.type);
      if (cached) return cached;
    }
    
    // Build matches list starting with exact matches
    const matches: CompiledMatcher[] = [];
    
    // Add exact matches first (already pre-filtered)
    if (exactMatches) {
      matches.push(...exactMatches);
    }
    
    // Then check other patterns (skip exact patterns we already added)
    for (const matcher of this.matchers) {
      // Skip if it's an exact pattern (already handled)
      if (typeof matcher.pattern === 'string' && 
          !matcher.pattern.includes('*') && 
          !matcher.pattern.includes('{')) {
        continue;
      }
      
      // Test the pattern
      if (matcher.matchFn(event.type, event)) {
        matches.push(matcher);
      }
    }
    
    // Sort by priority
    matches.sort((a, b) => b.priority - a.priority);
    
    // Cache if possible
    if (!this.hasContextPatterns) {
      this.cache.set(event.type, matches);
    }
    
    return matches;
  }
  
  /**
   * Clear the pattern cache
   */
  private clearCache(): void {
    this.cache.clear();
    // Note: we don't clear exactMatchers as they're maintained separately
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