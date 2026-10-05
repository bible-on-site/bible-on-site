import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request as api } from "./deployment-state.mjs";

/** Bind SQL to one immutable Actions archive, including its digest and source. */
export function resolveSqlArtifact(
	{ repo, runId, ref, artifactId, artifactDigest },
	request = api,
) {
	const root = `repos/${repo}/actions`;
	let artifact;
	if (artifactId !== undefined) {
		if (!/^\d+$/.test(String(artifactId)))
			throw new Error("Invalid SQL artifact ID");
		artifact = request(`${root}/artifacts/${artifactId}`);
	} else {
		const candidates = [];
		for (let page = 1; ; page++) {
			const artifacts = request(
				`${root}/runs/${runId}/artifacts?per_page=100&page=${page}`,
			).artifacts;
			candidates.push(
				...artifacts.filter(
					(item) =>
						!item.expired &&
						["perushim-data-sql", "perushim-data-sql.master"].includes(
							item.name,
						),
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
	}
	if (
		!artifact ||
		artifact.expired ||
		!/^\d+$/.test(String(artifact.id)) ||
		(artifactId !== undefined && String(artifact.id) !== String(artifactId)) ||
		!["perushim-data-sql", "perushim-data-sql.master"].includes(
			artifact.name,
		) ||
		String(artifact.workflow_run?.id) !== String(runId) ||
		artifact.workflow_run?.head_sha !== ref ||
		!/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "") ||
		(artifactDigest !== undefined && artifact.digest !== artifactDigest)
	)
		throw new Error(
			"SQL artifact is expired or does not match its source/digest",
		);
	return { artifactId: String(artifact.id), artifactDigest: artifact.digest };
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const repo = process.env.GITHUB_REPOSITORY;
	const runId = process.env.GITHUB_RUN_ID;
	const ref = process.env.GITHUB_SHA;
	const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
	const artifact = resolveSqlArtifact({ repo, runId, ref });
	const source = api(`repos/${repo}/actions/runs/${runId}`);
	if (String(source.run_attempt) !== runAttempt || source.head_sha !== ref)
		throw new Error("CI changed while binding the SQL artifact");
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		`payload=${JSON.stringify({ ref, run_id: runId, ci_run_attempt: runAttempt, sql_artifact_id: artifact.artifactId, sql_artifact_digest: artifact.artifactDigest })}\n`,
	);
}
