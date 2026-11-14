import { pathToFileURL } from "node:url";

export const MIGRATION_AUDIENCE = "tanahpedia:contributions:api-migrations";
const ADMIN_ORIGIN = "https://admin.xn--febl3a.co.il";

/** Called only after the protected API handover has completed. The short-lived
 * GitHub OIDC token is scoped to this workflow, repository and endpoint audience. */
export async function migrateContributionPrs({
	env = process.env,
	request = fetch,
} = {}) {
	if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
		throw new Error(
			"GitHub OIDC credentials are required for the PR migration hook",
		);
	const tokenUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
	if (tokenUrl.protocol !== "https:")
		throw new Error("GitHub OIDC must use HTTPS");
	tokenUrl.searchParams.set("audience", MIGRATION_AUDIENCE);
	const tokenResponse = await request(tokenUrl, {
		headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
		signal: AbortSignal.timeout(30000),
		redirect: "error",
	});
	if (!tokenResponse.ok)
		throw new Error(`GitHub OIDC request failed (${tokenResponse.status})`);
	const { value } = await tokenResponse.json();
	if (typeof value !== "string" || !value)
		throw new Error("GitHub did not issue a migration token");
	const response = await request(`${ADMIN_ORIGIN}/api/contributions/migrate`, {
		method: "POST",
		headers: { Authorization: `Bearer ${value}` },
		signal: AbortSignal.timeout(30000),
		redirect: "error",
	});
	if (!response.ok)
		throw new Error(
			`Pending PR API migration failed (${response.status}); rerun CD after restoring the migration endpoint`,
		);
	const result = await response.json();
	if (
		!Number.isSafeInteger(result.apiVersion) ||
		result.apiVersion < 1 ||
		["scanned", "migrated", "failed", "unchanged"].some(
			(key) => !Number.isSafeInteger(result[key]) || result[key] < 0,
		)
	)
		throw new Error("Invalid PR migration receipt");
	return {
		apiVersion: result.apiVersion,
		scanned: result.scanned,
		migrated: result.migrated,
		failed: result.failed,
		unchanged: result.unchanged,
	};
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		console.info("Pending PR API migration:", await migrateContributionPrs());
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
