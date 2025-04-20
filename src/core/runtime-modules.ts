import type { HappenEvent } from './event';
import type { IHappenEmitter } from './emitter';

/** Represents a JSON Web Key object. */
export type JsonWebKey = object; // Basic type placeholder

/** Represents data types compatible with Web Crypto operations. */
export type BufferSource = ArrayBufferView | ArrayBuffer;

/**
 * Interface for basic cryptographic operations needed by Happen.
 */
export interface ICrypto {
  /**
   * Generates a cryptographically strong random UUID (version 4).
   * @returns A UUID string.
   */
  randomUUID(): string;

  /**
   * Creates a cryptographic hash (e.g., SHA-256) of the input data.
   * @param data The data to hash (string or Buffer).
   * @param encoding The desired output encoding (e.g., 'hex', 'base64'). Defaults to 'hex'.
   * @returns A promise resolving to the hash digest as a string.
   */
  hash(data: string | Buffer, encoding?: BufferEncoding): Promise<string>;

  /**
   * Generates a new asymmetric key pair suitable for signing and verification.
   * Typically uses ECDSA with P-256 curve by default.
   * @returns A promise resolving to an object containing the public and private keys in JWK format.
   */
  generateKeyPair(): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey }>;

  /**
   * Signs the given data using the private key.
   * @param privateKeyJwk The private key in JWK format.
   * @param data The data to sign (BufferSource).
   * @returns A promise resolving to the signature as a base64url encoded string.
   */
  sign(privateKeyJwk: JsonWebKey, data: BufferSource): Promise<string>;

  /**
   * Verifies the signature against the given data using the public key.
   * @param publicKeyJwk The public key in JWK format.
   * @param signature The signature as a base64url encoded string.
   * @param data The data that was signed (BufferSource).
   * @returns A promise resolving to true if the signature is valid, false otherwise.
   */
  verify(publicKeyJwk: JsonWebKey, signature: string, data: BufferSource): Promise<boolean>;

  // Add other methods like HMAC if needed later
  // createHmac(algorithm: string, key: string | Buffer): any;
}

/**
 * Interface defining the core methods required from an event emitter implementation.
 * Based on Node.js EventEmitter API.
 */
export interface IEventEmitter {
  on(eventName: string | symbol, listener: (...args: any[]) => void): this;
  off(eventName: string | symbol, listener: (...args: any[]) => void): this;
  emit(eventName: string | symbol, ...args: any[]): boolean;
  setMaxListeners(n: number): this;
  // Add other EventEmitter methods if needed (e.g., once, listenerCount)
}

/**
 * Container for runtime-specific modules injected into Happen components.
 */
export interface HappenRuntimeModules {
  crypto: ICrypto;
  /**
   * An instance conforming to the IHappenEmitter interface,
   * which includes pattern matching and observer capabilities.
   * Note: This is an *instance*, not the class/constructor itself.
   */
  emitterInstance: IHappenEmitter;
} 