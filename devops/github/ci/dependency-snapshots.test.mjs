import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyDependencySnapshots } from "./dependency-snapshots.mjs";

const source = {
	repository: "bible-on-site/bible-on-site",
	base: "a".repeat(40),
	head: "b".repeat(40),
	token: "fixture-token",
};
const response = (changes, warning) => new Response(JSON.stringify(changes), {
	headers: warning ? {
		"x-github-dependency-graph-snapshot-warnings": Buffer.from(warning).toString("base64"),
	} : {},
});

test("complete snapshots with no dependency changes are accepted", async () => {
	assert.deepEqual(await verifyDependencySnapshots({
		...source,
		fetcher: async (url, options) => {
			assert.equal(url, `https://api.github.com/repos/${source.repository}/dependency-graph/compare/${source.base}...${source.head}`);
			assert.equal(options.headers.Authorization, "Bearer fixture-token");
			assert.ok(options.signal instanceof AbortSignal);
			return response([]);
		},
	}), []);
});

test("complete snapshots preserve dependency changes for the existing review", async () => {
	const changes = [{ change_type: "added", name: "Example", version: "1.2.3" }];
	assert.deepEqual(await verifyDependencySnapshots({
		...source, fetcher: async () => response(changes),
	}), changes);
});

for (const warning of [
	"The number of snapshots compared for the base SHA (2) and the head SHA (1) do not match.",
	"No snapshots were found for the head SHA.",
]) {
	test(`an empty diff with a snapshot warning is rejected: ${warning}`, async () => {
		await assert.rejects(verifyDependencySnapshots({
			...source, fetcher: async () => response([], warning),
		}), { message: `Dependency snapshot comparison is incomplete: ${warning}` });
	});
}

for (const status of [403, 500]) {
	test(`HTTP ${status} cannot produce a green verification`, async () => {
		await assert.rejects(verifyDependencySnapshots({
			...source, fetcher: async () => new Response("Unavailable", { status }),
		}), { message: `Dependency snapshot comparison failed: HTTP ${status}` });
	});
}

test("network and timeout failures propagate", async () => {
	const failure = new Error("Timed out");
	await assert.rejects(verifyDependencySnapshots({
		...source, fetcher: async () => { throw failure; },
	}), (error) => error === failure);
});

test("an invalid API response cannot produce a green verification", async () => {
	await assert.rejects(verifyDependencySnapshots({
		...source, fetcher: async () => response({}),
	}), /invalid diff/);
});

test("invalid or mutable inputs fail before any API call", async () => {
	for (const invalid of [{ base: "master" }, { head: undefined }, { repository: "" }, { token: "" }]) {
		await assert.rejects(verifyDependencySnapshots({
			...source, ...invalid,
			fetcher: async () => { assert.fail("Invalid inputs must not reach the API"); },
		}));
	}
});
