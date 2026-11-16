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

function actionSchema(
	result = {
		type: "object",
		oneOf: [
			{ type: "object", properties: { outcome: { const: "unchanged" } } },
		],
	},
) {
	return {
		type: "object",
		oneOf: [
			{
				type: "object",
				additionalProperties: false,
				required: ["action", "result"],
				properties: { action: { const: "complete" }, result },
			},
		],
	};
}
function nativeReply(content = "Ready", calls, overrides = {}) {
	return {
		done: true,
		done_reason: "stop",
		prompt_eval_count: 100,
		model: "local-test",
		message: {
			role: "assistant",
			content,
			...(calls ? { tool_calls: calls } : {}),
		},
		...overrides,
	};
}
const readCall = (name = "discussion", args = {}, callId = "read-1") => ({
	id: callId,
	function: { name, arguments: args },
});
const readRejection = (code = "invalid_arguments") => ({
	error: {
		type: "invalid_tool_arguments",
		code,
		message:
			code === "invalid_arguments"
				? "The read tool arguments are invalid. Use only its declared fields, kinds and page limits."
				: "Use the numeric article ID from currentRecords or an article lookup. A PR or discussion UUID is not an article ID.",
	},
});
function agentFixture({
	bundle = agentBundle(),
	job = {},
	replies,
	contexts = [],
	intercept,
	now,
	onLog,
	signal,
} = {}) {
	const calls = [],
		models = [],
		releases = [],
		reads = [],
		completed = [],
		failed = [],
		logs = [];
	const result = { outcome: "unchanged", summary: "Checked", responses: [] };
	const request = async (url, request) => {
		const target = String(url),
			body = JSON.parse(request.body);
		calls.push({ target, body, signal: request.signal });
		const release =
			target.endsWith("/api/chat") &&
			body.keep_alive === 0 &&
			Array.isArray(body.messages) &&
			body.messages.length === 0;
		if (release) releases.push({ body, signal: request.signal });
		const custom = await intercept?.(target, body, request);
		if (custom !== undefined) return custom;
		if (release) return Response.json({ done: true, done_reason: "unload" });
		if (target.endsWith("/claim"))
			return Response.json({
				...claim,
				user: "{}",
				protocolVersion: 2,
				task: "issue_implementation",
				bundleHash: bundle.hash,
				bundleVersion: bundle.version,
				schema: actionSchema(),
				...job,
			});
		if (target.endsWith("/bundle")) return Response.json(bundle);
		if (target.endsWith("/api/chat")) {
			models.push({ body, signal: request.signal });
			const response =
				typeof replies === "function"
					? await replies(body, models.length, request)
					: (replies?.[models.length - 1] ??
						nativeReply(body.format ? JSON.stringify(result) : "Ready"));
			return response instanceof Response ? response : Response.json(response);
		}
		if (target.endsWith("/context")) {
			reads.push(body);
			return Response.json(
				Object.hasOwn(contexts, reads.length - 1)
					? contexts[reads.length - 1]
					: {
							receipt: {
								hash: "b".repeat(64),
								name: body.name,
								arguments: body.arguments,
							},
							data: { items: [] },
							schema: actionSchema(),
						},
			);
		}
		if (target.endsWith("/complete")) {
			completed.push(body);
			return Response.json({ prIds: [] });
		}
		if (target.endsWith("/fail")) {
			failed.push(body);
			return Response.json({ updated: true });
		}
		throw new Error("Unexpected worker fixture endpoint");
	};
	return {
		run: createContributionWorker(options, {
			request,
			...(now ? { now } : {}),
			signal,
			log: (...args) => {
				logs.push(args);
				onLog?.(...args);
			},
		}),
		calls,
		models,
		releases,
		reads,
		completed,
		failed,
		logs,
		bundle,
	};
}

test("native API five batches keep real tool history, ordered receipts and the full latest final schema", async () => {
	const bundle = agentBundle({
		version: "tanahpedia-agents-v4",
		apiVersion: 5,
		operationGuide: ["article_links never edits prose or grants approval"],
		tools: ["record", "article_text"].map((name) => ({
			name,
			description: "Read current versioned data",
			inputSchema: { type: "object", additionalProperties: false },
		})),
	});
	const finalSchema = {
		type: "object",
		oneOf: [
			{
				type: "object",
				additionalProperties: false,
				required: ["outcome"],
				properties: {
					outcome: { const: "implemented" },
					target: { type: "integer", minimum: 1, maximum: 999 },
				},
			},
		],
	};
	const result = {
		outcome: "implemented",
		summary: "קישור מוצע",
		responses: [],
		pullRequests: [
			{
				changes: [
					{
						kind: "article_links",
						targetId: "27",
						after: {
							commands: [
								{
									relationshipKey: "coveringSources",
									action: "add",
									target: { pasukCoordinates: [{ perekId: 99, pasuk: 26 }] },
								},
							],
						},
					},
				],
			},
		],
	};
	const receipt1 = { hash: "a".repeat(64) },
		receipt2 = { hash: "b".repeat(64) },
		receipt3 = { hash: "c".repeat(64) };
	const fixture = agentFixture({
		bundle,
		job: { apiVersion: 5 },
		replies: [
			nativeReply("", [
				readCall("record", { kind: "target:article_links", id: "27" }),
				readCall("article_text", { id: "27" }, "read-2"),
			]),
			nativeReply("", [
				readCall("record", { kind: "perek", id: 99 }, "read-3"),
			]),
			nativeReply(),
			nativeReply(JSON.stringify(result)),
		],
		contexts: [
			{
				receipt: receipt1,
				data: { record: { id: "27" } },
				schema: actionSchema(),
			},
			{
				receipt: receipt2,
				data: {
					text: "בראשית א כו",
					sourceHash: "d".repeat(64),
					total: 11,
					nextCursor: null,
				},
				schema: actionSchema(),
			},
			{
				receipt: receipt3,
				data: { record: { id: 99 } },
				schema: actionSchema(finalSchema),
			},
		],
	});
	assert.equal((await fixture.run()).status, "completed");
	assert.equal(fixture.models.length, 4);
	assert.deepEqual(
		fixture.models[0].body.tools,
		bundle.tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema,
			},
		})),
	);
	assert.equal(fixture.models[0].body.format, undefined);
	assert.match(fixture.models[0].body.messages[0].content, /article_links/);
	assert.deepEqual(
		fixture.models[1].body.messages.map((message) => message.role),
		["system", "user", "assistant", "tool", "tool"],
	);
	assert.equal(fixture.models[1].body.messages[3].tool_call_id, "read-1");
	assert.equal(fixture.models[1].body.messages[4].tool_name, "article_text");
	assert.equal(
		JSON.parse(fixture.models[1].body.messages[4].content).sourceHash,
		"d".repeat(64),
	);
	assert.deepEqual(
		fixture.reads.map((read) => read.receipts),
		[[], [receipt1], [receipt1, receipt2]],
	);
	assert.deepEqual(fixture.models.at(-1).body.format, finalSchema);
	assert.equal(fixture.models.at(-1).body.tools, undefined);
	assert.match(
		fixture.models.at(-1).body.messages.at(-1).content,
		/Ground facts in actual source\/tool data and original human feedback/,
	);
	assert.match(
		fixture.models.at(-1).body.messages.at(-1).content,
		/Copy requested verbatim text directly from the original human text rather than your research draft/,
	);
	assert.deepEqual(fixture.completed[0].receipts, [
		receipt1,
		receipt2,
		receipt3,
	]);
	assert.deepEqual(JSON.parse(fixture.completed[0].content), result);
	assert.equal(fixture.completed[0].protocolVersion, 2);
	assert.equal(fixture.completed[0].apiVersion, 5);
	for (const model of fixture.models) {
		assert.equal(model.signal, fixture.models[0].signal);
		assert.deepEqual(model.body.options, {
			temperature: 0,
			num_predict: 4096,
			num_ctx: 16384,
		});
		assert.match(model.body.keep_alive, /^\d+ms$/);
		assert.ok(Number.parseInt(model.body.keep_alive, 10) <= 120000);
		assert.equal(model.body.think, false);
		assert.equal(model.body.truncate, false);
		assert.equal(model.body.shift, false);
	}
	assert.equal(fixture.calls[0].body.runtimeVersion, "tanahpedia-worker-v6");
});

