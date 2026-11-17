import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { parse } from "yaml";

// Evaluate only the literal conjunctions used by these cache guards, without
// executing workflow text as JavaScript. Unsupported syntax fails the test.
function allowed(expression, context) {
	const value = (path) =>
		path.split(".").reduce((object, key) => object?.[key], context);
	return expression
		.replace(/^\$\{\{\s*|\s*\}\}$/g, "")
		.split("&&")
		.every((part) => {
			const term = part.trim();
			const negation = /^!([\w.-]+)$/.exec(term);
			if (negation) return !value(negation[1]);
			const comparison = /^([\w.-]+)\s*(==|!=)\s*'([^']*)'$/.exec(term);
			assert(comparison, `Unsupported cache condition: ${term}`);
			const actual = value(comparison[1]) ?? "";
			// GitHub's string comparisons are case-insensitive. These contexts use
			// only typed booleans and canonical string outputs, never numeric casts.
			const equal =
				String(actual).toLowerCase() === comparison[3].toLowerCase();
			return comparison[2] === "==" ? equal : !equal;
		});
}

const workflows = ["app-package.yml", "ci.yml"].map((name) => ({
	name,
	workflow: parse(
		readFileSync(
			new URL(`../../../.github/workflows/${name}`, import.meta.url),
			"utf8",
		),
	),
}));
const saves = workflows.flatMap(({ name, workflow }) =>
	Object.entries(workflow.jobs).flatMap(([job, definition]) =>
		(definition.steps ?? [])
			.filter(
				(step) =>
					step.uses?.startsWith("actions/cache/save@") &&
					String(step.with?.path ?? "").includes(".cache/recitation-assets/"),
			)
			.map((step) => ({ name, job, step })),
	),
);

describe("recitation cache publication", () => {
	test("includes all four verified-audio publishers in the trust matrix", () => {
		assert.equal(saves.length, 4);
	});

	for (const { name, job, step } of saves) {
		describe(`for ${name}/${job}`, () => {
			test("allows cache-miss saves only on master", () => {
				for (const [event, ref, expected] of [
					["push", "refs/heads/master", true],
					["workflow_dispatch", "refs/heads/master", true],
					["repository_dispatch", "refs/heads/master", true],
					["pull_request", "refs/pull/123/merge", false],
					[
						"merge_group",
						"refs/heads/gh-readonly-queue/master/pr-123-base",
						false,
					],
					["push", "refs/heads/codex/change", false],
					["workflow_dispatch", "refs/heads/codex/change", false],
				]) {
					for (const cacheHit of ["", "false", "true"]) {
						const context = {
							github: { event_name: event, ref },
							inputs: { compile_only: false },
							steps: {
								recitation_audio: { outputs: { "cache-hit": cacheHit } },
							},
						};
						assert.equal(
							allowed(step.if, context),
							expected && cacheHit !== "true",
							`${event}/${ref}/${cacheHit}`,
						);
					}
				}
				if (job === "package_windows") {
					assert.equal(
						allowed(step.if, {
							github: { ref: "refs/heads/master" },
							inputs: { compile_only: true },
							steps: {
								recitation_audio: { outputs: { "cache-hit": "false" } },
							},
						}),
						false,
					);
				}
			});
		});
	}
});
