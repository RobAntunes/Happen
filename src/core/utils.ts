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

// --- Remove Base64 Utils and Deno Import Logic Below ---
/*
// Try to import Deno std lib, will fail gracefully in other envs
let DenoBase64: any = null;
try {
    // @ts-ignore - Ignore type error for Deno global
    if (typeof Deno !== 'undefined') {
        // Dynamically import in Deno environment
        const { encode, decode } = await import('https://deno.land/std@0.177.0/encoding/base64.ts');
        DenoBase64 = { encode, decode };
    }
} catch (e) {
    // Ignore import errors in non-Deno environments
}

// ... (encodeToBase64 function removed) ...

// ... (decodeFromBase64 function removed) ...
*/

// --- Remove Redundant Re-export Below ---
/*
// Keep existing utils like canonicalStringify if they exist below
// ...
export { canonicalStringify } from '../utils/canonicalStringify'; // Example: Assuming it was imported/defined elsewhere
*/ 