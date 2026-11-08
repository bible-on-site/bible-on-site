/** @jest-environment node */
import {
	DEFAULT_WEB_SERVER_PORT,
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

describe("webServerUrl", () => {
	it("builds the loopback URL for the port", () => {
		expect(webServerUrl(43210)).toBe("http://127.0.0.1:43210");
		expect(webServerUrl(DEFAULT_WEB_SERVER_PORT)).toBe("http://127.0.0.1:3001");
	});
});
