process.env.IS_TEST_ENV = 1;

// Mock isomorphic-dompurify so we don't need to transform its ESM deps (jsdom, @exodus/bytes, etc.)
jest.mock("isomorphic-dompurify", () => ({
	__esModule: true,
	default: { sanitize: (html) => html },
}));

// Setup for SWC coverage instrumentation
// The swc-plugin-coverage-instrument stores coverage in the global object
// We need to ensure it's accessible from the reporter
if (typeof globalThis !== "undefined") {
	// Initialize coverage object if it doesn't exist
	globalThis.__coverage__ = globalThis.__coverage__ || {};
}
