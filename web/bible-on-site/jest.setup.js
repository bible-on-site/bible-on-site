process.env.IS_TEST_ENV = 1;

/* jest-environment-jsdom strips the Node globals that server-side deps
   (jsdom via whatwg-url) need at module load — restore them globally. */
const { TextDecoder, TextEncoder } = require("node:util");
const {
	ReadableStream,
	TransformStream,
	WritableStream,
} = require("node:stream/web");
const { MessagePort } = require("node:worker_threads");
globalThis.TextEncoder ??= TextEncoder;
globalThis.TextDecoder ??= TextDecoder;
// undici (jsdom 30 dep) touches stream/message globals at module load.
// MessageChannel is deliberately not exposed: react-scheduler adopts it for
// its task loop and the ref'd channel keeps the Jest worker alive.
globalThis.ReadableStream ??= ReadableStream;
globalThis.WritableStream ??= WritableStream;
globalThis.TransformStream ??= TransformStream;
globalThis.MessagePort ??= MessagePort;

// Mock isomorphic-dompurify so we don't need to transform its ESM deps (jsdom, @exodus/bytes, etc.)
jest.mock("isomorphic-dompurify", () => ({
	__esModule: true,
	default: { sanitize: (html) => html },
}));

// The store-metadata build snapshot is generated per environment; unit tests
// must always run against an empty seed so results are deterministic (#2395).
// Individual tests override this factory with jest.doMock when needed.
jest.mock("@/data/db/store-metadata-snapshot.generated.json", () => ({}));

// Setup for SWC coverage instrumentation
// The swc-plugin-coverage-instrument stores coverage in the global object
// We need to ensure it's accessible from the reporter
if (typeof globalThis !== "undefined") {
	// Initialize coverage object if it doesn't exist
	globalThis.__coverage__ = globalThis.__coverage__ || {};
}