test("typed argument errors enter real tool history without receipts or schema changes", async () => {
	const error = readRejection("invalid_article_id"),
		schema = actionSchema(),
		fixture = agentFixture({
			bundle: agentBundle({
				tools: [
					{
						name: "record",
						description: "Read",
						inputSchema: { type: "object" },
					},
				],
			}),
			replies: [
				nativeReply("", [
					readCall(
						"record",
						{ kind: "target:article_links", id: issueId },
						"bad",
					),
				]),
				nativeReply("", [
					readCall(
						"record",
						{ kind: "target:article_links", id: "27" },
						"chosen-by-model",
					),
				]),
				nativeReply(),
				nativeReply('{"outcome":"unchanged"}'),
			],
			contexts: [
				error,
				{ receipt: { id: "actual-read" }, data: { articleId: "27" }, schema },
			],
		});
	assert.equal((await fixture.run()).status, "completed");
	assert.deepEqual(
		fixture.reads.map((read) => read.arguments.id),
		[issueId, "27"],
	);
	assert.deepEqual(
		fixture.reads.map((read) => read.receipts),
		[[], []],
	);
	assert.deepEqual(
		JSON.parse(fixture.models[1].body.messages.at(-1).content),
		error,
	);
	assert.equal(fixture.models[1].body.messages.at(-1).tool_call_id, "bad");
	assert.equal(fixture.models[1].body.messages.at(-1).tool_name, "record");
	assert.deepEqual(fixture.completed[0].receipts, [{ id: "actual-read" }]);
	assert.deepEqual(
		fixture.models.at(-1).body.format,
		schema.oneOf[0].properties.result,
	);
	assert.equal(fixture.models.length, 4);
	assert.equal(fixture.releases.length, 1);
});

test("verified preloaded context can complete after a redundant rejected read without forced clarification", async () => {
	const schema = actionSchema(),
		fixture = agentFixture({
			replies: [
				nativeReply("", [readCall()]),
				nativeReply(),
				nativeReply('{"outcome":"unchanged"}'),
			],
			contexts: [readRejection()],
		});
	assert.equal((await fixture.run()).status, "completed");
	assert.equal(fixture.reads.length, 1);
	assert.equal(fixture.models.length, 3);
	assert.deepEqual(fixture.completed[0].receipts, []);
	assert.deepEqual(
		fixture.models.at(-1).body.format,
		schema.oneOf[0].properties.result,
	);
});

test("an identical rejected whole batch enters the one ordinary final phase", async () => {
	const fixture = agentFixture({
		replies: (body) =>
			nativeReply(
				body.format ? '{"outcome":"unchanged"}' : "",
				body.format ? undefined : [readCall()],
			),
		contexts: [readRejection(), readRejection()],
	});
	assert.equal((await fixture.run()).status, "completed");
	assert.equal(fixture.models.length, 3);
	assert.equal(fixture.reads.length, 2);
	assert.deepEqual(fixture.completed[0].receipts, []);
	assert.equal(
		fixture.models
			.at(-1)
			.body.messages.filter((message) => message.role === "tool").length,
		2,
	);
	assert.equal(fixture.failed.length, 0);
});

test("rejected reads retain the latest trusted schema and previously earned receipts", async () => {
	const latest = actionSchema({
		type: "object",
		oneOf: [
			{
				type: "object",
				properties: {
					outcome: { const: "revised" },
					description: { const: "Exact human text" },
				},
			},
		],
	});
	const fixture = agentFixture({
		replies: (body) =>
			nativeReply(
				body.format
					? '{"outcome":"revised","description":"Exact human text"}'
					: "",
				body.format ? undefined : [readCall()],
			),
		contexts: [
			{ receipt: { id: "earned" }, data: { value: "actual" }, schema: latest },
			readRejection(),
			readRejection(),
		],
	});
	assert.equal((await fixture.run()).status, "completed");
	assert.deepEqual(
		fixture.reads.map((read) => read.receipts),
		[[], [{ id: "earned" }], [{ id: "earned" }]],
	);
	assert.deepEqual(fixture.completed[0].receipts, [{ id: "earned" }]);
	assert.deepEqual(
		fixture.models.at(-1).body.format,
		latest.oneOf[0].properties.result,
	);
	assert.equal(fixture.reads.length, 3);
	assert.equal(fixture.models.length, 4);
});

test("a repeated rejection mixed with a new real read completes the batch and continues planning", async () => {
	const fixture = agentFixture({
		replies: [
			nativeReply("", [readCall()]),
			nativeReply("", [
				readCall("discussion", {}, "bad-again"),
				readCall("discussion", { cursor: 10 }, "new-read"),
			]),
			nativeReply(),
			nativeReply('{"outcome":"unchanged"}'),
		],
		contexts: [
			readRejection(),
			readRejection(),
			{
				receipt: { id: "new" },
				data: { items: ["new"] },
				schema: actionSchema(),
			},
		],
	});
	assert.equal((await fixture.run()).status, "completed");
	assert.equal(fixture.reads.length, 3);
	assert.equal(fixture.models.length, 4);
	assert.ok(fixture.models[2].body.tools);
	assert.deepEqual(fixture.completed[0].receipts, [{ id: "new" }]);
});

