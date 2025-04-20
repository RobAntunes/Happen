// Bun aims for Node.js compatibility for the crypto module.
// We can reuse the NodeJsCrypto implementation directly.

export { NodeJsCrypto as BunCrypto } from './NodeJsCrypto';
