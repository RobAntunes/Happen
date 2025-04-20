/**
 * Creates a deterministic, canonical string representation of a JavaScript value.
 * Handles nested objects and arrays, ensuring object keys are sorted alphabetically.
 * This is crucial for creating consistent hashes of state objects.
 *
 * @param value The value to stringify.
 * @returns A canonical string representation.
 * @throws If the value contains circular references or types unsupported by JSON.
 */
export function canonicalStringify(value: any): string {
    // Check for simple types first (null, boolean, number, string)
    if (value === null || typeof value !== 'object') {
        // Standard JSON.stringify is deterministic for primitives
        return JSON.stringify(value);
    }

    // Handle Arrays: Recursively stringify elements
    if (Array.isArray(value)) {
        const stringifiedElements = value.map(element => canonicalStringify(element));
        return '[' + stringifiedElements.join(',') + ']';
    }

    // Handle Objects: Sort keys, then recursively stringify key-value pairs
    const keys = Object.keys(value).sort();
    const stringifiedPairs = keys.map(key => {
        const stringifiedValue = canonicalStringify(value[key]);
        // Stringify key and value, then join with colon
        return JSON.stringify(key) + ':' + stringifiedValue;
    });

    return '{' + stringifiedPairs.join(',') + '}';
} 