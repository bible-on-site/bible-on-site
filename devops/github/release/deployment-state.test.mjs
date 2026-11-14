import assert from "node:assert/strict";
import { test } from "node:test";
import { finishDeployment, startDeployment } from "./deployment-state.mjs";

const input = {
	repo: "test/repo",
	target: "app-ios",
	ref: "a".repeat(40),
	version: "5.0.120",
	runId: "10",
};

test("a repeated dispatch skips a successful upload for the same platform and version", () => {
	const result = startDeployment(input, (url, body) => {
		assert.equal(body, undefined);
		if (url.includes("/statuses?")) return [{ state: "success" }];
		return [{ id: 1, payload: { release_key: "app-ios-v5.0.120" } }];
	});
	assert.equal(result.deploy, false);
});

test("failed, cancelled and unfinished attempts remain retryable", () => {
	for (const state of ["failure", "error", "in_progress", undefined]) {
		const writes = [];
		const result = startDeployment(input, (url, body) => {
			if (body) {
				writes.push(body);
				return { id: 2 };
			}
			if (url.includes("/statuses?")) return state ? [{ state }] : [];
			return [{ id: 1, payload: { release_key: "app-ios-v5.0.120" } }];
		});
		assert.deepEqual(result, { deploy: true, deploymentId: 2 });
		assert.equal(writes[0].auto_merge, false);
		assert.equal(writes[0].environment, "app-ios");
		assert.equal(writes[1].state, "in_progress");
	}
});

test("another platform's success does not suppress a failed platform", () => {
	const result = startDeployment(
		{ ...input, target: "app-android" },
		(url, body) => {
			if (body) return { id: 2 };
			assert.match(url, /environment=app-android/);
			return [{ id: 1, payload: { release_key: "app-ios-v5.0.120" } }];
		},
	);
	assert.equal(result.deploy, true);
});

test("a verified iOS upload does not suppress independent beta distribution", () => {
	const writes = [];
	const result = startDeployment(
		{ ...input, target: "app-ios-beta" },
		(url, body) => {
			if (body) {
				writes.push(body);
				return { id: 2 };
			}
			assert.match(url, /environment=app-ios-beta/);
			return [{ id: 1, payload: { release_key: "app-ios-v5.0.120" } }];
		},
	);
	assert.deepEqual(result, { deploy: true, deploymentId: 2 });
	assert.equal(writes[0].environment, "app-ios-beta");
	assert.equal(writes[0].ref, input.ref);
	assert.deepEqual(writes[0].payload, {
		release_key: "app-ios-beta-v5.0.120",
		ci_run_id: input.runId,
		ci_run_attempt: "1",
	});
	assert.equal(writes[1].state, "in_progress");
});

test("successful beta distribution is a no-op on retry and independent of upload", () => {
	for (const target of ["app-ios-beta", "app-ios"]) {
		const result = startDeployment({ ...input, target }, (url, body) => {
			if (body) {
				assert.equal(target, "app-ios");
				return { id: 2 };
			}
			if (url.includes("/statuses?")) return [{ state: "success" }];
			assert.ok(url.includes(`environment=${target}&`));
			return [{ id: 1, payload: { release_key: "app-ios-beta-v5.0.120" } }];
		});
		assert.equal(result.deploy, target === "app-ios");
	}
});

test("failed beta distribution remains retryable without changing upload history", () => {
	const writes = [];
	const result = startDeployment(
		{ ...input, target: "app-ios-beta" },
		(url, body) => {
			if (body) {
				writes.push({ url, body });
				return { id: 3 };
			}
			if (url.includes("/statuses?")) return [{ state: "failure" }];
			assert.match(url, /environment=app-ios-beta/);
			return [{ id: 2, payload: { release_key: "app-ios-beta-v5.0.120" } }];
		},
	);
	assert.deepEqual(result, { deploy: true, deploymentId: 3 });
	assert.equal(writes[0].body.environment, "app-ios-beta");
	assert.match(writes[1].url, /deployments\/3\/statuses$/);
});

test("deployment history pagination retains completion evidence", () => {
	const result = startDeployment(input, (url) => {
		if (url.includes("/statuses?")) return [{ state: "success" }];
		if (url.endsWith("page=1")) return Array(100).fill({ payload: {} });
		return [{ id: 1, payload: { release_key: "app-ios-v5.0.120" } }];
	});
	assert.equal(result.deploy, false);
});

test("data identity includes the immutable artifact ID", () => {
	let key;
	startDeployment(
		{ ...input, target: "data", version: undefined, artifactId: "90" },
		(_url, body) => {
			if (!body) return [];
			if (body.payload) key = body.payload.release_key;
			return { id: 2 };
		},
	);
	assert.equal(key, `data-${input.ref}-10-90`);
});

test("record failures stop deployment instead of assuming it is safe", () => {
	assert.throws(
		() =>
			startDeployment(input, () => {
				throw new Error("API unavailable");
			}),
		/API unavailable/,
	);
	assert.throws(
		() => startDeployment(input, (_, body) => (body ? {} : [])),
		/did not create/,
	);
	assert.throws(
		() => startDeployment({ ...input, target: "unknown" }),
		/Unknown deployment/,
	);
});

test("final success and failure remain visible with their workflow logs", () => {
	for (const state of ["success", "failure"]) {
		finishDeployment("test/repo", 2, state, (url, body) => {
			assert.match(url, /deployments\/2\/statuses$/);
			assert.equal(body.state, state);
			assert.equal(body.auto_inactive, false);
		});
	}
	assert.throws(
		() => finishDeployment("test/repo", undefined, "success"),
		/ID is required/,
	);
});

test("a rebuilt SQL archive is independent while its repeated dispatch is a no-op", () => {
	for (const artifactId of ["90", "91"]) {
		const result = startDeployment(
			{
				...input,
				target: "data",
				version: undefined,
				artifactId,
				runAttempt: 2,
			},
			(url, body) => {
				if (body) {
					if (body.payload) {
						assert.equal(body.payload.sql_artifact_id, artifactId);
						assert.equal(body.payload.ci_run_attempt, "2");
					}
					return { id: 2 };
				}
				if (url.includes("/statuses?")) return [{ state: "success" }];
				return [{ id: 1, payload: { release_key: `data-${input.ref}-10-90` } }];
			},
		);
		assert.equal(result.deploy, artifactId === "91");
	}
});
