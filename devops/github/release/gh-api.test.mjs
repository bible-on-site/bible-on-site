import assert from "node:assert/strict";
import { test } from "node:test";
import { ghApi, isTransientApiError, withApiRetries } from "./gh-api.mjs";

/** Mirrors the exact stderr that failed app CD run 37991296999. */
const ioTimeout = () => {
	const error = new Error(
		"Command failed: gh api repos/test/repo/actions/runs/37985174186",
	);
	error.stderr =
		'Get "https://api.github.com/repos/test/repo/actions/runs/37985174186": dial tcp 172.182.252.137:443: i/o timeout\n';
	return error;
};

test("classifies observed runner transport failures as transient", () => {
	assert.equal(isTransientApiError(ioTimeout()), true);
	for (const detail of [
		"HTTP 503",
		"502 Bad Gateway",
		"read ECONNRESET",
		"context deadline exceeded",
		"getaddrinfo ENOTFOUND api.github.com",
		"socket hang up",
	])
		assert.equal(isTransientApiError(new Error(detail)), true, detail);
});

test("deterministic API answers are never transient", () => {
	for (const detail of [
		"gh: Not Found (HTTP 404)",
		"gh: Validation Failed (HTTP 422)",
		"gh: Bad credentials (HTTP 401)",
		"Deployment source must be master push CI",
		"Release tag and artifact commit differ",
	])
		assert.equal(isTransientApiError(new Error(detail)), false, detail);
});

test("retries transient failures then returns the first success", () => {
	let calls = 0;
	const result = withApiRetries(
		() => {
			calls++;
			if (calls < 3) throw ioTimeout();
			return "ok";
		},
		3,
		1,
	);
	assert.equal(result, "ok");
	assert.equal(calls, 3);
});

test("non-transient errors fail on the first attempt", () => {
	let calls = 0;
	assert.throws(
		() =>
			withApiRetries(
				() => {
					calls++;
					throw new Error("gh: Not Found (HTTP 404)");
				},
				3,
				1,
			),
		/Not Found/,
	);
	assert.equal(calls, 1);
});

test("the retry budget stays bounded on persistent transport failures", () => {
	let calls = 0;
	assert.throws(
		() =>
			withApiRetries(
				() => {
					calls++;
					throw ioTimeout();
				},
				3,
				1,
			),
		/i\/o timeout|Command failed/,
	);
	assert.equal(calls, 3);
});

test("ghApi forwards the endpoint and body through the retry wrapper", () => {
	let calls = 0;
	const seen = [];
	const result = ghApi(
		"repos/test/repo",
		{ ref: "a".repeat(40) },
		(endpoint, body) => {
			calls++;
			seen.push([endpoint, body]);
			if (calls === 1) throw ioTimeout();
			return { id: 7 };
		},
		1,
	);
	assert.deepEqual(result, { id: 7 });
	assert.deepEqual(seen, [
		["repos/test/repo", { ref: "a".repeat(40) }],
		["repos/test/repo", { ref: "a".repeat(40) }],
	]);
});

test("the retry attempts parameter is validated", () => {
	assert.throws(() => withApiRetries(() => "x", 0, 1), /positive integer/);
	assert.throws(() => withApiRetries(() => "x", 1.5, 1), /positive integer/);
});