test("success/error transitions are new information without changing trusted facts on rejection", async () => {
	const read = (id) => ({
		receipt: { id },
		data: { value: 1 },
		schema: actionSchema(),
	});
	const fixture = agentFixture({
		replies: (body) =>
			nativeReply(
				body.format ? '{"outcome":"unchanged"}' : "",
				body.format ? undefined : [readCall()],
			),
		contexts: [
			read("first"),
			readRejection(),
			read("returned"),
			readRejection(),
			readRejection(),
		],
	});
	assert.equal((await fixture.run()).status, "completed");
	assert.equal(fixture.reads.length, 5);
	assert.equal(fixture.models.length, 6);
	assert.deepEqual(fixture.completed[0].receipts, [
		{ id: "first" },
		{ id: "returned" },
	]);
	assert.ok(fixture.models[4].body.tools);
});

test("changed finite error feedback remains new but property order does not", async () => {
	const error = readRejection("invalid_article_id");
	const fixture = agentFixture({
		replies: (body) =>
			nativeReply(
				body.format ? '{"outcome":"unchanged"}' : "",
				body.format ? undefined : [readCall()],
			),
		contexts: [
			readRejection(),
			error,
			{
				error: {
					message: error.error.message,
					code: error.error.code,
					type: error.error.type,
				},
			},
		],
	});
	assert.equal((await fixture.run()).status, "completed");
	assert.equal(fixture.reads.length, 3);
	assert.equal(fixture.models.length, 4);
	assert.deepEqual(fixture.completed[0].receipts, []);
});

test("malformed or unrecognized read-error envelopes remain fatal and private", async () => {
	const marker = "pv_bad_read_envelope",
		valid = readRejection();
	for (const value of [
		{ error: null },
		{ error: [] },
		{ error: marker },
		{ error: {} },
		{ error: { ...valid.error, type: "storage_error" } },
		{ error: { ...valid.error, code: "constructor" } },
		{ error: { ...valid.error, code: marker } },
		{ error: { ...valid.error, message: marker } },
		{ error: { type: valid.error.type, code: valid.error.code } },
		{ error: { ...valid.error, cause: marker } },
		{ ...valid, data: marker },
		{ ...valid, receipt: {} },
		{ ...valid, schema: actionSchema() },
	]) {
		const fixture = agentFixture({
			replies: [nativeReply("", [readCall()])],
			contexts: [value],
		});
		const result = await fixture.run();
		assert.equal(result.error, "Invalid agent context response");
		assert.equal(fixture.models.length, 1);
		assert.equal(fixture.completed.length, 0);
		assert.equal(fixture.failed.length, 1);
		assert.equal(fixture.releases.length, 1);
		assert.ok(
			!inspect([result, fixture.failed, fixture.logs]).includes(marker),
		);
	}
});

test("HTTP errors never become recoverable even with a valid typed body", async () => {
	for (const status of [400, 401, 403, 409, 500]) {
		const fixture = agentFixture({
			replies: [nativeReply("", [readCall()])],
			intercept: (target) =>
				target.endsWith("/context")
					? Response.json(readRejection(), { status })
					: undefined,
		});
		assert.equal(
			(await fixture.run()).error,
			`Worker context failed (${status})`,
		);
		assert.equal(fixture.models.length, 1);
		assert.equal(fixture.completed.length, 0);
	}
});

test("recoverable feedback uses the same deadline/reserve and still releases after a failed final", async () => {
	let clock = 0;
	const fixture = agentFixture({
		now: () => clock,
		contexts: [readRejection()],
		replies: (body, number) => {
			if (number === 1) {
				clock = 75000;
				return nativeReply("", [readCall()]);
			}
			assert.equal(body.keep_alive, "45000ms");
			assert.ok(body.format);
			throw new Error("Final unavailable");
		},
	});
	assert.equal((await fixture.run()).error, "Final unavailable");
	assert.equal(fixture.models.length, 2);
	assert.equal(fixture.reads.length, 1);
	assert.equal(new Set(fixture.models.map((model) => model.signal)).size, 1);
	assert.equal(fixture.completed.length, 0);
	assert.equal(fixture.failed.length, 1);
	assert.equal(fixture.releases.length, 1);
});

test("an unchanged whole research batch enters final format with every actual read and receipt", async () => {
	const schema = actionSchema(),
		data = { items: [{ id: "known", body: "Private source" }], total: 1 },
		fixture = agentFixture({
			replies: [
				nativeReply("", [
					readCall("discussion", { source: "item", cursor: 0 }, "first"),
				]),
				nativeReply("", [
					readCall("discussion", { cursor: 0, source: "item" }, "second"),
				]),
				nativeReply('{"outcome":"unchanged"}'),
			],
			contexts: [
				{ data, schema, receipt: { id: "first", at: "earlier" } },
				{
					data: { total: 1, items: data.items },
					schema: { oneOf: schema.oneOf, type: "object" },
					receipt: { id: "second", at: "later" },
				},
			],
		});
	assert.equal((await fixture.run()).status, "completed");
	assert.equal(fixture.models.length, 3);
	assert.equal(fixture.reads.length, 2);
	assert.equal(fixture.models[2].body.tools, undefined);
	assert.deepEqual(
		fixture.models[2].body.format,
		schema.oneOf[0].properties.result,
	);
	assert.deepEqual(
		fixture.completed[0].receipts.map((receipt) => receipt.id),
		["first", "second"],
	);
	assert.deepEqual(
		fixture.models[2].body.messages.map((message) => message.role),
		["system", "user", "assistant", "tool", "assistant", "tool", "user"],
	);
	assert.equal(
		fixture.models[2].body.messages.filter((message) => message.role === "tool")
			.length,
		2,
	);
	assert.equal(fixture.releases.length, 1);
	assert.equal(fixture.failed.length, 0);
	assert.equal(new Set(fixture.models.map((model) => model.signal)).size, 1);
});

