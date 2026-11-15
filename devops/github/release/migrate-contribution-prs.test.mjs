import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	MIGRATION_AUDIENCE,
	migrateContributionPrs,
} from "./migrate-contribution-prs.mjs";

const env = {
	ACTIONS_ID_TOKEN_REQUEST_URL: "https://github.example/token?job=1",
	ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
};
const receipt = {
	apiVersion: 1,
	scanned: 4,
	migrated: 2,
	failed: 1,
	unchanged: 1,
};
test("requests a scoped OIDC token, performs the migration and returns only counts", async () => {
	const calls = [];
	const result = await migrateContributionPrs({
		env,
		request: async (url, options) => {
			calls.push({ url: String(url), options });
			return Response.json(
				calls.length === 1
					? { value: "short-lived-token" }
					: { ...receipt, privateData: "hidden" },
			);
		},
	});
	assert.deepEqual(result, receipt);
	assert.equal(
		new URL(calls[0].url).searchParams.get("audience"),
		MIGRATION_AUDIENCE,
	);
	assert.equal(
		calls[1].url,
		"https://admin.xn--febl3a.co.il/api/contributions/migrate",
	);
	assert.equal(calls[1].options.method, "POST");
	assert.equal(
		calls[1].options.headers.Authorization,
		"Bearer short-lived-token",
	);
	assert.equal(calls[1].options.redirect, "error");
});
test("fails before sending credentials when OIDC setup is missing or insecure", async () => {
	for (const config of [
		{},
		{ ...env, ACTIONS_ID_TOKEN_REQUEST_URL: "http://github.example" },
	])
		await assert.rejects(
			migrateContributionPrs({
				env: config,
				request: () => {
					throw new Error("must not request");
				},
			}),
			/required|HTTPS/,
		);
});
test("propagates OIDC, authentication and storage failures without logging response bodies", async () => {
	for (const responses of [
		[new Response("private", { status: 403 })],
		[Response.json({})],
		[
			Response.json({ value: "token" }),
			new Response("private", { status: 503 }),
		],
		[Response.json({ value: "token" }), Response.json({})],
	]) {
		await assert.rejects(
			migrateContributionPrs({ env, request: async () => responses.shift() }),
			/OIDC request failed|did not issue|migration failed|Invalid PR migration receipt/,
		);
	}
});
test("API CD invokes the hook after protected deployment and before recording success", () => {
	const workflow = readFileSync(
		new URL("../../../.github/workflows/cd-aws.yml", import.meta.url),
		"utf8",
	);
	const hook = workflow.indexOf(
		"run: node devops/github/release/migrate-contribution-prs.mjs",
	);
	assert.ok(hook > workflow.indexOf("bun run deploy:ecr"));
	assert.ok(hook < workflow.indexOf("- name: Record deployment result"));
	assert.match(
		workflow,
		/Upgrade every open PR[\s\S]*?env.MODULE_NAME == 'api'/,
	);
	const admin = readFileSync(
		new URL(
			"../../../web/admin/src/server/tanahpedia/contribution-deployment.server.ts",
			import.meta.url,
		),
		"utf8",
	);
	assert.ok(admin.includes(`MIGRATION_AUDIENCE = "${MIGRATION_AUDIENCE}"`));
});
