// Utility functions for pattern matching.

/**
 * Compiles a Happen event pattern string into a RegExp object for matching event types.
 *
 * Supported syntax:
 * - `*`: Matches any sequence of characters within a segment (not crossing separators).
 * - `{alt1,alt2}`: Matches either `alt1` or `alt2` exactly.
 * - Default segment separator is assumed to be '-'.
 *
 * @param pattern The pattern string to compile.
 * @param separator The segment separator character (defaults to '-').
 * @returns A RegExp object for matching event types against the pattern.
 * @throws Error if the pattern is invalid (e.g., unbalanced braces).
 */
export function compilePatternToRegex(pattern: string, separator: string = '-'): RegExp {
    if (typeof pattern !== 'string') {
        throw new Error('Pattern must be a string.');
    }

    // Special case: handle the universal wildcard first
    if (pattern === '*') {
        return /^.*$/; // Match absolutely anything
    }

    const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Escape regex special characters in the pattern, except for our syntax *, {}
    let regexString = pattern.replace(/[.+?^$()|[\]\\]/g, '\\$&'); // Keep ^$?

    // Handle alternatives {alt1,alt2}
    regexString = regexString.replace(/\{([^}]+)\}/g, (match, alternatives) => {
        if (!alternatives) throw new Error(`Invalid pattern: Empty alternatives found in ${pattern}`);
        // Split, trim, filter empty, and escape each part for regex
        const parts = alternatives.split(',')
            .map((s: string) => s.trim())
            .filter((s: string) => s)
            .map((part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); // Re-escape parts

        if (parts.length === 0) throw new Error(`Invalid pattern: No valid alternatives in ${match} in ${pattern}`);

        return '(?:' + parts.join('|') + ')';
    });

    // Handle wildcard *
    // Replace * with a regex that matches any char except the separator, one or more times
    regexString = regexString.replace(/\*/g, `([^${escapedSeparator}]+)`);

    // Ensure the pattern matches the whole string
    return new RegExp('^' + regexString + '$');
}