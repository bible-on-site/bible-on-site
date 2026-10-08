import { pathToFileURL } from "node:url";

/** Reject a nominally green review when GitHub compared incomplete snapshots. */
export async function verifyDependencySnapshots({
	repository,
	base,
	head,
	token,
	apiUrl = "https://api.github.com",
	fetcher = fetch,
}) {
	if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? ""))
		throw new Error("Dependency snapshot verification requires a repository");
	if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha ?? "")))
		throw new Error("Dependency snapshot verification requires immutable commit SHAs");
	if (!token) throw new Error("Dependency snapshot verification requires a token");

	const response = await fetcher(
		`${apiUrl}/repos/${repository}/dependency-graph/compare/${base}...${head}`,
		{
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"X-GitHub-Api-Version": "2022-11-28",
			},
			signal: AbortSignal.timeout(10_000),
		},
	);
	if (!response.ok)
		throw new Error(`Dependency snapshot comparison failed: HTTP ${response.status}`);
	const warning = response.headers.get("x-github-dependency-graph-snapshot-warnings")?.trim();
	if (warning) {
		const reason = Buffer.from(warning, "base64").toString("utf8");
		throw new Error(`Dependency snapshot comparison is incomplete: ${reason || warning}`);
	}
	const changes = await response.json();
	if (!Array.isArray(changes))
		throw new Error("Dependency snapshot comparison returned an invalid diff");
	return changes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await verifyDependencySnapshots({
		repository: process.env.GITHUB_REPOSITORY,
		base: process.env.DEPENDENCY_BASE_SHA,
		head: process.env.DEPENDENCY_HEAD_SHA,
		token: process.env.GH_TOKEN,
		apiUrl: process.env.GITHUB_API_URL,
	});
	console.log("Dependency review compared complete snapshots");
}
