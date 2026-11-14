import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const API_TIMEOUT = 30000;
const MODEL_TIMEOUT = 120000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const loopback = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
const adminHosts = new Set(["admin.xn--febl3a.co.il", "admin.xn--febl3a.com"]);
const AWS_ACCOUNT = "250598594267",
	AWS_REGION = "il-central-1";
const executeFile = promisify(execFile);

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
						env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
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
		model: env.LOCAL_LLM_MODEL || "qwen3:4b",
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
			/^[a-z][a-z0-9+.-]*:\/\//i.test(settings.COGNITO_DOMAIN)
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
		const body = await response.json();
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
		signal,
	} = {},
) {
	async function api(action, body) {
		const token = options.dev ? null : await getToken();
		const timeout = AbortSignal.timeout(API_TIMEOUT);
		const response = await request(
			`${options.origin}/api/contributions/worker/${action}`,
			{
				method: "POST",
				redirect: "error",
				signal:
					signal && action !== "fail"
						? AbortSignal.any([signal, timeout])
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
		return response.status === 204 ? null : response.json();
	}
	return async () => {
		const job = await api("claim", {
			workerId: options.workerId,
			issueId: options.issueId,
		});
		if (!job) return { status: "idle" };
		if (
			!UUID.test(job.id) ||
			!UUID.test(job.issueId) ||
			typeof job.token !== "string" ||
			typeof job.system !== "string" ||
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
		};
		log(`Generating issue ${job.issueId} with ${options.model}`);
		try {
			const timeout = AbortSignal.timeout(MODEL_TIMEOUT);
			const response = await request(new URL("/api/chat", options.ollama), {
				method: "POST",
				redirect: "error",
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: options.model,
					stream: false,
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
			const body = await response.json();
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
		}
	};
}

export async function runContributionWorker(
	args = process.argv.slice(2),
	env = process.env,
) {
	const options = workerOptions(args, env);
	const controller = new AbortController();
	const run = createContributionWorker(options, {
		getToken: workerTokenProvider({
			...env,
			CONTRIBUTION_AWS_PROFILE: options.profile,
		}),
		log: (message) => console.info(message),
		signal: controller.signal,
	});
	const stop = () => controller.abort();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		do {
			const result = await run();
			console.info("Local contribution worker:", result);
			if (!options.watch) {
				if (result.status === "failed") process.exitCode = 1;
				break;
			}
			if (result.status === "idle")
				await delay(5000, undefined, { signal: controller.signal });
		} while (!controller.signal.aborted);
	} catch (error) {
		if (!controller.signal.aborted) throw error;
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
