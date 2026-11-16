import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspect, promisify } from "node:util";
import {
	createContributionWorker,
	runContributionWorker,
	validateWorkerBundle,
	workerAwsCredentials,
	workerOptions,
	workerTokenProvider,
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

const canonicalFixture = (value) =>
	Array.isArray(value)
		? `[${value.map(canonicalFixture).join(",")}]`
		: value && typeof value === "object"
			? `{${Object.keys(value)
					.sort()
					.map(
						(key) => `${JSON.stringify(key)}:${canonicalFixture(value[key])}`,
					)
					.join(",")}}`
			: JSON.stringify(value);
function agentBundle(overrides = {}) {
	const payload = {
		protocolVersion: 2,
		version: "fixture-v1",
		apiVersion: 1,
		system: "Never approve or merge",
		operationGuide: ["Only typed data"],
		tools: [
			{
				name: "discussion",
				description: "Read all pages",
				inputSchema: { type: "object" },
			},
		],
		...overrides,
	};
	return {
		...payload,
		hash: createHash("sha256").update(canonicalFixture(payload)).digest("hex"),
	};
}

test("protocol two implements API five article links using the versioned read-only tool bundle", async () => {
	const bundle = agentBundle({
		version: "tanahpedia-agents-v4",
		apiVersion: 5,
		operationGuide: [
			"article_links requires exact decimal targetId and typed commands; no prose or approval",
		],
		tools: ["record", "article_text"].map((name) => ({
			name,
			description: "Read current versioned data",
			inputSchema: { type: "object" },
		})),
	});
	const actions = [
		{
			action: "tool",
			name: "record",
			arguments: { kind: "target:article_links", id: "27" },
		},
		{
			action: "tool",
			name: "article_text",
			arguments: { id: "27", cursor: 0, limit: 4000 },
		},
		{ action: "tool", name: "record", arguments: { kind: "perek", id: 99 } },
		{
			action: "complete",
			result: {
				outcome: "implemented",
				summary: "הוצע קישור למאמר",
				responses: [],
				pullRequests: [
					{
						title: "קישור",
						description: "מבוסס על המקור",
						evidenceIndexes: [0],
						changes: [
							{
								kind: "article_links",
								targetId: "27",
								after: {
									commands: [
										{
											relationshipKey: "primaryPerek",
											action: "replace",
											target: { perekId: 99 },
										},
									],
								},
							},
						],
					},
				],
			},
		},
	];
	const receipts = [];
	const schemas = [{ type: "object", title: "initial" }];
	let modelCalls = 0;
	let completed;
	const run = createContributionWorker(options, {
		request: async (url, request) => {
			const target = String(url);
			const body = JSON.parse(request.body);
			if (target.endsWith("/claim")) {
				assert.equal(body.protocolVersion, 2);
				return Response.json({
					...claim,
					apiVersion: 5,
					user: "{}",
					protocolVersion: 2,
					task: "issue_implementation",
					bundleHash: bundle.hash,
					bundleVersion: bundle.version,
					schema: schemas[0],
				});
			}
			if (target.endsWith("/bundle")) return Response.json(bundle);
			if (target.endsWith("/api/chat")) {
				assert.deepEqual(body.format, schemas.at(-1));
				assert.match(body.messages[0].content, /article_links/);
				const dynamic = JSON.parse(body.messages[1].content);
				assert.equal(dynamic.turns.length, modelCalls);
				if (modelCalls >= 2)
					assert.equal(dynamic.turns[1].response.sourceHash, "b".repeat(64));
				return Response.json({
					message: { content: JSON.stringify(actions[modelCalls++]) },
				});
			}
			if (target.endsWith("/context")) {
				assert.equal(body.apiVersion, 5);
				assert.deepEqual(body.receipts, receipts);
				const receipt = {
					name: body.name,
					arguments: body.arguments,
					hash: String(receipts.length + 1).repeat(64),
				};
				receipts.push(receipt);
				const schema = { type: "object", title: `read-${receipts.length}` };
				schemas.push(schema);
				return Response.json({
					receipt,
					schema,
					data:
						body.name === "article_text"
							? {
									text: "מקור",
									total: 4,
									nextCursor: null,
									sourceHash: "b".repeat(64),
								}
							: { record: { id: body.arguments.id } },
				});
			}
			if (target.endsWith("/complete")) {
				completed = body;
				return Response.json({ prIds: [id] });
			}
			throw new Error("Unexpected article worker request");
		},
	});
	assert.deepEqual(await run(), { status: "completed", issueId, prIds: [id] });
	assert.equal(completed.apiVersion, 5);
	assert.equal(completed.protocolVersion, 2);
	assert.deepEqual(completed.receipts, receipts);
	assert.deepEqual(JSON.parse(completed.content), actions.at(-1).result);
	assert.equal(modelCalls, 4);
});

test("malformed JSON never includes private input in failed jobs or returned errors", async () => {
	const privateFragment = "pv_7F2k9";
	assert.throws(
		() => JSON.parse(privateFragment),
		(error) => error.message.includes(privateFragment),
		"the fixture must exercise a parser diagnostic that exposes its input",
	);
	for (const [stage, expected] of [
		["model-content", "Invalid local model response"],
		["model-envelope", "Invalid local model response"],
		["legacy-envelope", "Invalid local model response"],
		["task-context", "Invalid worker task context"],
		["bundle", "Invalid worker bundle response"],
		["context", "Invalid worker context response"],
		["complete", "Invalid worker complete response"],
		["fail", "Invalid worker fail response"],
		["claim", "Invalid worker claim response"],
	]) {
		const bundle = agentBundle(),
			job = {
				...claim,
				user: stage === "task-context" ? privateFragment : "{}",
				protocolVersion: 2,
				task: "pr_resolution",
				bundleHash: bundle.hash,
				bundleVersion: bundle.version,
			};
		if (stage === "legacy-envelope") delete job.protocolVersion;
		let failedJob, result, rejection;
		const run = createContributionWorker(options, {
			request: async (url, request) => {
				const target = String(url);
				if (target.endsWith("/claim"))
					return stage === "claim"
						? new Response(privateFragment)
						: Response.json(job);
				if (target.endsWith("/bundle"))
					return stage === "bundle"
						? new Response(privateFragment)
						: Response.json(bundle);
				if (target.endsWith("/api/chat")) {
					if (stage.endsWith("envelope")) return new Response(privateFragment);
					return Response.json({
						message: {
							content:
								stage === "model-content" || stage === "fail"
									? privateFragment
									: JSON.stringify(
											stage === "context"
												? { action: "tool", name: "discussion", arguments: {} }
												: { action: "complete", result: {} },
										),
						},
					});
				}
				if (target.endsWith("/context") || target.endsWith("/complete"))
					return new Response(privateFragment);
				if (target.endsWith("/fail")) {
					failedJob = JSON.parse(request.body);
					return stage === "fail"
						? new Response(privateFragment)
						: Response.json({ updated: true });
				}
				throw new Error("Unexpected request");
			},
		});
		try {
			result = await run();
		} catch (error) {
			rejection = error;
		}
		assert.equal(result?.error ?? rejection?.message, expected, stage);
		assert.equal(rejection?.cause, undefined, stage);
		assert.ok(
			!inspect({ failedJob, result, rejection }).includes(privateFragment),
		);
		if (stage !== "claim") {
			assert.equal(
				failedJob.error,
				stage === "fail" ? "Invalid local model response" : expected,
			);
			assert.equal(failedJob.token, claim.token);
		}
	}
});

test("malformed OAuth JSON is safe for direct callers without hiding transport failures", async () => {
	await assert.rejects(
		workerTokenProvider(credentials, {
			request: async () => new Response("pv_7F2k9"),
		})(),
		(error) => {
			assert.equal(error.message, "Invalid worker authentication response");
			assert.equal(error.cause, undefined);
			return true;
		},
	);
	for (const error of [
		new DOMException("Worker stopped", "AbortError"),
		new Error("Connection unavailable"),
	])
		await assert.rejects(
			workerTokenProvider(credentials, {
				request: async () => ({
					ok: true,
					json: async () => {
						throw error;
					},
				}),
			})(),
			(actual) => actual === error,
		);
});

test("watch logs fixed diagnostics for malformed claim, model and authentication JSON", async () => {
	const privateFragment = "pv_7F2k9";
	for (const stage of ["claim", "model", "authentication"]) {
		const stop = new AbortController(),
			logs = [],
			bundle = agentBundle(),
			savedFetch = globalThis.fetch;
		globalThis.fetch = async () => new Response(privateFragment);
		try {
			await runContributionWorker(
				[
					"--watch",
					...(stage === "authentication"
						? []
						: ["--dev", "--origin", "http://localhost:3101"]),
				],
				stage === "authentication" ? credentials : {},
				{
					signal: stop.signal,
					log: (...args) => {
						logs.push(args);
						if (args[0] === "Local contribution worker:") stop.abort();
					},
					pause: async () => stop.abort(),
					request: async (url) => {
						const target = String(url);
						if (target.endsWith("/claim"))
							return stage === "claim"
								? new Response(privateFragment)
								: Response.json({
										...claim,
										user: "{}",
										protocolVersion: 2,
										task: "pr_resolution",
										bundleHash: bundle.hash,
										bundleVersion: bundle.version,
									});
						if (target.endsWith("/bundle")) return Response.json(bundle);
						if (target.endsWith("/api/chat"))
							return Response.json({ message: { content: privateFragment } });
						if (target.endsWith("/fail"))
							return Response.json({ updated: true });
						throw new Error("Unexpected request");
					},
				},
			);
		} finally {
			globalThis.fetch = savedFetch;
		}
		assert.ok(!inspect(logs).includes(privateFragment), stage);
		assert.match(inspect(logs), /Invalid (?:worker|local model)/, stage);
	}
});

test("the CLI never prints malformed response contents", async () => {
	const execute = promisify(execFile),
		privateFragment = "pv_7F2k9",
		bootstrap = `data:text/javascript,${encodeURIComponent(
			"globalThis.fetch = async () => new Response(process.env.CONTRIBUTION_TEST_MALFORMED_BODY);",
		)}`;
	await assert.rejects(
		execute(
			process.execPath,
			[
				"--import",
				bootstrap,
				fileURLToPath(new URL("./contribution-worker.mjs", import.meta.url)),
				"--once",
				"--dev",
				"--origin",
				"http://localhost:3101",
			],
			{
				windowsHide: true,
				env: {
					...process.env,
					CONTRIBUTION_TEST_MALFORMED_BODY: `${privateFragment}"'\\\n`,
				},
			},
		),
		(error) => {
			assert.equal(error.code, 1);
			assert.equal(error.stderr.trim(), "Invalid worker claim response");
			assert.ok(!`${error.stdout}${error.stderr}`.includes(privateFragment));
			return true;
		},
	);
});

test("protocol two reads fresh context then resolves the same PR and caches only its immutable bundle", async () => {
	const bundle = agentBundle(),
		calls = [],
		signals = [],
		receipt = {
			name: "discussion",
			arguments: { cursor: 20 },
			hash: "b".repeat(64),
		};
	let modelCalls = 0;
	const run = createContributionWorker(options, {
		request: async (url, request) => {
			const target = String(url),
				body = JSON.parse(request.body);
			calls.push({ target, body });
			if (target.endsWith("/claim"))
				return Response.json({
					...claim,
					system: undefined,
					protocolVersion: 2,
					task: "pr_resolution",
					bundleHash: bundle.hash,
					bundleVersion: bundle.version,
					user: '{"discussion":{"total":21}}',
				});
			if (target.endsWith("/bundle")) return Response.json(bundle);
			if (target.endsWith("/context")) {
				assert.equal(request.signal.aborted, false);
				return Response.json({
					data: {
						items: [
							{
								id,
								body: "The first twenty comments do not include this correction",
							},
						],
						total: 21,
						nextCursor: null,
					},
					receipt,
					schema: { type: "object", title: "updated schema" },
				});
			}
			if (target.endsWith("/api/chat")) {
				signals.push(request.signal);
				modelCalls++;
				const result =
					modelCalls === 1
						? { action: "tool", name: "discussion", arguments: { cursor: 20 } }
						: {
								action: "complete",
								result: {
									outcome: "unchanged",
									summary: "Addressed",
									responses: [],
								},
							};
				if (modelCalls === 2) {
					assert.match(body.messages[1].content, /correction/);
					assert.equal(body.format.title, "updated schema");
				}
				return Response.json({ message: { content: JSON.stringify(result) } });
			}
			if (target.endsWith("/complete")) {
				if (modelCalls === 2) assert.deepEqual(body.receipts, [receipt]);
				return Response.json({ prIds: [] });
			}
			throw new Error("Unexpected request");
		},
	});
	assert.equal((await run()).status, "completed");
	assert.equal((await run()).status, "completed");
	assert.equal(
		calls.filter((call) => call.target.endsWith("/bundle")).length,
		1,
	);
	assert.deepEqual(calls[0].body.supportedTasks, [
		"issue_implementation",
		"pr_resolution",
	]);
	assert.deepEqual(
		calls.findLast((call) => call.target.endsWith("/claim")).body.bundleHashes,
		[bundle.hash],
	);
	assert.equal(
		signals[0],
		signals[1],
		"all turns share the original total inference deadline",
	);
	assert.equal(
		calls.find((call) => call.target.endsWith("/complete")).body
			.protocolVersion,
		2,
	);
});

test("bundle identity and declarative schema are verified before model execution", () => {
	const bundle = agentBundle();
	assert.equal(validateWorkerBundle(bundle, bundle.hash), bundle);
	for (const broken of [
		{ ...bundle, system: "changed" },
		{ ...bundle, protocolVersion: 3 },
		{ ...bundle, tools: [{ name: "unsafe" }] },
	])
		assert.throws(() => validateWorkerBundle(broken, bundle.hash), /bundle/);
});

test("Ollama receives the discriminated outcome schema and fresh PR task context unchanged", async () => {
	const bundle = agentBundle(),
		logs = [];
	const resultBranches = ["revised", "unchanged", "clarification"].map(
		(outcome) => ({
			type: "object",
			additionalProperties: false,
			required:
				outcome === "revised"
					? ["outcome", "summary", "responses", "draft"]
					: ["outcome", "summary", "responses"],
			properties: {
				outcome: { const: outcome },
				summary: { type: "string" },
				responses: { type: "array" },
				...(outcome === "revised" ? { draft: { type: "object" } } : {}),
			},
		}),
	);
	const schema = {
		type: "object",
		oneOf: [
			{
				type: "object",
				additionalProperties: false,
				required: ["action", "result"],
				properties: {
					action: { const: "complete" },
					result: { type: "object", oneOf: resultBranches },
				},
			},
		],
	};
	const run = createContributionWorker(options, {
		log: (value) => logs.push(value),
		request: async (url, request) => {
			const target = String(url),
				body = JSON.parse(request.body);
			if (target.endsWith("/claim"))
				return Response.json({
					...claim,
					protocolVersion: 2,
					task: "pr_resolution",
					bundleHash: bundle.hash,
					bundleVersion: bundle.version,
					schema,
					user: JSON.stringify({
						pendingFeedback: {
							items: [{ id, body: "Correct this existing proposal title" }],
							total: 1,
							nextCursor: null,
						},
					}),
				});
			if (target.endsWith("/bundle")) return Response.json(bundle);
			if (target.endsWith("/api/chat")) {
				assert.deepEqual(body.format, schema);
				assert.equal(body.options.num_ctx, 16384);
				assert.equal(body.options.num_predict, 4096);
				const user = JSON.parse(body.messages[1].content);
				assert.equal(user.task, "pr_resolution");
				assert.equal(
					user.context.pendingFeedback.items[0].body,
					"Correct this existing proposal title",
				);
				return Response.json({
					message: {
						content: JSON.stringify({
							action: "complete",
							result: {
								outcome: "clarification",
								summary: "A source identity is ambiguous",
								responses: [],
							},
						}),
					},
				});
			}
			if (target.endsWith("/complete")) {
				assert.equal(JSON.parse(body.content).draft, undefined);
				return Response.json({ prIds: [] });
			}
			throw new Error("Unexpected request");
		},
	});
	assert.equal((await run()).status, "completed");
	assert.match(logs[0], /^Resolving PR /);
	assert.ok(!logs[0].includes("Generating issue"));
});

test("tampered bundles, unsupported tools and a full model window never submit a completion", async () => {
	for (const failure of ["bundle", "tool", "window"]) {
		const bundle = agentBundle(),
			actions = [];
		const run = createContributionWorker(options, {
			request: async (url) => {
				const target = String(url);
				actions.push(target);
				if (target.endsWith("/claim"))
					return Response.json({
						...claim,
						user: "{}",
						protocolVersion: 2,
						task: "issue_implementation",
						bundleHash: bundle.hash,
						bundleVersion: bundle.version,
					});
				if (target.endsWith("/bundle"))
					return Response.json(
						failure === "bundle" ? { ...bundle, system: "tampered" } : bundle,
					);
				if (target.endsWith("/api/chat"))
					return Response.json({
						...(failure === "window" ? { prompt_eval_count: 16384 } : {}),
						message: {
							content: JSON.stringify(
								failure === "tool"
									? { action: "tool", name: "merge", arguments: {} }
									: { action: "complete", result: {} },
							),
						},
					});
				return Response.json({ updated: true });
			},
		});
		assert.equal((await run()).status, "failed");
		assert.ok(actions.at(-1).endsWith("/fail"));
		assert.ok(!actions.some((action) => action.endsWith("/complete")));
	}
});

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
					assert.equal(body.keep_alive, 0);
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