test("a mixed repeated/new batch finishes all reads and continues research", async () => {
	const bundle = agentBundle({
		tools: ["discussion", "history"].map((name) => ({
			name,
			description: "Read",
			inputSchema: { type: "object" },
		})),
	});
	const fixture = agentFixture({
		bundle,
		replies: [
			nativeReply("", [readCall()]),
			nativeReply("", [
				readCall("discussion", {}, "again"),
				readCall("history", {}, "new"),
			]),
			nativeReply("Ready"),
			nativeReply('{"outcome":"unchanged"}'),
		],
	});
	assert.equal((await fixture.run()).status, "completed");
	assert.equal(fixture.reads.length, 3);
	assert.equal(fixture.models.length, 4);
	assert.ok(fixture.models[2].body.tools);
	assert.equal(
		fixture.models[2].body.messages.filter((message) => message.role === "tool")
			.length,
		3,
	);
	assert.equal(fixture.completed[0].receipts.length, 3);
});

test("changed trusted data or admissible schema remains new information for the same call", async () => {
	for (const changed of ["data", "schema"]) {
		const first = {
			data: { record: { value: 1 } },
			schema: actionSchema(),
			receipt: { id: "first" },
		};
		const second = {
			data: { record: { value: changed === "data" ? 2 : 1 } },
			schema:
				changed === "schema"
					? actionSchema({
							type: "object",
							oneOf: [
								{
									type: "object",
									properties: {
										outcome: { const: "unchanged" },
										newField: { type: "string" },
									},
								},
							],
						})
					: actionSchema(),
			receipt: { id: "second" },
		};
		const fixture = agentFixture({
			contexts: [first, second],
			replies: [
				nativeReply("", [readCall()]),
				nativeReply("", [readCall()]),
				nativeReply("Ready"),
				nativeReply('{"outcome":"unchanged"}'),
			],
		});
		assert.equal((await fixture.run()).status, "completed", changed);
		assert.equal(fixture.models.length, 4, changed);
		assert.ok(fixture.models[2].body.tools, changed);
		assert.deepEqual(
			fixture.models[3].body.format,
			second.schema.oneOf[0].properties.result,
		);
		assert.equal(fixture.reads.length, 2);
	}
});

test("a current value reverting to an older value remains new information", async () => {
	const fixture = agentFixture({
		contexts: [1, 2, 1].map((value, index) => ({
			data: { value },
			schema: actionSchema(),
			receipt: { id: index },
		})),
		replies: [
			nativeReply("", [readCall()]),
			nativeReply("", [readCall()]),
			nativeReply("", [readCall()]),
			nativeReply("Ready"),
			nativeReply('{"outcome":"unchanged"}'),
		],
	});
	assert.equal((await fixture.run()).status, "completed");
	assert.equal(fixture.models.length, 5);
	assert.equal(fixture.reads.length, 3);
	assert.ok(fixture.models[3].body.tools);
	assert.equal(fixture.models[4].body.tools, undefined);
});

test("repeated unknown context can finalize as clarification without invented changes", async () => {
	const result = {
			outcome: "clarification",
			summary: "Missing source",
			responses: [],
		},
		schema = actionSchema({
			type: "object",
			oneOf: [
				{ type: "object", properties: { outcome: { const: "clarification" } } },
			],
		});
	const fixture = agentFixture({
		job: { schema },
		contexts: [1, 2].map((id) => ({
			data: { record: null },
			schema,
			receipt: { id },
		})),
		replies: (body) =>
			nativeReply(
				body.format ? JSON.stringify(result) : "",
				body.format ? undefined : [readCall()],
			),
	});
	assert.equal((await fixture.run()).status, "completed");
	assert.equal(fixture.models.length, 3);
	assert.equal(fixture.reads.length, 2);
	assert.deepEqual(JSON.parse(fixture.completed[0].content), result);
	assert.equal(fixture.completed[0].receipts.length, 2);
});

test("the soft final reserve redirects only the next planning call inside the original deadline", async () => {
	for (const remaining of [45000, 45001]) {
		let clock = 0;
		const fixture = agentFixture({
			now: () => clock,
			replies: (body, number) => {
				if (number === 1) {
					clock = 120000 - remaining;
					return nativeReply("", [readCall()]);
				}
				return nativeReply(body.format ? '{"outcome":"unchanged"}' : "Ready");
			},
		});
		assert.equal((await fixture.run()).status, "completed");
		assert.equal(fixture.models.length, remaining === 45000 ? 2 : 3);
		assert.equal(Boolean(fixture.models[1].body.format), remaining === 45000);
		assert.equal(fixture.models[1].body.keep_alive, `${remaining}ms`);
		assert.equal(new Set(fixture.models.map((model) => model.signal)).size, 1);
		assert.equal(fixture.releases.length, 1);
		assert.equal(fixture.failed.length, 0);
	}
});

test("a failed final after repeated reads is acknowledged and unloaded without retry", async () => {
	const fixture = agentFixture({
		replies: (body) => {
			if (body.format) throw new Error("Final unavailable");
			return nativeReply("", [readCall()]);
		},
	});
	assert.equal((await fixture.run()).error, "Final unavailable");
	assert.equal(fixture.models.length, 3);
	assert.equal(fixture.reads.length, 2);
	assert.equal(fixture.completed.length, 0);
	assert.equal(fixture.failed.length, 1);
	assert.equal(fixture.releases.length, 1);
	assert.ok(fixture.calls.at(-2).target.endsWith("/fail"));
});

test("native residency reuses one original deadline, then releases the requested model after completion", async (t) => {
	let clock = 1000;
	const bounds = [],
		originalTimeout = AbortSignal.timeout;
	t.mock.method(AbortSignal, "timeout", (duration) => {
		bounds.push(duration);
		return originalTimeout(duration);
	});
	const fixture = agentFixture({
		now: () => clock,
		job: { model: "configured-model" },
		replies: (_body, number) => {
			clock += 20000;
			return nativeReply(
				number === 3 ? '{"outcome":"unchanged"}' : "Ready",
				number === 1 ? [readCall()] : undefined,
				{ model: "provider-reported-model" },
			);
		},
	});
	assert.equal((await fixture.run()).status, "completed");
	assert.deepEqual(
		fixture.models.map(({ body }) => body.keep_alive),
		["120000ms", "100000ms", "80000ms"],
	);
	assert.equal(new Set(fixture.models.map(({ signal }) => signal)).size, 1);
	assert.equal(bounds.filter((duration) => duration === 120000).length, 1);
	assert.ok(bounds.every((duration) => [30000, 120000].includes(duration)));
	assert.equal(fixture.models.length, 3);
	assert.equal(fixture.releases.length, 1);
	assert.deepEqual(fixture.releases[0].body, {
		model: "configured-model",
		messages: [],
		stream: false,
		keep_alive: 0,
	});
	assert.notEqual(fixture.releases[0].signal, fixture.models[0].signal);
	assert.equal(fixture.releases[0].signal.aborted, false);
	assert.ok(fixture.calls.at(-2).target.endsWith("/complete"));
	assert.ok(fixture.calls.at(-1).target.endsWith("/api/chat"));
	assert.equal(fixture.completed[0].model, "provider-reported-model");
});

