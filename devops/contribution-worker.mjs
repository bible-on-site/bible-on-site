import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const API_TIMEOUT = 30000;
const MODEL_TIMEOUT = 120000;
const FINAL_RESERVE = 45000;
const MODEL_CONTEXT = 16384;
const MODEL_OUTPUT = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const loopback = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
const adminHosts = new Set(["admin.xn--febl3a.co.il", "admin.xn--febl3a.com"]);
// Public account identifier used to reject worker authentication in the wrong account.
const AWS_ACCOUNT = "250598594267", // nosemgrep: generic.secrets.security.detected-aws-account-id.detected-aws-account-id
	AWS_REGION = "il-central-1";
const executeFile = promisify(execFile);
export const CONTRIBUTION_WORKER_RUNTIME_VERSION = "tanahpedia-worker-v7";
const workerTasks = ["issue_implementation", "pr_resolution"];
function parseJson(content, message) {
	try {
		return JSON.parse(content);
	} catch (error) {
		// Parser errors can contain private input. Keep only a fixed diagnostic.
		if (error instanceof SyntaxError) throw new Error(message);
		throw error;
	}
}
async function readJson(response, message) {
	try {
		return await response.json();
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(message);
		throw error;
	}
}
const canonical = (value) =>
	Array.isArray(value)
		? `[${value.map(canonical).join(",")}]`
		: value !== null && typeof value === "object"
			? `{${Object.entries(value)
					.filter(([, v]) => v !== undefined)
					.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
					.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
					.join(",")}}`
			: JSON.stringify(value);

const object = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const readArgumentMessages = {
	invalid_arguments:
		"The read tool arguments are invalid. Use only its declared fields, kinds and page limits.",
	invalid_article_id:
		"Use the numeric article ID from currentRecords or an article lookup. A PR or discussion UUID is not an article ID.",
};
function readArgumentError(value) {
	if (!object(value) || !Object.hasOwn(value, "error")) return null;
	const error = value.error;
	if (
		canonical(Object.keys(value)) !== '["error"]' ||
		!object(error) ||
		canonical(Object.keys(error).sort()) !== '["code","message","type"]' ||
		error.type !== "invalid_tool_arguments" ||
		typeof error.code !== "string" ||
		!Object.hasOwn(readArgumentMessages, error.code) ||
		error.message !== readArgumentMessages[error.code]
	)
		throw new Error("Invalid agent context response");
	return value;
}

/** Preserve the full server schema, including unions and limits that native
 * tool parameter decoders may discard. Final results use the format path. */
function agentResultSchema(schema) {
	if (
		!object(schema) ||
		schema.type !== "object" ||
		!Array.isArray(schema.oneOf)
	)
		throw new Error("Invalid worker result schema");
	const branches = schema.oneOf.filter(
		(branch) => branch?.properties?.action?.const === "complete",
	);
	const branch = branches[0];
	if (
		branches.length !== 1 ||
		branch.type !== "object" ||
		branch.additionalProperties !== false ||
		!Array.isArray(branch.required) ||
		canonical([...branch.required].sort()) !== '["action","result"]' ||
		canonical(Object.keys(branch.properties).sort()) !==
			'["action","result"]' ||
		!object(branch.properties.result) ||
		branch.properties.result.type !== "object" ||
		!Array.isArray(branch.properties.result.oneOf) ||
		!branch.properties.result.oneOf.length
	)
		throw new Error("Invalid worker result schema");
	return branch.properties.result;
}

