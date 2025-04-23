import { HappenEvent } from './event';

export interface IHappenValidator {
    validate(event: HappenEvent<any>): Promise<boolean>; // Returns true if valid
}

// Basic pass-through implementation
export class HappenValidator implements IHappenValidator {
    async validate(event: HappenEvent<any>): Promise<boolean> {
        // Add actual validation logic here based on event type, schema, permissions etc.
        // console.log(`Validating event ${event.metadata.id} of type ${event.type}...`);
        return true; // Default to valid for placeholder
    }
} 