test("the original deadline prevents another generation even before its timer can run", async () => {
	let clock = 0;
	const fixture = agentFixture({
		now: () => clock,
		replies: () => {
			clock = 120001;
			return nativeReply("", [readCall()]);
		},
	});
	assert.match((await fixture.run()).error, /aborted due to timeout/);
	assert.equal(fixture.models.length, 1);
	assert.equal(fixture.completed.length, 0);
	assert.equal(fixture.failed.length, 1);
	assert.equal(fixture.releases.length, 1);
	assert.ok(fixture.calls.at(-2).target.endsWith("/fail"));
});

test("a final response after the monotonic deadline never reaches completion", async () => {
	let clock = 0;
	const fixture = agentFixture({
		now: () => clock,
		replies: (body) => {
			if (body.format) clock = 120001;
			return nativeReply(body.format ? '{"outcome":"unchanged"}' : "Ready");
		},
	});
	assert.match((await fixture.run()).error, /aborted due to timeout/);
	assert.equal(fixture.models.length, 2);
	assert.equal(fixture.completed.length, 0);
	assert.equal(fixture.failed.length, 1);
	assert.equal(fixture.releases.length, 1);
});

test("a context read consuming the original deadline prevents later batch reads", async () => {
	let clock = 0;
	const fixture = agentFixture({
		now: () => clock,
		replies: [
			nativeReply("", [readCall(), readCall("discussion", {}, "read-2")]),
		],
		intercept: (target) => {
			if (target.endsWith("/context")) clock = 120001;
		},
	});
	assert.match((await fixture.run()).error, /aborted due to timeout/);
	assert.equal(fixture.models.length, 1);
	assert.equal(fixture.reads.length, 1);
	assert.equal(fixture.completed.length, 0);
	assert.equal(fixture.failed.length, 1);
	assert.equal(fixture.releases.length, 1);
});

test("native abort releases after failure acknowledgement with an independent cleanup signal", async () => {
	const controller = new AbortController();
	const fixture = agentFixture({
		signal: controller.signal,
		replies: (_body, _number, request) => {
			controller.abort(new Error("Original cancellation"));
			request.signal.throwIfAborted();
		},
	});
	assert.equal((await fixture.run()).error, "Original cancellation");
	assert.equal(fixture.models.length, 1);
	assert.equal(fixture.models[0].signal.aborted, true);
	assert.equal(fixture.releases.length, 1);
	assert.equal(fixture.releases[0].signal.aborted, false);
	assert.notEqual(fixture.releases[0].signal, controller.signal);
	assert.ok(fixture.calls.at(-2).target.endsWith("/fail"));
});

test("model release waits for completion or failure acknowledgement", async () => {
	for (const failed of [false, true]) {
		let acknowledge, entered;
		const waiting = new Promise((resolve) => {
			entered = resolve;
		});
		const fixture = agentFixture({
			...(failed
				? {
						replies: () => {
							throw new Error("Model unavailable");
						},
					}
				: {}),
			intercept: async (target) => {
				if (!target.endsWith(failed ? "/fail" : "/complete")) return;
				entered();
				await new Promise((resolve) => {
					acknowledge = resolve;
				});
				return Response.json({ prIds: [] });
			},
		});
		const pending = fixture.run();
		await waiting;
		assert.equal(fixture.releases.length, 0);
		acknowledge();
		assert.equal((await pending).status, failed ? "failed" : "completed");
		assert.equal(fixture.releases.length, 1);
	}
});

test("cleanup failures are private warnings and preserve completed or failed job outcomes", async () => {
	const marker = "private_release_marker";
	for (const primaryFailure of [false, true]) {
		for (const cleanupFailure of [
			"transport",
			"http",
			"json",
			"wrong-response",
			"log-sink",
		]) {
			const fixture = agentFixture({
				onLog: (message) => {
					if (
						cleanupFailure === "log-sink" &&
						message.startsWith("Local model release")
					)
						throw new Error(marker);
				},
				replies: (body) => {
					if (primaryFailure) throw new Error("Original model failure");
					return nativeReply(body.format ? '{"outcome":"unchanged"}' : "Ready");
				},
				intercept: (target, body) => {
					if (!target.endsWith("/api/chat") || body.keep_alive !== 0) return;
					if (cleanupFailure === "transport") throw new Error(marker);
					if (cleanupFailure === "http")
						return new Response(marker, { status: 503 });
					if (cleanupFailure === "json") return new Response(marker);
					return Response.json({ done: true, done_reason: marker });
				},
			});
			const result = await fixture.run();
			assert.equal(result.status, primaryFailure ? "failed" : "completed");
			assert.equal(
				result.error,
				primaryFailure ? "Original model failure" : undefined,
			);
			assert.equal(fixture.releases.length, 1);
			assert.equal(fixture.failed.length, primaryFailure ? 1 : 0);
			assert.equal(fixture.completed.length, primaryFailure ? 0 : 1);
			assert.equal(
				fixture.logs.at(-1)[0],
				"Local model release was not confirmed; bounded residency may remain",
			);
			assert.ok(!inspect({ result, logs: fixture.logs }).includes(marker));
		}
	}
});

test("idle work and failures before model dispatch never unload a model", async () => {
	for (const job of [null, { schema: {} }, { user: "malformed-json" }]) {
		const fixture = agentFixture({
			...(job
				? { job }
				: {
						intercept: (target) =>
							target.endsWith("/claim")
								? new Response(null, { status: 204 })
								: undefined,
					}),
		});
		assert.equal((await fixture.run()).status, job ? "failed" : "idle");
		assert.equal(fixture.models.length, 0);
		assert.equal(fixture.releases.length, 0);
	}
});

