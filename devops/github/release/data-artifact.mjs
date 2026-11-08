import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request as api } from "./deployment-state.mjs";

const SQL_ARTIFACT_NAMES = ["perushim-data-sql", "perushim-data-sql.master"];
const SQL_BASELINE_NAME = "perushim-data-sql.master";
// Repo inputs of the generated SQL (the perushim_pipeline module rule). A
// reused baseline archive only stands in for a skipped producer while every
// input is identical between its producing revision and the delivered one —
// pipeline/inputs changes always regenerate instead of reusing.
const SQL_INPUTS = [
	["data/sefaria/pipelines", "perushim-view"],
	[
		"app/BibleOnSite/Resources/Raw",
		"sefaria-dump-5784-sivan-4.tanah_view.sqlite",
	],
];

function assertArtifactIdentity(artifact, { artifactId, artifactDigest }) {
	if (!artifact)
		throw new Error("No SQL artifact was produced by this CI run");
	if (artifact.expired) throw new Error("SQL artifact archive is expired");
	if (!/^\d+$/.test(String(artifact.id)))
		throw new Error("SQL artifact has no valid archive ID");
	if (artifactId !== undefined && String(artifact.id) !== String(artifactId))
		throw new Error(
			`SQL artifact ${artifact.id} does not match pinned archive ${artifactId}`,
		);
	if (!SQL_ARTIFACT_NAMES.includes(artifact.name))
		throw new Error(`Untrusted SQL artifact name: ${artifact.name}`);
	if (!/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? ""))
		throw new Error("SQL artifact has no verified sha256 digest");
	if (artifactDigest !== undefined && artifact.digest !== artifactDigest)
		throw new Error(
			`SQL artifact ${artifact.id} digest does not match the pinned digest`,
		);
	if (
		!/^\d+$/.test(String(artifact.workflow_run?.id)) ||
		!/^[a-f0-9]{40}$/.test(artifact.workflow_run?.head_sha ?? "")
	)
		throw new Error(
			`SQL artifact ${artifact.id} has no producing run identity`,
		);
}

function assertProvenance(artifact, { runId, ref }) {
	const run = artifact.workflow_run;
	if (String(run?.id) !== String(runId) || run?.head_sha !== ref)
		throw new Error(
			`SQL artifact ${artifact.id} was produced by run ${run?.id} at ${run?.head_sha}, not by run ${runId} at ${ref}`,
		);
}

function inputSha({ repo, ref, directory, name }, request) {
	const entries = request(`repos/${repo}/contents/${directory}?ref=${ref}`);
	const entry = (Array.isArray(entries) ? entries : [entries]).find(
		(item) => item.name === name,
	);
	if (!entry?.sha || !/^[a-f0-9]{40}$/.test(entry.sha))
		throw new Error(
			`Cannot fingerprint SQL input ${directory}/${name} at ${ref}`,
		);
	return entry.sha;
}

/**
 * A reused baseline must come from a trusted producing run — a master push CI
 * run of this repository, not a PR/fork/other workflow — and its producing
 * revision must agree with the delivered revision on every SQL input, so the
 * archived content is exactly what a regenerated producer would emit.
 */
function assertReusableBaseline(artifact, { repo, ref }, request) {
	const produced = artifact.workflow_run;
	if (produced?.repository_id !== produced?.head_repository_id)
		throw new Error(
			`SQL baseline ${artifact.id} was produced by a fork workflow run`,
		);
	const source = request(`repos/${repo}/actions/runs/${produced?.id}`);
	if (
		source.name !== "Continuous Integration" ||
		source.event !== "push" ||
		source.head_branch !== "master" ||
		source.head_sha !== produced?.head_sha
	)
		throw new Error(
			`SQL baseline ${artifact.id} was produced by untrusted run ${produced?.id} (${source.name}/${source.event}/${source.head_branch})`,
		);
	for (const [directory, name] of SQL_INPUTS) {
		const producing = inputSha(
			{ repo, ref: produced.head_sha, directory, name },
			request,
		);
		const delivered = inputSha({ repo, ref, directory, name }, request);
		if (producing !== delivered)
			throw new Error(
				`SQL baseline ${artifact.id} input ${directory}/${name} differs between ${produced.head_sha} and ${ref}`,
			);
	}
}

