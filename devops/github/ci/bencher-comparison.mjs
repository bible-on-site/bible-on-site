import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Compare feature/queue measurements with their base; preserve push history. */
export function bencherComparisonArgs(eventName, event, testedBaseSha) {
	if (eventName === "push" || eventName === "workflow_dispatch") return [];
	let branch;
	let sha;
	if (eventName === "pull_request") {
		branch = event.pull_request?.base?.ref;
		// A PR payload can lag the base of the checked synthetic merge.
		sha = testedBaseSha;
	} else if (eventName === "merge_group") {
		branch = event.merge_group?.base_ref;
		sha = event.merge_group?.base_sha;
	} else {
		throw new Error(`Unsupported benchmark event: ${eventName}`);
	}
	if (typeof branch !== "string" || !branch || /[\r\n\0]/.test(branch)
		|| typeof sha !== "string" || !/^[a-f\d]{40}$/i.test(sha)) {
		throw new Error("Benchmark comparison needs a valid base branch and SHA");
	}
	branch = branch.replace(/^refs\/heads\//, "");
	if (!branch) throw new Error("Benchmark base branch is empty");
	return ["--start-point", branch, "--start-point-hash", sha,
		"--start-point-clone-thresholds", "--start-point-reset"];
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	const eventName = process.env.GITHUB_EVENT_NAME;
	let testedBaseSha;
	if (eventName === "pull_request") {
		// Fail if checkout stops testing a merge, rather than using a stale base.
		execFileSync("git", ["rev-parse", "--verify", "HEAD^2"]);
		testedBaseSha = execFileSync("git", ["rev-parse", "HEAD^"], { encoding: "utf8" }).trim();
	}
	const args = bencherComparisonArgs(eventName,
		JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")), testedBaseSha);
	if (args.length) process.stdout.write(`${args.join("\n")}\n`);
}
import { execFileSync } from "node:child_process";
