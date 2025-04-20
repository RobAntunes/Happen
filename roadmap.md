# Roadmap

## TODO - Building

- Cryptographic identity
- Non-Regex pattern matching
- ICrypto interface for each runtime
- Cross-environment capabilities
- Observability and testing
- Seen nonces implementation (review/refine existing approach)
- Implementations for Deno (using Web Crypto) and Browsers (Web Crypto, CustomEvent or BroadcastChannel) are needed for true runtime agnosticism.

## Done / Resolved

- **off: event removal for wrapped handlers:** Resolved by adopting the disposer pattern for listener cleanup (`on` returns a dispose function, `off` removed).
