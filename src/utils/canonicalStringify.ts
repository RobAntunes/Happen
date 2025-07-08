// Utility functions for stringification.

/**
 * Creates a deterministic, canonical string representation of a JavaScript value.
 * Useful for hashing or signing objects where key order should not matter.
 * Sorts object keys recursively before stringifying.
 * Handles basic types, objects, arrays, null.
 * Does NOT handle cyclic references, functions, Maps, Sets, etc. (extend if needed).
 */
export function canonicalStringify(value: any): string {
    // Simple recursive approach for demonstration
    // A robust library like fast-json-stable-stringify might be better in production

    const seen = new WeakSet(); // Basic cycle detection

    function replacer(_key: string, val: any): any {
        if (typeof val === 'object' && val !== null) {
            if (seen.has(val)) {
                throw new Error('Cycle detected during canonical stringification');
            }
            seen.add(val);

            if (Array.isArray(val)) {
                // Process array elements recursively
                return val;
            }
            // Sort keys of plain objects
            const sortedKeys = Object.keys(val).sort();
            const sortedObj: { [key: string]: any } = {};
            for (const k of sortedKeys) {
                sortedObj[k] = val[k];
            }
            return sortedObj;
        }
        // Handle BigInt serialization (if needed, otherwise JSON.stringify throws)
        // if (typeof val === 'bigint') {
        //     return val.toString() + 'n'; // Or a specific marker
        // }
        return val;
    }

    // Stringify with the replacer, no indentation, no space after colon
    return JSON.stringify(value, replacer);
}
