// src/core/crypto.ts

// Define the structure for public and private keys if needed elsewhere
export interface KeyPair {
    publicKey: any; // Use appropriate type, e.g., CryptoKey, JsonWebKey
    privateKey: any; // Use appropriate type
}

export interface IHappenCrypto {
    randomUUID(): string;
    generateKeyPair(): Promise<KeyPair>;
    sign(key: any, data: BufferSource): Promise<any>; // Use appropriate type for signature
    verify(key: any, signature: any, data: BufferSource): Promise<boolean>; // Use appropriate type for signature
    hash(data: BufferSource): Promise<ArrayBuffer>; // Returns hash as ArrayBuffer
    // Add encryption/decryption methods if needed
    // encrypt(key: any, data: BufferSource): Promise<ArrayBuffer>;
    // decrypt(key: any, encryptedData: BufferSource): Promise<ArrayBuffer>;
} 