function nativeModelMessage(body, bundle) {
	if (body?.prompt_eval_count >= MODEL_CONTEXT)
		throw new Error(
			"Agent context reached the model window; no result was applied",
		);
	if (body?.done_reason === "length")
		throw new Error(
			"Local model reached its output limit; no result was applied",
		);
	const message = body?.message;
	if (
		!object(body) ||
		body.done !== true ||
		!Number.isSafeInteger(body.prompt_eval_count) ||
		body.prompt_eval_count < 0 ||
		!object(message) ||
		message.role !== "assistant" ||
		typeof message.content !== "string" ||
		canonical(message).length > 100000 ||
		(message.thinking !== undefined && typeof message.thinking !== "string") ||
		(message.tool_calls !== undefined && !Array.isArray(message.tool_calls))
	)
		throw new Error("Invalid local model response");
	const calls = message.tool_calls ?? [];
	const ids = new Set();
	for (const call of calls) {
		if (
			!object(call) ||
			!object(call.function) ||
			!bundle.tools.some((tool) => tool.name === call.function.name) ||
			!object(call.function.arguments) ||
			(call.id !== undefined &&
				(typeof call.id !== "string" ||
					!call.id.trim() ||
					call.id.length > 255 ||
					ids.has(call.id)))
		)
			throw new Error("Invalid local model tool call");
		if (call.id !== undefined) ids.add(call.id);
	}
	if (!calls.length && !message.content.trim())
		throw new Error("Invalid local model response");
	return message;
}

function nativeAgentSystem(bundle) {
	return [
		bundle.system.replace(
			"Return JSON matching the supplied action schema.",
			"Use the supplied native read functions to obtain missing context; the final proposal uses a separately constrained result schema.",
		),
		"Operation guide:",
		...bundle.operationGuide,
		"Transport: use native function calls for reads. Do not invent IDs or substitute another operation because a target has not been read. When no further reads are needed, give a brief readiness response; the next phase requests the typed final result. Read functions cannot write, approve or merge.",
		"Tool records arrays omit only records identical to their latest value already supplied in currentRecords or earlier tool messages. Reuse those earlier values; omission is never deletion. Changed records are supplied again. Text, citations, discussions and page cursors are retained in full.",
	].join("\n");
}

/** Omit only repeated record values, never source pages or human feedback.
 * Compare with the latest value so A -> B -> A remains an explicit update. */
function recordDeltas(records, latest) {
	return records.filter((record) => {
		if (
			!object(record) ||
			typeof record.kind !== "string" ||
			!(typeof record.id === "string" || typeof record.id === "number") ||
			canonical(Object.keys(record).sort()) !== '["current","id","kind"]'
		)
			return true;
		const key = canonical([record.kind, record.id]);
		const value = canonical(record.current);
		const unchanged = latest.has(key) && latest.get(key) === value;
		latest.set(key, value);
		return !unchanged;
	});
}

export function validateWorkerBundle(value, expectedHash) {
	if (
		value?.protocolVersion !== 2 ||
		typeof value.version !== "string" ||
		!Number.isSafeInteger(value.apiVersion) ||
		typeof value.system !== "string" ||
		!Array.isArray(value.operationGuide) ||
		value.operationGuide.some((guide) => typeof guide !== "string") ||
		!Array.isArray(value.tools) ||
		value.tools.some(
			(tool) =>
				!tool ||
				typeof tool.name !== "string" ||
				typeof tool.description !== "string" ||
				!object(tool.inputSchema) ||
				tool.inputSchema.type !== "object",
		) ||
		new Set(value.tools.map((tool) => tool.name)).size !== value.tools.length
	)
		throw new Error("Invalid agent bundle");
	const { hash, ...payload } = value;
	if (
		hash !== expectedHash ||
		createHash("sha256").update(canonical(payload)).digest("hex") !== hash
	)
		throw new Error("Agent bundle hash mismatch");
	return value;
}

