/** @jest-environment node */
import {
	DEFAULT_WEB_SERVER_PORT,
	isDerivedEndpoint,
	isolatedDatabaseUrl,
	webServerPort,
	webServerUrl,
} from "../../util/playwright/server-endpoint";

describe("webServerPort", () => {
	describe("when WEB_PORT is set", () => {
		it("returns the override", () => {
			expect(webServerPort("e2e", { env: { WEB_PORT: "43210" } })).toBe(43210);
		});

		it("wins over CI and the derivation", () => {
			expect(
				webServerPort("e2e", {
					env: { WEB_PORT: "43210", CI: "true" },
					seedDir: "/anywhere",
				}),
			).toBe(43210);
		});

		it.each(["0", "65536", "-1", "abc", "12.5"])(
			"rejects invalid port %s",
			(webPort) => {
				expect(() =>
					webServerPort("e2e", { env: { WEB_PORT: webPort } }),
				).toThrow(/WEB_PORT/);
			},
		);
	});

	describe("when CI is set", () => {
		it("keeps the historical :3001 port", () => {
			expect(webServerPort("e2e", { env: { CI: "true" } })).toBe(
				DEFAULT_WEB_SERVER_PORT,
			);
			expect(webServerPort("perf", { env: { CI: "1" } })).toBe(
				DEFAULT_WEB_SERVER_PORT,
			);
		});
	});

	describe("when deriving locally", () => {
		it("returns a port inside the reserved range", () => {
			for (const suite of ["e2e", "perf", "unit"]) {
				const port = webServerPort(suite, { env: {}, seedDir: "/repo" });
				expect(port).toBeGreaterThanOrEqual(20_000);
				expect(port).toBeLessThanOrEqual(48_999);
			}
		});

		it("is deterministic for the same checkout and suite", () => {
			const first = webServerPort("e2e", { env: {}, seedDir: "/repo/a" });
			const second = webServerPort("e2e", { env: {}, seedDir: "/repo/a" });
			expect(first).toBe(second);
		});

		it("differs between worktrees for the same suite", () => {
			const worktreeA = webServerPort("e2e", {
				env: {},
				seedDir: "/worktrees/issue-1",
			});
			const worktreeB = webServerPort("e2e", {
				env: {},
				seedDir: "/worktrees/issue-2",
			});
			expect(worktreeA).not.toBe(worktreeB);
		});

		it("differs between suites in the same worktree", () => {
			const e2e = webServerPort("e2e", { env: {}, seedDir: "/repo" });
			const perf = webServerPort("perf", { env: {}, seedDir: "/repo" });
			expect(e2e).not.toBe(perf);
		});

		it("treats an empty CI flag as unset", () => {
			const derived = webServerPort("e2e", {
				env: { CI: "" },
				seedDir: "/repo",
			});
			const plain = webServerPort("e2e", { env: {}, seedDir: "/repo" });
			expect(derived).toBe(plain);
		});
	});
});

describe("isDerivedEndpoint", () => {
	it("is true for a plain local run", () => {
		expect(isDerivedEndpoint({ env: {} })).toBe(true);
	});

	it("is false on CI", () => {
		expect(isDerivedEndpoint({ env: { CI: "true" } })).toBe(false);
		expect(isDerivedEndpoint({ env: { CI: "1" } })).toBe(false);
	});

	it("is false when WEB_PORT overrides the port", () => {
		expect(isDerivedEndpoint({ env: { WEB_PORT: "43210" } })).toBe(false);
	});

	it("is false when WEB_PORT is set even on CI", () => {
		expect(
			isDerivedEndpoint({ env: { WEB_PORT: "43210", CI: "true" } }),
		).toBe(false);
	});

	it("treats blank CI and WEB_PORT as unset", () => {
		expect(isDerivedEndpoint({ env: { CI: "", WEB_PORT: "  " } })).toBe(true);
	});
});

describe("webServerUrl", () => {
	it("builds the loopback URL for the port", () => {
		expect(webServerUrl(43210)).toBe("http://127.0.0.1:43210");
		expect(webServerUrl(DEFAULT_WEB_SERVER_PORT)).toBe("http://127.0.0.1:3001");
	});
});

describe("isolatedDatabaseUrl", () => {
	const DB_URL =
		"mysql://root:test_123@localhost:3306/tanah_test?ssl-mode=DISABLED";

	it("returns the URL unchanged on CI", () => {
		expect(
			isolatedDatabaseUrl(DB_URL, { env: { CI: "true" }, seedDir: "/repo" }),
		).toBe(DB_URL);
	});

	it("returns the URL unchanged when WEB_PORT overrides the port", () => {
		expect(
			isolatedDatabaseUrl(DB_URL, {
				env: { WEB_PORT: "43210" },
				seedDir: "/repo",
			}),
		).toBe(DB_URL);
	});

	it("rewrites only the database path, keeping credentials and query", () => {
		const result = isolatedDatabaseUrl(DB_URL, {
			env: {},
			seedDir: "/repo",
		});
		const url = new URL(result);
		expect(url.protocol).toBe("mysql:");
		expect(url.hostname).toBe("localhost");
		expect(url.port).toBe("3306");
		expect(url.username).toBe("root");
		expect(url.password).toBe("test_123");
		expect(url.search).toBe("?ssl-mode=DISABLED");
		expect(url.pathname).toMatch(/^\/tanah_test_[0-9a-f]{12}$/);
	});

	it("is deterministic per checkout and differs between checkouts", () => {
		const first = isolatedDatabaseUrl(DB_URL, {
			env: {},
			seedDir: "/worktrees/a",
		});
		const again = isolatedDatabaseUrl(DB_URL, {
			env: {},
			seedDir: "/worktrees/a",
		});
		const other = isolatedDatabaseUrl(DB_URL, {
			env: {},
			seedDir: "/worktrees/b",
		});
		expect(first).toBe(again);
		expect(first).not.toBe(other);
	});

	it("keeps a non-default database base name", () => {
		const result = isolatedDatabaseUrl("mysql://u:p@h:3306/custom_db", {
			env: {},
			seedDir: "/repo",
		});
		expect(new URL(result).pathname).toMatch(/^\/custom_db_[0-9a-f]{12}$/);
	});

	it("defaults the base name when the URL has no database", () => {
		const result = isolatedDatabaseUrl("mysql://u:p@h:3306", {
			env: {},
			seedDir: "/repo",
		});
		expect(new URL(result).pathname).toMatch(/^\/tanah_test_[0-9a-f]{12}$/);
	});
});
