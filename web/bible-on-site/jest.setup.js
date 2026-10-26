process.env.IS_TEST_ENV = 1;

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