export async function workerAwsCredentials(profile, { call } = {}) {
	const aws =
		call ??
		(async (args) => {
			try {
				const { stdout } = await executeFile(
					"aws",
					[
						...args,
						"--profile",
						profile,
						"--region",
						AWS_REGION,
						"--output",
						"json",
					],
					{
						timeout: API_TIMEOUT,
						maxBuffer: 1048576,
						windowsHide: true,
						env: { ...process.env, AWS_CLI_OUTPUT_ENCODING: "UTF-8" },
					},
				);
				return JSON.parse(stdout);
			} catch {
				throw new Error(
					"AWS SSO credentials are unavailable for worker authentication",
				);
			}
		});
	const identity = await aws(["sts", "get-caller-identity"]);
	if (identity.Account !== AWS_ACCOUNT)
		throw new Error(
			"Worker authentication requires the Tanahpedia AWS account",
		);
	const services = await aws([
		"ecs",
		"describe-services",
		"--cluster",
		"bible-on-site-cluster",
		"--services",
		"bible-on-site-admin",
	]);
	const definition = services.services?.find(
		(service) => service.serviceName === "bible-on-site-admin",
	)?.taskDefinition;
	if (
		typeof definition !== "string" ||
		!definition.startsWith(
			`arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT}:task-definition/bible-on-site-admin:`,
		)
	)
		throw new Error(
			"Unexpected admin task definition during worker authentication",
		);
	const task = await aws([
		"ecs",
		"describe-task-definition",
		"--task-definition",
		definition,
	]);
	const container = task.taskDefinition?.containerDefinitions?.find(
		(item) => item.name === "admin",
	);
	const variables = Object.fromEntries(
		(container?.environment ?? []).map((item) => [item.name, item.value]),
	);
	const pool = variables.COGNITO_USER_POOL_ID,
		client = variables.COGNITO_SERVICE_CLIENT_ID,
		domain = variables.COGNITO_DOMAIN;
	if (
		typeof pool !== "string" ||
		!pool.startsWith(`${AWS_REGION}_`) ||
		typeof client !== "string" ||
		typeof domain !== "string"
	)
		throw new Error("Admin worker authentication is not configured");
	const response = await aws([
		"cognito-idp",
		"describe-user-pool-client",
		"--user-pool-id",
		pool,
		"--client-id",
		client,
	]);
	const configuration = response.UserPoolClient;
	if (
		!configuration?.ClientSecret ||
		!configuration.AllowedOAuthScopes?.includes("admin-api/contributions")
	)
		throw new Error(
			"The Cognito service client does not allow the worker-only scope",
		);
	return {
		COGNITO_DOMAIN: domain,
		COGNITO_SERVICE_CLIENT_ID: client,
		COGNITO_SERVICE_CLIENT_SECRET: configuration.ClientSecret,
	};
}

export function workerOptions(args, env = process.env) {
	const options = {
		origin: env.CONTRIBUTION_ADMIN_ORIGIN || "https://admin.xn--febl3a.co.il",
		ollama: env.LOCAL_LLM_URL || "http://127.0.0.1:11434",
		model: env.LOCAL_LLM_MODEL || "qwen3:8b",
		workerId: env.CONTRIBUTION_WORKER_ID || hostname(),
		profile: env.CONTRIBUTION_AWS_PROFILE || "AdministratorAccess-250598594267",
		watch: false,
		dev: false,
		issueId: undefined,
	};
	const flags = {
		"--origin": "origin",
		"--ollama": "ollama",
		"--model": "model",
		"--worker-id": "workerId",
		"--issue": "issueId",
		"--aws-profile": "profile",
	};
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--watch") options.watch = true;
		else if (args[i] === "--once") options.watch = false;
		else if (args[i] === "--dev") options.dev = true;
		else if (flags[args[i]] && args[i + 1] && !args[i + 1].startsWith("--"))
			options[flags[args[i]]] = args[++i];
		else
			throw new Error(
				"Use --watch/--once, --origin, --ollama, --model, --worker-id, --issue, or --dev",
			);
	}
	const origin = new URL(options.origin),
		ollama = new URL(options.ollama);
	if (
		origin.username ||
		origin.password ||
		origin.search ||
		origin.hash ||
		origin.pathname !== "/" ||
		(origin.protocol !== "https:" &&
			!(
				options.dev &&
				origin.protocol === "http:" &&
				loopback(origin.hostname)
			))
	)
		throw new Error(
			"Admin origin must use HTTPS; --dev permits loopback HTTP only",
		);
	if (options.dev && !loopback(origin.hostname))
		throw new Error(
			"Development workers are restricted to loopback admin origins",
		);
	if (!options.dev && !adminHosts.has(origin.hostname))
		throw new Error(
			"Use the Tanahpedia admin origin; --dev permits a loopback test server",
		);
	if (
		!["http:", "https:"].includes(ollama.protocol) ||
		ollama.username ||
		ollama.password
	)
		throw new Error("Ollama URL must use HTTP(S) without credentials");
	if (
		!options.model.trim() ||
		options.model.length > 255 ||
		!options.workerId.trim() ||
		options.workerId.length > 128
	)
		throw new Error("A bounded model name and worker ID are required");
	if (options.issueId && !UUID.test(options.issueId))
		throw new Error("--issue requires a UUID");
	return { ...options, origin: origin.origin, ollama: ollama.href };
}

