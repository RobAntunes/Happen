import type { ICrypto, JsonWebKey, BufferSource } from '../core/runtime-modules';

// Helper: ArrayBuffer to Base64Url String
function bufferToBase64Url(buffer: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Helper: Base64Url String to ArrayBuffer
function base64UrlToBuffer(base64Url: string): ArrayBuffer {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const binStr = atob(base64);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binStr.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Browser implementation of the ICrypto interface using Web Crypto API.
 */
export class BrowserCrypto implements ICrypto {
    private subtle: SubtleCrypto;
    private defaultSignAlgo: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };
    private defaultKeyAlgo: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };

    constructor() {
        if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
            throw new Error('Web Crypto API (window.crypto.subtle) is not available in this environment.');
        }
        this.subtle = window.crypto.subtle;
    }

    randomUUID(): string {
        if (!window.crypto.randomUUID) {
            // Basic fallback if crypto.randomUUID is missing (older browsers)
            // NOTE: This is NOT cryptographically strong like the standard!
             console.warn("crypto.randomUUID not available, using basic fallback (NOT secure).");
             return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
        return window.crypto.randomUUID();
    }

    async hash(data: string | Buffer, encoding: BufferEncoding = 'hex'): Promise<string> {
        let buffer: ArrayBuffer;
        if (typeof data === 'string') {
            buffer = new TextEncoder().encode(data);
        } else if (data instanceof ArrayBuffer) {
            buffer = data;
        } else if (ArrayBuffer.isView(data)) {
            buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        } else {
            throw new Error('Unsupported data type for hash');
        }

        const hashBuffer = await this.subtle.digest('SHA-256', buffer);

        if (encoding === 'hex') {
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } else if (encoding === 'base64') {
            return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
        } else if (encoding === 'base64url') {
             return bufferToBase64Url(hashBuffer);
        }
        // Add other encodings if needed, or throw error
        throw new Error(`Unsupported hash encoding: ${encoding}`);
    }

    async generateKeyPair(): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey; }> {
        const keyPair = await this.subtle.generateKey(
            this.defaultKeyAlgo,
            true, // extractable
            ['sign', 'verify']
        );

        // Export keys in JWK format
        const publicKeyJwk = await this.subtle.exportKey('jwk', keyPair.publicKey);
        const privateKeyJwk = await this.subtle.exportKey('jwk', keyPair.privateKey);

        return { publicKey: publicKeyJwk, privateKey: privateKeyJwk };
    }

    async sign(privateKeyJwk: JsonWebKey, data: BufferSource): Promise<string> {
        // Import the private key
        const privateKey = await this.subtle.importKey(
            'jwk',
            privateKeyJwk,
            this.defaultKeyAlgo,
            true, // extractable must be true to import JWK
            ['sign']
        );

        // Sign the data
        const signatureBuffer = await this.subtle.sign(
            this.defaultSignAlgo,
            privateKey,
            data
        );

        // Return signature as base64url string
        return bufferToBase64Url(signatureBuffer);
    }

    async verify(publicKeyJwk: JsonWebKey, signature: string, data: BufferSource): Promise<boolean> {
        // Import the public key
         const publicKey = await this.subtle.importKey(
            'jwk',
            publicKeyJwk,
            this.defaultKeyAlgo,
            true, // extractable must be true to import JWK
            ['verify']
        );

        // Decode the signature from base64url
        const signatureBuffer = base64UrlToBuffer(signature);

        // Verify the signature
        const isValid = await this.subtle.verify(
            this.defaultSignAlgo,
            publicKey,
            signatureBuffer,
            data
        );

        return isValid;
    }
} 