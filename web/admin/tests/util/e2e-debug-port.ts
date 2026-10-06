/**
 * Inspector port for the admin e2e dev server. The launcher binds it on the
 * Vite process (NODE_OPTIONS=--inspect); the Playwright global teardown
 * connects to the same port to pull server-side V8 coverage.
 */
export const E2E_SERVER_DEBUG_PORT = 9333;