/** A dedicated Cognito service client supplies short-lived access tokens.
 * Secrets stay in this process; neither tokens nor response bodies are logged. */
export function workerTokenProvider(
	env = process.env,
	{ request = fetch, now = Date.now, credentials = workerAwsCredentials } = {},
) {
	let cached,
		expiresAt = 0;
	return async () => {
		if (env.CONTRIBUTION_WORKER_ACCESS_TOKEN)
			return env.CONTRIBUTION_WORKER_ACCESS_TOKEN;
		if (cached && now() < expiresAt) return cached;
		const settings =
			env.COGNITO_DOMAIN &&
			env.COGNITO_SERVICE_CLIENT_ID &&
			env.COGNITO_SERVICE_CLIENT_SECRET
				? env
				: await credentials(
						env.CONTRIBUTION_AWS_PROFILE || "AdministratorAccess-250598594267",
					);
		const domain = new URL(
			settings.COGNITO_DOMAIN.includes("://")
				? settings.COGNITO_DOMAIN
				: `https://${settings.COGNITO_DOMAIN}`,
		);
		if (domain.protocol !== "https:" || domain.username || domain.password)
			throw new Error(
				"Cognito token requests require HTTPS without URL credentials",
			);
		const response = await request(new URL("/oauth2/token", domain), {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.timeout(API_TIMEOUT),
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "client_credentials",
				client_id: settings.COGNITO_SERVICE_CLIENT_ID,
				client_secret: settings.COGNITO_SERVICE_CLIENT_SECRET,
				scope: "admin-api/contributions",
			}),
		});
		if (!response.ok)
			throw new Error(`Worker authentication failed (${response.status})`);
		const body = await readJson(
			response,
			"Invalid worker authentication response",
		);
		if (
			typeof body.access_token !== "string" ||
			!body.access_token ||
			!Number.isFinite(body.expires_in) ||
			body.expires_in <= 0
		)
			throw new Error("Invalid worker authentication response");
		cached = body.access_token;
		expiresAt = now() + Math.max(0, body.expires_in - 60) * 1000;
		return cached;
	};
}

