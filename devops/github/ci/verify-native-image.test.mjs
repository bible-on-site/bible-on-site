import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertAdminDocumentGuard,
	assertAdminResponses,
	parseOptions,
	verifyImage,
} from "./verify-native-image.mjs";

const apiOptions = [
	"--service",
	"api",
	"--image",
	"validation-api:arm64",
	"--arch",
	"arm64",
];
test("API owns its database and refuses external URLs before Docker", async () => {
	assert.equal(parseOptions(apiOptions).service, "api");
	for (const value of [
		"mysql://root:p@database.internal/native_image_smoke",
		"mysql://root:p@127.0.0.1/native_image_smoke",
	]) {
		assert.throws(
			() => parseOptions([...apiOptions, "--db-url", value]),
			/Unknown option/,
		);
		await assert.rejects(
			verifyImage(
				{ service: "api", image: "test", arch: "arm64", "db-url": value },
				{
					docker() {
						throw new Error("must not touch Docker");
					},
				},
			),
			/external DB URLs are forbidden/,
		);
	}
});

test("unsupported architectures or misspelled options cannot silently skip checks", () => {
	assert.throws(() =>
		parseOptions(["--service", "api", "--image", "test", "--arch", "aarch64"]),
	);
	assert.throws(() =>
		parseOptions([
			"--service",
			"website",
			"--image",
			"test",
			"--arch",
			"arm64",
			"--skip-native",
		]),
	);
});

test("admin checks the actual SSO redirect and server-function protection", () => {
	const location = new URL("https://login.example.invalid/oauth2/authorize");
	location.searchParams.set("client_id", "native-smoke");
	location.searchParams.set("identity_provider", "AWSSSO");
	location.searchParams.set(
		"redirect_uri",
		"http://127.0.0.1:3101/auth/callback",
	);
	const result = {
		status: 302,
		location: location.href,
		serverFnStatus: 401,
		serverFnBody: "SESSION_EXPIRED: admin session expired",
	};
	assertAdminResponses(result);
	assert.throws(() => assertAdminResponses({ ...result, status: 200 }));
	assert.throws(() => assertAdminResponses({ ...result, serverFnStatus: 200 }));
	assert.throws(() =>
		assertAdminResponses({ ...result, location: "https://unrelated.invalid/" }),
	);
});

test("admin document paths must redirect to the Cognito login", () => {
	const login = new URL("https://login.example.invalid/oauth2/authorize");
	login.searchParams.set("redirect_uri", "http://127.0.0.1:3101/auth/callback");
	const result = {
		documentStatus: 302,
		documentLocation: login.href,
		missingStatus: 302,
		missingLocation: login.href,
	};
	assertAdminDocumentGuard(result);
	assert.throws(() =>
		assertAdminDocumentGuard({ ...result, documentStatus: 200 }),
	);
	assert.throws(() =>
		assertAdminDocumentGuard({ ...result, missingStatus: 404 }),
	);
	assert.throws(() =>
		assertAdminDocumentGuard({ ...result, documentLocation: null }),
	);
	assert.throws(() =>
		assertAdminDocumentGuard({
			...result,
			missingLocation: "https://unrelated.invalid/",
		}),
	);
});