function checkCandidate(artifact, ctx, request) {
	assertArtifactIdentity(artifact, ctx);
	// The expected producing run is the declared source, the artifact's own
	// record for a baseline search, or the consuming run for fresh output.
	const expectedRun = String(
		ctx.sourceRunId ??
			(ctx.baseline ? artifact?.workflow_run?.id : ctx.runId),
	);
	const expectedRef =
		ctx.sourceRef ??
		(ctx.baseline ? artifact?.workflow_run?.head_sha : ctx.ref);
	assertProvenance(artifact, { runId: expectedRun, ref: expectedRef });
	if (expectedRun !== String(ctx.runId))
		assertReusableBaseline(artifact, ctx, request);
}

/**
 * Resolve the delivered SQL to one immutable Actions archive.
 *
 * Without `baseline`, candidates come from the current run's namespace only —
 * the archive the perushim producer just uploaded. With `baseline` (the
 * producer legitimately skipped), candidates are the repository-wide
 * `perushim-data-sql.master` archives and each must independently prove a
 * trusted master CI origin plus content-compatible inputs. A pinned
 * artifactId is verified in place and never falls back.
 */
export function resolveSqlArtifact(
	{ repo, runId, ref, artifactId, artifactDigest, sourceRunId, sourceRef, baseline },
	request = api,
) {
	const root = `repos/${repo}/actions`;
	const ctx = {
		repo,
		runId,
		ref,
		artifactId,
		artifactDigest,
		sourceRunId,
		sourceRef,
		baseline,
	};
	let artifact;
	if (artifactId !== undefined) {
		if (!/^\d+$/.test(String(artifactId)))
			throw new Error("Invalid SQL artifact ID");
		artifact = request(`${root}/artifacts/${artifactId}`);
		checkCandidate(artifact, ctx, request);
	} else if (baseline) {
		const rejections = [];
		for (let page = 1; ; page++) {
			const artifacts = request(
				`${root}/artifacts?name=${SQL_BASELINE_NAME}&per_page=100&page=${page}`,
			).artifacts;
			artifacts.sort((a, b) => b.id - a.id);
			for (const candidate of artifacts) {
				try {
					checkCandidate(candidate, ctx, request);
					artifact = candidate;
					break;
				} catch (error) {
					rejections.push(`#${candidate?.id}: ${error.message}`);
				}
			}
			if (artifact || artifacts.length < 100) break;
		}
		if (!artifact)
			throw new Error(
				`No trusted master SQL baseline is available for this run${rejections.length ? ` (${rejections.join("; ")})` : ""}`,
			);
	} else {
		const candidates = [];
		for (let page = 1; ; page++) {
			const artifacts = request(
				`${root}/runs/${runId}/artifacts?per_page=100&page=${page}`,
			).artifacts;
			candidates.push(
				...artifacts.filter(
					(item) =>
						!item.expired && SQL_ARTIFACT_NAMES.includes(item.name),
				),
			);
			if (artifacts.length < 100) break;
		}
		candidates.sort(
			(a, b) =>
				Number(b.name === "perushim-data-sql") -
					Number(a.name === "perushim-data-sql") || b.id - a.id,
		);
		artifact = candidates[0];
		checkCandidate(artifact, ctx, request);
	}
	return {
		artifactId: String(artifact.id),
		artifactDigest: artifact.digest,
		sourceRunId: String(artifact.workflow_run.id),
		sourceRef: artifact.workflow_run.head_sha,
	};
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const repo = process.env.GITHUB_REPOSITORY;
	const runId = process.env.GITHUB_RUN_ID;
	const ref = process.env.GITHUB_SHA;
	const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
	const artifact = resolveSqlArtifact({
		repo,
		runId,
		ref,
		baseline: process.env.SQL_FROM_BASELINE === "true",
	});
	const source = api(`repos/${repo}/actions/runs/${runId}`);
	if (String(source.run_attempt) !== runAttempt || source.head_sha !== ref)
		throw new Error("CI changed while binding the SQL artifact");
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		`payload=${JSON.stringify({ ref, run_id: runId, ci_run_attempt: runAttempt, sql_artifact_id: artifact.artifactId, sql_artifact_digest: artifact.artifactDigest, sql_source_run_id: artifact.sourceRunId, sql_source_ref: artifact.sourceRef })}\n`,
	);
}
