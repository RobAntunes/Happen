/**
 * Pattern matching utilities for event types
 * Supports string patterns and function-based matchers
 */

import type { EventPattern, PatternMatcher } from './types.js';

/**
 * Convert a string pattern to a matcher function
 * Supports:
 * - Exact matching: 'order.submitted'
 * - Wildcards: 'order.*'
 * - Alternatives: '{order,payment}.created'
 */
export function compilePattern(pattern: string): PatternMatcher {
  // Exact match (no special characters)
  if (!pattern.includes('*') && !pattern.includes('{')) {
    return (type: string) => type === pattern;
  }

  // Handle alternatives like {order,payment}.created
  if (pattern.includes('{')) {
    const alternativeRegex = /\{([^}]+)\}/g;
    let regexPattern = pattern.replace(/\./g, '\\.');

    regexPattern = regexPattern.replace(alternativeRegex, (match, alternatives) => {
      return `(${alternatives.split(',').join('|')})`;
    });

    regexPattern = regexPattern.replace(/\*/g, '[^.]*');
    regexPattern = `^${regexPattern}$`;

    const regex = new RegExp(regexPattern);
    return (type: string) => regex.test(type);
  }

  // Handle wildcards
  if (pattern.includes('*')) {
    // Convert pattern to regex
    // 'order.*' becomes '^order\.[^.]*$'
    // This ensures * only matches one segment
    const regexPattern = '^' + pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '[^.]*') + '$';

    const regex = new RegExp(regexPattern);
    return (type: string) => regex.test(type);
  }

  // Fallback to exact match
  return (type: string) => type === pattern;
}

/**
 * Normalize a pattern (string or function) to a matcher function
 */
export function normalizePattern(pattern: EventPattern): PatternMatcher {
  if (typeof pattern === 'function') {
    return pattern;
  }
  return compilePattern(pattern);
}

/**
 * Utility functions for creating common patterns
 */

/**
 * Match events from a specific domain
 * Example: domain('order') matches 'order.created', 'order.submitted', etc.
 */
export function domain(name: string): PatternMatcher {
  return (type: string) => type.startsWith(`${name}.`);
}

/**
 * Match an exact event type
 */
export function exact(fullType: string): PatternMatcher {
  return (type: string) => type === fullType;
}

/**
 * Match using wildcard patterns
 * Example: wildcard('user.*.completed') matches 'user.registration.completed'
 */
export function wildcard(pattern: string): PatternMatcher {
  return compilePattern(pattern);
}

/**
 * Match any of multiple patterns
 */
export function oneOf(...patterns: (string | PatternMatcher)[]): PatternMatcher {
  const matchers = patterns.map(p =>
    typeof p === 'function' ? p : compilePattern(p)
  );
  return (type: string) => matchers.some(matcher => matcher(type));
}

/**
 * Negate a pattern (match everything except)
 */
export function not(pattern: string | PatternMatcher): PatternMatcher {
  const matcher = typeof pattern === 'function' ? pattern : compilePattern(pattern);
  return (type: string) => !matcher(type);
}

/**
 * Match all patterns (AND logic)
 */
export function allOf(...patterns: (string | PatternMatcher)[]): PatternMatcher {
  const matchers = patterns.map(p =>
    typeof p === 'function' ? p : compilePattern(p)
  );
  return (type: string) => matchers.every(matcher => matcher(type));
}