export function createContributionWorker(
	options,
	{
		request = fetch,
		getToken = workerTokenProvider(),
		log = () => {},
		now = () => performance.now(),
		signal,
	} = {},
) {
	const bundles = new Map();
	async function api(action, body, executionSignal = signal) {
		const token = options.dev ? null : await getToken();
		const timeout = AbortSignal.timeout(API_TIMEOUT);
		const response = await request(
			`${options.origin}/api/contributions/worker/${action}`,
			{
				method: "POST",
				redirect: "error",
				signal:
					executionSignal && action !== "fail"
						? AbortSignal.any([executionSignal, timeout])
						: timeout,
				headers: {
					"Content-Type": "application/json",
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify(body),
			},
		);
		if (!response.ok)
			throw new Error(`Worker ${action} failed (${response.status})`);
		return response.status === 204
			? null
			: readJson(response, `Invalid worker ${action} response`);
	}
	return async () => {
		const job = await api("claim", {
			workerId: options.workerId,
			issueId: options.issueId,
			protocolVersion: 2,
			supportedTasks: workerTasks,
			runtimeVersion: CONTRIBUTION_WORKER_RUNTIME_VERSION,
			bundleHashes: [...bundles.keys()],
		});
		if (!job) return { status: "idle" };
		if (
			!UUID.test(job.id) ||
			!UUID.test(job.issueId) ||
			typeof job.token !== "string" ||
			(job.protocolVersion !== 2 && typeof job.system !== "string") ||
			typeof job.user !== "string" ||
			!job.schema ||
			!Number.isSafeInteger(job.version) ||
			!Number.isSafeInteger(job.apiVersion)
		)
			throw new Error("Invalid worker claim response");
		const identity = {
			issueId: job.issueId,
			jobId: job.id,
			token: job.token,
			version: job.version,
			apiVersion: job.apiVersion,
			...(job.protocolVersion === 2 ? { protocolVersion: 2 } : {}),
		};
		log(
			`${job.protocolVersion === 2 ? (job.task === "pr_resolution" ? "Resolving PR" : "Implementing issue") : "Generating issue"} ${job.issueId} with ${job.model || options.model}`,
		);
		let modelToRelease;
		try {
			if (job.protocolVersion === 2) {
				if (
					!workerTasks.includes(job.task) ||
					typeof job.bundleHash !== "string" ||
					!/^[a-f0-9]{64}$/.test(job.bundleHash)
				)
					throw new Error("Unsupported agent task or bundle");
				let bundle = bundles.get(job.bundleHash);
				if (!bundle) {
					bundle = validateWorkerBundle(
						await api("bundle", { hash: job.bundleHash }),
						job.bundleHash,
					);
					bundles.set(job.bundleHash, bundle);
				}
				if (
					bundle.apiVersion !== job.apiVersion ||
					bundle.version !== job.bundleVersion
				)
					throw new Error("Agent bundle version does not match the task");
				const deadline = now() + MODEL_TIMEOUT,
					timeout = AbortSignal.timeout(MODEL_TIMEOUT),
					executionSignal = signal
						? AbortSignal.any([signal, timeout])
						: timeout;
				const remainingBudget = () => {
					executionSignal.throwIfAborted();
					const remaining = Math.floor(deadline - now());
					if (remaining <= 0)
						throw new DOMException(
							"The operation was aborted due to timeout",
							"TimeoutError",
						);
					return Math.min(MODEL_TIMEOUT, remaining);
				};
				const context = parseJson(job.user, "Invalid worker task context");
				const latestRecords = new Map();
				if (Array.isArray(context?.currentRecords))
					recordDeltas(context.currentRecords, latestRecords);
				const messages = [
					{ role: "system", content: nativeAgentSystem(bundle) },
					{
						role: "user",
						content: canonical({
							task: job.task,
							context,
						}),
					},
				];
				const research = new Map(),
					rejections = new Map(),
					receipts = [],
					tools = bundle.tools.map((tool) => ({
						type: "function",
						function: {
							name: tool.name,
							description: tool.description,
							parameters: tool.inputSchema,
						},
					}));
				let schema = job.schema,
					promptTokens = 0,
					evaluatedMessages = messages.length;
				agentResultSchema(schema);
				const infer = async (history, declaration) => {
					const remaining = remainingBudget();
					modelToRelease = job.model || options.model;
					const response = await request(new URL("/api/chat", options.ollama), {
						method: "POST",
						redirect: "error",
						signal: executionSignal,
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							model: modelToRelease,
							stream: false,
							// Reuse weights and prefix cache within this job. Ollama's
							// idle TTL starts after each response, so it is only a
							// bounded fallback; finally explicitly releases the model.
							keep_alive: `${remaining}ms`,
							think: false,
							truncate: false,
							shift: false,
							options: {
								temperature: 0,
								num_predict: MODEL_OUTPUT,
								num_ctx: MODEL_CONTEXT,
							},
							messages: history,
							...declaration,
						}),
					});
					if (!response.ok)
						throw new Error(`Local model returned HTTP ${response.status}`);
					const body = await readJson(response, "Invalid local model response");
					remainingBudget();
					const message = nativeModelMessage(body, bundle);
					// Ollama reports the full prompt, including cached tokens. Do
					// not subtract cache hits when budgeting the next native turn.
					promptTokens = body.prompt_eval_count;
					evaluatedMessages = history.length;
					return { body, message };
				};
				const finalize = async () => {
					// Native parameter decoding can drop JSON-schema constraints.
					// Only this separate final request receives the full result schema.
					const final = await infer(
						[
							...messages,
							{
								role: "user",
								content:
									"Now return only the final result object matching the supplied JSON response schema. Preserve the original task and all unrequested fields; do not wrap the result in an action object. Ground facts in actual source/tool data and original human feedback, not unverified preliminary research prose. Copy requested verbatim text directly from the original human text rather than your research draft.",
							},
						],
						{ format: agentResultSchema(schema) },
					);
					if (final.message.tool_calls?.length)
						throw new Error("Unexpected tool call during final generation");
					const output = parseJson(
						final.message.content,
						"Invalid local model response",
					);
					if (!object(output)) throw new Error("Invalid local model response");
					remainingBudget();
					const result = await api(
						"complete",
						{
							...identity,
							receipts,
							content: canonical(output),
							model:
								typeof final.body.model === "string"
									? final.body.model
									: job.model || options.model,
						},
						executionSignal,
					);
					return {
						status: "completed",
						issueId: job.issueId,
						prIds: result.prIds,
					};
				};
				while (true) {
					// This reserves time inside the original deadline; it does not
					// cancel, retry or extend an in-flight model request.
					if (remainingBudget() <= FINAL_RESERVE) return await finalize();
					// Reserve output space before extending research. UTF-8 bytes
					// conservatively estimate new text, with room for chat framing;
					// this is not a tokenizer. Finalization retains the full history
					// and drops native tool declarations. Ollama still rejects any
					// overlong prompt/output with truncation and shifting disabled.
					const additions = messages.slice(evaluatedMessages);
					if (
						promptTokens &&
						promptTokens +
							Buffer.byteLength(canonical(additions), "utf8") +
							128 * additions.length +
							MODEL_OUTPUT >=
							MODEL_CONTEXT
					)
						return await finalize();
					const { message } = await infer(messages, { tools });
					messages.push(message);
					if (!message.tool_calls?.length) return await finalize();
					let repeated = true;
					for (const call of message.tool_calls) {
						remainingBudget();
						const read = await api(
							"context",
							{
								...identity,
								receipts,
								name: call.function.name,
								arguments: call.function.arguments,
							},
							executionSignal,
						);
						remainingBudget();
						const query = canonical({
							name: call.function.name,
							arguments: call.function.arguments,
						});
						const rejection = readArgumentError(read);
						let data;
						if (rejection) {
							const fingerprint = canonical(rejection);
							if (rejections.get(query) !== fingerprint) repeated = false;
							rejections.set(query, fingerprint);
							// The actual error is feedback, never a trusted read receipt,
							// catalogue fact or permission to widen the result schema.
							data = rejection;
						} else {
							if (
								!object(read) ||
								!read.receipt ||
								!Object.hasOwn(read, "data")
							)
								throw new Error("Invalid agent context response");
							agentResultSchema(read.schema);
							const facts = createHash("sha256")
								.update(canonical({ data: read.data, schema: read.schema }))
								.digest("hex");
							// Compare the latest facts: A -> B -> A is a current change,
							// even though an older response also contained A.
							if (rejections.delete(query) || research.get(query) !== facts)
								repeated = false;
							research.set(query, facts);
							receipts.push(read.receipt);
							schema = read.schema;
							data =
								object(read.data) && Array.isArray(read.data.records)
									? {
											...read.data,
											records: recordDeltas(read.data.records, latestRecords),
										}
									: read.data;
						}
						messages.push({
							role: "tool",
							tool_name: call.function.name,
							...(call.id !== undefined ? { tool_call_id: call.id } : {}),
							content: canonical(data),
						});
					}
					// Every read still ran and entered history. Only a whole batch
					// adding no new facts/schema or argument feedback ends research.
					if (repeated) return await finalize();
				}
			}
			const timeout = AbortSignal.timeout(MODEL_TIMEOUT);
			const response = await request(new URL("/api/chat", options.ollama), {
				method: "POST",
				redirect: "error",
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: options.model,
					stream: false,
					// Return memory to the user's workstation between queued jobs.
					keep_alive: 0,
					think: false,
					format: job.schema,
					options: { temperature: 0, num_predict: 4096, num_ctx: 16384 },
					messages: [
						{ role: "system", content: job.system },
						{ role: "user", content: job.user },
					],
				}),
			});
			if (!response.ok)
				throw new Error(`Local model returned HTTP ${response.status}`);
			const body = await readJson(response, "Invalid local model response");
			const content = body.message?.content,
				model = typeof body.model === "string" ? body.model : options.model;
			if (
				typeof content !== "string" ||
				!content.trim() ||
				content.length > 100000 ||
				model.length > 255
			)
				throw new Error("Invalid local model response");
			const result = await api("complete", { ...identity, content, model });
			return { status: "completed", issueId: job.issueId, prIds: result.prIds };
		} catch (error) {
			// A failed/late result never writes content. The server persists the
			// failure only when this exact lease still owns the generation job.
			const message =
				error instanceof Error ? error.message : "Local generation failed";
			await api("fail", { ...identity, error: message.slice(0, 1000) });
			return { status: "failed", issueId: job.issueId, error: message };
		} finally {
			if (modelToRelease !== undefined) {
				let confirmed = false;
				try {
					const released = await request(new URL("/api/chat", options.ollama), {
						method: "POST",
						redirect: "error",
						// Cleanup must also run after the shared inference signal
						// aborts. This is the existing I/O bound, not more inference.
						signal: AbortSignal.timeout(API_TIMEOUT),
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							model: modelToRelease,
							messages: [],
							stream: false,
							keep_alive: 0,
						}),
					});
					if (released.ok) {
						const body = await readJson(
							released,
							"Invalid model release response",
						);
						confirmed = body?.done === true && body.done_reason === "unload";
					}
				} catch {
					// Transport/parser details may contain private model content.
				}
				if (!confirmed) {
					try {
						log(
							"Local model release was not confirmed; bounded residency may remain",
						);
					} catch {
						// A broken log sink must also preserve the primary outcome.
					}
				}
			}
		}
	};
}

