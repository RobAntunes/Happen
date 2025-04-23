import { HappenEvent } from './event';

export interface IHappenPermission {
    // Define methods relevant to checking permissions
    canPublish(nodeId: string, eventType: string): Promise<boolean>;
    canSubscribe(nodeId: string, eventType: string): Promise<boolean>;
    canHandle(nodeId: string, event: HappenEvent<any>): Promise<boolean>;
}

// Basic placeholder implementation (allow all)
export class HappenPermission implements IHappenPermission {
    constructor(/* dependencies? */) {}

    async canPublish(nodeId: string, eventType: string): Promise<boolean> {
        // console.log(`Placeholder: Checking publish permission for ${nodeId} on ${eventType}`);
        return Promise.resolve(true); // Default allow
    }

    async canSubscribe(nodeId: string, eventType: string): Promise<boolean> {
        // console.log(`Placeholder: Checking subscribe permission for ${nodeId} on ${eventType}`);
        return Promise.resolve(true); // Default allow
    }

    async canHandle(nodeId: string, event: HappenEvent<any>): Promise<boolean> {
       // console.log(`Placeholder: Checking handle permission for ${nodeId} on event ${event.metadata.id}`);
        return Promise.resolve(true); // Default allow
    }
} 