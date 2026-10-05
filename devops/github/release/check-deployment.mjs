import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const api = (endpoint) =>
	JSON.parse(
		execFileSync("gh", ["api", endpoint], {
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
		}),
	);
const directories = {
	website: "web/bible-on-site",
	api: "web/api",
	admin: "web/admin",
	bulletin: "web/bulletin",
	app: "app",
};
const versionParts = (version) => {
	if (!/^\d+\.\d+\.\d+$/.test(version))
		throw new Error(`Invalid release version: ${version}`);
	return version.split(".").map(Number);
};
export function newerVersion(candidate, version) {
	const a = versionParts(candidate);
	const b = versionParts(version);
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

/** Called inside the target's CD concurrency lock, before any production writes. */
export function checkDeployment(
	{ repo, runId, ref, moduleName, moduleDirectory, version, artifactName },
	request = api,
) {
	if (!/^\d+$/.test(String(runId)))
		throw new Error("A source CI run ID is required");
	const root = `repos/${repo}`;
	const source = request(`${root}/actions/runs/${runId}`);
	if (
		source.name !== "Continuous Integration" ||
		source.event !== "push" ||
		source.head_branch !== "master"
	)
		throw new Error("Deployment source must be master push CI");
	if (ref && ref !== source.head_sha)
		throw new Error("Deployment ref does not match the artifact's CI run");
	ref = source.head_sha;
	if (!/^[a-f0-9]{40}$/.test(ref))
		throw new Error("Deployment requires an immutable commit SHA");
	if (moduleName === "data") {
		// Data has no version tags. A successful newer Release Data job proves
		// that its SQL is ready and its dispatch supersedes this one.
		for (let page = 1; ; page++) {
			const runs = request(
				`${root}/actions/runs?per_page=100&page=${page}`,
			).workflow_runs;
			for (const run of runs) {
				if (run.id <= source.id) return { deploy: true, ref };
				if (
					run.name !== source.name ||
					run.event !== "push" ||
					run.head_branch !== "master"
				)
					continue;
				let dispatched = false;
				for (let jobPage = 1; ; jobPage++) {
					const jobs = request(
						`${root}/actions/runs/${run.id}/jobs?per_page=100&page=${jobPage}`,
					).jobs;
					dispatched = jobs.some(
						(job) =>
							job.name === "Release Data" && job.conclusion === "success",
					);
					if (dispatched || jobs.length < 100) break;
				}
				if (!dispatched) continue;
				if (
					request(`${root}/compare/${ref}...${run.head_sha}`).status === "ahead"
				)
					return {
						deploy: false,
						ref,
						reason: `Superseded by data CI ${run.id}`,
					};
			}
			if (runs.length < 100) return { deploy: true, ref };
		}
	}
	if (!directories[moduleName] || moduleDirectory !== directories[moduleName])
		throw new Error("Unknown deployment module/directory");
	// Manual iOS uploads derive their version from the artifact, rather than 0.0.0.
	if (!version && moduleName === "app")
		version = artifactName?.match(/^app-ios-v(\d+\.\d+\.\d+)$/)?.[1];
	versionParts(version);
	const tag = `${moduleName}-v${version}`;
	if (request(`${root}/compare/${tag}...${ref}`).status !== "identical")
		throw new Error("Release tag and artifact commit differ");
	let found = false;
	for (let page = 1; ; page++) {
		const releases = request(`${root}/releases?per_page=100&page=${page}`);
		for (const release of releases) {
			if (release.draft || release.prerelease) continue;
			if (release.tag_name === tag) found = true;
			if (!release.tag_name.startsWith(`${moduleName}-v`)) continue;
			const candidate = release.tag_name.slice(moduleName.length + 2);
			if (newerVersion(candidate, version))
				return {
					deploy: false,
					ref,
					version,
					reason: `Superseded by ${release.tag_name}`,
				};
		}
		if (releases.length < 100) break;
	}
	if (!found) throw new Error(`No published release for ${tag}`);
	return { deploy: true, ref, version };
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
	const payload = event.client_payload ?? {};
	const result = checkDeployment({
		repo: process.env.GITHUB_REPOSITORY,
		runId: payload.ci_run_id ?? payload.run_id ?? event.inputs?.ci_run_id,
		ref: payload.ref,
		moduleName: process.env.DEPLOY_MODULE,
		moduleDirectory:
			process.env.DEPLOY_MODULE === "data"
				? "data"
				: (payload.module_directory ?? "app"),
		version: payload.module_version,
		artifactName: event.inputs?.ios_artifact_name,
	});
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		`deploy=${result.deploy}\nref=${result.ref}\n`,
	);
	if (result.version)
		appendFileSync(
			process.env.GITHUB_ENV,
			`MODULE_VERSION=${result.version}\n`,
		);
	console.log(result.reason ?? `Deploying immutable source ${result.ref}`);
}
