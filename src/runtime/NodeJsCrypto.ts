import * as crypto from 'node:crypto';
// Import the specific JsonWebKey type from node:crypto
import type { JsonWebKey as NodeJsonWebKey } from 'node:crypto';
import type { ICrypto, JsonWebKey, BufferSource } from '../core/runtime-modules';
import { Buffer } from 'node:buffer'; // Ensure Buffer is explicitly imported for type checks/conversions

// Helper: Base64Url String to Buffer for Node.js
function base64UrlToBufferNode(base64Url: string): Buffer {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64');
}

// Helper: Buffer to Base64Url String for Node.js
function bufferToBase64UrlNode(buffer: Buffer): string {
    return buffer.toString('base64url');
}

/**
 * Node.js implementation of the ICrypto interface.
 */
export class NodeJsCrypto implements ICrypto {
    // Algorithm details (can be made configurable)
    private keyGenAlgo = 'ec' as const;
    private keyGenOptions: crypto.ECKeyPairKeyObjectOptions = {
        namedCurve: 'prime256v1' // Equivalent to P-256
    };
    private jwkKeyFormat = 'jwk' as const;
    private signAlgo = 'sha256' as const; // Algorithm for crypto.sign/verify

    randomUUID(): string {
        return crypto.randomUUID();
    }

    // Make hash async to match the interface
    async hash(data: string | Buffer, encoding: crypto.BinaryToTextEncoding = 'hex'): Promise<string> {
        try {
            const hash = crypto.createHash('sha256');
            hash.update(data);
            // Wrap synchronous result in Promise.resolve
            return Promise.resolve(hash.digest(encoding));
        } catch (error) {
            console.error("NodeJsCrypto.hash error:", error);
            return Promise.reject(error);
        }
    }

    async generateKeyPair(): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey }> {
        try {
            // Use the synchronous version to potentially avoid async overload issues
            // Change type from "ec" to "ed25519" as it's more explicitly supported
            // without needing a curve in the same way for the overload resolution.
            const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
                publicKeyEncoding: { type: 'spki', format: this.jwkKeyFormat },
                privateKeyEncoding: { type: 'pkcs8', format: this.jwkKeyFormat }
            });
            // Wrap the result in a resolved promise to match the async signature
            // Cast Node's JWK to our interface type (object)
            return Promise.resolve({ publicKey: publicKey as JsonWebKey, privateKey: privateKey as JsonWebKey });
        } catch (err) {
            console.error("NodeJsCrypto.generateKeyPair error:", err);
            return Promise.reject(err);
        }
    }

    async sign(privateKeyJwk: JsonWebKey, data: BufferSource): Promise<string> {
        try {
            // Check if the key is Ed25519, adjust signing if needed
            // For Ed25519, sign expects null or undefined for algorithm
            const nodePrivateKey = crypto.createPrivateKey({
                 key: privateKeyJwk as NodeJsonWebKey, // Cast to Node's type
                 format: this.jwkKeyFormat
            });

            const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

            // Ed25519 signing in Node.js doesn't use createSign/update/sign pattern
            // It signs the whole buffer directly.
            // The algorithm parameter should be null or undefined for EdDSA.
            const signatureBuffer = crypto.sign(null, dataBuffer, nodePrivateKey);

            // const signer = crypto.createSign(this.signAlgo); // Old EC way
            // signer.update(dataBuffer);
            // signer.end();
            // const signatureBuffer = signer.sign(privateKey);

            return bufferToBase64UrlNode(signatureBuffer);
        } catch (error) {
             console.error("NodeJsCrypto.sign error:", error);
             throw error; // Re-throw after logging
        }
    }

    async verify(publicKeyJwk: JsonWebKey, signature: string, data: BufferSource): Promise<boolean> {
        try {
            // Adjust verification for Ed25519
             const nodePublicKey = crypto.createPublicKey({
                 key: publicKeyJwk as NodeJsonWebKey, // Cast to Node's type
                 format: this.jwkKeyFormat
            });

            const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            const signatureBuffer = base64UrlToBufferNode(signature);

            // Ed25519 verification in Node.js uses crypto.verify directly
            // Algorithm parameter should be null or undefined for EdDSA.
            return crypto.verify(null, dataBuffer, nodePublicKey, signatureBuffer);

            // const verifier = crypto.createVerify(this.signAlgo); // Old EC way
            // verifier.update(dataBuffer);
            // verifier.end();
            // return verifier.verify(publicKey, signatureBuffer);
        } catch (error) {
             console.error("NodeJsCrypto.verify error:", error);
            // In case of error (e.g., invalid key, bad signature format), verification fails
            return false;
        }
    }
} 