test("native PR resolution retains fresh comments, same-PR identity and only immutable bundle caching", async () => {
	const feedback = {
		pendingFeedback: {
			items: [{ id, body: "Correct the existing proposal" }],
			total: 21,
			nextCursor: 20,
		},
	};
	const fixture = agentFixture({
		job: { task: "pr_resolution", user: JSON.stringify(feedback) },
		replies: (body, index) =>
			index === 1
				? nativeReply("", [readCall("discussion", { cursor: 20 })])
				: nativeReply(
						body.format
							? JSON.stringify({
									outcome: "revised",
									summary: "Addressed",
									responses: [
										{ commentId: id, status: "addressed", body: "Resolved" },
									],
									draft: { description: "Updated existing PR" },
								})
							: "Ready",
					),
		contexts: [
			{
				receipt: { hash: "e".repeat(64) },
				schema: actionSchema(),
				data: {
					items: [{ id, body: "The correction beyond the first page" }],
					total: 21,
					nextCursor: null,
				},
			},
		],
	});
	assert.equal((await fixture.run()).status, "completed");
	assert.equal((await fixture.run()).status, "completed");
	assert.deepEqual(JSON.parse(fixture.models[0].body.messages[1].content), {
		task: "pr_resolution",
		context: feedback,
	});
	assert.match(
		fixture.models[1].body.messages[3].content,
		/beyond the first page/,
	);
	assert.equal(fixture.completed[0].issueId, issueId);
	assert.equal(
		JSON.parse(fixture.completed[0].content).pullRequests,
		undefined,
	);
	assert.equal(
		fixture.calls.filter((call) => call.target.endsWith("/bundle")).length,
		1,
	);
	assert.deepEqual(
		fixture.calls.findLast((call) => call.target.endsWith("/claim")).body
			.bundleHashes,
		[fixture.bundle.hash],
	);
	assert.notEqual(fixture.models[0].signal, fixture.models[3].signal);
});

test("malformed or ambiguous trusted completion schemas fail before inference", async () => {
	const good = actionSchema();
	for (const schema of [
		null,
		{},
		{ ...good, oneOf: [] },
		{ ...good, oneOf: [...good.oneOf, ...good.oneOf] },
		actionSchema({ type: "object", oneOf: [] }),
		{ ...good, oneOf: [{ ...good.oneOf[0], required: ["action"] }] },
		{ ...good, oneOf: [{ ...good.oneOf[0], additionalProperties: true }] },
		{
			...good,
			oneOf: [
				{
					...good.oneOf[0],
					properties: { ...good.oneOf[0].properties, extra: {} },
				},
			],
		},
	]) {
		const fixture = agentFixture({ job: { schema } });
		if (schema === null)
			await assert.rejects(fixture.run(), /Invalid worker claim response/);
		else
			assert.equal((await fixture.run()).error, "Invalid worker result schema");
		assert.equal(fixture.models.length, 0);
		assert.equal(fixture.completed.length, 0);
	}
});

test("all native calls are validated before any read and invalid calls never retry", async () => {
	for (const calls of [
		"invalid",
		[null],
		[readCall("merge")],
		[readCall("discussion", "private arguments")],
		[readCall("discussion", [])],
		[readCall("discussion", null)],
		[readCall(), readCall()],
		[readCall("discussion", {}, "")],
		[readCall("discussion", {}, "x".repeat(256))],
		[{ function: null }],
	]) {
		const fixture = agentFixture({ replies: [nativeReply("", calls)] });
		assert.equal((await fixture.run()).status, "failed");
		assert.equal(fixture.models.length, 1);
		assert.equal(fixture.reads.length, 0);
		assert.equal(fixture.completed.length, 0);
	}
});

test("native context errors and malformed updated schemas never continue or complete", async () => {
	for (const context of [
		null,
		{},
		{ receipt: {}, schema: actionSchema() },
		{ receipt: {}, data: {}, schema: {} },
	]) {
		const fixture = agentFixture({
			replies: [nativeReply("", [readCall()])],
			contexts: [context],
		});
		assert.equal((await fixture.run()).status, "failed");
		assert.equal(fixture.models.length, 1);
		assert.equal(fixture.completed.length, 0);
	}
	const fixture = agentFixture({
		replies: [nativeReply("", [readCall()])],
		intercept: (target) =>
			target.endsWith("/context")
				? new Response("private error", { status: 400 })
				: undefined,
	});
	assert.equal((await fixture.run()).error, "Worker context failed (400)");
	assert.equal(fixture.models.length, 1);
});

test("native and final context/output limits and malformed envelopes never save a result", async () => {
	for (const final of [false, true])
		for (const broken of [
			nativeReply("Ready", undefined, { prompt_eval_count: 16384 }),
			nativeReply("Ready", undefined, { prompt_eval_count: -1 }),
			nativeReply("Ready", undefined, { prompt_eval_count: undefined }),
			nativeReply("Ready", undefined, { done: false }),
			nativeReply("Ready", undefined, { done_reason: "length" }),
			nativeReply("x".repeat(100001)),
			nativeReply("", undefined),
			nativeReply("Ready", undefined, {
				message: { role: "user", content: "Ready" },
			}),
			nativeReply("Ready", undefined, {
				message: { role: "assistant", content: "Ready", thinking: 1 },
			}),
		]) {
			const fixture = agentFixture({
				replies: final ? [nativeReply(), broken] : [broken],
			});
			assert.equal((await fixture.run()).status, "failed");
			assert.equal(fixture.completed.length, 0);
			assert.equal(fixture.models.length, final ? 2 : 1);
		}
	for (const content of ["null", "[]", '"result"', "not JSON"]) {
		const fixture = agentFixture({
			replies: [nativeReply(), nativeReply(content)],
		});
		assert.equal((await fixture.run()).error, "Invalid local model response");
		assert.equal(fixture.completed.length, 0);
	}
	const fixture = agentFixture({
		replies: [nativeReply(), nativeReply("", [readCall()])],
	});
	assert.equal(
		(await fixture.run()).error,
		"Unexpected tool call during final generation",
	);
	assert.equal(fixture.reads.length, 0);
});

test("abort in a native batch prevents later reads and acknowledges failure independently", async () => {
	const stop = new AbortController();
	const fixture = agentFixture({
		signal: stop.signal,
		replies: [
			nativeReply("", [
				readCall(),
				readCall("discussion", { cursor: 2 }, "read-2"),
			]),
		],
		intercept: (target) => {
			if (target.endsWith("/context")) {
				stop.abort(new DOMException("Stopped", "AbortError"));
				return Response.json({ receipt: {}, data: {}, schema: actionSchema() });
			}
		},
	});
	assert.equal((await fixture.run()).status, "failed");
	assert.equal(
		fixture.calls.filter((call) => call.target.endsWith("/context")).length,
		1,
	);
	assert.equal(fixture.completed.length, 0);
	assert.equal(fixture.calls.at(-1).signal.aborted, false);
});

