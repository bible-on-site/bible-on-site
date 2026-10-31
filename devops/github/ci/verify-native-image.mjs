// Local/native CI only: no registry publication, AWS credentials, or live DB.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	apiPackageVersion,
	assertPlainVersion,
	verifyApiRuntime,
} from "./verify-api-native.mjs";

export { assertApiResponses } from "./verify-api-native.mjs";

const startupBudgetMs = 30_000;

export function parseOptions(args) {
	const { values } = parseArgs({
		args,
		options: {
			service: { type: "string" },
			image: { type: "string" },
			arch: { type: "string" },
			"expected-version": { type: "string" },
		},
	});
	const { "expected-version": expectedVersion } = values;
	assert.ok(
		["website", "admin", "api"].includes(values.service),
		"--service must be website, admin, or api",
	);
	assert.ok(
		["amd64", "arm64"].includes(values.arch),
		"--arch must be amd64 or arm64",
	);
	assert.ok(
		values.image && !values.image.startsWith("-"),
		"--image is required",
	);
	if (values.service !== "api")
		assert.equal(
			expectedVersion,
			undefined,
			"Only API accepts --expected-version",
		);
	else if (expectedVersion !== undefined) assertPlainVersion(expectedVersion);
	return values;
}

export function assertAdminResponses(result) {
	assert.equal(result.status, 302);
	const location = new URL(result.location);
	assert.equal(location.origin, "https://login.example.invalid");
	assert.equal(location.pathname, "/oauth2/authorize");
	assert.equal(location.searchParams.get("client_id"), "native-smoke");
	assert.equal(location.searchParams.get("identity_provider"), "AWSSSO");
	assert.equal(
		location.searchParams.get("redirect_uri"),
		"http://127.0.0.1:3101/auth/callback",
	);
	assert.equal(result.serverFnStatus, 401);
	assert.match(result.serverFnBody, /^SESSION_EXPIRED:/);
}

function runDocker(args, { input } = {}) {
	return execFileSync("docker", args, {
		encoding: "utf8",
		timeout: 30_000,
		maxBuffer: 4 * 1024 * 1024,
		input,
		stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
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
			const running = docker([
				"inspect",
				"--format",
				"{{.State.Running}}",
				name,
			]);
			assert.equal(
				running,
				"true",
				"Container exited before the startup probe succeeded",
			);
			await sleep(250);
		}
	} while (now() < deadline);
	throw new Error(`Container did not start within ${startupBudgetMs} ms`, {
		cause: lastError,
	});
}

export async function verifyImage(options, dependencies = {}) {
	const docker = dependencies.docker ?? runDocker;
	const now = dependencies.now ?? Date.now;
	const sleep =
		dependencies.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
	const {
		service,
		image,
		arch,
		"expected-version": requestedVersion,
		"db-url": externalDbUrl,
	} = options;
	assert.equal(
		externalDbUrl,
		undefined,
		"API qualification owns its independent MySQL server; external DB URLs are forbidden",
	);
	assert.equal(
		dependencies.runnerArch ?? process.arch,
		arch === "amd64" ? "x64" : "arm64",
		"Host must be a native runner for the requested architecture",
	);
	const metadata = JSON.parse(
		docker(["image", "inspect", "--format", "{{json .}}", image]),
	);
	assert.equal(metadata.Os, "linux");
	assert.equal(
		metadata.Architecture,
		arch,
		"Image metadata must match the native runner",
	);
	const name = `native-smoke-${service}-${randomUUID()}`;
	const common = [
		"run",
		"--name",
		name,
		"--platform",
		`linux/${arch}`,
		"--cpus",
		"0.25",
		"--memory",
		service === "website" ? "2048m" : "512m",
	];
	const evidence = { service, image, arch, imageId: metadata.Id };
	if (service !== "api")
		assert.equal(
			requestedVersion,
			undefined,
			"Only API accepts --expected-version",
		);
	if (service === "api") {
		const expectedVersion =
			requestedVersion ??
			apiPackageVersion(
				readFileSync(
					new URL("../../../web/api/Cargo.toml", import.meta.url),
					"utf8",
				),
			);
		return {
			...evidence,
			...(await verifyApiRuntime({
				docker,
				common,
				image,
				arch,
				expectedVersion,
				now,
				sleep,
				createFixture: dependencies.createFixture,
			})),
		};
	}
	let created = false;
	let failure;
	try {
		if (service === "website") {
			const probe = readFileSync(
				new URL("./verify-website-native.mjs", import.meta.url),
				"utf8",
			);
			created = true;
			const output = docker([
				...common,
				"--network",
				"none",
				"--entrypoint",
				"node",
				image,
				"--input-type=module",
				"-e",
				probe,
				arch,
			]);
			evidence.nativeDependencies = JSON.parse(output.split("\n").at(-1));
		} else {
			const env = [
				"--network",
				"none",
				"-e",
				"SKIP_AUTH=false",
				"-e",
				"COGNITO_USER_POOL_ID=il-central-1_native-smoke",
				"-e",
				"COGNITO_CLIENT_ID=native-smoke",
				"-e",
				"COGNITO_CLIENT_SECRET=fixture-only",
				"-e",
				"COGNITO_DOMAIN=login.example.invalid",
				"-e",
				"AWS_EC2_METADATA_DISABLED=true",
			];
			created = true;
			docker([...common, "--detach", ...env, image]);
			const expected = arch === "amd64" ? "x86_64" : "aarch64";
			assert.equal(docker(["exec", name, "uname", "-m"]), expected);
			const result = await waitForProbe(
				() =>
					JSON.parse(
						docker([
							"exec",
							name,
							"node",
							"--input-type=module",
							"-e",
							adminProbe,
						]),
					),
				docker,
				name,
				now,
				sleep,
			);
			assertAdminResponses(result);
			evidence.auth = result;
		}
	} catch (error) {
		failure = error;
		if (created) {
			try {
				console.error(docker(["logs", name]));
			} catch (logsError) {
				console.error(`Could not read container logs: ${logsError.message}`);
			}
		}
	} finally {
		if (created) {
			try {
				docker(["rm", "--force", name]);
			} catch (cleanupError) {
				console.error(
					`Could not remove smoke container ${name}: ${cleanupError.message}`,
				);
				failure ??= cleanupError;
			}
		}
	}
	if (failure) throw failure;
	return evidence;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		console.log(
			JSON.stringify(
				await verifyImage(parseOptions(process.argv.slice(2))),
				null,
				2,
			),
		);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}
