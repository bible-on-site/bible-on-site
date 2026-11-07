import "@tanstack/react-start/server-only";

/**
 * Runtime environment discriminator. The production image sets
 * NODE_ENV=production (see Dockerfile); dev servers run development and
 * Vitest runs test.
 */
export function productionRuntime(): boolean {
	return process.env.NODE_ENV === "production";
}

/**
 * SKIP_AUTH=true is an explicit local dev/E2E tool only. A stray flag in a
 * production deployment must never disable the Cognito boundary, so it is
 * honored only outside production.
 */
export function skipAuthEnabled(): boolean {
	return !productionRuntime() && process.env.SKIP_AUTH === "true";
}

/**
 * MEASURE_COV=1 drains istanbul coverage over an unauthenticated endpoint for
 * local E2E coverage runs. A stray flag in production must not expose it.
 */
export function measureCovEnabled(): boolean {
	return !productionRuntime() && process.env.MEASURE_COV === "1";
}
