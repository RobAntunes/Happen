/**
 * Browser-specific type definitions for Happen
 */

declare global {
  interface Window {
    crypto: Crypto;
  }

  interface Crypto {
    subtle: SubtleCrypto;
  }

  interface SubtleCrypto {
    generateKey(
      algorithm: EcKeyGenParams,
      extractable: boolean,
      keyUsages: KeyUsage[]
    ): Promise<CryptoKeyPair>;
    
    sign(
      algorithm: EcdsaParams,
      key: CryptoKey,
      data: BufferSource
    ): Promise<ArrayBuffer>;
    
    verify(
      algorithm: EcdsaParams,
      key: CryptoKey,
      signature: BufferSource,
      data: BufferSource
    ): Promise<boolean>;
    
    exportKey(format: "jwk", key: CryptoKey): Promise<JsonWebKey>;
    importKey(
      format: "jwk",
      keyData: JsonWebKey,
      algorithm: EcKeyImportParams,
      extractable: boolean,
      keyUsages: KeyUsage[]
    ): Promise<CryptoKey>;
    
    digest(
      algorithm: AlgorithmIdentifier,
      data: BufferSource
    ): Promise<ArrayBuffer>;
  }

  interface EcKeyGenParams {
    name: string;
    namedCurve: string;
  }

  interface EcdsaParams {
    name: string;
    hash: { name: string };
  }

  interface EcKeyImportParams {
    name: string;
    namedCurve: string;
  }

  interface CryptoKeyPair {
    publicKey: CryptoKey;
    privateKey: CryptoKey;
  }

  interface CryptoKey {
    type: string;
    extractable: boolean;
    algorithm: any;
    usages: string[];
  }

  type BufferSource = ArrayBufferView | ArrayBuffer;
  type KeyUsage = "sign" | "verify" | "encrypt" | "decrypt" | "deriveKey" | "deriveBits" | "wrapKey" | "unwrapKey";
  type AlgorithmIdentifier = string | Algorithm;
  
  interface Algorithm {
    name: string;
  }

  interface JsonWebKey {
    kty?: string;
    use?: string;
    key_ops?: string[];
    alg?: string;
    ext?: boolean;
    crv?: string;
    x?: string;
    y?: string;
    d?: string;
    n?: string;
    e?: string;
    p?: string;
    q?: string;
    dp?: string;
    dq?: string;
    qi?: string;
    k?: string;
  }

  interface BroadcastChannel extends EventTarget {
    readonly name: string;
    postMessage(message: any): void;
    close(): void;
    onmessage: ((this: BroadcastChannel, ev: MessageEvent) => any) | null;
    onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => any) | null;
  }

  interface MessageEvent<T = any> extends Event {
    readonly data: T;
    readonly origin: string;
    readonly lastEventId: string;
    readonly source: MessageEventSource | null;
    readonly ports: ReadonlyArray<MessagePort>;
  }

  type MessageEventSource = WindowProxy | MessagePort | ServiceWorker;

  interface CloseEvent extends Event {
    readonly code: number;
    readonly reason: string;
    readonly wasClean: boolean;
  }

  class WebSocket extends EventTarget {
    constructor(url: string, protocols?: string | string[]);
    readonly CONNECTING: 0;
    readonly OPEN: 1;
    readonly CLOSING: 2;
    readonly CLOSED: 3;
    readonly readyState: number;
    readonly url: string;
    readonly bufferedAmount: number;
    readonly extensions: string;
    readonly protocol: string;
    binaryType: BinaryType;
    close(code?: number, reason?: string): void;
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
    onopen: ((this: WebSocket, ev: Event) => any) | null;
    onerror: ((this: WebSocket, ev: Event) => any) | null;
    onclose: ((this: WebSocket, ev: CloseEvent) => any) | null;
    onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null;
  }
}

export {};