import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import {
	createContributionWorker,
	workerAwsCredentials,
	workerOptions,
	workerTokenProvider,
	runContributionWorker,
} from "./contribution-worker.mjs";

const id = "00000000-0000-4000-8000-000000000001";
const issueId = "00000000-0000-4000-8000-000000000002";
const claim = {
	id,
	issueId,
	token: "a".repeat(64),
	version: 4,
	apiVersion: 1,
	system: "Draft only",
	user: "Private supplied evidence",
	schema: { type: "object" },
};
const credentials = {
	COGNITO_DOMAIN: "example.auth.il-central-1.amazoncognito.com",
	COGNITO_SERVICE_CLIENT_ID: "service-client",
	COGNITO_SERVICE_CLIENT_SECRET: "test-fixture-secret",
};
const options = workerOptions(
	["--origin", "http://127.0.0.1:3101", "--dev", "--model", "local-test"],
	{},
);

test("watch resumes after a temporary claim outage and cancels its original polling delay", async () => {
	const stop = new AbortController(),
		logs = [],
		pauses = [];
	let claims = 0;
	await runContributionWorker(
		["--watch", "--dev", "--origin", "http://localhost:3101"],
		{},
		{
			signal: stop.signal,
			log: (...args) => logs.push(args),
			request: async () =>
				new Response(null, { status: ++claims === 1 ? 503 : 204 }),
			pause: async (ms, _value, { signal }) => {
				pauses.push(ms);
				if (pauses.length === 2) {
					stop.abort();
					assert.equal(signal.aborted, true);
					throw new DOMException("Stopped", "AbortError");
				}
			},
		},
	);
	assert.equal(claims, 2);
	assert.deepEqual(pauses, [5000, 5000]);
	assert.match(JSON.stringify(logs), /503/);
	assert.ok(!JSON.stringify(logs).includes("idle"));
});
test("once reports a failed claim without silently retrying", async () => {
	let claims = 0;
	await assert.rejects(
		runContributionWorker(
			["--once", "--dev", "--origin", "http://localhost:3101"],
			{},
			{
				request: async () => {
					claims++;
					return new Response(null, { status: 503 });
				},
			},
		),
		/503/,
	);
	assert.equal(claims, 1);
});

test("restricts worker origins, protocols, identifiers and development auth", () => {
	assert.equal(workerOptions([], {}).origin, "https://admin.xn--febl3a.co.il");
	assert.equal(
		workerOptions(
			["--watch", "--aws-profile", "profile", "--issue", issueId],
			{},
		).watch,
		true,
	);
	assert.equal(workerOptions(["--watch", "--once"], {}).watch, false);
	for (const args of [
		["--origin", "https://untrusted.example"],
		["--origin", "http://admin.xn--febl3a.co.il"],
		["--dev"],
		["--origin", "https://user:pass@admin.xn--febl3a.co.il"],
		["--origin", "https://admin.xn--febl3a.co.il/path"],
		["--origin", "https://admin.xn--febl3a.co.il?token=x"],
		["--issue", "bad"],
		["--model", ""],
		["--model", "x".repeat(256)],
		["--worker-id", "x".repeat(129)],
		["--ollama", "file:///tmp/model"],
		["--ollama", "https://user:pass@example.test"],
		["--unknown"],
		["--model"],
	])
		assert.throws(() => workerOptions(args, {}));
});

test("uses a narrow token scope, caches tokens and refreshes without retaining a copied secret", async () => {
	let time = 0,
		calls = 0,
		credentialCalls = 0;
	const get = workerTokenProvider(
		{ CONTRIBUTION_AWS_PROFILE: "local-profile" },
		{
			now: () => time,
			credentials: async (profile) => {
				assert.equal(profile, "local-profile");
				credentialCalls++;
				return credentials;
			},
			request: async (url, request) => {
				calls++;
				assert.equal(
					String(url),
					"https://example.auth.il-central-1.amazoncognito.com/oauth2/token",
				);
				assert.equal(request.redirect, "error");
				assert.equal(request.body.get("scope"), "admin-api/contributions");
				assert.equal(
					request.body.get("client_secret"),
					credentials.COGNITO_SERVICE_CLIENT_SECRET,
				);
				return Response.json({
					access_token: `short-token-${calls}`,
					expires_in: 120,
				});
			},
		},
	);
	assert.equal(await get(), "short-token-1");
	assert.equal(await get(), "short-token-1");
	assert.equal(calls, 1);
	time = 61000;
	assert.equal(await get(), "short-token-2");
	assert.equal(credentialCalls, 2);
});

test("accepts an explicit short-lived token and rejects insecure or invalid OAuth responses", async () => {
	assert.equal(
		await workerTokenProvider({
			CONTRIBUTION_WORKER_ACCESS_TOKEN: "short-token",
		})(),
		"short-token",
	);
	for (const domain of [
		"http://untrusted.example",
		"https://user:pass@example.test",
	])
		await assert.rejects(
			workerTokenProvider({ ...credentials, COGNITO_DOMAIN: domain })(),
			/HTTPS/,
		);
	for (const response of [
		new Response("private body", { status: 403 }),
		Response.json({}),
		Response.json({ access_token: "token", expires_in: 0 }),
	])
		await assert.rejects(
			workerTokenProvider(credentials, { request: async () => response })(),
			/authentication/,
		);
});

