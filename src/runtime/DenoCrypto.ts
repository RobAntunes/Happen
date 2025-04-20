import type { ICrypto, JsonWebKey, BufferSource } from '../core/runtime-modules';

// --- Helpers (Identical to BrowserCrypto) --- //

// Helper: ArrayBuffer to Base64Url String
function bufferToBase64Url(buffer: ArrayBuffer): string {
    // Deno supports btoa and Uint8Array directly
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Helper: Base64Url String to ArrayBuffer
function base64UrlToBuffer(base64Url: string): ArrayBuffer {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    // Deno supports atob directly
    const binStr = atob(base64);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binStr.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Deno implementation of the ICrypto interface using Web Crypto API.
 */
export class DenoCrypto implements ICrypto {
    private subtle: SubtleCrypto;
    // Re-define defaults as they are class-specific configuration
    private defaultSignAlgo: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };
    private defaultKeyAlgo: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };

    constructor() {
        // Deno provides crypto in the global scope
        if (typeof crypto === 'undefined' || !crypto.subtle) {
            throw new Error('Web Crypto API (crypto.subtle) is not available in this Deno environment.');
        }
        this.subtle = crypto.subtle;
    }

    randomUUID(): string {
        // Deno provides crypto.randomUUID globally
        if (!crypto.randomUUID) {
             throw new Error('crypto.randomUUID is not available in this Deno environment.');
        }
        return crypto.randomUUID();
    }

    async hash(data: string | Buffer, encoding: BufferEncoding = 'hex'): Promise<string> {
        let buffer: ArrayBuffer;
        if (typeof data === 'string') {
            // Deno provides TextEncoder globally
            buffer = new TextEncoder().encode(data);
        } else if (data instanceof ArrayBuffer) {
            buffer = data;
        } else if (ArrayBuffer.isView(data)) {
            buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        } else {
            throw new Error('Unsupported data type for hash');
        }

        const hashBuffer = await this.subtle.digest('SHA-256', buffer);

        // Standard Buffer Encodings (should be compatible)
        if (encoding === 'hex') {
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } else if (encoding === 'base64') {
            return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
        } else if (encoding === 'base64url') {
             return bufferToBase64Url(hashBuffer);
        }
        throw new Error(`Unsupported hash encoding: ${encoding}`);
    }

    async generateKeyPair(): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey; }> {
        const keyPair = await this.subtle.generateKey(
            this.defaultKeyAlgo,
            true, // extractable
            ['sign', 'verify']
        );

        const publicKeyJwk = await this.subtle.exportKey('jwk', keyPair.publicKey);
        const privateKeyJwk = await this.subtle.exportKey('jwk', keyPair.privateKey);

        return { publicKey: publicKeyJwk, privateKey: privateKeyJwk };
    }

    async sign(privateKeyJwk: JsonWebKey, data: BufferSource): Promise<string> {
        const privateKey = await this.subtle.importKey(
            'jwk',
            privateKeyJwk,
            this.defaultKeyAlgo,
            true,
            ['sign']
        );

        const signatureBuffer = await this.subtle.sign(
            this.defaultSignAlgo,
            privateKey,
            data
        );

        return bufferToBase64Url(signatureBuffer);
    }

    async verify(publicKeyJwk: JsonWebKey, signature: string, data: BufferSource): Promise<boolean> {
         const publicKey = await this.subtle.importKey(
            'jwk',
            publicKeyJwk,
            this.defaultKeyAlgo,
            true,
            ['verify']
        );

        const signatureBuffer = base64UrlToBuffer(signature);

        const isValid = await this.subtle.verify(
            this.defaultSignAlgo,
            publicKey,
            signatureBuffer,
            data
        );

        return isValid;
    }
} 