export async function runContributionWorker(
	args = process.argv.slice(2),
	env = process.env,
	runtime = {},
) {
	const options = workerOptions(args, env);
	const controller = new AbortController();
	const signal = runtime.signal
		? AbortSignal.any([controller.signal, runtime.signal])
		: controller.signal;
	const pause = runtime.pause ?? delay,
		log = runtime.log ?? console.info;
	const run = createContributionWorker(options, {
		getToken: workerTokenProvider({
			...env,
			CONTRIBUTION_AWS_PROFILE: options.profile,
		}),
		log,
		signal,
		...(runtime.request ? { request: runtime.request } : {}),
	});
	const stop = () => controller.abort();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		do {
			let result;
			try {
				result = await run();
			} catch (error) {
				if (signal.aborted) break;
				if (!options.watch) throw error;
				log(
					"Local worker unavailable:",
					error instanceof Error ? error.message : "Request failed",
				);
				await pause(5000, undefined, { signal });
				continue;
			}
			if (result.status !== "idle" || !options.watch)
				log("Local contribution worker:", result);
			if (!options.watch) {
				if (result.status === "failed") process.exitCode = 1;
				break;
			}
			if (result.status === "idle") await pause(5000, undefined, { signal });
		} while (!signal.aborted);
	} catch (error) {
		if (!signal.aborted) throw error;
	} finally {
		process.removeListener("SIGINT", stop);
		process.removeListener("SIGTERM", stop);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		await runContributionWorker();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
