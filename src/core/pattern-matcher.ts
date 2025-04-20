/**
 * Converts a Happen event pattern into a regular expression.
 * Handles:
 * - Exact matches (e.g., 'order-created')
 * - Wildcards (*) which match any sequence of non-separator characters (default: '-')
 * - Alternatives ({alt1,alt2,...}) which match any of the alternatives
 *
 * @param pattern The Happen event pattern string.
 * @param separator The character used as a separator in event types (default: '-').
 * @returns A RegExp object for testing event types.
 */
function convertPatternToRegExp(pattern: string, separator: string = '-'): RegExp {
    // Escape the separator for regex use
    const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 1. Handle alternatives first: {alt1,alt2} -> (alt1|alt2)
    let regexString = pattern.replace(/\{([^}]+)\}/g, (match, alternatives) => {
        const parts = alternatives.split(',').map((s: string) => s.trim()).filter((s: string) => s);
        // Escape each alternative part for regex safety
        const escapedParts = parts.map((part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return '(?:' + escapedParts.join('|') + ')';
    });

    // 2. Escape remaining regex special characters (except * which we handle next)
    // Make sure not to double-escape parts already escaped within alternatives
    // A bit tricky, might need refinement depending on allowed characters in types
    // For now, let's escape common chars outside the processed alternatives
    regexString = regexString.replace(/(\.|\[|\]|\(|\)|\^|\$|\+|\?|\.|\|)/g, '\\$1');

    // 3. Handle wildcards: * -> ([^separator]+)
    // This matches one or more characters that are NOT the separator
    regexString = regexString.replace(/\*/g, `([^${escapedSeparator}]+)`);

    // 4. Anchor the regex to match the whole string
    return new RegExp('^' + regexString + '$');
}

/**
 * Tests if an event type string matches a given Happen event pattern.
 *
 * @param pattern The Happen event pattern (e.g., 'order-*', 'user-{created,updated}', 'payment-processed').
 * @param eventType The specific event type string to test (e.g., 'order-submitted', 'user-created').
 * @param separator Optional separator character used in patterns and types (default: '-').
 * @returns True if the event type matches the pattern, false otherwise.
 */
export function matchesPattern(pattern: string, eventType: string, separator: string = '-'): boolean {
    if (pattern === '*') {
        // Global wildcard always matches
        return true;
    }
    if (pattern === eventType) {
        // Direct match optimization
        return true;
    }

    // If no special characters ({}, *), it must be an exact match (already checked above)
    if (!/[{}*]/.test(pattern)) {
        return false;
    }

    try {
        const regex = convertPatternToRegExp(pattern, separator);
        return regex.test(eventType);
    } catch (e) {
        console.error(`Invalid pattern '${pattern}' for matching:`, e);
        return false; // Treat invalid patterns as non-matching
    }
} 