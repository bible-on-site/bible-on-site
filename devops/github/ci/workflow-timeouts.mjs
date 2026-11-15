#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDocument } from "yaml";

export const MAX_JOB_MINUTES = 60;

// Reusable-workflow callers cannot declare timeouts. Their runner jobs are
// checked in the called workflow, alongside every other local workflow file.
export function validateWorkflow(source, filename) {
	const document = parseDocument(source);
	if (document.errors.length) {
		return document.errors.map((error) => `${filename}: ${error.message}`);
	}
	const workflow = document.toJS();
	if (
		!workflow?.jobs ||
		typeof workflow.jobs !== "object" ||
		Array.isArray(workflow.jobs)
	) {
		return [`${filename}: expected a jobs mapping`];
	}
	const errors = [];
	for (const [id, job] of Object.entries(workflow.jobs)) {
		const location = `${filename}: jobs.${id}`;
		if (!job || typeof job !== "object" || Array.isArray(job)) {
			errors.push(`${location}: expected a job mapping`);
			continue;
		}
		if (Object.hasOwn(job, "uses")) {
			if (Object.hasOwn(job, "timeout-minutes")) {
				errors.push(
					`${location}: reusable-workflow callers cannot set timeout-minutes; cap the called runner jobs`,
				);
			}
			continue;
		}
		if (!Object.hasOwn(job, "runs-on")) {
			errors.push(`${location}: expected runs-on or a reusable-workflow call`);
			continue;
		}
		const limit = job["timeout-minutes"];
		if (!Number.isInteger(limit) || limit < 1 || limit > MAX_JOB_MINUTES) {
			errors.push(
				`${location}: timeout-minutes must be an explicit integer from 1 to ${MAX_JOB_MINUTES} (see docs/tests/workflow-timeouts.md)`,
			);
		}
	}
	return errors;
}

export function auditWorkflows(directory) {
	return readdirSync(directory)
		.filter((name) => /\.ya?ml$/.test(name))
		.sort()
		.flatMap((name) =>
			validateWorkflow(readFileSync(join(directory, name), "utf8"), name),
		);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const directory =
		process.argv[2] ??
		fileURLToPath(new URL("../../../.github/workflows/", import.meta.url));
	const errors = auditWorkflows(directory);
	if (errors.length) {
		console.error(errors.join("\n"));
		process.exitCode = 1;
	} else {
		console.log(
			`All workflow runner jobs have explicit timeouts of at most ${MAX_JOB_MINUTES} minutes.`,
		);
	}
}
