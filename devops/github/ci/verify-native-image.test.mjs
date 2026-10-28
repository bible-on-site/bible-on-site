import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAdminResponses, assertApiResponses, assertLocalFixture, parseOptions, verifyImage } from "./verify-native-image.mjs";

const apiOptions = ["--service", "api", "--image", "validation-api:arm64", "--arch", "arm64"];
const fixture = "mysql://root:test_123@127.0.0.1:3306/native_image_smoke";

test("API smoke refuses production hosts and databases before launching Docker", () => {
	for (const value of [
		"mysql://root:p@database.internal:3306/native_image_smoke",
		"mysql://root:p@127.0.0.1:3306/tanah",
		"https://127.0.0.1/native_image_smoke",
	]) assert.throws(() => assertLocalFixture(value));
	assert.throws(() => parseOptions(apiOptions), /local native_image_smoke/);
	assert.equal(parseOptions([...apiOptions, "--db-url", fixture])["db-url"], fixture);
});

test("unsupported architectures or misspelled options cannot silently skip checks", () => {
	assert.throws(() => parseOptions(["--service", "api", "--image", "test", "--arch", "aarch64"]));
	assert.throws(() => parseOptions(["--service", "website", "--image", "test", "--arch", "arm64", "--skip-native"]));
});

test("an HTTP-200 GraphQL error is not successful API runtime evidence", () => {
	const health = { status: "ok", version: "0.1.93" };
	const data = { __typename: "QueryRoot", articlesByPerekId: [] };
	assertApiResponses(health, { data });
	assert.throws(() => assertApiResponses(health, { data, errors: [{ message: "table missing" }] }));
	assert.throws(() => assertApiResponses(health, { data: { ...data, articlesByPerekId: null } }));
	assert.throws(() => assertApiResponses({ ...health, status: "degraded" }, { data }));
});

test("admin checks the actual SSO redirect and server-function protection", () => {
	const location = new URL("https://login.example.invalid/oauth2/authorize");
	location.searchParams.set("client_id", "native-smoke");
	location.searchParams.set("identity_provider", "AWSSSO");
	location.searchParams.set("redirect_uri", "http://127.0.0.1:3101/auth/callback");
	const result = { status: 302, location: location.href, serverFnStatus: 401, serverFnBody: "SESSION_EXPIRED: admin session expired" };
	assertAdminResponses(result);
	assert.throws(() => assertAdminResponses({ ...result, status: 200 }));
	assert.throws(() => assertAdminResponses({ ...result, serverFnStatus: 200 }));
	assert.throws(() => assertAdminResponses({ ...result, location: "https://unrelated.invalid/" }));
});

test("wrong image architecture fails before any container starts", async () => {
	const commands = [];
	await assert.rejects(verifyImage({ service: "admin", image: "test", arch: "arm64" }, {
		docker(args) {
			commands.push(args);
			return JSON.stringify({ Os: "linux", Architecture: "amd64", Id: "sha256:test" });
		},
		runnerArch: "arm64", runnerPlatform: "linux",
	}), /Image metadata must match/);
	assert.equal(commands.length, 1);
});

test("emulated ARM execution is never reported as a native ARM runner", async () => {
	await assert.rejects(verifyImage({ service: "website", image: "test", arch: "arm64" }, {
		runnerArch: "x64", runnerPlatform: "linux",
		docker() { throw new Error("must fail before Docker"); },
	}), /native runner/);
});

test("failed container startup retains logs and cleans up the isolated container", async (t) => {
	const commands = [];
	t.mock.method(console, "error", () => {});
	await assert.rejects(verifyImage({ service: "admin", image: "test", arch: "arm64" }, {
		runnerArch: "arm64", runnerPlatform: "linux",
		docker(args) {
			commands.push(args);
			if (args[0] === "image") return JSON.stringify({ Os: "linux", Architecture: "arm64", Id: "sha256:test" });
			if (args[0] === "exec" && args[2] === "uname") return "aarch64";
			if (args[0] === "exec") throw new Error("connection refused");
			if (args[0] === "inspect") return "false";
			return "";
		},
	}), /Container exited/);
	assert.ok(commands.some((args) => args[0] === "logs"));
	assert.equal(commands.at(-1)[0], "rm");
	const run = commands.find((args) => args[0] === "run");
	assert.ok(run.includes("none"));
	assert.equal(run[run.indexOf("--cpus") + 1], "0.25");
	assert.equal(run[run.indexOf("--memory") + 1], "512m");
});
