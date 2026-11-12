import { createHash } from "node:crypto";
import path from "node:path";

/**
 * Endpoint of the Playwright-managed website server.
 *
 * Every local checkout used to share `127.0.0.1:3001`: the webServer URL, the
 * e2e launcher's `next dev -p`, and hardcoded test URLs all pointed there.
 * On a machine running several worktrees at once, foreign e2e traffic landed
 * on whichever session held the port and inflated the timed perf window —
 * ~350 foreign requests turned a passing sefer-flip run into a deadline
 * failure (issue #2881). `reuseExistingServer` could also attach a suite to
 * a different checkout's server entirely.
 *
 * Locally, each (worktree, suite) pair therefore derives a stable port from
 * the checkout path, so parallel sessions never share a listener. `WEB_PORT`
 * overrides the derivation, and CI keeps the historical :3001 — runners are
 * single-tenant, so nothing there benefits from the split.
 */

/** Port used on CI and for the historical single-checkout local default. */
export const DEFAULT_WEB_SERVER_PORT = 3001;

/**
 * Derived ports stay inside 20000–48999: clear of the repo's own servers
 * (3001 website, 3101 admin, 3003 api, 3013 recitation) and of common dev
 * ports, and below the default Windows ephemeral range (49152+) so outbound
 * connections cannot collide with the listener.
 */
const PORT_RANGE_START = 20_000;
const PORT_RANGE_SPAN = 29_000;

export interface WebServerEndpointOptions {
	/** Environment to read WEB_PORT/CI from. Defaults to process.env. */
	env?: Record<string, string | undefined>;
	/**
	 * Checkout-identifying path folded into the derivation. Defaults to this
	 * package's directory, which is unique per git worktree.
	 */
	seedDir?: string;
}

/** This package's directory — unique per git worktree. */
function defaultSeedDir(): string {
	return path.resolve(__dirname, "../../..");
}

/**
 * True when this run derives per-checkout resources — the listener port and
 * the MySQL test database — instead of sharing the CI/manual defaults.
 * Mirrors `webServerPort`'s gating exactly: `WEB_PORT` is the manual escape
 * hatch and opts out of derivation entirely, and CI stays on the shared
 * defaults because runners are single-tenant.
 */
export function isDerivedEndpoint(
	{ env = process.env }: WebServerEndpointOptions = {},
): boolean {
	return !env.CI && !env.WEB_PORT?.trim();
}

/**
 * Port the Playwright webServer and every test-side URL must agree on.
 * Callers in one run share the result through `use.baseURL` and
 * `webServer.env.WEB_PORT`; the e2e launcher reads the env var because it is
 * a separate process.
 */
export function webServerPort(
	suite: string,
	{ env = process.env, seedDir }: WebServerEndpointOptions = {},
): number {
	const override = env.WEB_PORT?.trim();
	if (override) {
		const port = Number(override);
		if (!Number.isInteger(port) || port < 1 || port > 65_535) {
			throw new Error(
				`WEB_PORT must be an integer between 1 and 65535, got "${override}"`,
			);
		}
		return port;
	}
	if (env.CI) return DEFAULT_WEB_SERVER_PORT;
	const seed = `${seedDir ?? defaultSeedDir()}:${suite}`;
	const digest = createHash("sha256").update(seed).digest();
	return PORT_RANGE_START + (digest.readUInt32BE(0) % PORT_RANGE_SPAN);
}

/** `http://127.0.0.1:<port>` — the loopback URL tests and the server share. */
export function webServerUrl(port: number): string {
	return `http://127.0.0.1:${port}`;
}

/**
 * MySQL test-database isolation, the database-side counterpart of
 * `webServerPort`.
 *
 * `.test.env` gives every local checkout the same `tanah_test` database, and
 * the e2e launcher's `cargo make mysql-populate` drops and rebuilds its
 * tables — so two worktrees running suites at once could rebuild the schema
 * under each other's feet even with separate ports. When the endpoint is
 * derived, the database name therefore gets a per-checkout suffix from the
 * same seed, keeping host, credentials, port, and query intact.
 *
 * The name is per-checkout rather than per-suite on purpose: the perf suite's
 * webServer is the standalone production server with no populate step, so it
 * must keep reading the database the e2e launcher populated in this
 * worktree — exactly what both suites shared as `tanah_test` before.
 *
 * Returns `dbUrl` unchanged when the endpoint is not derived (CI, or a
 * manual `WEB_PORT` run, which owns its isolation like before).
 */
export function isolatedDatabaseUrl(
	dbUrl: string,
	{ env = process.env, seedDir }: WebServerEndpointOptions = {},
): string {
	if (!isDerivedEndpoint({ env })) return dbUrl;
	const url = new URL(dbUrl);
	const baseName = url.pathname.replace(/^\//, "") || "tanah_test";
	// 48 bits of checkout hash: wide enough that two worktrees colliding on
	// the database name is not a practical concern.
	const suffix = createHash("sha256")
		.update(seedDir ?? defaultSeedDir())
		.digest("hex")
		.slice(0, 12);
	url.pathname = `/${baseName}_${suffix}`;
	return url.toString();
}
