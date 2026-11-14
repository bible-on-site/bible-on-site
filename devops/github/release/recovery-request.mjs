import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	createReadStream,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ghApi } from "./gh-api.mjs";

const WORKFLOW = ".github/workflows/ci.yml";
const DIRECTORIES = { admin: "web/admin", bulletin: "web/bulletin" };
const OPTIONS = {
	none: [],
	admin: ["admin"],
	bulletin: ["bulletin"],
	"admin-and-bulletin": ["admin", "bulletin"],
};
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const shaPattern = /^[a-f0-9]{40}$/;
const filePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;
const hash = (bytes) =>
	`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function requireThat(value, message) {
	if (!value) throw new Error(message);
}
function object(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value, keys) {
	return (
		object(value) &&
		Object.keys(value).sort().join(",") === [...keys].sort().join(",")
	);
}
function id(value) {
	return (
		/^([1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value))
	);
}
function repository(repo) {
	requireThat(
		/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") &&
			!repo.split("/").some((part) => part === "." || part === ".."),
		"Recovery requires a repository",
	);
	return `repos/${repo}`;
}
function modules(value) {
	return (
		Array.isArray(value) &&
		Object.values(OPTIONS).some(
			(choice) =>
				choice.length > 0 && JSON.stringify(value) === JSON.stringify(choice),
		)
	);
}
function archive(value) {
	return (
		exact(value, ["id", "name", "digest"]) &&
		id(value.id) &&
		filePattern.test(value.name ?? "") &&
		digestPattern.test(value.digest ?? "")
	);
}
function file(value) {
	return (
		exact(value, ["name", "size", "digest"]) &&
		filePattern.test(value.name ?? "") &&
		Number.isSafeInteger(value.size) &&
		value.size > 0 &&
		digestPattern.test(value.digest ?? "")
	);
}
function ciProof(value, sha) {
	return (
		exact(value, [
			"runId",
			"runAttempt",
			"workflowId",
			"workflowPath",
			"sha",
		]) &&
		id(value.runId) &&
		id(value.runAttempt) &&
		id(value.workflowId) &&
		value.workflowPath === WORKFLOW &&
		value.sha === sha
	);
}

export function recoveryReleaseFilename(moduleName, version) {
	requireThat(
		DIRECTORIES[moduleName] && /^\d+\.\d+\.\d+$/.test(version ?? ""),
		"Recovery package identity is invalid",
	);
	return moduleName === "admin"
		? `bible-on-site-admin-v${version}.tar.gz`
		: `bulletin-lambda-v${version}.zip`;
}

async function hashFile(filename) {
	const checksum = createHash("sha256");
	let size = 0;
	for await (const chunk of createReadStream(filename)) {
		checksum.update(chunk);
		size += chunk.length;
	}
	return { size, digest: `sha256:${checksum.digest("hex")}` };
}

export async function verifyRecoveryPackageFile({
	filename,
	moduleName,
	version,
	expected,
}) {
	requireThat(
		file(expected) &&
			expected.name === recoveryReleaseFilename(moduleName, version) &&
			path.basename(filename) === expected.name &&
			statSync(filename).isFile(),
		"Recovery downloaded package name is invalid",
	);
	const actual = await hashFile(filename);
	requireThat(
		actual.size === expected.size && actual.digest === expected.digest,
		"Recovery downloaded package bytes do not match their verified digest",
	);
}

export function parseRecoveryRequest({
	eventName,
	ref,
	sha,
	requested = "none",
}) {
	requireThat(
		typeof requested === "string" && Object.hasOwn(OPTIONS, requested),
		"Unknown release recovery selection",
	);
	if (requested === "none") return [];
	requireThat(
		eventName === "workflow_dispatch" &&
			ref === "refs/heads/master" &&
			shaPattern.test(sha ?? ""),
		"Release recovery requires an explicit master workflow dispatch",
	);
	return [...OPTIONS[requested]];
}

/** The branch API supplies both protection and the current immutable source. */
export function assertRecoveryCurrentMaster({ repo, sha }, request = ghApi) {
	requireThat(
		shaPattern.test(sha ?? ""),
		"Recovery requires an immutable source SHA",
	);
	const branch = request(`${repository(repo)}/branches/master`);
	requireThat(
		branch?.protected === true && branch.commit?.sha === sha,
		"Recovery source must be current protected master",
	);
}

function workflowIdentity(repo, request) {
	const workflow = request(`${repository(repo)}/actions/workflows/ci.yml`);
	requireThat(
		id(workflow?.id) && workflow.path === WORKFLOW,
		"Recovery requires the main CI workflow identity",
	);
	return Number(workflow.id);
}

function assertRun(run, { sha, event, workflowId, runId, runAttempt }) {
	requireThat(
		run?.name === "Continuous Integration" &&
			run.event === event &&
			run.head_branch === "master" &&
			run.head_sha === sha &&
			Number(run.workflow_id) === Number(workflowId) &&
			String(run.id) === String(runId) &&
			id(run.run_attempt ?? 1) &&
			Number(run.run_attempt ?? 1) >= Number(runAttempt),
		"Recovery CI source identity or attempt does not match",
	);
}

export function assertRecoveryJob(
	{ repo, runId, runAttempt, name },
	request = ghApi,
) {
	let found;
	for (let page = 1; page <= 100; page++) {
		const jobs = request(
			`${repository(repo)}/actions/runs/${runId}/jobs?filter=all&per_page=100&page=${page}`,
		)?.jobs;
		requireThat(Array.isArray(jobs), "Recovery CI job proof is unavailable");
		for (const job of jobs) {
			const attempt = Number(job.run_attempt ?? 1);
			if (
				job.name === name &&
				id(attempt) &&
				attempt <= Number(runAttempt) &&
				(!found ||
					attempt > Number(found.run_attempt ?? 1) ||
					(attempt === Number(found.run_attempt ?? 1) &&
						Number(job.id) > Number(found.id)))
			)
				found = job;
		}
		if (jobs.length < 100) {
			requireThat(
				found?.conclusion === "success",
				`Recovery CI has not passed ${name} for the recorded attempt`,
			);
			return;
		}
	}
	throw new Error("Recovery CI job pagination exceeded its bound");
}

function assertNormalRun({ repo, proof, sha, workflowId }, request) {
	requireThat(
		ciProof(proof, sha) && Number(proof.workflowId) === Number(workflowId),
		"Normal master CI receipt proof is invalid",
	);
	const normal = request(`${repository(repo)}/actions/runs/${proof.runId}`);
	assertRun(normal, { ...proof, event: "push" });
	if (Number(normal.run_attempt ?? 1) === Number(proof.runAttempt))
		requireThat(
			normal.status === "completed" && normal.conclusion === "success",
			"Recorded normal master CI was not green",
		);
	const attempt = request(
		`${repository(repo)}/actions/runs/${proof.runId}/attempts/${proof.runAttempt}`,
	);
	assertRun(attempt, { ...proof, event: "push" });
	requireThat(
		Number(attempt.run_attempt ?? 1) === Number(proof.runAttempt) &&
			attempt.status === "completed" &&
			attempt.conclusion === "success",
		"Recorded normal master CI attempt was not completed green",
	);
	assertRecoveryJob({ repo, ...proof, name: "Cross Module CI" }, request);
	return normal;
}

export function verifyRecoveryMaster({ repo, sha }, request = ghApi) {
	assertRecoveryCurrentMaster({ repo, sha }, request);
	const workflowId = workflowIdentity(repo, request);
	const response = request(
		`${repository(repo)}/actions/workflows/${workflowId}/runs?event=push&branch=master&head_sha=${sha}&per_page=100&page=1`,
	);
	requireThat(
		Array.isArray(response?.workflow_runs),
		"Normal master CI proof is unavailable",
	);
	const run = response.workflow_runs
		.filter(
			(item) =>
				item.event === "push" &&
				item.head_branch === "master" &&
				item.head_sha === sha &&
				Number(item.workflow_id) === workflowId,
		)
		.sort((a, b) => Number(b.id) - Number(a.id))[0];
	requireThat(
		id(run?.id) && id(run.run_attempt ?? 1),
		"No normal master push CI exists for the recovery source",
	);
	const proof = {
		runId: Number(run.id),
		runAttempt: Number(run.run_attempt ?? 1),
		workflowId,
		workflowPath: WORKFLOW,
		sha,
	};
	assertRun(run, { ...proof, event: "push" });
	requireThat(
		run.status === "completed" && run.conclusion === "success",
		"Normal master push CI must complete successfully before recovery",
	);
	const checkedNormal = assertNormalRun(
		{ repo, proof, sha, workflowId },
		request,
	);
	requireThat(
		Number(checkedNormal.run_attempt ?? 1) === proof.runAttempt,
		"Normal master CI changed during recovery preflight",
	);
	assertRecoveryCurrentMaster({ repo, sha }, request);
	return proof;
}

export function validateRecoveryProof(proof, moduleName) {
	requireThat(
		DIRECTORIES[moduleName] &&
			exact(proof, ["schemaVersion", "receipt", "artifact"]) &&
			proof.schemaVersion === 1 &&
			file(proof.receipt) &&
			proof.receipt.name === `release-recovery-${moduleName}.json` &&
			proof.receipt.size <= 65_536 &&
			archive(proof.artifact),
		"Invalid release recovery provenance",
	);
	return proof;
}

export function buildRecoveryReceipt(input) {
	repository(input?.repo);
	requireThat(
		shaPattern.test(input.sha ?? "") &&
			modules(input.requestedModules) &&
			input.requestedModules.includes(input.moduleName) &&
			DIRECTORIES[input.moduleName] === input.moduleDirectory &&
			/^\d+\.\d+\.\d+$/.test(input.moduleVersion ?? ""),
		"Recovery receipt module or source is invalid",
	);
	const ci = {
		runId: Number(input.ci?.runId),
		runAttempt: Number(input.ci?.runAttempt),
		workflowId: Number(input.ci?.workflowId),
		workflowPath: WORKFLOW,
		sha: input.sha,
	};
	requireThat(
		ciProof(ci, input.sha) &&
			ciProof(input.normalMasterCi, input.sha) &&
			Number(input.normalMasterCi.workflowId) === ci.workflowId &&
			Number(input.normalMasterCi.runId) < ci.runId &&
			archive(input.artifact) &&
			file(input.releaseFile),
		"Recovery receipt CI or artifact proof is invalid",
	);
	requireThat(
		input.releaseFile.name ===
			recoveryReleaseFilename(input.moduleName, input.moduleVersion),
		"Recovery receipt must name the canonical deployed package",
	);
	return {
		schemaVersion: 1,
		kind: "explicit-master-release-recovery",
		repo: input.repo,
		sha: input.sha,
		requestedModules: [...input.requestedModules],
		moduleName: input.moduleName,
		moduleDirectory: input.moduleDirectory,
		moduleVersion: input.moduleVersion,
		ci: { ...ci, event: "workflow_dispatch" },
		normalMasterCi: { ...input.normalMasterCi },
		artifact: { ...input.artifact },
		releaseFile: { ...input.releaseFile },
	};
}

export function validateRecoveryReceipt(receipt, expected) {
	requireThat(
		exact(receipt, [
			"schemaVersion",
			"kind",
			"repo",
			"sha",
			"requestedModules",
			"moduleName",
			"moduleDirectory",
			"moduleVersion",
			"ci",
			"normalMasterCi",
			"artifact",
			"releaseFile",
		]) &&
			receipt.schemaVersion === 1 &&
			receipt.kind === "explicit-master-release-recovery" &&
			exact(receipt.ci, [
				"runId",
				"runAttempt",
				"workflowId",
				"workflowPath",
				"event",
				"sha",
			]) &&
			receipt.ci.event === "workflow_dispatch",
		"Invalid published recovery receipt",
	);
	const normalized = buildRecoveryReceipt(receipt);
	requireThat(
		receipt.ci.workflowPath === WORKFLOW &&
			receipt.ci.sha === receipt.sha &&
			["repo", "sha", "moduleName", "moduleDirectory", "moduleVersion"].every(
				(key) => receipt[key] === expected[key],
			) &&
			String(receipt.ci.runId) === String(expected.runId) &&
			Number(receipt.ci.runAttempt) === Number(expected.runAttempt) &&
			Number(receipt.ci.workflowId) === Number(expected.workflowId) &&
			["id", "name", "digest"].every(
				(key) =>
					String(receipt.artifact[key]) === String(expected.artifact[key]),
			),
		"Published recovery receipt differs from its release source",
	);
	return normalized;
}

export async function writeRecoveryReceipt(input, outputPath) {
	if (input.releaseFile?.path) {
		const source = input.releaseFile.path;
		requireThat(
			path.basename(source) === input.releaseFile.name &&
				statSync(source).isFile(),
			"Recovery package path must name the selected release file",
		);
		input = {
			...input,
			releaseFile: {
				name: input.releaseFile.name,
				...(await hashFile(source)),
			},
		};
	}
	const receipt = buildRecoveryReceipt(input);
	requireThat(
		path.basename(outputPath) === `release-recovery-${receipt.moduleName}.json`,
		"Recovery receipt output name is fixed",
	);
	const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
	requireThat(bytes.length <= 65_536, "Recovery receipt is too large");
	writeFileSync(outputPath, bytes);
	return {
		schemaVersion: 1,
		receipt: {
			name: path.basename(outputPath),
			size: bytes.length,
			digest: hash(bytes),
		},
		artifact: { ...receipt.artifact },
	};
}

/** Never accept a receipt-controlled URL or inherit a browser/download host. */
export function readRecoveryAsset(repo, assetId, run = execFileSync) {
	requireThat(id(assetId), "Recovery receipt asset ID is invalid");
	return run(
		"gh",
		[
			"api",
			`${repository(repo)}/releases/assets/${assetId}`,
			"-H",
			"Accept: application/octet-stream",
		],
		{ maxBuffer: 65_536, timeout: 30_000 },
	);
}

function releasedAsset(release, expected) {
	const assets = (release.assets ?? []).filter(
		(item) => item.name === expected.name,
	);
	requireThat(
		assets.length === 1 &&
			id(assets[0].id) &&
			assets[0].state === "uploaded" &&
			assets[0].size === expected.size &&
			assets[0].digest === expected.digest,
		"Published recovery release asset does not match its digest",
	);
	return assets[0];
}

export function verifyRecoveryDeployment(
	{
		repo,
		source,
		runAttempt,
		moduleName,
		moduleDirectory,
		version,
		release,
		provenance,
	},
	request = ghApi,
	readAsset = readRecoveryAsset,
) {
	const proof = validateRecoveryProof(provenance?.recovery, moduleName);
	requireThat(
		provenance.module_directory === moduleDirectory &&
			provenance.released_artifact_name === proof.artifact.name,
		"Recovery provenance does not name its selected package",
	);
	const workflowId = workflowIdentity(repo, request);
	assertRun(source, {
		sha: source.head_sha,
		event: "workflow_dispatch",
		workflowId,
		runId: source.id,
		runAttempt,
	});
	const asset = releasedAsset(release, proof.receipt);
	const bytes = Buffer.from(readAsset(repo, asset.id));
	requireThat(
		bytes.length === proof.receipt.size &&
			bytes.length <= 65_536 &&
			hash(bytes) === proof.receipt.digest,
		"Recovery receipt bytes do not match their published digest",
	);
	const receipt = validateRecoveryReceipt(
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
		{
			repo,
			sha: source.head_sha,
			runId: source.id,
			runAttempt,
			workflowId,
			moduleName,
			moduleDirectory,
			moduleVersion: version,
			artifact: proof.artifact,
		},
	);
	const packageAsset = releasedAsset(release, receipt.releaseFile);
	const candidates = release.assets.filter((item) =>
		item.name.endsWith(moduleName === "admin" ? ".tar.gz" : ".zip"),
	);
	requireThat(
		candidates.length === 1 && candidates[0].id === packageAsset.id,
		"Recovery release has ambiguous deployable package assets",
	);
	assertNormalRun(
		{ repo, proof: receipt.normalMasterCi, sha: receipt.sha, workflowId },
		request,
	);
	assertRecoveryJob(
		{ repo, runId: source.id, runAttempt, name: "Cross Module CI" },
		request,
	);
	for (const name of receipt.requestedModules)
		assertRecoveryJob(
			{
				repo,
				runId: source.id,
				runAttempt,
				name: name === "admin" ? "Package Admin" : "Package Bulletin",
			},
			request,
		);
	return {
		receipt,
		file: { id: Number(packageAsset.id), ...receipt.releaseFile },
	};
}

function eventRequest(env) {
	const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
	return parseRecoveryRequest({
		eventName: env.GITHUB_EVENT_NAME,
		ref: env.GITHUB_REF,
		sha: env.GITHUB_SHA,
		requested: event.inputs?.release_recovery ?? "none",
	});
}

export function assertRecoveryReleaseEligibility({
	eventName,
	moduleName,
	requestedModules,
}) {
	if (eventName === "push") return;
	requireThat(
		eventName === "workflow_dispatch" &&
			modules(requestedModules) &&
			DIRECTORIES[moduleName] &&
			requestedModules.includes(moduleName),
		"Release is not an explicitly selected master recovery module",
	);
}

async function main(env = process.env) {
	const args = process.argv.slice(2);
	const value = (flag) => args[args.indexOf(flag) + 1];
	if (args.includes("--verify-file")) {
		await verifyRecoveryPackageFile({
			filename: value("--file"),
			moduleName: env.MODULE_NAME,
			version: env.MODULE_VERSION,
			expected: {
				name: env.RECOVERY_FILE_NAME,
				size: Number(env.RECOVERY_FILE_SIZE),
				digest: env.RECOVERY_FILE_DIGEST,
			},
		});
		return;
	}
	const requestedModules = eventRequest(env);
	if (args.includes("--preflight")) {
		const normal = requestedModules.length
			? verifyRecoveryMaster({
					repo: env.GITHUB_REPOSITORY,
					sha: env.GITHUB_SHA,
				})
			: {};
		if (args.includes("--out"))
			writeFileSync(value("--out"), `${JSON.stringify(normal)}\n`);
		if (env.GITHUB_OUTPUT)
			appendFileSync(
				env.GITHUB_OUTPUT,
				`recovery_requested=${requestedModules.length > 0}\nrecovery_modules=${JSON.stringify(requestedModules)}\nnormal_master_ci=${JSON.stringify(normal)}\n`,
			);
		return;
	}
	if (args.includes("--assert-current")) {
		requireThat(
			JSON.stringify(requestedModules) ===
				JSON.stringify(JSON.parse(env.RELEASE_RECOVERY_MODULES ?? "[]")),
			"Recovery workflow inputs differ from the original dispatch selection",
		);
		if (env.RELEASE_MODULE)
			assertRecoveryReleaseEligibility({
				eventName: env.GITHUB_EVENT_NAME,
				moduleName: env.RELEASE_MODULE,
				requestedModules,
			});
		if (requestedModules.length)
			assertRecoveryCurrentMaster({
				repo: env.GITHUB_REPOSITORY,
				sha: env.GITHUB_SHA,
			});
		return;
	}
	if (args.includes("--receipt")) {
		const input = JSON.parse(readFileSync(value("--input"), "utf8"));
		requireThat(
			requestedModules.length > 0 &&
				JSON.stringify(input.requestedModules) ===
					JSON.stringify(requestedModules) &&
				input.repo === env.GITHUB_REPOSITORY &&
				input.sha === env.GITHUB_SHA &&
				String(input.ci?.runId) === env.GITHUB_RUN_ID &&
				String(input.ci?.runAttempt) === env.GITHUB_RUN_ATTEMPT,
			"Recovery receipt inputs differ from the trusted CI context",
		);
		assertRecoveryCurrentMaster({ repo: input.repo, sha: input.sha });
		assertRecoveryReleaseEligibility({
			eventName: env.GITHUB_EVENT_NAME,
			moduleName: env.RELEASE_MODULE ?? input.moduleName,
			requestedModules,
		});
		requireThat(
			!env.RELEASE_MODULE || env.RELEASE_MODULE === input.moduleName,
			"Recovery receipt module differs from its release job",
		);
		const workflowId = workflowIdentity(input.repo, ghApi);
		const run = ghApi(
			`${repository(input.repo)}/actions/runs/${input.ci.runId}`,
		);
		assertRun(run, {
			sha: input.sha,
			event: "workflow_dispatch",
			workflowId,
			runId: input.ci.runId,
			runAttempt: input.ci.runAttempt,
		});
		requireThat(
			Number(input.ci.workflowId) === workflowId,
			"Recovery receipt workflow differs from main CI",
		);
		const currentNormal = verifyRecoveryMaster({
			repo: input.repo,
			sha: input.sha,
		});
		requireThat(
			ciProof(input.normalMasterCi, input.sha) &&
				Object.keys(currentNormal).every(
					(key) =>
						String(currentNormal[key]) === String(input.normalMasterCi[key]),
				),
			"Normal master CI changed after recovery preflight",
		);
		assertRecoveryJob({
			repo: input.repo,
			...input.ci,
			name: "Cross Module CI",
		});
		for (const name of requestedModules)
			assertRecoveryJob({
				repo: input.repo,
				...input.ci,
				name: name === "admin" ? "Package Admin" : "Package Bulletin",
			});
		requireThat(
			archive(input.artifact),
			"Recovery receipt archive proof is invalid",
		);
		const packageArchive = ghApi(
			`${repository(input.repo)}/actions/artifacts/${input.artifact.id}`,
		);
		requireThat(
			archive(input.artifact) &&
				String(packageArchive.id) === String(input.artifact.id) &&
				packageArchive.name === input.artifact.name &&
				packageArchive.digest === input.artifact.digest &&
				packageArchive.expired === false &&
				String(packageArchive.workflow_run?.id) === String(input.ci.runId) &&
				packageArchive.workflow_run?.head_sha === input.sha,
			"Recovery receipt archive does not come from this fresh source CI",
		);
		console.log(
			JSON.stringify(await writeRecoveryReceipt(input, value("--out"))),
		);
		return;
	}
	throw new Error("Unknown recovery helper command");
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
