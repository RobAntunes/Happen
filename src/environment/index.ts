/**
 * Environment detection for cross-platform compatibility
 */

export type RuntimeEnvironment = 'node' | 'browser' | 'webworker' | 'deno' | 'bun' | 'unknown';

export interface EnvironmentCapabilities {
  hasWebSocket: boolean;
  hasTCP: boolean;
  hasFileSystem: boolean;
  hasWorkers: boolean;
  hasNativeModules: boolean;
  supportsJetStream: boolean;
}

/**
 * Detect the current runtime environment
 */
export function detectEnvironment(): RuntimeEnvironment {
  // Deno detection
  if (typeof Deno !== 'undefined' && Deno.version) {
    return 'deno';
  }
  
  // Bun detection
  if (typeof Bun !== 'undefined' && Bun.version) {
    return 'bun';
  }
  
  // Node.js detection
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return 'node';
  }
  
  // Browser/WebWorker detection
  if (typeof window !== 'undefined') {
    return 'browser';
  }
  
  if (typeof self !== 'undefined' && typeof importScripts === 'function') {
    return 'webworker';
  }
  
  return 'unknown';
}

/**
 * Get environment capabilities
 */
export function getEnvironmentCapabilities(env?: RuntimeEnvironment): EnvironmentCapabilities {
  const environment = env || detectEnvironment();
  
  switch (environment) {
    case 'node':
    case 'deno':
    case 'bun':
      return {
        hasWebSocket: true,
        hasTCP: true,
        hasFileSystem: true,
        hasWorkers: true,
        hasNativeModules: true,
        supportsJetStream: true,
      };
      
    case 'browser':
      return {
        hasWebSocket: true,
        hasTCP: false,
        hasFileSystem: false,
        hasWorkers: true,
        hasNativeModules: false,
        supportsJetStream: true, // Via WebSocket
      };
      
    case 'webworker':
      return {
        hasWebSocket: true,
        hasTCP: false,
        hasFileSystem: false,
        hasWorkers: false,
        hasNativeModules: false,
        supportsJetStream: true, // Via WebSocket
      };
      
    default:
      return {
        hasWebSocket: false,
        hasTCP: false,
        hasFileSystem: false,
        hasWorkers: false,
        hasNativeModules: false,
        supportsJetStream: false,
      };
  }
}

/**
 * Check if a specific capability is available
 */
export function hasCapability(capability: keyof EnvironmentCapabilities): boolean {
  const capabilities = getEnvironmentCapabilities();
  return capabilities[capability];
}

/**
 * Get the optimal NATS connection type for the current environment
 */
export function getOptimalNATSConnection(): 'tcp' | 'websocket' | 'none' {
  const capabilities = getEnvironmentCapabilities();
  
  if (capabilities.hasTCP) {
    return 'tcp';
  }
  
  if (capabilities.hasWebSocket) {
    return 'websocket';
  }
  
  return 'none';
}

/**
 * Environment-specific configuration
 */
export interface EnvironmentConfig {
  defaultNATSServers: string[];
  connectionType: 'tcp' | 'websocket' | 'none';
  maxReconnectAttempts: number;
  reconnectDelayMs: number;
  enableJetStream: boolean;
}

/**
 * Get default configuration for the current environment
 */
export function getDefaultConfig(): EnvironmentConfig {
  const connectionType = getOptimalNATSConnection();
  
  const baseConfig = {
    maxReconnectAttempts: 10,
    reconnectDelayMs: 1000,
    enableJetStream: true,
  };
  
  switch (connectionType) {
    case 'tcp':
      return {
        ...baseConfig,
        defaultNATSServers: ['nats://localhost:4222'],
        connectionType: 'tcp',
      };
      
    case 'websocket':
      return {
        ...baseConfig,
        defaultNATSServers: ['ws://localhost:8222'],
        connectionType: 'websocket',
      };
      
    default:
      return {
        ...baseConfig,
        defaultNATSServers: [],
        connectionType: 'none',
        enableJetStream: false,
      };
  }
}

/**
 * Environment information
 */
export interface EnvironmentInfo {
  runtime: RuntimeEnvironment;
  capabilities: EnvironmentCapabilities;
  config: EnvironmentConfig;
  userAgent?: string;
  version?: string;
}

/**
 * Get complete environment information
 */
export function getEnvironmentInfo(): EnvironmentInfo {
  const runtime = detectEnvironment();
  const capabilities = getEnvironmentCapabilities(runtime);
  const config = getDefaultConfig();
  
  const info: EnvironmentInfo = {
    runtime,
    capabilities,
    config,
  };
  
  // Add environment-specific details
  switch (runtime) {
    case 'node':
      info.version = process.version;
      break;
      
    case 'browser':
      info.userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
      break;
      
    case 'deno':
      info.version = typeof Deno !== 'undefined' ? Deno.version.deno : undefined;
      break;
      
    case 'bun':
      info.version = typeof Bun !== 'undefined' ? Bun.version : undefined;
      break;
  }
  
  return info;
}