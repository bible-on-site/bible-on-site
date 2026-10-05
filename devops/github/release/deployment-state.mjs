import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const request = (endpoint, body) =>
	JSON.parse(
		execFileSync(
			"gh",
			["api", endpoint, ...(body ? ["--method", "POST", "--input", "-"] : [])],
			{
				input: body ? JSON.stringify(body) : undefined,
				encoding: "utf8",
				maxBuffer: 16 * 1024 * 1024,
			},
		),
	);

/** Runs inside the same target lock as the production writes. */
export function startDeployment(
	{ repo, target, ref, version, runId, runAttempt = 1, artifactId },
	api = request,
) {
	if (
		!/^(website|api|admin|bulletin|data|app-(android|windows|ios))$/.test(
			target,
		)
	)
		throw new Error(`Unknown deployment target: ${target}`);
	const root = `repos/${repo}/deployments`;
	if (!version && !/^\d+$/.test(String(artifactId)))
		throw new Error("Data deployment requires an immutable SQL artifact ID");
	const key = version
		? `${target}-v${version}`
		: `${target}-${ref}-${runId}-${artifactId}`;
	for (let page = 1; ; page++) {
		const previous = api(
			`${root}?sha=${ref}&environment=${target}&task=deploy:release&per_page=100&page=${page}`,
		);
		for (const deployment of previous) {
			if (deployment.payload?.release_key !== key) continue;
			const [status] = api(`${root}/${deployment.id}/statuses?per_page=1`);
			if (status?.state === "success")
				return {
					deploy: false,
					reason: `${key} already deployed successfully`,
				};
		}
		if (previous.length < 100) break;
	}
	const deployment = api(root, {
		ref,
		task: "deploy:release",
		environment: target,
		auto_merge: false,
		required_contexts: [],
		production_environment: true,
		payload: {
			release_key: key,
			ci_run_id: String(runId),
			ci_run_attempt: String(runAttempt),
			...(artifactId ? { sql_artifact_id: String(artifactId) } : {}),
		},
		description: `Release delivery: ${key}`,
	});
	if (!deployment.id)
		throw new Error("GitHub did not create a deployment record");
	finishDeployment(repo, deployment.id, "in_progress", api);
	return { deploy: true, deploymentId: deployment.id };
}

export function finishDeployment(repo, id, state, api = request) {
	if (!/^\d+$/.test(String(id)))
		throw new Error("A deployment record ID is required");
	if (!["success", "failure", "in_progress"].includes(state))
		throw new Error("Invalid deployment state");
	api(`repos/${repo}/deployments/${id}/statuses`, {
		state,
		auto_inactive: false,
		log_url: `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
	});
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	finishDeployment(
		process.env.GITHUB_REPOSITORY,
		process.env.DEPLOYMENT_ID,
		process.env.DEPLOYMENT_RESULT === "success" ? "success" : "failure",
	);
}
