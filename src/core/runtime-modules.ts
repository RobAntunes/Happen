import type { HappenEvent } from './event';
import { IHappenState } from './state';
import { IHappenEventLog } from './event-log';
import { IHappenPublisher } from './publisher';
import { IHappenSubscriber } from './subscriber';
import { IHappenValidator } from './validator';
import { IHappenReplicator } from './replicator';
import { IHappenMerger } from './merger';
import { IHappenSyncer } from './syncer';
import { IHappenStore } from './store';
import { IHappenHandler } from './handler';
import { IHappenSchema } from './schema';
import { IHappenPermission } from './permission';

/**
 * Interface for basic EventEmitter functionality required by PatternEmitter.
 * Compatible with Node.js EventEmitter, mitt, etc.
 */
export interface IEventEmitter {
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    // Make off optional as not all simple emitters might have it
    off?(event: string | symbol, listener: (...args: any[]) => void): this;
    emit(event: string | symbol, ...args: any[]): boolean;
    setMaxListeners(n: number): this;
    // Optional: Add other common methods if needed, like listenerCount
    listenerCount?(event: string | symbol): number;
    // Optional destroy method
    destroy?(): void;
}

/**
 * Defines the interface for the core event emitter used by Happen nodes.
 * This can be implemented by PatternEmitter (for in-process with patterns)
 * or NatsEmitter (for distributed NATS-based communication).
 */
export interface IHappenEmitter {
    emit(eventType: string, event: HappenEvent<any>): void | Promise<void>;
    on(eventTypeOrPattern: string, listener: HappenListener<any>): void | Promise<void>;
    off(eventTypeOrPattern: string, listener: HappenListener<any>): void | Promise<void>;
    addObserver(observer: EventObserver): () => void;
    setMaxListeners(n: number): this;
    destroy?(): void; // Optional destroy method
}

/**
 * Defines the listener function type for Happen events.
 */
export type HappenListener<T = any> = (event: HappenEvent<T>) => void | Promise<void>;

/**
 * Defines the observer function type.
 */
export type EventObserver = (event: HappenEvent<any>) => void | Promise<void>;


// Type definition for cryptographic operations
export type JsonWebKey = any; // Replace with actual JWK type if available or define
export type BufferSource = ArrayBufferView | ArrayBuffer;

/**
 * Interface for cryptographic functions needed by HappenNode.
 * Allows injecting different implementations (Node.js crypto, browser SubtleCrypto).
 */
export interface ICrypto {
    randomUUID(): string;
    generateKeyPair(): Promise<{ publicKey: JsonWebKey, privateKey: JsonWebKey }>;
    sign(privateKey: JsonWebKey, data: BufferSource): Promise<string>; // Returns base64 signature
    verify(publicKey: JsonWebKey, signature: string | BufferSource, data: BufferSource): Promise<boolean>;
    hash(data: string): Promise<string>; // Returns hex or base64 hash
}

/**
 * Structure containing required and optional runtime modules injected into nodes.
 */
export interface HappenRuntimeModules {
    // --- Required --- 
    crypto: ICrypto;

    // --- Optional Emitter ---
    // Provide either a full IHappenEmitter or just a base IEventEmitter to be wrapped by PatternEmitter
    emitterInstance?: IHappenEmitter;
    baseEventEmitterInstance?: IEventEmitter; // If provided, PatternEmitter will be used

    // --- Optional Core Components (Instance OR Constructor) ---
    stateInstance?: IHappenState<any>;
    stateConstructor?: new (initialState: any) => IHappenState<any>;

    eventLogInstance?: IHappenEventLog;
    eventLogConstructor?: new () => IHappenEventLog;

    publisherInstance?: IHappenPublisher;
    publisherConstructor?: new (emitter: IHappenEmitter) => IHappenPublisher;

    subscriberInstance?: IHappenSubscriber;
    subscriberConstructor?: new (emitter: IHappenEmitter) => IHappenSubscriber;

    validatorInstance?: IHappenValidator;
    validatorConstructor?: new () => IHappenValidator;

    handlerInstance?: IHappenHandler;
    handlerConstructor?: new () => IHappenHandler;

    schemaInstance?: IHappenSchema;
    schemaConstructor?: new () => IHappenSchema;

    permissionInstance?: IHappenPermission;
    permissionConstructor?: new () => IHappenPermission;

    // --- Optional Advanced Components (Instance OR Constructor) ---
    replicatorInstance?: IHappenReplicator;
    replicatorConstructor?: new () => IHappenReplicator;

    mergerInstance?: IHappenMerger;
    mergerConstructor?: new () => IHappenMerger;

    syncerInstance?: IHappenSyncer;
    syncerConstructor?: new () => IHappenSyncer;

    storeInstance?: IHappenStore;
    storeConstructor?: new () => IHappenStore;
} 