test("reads Cognito bootstrap settings through the expected AWS account and running admin service", async () => {
	const calls = [];
	const result = await workerAwsCredentials("profile", {
		call: async (args) => {
			calls.push(args);
			if (args[0] === "sts") return { Account: "250598594267" }; // nosemgrep: generic.secrets.security.detected-aws-account-id.detected-aws-account-id
			if (args[1] === "describe-services")
				return {
					services: [
						{
							serviceName: "bible-on-site-admin",
							taskDefinition:
								"arn:aws:ecs:il-central-1:250598594267:task-definition/bible-on-site-admin:10",
						},
					],
				};
			if (args[1] === "describe-task-definition")
				return {
					taskDefinition: {
						containerDefinitions: [
							{
								name: "admin",
								environment: [
									{ name: "COGNITO_USER_POOL_ID", value: "il-central-1_pool" },
									{
										name: "COGNITO_SERVICE_CLIENT_ID",
										value: "service-client",
									},
									{ name: "COGNITO_DOMAIN", value: credentials.COGNITO_DOMAIN },
								],
							},
						],
					},
				};
			return {
				UserPoolClient: {
					ClientSecret: credentials.COGNITO_SERVICE_CLIENT_SECRET,
					AllowedOAuthScopes: ["admin-api/service", "admin-api/contributions"],
				},
			};
		},
	});
	assert.deepEqual(result, credentials);
	assert.equal(calls.length, 4);
	assert.equal(calls[3][1], "describe-user-pool-client");
	await assert.rejects(
		workerAwsCredentials("wrong", {
			call: async () => ({ Account: "another-account" }),
		}),
		/Tanahpedia AWS account/,
	);
	await assert.rejects(
		workerAwsCredentials("wrong", {
			call: async (args) =>
				args[0] === "sts" ? { Account: "250598594267" } : { services: [] }, // nosemgrep: generic.secrets.security.detected-aws-account-id.detected-aws-account-id
		}),
		/Unexpected admin task/,
	);
});

test("claims work, uses only local inference and submits an authority-free result", async () => {
	const calls = [],
		logs = [];
	const run = createContributionWorker(
		{ ...options, dev: false, origin: "https://admin.xn--febl3a.co.il" },
		{
			getToken: async () => "short-worker-token",
			log: (line) => logs.push(line),
			request: async (url, request) => {
				const target = String(url),
					body = JSON.parse(request.body);
				calls.push({ target, body, headers: request.headers });
				if (target.endsWith("/claim")) return Response.json(claim);
				if (target.endsWith("/api/chat")) {
					assert.equal(request.headers.Authorization, undefined);
					assert.deepEqual(body.format, claim.schema);
					assert.equal(body.think, false);
					assert.equal(body.model, "local-test");
					return Response.json({
						model: "doradsoft",
						message: { content: '{"pullRequests":[]}' },
					});
				}
				return Response.json({ prIds: [id] });
			},
		},
	);
	assert.deepEqual(await run(), { status: "completed", issueId, prIds: [id] });
	assert.equal(calls[2].headers.Authorization, "Bearer short-worker-token");
	assert.equal(calls[2].body.model, "doradsoft");
	assert.equal(calls[2].body.token, claim.token);
	assert.equal(calls[2].body.author, undefined);
	assert.ok(!inspect(logs).includes("Private supplied evidence"));
	assert.ok(!inspect(logs).includes(claim.token));
	assert.ok(!inspect(calls[1].body).includes("short-worker-token"));
});

test("idle and malformed claims never invoke a model", async () => {
	let calls = 0;
	const idle = createContributionWorker(options, {
		request: async () => {
			calls++;
			return new Response(null, { status: 204 });
		},
	});
	assert.deepEqual(await idle(), { status: "idle" });
	assert.equal(calls, 1);
	const malformed = createContributionWorker(options, {
		request: async () => Response.json({ ...claim, id: "bad" }),
	});
	await assert.rejects(malformed(), /Invalid worker claim/);
	const unauthorized = createContributionWorker(options, {
		request: async () => new Response(null, { status: 401 }),
	});
	await assert.rejects(unauthorized(), /claim failed \(401\)/);
});

test("reports inference/protocol failures without sending a completion", async () => {
	for (const response of [
		new Response(null, { status: 404 }),
		Response.json({ message: {} }),
	]) {
		const actions = [];
		const run = createContributionWorker(options, {
			request: async (url) => {
				const target = String(url);
				actions.push(target);
				if (target.endsWith("/claim")) return Response.json(claim);
				if (target.endsWith("/api/chat")) return response;
				return Response.json({ updated: true });
			},
		});
		assert.equal((await run()).status, "failed");
		assert.ok(actions.at(-1).endsWith("/fail"));
		assert.ok(!actions.some((action) => action.endsWith("/complete")));
	}
});

test("stopping aborts inference and releases the owned job through an independent failure acknowledgement", async () => {
	const controller = new AbortController();
	let failed = false;
	const run = createContributionWorker(options, {
		signal: controller.signal,
		request: async (url, request) => {
			if (String(url).endsWith("/claim")) return Response.json(claim);
			if (String(url).endsWith("/api/chat")) {
				controller.abort();
				throw new DOMException("Worker stopped", "AbortError");
			}
			assert.equal(request.signal.aborted, false);
			failed = true;
			return Response.json({ updated: true });
		},
	});
	assert.equal((await run()).status, "failed");
	assert.equal(failed, true);
});
