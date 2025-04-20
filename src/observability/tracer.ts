import type { EventObserver, IHappenEmitter } from '../core/emitter';
import { PatternEmitter } from '../core/PatternEmitter';
import type { HappenEventMetadata, HappenEvent } from '../core/event';
import { compilePatternToRegex } from '../utils/patternUtils';

interface TraceEntry {
    path: string[]; // Sequence of sender IDs involved in the trace
    events: HappenEvent<any>[]; // Sequence of related events in the trace
    startTime: number; // Timestamp of the first event added
    lastUpdateTime: number; // Timestamp of the last event added
}

export interface EventTracer {
    /** Stop tracing and remove the underlying observer. */
    dispose: () => void;
    /** Retrieve the trace data for a specific identifier (e.g., correlation ID or initial event ID). */
    getTrace: (traceId: string) => TraceEntry | undefined;
    /** Get all currently captured traces. */
    getAllTraces: () => Map<string, TraceEntry>;
}

// Default function to extract the primary trace identifier from an event.
// Prefers correlationId, falls back to event id.
const defaultTraceIdKey = (event: HappenEvent<any>): string | undefined => {
    // Remove detailed logging
    // const corrId = event.metadata.correlationId;
    // const eventId = event.metadata.id;
    // const result = corrId ?? eventId;
    // console.log(`[DefaultTraceIdKey Debug] Event: ${event.type} (ID: ${eventId}) - CorrID: ${corrId} -> Result: ${result}`);
    // return result;
    return event.metadata.correlationId ?? event.metadata.id;
};

// Default function to extract the parent/causation identifier from an event.
const defaultParentTraceIdKey = (event: HappenEvent<any>): string | undefined => {
    return event.metadata.causationId;
};

/**
 * Creates an EventTracer instance that observes events from an emitter
 * and groups them into traces based on correlation and causation IDs.
 *
 * @param pattern A pattern (like used in `on`) to match event types that should be traced.
 * @param emitter The IHappenEmitter instance to attach the observer to.
 * @param traceIdKey Optional function to extract the primary trace identifier from an event.
 * @param parentTraceIdKey Optional function to extract the parent/causation identifier from an event.
 */
export function createEventTracer(
    pattern: string,
    emitter: IHappenEmitter,
    traceIdKey: (event: HappenEvent<any>) => string | undefined = defaultTraceIdKey,
    parentTraceIdKey: (event: HappenEvent<any>) => string | undefined = defaultParentTraceIdKey
): EventTracer {

    const traces = new Map<string, TraceEntry>();
    let patternRegex: RegExp;

    // Use the centralized utility function for compiling the pattern
    try {
        patternRegex = compilePatternToRegex(pattern);
    } catch (e) {
        console.error(`[EventTracer] Failed to compile pattern '${pattern}':`, e);
        throw new Error(`Invalid pattern for EventTracer: ${pattern}`);
    }

    const observer: EventObserver = (event: HappenEvent<any>) => {
        // Only trace events matching the specified type pattern
        if (!patternRegex.test(event.type)) {
            return;
        }

        const traceId = traceIdKey(event);
        const parentId = parentTraceIdKey(event);
        const sender = event.metadata.sender ?? 'unknown';
        const timestamp = event.metadata.timestamp ?? Date.now();

        // --- REMOVE DEBUG LOGGING START ---
        // console.log(`[Tracer Debug] Event: ${event.type} (ID: ${event.metadata.id})`);
        // console.log(`               TraceIDKey Result: ${traceId}`);
        // console.log(`               ParentIDKey Result: ${parentId}`);
        // --- REMOVE DEBUG LOGGING END ---

        if (!traceId) {
            // Cannot trace without a primary identifier
            // console.warn(`[EventTracer] Event ${event.metadata.id} lacks traceable ID (correlationId or id).`);
            return;
        }

        let entry = traces.get(traceId);
        let parentEntry: TraceEntry | undefined = undefined;

        // If not found by primary ID, check if it belongs to an existing trace via parentId
        if (!entry && parentId) {
            parentEntry = traces.get(parentId);
            if (parentEntry) {
                // Found parent trace. Use this entry, and map the current traceId to it as well.
                entry = parentEntry;
                traces.set(traceId, entry);
            }
        }

        if (entry) {
            // Add event to existing trace
            entry.events.push(event);
            entry.lastUpdateTime = Math.max(entry.lastUpdateTime, timestamp);
            // Add sender to path if it's different from the last node in the path
            if (entry.path[entry.path.length - 1] !== sender) {
                entry.path.push(sender);
            }
        } else {
            // Start a new trace
            traces.set(traceId, {
                path: [sender], // Start path with the current sender
                events: [event],
                startTime: timestamp,
                lastUpdateTime: timestamp,
            });
        }
    };

    // Attach the observer to the emitter
    const disposeObserver = emitter.addObserver(observer);
    console.log(`[EventTracer] Attached observer for pattern: ${pattern}`);
    // Remove compiled regex log
    // console.log(`[EventTracer] Compiled Regex: ${patternRegex}`);

    // Return the EventTracer API
    return {
        dispose: () => {
            disposeObserver();
            traces.clear(); // Clear captured traces
            console.log(`[EventTracer] Disposed observer for pattern: ${pattern}`);
        },
        getTrace: (id: string): TraceEntry | undefined => {
            return traces.get(id);
        },
        getAllTraces: (): Map<string, TraceEntry> => {
            // Return a clone to prevent external modification?
            // For now, return direct map.
            return traces;
        },
    };
}