import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSqlArtifact } from "./data-artifact.mjs";
import { startDeployment } from "./deployment-state.mjs";
import { releasePayload } from "./release-provenance.mjs";

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

/** A failed-jobs-only rerun can retain an earlier successful quality gate. */
function checkQuality(root, runId, runAttempt, request) {
	let quality;
	for (let page = 1; ; page++) {
		const jobs = request(
			`${root}/actions/runs/${runId}/jobs?filter=all&per_page=100&page=${page}`,
		).jobs;
		for (const job of jobs) {
			const attempt = job.run_attempt ?? 1;
			if (
				job.name === "Cross Module CI" &&
				attempt <= runAttempt &&
				(!quality ||
					attempt > (quality.run_attempt ?? 1) ||
					(attempt === (quality.run_attempt ?? 1) && job.id > quality.id))
			)
				quality = job;
		}
		if (jobs.length < 100) break;
	}
	if (quality?.conclusion !== "success")
		throw new Error(
			"Source CI has not passed Cross Module CI for the release attempt",
		);
}

/** Called inside the target's CD concurrency lock, before any production writes. */
export function checkDeployment(
	{
		repo,
		runId,
		ref,
		moduleName,
		moduleDirectory,
		version,
		artifactName,
		runAttempt,
		artifactId,
		artifactDigest,
	},
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
	const currentAttempt = source.run_attempt ?? 1;
	runAttempt = Number(runAttempt ?? currentAttempt);
	if (
		!Number.isSafeInteger(runAttempt) ||
		runAttempt < 1 ||
		runAttempt > currentAttempt
	)
		throw new Error("Invalid source CI attempt");
	if (moduleName === "data") {
		// Completion is durable even if a newer CI run is subsequently rerun and fails.
		// Compare commits, because Actions creation/queue order is not commit order.
		const comparisons = new Map();
		for (let page = 1; ; page++) {
			const deployments = request(
				`${root}/deployments?environment=data&task=deploy:release&per_page=100&page=${page}`,
			);
			for (const deployment of deployments) {
				let newer =
					deployment.sha === ref &&
					(Number(deployment.payload?.ci_run_id) > Number(runId) ||
						(Number(deployment.payload?.ci_run_id) === Number(runId) &&
							Number(deployment.payload?.ci_run_attempt) > runAttempt));
				if (deployment.sha !== ref) {
					if (!comparisons.has(deployment.sha))
						comparisons.set(
							deployment.sha,
							request(`${root}/compare/${ref}...${deployment.sha}`).status,
						);
					newer = comparisons.get(deployment.sha) === "ahead";
				}
				const alreadyDelivered =
					artifactId !== undefined &&
					deployment.sha === ref &&
					String(deployment.payload?.ci_run_id) === String(runId) &&
					String(deployment.payload?.sql_artifact_id) === String(artifactId);
				if (!newer && !alreadyDelivered) continue;
				const [status] = request(
					`${root}/deployments/${deployment.id}/statuses?per_page=1`,
				);
				if (status?.state === "success")
					return {
						deploy: false,
						ref,
						reason: alreadyDelivered
							? `SQL archive ${artifactId} already deployed successfully`
							: `Superseded by successful data deployment ${deployment.id}`,
					};
			}
			if (deployments.length < 100) break;
		}
		// Data has no version tags. A successful newer Release Data job proves
		// that its SQL is ready and its dispatch supersedes this one.
		dataRuns: for (let page = 1; ; page++) {
			const runs = request(
				`${root}/actions/runs?per_page=100&page=${page}`,
			).workflow_runs;
			for (const run of runs) {
				if (run.id < source.id) break dataRuns;
				if (run.id === source.id && (run.run_attempt ?? 1) <= runAttempt)
					break dataRuns;
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
					(run.head_sha === ref &&
						(run.id > source.id || (run.run_attempt ?? 1) > runAttempt)) ||
					request(`${root}/compare/${ref}...${run.head_sha}`).status === "ahead"
				)
					return {
						deploy: false,
						ref,
						reason: `Superseded by data CI ${run.id}`,
					};
			}
			if (runs.length < 100) break;
		}
		// A legacy dispatch has no archive ID. After a rerun its original SQL
		// cannot be proven; require a fresh dispatch rather than selecting new SQL.
		if (artifactId === undefined && currentAttempt !== 1)
			throw new Error(
				"Legacy SQL dispatch cannot be recovered after a CI rerun; dispatch its immutable artifact ID",
			);
		checkQuality(root, runId, runAttempt, request);
		const artifact = resolveSqlArtifact(
			{ repo, runId, ref, artifactId, artifactDigest },
			request,
		);
		if (
			artifactId === undefined &&
			(request(`${root}/actions/runs/${runId}`).run_attempt ?? 1) !==
				currentAttempt
		)
			throw new Error("CI changed while binding the legacy SQL artifact");
		return { deploy: true, ref, runAttempt, ...artifact };
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
	let found;
	for (let page = 1; ; page++) {
		const releases = request(`${root}/releases?per_page=100&page=${page}`);
		for (const release of releases) {
			if (release.draft || release.prerelease) continue;
			if (release.tag_name === tag) found = release;
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
	const provenance = releasePayload(found);
	if (provenance) {
		if (
			provenance.ref !== ref ||
			String(provenance.ci_run_id) !== String(runId)
		)
			throw new Error(
				"Deployment source differs from published release metadata",
			);
		runAttempt = Number(provenance.ci_run_attempt ?? 1);
		if (runAttempt > currentAttempt)
			throw new Error("Published CI attempt exceeds source CI");
	}
	checkQuality(root, runId, runAttempt, request);
	return { deploy: true, ref, version, runAttempt };
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
	const payload = event.client_payload ?? {};
	let result = checkDeployment({
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
		runAttempt: payload.ci_run_attempt,
		artifactId: payload.sql_artifact_id,
		artifactDigest: payload.sql_artifact_digest,
	});
	if (result.deploy) {
		const state = startDeployment({
			repo: process.env.GITHUB_REPOSITORY,
			target: process.env.DEPLOY_TARGET ?? process.env.DEPLOY_MODULE,
			ref: result.ref,
			version: result.version,
			runAttempt: result.runAttempt,
			artifactId: result.artifactId,
			runId: payload.ci_run_id ?? payload.run_id ?? event.inputs?.ci_run_id,
		});
		result = { ...result, ...state };
		if (state.deploy)
			copyFileSync(
				new URL("./deployment-state.mjs", import.meta.url),
				path.join(process.env.RUNNER_TEMP, "deployment-state.mjs"),
			);
	}
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		`deploy=${result.deploy}\nref=${result.ref}\ndeployment_id=${result.deploymentId ?? ""}\nartifact_id=${result.artifactId ?? ""}\nartifact_digest=${result.artifactDigest ?? ""}\n`,
	);
	if (result.version)
		appendFileSync(
			process.env.GITHUB_ENV,
			`MODULE_VERSION=${result.version}\n`,
		);
	console.log(result.reason ?? `Deploying immutable source ${result.ref}`);
}
