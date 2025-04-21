// src/core/hook-types.ts

import type { HappenEvent } from './event';
import type { HappenNode } from './node';

/**
 * Represents the context object passed to hook functions.
 */
export interface HookContext<S = any, T = any> {
    /** The event that triggered this lifecycle point. */
    readonly event: HappenEvent<T>;
    /** The node's state before the event (available in most hooks). */
    readonly currentState: S;
    /** The node's state after the event (only available in `afterStateChange`). */
    readonly newState?: S;
    /** Function to call to halt further processing for the current lifecycle point and prevent the associated core action. */
    stop: () => void;
    /** Read-only flag indicating if stop() has been called. */
    readonly isStopped: boolean;
    /** If the handler threw an error (only available in `postHandle`). */
    readonly handlerError?: Error;
    // Add other potential context properties here, e.g., nodeId?
}

/**
 * Type for a single hook function.
 * It receives the context and can optionally return a Promise.
 */
export type HookFunction<S = any, T = any> =
    (context: HookContext<S, T>) => any | Promise<any>;

/**
 * Defines the available points in the node's lifecycle where hooks can run.
 */
export type LifecyclePoint =
    | 'preEmit'
    | 'preHandle'
    | 'postHandle'
    | 'preStateChange'
    | 'afterStateChange';

/**
 * Structure for defining hooks for various lifecycle points within a single registration.
 */
export interface EventHooks<S = any, T = any> {
    preEmit?: HookFunction<S, T> | HookFunction<S, T>[];
    preHandle?: HookFunction<S, T> | HookFunction<S, T>[];
    postHandle?: HookFunction<S, T> | HookFunction<S, T>[];
    preStateChange?: HookFunction<S, T> | HookFunction<S, T>[];
    afterStateChange?: HookFunction<S, T> | HookFunction<S, T>[];
}

/**
 * Options for a group of hooks registered together.
 */
export interface HookRegistrationOptions {
    /** Execution priority (lower numbers run first). Defaults to 0. */
    priority?: number;
}

/**
 * Function signature for the function returned by registerHooks, used to unregister them.
 */
export type UnregisterFunction = () => void;

/**
 * Internal representation of a registered hook.
 */
export interface RegisteredHook<S = any, T = any> {
    registrationId: string; // ID linking hooks from the same registerHooks call
    eventTypeFilter: string | string[]; // Original filter string/array
    lifecyclePoint: LifecyclePoint;
    hookFunction: HookFunction<S, T>;
    priority: number;
    // Index within an array if defined as part of an array in EventHooks
    arrayIndex: number;
} 