/**
 * MessagePack serialization for efficient event transport
 */

import { HappenEvent } from '../types';

/**
 * Serialization interface
 */
export interface Serializer {
  serialize(data: any): Promise<Uint8Array>;
  deserialize(data: Uint8Array): Promise<any>;
  serializeEvent(event: HappenEvent): Promise<Uint8Array>;
  deserializeEvent(data: Uint8Array): Promise<HappenEvent>;
}

/**
 * MessagePack serializer implementation
 */
export class MessagePackSerializer implements Serializer {
  private msgpack: any = null;
  private initialized = false;

  /**
   * Initialize MessagePack library
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Try to import msgpackr (Node.js and browser compatible)
      this.msgpack = await import('msgpackr');
      this.initialized = true;
    } catch (error) {
      // Fallback to JSON if MessagePack is not available
      console.warn('MessagePack not available, falling back to JSON serialization');
      this.msgpack = {
        pack: (data: any) => new TextEncoder().encode(JSON.stringify(data)),
        unpack: (data: Uint8Array) => JSON.parse(new TextDecoder().decode(data)),
      };
      this.initialized = true;
    }
  }

  /**
   * Serialize data to Uint8Array
   */
  async serialize(data: any): Promise<Uint8Array> {
    await this.initialize();
    
    try {
      return this.msgpack.pack(data);
    } catch (error) {
      throw new Error(`Serialization failed: ${error}`);
    }
  }

  /**
   * Deserialize Uint8Array to data
   */
  async deserialize(data: Uint8Array): Promise<any> {
    await this.initialize();
    
    try {
      return this.msgpack.unpack(data);
    } catch (error) {
      throw new Error(`Deserialization failed: ${error}`);
    }
  }

  /**
   * Serialize HappenEvent with proper type handling
   */
  async serializeEvent(event: HappenEvent): Promise<Uint8Array> {
    await this.initialize();
    
    try {
      // Prepare event for serialization
      const serializable = {
        ...event,
        context: {
          ...event.context,
          // Ensure all context data is serializable
        }
      };
      
      return this.msgpack.pack(serializable);
    } catch (error) {
      throw new Error(`Event serialization failed: ${error}`);
    }
  }

  /**
   * Deserialize to HappenEvent with proper type restoration
   */
  async deserializeEvent(data: Uint8Array): Promise<HappenEvent> {
    await this.initialize();
    
    try {
      const event = this.msgpack.unpack(data);
      
      // Validate required fields
      if (!event.id || !event.type || typeof event.context?.timestamp !== 'number') {
        throw new Error('Invalid event structure');
      }
      
      return event as HappenEvent;
    } catch (error) {
      throw new Error(`Event deserialization failed: ${error}`);
    }
  }
}

/**
 * JSON fallback serializer for environments without MessagePack
 */
export class JSONSerializer implements Serializer {
  async serialize(data: any): Promise<Uint8Array> {
    try {
      return new TextEncoder().encode(JSON.stringify(data));
    } catch (error) {
      throw new Error(`JSON serialization failed: ${error}`);
    }
  }

  async deserialize(data: Uint8Array): Promise<any> {
    try {
      return JSON.parse(new TextDecoder().decode(data));
    } catch (error) {
      throw new Error(`JSON deserialization failed: ${error}`);
    }
  }

  async serializeEvent(event: HappenEvent): Promise<Uint8Array> {
    return this.serialize(event);
  }

  async deserializeEvent(data: Uint8Array): Promise<HappenEvent> {
    const event = await this.deserialize(data);
    
    // Validate required fields
    if (!event.id || !event.type || typeof event.context.timestamp !== 'number') {
      throw new Error('Invalid event structure');
    }
    
    return event as HappenEvent;
  }
}

/**
 * Create appropriate serializer for the environment
 */
export async function createSerializer(): Promise<Serializer> {
  try {
    const msgpackSerializer = new MessagePackSerializer();
    // Test if MessagePack is available
    await msgpackSerializer.serialize({ test: true });
    return msgpackSerializer;
  } catch (error) {
    // Fall back to JSON
    return new JSONSerializer();
  }
}

/**
 * Singleton serializer instance
 */
let defaultSerializer: Serializer | null = null;

/**
 * Get default serializer instance
 */
export async function getDefaultSerializer(): Promise<Serializer> {
  if (!defaultSerializer) {
    defaultSerializer = await createSerializer();
  }
  return defaultSerializer;
}