test("an aborted final response cannot complete or trigger another generation", async () => {
	const stop = new AbortController();
	const fixture = agentFixture({
		signal: stop.signal,
		replies: (body) => {
			if (body.format) {
				stop.abort(new DOMException("Stopped", "AbortError"));
				return nativeReply('{"outcome":"unchanged"}');
			}
			return nativeReply();
		},
	});
	assert.equal((await fixture.run()).error, "Stopped");
	assert.equal(fixture.models.length, 2);
	assert.equal(fixture.completed.length, 0);
	assert.equal(fixture.failed.length, 1);
	assert.equal(fixture.calls.at(-1).signal.aborted, false);
});

test("unsupported tasks or mismatched bundle versions never run native inference", async () => {
	for (const job of [
		{ task: "merge" },
		{ bundleHash: "not-a-hash" },
		{ apiVersion: 99 },
		{ bundleVersion: "different-version" },
	]) {
		const fixture = agentFixture({ job });
		assert.equal((await fixture.run()).status, "failed");
		assert.equal(fixture.models.length, 0);
		assert.equal(fixture.completed.length, 0);
	}
});

test("rejected native names and arguments never become error-log evidence", async () => {
	const privateFragment = "pv_7F2k9";
	for (const calls of [
		[readCall(privateFragment)],
		[readCall("discussion", privateFragment)],
	]) {
		const fixture = agentFixture({ replies: [nativeReply("", calls)] });
		const result = await fixture.run();
		assert.equal(result.error, "Invalid local model tool call");
		assert.ok(
			!inspect({ result, failed: fixture.failed, logs: fixture.logs }).includes(
				privateFragment,
			),
		);
		assert.equal(fixture.reads.length, 0);
	}
});

test("bundle identity, duplicate declarations and tampering are checked before inference", async () => {
	const bundle = agentBundle();
	assert.equal(validateWorkerBundle(bundle, bundle.hash), bundle);
	for (const broken of [
		{ ...bundle, system: "changed" },
		{ ...bundle, protocolVersion: 3 },
		agentBundle({ tools: [...bundle.tools, ...bundle.tools] }),
		agentBundle({ tools: [{ ...bundle.tools[0], inputSchema: true }] }),
	])
		assert.throws(() => validateWorkerBundle(broken, broken.hash), /bundle/);
	const fixture = agentFixture({
		intercept: (target) =>
			target.endsWith("/bundle")
				? Response.json({ ...bundle, system: "tampered" })
				: undefined,
	});
	assert.equal((await fixture.run()).status, "failed");
	assert.equal(fixture.models.length, 0);
});

test("malformed JSON is private at every native/final/legacy/API boundary", async () => {
	const marker = "pv_7F2k9";
	assert.throws(
		() => JSON.parse(marker),
		(error) => error.message.includes(marker),
	);
	for (const stage of [
		"native-envelope",
		"final-envelope",
		"final-content",
		"legacy-envelope",
		"task-context",
		"bundle",
		"context",
		"complete",
		"fail",
		"claim",
	]) {
		let modelCalls = 0,
			failedJob,
			rejection,
			result;
		const bundle = agentBundle();
		const job = {
			...claim,
			user: stage === "task-context" ? marker : "{}",
			protocolVersion: 2,
			task: "pr_resolution",
			bundleHash: bundle.hash,
			bundleVersion: bundle.version,
			schema: actionSchema(),
		};
		if (stage === "legacy-envelope") delete job.protocolVersion;
		const run = createContributionWorker(options, {
			request: async (url, request) => {
				const target = String(url);
				if (target.endsWith("/claim"))
					return stage === "claim" ? new Response(marker) : Response.json(job);
				if (target.endsWith("/bundle"))
					return stage === "bundle"
						? new Response(marker)
						: Response.json(bundle);
				if (target.endsWith("/api/chat")) {
					modelCalls++;
					if (
						stage === "legacy-envelope" ||
						stage === "native-envelope" ||
						(stage === "final-envelope" && modelCalls === 2)
					)
						return new Response(marker);
					return Response.json(
						nativeReply(
							stage === "final-content" || stage === "fail"
								? marker
								: modelCalls === 1
									? "Ready"
									: "{}",
							stage === "context" ? [readCall()] : undefined,
						),
					);
				}
				if (target.endsWith("/context") || target.endsWith("/complete"))
					return new Response(marker);
				if (target.endsWith("/fail")) {
					failedJob = JSON.parse(request.body);
					return stage === "fail"
						? new Response(marker)
						: Response.json({ updated: true });
				}
				throw new Error("Unexpected privacy fixture request");
			},
		});
		try {
			result = await run();
		} catch (error) {
			rejection = error;
		}
		assert.ok(
			!inspect({ failedJob, result, rejection }).includes(marker),
			stage,
		);
		assert.equal(rejection?.cause, undefined);
		assert.match(
			result?.error ?? rejection?.message,
			/^Invalid (?:local model|worker)/,
			stage,
		);
		if (stage !== "claim") assert.equal(failedJob.token, claim.token);
	}
});

test("watch logs fixed diagnostics for malformed native final, claim and authentication JSON", async () => {
	const marker = "pv_7F2k9";
	for (const stage of ["claim", "model", "authentication"]) {
		const stop = new AbortController(),
			logs = [],
			bundle = agentBundle(),
			savedFetch = globalThis.fetch;
		globalThis.fetch = async () => new Response(marker);
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
								? new Response(marker)
								: Response.json({
										...claim,
										user: "{}",
										protocolVersion: 2,
										task: "pr_resolution",
										bundleHash: bundle.hash,
										bundleVersion: bundle.version,
										schema: actionSchema(),
									});
						if (target.endsWith("/bundle")) return Response.json(bundle);
						if (target.endsWith("/api/chat"))
							return Response.json(nativeReply(marker));
						if (target.endsWith("/fail"))
							return Response.json({ updated: true });
						throw new Error("Unexpected watch fixture request");
					},
				},
			);
		} finally {
			globalThis.fetch = savedFetch;
		}
		assert.ok(!inspect(logs).includes(marker));
		assert.match(inspect(logs), /Invalid (?:worker|local model)/);
	}
});

