// Local/native CI only: no registry publication, AWS credentials, or live DB.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const startupBudgetMs = 30_000;

export function parseOptions(args) {
	const { values } = parseArgs({
		args,
		options: {
			service: { type: "string" },
			image: { type: "string" },
			arch: { type: "string" },
			"db-url": { type: "string" },
		},
	});
	assert.ok(["website", "admin", "api"].includes(values.service), "--service must be website, admin, or api");
	assert.ok(["amd64", "arm64"].includes(values.arch), "--arch must be amd64 or arm64");
	assert.ok(values.image && !values.image.startsWith("-"), "--image is required");
	if (values.service === "api") assertLocalFixture(values["db-url"]);
	else assert.equal(values["db-url"], undefined, "Only the API smoke check accepts --db-url");
	return values;
}

export function assertLocalFixture(value) {
	assert.ok(value, "API smoke requires --db-url for a local native_image_smoke fixture");
	const url = new URL(value);
	assert.equal(url.protocol, "mysql:");
	assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Refusing a non-loopback DB: smoke checks must never use a live database");
	assert.equal(url.pathname, "/native_image_smoke", "Use the disposable native_image_smoke database");
}

export function assertApiResponses(health, graphql) {
	assert.equal(health.status, "ok");
	assert.match(health.version, /^\d+\.\d+\.\d+/, "API must report its compiled version");
	assert.equal(graphql.errors, undefined, "GraphQL fixture query must not return errors");
	assert.equal(graphql.data.__typename, "QueryRoot");
	assert.deepEqual(graphql.data.articlesByPerekId, [], "Empty schema fixture must be queried through MySQL");
}

export function assertAdminResponses(result) {
	assert.equal(result.status, 302);
	const location = new URL(result.location);
	assert.equal(location.origin, "https://login.example.invalid");
	assert.equal(location.pathname, "/oauth2/authorize");
	assert.equal(location.searchParams.get("client_id"), "native-smoke");
	assert.equal(location.searchParams.get("identity_provider"), "AWSSSO");
	assert.equal(location.searchParams.get("redirect_uri"), "http://127.0.0.1:3101/auth/callback");
	assert.equal(result.serverFnStatus, 401);
	assert.match(result.serverFnBody, /^SESSION_EXPIRED:/);
}

function runDocker(args) {
	return execFileSync("docker", args, {
		encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

const adminProbe = `
const r = await fetch('http://127.0.0.1:3101/', { redirect: 'manual', signal: AbortSignal.timeout(2000) });
const f = await fetch('http://127.0.0.1:3101/', { headers: { 'x-tsr-serverFn': 'true' }, redirect: 'manual', signal: AbortSignal.timeout(2000) });
console.log(JSON.stringify({ status: r.status, location: r.headers.get('location'), serverFnStatus: f.status, serverFnBody: await f.text() }));
`;

// A single fixed budget catches a startup regression; it is not a production
// readiness claim or a substitute for the separately approved Fargate canary.
async function waitForProbe(probe, docker, name, now, sleep) {
	const deadline = now() + startupBudgetMs;
	let lastError;
	do {
		try {
			return probe();
		} catch (error) {
			lastError = error;
			const running = docker(["inspect", "--format", "{{.State.Running}}", name]);
			assert.equal(running, "true", "Container exited before the startup probe succeeded");
			await sleep(250);
		}
	} while (now() < deadline);
	throw new Error(`Container did not start within ${startupBudgetMs} ms`, { cause: lastError });
}

export async function verifyImage(options, dependencies = {}) {
	const docker = dependencies.docker ?? runDocker;
	const now = dependencies.now ?? Date.now;
	const sleep = dependencies.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
	const { service, image, arch } = options;
	assert.equal(dependencies.runnerArch ?? process.arch, arch === "amd64" ? "x64" : "arm64", "Host must be a native runner for the requested architecture");
	if (service === "api") assertLocalFixture(options["db-url"]);
	const metadata = JSON.parse(docker(["image", "inspect", "--format", "{{json .}}", image]));
	assert.equal(metadata.Os, "linux");
	assert.equal(metadata.Architecture, arch, "Image metadata must match the native runner");
	const name = `native-smoke-${service}-${randomUUID()}`;
	const common = ["run", "--name", name, "--platform", `linux/${arch}`, "--cpus", "0.25", "--memory", service === "website" ? "2048m" : "512m"];
	const evidence = { service, image, arch, imageId: metadata.Id };
	let created = false;
	let failed = false;
	try {
		if (service === "website") {
			const probe = readFileSync(new URL("./verify-website-native.mjs", import.meta.url), "utf8");
			created = true;
			const output = docker([...common, "--network", "none", "--entrypoint", "node", image, "--input-type=module", "-e", probe, arch]);
			evidence.nativeDependencies = JSON.parse(output.split("\n").at(-1));
		} else {
			const env = service === "admin" ? [
				"--network", "none", "-e", "SKIP_AUTH=false",
				"-e", "COGNITO_USER_POOL_ID=il-central-1_native-smoke",
				"-e", "COGNITO_CLIENT_ID=native-smoke",
				"-e", "COGNITO_CLIENT_SECRET=fixture-only",
				"-e", "COGNITO_DOMAIN=login.example.invalid",
				"-e", "AWS_EC2_METADATA_DISABLED=true",
			] : [
				"--network", "host", "-e", "PROFILE=prod", "-e", "HOST=127.0.0.1",
				"-e", "PORT=3003", "-e", `DB_URL=${options["db-url"]}`,
			];
			created = true;
			docker([...common, "--detach", ...env, image]);
			const expected = arch === "amd64" ? "x86_64" : "aarch64";
			assert.equal(docker(["exec", name, "uname", "-m"]), expected);
			if (service === "admin") {
				const result = await waitForProbe(() => JSON.parse(docker(["exec", name, "node", "--input-type=module", "-e", adminProbe])), docker, name, now, sleep);
				assertAdminResponses(result);
				evidence.auth = result;
			} else {
				const health = await waitForProbe(() => JSON.parse(docker(["exec", name, "wget", "-T", "2", "-qO-", "http://127.0.0.1:3003/health"])), docker, name, now, sleep);
				const graphql = JSON.parse(docker(["exec", name, "wget", "-T", "2", "-qO-", "--header=Content-Type: application/json", '--post-data={"query":"query { __typename articlesByPerekId(perekId: 1) { id } }"}', "http://127.0.0.1:3003/"]));
				assertApiResponses(health, graphql);
				evidence.health = health;
				evidence.graphql = graphql;
			}
		}
		return evidence;
	} catch (error) {
		failed = true;
		if (created) {
			try { console.error(docker(["logs", name])); }
			catch (logsError) { console.error(`Could not read container logs: ${logsError.message}`); }
		}
		throw error;
	} finally {
		if (created) {
			try { docker(["rm", "--force", name]); }
			catch (cleanupError) {
				console.error(`Could not remove smoke container ${name}: ${cleanupError.message}`);
				if (!failed) throw cleanupError;
			}
		}
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		console.log(JSON.stringify(await verifyImage(parseOptions(process.argv.slice(2))), null, 2));
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}