const adminDockerSuccess = (commands, documentStatus) => (args) => {
	commands.push(args);
	if (args[0] === "image")
		return JSON.stringify({
			Os: "linux",
			Architecture: "arm64",
			Id: "sha256:test",
		});
	if (args[0] === "exec" && args[2] === "uname") return "aarch64";
	if (args[0] === "run" && args.includes("--rm")) {
		const script = args[args.indexOf("-e") + 1];
		const host = script.match(/http:\/\/([^:/]+):3101\//)[1];
		const location = new URL(
			"https://login.example.invalid/oauth2/authorize",
		);
		location.searchParams.set("client_id", "native-smoke");
		location.searchParams.set("identity_provider", "AWSSSO");
		location.searchParams.set(
			"redirect_uri",
			`http://${host}:3101/auth/callback`,
		);
		return JSON.stringify({
			status: 302,
			location: location.href,
			serverFnStatus: 401,
			serverFnBody: "SESSION_EXPIRED: admin session expired",
			documentStatus: documentStatus ?? 302,
			documentLocation: location.href,
			missingStatus: 302,
			missingLocation: location.href,
		});
	}
	return "";
};

const adminFixture = (commands) => () => ({
	network: "fixture-network",
	databaseUrl: "mysql://root:x@db:3306/native_image_smoke",
	cleanup() {
		// The fixture must outlive the smoke container that uses its network.
		assert.equal(commands.at(-1)[0], "rm");
	},
});

test("admin verifies auth probes plus the isolated MySQL document read", async () => {
	const commands = [];
	const evidence = await verifyImage(
		{ service: "admin", image: "test", arch: "arm64" },
		{
			runnerArch: "arm64",
			runnerPlatform: "linux",
			createAdminFixture: adminFixture(commands),
			docker: adminDockerSuccess(commands),
		},
	);
	assert.equal(evidence.service, "admin");
	assert.equal(evidence.auth.documentStatus, 302);
	const run = commands.find((args) => args[0] === "run");
	assert.equal(run[run.indexOf("--network") + 1], "fixture-network");
	assert.ok(
		run.includes("DB_URL=mysql://root:x@db:3306/native_image_smoke"),
		"admin must connect to the owned fixture database",
	);
	const probe = commands.find(
		(args) => args[0] === "run" && args.includes("--rm"),
	);
	assert.equal(
		probe[probe.indexOf("--network") + 1],
		"fixture-network",
		"probe runs in a sibling container, not inside the capped smoke cgroup",
	);
	assert.deepEqual(
		commands.filter((args) => args[0] === "exec").map((args) => args[2]),
		["uname"],
		"only the architecture check may exec into the capped container",
	);
});

test("admin verification fails when a document path serves content anonymously", async (t) => {
	const commands = [];
	t.mock.method(console, "error", () => {});
	await assert.rejects(
		verifyImage(
			{ service: "admin", image: "test", arch: "arm64" },
			{
				runnerArch: "arm64",
				runnerPlatform: "linux",
				createAdminFixture: adminFixture(commands),
				docker: adminDockerSuccess(commands, 200),
			},
		),
		assert.AssertionError,
	);
});

test("wrong image architecture fails before any container starts", async () => {
	const commands = [];
	await assert.rejects(
		verifyImage(
			{ service: "admin", image: "test", arch: "arm64" },
			{
				docker(args) {
					commands.push(args);
					return JSON.stringify({
						Os: "linux",
						Architecture: "amd64",
						Id: "sha256:test",
					});
				},
				runnerArch: "arm64",
				runnerPlatform: "linux",
			},
		),
		/Image metadata must match/,
	);
	assert.equal(commands.length, 1);
});

test("emulated ARM execution is never reported as a native ARM runner", async () => {
	await assert.rejects(
		verifyImage(
			{ service: "website", image: "test", arch: "arm64" },
			{
				runnerArch: "x64",
				runnerPlatform: "linux",
				docker() {
					throw new Error("must fail before Docker");
				},
			},
		),
		/native runner/,
	);
});

test("failed container startup retains logs and cleans up the isolated container", async (t) => {
	const commands = [];
	let fixtureCleaned = false;
	t.mock.method(console, "error", () => {});
	await assert.rejects(
		verifyImage(
			{ service: "admin", image: "test", arch: "arm64" },
			{
				runnerArch: "arm64",
				runnerPlatform: "linux",
				createAdminFixture: async () => ({
					network: "fixture-network",
					databaseUrl: "mysql://root:x@db:3306/native_image_smoke",
					cleanup() {
						assert.equal(commands.at(-1)[0], "rm");
						fixtureCleaned = true;
					},
				}),
				docker(args) {
					commands.push(args);
					if (args[0] === "image")
						return JSON.stringify({
							Os: "linux",
							Architecture: "arm64",
							Id: "sha256:test",
						});
					if (args[0] === "exec" && args[2] === "uname") return "aarch64";
					if (args[0] === "run" && args.includes("--rm"))
						throw new Error("connection refused");
					if (args[0] === "inspect") return "false";
					return "";
				},
			},
		),
		/Container exited/,
	);
	assert.ok(commands.some((args) => args[0] === "logs"));
	assert.equal(commands.at(-1)[0], "rm");
	assert.ok(fixtureCleaned);
	const run = commands.find((args) => args[0] === "run");
	assert.equal(run[run.indexOf("--network") + 1], "fixture-network");
	assert.ok(run.includes("DB_URL=mysql://root:x@db:3306/native_image_smoke"));
	assert.equal(run[run.indexOf("--cpus") + 1], "0.25");
	assert.equal(run[run.indexOf("--memory") + 1], "512m");
});

test("only API accepts an explicit exact expected version", () => {
	assert.equal(
		parseOptions([...apiOptions, "--expected-version", "0.1.96"])[
			"expected-version"
		],
		"0.1.96",
	);
	for (const invalid of ["1.2", "01.2.3", "1.2.3-beta", "master"]) {
		assert.throws(
			() => parseOptions([...apiOptions, "--expected-version", invalid]),
			/plain major.minor.patch/,
		);
	}
	assert.throws(
		() =>
			parseOptions([
				"--service",
				"admin",
				"--image",
				"validation",
				"--arch",
				"arm64",
				"--expected-version",
				"1.2.3",
			]),
		/Only API/,
	);
});