test("real CLI preserves native tool history, typed final format and private evidence", async () => {
	const marker = "pv_native_private_1",
		bundle = agentBundle();
	const result = { outcome: "unchanged", summary: "Checked", responses: [] };
	const fixture = {
		bundle,
		job: {
			...claim,
			model: "configured-cli-model",
			user: JSON.stringify({ evidence: marker }),
			protocolVersion: 2,
			task: "pr_resolution",
			bundleHash: bundle.hash,
			bundleVersion: bundle.version,
			schema: actionSchema(),
		},
		receipt: { hash: "f".repeat(64) },
		marker,
		result,
	};
	const bootstrap = `data:text/javascript,${encodeURIComponent(`
import assert from 'node:assert/strict';
const fixture = JSON.parse(process.env.CONTRIBUTION_NATIVE_CLI_FIXTURE);
// Reversing object property order must preserve the complete schema semantics.
const expectedFormat = Object.fromEntries(Object.entries(fixture.job.schema.oneOf[0].properties.result).reverse());
let models = 0, completed = false;
globalThis.fetch = async (url, request) => {
  const path = new URL(url).pathname, body = JSON.parse(request.body);
  if (path.endsWith('/claim')) return Response.json(fixture.job);
  if (path.endsWith('/bundle')) return Response.json(fixture.bundle);
  if (path.endsWith('/context')) return Response.json({receipt:fixture.receipt,data:{text:fixture.marker},schema:fixture.job.schema});
  if (path.endsWith('/api/chat')) {
    if (body.keep_alive === 0 && body.messages.length === 0) {
      if (!completed || body.model !== 'configured-cli-model' || body.tools || body.format) throw Error('Invalid model release');
      console.log('native_release_verified'); return Response.json({done:true,done_reason:'unload'});
    }
    models++;
    if (!/^[1-9][0-9]*ms$/.test(body.keep_alive) || Number.parseInt(body.keep_alive,10)>120000) throw Error('Invalid model residency');
    if (models===2 && (body.messages.at(-1).role!=='tool' || !body.messages.at(-1).content.includes(fixture.marker))) throw Error('Native history was lost');
    if (models===3) {
      if (body.tools) throw Error('Typed format was changed');
      assert.deepEqual(body.format, expectedFormat);
    }
    return Response.json({done:true,done_reason:'stop',prompt_eval_count:100,model:'untrusted-provider-model',message:{role:'assistant',content:models<=2?'':JSON.stringify(fixture.result),...(models<=2?{tool_calls:[{id:models===1?'one':'two',function:{name:'discussion',arguments:{}}}]}:{})}});
  }
  if (path.endsWith('/complete')) {
    if(models!==3 || body.receipts.length!==2 || JSON.parse(body.content).outcome!=='unchanged') throw Error('Invalid native completion');
    completed = true;console.log('native_fixture_verified');return Response.json({prIds:[]});
  }
  if (path.endsWith('/fail')) return Response.json({updated:true});
  throw Error('Unexpected CLI fixture route');
};`)}`;
	const { stdout, stderr } = await promisify(execFile)(
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
				CONTRIBUTION_NATIVE_CLI_FIXTURE: JSON.stringify(fixture),
			},
		},
	);
	assert.match(stdout, /native_fixture_verified/);
	assert.match(stdout, /native_release_verified/);
	assert.match(stdout, /completed/);
	assert.ok(!`${stdout}${stderr}`.includes(marker));
});

test("real CLI receives typed error feedback, executes the model's next read and keeps private evidence out of logs", async () => {
	const bundle = agentBundle(),
		marker = "pv_recoverable_cli_private";
	const fixture = {
		bundle,
		marker,
		error: readRejection(),
		job: {
			...claim,
			model: "configured-cli-model",
			user: JSON.stringify({ evidence: marker }),
			protocolVersion: 2,
			task: "pr_resolution",
			bundleHash: bundle.hash,
			bundleVersion: bundle.version,
			schema: actionSchema(),
		},
	};
	const bootstrap = `data:text/javascript,${encodeURIComponent(`
import assert from 'node:assert/strict';
const fixture = JSON.parse(process.env.CONTRIBUTION_RECOVERABLE_CLI_FIXTURE);
const expectedFormat = Object.fromEntries(Object.entries(fixture.job.schema.oneOf[0].properties.result).reverse());
let models = 0, reads = 0, completed = false;
globalThis.fetch = async (url, request) => {
 const path = new URL(url).pathname, body = JSON.parse(request.body);
 if(path.endsWith('/claim')) return Response.json(fixture.job);
 if(path.endsWith('/bundle')) return Response.json(fixture.bundle);
 if(path.endsWith('/context')) {
   reads++;
   if(body.receipts.length || body.arguments.cursor !== (reads===1?-1:0) || models!==reads) throw Error('Read was automatically changed or retried');
   return Response.json(reads===1 ? fixture.error : {receipt:{id:'earned'},data:{text:fixture.marker},schema:fixture.job.schema});
 }
 if(path.endsWith('/api/chat')) {
   if(body.keep_alive===0 && body.messages.length===0) {
     if(!completed || body.model!=='configured-cli-model') throw Error('Invalid cleanup');
     console.log('recoverable_release_verified'); return Response.json({done:true,done_reason:'unload'});
   }
   models++;
   if(models===2) {
     const feedback=JSON.parse(body.messages.at(-1).content);
     if(feedback.error?.type!==fixture.error.error.type || feedback.error.code!==fixture.error.error.code || feedback.error.message!==fixture.error.error.message) throw Error('Actual error feedback missing');
   }
   if(models===3 && !body.messages.at(-1).content.includes(fixture.marker)) throw Error('Actual successful read missing');
   if(models===4) {
     if(body.tools) throw Error('Final schema was changed');
     assert.deepEqual(body.format, expectedFormat);
   }
   return Response.json({done:true,prompt_eval_count:100,message:{role:'assistant',content:models<=2?'':models===3?'Ready':'{"outcome":"unchanged"}',...(models<=2?{tool_calls:[{id:models===1?'invalid':'valid',function:{name:'discussion',arguments:{cursor:models===1?-1:0}}}]}:{})}});
 }
 if(path.endsWith('/complete')) {
   if(models!==4 || reads!==2) throw Error('Invalid receipt/progress boundary');
   assert.deepEqual(body.receipts, [{id:'earned'}]);
   completed=true; console.log('recoverable_cli_verified'); return Response.json({prIds:[]});
 }
 if(path.endsWith('/fail')) return Response.json({updated:true});
 throw Error('Unexpected fixture route');
};`)}`;
	const { stdout, stderr } = await promisify(execFile)(
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
				CONTRIBUTION_RECOVERABLE_CLI_FIXTURE: JSON.stringify(fixture),
			},
		},
	);
	assert.match(stdout, /recoverable_cli_verified/);
	assert.match(stdout, /recoverable_release_verified/);
	assert.match(stdout, /completed/);
	assert.ok(!`${stdout}${stderr}`.includes(marker));
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
