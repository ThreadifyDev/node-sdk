# Changelog

All notable changes to the Threadify SDK will be documented in this file.

## [0.3.0] - 2026-09-23

### Added
- Add `connection.thread(threadKey, { refs, label, contract, tags, serviceName }?)`
  to atomically create or resume a thread without storing its internal ID.

### Changed
- Resume with the stored contract and pinned version; reject conflicting
  contracts and writes to terminal threads.
- Use `threadify.thread_key` throughout SDK exporters and OTLP ingestion.
  The previous external-reference correlation attribute has been removed.
- Defer export completion until the batch's spans have been recorded. Terminal
  threads reject late spans. Deploy the matching Engine and SDK updates together.

## [0.2.0] - 2026-09-15

### Added
- Connect with one Engine URL, including reverse-proxy path prefixes.
- Query threads with reference maps through `getThreadsByRef`.
- Wait for contract permission and exact-event validation, with cancellation and recovery identifiers.
- Surface structured licensing and connection errors.

### Release automation
- Validate the packed ESM and CommonJS entry points before publishing.
- Publish the tested tarball to npm through GitHub Actions OIDC with provenance.

## [0.1.5] - 2026-02-04

### Added
- **CommonJS Support**: SDK now supports both ES Modules (ESM) and CommonJS (CJS)
  - Dual package exports in `package.json`
  - Automatic build script to generate CommonJS files
  - `dist/` folder with `.cjs` files for CommonJS users
  - Full backward compatibility with existing ESM code

### Changed
- Updated `package.json` with dual exports:
  - `"main": "dist/index.cjs"` - CommonJS entry point
  - `"module": "src/index.js"` - ES Module entry point
  - `"exports"` field for modern bundlers
- Added build script (`scripts/build-cjs.js`) to convert ESM to CJS
- Updated `prepublishOnly` script to build CJS files before publishing

### Documentation
- Added CommonJS usage examples in README
- Created `examples/commonjs-example.js` with full working example
- Added module support section explaining both ESM and CJS usage
- Updated Quick Start section with both ESM and CommonJS examples

### Files Added
- `scripts/build-cjs.js` - Build script for CommonJS conversion
- `examples/commonjs-example.js` - Complete CommonJS usage example
- `CHANGELOG.md` - This file

### Migration Guide
No breaking changes. Existing ESM code continues to work as before.

**For CommonJS users:**
```javascript
// Before (not supported)
const Threadify = require('@threadify/sdk'); // ❌ Error

// After (now supported)
const { Threadify } = require('@threadify/sdk'); // ✅ Works!
```

## [0.1.4] - 2026-02-04

### Changed
- Minor version bump

## [0.1.3] - Previous releases

See git history for earlier changes.
