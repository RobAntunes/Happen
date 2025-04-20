import type { EventObserver } from '../core/emitter';
import type { HappenEvent } from '../core/event';

/**
 * Options for the console observer.
 */
export interface ConsoleObserverOptions {
    prefix?: string;
    logPayload?: boolean;
    logMetadata?: boolean;
}

/**
 * Creates a simple EventObserver that logs event details to the console.
 *
 * @param options Configuration options for logging.
 * @returns An EventObserver function.
 */
export function createConsoleObserver(options?: ConsoleObserverOptions): EventObserver {
    const prefix = options?.prefix ?? '[OBSERVER]';
    const logPayload = options?.logPayload ?? true;
    const logMetadata = options?.logMetadata ?? false;

    return (event: HappenEvent<any>) => {
        const logParts = [
            `${prefix}`,
            `Type: ${event.type},`, // Comma for potential spacing
            `ID: ${event.metadata.id},`,
            `Sender: ${event.metadata.sender}`
        ];

        if (logPayload) {
            try {
                logParts.push(`, Payload: ${JSON.stringify(event.payload)}`);
            } catch (e) {
                logParts.push(', Payload: [Unserializable]');
            }
        }

        if (logMetadata) {
             try {
                // Clone metadata and remove potentially large/redundant fields for logging
                const metaToLog = { ...event.metadata };
                delete metaToLog.signature; // Often long
                delete metaToLog.publicKey; // Can be large
                logParts.push(`, Meta: ${JSON.stringify(metaToLog)}`);
            } catch (e) {
                logParts.push(', Meta: [Unserializable]');
            }
        }

        console.log(logParts.join(' ')); // Join with space for readability
    };
}
