import { createRemoteJWKSet, jwtVerify } from "jose";
import { migrateOpenContributionPrs } from "./contribution-migrations.server";

export const MIGRATION_AUDIENCE = "tanahpedia:contributions:api-migrations";
const ISSUER = "https://token.actions.githubusercontent.com";
const keys = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const REPOSITORY = "bible-on-site/bible-on-site";
const REPOSITORY_ID = "810119373";

/** Separate machine-only surface: browser cookies, SKIP_AUTH and other admin
 * service tokens cannot authorize a deployment migration. No token is logged. */
export async function handleContributionMigrationRequest(
	request: Request,
): Promise<Response> {
	const headers = { "Cache-Control": "no-store" };
	if (request.method !== "POST")
		return new Response("Method not allowed", {
			status: 405,
			headers: { ...headers, Allow: "POST" },
		});
	const token = request.headers
		.get("authorization")
		?.match(/^Bearer\s+(\S+)$/i)?.[1];
	if (!token || token.length > 16000)
		return new Response("Unauthorized", { status: 401, headers });
	try {
		const { payload } = await jwtVerify(token, keys, {
			issuer: ISSUER,
			audience: MIGRATION_AUDIENCE,
			algorithms: ["RS256"],
			maxTokenAge: "10m",
			requiredClaims: ["exp", "iat", "sub"],
		});
		if (
			payload.repository !== REPOSITORY ||
			payload.repository_id !== REPOSITORY_ID ||
			payload.ref !== "refs/heads/master" ||
			payload.event_name !== "repository_dispatch" ||
			payload.workflow_ref !==
				`${REPOSITORY}/.github/workflows/cd-aws.yml@refs/heads/master`
		)
			return new Response("Forbidden", { status: 403, headers });
	} catch {
		return new Response("Unauthorized", { status: 401, headers });
	}
	try {
		return Response.json(await migrateOpenContributionPrs(), { headers });
	} catch {
		// Infrastructure failure must fail CD; proposal incompatibilities are
		// counted in a successful response after their gray state is persisted.
		return new Response("Migration storage unavailable", {
			status: 503,
			headers,
		});
	}
}
