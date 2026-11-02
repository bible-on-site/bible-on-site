import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deployAPIWithHandover } from "./api-rollout-cli.mjs";

for (const fail of [false, true])
	test(
		"CLI owns publication, journal and client cleanup" +
			(fail ? " after failure" : " after success"),
		async () => {
			const dir = await mkdtemp(join(tmpdir(), "api-cli-test-")),
				journal = join(dir, "handover.ndjson");
			let published = 0,
				callerClosed = false,
				transportClosed = false;
			try {
				const dependencies = {
					createCaller: () => ({
						call() {},
						close() {
							callerClosed = true;
						},
					}),
					createTransport: () => ({
						request() {},
						observations: [],
						dnsObservations: [],
						close() {
							transportClosed = true;
						},
					}),
					run: async ({ publish, version, record }) => {
						assert.equal(version, "0.1.101");
						await publish();
						record("test-proof", { passed: !fail });
						if (fail)
							throw Object.assign(new Error("private-canary"), {
								name: "TestFailure",
							});

						test("journal append failure falls back to workflow logs without blocking publication or recovery", async (t) => {
							const dir = await mkdtemp(join(tmpdir(), "api-cli-fallback-")),
								lines = [];
							t.mock.method(console, "error", (...args) =>
								lines.push(args.join(" ")),
							);
							try {
								let published = false;
								const result = await deployAPIWithHandover({
									config: {},
									journal: join(dir, "handover.ndjson"),
									deployer: {
										async getLocalVersion() {
											return "0.1.101";
										},
										async deploy() {
											published = true;
										},
									},
									dependencies: {
										append() {
											throw new Error("private disk error canary");
										},
										createCaller: () => ({ call() {}, close() {} }),
										createTransport: () => ({
											request() {},
											observations: [],
											dnsObservations: [],
											close() {},
										}),
										run: async ({ publish, record }) => {
											await publish();
											record("rollback-intent", { task: "owned-task" });
											return { passed: true };
										},
									},
								});
								assert.equal(published, true);
								assert.deepEqual(result, { passed: true });
								assert.match(lines.join("\n"), /rollback-intent/);
								assert.match(lines.join("\n"), /public-transport/);
								assert.doesNotMatch(
									lines.join("\n"),
									/private disk error canary/,
								);
							} finally {
								await rm(dir, { recursive: true, force: true });
							}
						});
						return { changed: true };
					},
				};
				const promise = deployAPIWithHandover({
					config: {},
					journal,
					dependencies,
					deployer: {
						async getLocalVersion() {
							return "0.1.101";
						},
						async deploy() {
							published++;
						},
					},
				});
				if (fail)
					await assert.rejects(promise, (error) => {
						assert.match(error.message, /TestFailure/);
						assert.doesNotMatch(error.message, /private-canary/);
						return true;
					});
				else assert.deepEqual(await promise, { changed: true });
				assert.equal(published, 1);
				assert.equal(callerClosed, true);
				assert.equal(transportClosed, true);
				const content = await readFile(journal, "utf8");
				assert.match(content, /test-proof/);
				assert.match(content, /public-transport/);
				assert.doesNotMatch(content, /private-canary/);
				await assert.rejects(
					deployAPIWithHandover({
						config: {},
						journal,
						dependencies,
						deployer: {},
					}),
					/EEXIST/,
				);
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
	);
